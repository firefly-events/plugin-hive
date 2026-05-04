"""NestingDetector — meta-meta-optimize co-existence policy."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from hive.lib.dag_executor.isolation import (
    decide_run_worktree,
    detect_outer_worktree,
    is_meta_meta_optimize_worktree,
)


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        check=True,
        capture_output=True,
        text=True,
    )


@pytest.fixture
def tmp_repo(tmp_path: Path) -> Path:
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "config", "user.email", "test@example.com")
    _git(tmp_path, "config", "user.name", "Test")
    (tmp_path / "README.md").write_text("seed\n")
    _git(tmp_path, "add", "README.md")
    _git(tmp_path, "commit", "-q", "-m", "init")
    return tmp_path


def test_detect_outer_worktree_returns_none_at_repo_root(tmp_repo: Path):
    assert detect_outer_worktree(tmp_repo) is None


def test_detect_outer_worktree_returns_path_inside_a_worktree(tmp_repo: Path):
    cycle_path = tmp_repo / ".pHive" / "meta-team" / "worktrees" / "cycle-X"
    cycle_path.parent.mkdir(parents=True, exist_ok=True)
    _git(tmp_repo, "worktree", "add", "--detach", str(cycle_path))
    detected = detect_outer_worktree(cycle_path)
    assert detected is not None
    assert detected.resolve() == cycle_path.resolve()


def test_is_meta_meta_optimize_worktree_recognises_path(tmp_repo: Path):
    cycle = tmp_repo / ".pHive" / "meta-team" / "worktrees" / "cycle-Y"
    cycle.mkdir(parents=True)
    assert is_meta_meta_optimize_worktree(cycle, repo_root=tmp_repo) is True


def test_is_meta_meta_optimize_worktree_rejects_other_paths(tmp_repo: Path):
    other = tmp_repo / ".pHive" / "runs" / "01-spine"
    other.mkdir(parents=True)
    assert is_meta_meta_optimize_worktree(other, repo_root=tmp_repo) is False


def test_decide_run_worktree_fresh_returns_owned_by_us(tmp_repo: Path):
    decision = decide_run_worktree(
        run_id="01ARZ3NDEKTSV4RRFFQ69G5FAV-spine",
        repo_path=tmp_repo,
    )
    assert decision.owned_by_us is True
    assert decision.reused_outer is False
    assert decision.path == tmp_repo / ".pHive" / "runs" / "01ARZ3NDEKTSV4RRFFQ69G5FAV-spine"


def test_decide_run_worktree_inside_meta_meta_reuses_outer(tmp_repo: Path):
    cycle = tmp_repo / ".pHive" / "meta-team" / "worktrees" / "cycle-Z"
    cycle.parent.mkdir(parents=True, exist_ok=True)
    _git(tmp_repo, "worktree", "add", "--detach", str(cycle))
    decision = decide_run_worktree(
        run_id="01ARZ3NDEKTSV4RRFFQ69G5FAV-spine",
        repo_path=cycle,
    )
    assert decision.owned_by_us is False
    assert decision.reused_outer is True
    assert decision.path.resolve() == cycle.resolve()


def test_decide_run_worktree_inside_unsanctioned_worktree_creates_fresh(tmp_repo: Path):
    """An outer worktree that is NOT meta-meta-optimize → still create fresh.

    Behavior: only the documented co-existence path reuses; everything
    else gets its own `.pHive/runs/` worktree (the WorktreeManager will
    raise NestedWorktreeError when git rejects the nested add — that
    surface is exercised in test_worktree.py's collision case).
    """

    other = tmp_repo / "out-of-band"
    _git(tmp_repo, "worktree", "add", "--detach", str(other))
    decision = decide_run_worktree(
        run_id="01ARZ3NDEKTSV4RRFFQ69G5FAV-spine",
        repo_path=other,
    )
    assert decision.owned_by_us is True
    assert decision.reused_outer is False
