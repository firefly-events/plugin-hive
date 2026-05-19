"""Tests for hive/lib/scope_drift.py — covers the 5 AC cases from story
``ed-3-drift-metric-emit`` plus the maturity-gate skip path.

The story's worker-contract YAML names the file
``tests/scope-drift.test.js``, but the underlying helper is Python; the
test runner is ``python -m unittest discover tests``. The story
description is the binding source — bucketed scoring, maturity gate,
JSONL emit path — so the test is in Python under ``tests/`` to match
the helper.
"""

from __future__ import annotations

import logging
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from hive.lib import scope_drift
from hive.lib.metrics import read_run_events


class ComputeScopeDriftTests(unittest.TestCase):
    """The 5 acceptance criteria that don't require disk."""

    # AC3 — minor (one item dropped, no scope-creep)
    def test_one_item_dropped_returns_minor(self) -> None:
        result = scope_drift.compute_scope_drift(
            expected_scope=["a", "b", "c"],
            delivered_scope=["a", "b"],
        )
        self.assertEqual("minor", result["bucket"])
        self.assertEqual(1, result["ordinal"])
        self.assertEqual(1, result["n_dropped"])
        self.assertEqual(0, result["n_added"])

    # AC4 — major (scope-creep ≥ 2x)
    def test_triple_scope_creep_returns_major(self) -> None:
        result = scope_drift.compute_scope_drift(
            expected_scope=["a"],
            delivered_scope=["a", "b", "c", "d"],
        )
        self.assertEqual("major", result["bucket"])
        self.assertEqual(2, result["ordinal"])
        self.assertEqual(0, result["n_dropped"])
        self.assertEqual(3, result["n_added"])

    # AC5 — blocked never exceeds minor
    def test_blocked_caps_at_minor(self) -> None:
        result = scope_drift.compute_scope_drift(
            expected_scope=["a", "b", "c", "d"],
            delivered_scope=[],
            delta_reasons=["blocked"],
        )
        self.assertEqual("minor", result["bucket"])
        self.assertEqual(1, result["ordinal"])

    def test_blocked_with_no_drift_stays_none(self) -> None:
        result = scope_drift.compute_scope_drift(
            expected_scope=["a", "b"],
            delivered_scope=["a", "b"],
            delta_reasons=["blocked"],
        )
        self.assertEqual("none", result["bucket"])

    def test_exact_match_returns_none(self) -> None:
        result = scope_drift.compute_scope_drift(
            expected_scope=["a", "b"],
            delivered_scope=["a", "b"],
        )
        self.assertEqual("none", result["bucket"])

    def test_disjoint_returns_divergent(self) -> None:
        result = scope_drift.compute_scope_drift(
            expected_scope=["a", "b"],
            delivered_scope=["x", "y"],
        )
        self.assertEqual("divergent", result["bucket"])
        self.assertEqual(3, result["ordinal"])

    def test_empty_both_sides_returns_none(self) -> None:
        result = scope_drift.compute_scope_drift(
            expected_scope=[],
            delivered_scope=[],
        )
        self.assertEqual("none", result["bucket"])


class EmitScopeDriftTests(unittest.TestCase):
    """AC1/AC2 — emit + maturity-gate skip behavior. Uses METRICS_ROOT
    to isolate the on-disk JSONL writes."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.metrics_root = Path(self.temp_dir.name) / ".pHive" / "metrics"

        prior = os.environ.get("METRICS_ROOT")
        os.environ["METRICS_ROOT"] = str(self.metrics_root)

        def _restore() -> None:
            if prior is None:
                os.environ.pop("METRICS_ROOT", None)
            else:
                os.environ["METRICS_ROOT"] = prior

        self.addCleanup(_restore)
        scope_drift.reset_skip_log_cache()
        self.addCleanup(scope_drift.reset_skip_log_cache)

    # AC1 — established project, /plan completes Phase A, exactly one
    # scope_drift_score event is appended with a bucketed value.
    def test_established_project_emits_one_row(self) -> None:
        event = scope_drift.emit_scope_drift(
            run_id="run_test_001",
            phase_label="plan:phase-a",
            expected_scope=["read briefs", "merge KG triples", "draft PRIOR DECISIONS"],
            delivered_scope=["read briefs", "merge KG triples"],
            delta_reasons=["deferred"],
            story_id="ed-3-drift-metric-emit",
            skill="plan",
            maturity="established",
        )

        self.assertIsNotNone(event)
        rows = read_run_events("run_test_001")
        self.assertEqual(1, len(rows))
        row = rows[0]
        self.assertEqual("scope_drift_score", row["metric_type"])
        self.assertEqual("bucket", row["unit"])
        self.assertEqual(1, row["value"])  # minor
        self.assertEqual("minor", row["dimensions"]["bucket"])
        self.assertEqual("plan:phase-a", row["dimensions"]["phase_label"])
        self.assertEqual("plan", row["dimensions"]["skill"])
        self.assertEqual(["deferred"], row["dimensions"]["delta_reasons"])
        self.assertEqual("ed-3-drift-metric-emit", row["story_id"])
        self.assertIn("event_id", row)
        self.assertIn("timestamp", row)

    # AC2 — greenfield project, no events emitted, skip-log printed once.
    def test_greenfield_project_skips_and_logs_once(self) -> None:
        with self.assertLogs(scope_drift._log, level="INFO") as log_ctx:
            first = scope_drift.emit_scope_drift(
                run_id="run_test_skip",
                phase_label="plan:phase-a",
                expected_scope=["a", "b"],
                delivered_scope=["a"],
                story_id="ed-3-drift-metric-emit",
                skill="plan",
                maturity="greenfield",
            )
            second = scope_drift.emit_scope_drift(
                run_id="run_test_skip",
                phase_label="plan:phase-b",
                expected_scope=["c"],
                delivered_scope=[],
                story_id="ed-3-drift-metric-emit",
                skill="plan",
                maturity="greenfield",
            )

        self.assertIsNone(first)
        self.assertIsNone(second)
        self.assertEqual([], read_run_events("run_test_skip"))

        skip_lines = [m for m in log_ctx.output if "emit skipped" in m]
        self.assertEqual(
            1,
            len(skip_lines),
            f"expected exactly one skip-log line per run, got: {log_ctx.output!r}",
        )
        self.assertIn("greenfield", skip_lines[0])

    def test_early_project_also_skips(self) -> None:
        result = scope_drift.emit_scope_drift(
            run_id="run_test_early",
            phase_label="plan:phase-a",
            expected_scope=["a"],
            delivered_scope=[],
            story_id="ed-3-drift-metric-emit",
            maturity="early",
        )
        self.assertIsNone(result)
        self.assertEqual([], read_run_events("run_test_early"))

    def test_mature_project_emits(self) -> None:
        event = scope_drift.emit_scope_drift(
            run_id="run_test_mature",
            phase_label="execute:research",
            expected_scope=["a"],
            delivered_scope=["a", "b", "c"],
            story_id="ed-3-drift-metric-emit",
            maturity="mature",
        )
        self.assertIsNotNone(event)
        rows = read_run_events("run_test_mature")
        self.assertEqual(1, len(rows))
        self.assertEqual("major", rows[0]["dimensions"]["bucket"])
        self.assertEqual(2, rows[0]["value"])

    def test_missing_maturity_helper_defaults_to_skip(self) -> None:
        # Default resolution path (no maturity= override). Helper module
        # is not in this branch yet — the safe-import in scope_drift
        # should default to 'early' and skip emit.
        event = scope_drift.emit_scope_drift(
            run_id="run_test_default",
            phase_label="plan:phase-a",
            expected_scope=["a"],
            delivered_scope=[],
            story_id="ed-3-drift-metric-emit",
        )
        # When ed-1's helper lands, this default path becomes
        # data-driven; today it is a conservative skip.
        self.assertIsNone(event)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
