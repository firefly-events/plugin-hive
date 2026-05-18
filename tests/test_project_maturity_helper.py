"""Tests for hive/lib/project_maturity.py — covers the 4 acceptance criteria
from story ed-1-maturity-helper.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import importlib.util


def _load_helper():
    spec = importlib.util.spec_from_file_location(
        "project_maturity_helper",
        ROOT / "hive" / "lib" / "project_maturity.py",
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ProjectMaturityResolveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.helper = _load_helper()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.profile_path = Path(self.temp_dir.name) / "project-profile.yaml"

    # AC1
    def test_returns_explicit_maturity_value(self) -> None:
        self.profile_path.write_text(
            "name: demo\nproject_maturity: established\n",
            encoding="utf-8",
        )
        self.assertEqual(
            self.helper.resolve_maturity(self.profile_path),
            "established",
        )

    # AC2
    def test_placeholder_profile_returns_early_default(self) -> None:
        self.profile_path.write_text(
            "name: demo\nplaceholder: true\n",
            encoding="utf-8",
        )
        self.assertEqual(
            self.helper.resolve_maturity(self.profile_path),
            "early",
        )

    # AC3
    def test_missing_profile_returns_early_with_warning(self) -> None:
        missing_path = Path(self.temp_dir.name) / "does-not-exist.yaml"
        with self.assertLogs("project_maturity_helper", level="WARNING") as cm:
            result = self.helper.resolve_maturity(missing_path)
        self.assertEqual(result, "early")
        self.assertTrue(
            any("not found" in msg for msg in cm.output),
            f"expected a 'not found' warning, got {cm.output!r}",
        )

    # AC4
    def test_invalid_value_raises_value_error_naming_allowed_set(self) -> None:
        self.profile_path.write_text(
            "name: demo\nproject_maturity: ancient\n",
            encoding="utf-8",
        )
        with self.assertRaises(ValueError) as cm:
            self.helper.resolve_maturity(self.profile_path)
        msg = str(cm.exception)
        for allowed in ("greenfield", "early", "established", "mature"):
            self.assertIn(allowed, msg)

    # Edge: field missing entirely (no placeholder marker) — should also default
    def test_missing_field_defaults_to_early(self) -> None:
        self.profile_path.write_text("name: demo\n", encoding="utf-8")
        self.assertEqual(
            self.helper.resolve_maturity(self.profile_path),
            "early",
        )

    def test_all_allowed_values_round_trip(self) -> None:
        for value in ("greenfield", "early", "established", "mature"):
            self.profile_path.write_text(
                f"name: demo\nproject_maturity: {value}\n",
                encoding="utf-8",
            )
            self.assertEqual(
                self.helper.resolve_maturity(self.profile_path),
                value,
            )


if __name__ == "__main__":
    unittest.main()
