"""Tests for regression-watch evaluation and rollback triggering."""

from __future__ import annotations

import importlib.util
import sys
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


class RecordingEnvelopeWriter:
    """Record watch and decision writes issued by the watch evaluator."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, object]] = []

    def set_regression_watch(self, experiment_id: str, state: dict) -> dict:
        self.calls.append(("set_regression_watch", experiment_id, state))
        return {"experiment_id": experiment_id, "regression_watch": state}

    def set_decision(self, experiment_id: str, decision: str) -> dict:
        self.calls.append(("set_decision", experiment_id, decision))
        return {"experiment_id": experiment_id, "decision": decision}


class CallbackStub:
    """Capture rollback callback calls and return a configured outcome."""

    def __init__(self, *, result=None, error: Exception | None = None) -> None:
        self.result = result
        self.error = error
        self.calls: list[tuple[dict, str]] = []

    def __call__(self, envelope: dict, rollback_ref: str):
        self.calls.append((envelope, rollback_ref))
        if self.error is not None:
            raise self.error
        return self.result


class RollbackWatchRuntimeTests(unittest.TestCase):
    """Verify rollback-watch trip behavior and side effects."""

    def setUp(self) -> None:
        meta_experiment = _load_meta_experiment_module()
        self.rollback_watch = meta_experiment.rollback_watch
        self.RollbackResult = meta_experiment.RollbackResult
        self.TripEvent = meta_experiment.TripEvent
        self.NoActionResult = meta_experiment.NoActionResult
        self.evaluate_watch = meta_experiment.evaluate_watch

    def test_non_accepted_decision_returns_not_accepted(self) -> None:
        envelope = self._base_envelope(decision="pending")

        result = self.evaluate_watch(envelope, self._snapshot(tokens=102), 5.0, "2026-04-21T12:00:00Z")

        self.assertEqual(self.NoActionResult(reason="not-accepted"), result)

    def test_non_armed_watch_returns_already_tripped(self) -> None:
        envelope = self._base_envelope(regression_watch={"state": "tripped"})

        result = self.evaluate_watch(envelope, self._snapshot(tokens=102), 5.0, "2026-04-21T12:00:00Z")

        self.assertEqual(self.NoActionResult(reason="already-tripped"), result)

    def test_now_before_window_returns_not_yet_in_window(self) -> None:
        envelope = self._base_envelope()

        result = self.evaluate_watch(envelope, self._snapshot(tokens=102), 5.0, "2026-04-21T11:59:59Z")

        self.assertEqual(self.NoActionResult(reason="not-yet-in-window"), result)

    def test_now_after_window_returns_window_elapsed(self) -> None:
        envelope = self._base_envelope()

        result = self.evaluate_watch(envelope, self._snapshot(tokens=102), 5.0, "2026-04-21T16:00:00Z")

        self.assertEqual(self.NoActionResult(reason="window-elapsed"), result)

    def test_non_regression_returns_no_regression(self) -> None:
        envelope = self._base_envelope()
        callback = CallbackStub(result=self.RollbackResult(success=True, revert_ref="revert:123"))

        result = self.evaluate_watch(envelope, self._snapshot(tokens=103), 5.0, "2026-04-21T12:30:00Z", callback)

        self.assertEqual(self.NoActionResult(reason="no-regression"), result)
        self.assertEqual([], callback.calls)

    def test_trip_without_callback_returns_trip_event_with_no_rollback_result(self) -> None:
        envelope = self._base_envelope()

        result = self.evaluate_watch(envelope, self._snapshot(tokens=111), 5.0, "2026-04-21T12:30:00Z")

        self.assertIsInstance(result, self.TripEvent)
        self.assertEqual("exp_watch_001", result.experiment_id)
        self.assertEqual("2026-04-21T12:30:00Z", result.tripped_at)
        self.assertEqual(["tokens"], result.regression_metrics)
        self.assertEqual("rollback:exp_watch_001", result.rollback_ref)
        self.assertIsNone(result.rollback_result)

    def test_trip_with_successful_callback_writes_watch_and_reverted_decision(self) -> None:
        envelope = self._base_envelope()
        writer = RecordingEnvelopeWriter()
        callback = CallbackStub(
            result=self.RollbackResult(
                success=True,
                revert_ref="revert:rollback:exp_watch_001",
                notes="reverted",
            )
        )

        result = self.evaluate_watch(
            envelope,
            self._snapshot(tokens=111),
            5.0,
            "2026-04-21T12:30:00Z",
            auto_revert_callback=callback,
            envelope_writer=writer,
        )

        self.assertEqual([(envelope, "rollback:exp_watch_001")], callback.calls)
        self.assertEqual(
            [
                (
                    "set_regression_watch",
                    "exp_watch_001",
                    {
                        "state": "tripped",
                        "tripped_by": self._snapshot(tokens=111),
                        "tripped_at": "2026-04-21T12:30:00Z",
                        "rollback_result": {
                            "success": True,
                            "revert_ref": "revert:rollback:exp_watch_001",
                            "notes": "reverted",
                        },
                    },
                ),
                ("set_decision", "exp_watch_001", "reverted"),
            ],
            writer.calls,
        )
        self.assertEqual(True, result.rollback_result.success)
        self.assertEqual("revert:rollback:exp_watch_001", result.rollback_result.revert_ref)

    def test_trip_with_failed_callback_does_not_write_reverted_decision(self) -> None:
        envelope = self._base_envelope()
        writer = RecordingEnvelopeWriter()
        callback = CallbackStub(
            result=self.RollbackResult(
                success=False,
                revert_ref=None,
                notes="rollback unavailable",
            )
        )

        result = self.evaluate_watch(
            envelope,
            self._snapshot(tokens=111),
            5.0,
            "2026-04-21T12:30:00Z",
            auto_revert_callback=callback,
            envelope_writer=writer,
        )

        self.assertEqual([(envelope, "rollback:exp_watch_001")], callback.calls)
        self.assertEqual(1, len(writer.calls))
        self.assertEqual(
            (
                "set_regression_watch",
                "exp_watch_001",
                {
                    "state": "armed",
                    "armed_at": None,
                    "last_rollback_attempt": {
                        "attempted_at": "2026-04-21T12:30:00Z",
                        "tripped_by": self._snapshot(tokens=111),
                        "rollback_result": {
                            "success": False,
                            "revert_ref": None,
                            "notes": "rollback unavailable",
                        },
                    },
                },
            ),
            writer.calls[0],
        )
        self.assertEqual(False, result.rollback_result.success)

    def test_callback_exception_propagates_without_decision_transition(self) -> None:
        envelope = self._base_envelope()
        writer = RecordingEnvelopeWriter()
        callback = CallbackStub(error=RuntimeError("rollback failed"))

        with self.assertRaisesRegex(RuntimeError, "rollback failed"):
            self.evaluate_watch(
                envelope,
                self._snapshot(tokens=111),
                5.0,
                "2026-04-21T12:30:00Z",
                auto_revert_callback=callback,
                envelope_writer=writer,
            )

        self.assertEqual(1, len(writer.calls))
        self.assertEqual(
            (
                "set_regression_watch",
                "exp_watch_001",
                {
                    "state": "armed",
                    "armed_at": None,
                    "last_rollback_attempt": {
                        "attempted_at": "2026-04-21T12:30:00Z",
                        "tripped_by": self._snapshot(tokens=111),
                    },
                },
            ),
            writer.calls[0],
        )

    def test_trip_without_writer_invokes_callback_and_skips_side_effects(self) -> None:
        envelope = self._base_envelope()
        callback = CallbackStub(
            result=self.RollbackResult(success=True, revert_ref="revert:rollback:exp_watch_001")
        )

        result = self.evaluate_watch(
            envelope,
            self._snapshot(tokens=111),
            5.0,
            "2026-04-21T12:30:00Z",
            auto_revert_callback=callback,
            envelope_writer=None,
        )

        self.assertEqual([(envelope, "rollback:exp_watch_001")], callback.calls)
        self.assertEqual(True, result.rollback_result.success)
        self.assertEqual("revert:rollback:exp_watch_001", result.rollback_result.revert_ref)

    def test_public_surface_exposes_single_trip_path_only(self) -> None:
        public_names = {
            name
            for name in vars(self.rollback_watch)
            if not name.startswith("_") and name != "annotations"
        }

        self.assertEqual(
            {"EnvelopeWriter", "TripEvent", "NoActionResult", "evaluate_watch"},
            public_names,
        )
        self.assertEqual(
            ["EnvelopeWriter", "TripEvent", "NoActionResult", "evaluate_watch"],
            self.rollback_watch.__all__,
        )
        self.assertFalse(hasattr(self.rollback_watch, "require_human_confirm"))
        self.assertFalse(hasattr(self.rollback_watch, "narrow_revert"))
        self.assertFalse(hasattr(self.rollback_watch, "recommend_only"))

        parameters = self.evaluate_watch.__code__.co_varnames[: self.evaluate_watch.__code__.co_argcount]
        self.assertEqual(
            (
                "envelope",
                "post_close_snapshot",
                "threshold_pct",
                "now",
                "auto_revert_callback",
                "envelope_writer",
            ),
            parameters,
        )

    def _snapshot(self, **metrics: object) -> dict[str, object]:
        return {
            "captured_at": "2026-04-21T12:15:00Z",
            "metrics": metrics,
        }

    def _base_envelope(
        self,
        *,
        decision: str = "accept",
        regression_watch: dict | None = None,
    ) -> dict[str, object]:
        return {
            "experiment_id": "exp_watch_001",
            "swarm_id": "meta-meta-optimize",
            "target_ref": "repo:plugin-hive@worktree/test",
            "baseline_ref": "experiment:baseline_001",
            "candidate_ref": "snapshot:candidate/2026-04-21T12:00:00Z",
            "metrics_snapshot": self._snapshot(tokens=100, wall_clock_ms=200),
            "policy_ref": "policy:default",
            "observation_window": {
                "start": "2026-04-21T12:00:00Z",
                "end": "2026-04-21T16:00:00Z",
            },
            "regression_watch": regression_watch
            or {
                "state": "armed",
                "tripped_by": None,
                "tripped_at": None,
            },
            "rollback_ref": "rollback:exp_watch_001",
            "decision": decision,
        }


if __name__ == "__main__":
    unittest.main()
