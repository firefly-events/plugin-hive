"""Unit tests for harness dashboard rendering and exports."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from hive.lib.harness import render


def _populated_report() -> dict[str, object]:
    return {
        "deliverable": "design-system",
        "wall_ms_total": 90500,
        "human_gate_ms_total": 12000,
        "gate_count": 2,
        "tokens": {
            "input": 120,
            "output": 45,
            "cache_read": 8,
            "cache_creation": 4,
            "total": 165,
        },
        "flow": [
            {
                "step": "s1-kickoff",
                "depends_on": [],
                "agents": [{"persona": "planner", "role": "lead", "phase": "plan"}],
            },
            {
                "step": "s4-renderer",
                "depends_on": ["s1-kickoff"],
                "agents": [{"persona": "developer", "role": "implementer", "phase": "implement"}],
            },
        ],
        "files": {
            "before_sha": "abc1234567890",
            "after_sha": "def0987654321",
            "added": ["hive/lib/harness/render.py", "tests/test_render.py"],
            "counts": {"hive": 12, "tests": 3, "(root)": 1},
        },
    }


def _zero_state_report() -> dict[str, object]:
    return {
        "deliverable": "zero-state",
        "wall_ms_total": 0,
        "human_gate_ms_total": 0,
        "gate_count": 0,
        "tokens": {
            "input": 0,
            "output": 0,
            "cache_read": 0,
            "cache_creation": 0,
            "total": 0,
        },
        "flow": [],
        "files": None,
    }


class RenderHarnessTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory(prefix="render-tests-")
        self.addCleanup(self.tmpdir.cleanup)
        base = Path(self.tmpdir.name)
        self.repo = base / "repo"
        self.repo.mkdir()
        self.state_dir = base / "state"
        self.state_dir.mkdir()
        self.env = patch.dict(os.environ, {"HIVE_STATE_DIR": str(self.state_dir)}, clear=False)
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_render_html_emits_self_contained_dashboard_fragment_with_totals_and_mermaid_nodes(self) -> None:
        html = render.render_html(_populated_report())

        self.assertIn("<style>", html)
        self.assertNotIn("http://", html)
        self.assertNotIn("https://", html)
        self.assertNotIn("<html", html)
        self.assertNotIn("<head", html)
        self.assertIn("design-system", html)
        self.assertIn("1m 30s", html)
        self.assertIn("12s", html)
        self.assertIn(">165<", html)
        self.assertIn("s1-kickoff", html)
        self.assertIn("s4-renderer", html)
        self.assertIn("planner", html)
        self.assertIn("developer", html)
        self.assertIn("graph TD", html)
        self.assertIn("s1-kickoff[&quot;s1-kickoff (planner)&quot;]", html)
        self.assertIn(
            "s4-renderer[&quot;s4-renderer (developer)&quot;]",
            html,
        )

    def test_render_writes_html_and_exports_with_expected_numbers_and_mermaid_content(self) -> None:
        report = _populated_report()
        out_html = self.repo / "dashboard.html"

        result = render.render(report, self.repo, out_html)

        expected_dir = self.state_dir / "harness" / "exports" / "design-system"
        self.assertEqual(out_html.read_text(encoding="utf-8"), result["html"])
        self.assertEqual(result["exports"]["flow"].resolve(), (expected_dir / "flow.mermaid.md").resolve())
        self.assertEqual(
            result["exports"]["file_tree"].resolve(),
            (expected_dir / "file-tree.mermaid.md").resolve(),
        )
        self.assertEqual(result["exports"]["stats"].resolve(), (expected_dir / "stats.md").resolve())

        flow_md = result["exports"]["flow"].read_text(encoding="utf-8")
        tree_md = result["exports"]["file_tree"].read_text(encoding="utf-8")
        stats_md = result["exports"]["stats"].read_text(encoding="utf-8")

        self.assertIn("graph TD", flow_md)
        self.assertIn('s1-kickoff["s1-kickoff (planner)"]', flow_md)
        self.assertIn('s4-renderer["s4-renderer (developer)"]', flow_md)
        self.assertIn("s1-kickoff --> s4-renderer", flow_md)
        self.assertIn("graph LR", tree_md)
        self.assertIn('hive["hive: 12 files"]', tree_md)
        self.assertIn('tests["tests: 3 files"]', tree_md)
        self.assertIn("- wall time: 1m 30s", stats_md)
        self.assertIn("- human gate time: 12s (2 gates)", stats_md)
        self.assertIn("- tokens: total 165 (input 120, output 45, cache_read 8, cache_creation 4)", stats_md)

    def test_render_html_is_artifact_body_fragment_and_matches_report_numbers(self) -> None:
        html = render.render_html(_populated_report())

        self.assertTrue(html.lstrip().startswith("<style>"))
        self.assertIn('<div class="harness-dashboard">', html)
        self.assertIn(">1m 30s<", html)
        self.assertIn(">12s<", html)
        self.assertIn(">165<", html)
        self.assertIn("2 gates", html)
        self.assertIn("in 120 / out 45", html)

    def test_render_zero_state_renders_without_none_nan_or_blank_stat_cards(self) -> None:
        result = render.render(_zero_state_report(), self.repo)
        html = result["html"]
        stats_md = result["exports"]["stats"].read_text(encoding="utf-8")
        flow_md = result["exports"]["flow"].read_text(encoding="utf-8")
        tree_md = result["exports"]["file_tree"].read_text(encoding="utf-8")

        self.assertIn(">0s<", html)
        self.assertIn(">0<", html)
        self.assertIn("0 gates", html)
        self.assertIn("No steps yet.", html)
        self.assertIn("No snapshot pair captured yet.", html)
        self.assertNotIn("None", html)
        self.assertNotIn("NaN", html)
        self.assertIn('EMPTY["no steps yet"]', flow_md)
        self.assertIn('EMPTY["no snapshot pair captured yet"]', tree_md)
        self.assertIn("- wall time: 0s", stats_md)
        self.assertIn("- human gate time: 0s (0 gates)", stats_md)
        self.assertIn("- tokens: total 0 (input 0, output 0, cache_read 0, cache_creation 0)", stats_md)


if __name__ == "__main__":
    unittest.main()
