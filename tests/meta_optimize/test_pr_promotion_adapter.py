"""Integration tests for the public PR-artifact promotion adapter."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

TEST_HELPERS_DIR = Path(__file__).resolve().parents[2] / "hive/lib/meta-experiment/tests"
if str(TEST_HELPERS_DIR) not in sys.path:
    sys.path.insert(0, str(TEST_HELPERS_DIR))

from _loader import load_meta_experiment_module


META_EXPERIMENT = load_meta_experiment_module()
PrPromotionAdapter = META_EXPERIMENT.PrPromotionAdapter
PromotionAdapter = META_EXPERIMENT.PromotionAdapter
PromotionFailure = META_EXPERIMENT.PromotionFailure
MissingEvidenceError = META_EXPERIMENT.MissingEvidenceError
validate_closable = META_EXPERIMENT.validate_closable


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
    path.parent.mkdir(parents=True, exist_ok=True)
    _git(path.parent, "init", str(path))
    _git(path, "config", "user.email", "tests@example.com")
    _git(path, "config", "user.name", "Plugin Hive Tests")
    _git(path, "checkout", "-b", "main")
    (path / "README.md").write_text("initial\n")
    _git(path, "add", "README.md")
    _git(path, "commit", "-m", "initial commit")


def _make_worktree_candidate(
    main_repo: Path,
    worktree_path: Path,
    experiment_id: str,
    change_file: str,
    change_content: str,
) -> str:
    branch_name = f"exp/{experiment_id}"
    _git(main_repo, "branch", branch_name, "main")
    _git(main_repo, "worktree", "add", str(worktree_path), branch_name)
    target = worktree_path / change_file
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(change_content)
    _git(worktree_path, "add", change_file)
    _git(worktree_path, "commit", "-m", f"candidate {experiment_id}")
    return _git(worktree_path, "rev-parse", "HEAD")


def test_promote_returns_pr_shaped_evidence_without_commit_ref(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    _init_repo(repo)
    worktree = repo / ".pHive/meta-team/worktrees/exp-pr-success"
    candidate_ref = _make_worktree_candidate(
        repo,
        worktree,
        "exp-pr-success",
        "feature.txt",
        "PR artifact content\n",
    )
    main_head = _git(repo, "rev-parse", "main")

    adapter = PrPromotionAdapter(repo)
    result = adapter.promote(
        {
            "experiment_id": "exp-pr-success",
            "candidate_ref": candidate_ref,
            "target_branch": "main",
        },
        {"verdict": "pass"},
    )

    assert result.success is True
    assert result.evidence.commit_ref is None
    assert result.evidence.pr_ref == f"pr://{repo.parent.name}/{repo.name}#meta-improvement/pr/exp-pr-success"
    assert result.evidence.pr_state == "open"
    assert result.rollback_target == "meta-improvement/pr/exp-pr-success"
    assert _git(repo, "rev-parse", "main") == main_head
    assert _git(repo, "rev-parse", result.rollback_target) == candidate_ref
    assert not worktree.exists()


def test_rollback_preserves_explicit_pr_branch_target_info(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    _init_repo(repo)
    worktree = repo / ".pHive/meta-team/worktrees/exp-pr-rollback"
    candidate_ref = _make_worktree_candidate(
        repo,
        worktree,
        "exp-pr-rollback",
        "rollback.txt",
        "remove PR branch\n",
    )

    adapter = PrPromotionAdapter(repo)
    promotion = adapter.promote(
        {
            "experiment_id": "exp-pr-rollback",
            "candidate_ref": candidate_ref,
            "target_branch": "main",
        },
        {"verdict": "pass"},
    )

    rollback = adapter.rollback(
        {
            "pr_ref": promotion.evidence.pr_ref,
            "pr_branch_ref": promotion.rollback_target,
        },
        promotion.rollback_target,
    )

    assert rollback.success is True
    assert rollback.rollback_target == promotion.rollback_target
    assert rollback.revert_ref == candidate_ref
    with pytest.raises(subprocess.CalledProcessError):
        _git(repo, "rev-parse", promotion.rollback_target)


def test_pr_adapter_satisfies_shared_promotion_adapter_contract(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    _init_repo(repo)

    adapter = PrPromotionAdapter(repo)

    assert isinstance(adapter, PromotionAdapter)
    assert callable(adapter.promote)
    assert callable(adapter.rollback)


@pytest.mark.parametrize(
    ("experiment_id", "expected_branch"),
    [
        ("exp with space", "meta-improvement/pr/exp-with-space"),
        ("exp..dots", "meta-improvement/pr/exp-dots"),
        ("exp.lock", "meta-improvement/pr/exp"),
        ("exp~tilde", "meta-improvement/pr/exp-tilde"),
    ],
)
def test_pr_branch_ref_sanitizes_invalid_git_ref_sequences(
    tmp_path: Path,
    experiment_id: str,
    expected_branch: str,
) -> None:
    repo = tmp_path / "repo"
    _init_repo(repo)

    adapter = PrPromotionAdapter(repo)

    assert adapter._pr_branch_ref(experiment_id) == expected_branch


def test_pr_branch_ref_rejects_empty_after_sanitization(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    _init_repo(repo)

    adapter = PrPromotionAdapter(repo)

    with pytest.raises(ValueError, match="empty after sanitization"):
        adapter._pr_branch_ref(".lock")


def test_direct_mutation_request_raises_instead_of_falling_back(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    _init_repo(repo)
    worktree = repo / ".pHive/meta-team/worktrees/exp-pr-no-fallback"
    candidate_ref = _make_worktree_candidate(
        repo,
        worktree,
        "exp-pr-no-fallback",
        "no-fallback.txt",
        "do not merge directly\n",
    )
    main_head = _git(repo, "rev-parse", "main")

    adapter = PrPromotionAdapter(repo)
    with pytest.raises(PromotionFailure) as exc_info:
        adapter.promote(
            {
                "experiment_id": "exp-pr-no-fallback",
                "candidate_ref": candidate_ref,
                "target_branch": "main",
            },
            {"verdict": "pass", "artifact_type": "direct_commit"},
        )

    failure = exc_info.value
    assert failure.rollback_target == main_head
    assert "PR-style artifacts only" in (failure.notes or "")
    assert _git(repo, "rev-parse", "main") == main_head
    with pytest.raises(subprocess.CalledProcessError):
        _git(repo, "rev-parse", "meta-improvement/pr/exp-pr-no-fallback")


def test_closure_validator_accepts_pr_adapter_output_and_rejects_incomplete_record(
    tmp_path: Path,
) -> None:
    repo = tmp_path / "repo"
    _init_repo(repo)
    worktree = repo / ".pHive/meta-team/worktrees/exp-pr-close"
    candidate_ref = _make_worktree_candidate(
        repo,
        worktree,
        "exp-pr-close",
        "closure.txt",
        "closure proof\n",
    )

    adapter = PrPromotionAdapter(repo)
    promotion = adapter.promote(
        {
            "experiment_id": "exp-pr-close",
            "candidate_ref": candidate_ref,
            "target_branch": "main",
        },
        {"verdict": "needs_optimization", "optimization_note": "rename a helper later"},
    )

    close_record = {
        "experiment_id": "exp-pr-close",
        "decision": "accept",
        "pr_ref": promotion.evidence.pr_ref,
        "pr_state": promotion.evidence.pr_state,
        "rollback_ref": promotion.rollback_target,
        "metrics_snapshot": {"tokens": 42, "latency_ms": 7},
    }

    assert validate_closable(close_record) is None

    incomplete_record = dict(close_record)
    del incomplete_record["pr_state"]
    with pytest.raises(MissingEvidenceError):
        validate_closable(incomplete_record)
