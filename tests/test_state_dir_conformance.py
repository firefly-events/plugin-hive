"""Conformance tests for the state-dir resolver contract (story sdr-1).

Iterates the shared fixture (tests/fixtures/state-dir-conformance.yaml — JSON
content, valid YAML) and asserts that:

  1. the canonical Python resolver (hive/lib/config.py resolve_state_dir)
     produces the expected path for every row, and
  2. the shell compatibility shim (hooks/common.sh _resolve_state_dir)
     produces the byte-identical output for every row.

The no-env rows double as characterization tests for the existing shell
config-read path (_read_paths_config yq/python3/awk fallback), which this
story must not change.

Run: python3 -m unittest tests.test_state_dir_conformance -v
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = ROOT / "tests" / "fixtures" / "state-dir-conformance.yaml"
CONFIG_MODULE_PATH = ROOT / "hive" / "lib" / "config.py"
COMMON_SH_PATH = ROOT / "hooks" / "common.sh"


def _load_config_module():
    """Import hive/lib/config.py by file path (it is not on sys.path)."""
    spec = importlib.util.spec_from_file_location("hive_lib_config", CONFIG_MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_fixture_rows():
    """Parse the shared conformance fixture (JSON content in a .yaml file)."""
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))["rows"]


class _RowSetup:
    """Materialize one fixture row inside a per-row canonical temp dir."""

    def __init__(self, row, test_case):
        tmp = tempfile.mkdtemp(prefix="state-dir-conformance-")
        test_case.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        self.tmp = os.path.realpath(tmp)
        self.row = row

        for rel in row.get("dirs", []):
            os.makedirs(self._sub(rel), exist_ok=True)
        for link, target in (row.get("symlinks") or {}).items():
            os.symlink(self._sub(target), self._sub(link))

        config_yaml = row.get("config_yaml")
        if config_yaml is not None:
            config_file = Path(self._sub(row["config_path"]))
            config_file.parent.mkdir(parents=True, exist_ok=True)
            config_file.write_text(self._sub(config_yaml), encoding="utf-8")

        self.cwd = self._sub(row["cwd"])
        self.expected = self._sub(row["expected"])
        # Env is taken verbatim from the row (CONFIG_FILE / HIVE_ROOT /
        # HIVE_STATE_DIR are all per-row), so the config-file location tiers
        # are actually observable.
        self.env = {
            key: self._sub(value) for key, value in (row.get("env") or {}).items()
        }

    def _sub(self, value):
        """Substitute the $TMP placeholder with this row's canonical temp dir."""
        return value.replace("$TMP", self.tmp)


class StateDirPythonConformanceTest(unittest.TestCase):
    """Canonical Python resolver matches every shared fixture row."""

    @classmethod
    def setUpClass(cls):
        cls.config = _load_config_module()
        cls.rows = _load_fixture_rows()

    def test_python_resolver_matches_fixture(self):
        for row in self.rows:
            with self.subTest(row=row["name"]):
                setup = _RowSetup(row, self)
                actual = self.config.resolve_state_dir(cwd=setup.cwd, env=setup.env)
                self.assertEqual(actual, setup.expected)


class StateDirShellConformanceTest(unittest.TestCase):
    """Shell shim (hooks/common.sh) matches every shared fixture row.

    Rows without HIVE_STATE_DIR are characterization tests for the existing
    config-read path; rows with HIVE_STATE_DIR cover the env-override guard.
    """

    @classmethod
    def setUpClass(cls):
        cls.rows = _load_fixture_rows()
        cls.config = _load_config_module()

    def _run_shell(self, setup):
        """Run _resolve_state_dir from hooks/common.sh for one materialized
        row and return its stripped stdout."""
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": os.environ.get("HOME", setup.tmp),
        }
        env.update(setup.env)
        # common.sh self-derives HIVE_ROOT from its own location at source
        # time, so "HIVE_ROOT unset" is unrepresentable through the process
        # env alone; emulate it by clearing HIVE_ROOT after sourcing whenever
        # the fixture row does not set it.
        if "HIVE_ROOT" in setup.env:
            script = 'cd "$1" && . "$2" && _resolve_state_dir'
        else:
            script = 'cd "$1" && . "$2" && HIVE_ROOT="" && _resolve_state_dir'
        result = subprocess.run(
            [
                "bash",
                "-c",
                script,
                "_",
                setup.cwd,
                str(COMMON_SH_PATH),
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(
            result.returncode,
            0,
            msg=f"shell resolver failed: stderr={result.stderr!r}",
        )
        return result.stdout.strip()

    def test_shell_resolver_matches_fixture(self):
        for row in self.rows:
            with self.subTest(row=row["name"]):
                setup = _RowSetup(row, self)
                self.assertEqual(self._run_shell(setup), setup.expected)

    def test_shell_and_python_resolve_byte_identically(self):
        for row in self.rows:
            with self.subTest(row=row["name"]):
                setup = _RowSetup(row, self)
                shell_out = self._run_shell(setup)
                python_out = self.config.resolve_state_dir(
                    cwd=setup.cwd, env=setup.env
                )
                self.assertEqual(shell_out, python_out)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
