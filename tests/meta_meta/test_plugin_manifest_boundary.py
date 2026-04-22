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
    """Assert the public manifest never leaks maintainer-only registrations.

    Raises AssertionError when:
    - Any string value contains the substring "maintainer-skills"
    - Any string value equals "meta-meta-optimize" or "/meta-meta-optimize"
    - Any string value describes a path that resolves to a meta-meta-optimize
      skill entry — i.e., after stripping leading "./" and trailing "/", the
      basename is "meta-meta-optimize" and the value looks path-shaped.
    """
    for value in _walk_strings(manifest_dict):
        if "maintainer-skills" in value:
            raise AssertionError(f"maintainer-skills leaked in manifest: {value!r}")

        if value in {"meta-meta-optimize", "/meta-meta-optimize"}:
            raise AssertionError(
                f"public manifest contains meta-meta-optimize registration: {value!r}"
            )

        normalized = value.strip()
        if normalized.startswith("./"):
            normalized = normalized[2:]
        normalized = normalized.rstrip("/")
        if ("/" in value or value.endswith("/")) and normalized.endswith(
            "meta-meta-optimize"
        ):
            raise AssertionError(
                "public manifest contains meta-meta-optimize "
                f"path-like registration: {value!r}"
            )


class PluginManifestBoundaryTests(unittest.TestCase):
    """Lock the boundary between shipped skills and maintainer-only skills."""

    def setUp(self) -> None:
        self.manifest_path = Path(".claude-plugin/plugin.json")
        self.maintainer_skill_path = Path(
            "maintainer-skills/meta-meta-optimize/SKILL.md"
        )

    def test_manifest_exists_loads_and_respects_public_boundary(self) -> None:
        """Real manifest exists, parses as JSON, and passes the boundary validator."""
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
        """Public meta-optimize skill paths remain valid manifest entries."""
        manifest = {
            "name": "plugin-hive",
            "skills": ["./skills/", "./skills/meta-optimize/"],
            "hooks": {},
        }

        for entry in _walk_strings(manifest["skills"]):
            self.assertNotIn("maintainer-skills", entry)

        _validate_manifest(manifest)

    def test_validation_fails_if_manifest_leaks_maintainer_skill(self) -> None:
        """Maintainer-only skill paths or commands fail manifest validation."""
        leaked_manifest = {
            "name": "plugin-hive",
            "skills": ["./skills/", "./maintainer-skills/meta-meta-optimize/"],
            "public_commands": ["/meta-meta-optimize"],
        }

        with self.assertRaises(AssertionError):
            _validate_manifest(leaked_manifest)

    def test_validation_fails_on_path_like_meta_meta_optimize_registration(self) -> None:
        """Path-like meta-meta-optimize registrations are rejected."""
        for leaked_value in [
            "./skills/meta-meta-optimize/",
            "skills/meta-meta-optimize",
            "/skills/meta-meta-optimize/",
        ]:
            with self.subTest(leaked_value=leaked_value):
                with self.assertRaises(AssertionError):
                    _validate_manifest({"skills": [leaked_value]})

    def test_validation_allows_legitimate_meta_optimize_registration(self) -> None:
        """Public meta-optimize paths continue to pass validation."""
        _validate_manifest({"skills": ["./skills/", "./skills/meta-optimize/"]})

    def test_maintainer_skill_scaffold_still_exists_on_disk(self) -> None:
        """Maintainer-only skill scaffold still exists in the repo."""
        self.assertTrue(self.maintainer_skill_path.is_file())


if __name__ == "__main__":
    unittest.main()
