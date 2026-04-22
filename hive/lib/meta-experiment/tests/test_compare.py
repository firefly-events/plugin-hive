"""Tests for compare verdict calculation and threshold behavior."""

from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path


def _load_meta_experiment_module():
    """Load the meta-experiment package from the dashed directory name."""
    module_dir = Path("hive/lib/meta-experiment")
    init_path = module_dir / "__init__.py"
    spec = importlib.util.spec_from_file_location(
        "hive.lib.meta_experiment",
        init_path,
        submodule_search_locations=[str(module_dir)],
    )
    if spec is None or spec.loader is None:
        raise AssertionError("failed to build import spec for meta-experiment package")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class CompareRuntimeTests(unittest.TestCase):
    """Verify compare verdicts for numeric and boolean metrics."""

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
        meta_experiment = _load_meta_experiment_module()
        self.compare = meta_experiment.compare
        self.envelope = meta_experiment.envelope

    def test_improvement_path_accepts_all_numeric_improvements(self) -> None:
        decision = self.compare.evaluate(
            self._snapshot(tokens=100, wall_clock_ms=200),
            self._snapshot(tokens=90, wall_clock_ms=180),
            5.0,
        )

        self.assertEqual("accept", decision["verdict"])
        self.assertEqual([], decision["regression_metrics"])
        self.assertFalse(decision["metrics"]["tokens"]["over_threshold"])
        self.assertFalse(decision["metrics"]["wall_clock_ms"]["over_threshold"])

    def test_neutral_path_accepts_unchanged_metrics(self) -> None:
        decision = self.compare.evaluate(
            self._snapshot(tokens=100, wall_clock_ms=200),
            self._snapshot(tokens=100, wall_clock_ms=200),
            0.0,
        )

        self.assertEqual("accept", decision["verdict"])
        self.assertEqual(0, decision["metrics"]["tokens"]["delta"])
        self.assertEqual(0.0, decision["metrics"]["tokens"]["delta_pct"])
        self.assertFalse(decision["metrics"]["tokens"]["over_threshold"])

    def test_below_threshold_regression_accepts_metric(self) -> None:
        decision = self.compare.evaluate(
            self._snapshot(tokens=100),
            self._snapshot(tokens=103),
            5.0,
        )

        self.assertEqual("accept", decision["verdict"])
        self.assertEqual([], decision["regression_metrics"])
        self.assertEqual(3.0, decision["metrics"]["tokens"]["delta_pct"])
        self.assertFalse(decision["metrics"]["tokens"]["over_threshold"])

    def test_over_threshold_regression_rejects_metric(self) -> None:
        decision = self.compare.evaluate(
            self._snapshot(tokens=100),
            self._snapshot(tokens=110),
            5.0,
        )

        self.assertEqual("reject", decision["verdict"])
        self.assertEqual(["tokens"], decision["regression_metrics"])
        self.assertTrue(decision["metrics"]["tokens"]["over_threshold"])

    def test_mixed_metrics_reject_when_any_numeric_regresses_over_threshold(self) -> None:
        decision = self.compare.evaluate(
            self._snapshot(tokens=100, wall_clock_ms=200, fix_loop_iterations=4),
            self._snapshot(tokens=90, wall_clock_ms=211, fix_loop_iterations=3),
            5.0,
        )

        self.assertEqual("reject", decision["verdict"])
        self.assertEqual(["wall_clock_ms"], decision["regression_metrics"])
        self.assertFalse(decision["metrics"]["tokens"]["over_threshold"])
        self.assertTrue(decision["metrics"]["wall_clock_ms"]["over_threshold"])
        self.assertFalse(decision["metrics"]["fix_loop_iterations"]["over_threshold"])

    def test_boolean_metrics_accept_when_they_do_not_change(self) -> None:
        decision = self.compare.evaluate(
            self._snapshot(first_attempt_pass=True, human_escalation=False),
            self._snapshot(first_attempt_pass=True, human_escalation=False),
            0.0,
        )

        self.assertEqual("accept", decision["verdict"])
        self.assertEqual([], decision["regression_metrics"])
        self.assertFalse(decision["metrics"]["first_attempt_pass"]["changed"])
        self.assertFalse(decision["metrics"]["first_attempt_pass"]["over_threshold"])

    def test_boolean_metrics_accept_when_they_improve(self) -> None:
        decision = self.compare.evaluate(
            self._snapshot(first_attempt_pass=False),
            self._snapshot(first_attempt_pass=True),
            0.0,
        )

        self.assertEqual("accept", decision["verdict"])
        self.assertEqual([], decision["regression_metrics"])
        self.assertTrue(decision["metrics"]["first_attempt_pass"]["changed"])
        self.assertFalse(decision["metrics"]["first_attempt_pass"]["over_threshold"])

    def test_boolean_metrics_reject_when_they_regress_true_to_false(self) -> None:
        decision = self.compare.evaluate(
            self._snapshot(first_attempt_pass=True, human_escalation=False),
            self._snapshot(first_attempt_pass=False, human_escalation=True),
            0.0,
        )

        self.assertEqual("reject", decision["verdict"])
        self.assertEqual(["first_attempt_pass"], decision["regression_metrics"])
        self.assertIn("first_attempt_pass", decision["metrics"])
        self.assertIn("human_escalation", decision["metrics"])
        self.assertTrue(decision["metrics"]["first_attempt_pass"]["changed"])
        self.assertTrue(decision["metrics"]["first_attempt_pass"]["over_threshold"])
        self.assertFalse(decision["metrics"]["human_escalation"]["over_threshold"])

    def test_numeric_only_happy_paths_remain_unchanged(self) -> None:
        decision = self.compare.evaluate(
            self._snapshot(tokens=100, wall_clock_ms=200),
            self._snapshot(tokens=90, wall_clock_ms=180),
            5.0,
        )

        self.assertEqual("accept", decision["verdict"])
        self.assertEqual([], decision["regression_metrics"])
        self.assertFalse(decision["metrics"]["tokens"]["over_threshold"])
        self.assertFalse(decision["metrics"]["wall_clock_ms"]["over_threshold"])

    def test_evaluate_from_envelope_reads_baseline_snapshot_from_referenced_envelope(self) -> None:
        baseline_experiment_id = "exp_baseline_source"
        candidate_experiment_id = "exp_candidate"
        baseline_snapshot = {
            "captured_at": "2026-04-20T14:00:00Z",
            "metrics": {"tokens": 100, "wall_clock_ms": 200},
        }

        baseline_envelope = self._base_envelope(experiment_id=baseline_experiment_id)
        baseline_envelope["metrics_snapshot"] = baseline_snapshot
        self.envelope.create(baseline_envelope)
        self.envelope.create(
            self._base_envelope(
                experiment_id=candidate_experiment_id,
                baseline_ref=f"experiment:{baseline_experiment_id}",
            )
        )

        decision = self.compare.evaluate_from_envelope(
            self.envelope.load(candidate_experiment_id),
            {"captured_at": "2026-04-20T15:00:00Z", "metrics": {"tokens": 95, "wall_clock_ms": 198}},
            5.0,
        )

        self.assertEqual("accept", decision["verdict"])
        self.assertEqual(100, decision["metrics"]["tokens"]["baseline"])
        self.assertEqual(95, decision["metrics"]["tokens"]["candidate"])

    def test_single_knob_discipline_exposes_one_top_level_threshold_only(self) -> None:
        decision = self.compare.evaluate(
            self._snapshot(tokens=100, wall_clock_ms=100),
            self._snapshot(tokens=101, wall_clock_ms=99),
            5.0,
        )

        self.assertEqual({"verdict", "threshold_pct", "metrics", "regression_metrics"}, set(decision))
        self.assertEqual(5.0, decision["threshold_pct"])
        for metric_result in decision["metrics"].values():
            self.assertNotIn("threshold_pct", metric_result)

    def _snapshot(self, **metrics: object) -> dict[str, object]:
        return {
            "captured_at": "2026-04-20T14:25:00Z",
            "metrics": metrics,
        }

    def _base_envelope(
        self,
        *,
        experiment_id: str,
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
