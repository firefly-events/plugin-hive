from __future__ import annotations

import importlib.util
from pathlib import Path
import subprocess
import sys

import yaml


ROOT = Path(__file__).resolve().parents[2]
RUN_PATH = ROOT / "skills/hive/skills/meta-optimize/run.py"


def _load_module():
    module_name = "tests.meta_optimize._meta_optimize_run"
    spec = importlib.util.spec_from_file_location(module_name, RUN_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load meta-optimize run.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _load_meta_experiment():
    module_name = "tests.meta_optimize._meta_experiment"
    module_dir = ROOT / "hive/lib/meta-experiment"
    spec = importlib.util.spec_from_file_location(
        module_name,
        module_dir / "__init__.py",
        submodule_search_locations=[str(module_dir)],
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load meta-experiment package")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _write_yaml(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")


def _git(cwd: Path, *args: str) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def _init_repo(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    _git(path.parent, "init", str(path))
    _git(path, "config", "user.email", "tests@example.com")
    _git(path, "config", "user.name", "Plugin Hive Tests")
    _git(path, "checkout", "-b", "main")
    (path / "README.md").write_text("initial\n", encoding="utf-8")
    _git(path, "add", "README.md")
    _git(path, "commit", "-m", "initial commit")
