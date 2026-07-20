"""Tests for the wr-2 /ship merge-shape check (hive/lib/merge_shape_check.py)."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from hive.lib.merge_shape_check import (
    MergeShapeError,
    check_epic_merge_shape,
    check_merge_shape,
)


def _git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def _init_repo(repo: Path) -> None:
    repo.mkdir(parents=True, exist_ok=True)
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test")
    (repo / "README.md").write_text("init\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-q", "-m", "chore: init")
    _git(repo, "branch", "-m", "main")


def _commit(repo: Path, message: str, filename: str) -> None:
    (repo / filename).write_text(message, encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-q", "-m", message)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    repo_root = tmp_path / "repo"
    _init_repo(repo_root)
    return repo_root


def test_proper_merge_commit_passes(repo: Path) -> None:
    _git(repo, "checkout", "-q", "-b", "develop")
    _commit(repo, "[s1-story] feat(a): first story", "a.txt")
    _commit(repo, "[s2-story] feat(b): second story", "b.txt")
    _git(repo, "checkout", "-q", "main")
    _git(repo, "merge", "-q", "--no-ff", "develop", "-m", "release: promote develop -> main")
    merge_commit = _git(repo, "rev-parse", "HEAD")

    result = check_epic_merge_shape(
        repo, "epic-1", ["s1-story", "s2-story"], merge_commit
    )

    assert result.status == "ok"
    assert result.missing_story_ids == []


def test_squash_merge_fires(repo: Path) -> None:
    _git(repo, "checkout", "-q", "-b", "develop")
    _commit(repo, "[s1-story] feat(a): first story", "a.txt")
    _commit(repo, "[s2-story] feat(b): second story", "b.txt")
    _git(repo, "checkout", "-q", "main")
    _git(repo, "merge", "-q", "--squash", "develop")
    _git(repo, "commit", "-q", "-m", "release: promote develop -> main (squashed)")
    merge_commit = _git(repo, "rev-parse", "HEAD")

    result = check_epic_merge_shape(
        repo, "epic-1", ["s1-story", "s2-story"], merge_commit
    )

    assert result.status == "squashed"
    assert "1 parent" in result.reason


def test_real_merge_missing_one_story_commit_fires(repo: Path) -> None:
    _git(repo, "checkout", "-q", "-b", "develop")
    _commit(repo, "[s1-story] feat(a): first story", "a.txt")
    _commit(repo, "chore: untagged follow-up", "b.txt")
    _git(repo, "checkout", "-q", "main")
    _git(repo, "merge", "-q", "--no-ff", "develop", "-m", "release: promote develop -> main")
    merge_commit = _git(repo, "rev-parse", "HEAD")

    result = check_epic_merge_shape(
        repo, "epic-1", ["s1-story", "s2-story"], merge_commit
    )

    assert result.status == "squashed"
    assert result.missing_story_ids == ["s2-story"]


def test_single_story_epic_is_exempt(repo: Path) -> None:
    _git(repo, "checkout", "-q", "-b", "develop")
    _commit(repo, "[s1-story] feat(a): only story", "a.txt")
    _git(repo, "checkout", "-q", "main")
    _git(repo, "merge", "-q", "--squash", "develop")
    _git(repo, "commit", "-q", "-m", "release: promote develop -> main (squashed)")
    merge_commit = _git(repo, "rev-parse", "HEAD")

    result = check_epic_merge_shape(repo, "epic-1", ["s1-story"], merge_commit)

    assert result.status == "exempt"
    assert result.reason == "single-story epic"


def test_waived_epic_is_exempt(repo: Path) -> None:
    _git(repo, "checkout", "-q", "-b", "develop")
    _commit(repo, "[s1-story] feat(a): first story", "a.txt")
    _commit(repo, "[s2-story] feat(b): second story", "b.txt")
    _git(repo, "checkout", "-q", "main")
    _git(repo, "merge", "-q", "--squash", "develop")
    _git(repo, "commit", "-q", "-m", "release: promote develop -> main (squashed)")
    merge_commit = _git(repo, "rev-parse", "HEAD")

    result = check_epic_merge_shape(
        repo, "epic-1", ["s1-story", "s2-story"], merge_commit, waived=True
    )

    assert result.status == "exempt"
    assert result.reason == "waived"


def test_check_merge_shape_raises_on_any_failure(repo: Path) -> None:
    _git(repo, "checkout", "-q", "-b", "develop")
    _commit(repo, "[s1-story] feat(a): first story", "a.txt")
    _commit(repo, "[s2-story] feat(b): second story", "b.txt")
    _git(repo, "checkout", "-q", "main")
    _git(repo, "merge", "-q", "--squash", "develop")
    _git(repo, "commit", "-q", "-m", "release: promote develop -> main (squashed)")
    merge_commit = _git(repo, "rev-parse", "HEAD")

    with pytest.raises(MergeShapeError, match="epic-1"):
        check_merge_shape(
            repo,
            [{"epic_id": "epic-1", "story_ids": ["s1-story", "s2-story"]}],
            merge_commit,
        )


def test_check_merge_shape_passes_when_all_ok_or_exempt(repo: Path) -> None:
    _git(repo, "checkout", "-q", "-b", "develop")
    _commit(repo, "[s1-story] feat(a): first story", "a.txt")
    _commit(repo, "[s2-story] feat(b): second story", "b.txt")
    _git(repo, "checkout", "-q", "main")
    _git(repo, "merge", "-q", "--no-ff", "develop", "-m", "release: promote develop -> main")
    merge_commit = _git(repo, "rev-parse", "HEAD")

    results = check_merge_shape(
        repo,
        [
            {"epic_id": "epic-1", "story_ids": ["s1-story", "s2-story"]},
            {"epic_id": "epic-2", "story_ids": ["only-one"]},
            {"epic_id": "epic-3", "story_ids": ["x", "y"], "waived": True},
        ],
        merge_commit,
    )

    assert [r.status for r in results] == ["ok", "exempt", "exempt"]
