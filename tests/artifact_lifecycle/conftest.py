"""Shared fixtures for artifact lifecycle tests (al-8)."""

from __future__ import annotations

import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml


# Frozen reference clock used across all guard/sweep tests.
_NOW = datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
_OLD_TS = (_NOW - timedelta(days=100)).timestamp()  # 100 days ago — beyond any threshold


@pytest.fixture
def now() -> datetime:
    """Frozen reference clock for deterministic age calculations."""
    return _NOW


@pytest.fixture
def state_dir(tmp_path: Path) -> Path:
    """Isolated state directory (analogous to .pHive)."""
    sd = tmp_path / "state"
    sd.mkdir()
    return sd


@pytest.fixture
def git_repo(tmp_path: Path) -> Path:
    """Minimal git repo with committed history for tracked-age tests."""
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", str(repo)], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(repo), "config", "user.email", "test@hive.test"],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "-C", str(repo), "config", "user.name", "Hive Test"],
        check=True,
        capture_output=True,
    )
    return repo


def backdate(path: Path, ts: float | None = None) -> None:
    """Set mtime/atime on *path* to *ts* (defaults to 100 days ago)."""
    t = ts if ts is not None else _OLD_TS
    os.utime(path, (t, t))


def write_run_state(run_dir: Path, status: str, age_ts: float | None = None) -> None:
    """Create a DAG run directory with run_state.yaml and optional mtime backdating."""
    run_dir.mkdir(parents=True, exist_ok=True)
    state_file = run_dir / "run_state.yaml"
    state_file.write_text(yaml.dump({"run_id": run_dir.name, "status": status, "schema_version": 0}))
    if age_ts is not None:
        backdate(state_file, age_ts)
        backdate(run_dir, age_ts)


def git_commit_at(repo: Path, path: Path, commit_ts: float, message: str = "test") -> None:
    """Stage *path* and create a commit dated at *commit_ts* (Unix epoch)."""
    date_str = f"@{int(commit_ts)} +0000"
    env = {
        **os.environ,
        "GIT_AUTHOR_DATE": date_str,
        "GIT_COMMITTER_DATE": date_str,
    }
    subprocess.run(["git", "-C", str(repo), "add", str(path)], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(repo), "commit", "-m", message],
        check=True,
        capture_output=True,
        env=env,
    )
