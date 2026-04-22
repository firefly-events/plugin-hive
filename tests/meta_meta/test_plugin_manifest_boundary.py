"""Regression checks for the shipped plugin manifest boundary."""

from __future__ import annotations

import json
import unittest
from pathlib import Path


def _walk_strings(node):
    """Yield every string (key or value) in a nested dict/list tree."""
    if isinstance(node, dict):
        for key, value in node.items():
            yield key
            yield from _walk_strings(value)
    elif isinstance(node, list):
        for item in node:
            yield from _walk_strings(item)
    elif isinstance(node, str):
        yield node


def _validate_manifest(manifest_dict):
    """Assert the public manifest never leaks maintainer-only registrations."""
    for value in _walk_strings(manifest_dict):
        assert "maintainer-skills" not in value
        assert value not in {"meta-meta-optimize", "/meta-meta-optimize"}


class PluginManifestBoundaryTests(unittest.TestCase):
    """Lock the boundary between shipped skills and maintainer-only skills."""

    def setUp(self) -> None:
        self.manifest_path = Path(".claude-plugin/plugin.json")
        self.maintainer_skill_path = Path(
            "maintainer-skills/meta-meta-optimize/SKILL.md"
        )

    def test_manifest_exists_loads_and_respects_public_boundary(self) -> None:
        self.assertTrue(self.manifest_path.is_file())

        with self.manifest_path.open("r", encoding="utf-8") as handle:
            manifest = json.load(handle)

        self.assertIsInstance(manifest, dict)

        skills = manifest.get("skills")
        self.assertIsNotNone(skills)

        if isinstance(skills, str):
            self.assertEqual("./skills/", skills)

        for entry in _walk_strings(skills):
            self.assertNotIn("maintainer-skills", entry)

        _validate_manifest(manifest)

    def test_future_public_meta_optimize_registration_still_passes(self) -> None:
        manifest = {
            "name": "plugin-hive",
            "skills": ["./skills/", "./skills/meta-optimize/"],
            "hooks": {},
        }

        for entry in _walk_strings(manifest["skills"]):
            self.assertNotIn("maintainer-skills", entry)

        _validate_manifest(manifest)

    def test_validation_fails_if_manifest_leaks_maintainer_skill(self) -> None:
        leaked_manifest = {
            "name": "plugin-hive",
            "skills": ["./skills/", "./maintainer-skills/meta-meta-optimize/"],
            "public_commands": ["/meta-meta-optimize"],
        }

        with self.assertRaises(AssertionError):
            _validate_manifest(leaked_manifest)

    def test_maintainer_skill_scaffold_still_exists_on_disk(self) -> None:
        self.assertTrue(self.maintainer_skill_path.is_file())


if __name__ == "__main__":
    unittest.main()
