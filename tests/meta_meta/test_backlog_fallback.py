"""Dry-run checks for the meta-team backlog fallback step."""

from __future__ import annotations

import unittest
from pathlib import Path

import yaml


class BacklogFallbackDryRunTests(unittest.TestCase):
    """Verify the fallback step and scaffold stay dry-run only in S8."""

    def setUp(self) -> None:
        self.step_path = Path(
            "hive/workflows/steps/meta-team-cycle/step-03b-backlog-fallback.md"
        )
        self.skill_path = Path("maintainer-skills/meta-meta-optimize/SKILL.md")
        self.backlog_path = Path(".pHive/meta-team/queue-meta-meta-optimize.yaml")
        self.step_text = self.step_path.read_text(encoding="utf-8")
        self.skill_text = self.skill_path.read_text(encoding="utf-8")

    def test_step_file_exists(self) -> None:
        """Step 3b markdown exists on disk."""
        self.assertTrue(self.step_path.is_file())

    def test_mandatory_rules_lock_dry_run_behavior(self) -> None:
        """Mandatory rules keep the fallback branch dry-run and ordered."""
        mandatory_section = self._section_body(
            self.step_text,
            "## MANDATORY EXECUTION RULES (READ FIRST)",
            "## EXECUTION PROTOCOLS",
        )

        self.assertIn("non-destructive", mandatory_section)
        self.assertIn("dry-run only", mandatory_section)
        self.assertIn("human-edited only", mandatory_section)
        self.assertIn("no priority scoring", mandatory_section)
        self.assertIn("Do NOT mutate backlog files", mandatory_section)

    def test_skill_references_backlog_fallback_step(self) -> None:
        """Maintainer skill documentation points to the fallback step file."""
        self.assertIn("step-03b-backlog-fallback.md", self.skill_text)

    def test_backlog_parses_and_has_pending_candidate(self) -> None:
        """Backlog fixture parses and still exposes at least one pending entry."""
        backlog = self._load_yaml(self.backlog_path)
        candidates = backlog.get("candidates", [])

        self.assertIsInstance(candidates, list)
        self.assertTrue(any(entry.get("status") == "pending" for entry in candidates))

    def test_dry_run_harness_selects_first_pending_without_mutation(self) -> None:
        """Dry-run report selects the first pending entry without mutating inputs."""
        before_mtimes = {
            path: path.stat().st_mtime_ns
            for path in (self.step_path, self.skill_path, self.backlog_path)
        }

        backlog = self._load_yaml(self.backlog_path)
        report = self._build_dry_run_report(backlog)

        self.assertEqual(
            [
                "id",
                "target",
                "type",
                "description",
                "safety_notes",
                "decision",
            ],
            list(report.keys()),
        )

        for field in (
            "id",
            "target",
            "type",
            "description",
            "safety_notes",
            "decision",
        ):
            self.assertIn(field, report)

        candidates = backlog.get("candidates", [])
        first_pending = next(
            (entry for entry in candidates if entry.get("status") == "pending"),
            None,
        )

        self.assertIsNotNone(first_pending)
        self.assertEqual(first_pending.get("id"), report["id"])
        self.assertEqual(first_pending.get("target"), report["target"])
        self.assertEqual(first_pending.get("type"), report["type"])
        self.assertEqual(first_pending.get("description"), report["description"])
        self.assertEqual(first_pending.get("safety_notes"), report["safety_notes"])
        self.assertEqual("would-execute", report["decision"])

        after_mtimes = {
            path: path.stat().st_mtime_ns
            for path in (self.step_path, self.skill_path, self.backlog_path)
        }
        self.assertEqual(before_mtimes, after_mtimes)

    def _build_dry_run_report(self, backlog: dict[str, object]) -> dict[str, object]:
        candidates = backlog.get("candidates", [])
        first_pending = next(
            (
                entry
                for entry in candidates
                if isinstance(entry, dict) and entry.get("status") == "pending"
            ),
            None,
        )

        if first_pending is None:
            return {
                "id": None,
                "target": None,
                "type": None,
                "description": None,
                "safety_notes": None,
                "decision": "no-fallback-available",
            }

        return {
            "id": first_pending.get("id"),
            "target": first_pending.get("target"),
            "type": first_pending.get("type"),
            "description": first_pending.get("description"),
            "safety_notes": first_pending.get("safety_notes"),
            "decision": "would-execute",
        }

    def _load_yaml(self, path: Path) -> dict[str, object]:
        with path.open("r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle)

        self.assertIsInstance(data, dict)
        return data

    def _section_body(self, text: str, start_header: str, end_header: str) -> str:
        start = text.index(start_header) + len(start_header)
        end = text.index(end_header, start)
        return text[start:end]


if __name__ == "__main__":
    unittest.main()
