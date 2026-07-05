"""Unit tests for harness report collection."""

from __future__ import annotations

import json
import os
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest.mock import patch

from hive.lib.harness import collect
from hive.lib.metrics.errors import MetricsValidationError


def _snapshot_payload(
    label: str,
    sha: str,
    by_top_dir: dict[str, int],
    files: list[str],
) -> dict[str, object]:
    by_ext: dict[str, int] = {}
    for item in files:
        ext = Path(item).suffix or "(none)"
        by_ext[ext] = by_ext.get(ext, 0) + 1
    return {
        "label": label,
        "captured_at": "2026-07-04T00:00:00+00:00",
        "repo": "/tmp/repo",
        "git": {"sha": sha, "branch": "feat/metric-capture-harness", "dirty": False},
        "files": {
            "total": len(files),
            "by_top_dir": by_top_dir,
            "by_ext": by_ext,
            "list": files,
        },
        "tree": {"files": 0, "total": len(files), "dirs": {}},
    }


class CollectReportTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory(prefix="collect-tests-")
        self.addCleanup(self.tmpdir.cleanup)
        base = Path(self.tmpdir.name)
        self.repo = base / "repo"
        self.repo.mkdir()
        self.state_dir = base / "state"
        self.state_dir.mkdir()
        self.env = patch.dict(os.environ, {"HIVE_STATE_DIR": str(self.state_dir)}, clear=False)
        self.env.start()
        self.addCleanup(self.env.stop)

    def _write_events(self, rows: list[dict[str, object]]) -> None:
        events_dir = self.state_dir / "metrics" / "events"
        events_dir.mkdir(parents=True, exist_ok=True)
        (events_dir / "stop-001.jsonl").write_text(
            "".join(json.dumps(row) + "\n" for row in rows),
            encoding="utf-8",
        )

    def _write_epic(self, deliverable: str, body: str) -> None:
        epic_dir = self.repo / ".pHive" / "epics" / deliverable
        epic_dir.mkdir(parents=True, exist_ok=True)
        (epic_dir / "epic.yaml").write_text(textwrap.dedent(body), encoding="utf-8")

    def _write_episode(self, deliverable: str, story_id: str, filename: str, body: str) -> None:
        episode_dir = self.repo / ".pHive" / "episodes" / deliverable / story_id
        episode_dir.mkdir(parents=True, exist_ok=True)
        (episode_dir / filename).write_text(textwrap.dedent(body), encoding="utf-8")

    def _write_snapshot(self, label: str, payload: dict[str, object]) -> None:
        snap_dir = self.state_dir / "harness" / "snapshots"
        snap_dir.mkdir(parents=True, exist_ok=True)
        (snap_dir / f"{label}.json").write_text(json.dumps(payload), encoding="utf-8")

    def test_collect_report_rolls_up_metrics_flow_and_snapshot_diff_from_fixture_tree(self) -> None:
        self._write_events(
            [
                {
                    "story_id": "design-system",
                    "metric_type": "tokens",
                    "dimensions": {
                        "input_tokens": 11,
                        "output_tokens": 7,
                        "cache_read_input_tokens": 3,
                        "cache_creation_input_tokens": 5,
                    },
                },
                {
                    "swarm_id": "design-system",
                    "metric_type": "tokens",
                    "dimensions": {
                        "input_tokens": 2,
                        "output_tokens": 13,
                        "cache_read_input_tokens": 17,
                        "cache_creation_input_tokens": 19,
                    },
                },
                {"story_id": "design-system", "metric_type": "human_gate_ms", "value": 1200},
                {"story_id": "design-system", "metric_type": "human_gate_ms", "value": 800},
                {"story_id": "design-system", "metric_type": "wall_clock_ms", "value": 2500},
                {"story_id": "design-system", "metric_type": "wall_clock_ms", "value": 172800000},
                {"story_id": "other-story", "metric_type": "tokens", "dimensions": {"input_tokens": 999}},
            ]
        )
        self._write_epic(
            "design-system",
            """
            stories:
              - id: s1-gate-timing-metric
                depends_on: []
              - id: s3-collector
                depends_on:
                  - s1-gate-timing-metric
              - id: s4-renderer
                depends_on:
                  - s3-collector
            """,
        )
        self._write_episode(
            "design-system",
            "s3-collector",
            "implement.yaml",
            """
            agents:
              - persona: developer
                role: implementer
                phase: implement
              - persona: developer
                role: implementer
                phase: implement
              - persona: reviewer
                role: reviewer
                phase: review
            """,
        )
        self._write_snapshot(
            "design-system-before",
            _snapshot_payload(
                "design-system-before",
                "before123",
                {"src": 1, "(root)": 1},
                ["README.md", "src/app.py"],
            ),
        )
        self._write_snapshot(
            "design-system-after",
            _snapshot_payload(
                "design-system-after",
                "after456",
                {"src": 2, "tests": 1, "(root)": 1},
                ["README.md", "src/app.py", "src/new_feature.py", "tests/test_collect.py"],
            ),
        )

        report = collect.collect_report("design-system", self.repo)

        self.assertEqual(report["deliverable"], "design-system")
        self.assertEqual(report["wall_ms_total"], 2500)
        self.assertEqual(report["human_gate_ms_total"], 2000)
        self.assertEqual(report["gate_count"], 2)
        self.assertEqual(
            report["tokens"],
            {
                "input": 13,
                "output": 20,
                "cache_read": 20,
                "cache_creation": 24,
                "total": 33,
            },
        )
        self.assertEqual(
            report["flow"],
            [
                {
                    "step": "s1-gate-timing-metric",
                    "agents": [],
                    "depends_on": [],
                },
                {
                    "step": "s3-collector",
                    "agents": [
                        {
                            "persona": "developer",
                            "role": "implementer",
                            "phase": "implement",
                        },
                        {
                            "persona": "reviewer",
                            "role": "reviewer",
                            "phase": "review",
                        },
                    ],
                    "depends_on": ["s1-gate-timing-metric"],
                },
                {
                    "step": "s4-renderer",
                    "agents": [],
                    "depends_on": ["s3-collector"],
                },
            ],
        )
        self.assertEqual(
            report["files"],
            {
                "before_sha": "before123",
                "after_sha": "after456",
                "added": ["src/new_feature.py", "tests/test_collect.py"],
                "counts": {"src": 2, "tests": 1, "(root)": 1},
            },
        )

    def test_collect_report_matches_epic_level_events_tagged_story_id_or_gate_only(self) -> None:
        # Mirrors real emitter tagging: metrics-token-capture.sh / metrics-execute-
        # boundaries.sh tag story_id=<story>, swarm_id=<epic>; the s1 gate emitter
        # (user_gate.py) tags story_id=<story> with NO swarm_id at all. Neither
        # shape has story_id or swarm_id equal to the epic id directly, so the
        # collector must fall back to the epic's story-id set.
        self._write_epic(
            "meta-meta-optimize",
            """
            stories:
              - id: s1-gate-timing-metric
                depends_on: []
              - id: s3-collector
                depends_on:
                  - s1-gate-timing-metric
            """,
        )
        self._write_events(
            [
                {
                    "story_id": "s3-collector",
                    "swarm_id": "meta-meta-optimize",
                    "metric_type": "wall_clock_ms",
                    "value": 5000,
                },
                {
                    "story_id": "s3-collector",
                    "swarm_id": "meta-meta-optimize",
                    "metric_type": "tokens",
                    "dimensions": {"input_tokens": 10, "output_tokens": 4},
                },
                {"story_id": "s1-gate-timing-metric", "metric_type": "human_gate_ms", "value": 1500},
                {"story_id": "unrelated-story", "metric_type": "wall_clock_ms", "value": 999},
            ]
        )

        report = collect.collect_report("meta-meta-optimize", self.repo)

        self.assertEqual(report["wall_ms_total"], 5000)
        self.assertEqual(report["human_gate_ms_total"], 1500)
        self.assertEqual(report["gate_count"], 1)
        self.assertEqual(report["tokens"]["input"], 10)

    def test_collect_report_degrades_to_zero_empty_and_none_when_sources_are_missing(self) -> None:
        report = collect.collect_report("missing-deliverable", self.repo)

        self.assertEqual(report["deliverable"], "missing-deliverable")
        self.assertEqual(report["wall_ms_total"], 0)
        self.assertEqual(report["human_gate_ms_total"], 0)
        self.assertEqual(report["gate_count"], 0)
        self.assertEqual(
            report["tokens"],
            {
                "input": 0,
                "output": 0,
                "cache_read": 0,
                "cache_creation": 0,
                "total": 0,
            },
        )
        self.assertEqual(report["flow"], [])
        self.assertIsNone(report["files"])

    def test_collect_report_excludes_rows_carrying_a_different_epics_swarm_id(self) -> None:
        # story_ids are short ("s1", "s2", ...) and recur across epics. A row
        # tagged with another epic's swarm_id must not be attributed here just
        # because its story_id happens to collide with one of this epic's
        # story ids.
        self._write_epic(
            "design-system",
            """
            stories:
              - id: s1
                depends_on: []
            """,
        )
        self._write_events(
            [
                {
                    "story_id": "s1",
                    "swarm_id": "other-epic",
                    "metric_type": "wall_clock_ms",
                    "value": 9999,
                },
                {"story_id": "s1", "metric_type": "wall_clock_ms", "value": 100},
            ]
        )

        report = collect.collect_report("design-system", self.repo)

        self.assertEqual(report["wall_ms_total"], 100)

    def test_collect_report_ignores_non_numeric_and_negative_metric_values(self) -> None:
        self._write_events(
            [
                {"story_id": "design-system", "metric_type": "human_gate_ms", "value": True},
                {"story_id": "design-system", "metric_type": "human_gate_ms", "value": "1200"},
                {"story_id": "design-system", "metric_type": "wall_clock_ms", "value": -10},
                {
                    "story_id": "design-system",
                    "metric_type": "tokens",
                    "dimensions": {
                        "input_tokens": 5,
                        "output_tokens": False,
                        "cache_read_input_tokens": "8",
                        "cache_creation_input_tokens": 1.5,
                    },
                },
            ]
        )

        report = collect.collect_report("design-system", self.repo)

        self.assertEqual(report["human_gate_ms_total"], 1200)
        self.assertEqual(report["gate_count"], 1)
        self.assertEqual(report["wall_ms_total"], 0)
        self.assertEqual(
            report["tokens"],
            {
                "input": 5,
                "output": 0,
                "cache_read": 0,
                "cache_creation": 1.5,
                "total": 5,
            },
        )


    def test_collect_report_rejects_traversal_deliverable(self) -> None:
        with self.assertRaises(MetricsValidationError):
            collect.collect_report("../../x", self.repo)


if __name__ == "__main__":
    unittest.main()
