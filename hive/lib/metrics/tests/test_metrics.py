from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from hive.lib.metrics import (
    MetricsConflictError,
    MetricsPathBoundaryError,
    MetricsValidationError,
    append_event,
    create_envelope,
    delta_compare,
    read_baseline_metrics,
    read_envelope,
    read_run_events,
    update_envelope,
)
from hive.lib.metrics.paths import resolve_metrics_path


class MetricsRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.metrics_root = Path(self.temp_dir.name) / ".pHive" / "metrics"
        os.environ["METRICS_ROOT"] = str(self.metrics_root)
        self.addCleanup(os.environ.pop, "METRICS_ROOT", None)

    def test_append_event_round_trip(self) -> None:
        event = {
            "event_id": "evt_001",
            "timestamp": "2026-04-20T14:03:11Z",
            "run_id": "run_001",
            "story_id": "C1.4",
            "metric_type": "tokens",
            "value": 4182,
            "unit": "tokens",
            "dimensions": {"methodology": "classic"},
            "source": "unit-test",
        }

        append_event(event, "run_001")
        rows = read_run_events("run_001")

        self.assertEqual([event], rows)

    def test_create_envelope_round_trip(self) -> None:
        envelope = self._base_envelope()

        create_envelope(envelope)
        loaded = read_envelope(envelope["experiment_id"])

        self.assertEqual(envelope, loaded)

    def test_update_envelope_decision(self) -> None:
        envelope = self._base_envelope()
        create_envelope(envelope)

        update_envelope(envelope["experiment_id"], {"decision": "accept"})
        loaded = read_envelope(envelope["experiment_id"])

        self.assertEqual("accept", loaded["decision"])

    def test_update_envelope_rejects_immutable_field(self) -> None:
        envelope = self._base_envelope()
        create_envelope(envelope)

        with self.assertRaises(MetricsValidationError):
            update_envelope(envelope["experiment_id"], {"baseline_ref": "experiment:baseline_2"})

    def test_create_envelope_rejects_duplicate_experiment_id(self) -> None:
        envelope = self._base_envelope()
        create_envelope(envelope)

        with self.assertRaises(MetricsConflictError):
            create_envelope(envelope)

    def test_delta_compare_numeric_metrics(self) -> None:
        baseline = {"metrics": {"tokens": 100, "wall_clock_ms": 200}}
        candidate = {"metrics": {"tokens": 125, "wall_clock_ms": 150}}

        delta = delta_compare(baseline, candidate)

        self.assertEqual(25, delta["tokens"]["delta"])
        self.assertEqual(25.0, delta["tokens"]["delta_pct"])
        self.assertEqual(-50, delta["wall_clock_ms"]["delta"])
        self.assertEqual(-25.0, delta["wall_clock_ms"]["delta_pct"])

    def test_delta_compare_boolean_metrics(self) -> None:
        baseline = {"metrics": {"first_attempt_pass": True, "human_escalation": False}}
        candidate = {"metrics": {"first_attempt_pass": False, "human_escalation": False}}

        delta = delta_compare(baseline, candidate)

        self.assertTrue(delta["first_attempt_pass"]["changed"])
        self.assertFalse(delta["human_escalation"]["changed"])

    def test_side_effect_boundary_rejects_escape(self) -> None:
        with self.assertRaises(MetricsPathBoundaryError):
            resolve_metrics_path(
                "events", "..", "..", "..", "escape.jsonl", for_write=True
            )

    def test_read_baseline_metrics_uses_baseline_envelope_snapshot(self) -> None:
        baseline = self._base_envelope(
            experiment_id="baseline_001",
            baseline_ref="experiment:baseline_seed",
        )
        baseline["metrics_snapshot"] = {"metrics": {"tokens": 100}}
        create_envelope(baseline)

        candidate = self._base_envelope(
            experiment_id="candidate_001",
            baseline_ref="experiment:baseline_001",
        )
        create_envelope(candidate)

        metrics_snapshot = read_baseline_metrics(candidate)

        self.assertEqual({"metrics": {"tokens": 100}}, metrics_snapshot)

    def test_append_event_rejects_tainted_run_id(self) -> None:
        event = {
            "event_id": "evt_001",
            "timestamp": "2026-04-20T14:03:11Z",
            "run_id": "run_001",
            "story_id": "C1.4",
            "metric_type": "tokens",
            "value": 4182,
            "unit": "tokens",
            "source": "unit-test",
        }

        for tainted_run_id in ("nested/run", r"nested\run", "/absolute/path", "../escape"):
            with self.subTest(run_id=tainted_run_id):
                with self.assertRaises(MetricsValidationError):
                    append_event(event, tainted_run_id)

        self.assertFalse((self.metrics_root / "events").exists())

    def test_create_envelope_rejects_tainted_experiment_id(self) -> None:
        for tainted_experiment_id in (
            "nested/exp",
            r"nested\exp",
            "/absolute/path",
            "../escape",
        ):
            with self.subTest(experiment_id=tainted_experiment_id):
                envelope = self._base_envelope(experiment_id=tainted_experiment_id)
                with self.assertRaises(MetricsValidationError):
                    create_envelope(envelope)

        self.assertFalse((self.metrics_root / "experiments").exists())

    def test_update_envelope_blocks_reject_to_accept_transition(self) -> None:
        rejected = self._base_envelope(experiment_id="exp_rejected")
        rejected["decision"] = "reject"
        create_envelope(rejected)

        with self.assertRaises(MetricsValidationError):
            update_envelope(rejected["experiment_id"], {"decision": "accept"})

        reverted = self._base_envelope(experiment_id="exp_reverted")
        reverted["decision"] = "accept"
        create_envelope(reverted)
        update_envelope(reverted["experiment_id"], {"decision": "reverted"})

        with self.assertRaises(MetricsValidationError):
            update_envelope(reverted["experiment_id"], {"decision": "accept"})

    def test_set_once_commit_ref_cannot_be_rewritten(self) -> None:
        envelope = self._base_envelope(experiment_id="exp_closure")
        create_envelope(envelope)

        update_envelope(envelope["experiment_id"], {"commit_ref": "git:abc123"})
        with self.assertRaises(MetricsValidationError):
            update_envelope(envelope["experiment_id"], {"commit_ref": "git:def456"})

        update_envelope(envelope["experiment_id"], {"metrics_snapshot": {"metrics": {"tokens": 100}}})
        update_envelope(envelope["experiment_id"], {"rollback_ref": "git:rollback123"})
        with self.assertRaises(MetricsValidationError):
            update_envelope(envelope["experiment_id"], {"rollback_ref": "git:rollback456"})

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


if __name__ == "__main__":
    unittest.main()
