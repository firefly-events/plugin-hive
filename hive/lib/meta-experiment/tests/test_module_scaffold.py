from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


class MetaExperimentScaffoldTests(unittest.TestCase):
    def setUp(self) -> None:
        self.module_dir = Path("hive/lib/meta-experiment")
        self.readme_path = self.module_dir / "README.md"
        self.init_path = self.module_dir / "__init__.py"

    def test_module_directory_exists(self) -> None:
        self.assertTrue(self.module_dir.is_dir())

    def test_readme_exists(self) -> None:
        self.assertTrue(self.readme_path.is_file())

    def test_module_is_importable_from_init_path(self) -> None:
        spec = importlib.util.spec_from_file_location(
            "hive.lib.meta_experiment",
            self.init_path,
            submodule_search_locations=[str(self.module_dir)],
        )

        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)

        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)

        self.assertEqual(str(self.init_path.resolve()), module.__file__)


if __name__ == "__main__":
    unittest.main()
