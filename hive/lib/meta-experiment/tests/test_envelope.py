"""Tests for the meta-experiment envelope wrapper module."""

from __future__ import annotations

import os
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

from hive.lib.metrics import MetricsValidationError

from ._loader import load_meta_experiment_module


def _load_envelope_module():
    """Load the envelope module from the dashed package directory."""
    return load_meta_experiment_module().envelope


class EnvelopeRuntimeTests(unittest.TestCase):
    """Verify envelope wrapper reads and narrow field updates."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.metrics_root = Path(self.temp_dir.name) / ".pHive" / "metrics"
        prior_metrics_root = os.environ.get("METRICS_ROOT")
        os.environ["METRICS_ROOT"] = str(self.metrics_root)

        def _restore_metrics_root() -> None:
            if prior_metrics_root is None:
                os.environ.pop("METRICS_ROOT", None)
            else:
                os.environ["METRICS_ROOT"] = prior_metrics_root

        self.addCleanup(_restore_metrics_root)
        self.envelope = _load_envelope_module()

    def test_create_and_load_round_trip(self) -> None:
        envelope = self._full_envelope()

        self.envelope.create(envelope)
        loaded = self.envelope.load(envelope["experiment_id"])

        self.assertEqual(envelope, loaded)

    def test_set_decision_accept_then_forbidden_reject(self) -> None:
        envelope = self._base_envelope(experiment_id="exp_decision")
        self.envelope.create(envelope)

        updated = self.envelope.set_decision(envelope["experiment_id"], "accept")
        self.assertEqual("accept", updated["decision"])

        with self.assertRaises(MetricsValidationError):
            self.envelope.set_decision(envelope["experiment_id"], "reject")

    def test_set_commit_ref_is_set_once(self) -> None:
        envelope = self._base_envelope(experiment_id="exp_commit")
        self.envelope.create(envelope)

        updated = self.envelope.set_commit_ref(envelope["experiment_id"], "git:abc123")
        self.assertEqual("git:abc123", updated["commit_ref"])

        with self.assertRaises(MetricsValidationError):
            self.envelope.set_commit_ref(envelope["experiment_id"], "git:def456")

    def test_set_rollback_ref_is_set_once(self) -> None:
        envelope = self._base_envelope(experiment_id="exp_rollback")
        self.envelope.create(envelope)

        updated = self.envelope.set_rollback_ref(envelope["experiment_id"], "git:rollback123")
        self.assertEqual("git:rollback123", updated["rollback_ref"])

        with self.assertRaises(MetricsValidationError):
            self.envelope.set_rollback_ref(envelope["experiment_id"], "git:rollback456")

    def test_set_metrics_snapshot_updates_field(self) -> None:
        envelope = self._base_envelope(experiment_id="exp_snapshot")
        snapshot = {
            "captured_at": "2026-04-20T14:25:00Z",
            "metrics": {"tokens_per_story": 4120, "first_attempt_pass": True},
        }
        self.envelope.create(envelope)

        updated = self.envelope.set_metrics_snapshot(envelope["experiment_id"], snapshot)

        self.assertEqual(snapshot, updated["metrics_snapshot"])
        self.assertEqual(snapshot, self.envelope.load(envelope["experiment_id"])["metrics_snapshot"])

    def test_set_regression_watch_allows_armed_to_tripped(self) -> None:
        envelope = self._base_envelope(experiment_id="exp_watch")
        self.envelope.create(envelope)
        tripped = {
            "state": "tripped",
            "tripped_by": "metric:tokens_per_story",
            "tripped_at": "2026-04-20T16:00:00Z",
        }

        updated = self.envelope.set_regression_watch(envelope["experiment_id"], tripped)

        self.assertEqual(tripped, updated["regression_watch"])

    def test_set_observation_window_updates_window(self) -> None:
        envelope = self._base_envelope(experiment_id="exp_observation_window")
        window = {
            "start": "2026-04-20T16:00:00Z",
            "end": "2026-04-20T20:00:00Z",
        }
        self.envelope.create(envelope)

        updated = self.envelope.set_observation_window(envelope["experiment_id"], window)

        self.assertEqual(window, updated["observation_window"])
        self.assertEqual(window, self.envelope.load(envelope["experiment_id"])["observation_window"])

    def test_set_helpers_only_mutate_declared_field(self) -> None:
        cases = [
            ("set_decision", "decision", "accept"),
            (
                "set_observation_window",
                "observation_window",
                {
                    "start": "2026-04-20T16:00:00Z",
                    "end": "2026-04-20T20:00:00Z",
                },
            ),
            (
                "set_regression_watch",
                "regression_watch",
                {
                    "state": "tripped",
                    "tripped_by": "metric:wall_clock_ms",
                    "tripped_at": "2026-04-20T16:45:00Z",
                },
            ),
            ("set_commit_ref", "commit_ref", "git:abc123"),
            ("set_rollback_ref", "rollback_ref", "git:rollback123"),
            (
                "set_metrics_snapshot",
                "metrics_snapshot",
                {
                    "captured_at": "2026-04-20T14:25:00Z",
                    "metrics": {"fix_loop_iterations": 1},
                },
            ),
        ]

        for helper_name, field_name, new_value in cases:
            with self.subTest(helper=helper_name):
                experiment_id = f"exp_{helper_name}"
                envelope = self._base_envelope(experiment_id=experiment_id)
                self.envelope.create(envelope)
                before = self.envelope.load(experiment_id)

                helper = getattr(self.envelope, helper_name)
                after = helper(experiment_id, deepcopy(new_value))

                expected = deepcopy(before)
                expected[field_name] = deepcopy(new_value)
                self.assertEqual(expected, after)
                self.assertEqual(expected, self.envelope.load(experiment_id))

    def _base_envelope(
        self,
        *,
        experiment_id: str = "exp_001",
        baseline_ref: str = "experiment:baseline_001",
    ) -> dict[str, object]:
        return {
            "experiment_id": experiment_id,
            "swarm_id": "meta-meta-optimize",
            "target_ref": "repo:plugin-hive@worktree/test",
            "baseline_ref": baseline_ref,
            "candidate_ref": "snapshot:candidate/2026-04-20T14:25:00Z",
            "policy_ref": "policy:default",
            "decision": "pending",
            "observation_window": {
                "start": "2026-04-20T14:30:00Z",
                "end": "2026-04-20T18:30:00Z",
            },
            "regression_watch": {
                "state": "armed",
                "tripped_by": None,
                "tripped_at": None,
            },
        }

    def _full_envelope(self) -> dict[str, object]:
        envelope = self._base_envelope(experiment_id="exp_full")
        envelope["decision"] = "accept"
        envelope["commit_ref"] = "git:abc123"
        envelope["rollback_ref"] = "git:rollback123"
        envelope["metrics_snapshot"] = {
            "captured_at": "2026-04-20T14:25:00Z",
            "metrics": {
                "tokens_per_story": 4120,
                "wall_clock_ms": 284000,
                "fix_loop_iterations": 1,
                "first_attempt_pass": True,
                "human_escalation_count": 0,
            },
        }
        return envelope


if __name__ == "__main__":
    unittest.main()
