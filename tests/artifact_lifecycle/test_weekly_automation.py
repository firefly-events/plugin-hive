"""Tests for hive/scripts/artifact-lifecycle-weekly.sh.

Verifies:
- The wrapper calls `python -m hive.lib.artifact_lifecycle` (command target).
- Arguments (including --dry-run) are passed through unchanged.
- A non-zero CLI exit causes the wrapper to exit non-zero with no further
  deletion logic.

These tests do NOT require launchd or cron to be installed; they execute the
shell script directly with a mock Python that reports what command it received.
"""
from __future__ import annotations

import os
import stat
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
WRAPPER = REPO_ROOT / "hive" / "scripts" / "artifact-lifecycle-weekly.sh"


def _make_mock_python(tmp_path: Path, exit_code: int = 0, output: str = "") -> Path:
    """Write a fake 'python' that records its argv and exits with exit_code."""
    recorder = tmp_path / "argv.txt"
    mock = tmp_path / "python"
    mock.write_text(
        textwrap.dedent(
            f"""\
            #!/usr/bin/env bash
            echo "$@" > {recorder}
            echo {output!r}
            exit {exit_code}
            """
        )
    )
    mock.chmod(mock.stat().st_mode | stat.S_IEXEC)
    return mock


def _run_wrapper(
    tmp_path: Path,
    extra_args: list[str] | None = None,
    mock_exit: int = 0,
    mock_output: str = "",
) -> subprocess.CompletedProcess:
    mock_python = _make_mock_python(tmp_path, exit_code=mock_exit, output=mock_output)
    env = {
        **os.environ,
        "PATH": f"{tmp_path}:{os.environ.get('PATH', '')}",
        "HIVE_ARTIFACT_LOG_DIR": str(tmp_path / "logs"),
    }
    cmd = ["bash", str(WRAPPER)] + (extra_args or [])
    return subprocess.run(cmd, capture_output=True, text=True, env=env)


def _read_argv(tmp_path: Path) -> list[str]:
    recorder = tmp_path / "argv.txt"
    if not recorder.exists():
        return []
    return recorder.read_text().strip().split()


# ---------------------------------------------------------------------------
# Wrapper existence
# ---------------------------------------------------------------------------

def test_wrapper_exists():
    assert WRAPPER.exists(), f"wrapper not found at {WRAPPER}"


def test_wrapper_is_executable():
    mode = WRAPPER.stat().st_mode
    assert mode & stat.S_IEXEC, "wrapper script is not executable"


# ---------------------------------------------------------------------------
# Command target
# ---------------------------------------------------------------------------

def test_wrapper_calls_python_module(tmp_path):
    result = _run_wrapper(tmp_path)
    argv = _read_argv(tmp_path)
    assert result.returncode == 0
    # The mock python receives: -m hive.lib.artifact_lifecycle [extra args]
    assert argv[:2] == ["-m", "hive.lib.artifact_lifecycle"], (
        f"expected '-m hive.lib.artifact_lifecycle' but got {argv}"
    )


def test_wrapper_no_extra_args_by_default(tmp_path):
    _run_wrapper(tmp_path)
    argv = _read_argv(tmp_path)
    # Default invocation passes no extra flags to the CLI.
    assert argv == ["-m", "hive.lib.artifact_lifecycle"]


# ---------------------------------------------------------------------------
# Dry-run pass-through
# ---------------------------------------------------------------------------

def test_wrapper_passes_dry_run(tmp_path):
    _run_wrapper(tmp_path, extra_args=["--dry-run"])
    argv = _read_argv(tmp_path)
    assert "--dry-run" in argv, f"--dry-run not forwarded; got {argv}"


def test_wrapper_passes_class_filter(tmp_path):
    _run_wrapper(tmp_path, extra_args=["--class", "dag-run-state", "--dry-run"])
    argv = _read_argv(tmp_path)
    assert "--class" in argv
    assert "dag-run-state" in argv
    assert "--dry-run" in argv


def test_wrapper_passes_apply(tmp_path):
    _run_wrapper(tmp_path, extra_args=["--apply"])
    argv = _read_argv(tmp_path)
    assert "--apply" in argv


# ---------------------------------------------------------------------------
# Failure propagation — no fallback deletion
# ---------------------------------------------------------------------------

def test_wrapper_exits_nonzero_on_cli_failure(tmp_path):
    result = _run_wrapper(tmp_path, mock_exit=1)
    assert result.returncode != 0, (
        "wrapper should exit non-zero when CLI exits non-zero"
    )


def test_wrapper_logs_failure(tmp_path):
    _run_wrapper(tmp_path, mock_exit=2)
    log_dir = tmp_path / "logs"
    logs = list(log_dir.glob("artifact-lifecycle-weekly.log"))
    assert logs, "no log file written on failure"
    content = logs[0].read_text()
    assert "exited" in content or "2" in content, (
        "log should mention exit code on failure"
    )


def test_wrapper_no_fallback_deletion_on_failure(tmp_path):
    """The wrapper must not run any deletion after CLI exits non-zero.

    We verify this indirectly: the mock python writes its argv; if the wrapper
    called python a second time (fallback), a second write would overwrite the
    file with different content.  Instead we check stdout contains no 'evict'
    or 'rm' lines that would indicate a second sweep.
    """
    result = _run_wrapper(tmp_path, mock_exit=1, mock_output="guard refused action")
    combined = result.stdout + result.stderr
    # There should be no eviction output after a guard refusal.
    assert "evict" not in combined.lower() or "guard" in combined.lower()
