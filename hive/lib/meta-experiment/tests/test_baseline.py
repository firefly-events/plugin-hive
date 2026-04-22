from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path


def _load_meta_experiment_module():
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


class BaselineRuntimeTests(unittest.TestCase):
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
        self.baseline = meta_experiment.baseline
        self.envelope = meta_experiment.envelope

    def test_capture_from_run_returns_snapshot_when_events_exist(self) -> None:
        run_id = "run_capture_snapshot"
        self._write_events(
            run_id,
            [
                self._event(run_id, event_id="evt_001", metric_type="tokens", value=4100),
                self._event(
                    run_id,
                    event_id="evt_002",
                    metric_type="wall_clock_ms",
                    value=284000,
                    unit="ms",
                ),
                self._event(
                    run_id,
                    event_id="evt_003",
                    metric_type="tokens",
                    value=4200,
                    timestamp="2026-04-20T14:03:00Z",
                ),
            ],
        )

        snapshot = self.baseline.capture_from_run(run_id)

        self.assertIsInstance(snapshot, dict)
        self.assertIn("captured_at", snapshot)
        self.assertEqual(
            {"tokens": 4200, "wall_clock_ms": 284000},
            snapshot["metrics"],
        )

    def test_capture_from_run_returns_none_when_events_file_missing(self) -> None:
        self.assertIsNone(self.baseline.capture_from_run("run_missing"))

    def test_capture_from_run_returns_none_when_events_file_empty(self) -> None:
        events_dir = self.metrics_root / "events"
        events_dir.mkdir(parents=True, exist_ok=True)
        (events_dir / "run_empty.jsonl").write_text("", encoding="utf-8")

        self.assertIsNone(self.baseline.capture_from_run("run_empty"))

    def test_persist_to_envelope_writes_snapshot_via_wrapper(self) -> None:
        experiment_id = "exp_persist_snapshot"
        snapshot = {
            "captured_at": "2026-04-20T14:25:00Z",
            "metrics": {"tokens": 4100, "first_attempt_pass": True},
        }
        self.envelope.create(self._base_envelope(experiment_id=experiment_id))

        updated = self.baseline.persist_to_envelope(experiment_id, snapshot)

        self.assertEqual(snapshot, updated["metrics_snapshot"])
        self.assertEqual(snapshot, self.envelope.load(experiment_id)["metrics_snapshot"])

    def test_capture_and_persist_raises_when_no_usable_events(self) -> None:
        experiment_id = "exp_no_baseline"
        self.envelope.create(self._base_envelope(experiment_id=experiment_id))

        with self.assertRaises(self.baseline.NoBaselineError):
            self.baseline.capture_and_persist(experiment_id, "run_missing")

    def test_capture_and_persist_succeeds_end_to_end_when_events_exist(self) -> None:
        experiment_id = "exp_capture_and_persist"
        run_id = "run_capture_and_persist"
        self.envelope.create(self._base_envelope(experiment_id=experiment_id))
        self._write_events(
            run_id,
            [
                self._event(run_id, event_id="evt_010", metric_type="tokens", value=5100),
                self._event(
                    run_id,
                    event_id="evt_011",
                    metric_type="first_attempt_pass",
                    value=True,
                    unit="bool",
                ),
            ],
        )

        updated = self.baseline.capture_and_persist(experiment_id, run_id)

        self.assertEqual(
            {"tokens": 5100, "first_attempt_pass": True},
            updated["metrics_snapshot"]["metrics"],
        )
        self.assertEqual(
            updated["metrics_snapshot"],
            self.envelope.load(experiment_id)["metrics_snapshot"],
        )

    def _write_events(self, run_id: str, events: list[dict[str, object]]) -> None:
        events_dir = self.metrics_root / "events"
        events_dir.mkdir(parents=True, exist_ok=True)
        event_path = events_dir / f"{run_id}.jsonl"
        with event_path.open("w", encoding="utf-8") as handle:
            for event in events:
                handle.write(json.dumps(event, sort_keys=True))
                handle.write("\n")

    def _event(
        self,
        run_id: str,
        *,
        event_id: str,
        metric_type: str,
        value: object,
        unit: str | None = None,
        timestamp: str = "2026-04-20T14:00:00Z",
    ) -> dict[str, object]:
        unit_by_metric = {
            "tokens": "tokens",
            "wall_clock_ms": "ms",
            "fix_loop_iterations": "iterations",
            "first_attempt_pass": "bool",
            "human_escalation": "bool",
        }
        return {
            "event_id": event_id,
            "timestamp": timestamp,
            "run_id": run_id,
            "swarm_id": "meta-meta-optimize",
            "story_id": "L1.3",
            "phase": "verification",
            "agent": "tester",
            "metric_type": metric_type,
            "value": value,
            "unit": unit or unit_by_metric[metric_type],
            "dimensions": {},
            "source": "test-fixture",
        }

    def _base_envelope(self, *, experiment_id: str) -> dict[str, object]:
        return {
            "experiment_id": experiment_id,
            "swarm_id": "meta-meta-optimize",
            "target_ref": "repo:plugin-hive@worktree/test",
            "baseline_ref": "experiment:baseline_001",
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
