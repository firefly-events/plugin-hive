"""Tests for the meta-experiment package scaffold and import surface."""

from __future__ import annotations

import unittest
from pathlib import Path

from ._loader import load_meta_experiment_module


class MetaExperimentScaffoldTests(unittest.TestCase):
    """Verify the package scaffold exists and imports from `__init__.py`."""

    def setUp(self) -> None:
        self.module_dir = Path(__file__).resolve().parent.parent
        self.readme_path = self.module_dir / "README.md"
        self.init_path = self.module_dir / "__init__.py"

    def test_module_directory_exists(self) -> None:
        self.assertTrue(self.module_dir.is_dir())

    def test_readme_exists(self) -> None:
        self.assertTrue(self.readme_path.is_file())

    def test_module_is_importable_from_init_path(self) -> None:
        module = load_meta_experiment_module()

        self.assertEqual(self.init_path.resolve(), Path(module.__file__).resolve())


if __name__ == "__main__":
    unittest.main()
