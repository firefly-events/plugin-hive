"""Tests for hive/lib/scope_drift_reader.py — covers the 3 AC cases
from story ``ed-4-drift-status-surface``.

The story's worker-contract YAML names the file
``tests/status-drift-surface.test.js``, but the underlying helper is
Python and the test runner is ``python -m unittest discover tests``
(same pattern as ed-3's ``tests/test_scope_drift.py``). The story
description is the binding source — five-run cap, silent-on-absence,
malformed-row skip — so the test is in Python under ``tests/`` to
match the helper.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from hive.lib import scope_drift_reader


class _IsolatedMetricsRoot(unittest.TestCase):
    """Set up an isolated METRICS_ROOT pointing at a fresh tmpdir."""

    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)

        events_dir = Path(self._tmpdir.name) / "events"
        events_dir.mkdir()
        self.events_dir = events_dir

        self._prev_metrics_root = os.environ.get("METRICS_ROOT")
        os.environ["METRICS_ROOT"] = self._tmpdir.name
        self.addCleanup(self._restore_metrics_root)

    def _restore_metrics_root(self) -> None:
        if self._prev_metrics_root is None:
            os.environ.pop("METRICS_ROOT", None)
        else:
            os.environ["METRICS_ROOT"] = self._prev_metrics_root

    def _write_run(
        self,
        run_id: str,
        rows: list[dict] | list[str],
        *,
        mtime_offset: float = 0.0,
    ) -> Path:
        """Write ``rows`` as one JSONL file. ``mtime_offset`` sets the
        run-file mtime relative to now (negative = older).
        """
        path = self.events_dir / f"{run_id}.jsonl"
        with path.open("w", encoding="utf-8") as handle:
            for row in rows:
                if isinstance(row, str):
                    handle.write(row + "\n")
                else:
                    handle.write(json.dumps(row, sort_keys=True) + "\n")
        if mtime_offset:
            stamp = time.time() + mtime_offset
            os.utime(path, (stamp, stamp))
        return path

    @staticmethod
    def _drift_row(
        run_id: str,
        bucket: str,
        *,
        timestamp: str = "2026-05-19T12:00:00Z",
        phase_label: str = "execute:story",
    ) -> dict:
        return {
            "event_id": f"evt_{run_id}_{bucket}",
            "timestamp": timestamp,
            "run_id": run_id,
            "metric_type": "scope_drift_score",
            "value": {"none": 0, "minor": 1, "major": 2, "divergent": 3}[bucket],
            "unit": "bucket",
            "dimensions": {
                "bucket": bucket,
                "phase_label": phase_label,
            },
            "source": "scope-drift-helper",
            "story_id": "ed-4-drift-status-surface",
        }


class RecentDriftTrendTests(_IsolatedMetricsRoot):

    # AC1 — Given 5 recent runs with drift events, when /hive:status
    # runs, then a 'Drift trend' section lists each run with bucketed
    # counts.
    def test_five_recent_runs_returned_with_bucketed_counts(self) -> None:
        for idx in range(5):
            self._write_run(
                f"run-{idx:02d}",
                [
                    self._drift_row(f"run-{idx:02d}", "none"),
                    self._drift_row(f"run-{idx:02d}", "minor"),
                    self._drift_row(f"run-{idx:02d}", "major"),
                ],
                mtime_offset=-(5 - idx) * 60,
            )

        rows = scope_drift_reader.recent_drift_trend()

        self.assertEqual(5, len(rows))
        for row in rows:
            self.assertEqual(
                {"none": 1, "minor": 1, "major": 1, "divergent": 0},
                row["counts"],
            )
            self.assertEqual(3, row["total"])
            self.assertTrue(row["run_id"].startswith("run-"))

        run_ids_in_order = [row["run_id"] for row in rows]
        self.assertEqual(
            sorted(run_ids_in_order, reverse=True),
            run_ids_in_order,
            "rows should be ordered most-recent-first (by mtime)",
        )

    def test_more_than_five_runs_caps_at_five(self) -> None:
        for idx in range(8):
            self._write_run(
                f"run-{idx:02d}",
                [self._drift_row(f"run-{idx:02d}", "none")],
                mtime_offset=-(8 - idx) * 60,
            )

        rows = scope_drift_reader.recent_drift_trend()

        self.assertEqual(5, len(rows))
        run_ids = [row["run_id"] for row in rows]
        self.assertNotIn("run-00", run_ids)
        self.assertNotIn("run-01", run_ids)
        self.assertNotIn("run-02", run_ids)
        self.assertIn("run-07", run_ids)

    def test_runs_without_drift_events_are_excluded(self) -> None:
        # One run carries drift, one carries only unrelated metric rows —
        # the unrelated run drops out of the trend entirely.
        self._write_run(
            "run-with-drift",
            [self._drift_row("run-with-drift", "minor")],
        )
        self._write_run(
            "run-tokens-only",
            [
                {
                    "event_id": "evt_tokens",
                    "timestamp": "2026-05-19T12:00:00Z",
                    "run_id": "run-tokens-only",
                    "metric_type": "tokens",
                    "value": 100,
                    "unit": "tokens",
                    "dimensions": {},
                    "source": "test",
                    "story_id": "ed-4-drift-status-surface",
                }
            ],
        )

        rows = scope_drift_reader.recent_drift_trend()

        self.assertEqual(1, len(rows))
        self.assertEqual("run-with-drift", rows[0]["run_id"])

    def test_timestamp_is_latest_event_in_run(self) -> None:
        self._write_run(
            "run-multi-ts",
            [
                self._drift_row(
                    "run-multi-ts", "minor", timestamp="2026-05-19T10:00:00Z"
                ),
                self._drift_row(
                    "run-multi-ts", "major", timestamp="2026-05-19T11:30:00Z"
                ),
                self._drift_row(
                    "run-multi-ts", "none", timestamp="2026-05-19T09:00:00Z"
                ),
            ],
        )

        rows = scope_drift_reader.recent_drift_trend()

        self.assertEqual(1, len(rows))
        self.assertEqual("2026-05-19T11:30:00Z", rows[0]["timestamp"])


class SilentOnAbsenceTests(_IsolatedMetricsRoot):

    # AC2 — Given 0 recent runs with drift events (greenfield), when
    # /hive:status runs, then the Drift trend section is omitted
    # (silent on absence).
    def test_empty_events_dir_returns_empty_list(self) -> None:
        self.assertEqual([], scope_drift_reader.recent_drift_trend())

    def test_empty_events_dir_format_returns_empty_string(self) -> None:
        self.assertEqual("", scope_drift_reader.format_drift_trend())

    def test_missing_events_dir_returns_empty_list(self) -> None:
        # Remove the dir entirely — the reader should not crash.
        for path in self.events_dir.iterdir():
            path.unlink()
        self.events_dir.rmdir()
        self.assertEqual([], scope_drift_reader.recent_drift_trend())
        self.assertEqual("", scope_drift_reader.format_drift_trend())

    def test_only_unrelated_metric_rows_returns_empty(self) -> None:
        self._write_run(
            "run-tokens",
            [
                {
                    "event_id": "evt_tokens",
                    "timestamp": "2026-05-19T12:00:00Z",
                    "run_id": "run-tokens",
                    "metric_type": "tokens",
                    "value": 100,
                    "unit": "tokens",
                    "dimensions": {},
                    "source": "test",
                    "story_id": "ed-4-drift-status-surface",
                }
            ],
        )
        self.assertEqual([], scope_drift_reader.recent_drift_trend())
        self.assertEqual("", scope_drift_reader.format_drift_trend())


class MalformedRowTests(_IsolatedMetricsRoot):

    # AC3 — Given a malformed event row, when /hive:status runs, then
    # the row is skipped with a one-line warning, no crash.
    def test_malformed_json_row_skipped_with_warning(self) -> None:
        self._write_run(
            "run-mixed",
            [
                self._drift_row("run-mixed", "minor"),
                "this is not json {",
                self._drift_row("run-mixed", "major"),
            ],
        )

        with self.assertLogs(scope_drift_reader._log, level="WARNING") as log_ctx:
            rows = scope_drift_reader.recent_drift_trend()

        self.assertEqual(1, len(rows))
        self.assertEqual(1, rows[0]["counts"]["minor"])
        self.assertEqual(1, rows[0]["counts"]["major"])

        malformed_warnings = [m for m in log_ctx.output if "malformed JSON" in m]
        self.assertEqual(1, len(malformed_warnings))

    def test_unknown_bucket_skipped_with_warning(self) -> None:
        bogus = self._drift_row("run-bogus", "minor")
        bogus["dimensions"]["bucket"] = "catastrophic"
        self._write_run(
            "run-bogus",
            [bogus, self._drift_row("run-bogus", "none")],
        )

        with self.assertLogs(scope_drift_reader._log, level="WARNING") as log_ctx:
            rows = scope_drift_reader.recent_drift_trend()

        self.assertEqual(1, len(rows))
        self.assertEqual(1, rows[0]["counts"]["none"])
        self.assertEqual(0, rows[0]["counts"]["minor"])

        unknown_warnings = [
            m for m in log_ctx.output if "missing/unknown" in m
        ]
        self.assertEqual(1, len(unknown_warnings))

    def test_row_missing_run_id_skipped(self) -> None:
        missing = self._drift_row("run-x", "minor")
        del missing["run_id"]
        self._write_run(
            "run-x",
            [missing, self._drift_row("run-x", "none")],
        )

        with self.assertLogs(scope_drift_reader._log, level="WARNING"):
            rows = scope_drift_reader.recent_drift_trend()

        self.assertEqual(1, len(rows))
        self.assertEqual(1, rows[0]["counts"]["none"])

    def test_non_object_row_skipped(self) -> None:
        self._write_run(
            "run-scalar",
            [
                "[1, 2, 3]",
                json.dumps(self._drift_row("run-scalar", "minor")),
            ],
        )

        with self.assertLogs(scope_drift_reader._log, level="WARNING"):
            rows = scope_drift_reader.recent_drift_trend()

        self.assertEqual(1, len(rows))
        self.assertEqual(1, rows[0]["counts"]["minor"])

    def test_blank_lines_tolerated_without_warning(self) -> None:
        self._write_run(
            "run-blanks",
            [
                json.dumps(self._drift_row("run-blanks", "minor")),
                "",
                "   ",
                json.dumps(self._drift_row("run-blanks", "none")),
            ],
        )

        logger = scope_drift_reader._log
        prior_level = logger.level
        logger.setLevel(logging.WARNING)
        try:
            with self.assertLogs(logger, level="WARNING") as log_ctx:
                logger.warning("sentinel-keepalive")
                rows = scope_drift_reader.recent_drift_trend()
        finally:
            logger.setLevel(prior_level)

        non_sentinel = [m for m in log_ctx.output if "sentinel-keepalive" not in m]
        self.assertEqual(
            [],
            non_sentinel,
            f"blank lines should not warn; got {non_sentinel!r}",
        )
        self.assertEqual(1, len(rows))
        self.assertEqual(2, rows[0]["total"])


class FormatDriftTrendTests(_IsolatedMetricsRoot):

    def test_format_includes_all_buckets_per_row(self) -> None:
        self._write_run(
            "run-fmt",
            [
                self._drift_row("run-fmt", "minor"),
                self._drift_row("run-fmt", "minor"),
                self._drift_row("run-fmt", "major"),
            ],
        )

        output = scope_drift_reader.format_drift_trend()

        self.assertIn("Drift trend (last 1 run)", output)
        self.assertIn("run-fmt", output)
        self.assertIn("none=0", output)
        self.assertIn("minor=2", output)
        self.assertIn("major=1", output)
        self.assertIn("divergent=0", output)

    def test_format_returns_empty_when_no_events(self) -> None:
        self.assertEqual("", scope_drift_reader.format_drift_trend())


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
