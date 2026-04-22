"""Shared loader for the dashed meta-experiment package path."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def load_meta_experiment_module():
    """Load the meta-experiment package from its on-disk dashed directory."""
    module_dir = Path(__file__).resolve().parent.parent
    init_path = module_dir / "__init__.py"
    spec = importlib.util.spec_from_file_location(
        "hive.lib.meta_experiment",
        init_path,
        submodule_search_locations=[str(module_dir)],
    )
    if spec is None or spec.loader is None:
        raise AssertionError("failed to build import spec for meta-experiment package")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module
