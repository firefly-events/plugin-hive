"""Integration tests for the maintainer-local direct commit promotion adapter."""

from __future__ import annotations

import inspect
import subprocess
import sys
from pathlib import Path

import pytest

TEST_HELPERS_DIR = Path(__file__).resolve().parents[2] / "hive/lib/meta-experiment/tests"
if str(TEST_HELPERS_DIR) not in sys.path:
    sys.path.insert(0, str(TEST_HELPERS_DIR))

from _loader import load_meta_experiment_module


META_EXPERIMENT = load_meta_experiment_module()
DIRECT_COMMIT_MODULE = sys.modules["hive.lib.meta_experiment.direct_commit_adapter"]
DirectCommitAdapter = META_EXPERIMENT.DirectCommitAdapter
PromotionAdapter = META_EXPERIMENT.PromotionAdapter
PromotionEvidence = META_EXPERIMENT.PromotionEvidence
PromotionFailure = META_EXPERIMENT.PromotionFailure


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


def test_promote_success_fast_forward(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    _init_repo(repo)
    worktree = repo / ".pHive/meta-team/worktrees/exp-fast-forward"
    candidate_ref = _make_worktree_candidate(
        repo,
        worktree,
        "exp-fast-forward",
        "feature.txt",
        "fast-forward content\n",
    )
    pre_promotion = _git(repo, "rev-parse", "HEAD")

    adapter = DirectCommitAdapter(repo)
    result = adapter.promote(
        {
            "experiment_id": "exp-fast-forward",
            "candidate_ref": candidate_ref,
            "target_branch": "main",
        },
        {"verdict": "pass"},
    )

    assert result.success is True
    assert result.evidence.commit_ref == candidate_ref
    assert result.evidence.pr_ref is None
    assert result.rollback_target == pre_promotion
    assert _git(repo, "rev-parse", "HEAD") == candidate_ref
    assert not worktree.exists()


def test_promote_ff_only_failure_preserves_worktree_and_main(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    _init_repo(repo)
    worktree = repo / ".pHive/meta-team/worktrees/exp-cherry-pick"
    candidate_ref = _make_worktree_candidate(
        repo,
        worktree,
        "exp-cherry-pick",
        "feature.txt",
        "candidate content\n",
    )
    (repo / "main-only.txt").write_text("main divergence\n")
    _git(repo, "add", "main-only.txt")
    _git(repo, "commit", "-m", "main divergence")
    divergent_head = _git(repo, "rev-parse", "HEAD")

    adapter = DirectCommitAdapter(repo)
    with pytest.raises(PromotionFailure) as exc_info:
        adapter.promote(
            {
                "experiment_id": "exp-cherry-pick",
                "candidate_ref": candidate_ref,
                "target_branch": "main",
            },
            {"verdict": "needs_optimization", "optimization_note": "clean up naming"},
    )

    failure = exc_info.value
    assert failure.rollback_target == divergent_head
    assert "optimization_note: clean up naming" in (failure.notes or "")
    assert "ff-only merge failed" in (failure.notes or "")
    assert "fast-forward" in failure.reason.lower()
    assert _git(repo, "rev-parse", "HEAD") == divergent_head
    assert not (repo / "feature.txt").exists()
    assert worktree.exists()


def test_promote_conflict_preserves_worktree_and_main(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    _init_repo(repo)
    base_file = repo / "conflict.txt"
    base_file.write_text("base\n")
    _git(repo, "add", "conflict.txt")
    _git(repo, "commit", "-m", "add conflict file")
    worktree = repo / ".pHive/meta-team/worktrees/exp-conflict"
    candidate_ref = _make_worktree_candidate(
        repo,
        worktree,
        "exp-conflict",
        "conflict.txt",
        "candidate change\n",
    )
    (repo / "conflict.txt").write_text("main change\n")
    _git(repo, "add", "conflict.txt")
    _git(repo, "commit", "-m", "main conflict change")
    main_head = _git(repo, "rev-parse", "HEAD")

    adapter = DirectCommitAdapter(repo)
    with pytest.raises(PromotionFailure) as exc_info:
        adapter.promote(
            {
                "experiment_id": "exp-conflict",
                "candidate_ref": candidate_ref,
                "target_branch": "main",
            },
            {"verdict": "pass"},
        )

    failure = exc_info.value
    assert failure.rollback_target == main_head
    assert _git(repo, "rev-parse", "HEAD") == main_head
    assert (repo / "conflict.txt").read_text() == "main change\n"
    assert worktree.exists()


def test_promote_needs_revision_rejects_and_removes_worktree(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    _init_repo(repo)
    worktree = repo / ".pHive/meta-team/worktrees/exp-needs-revision"
    candidate_ref = _make_worktree_candidate(
        repo,
        worktree,
        "exp-needs-revision",
        "revision.txt",
        "candidate\n",
    )
    main_head = _git(repo, "rev-parse", "HEAD")

    adapter = DirectCommitAdapter(repo)
    with pytest.raises(PromotionFailure) as exc_info:
        adapter.promote(
            {
                "experiment_id": "exp-needs-revision",
                "candidate_ref": candidate_ref,
                "target_branch": "main",
            },
            {"verdict": "needs_revision"},
        )

    assert "needs_revision verdict" in exc_info.value.reason
    assert _git(repo, "rev-parse", "HEAD") == main_head
    assert not worktree.exists()


def test_rollback_success(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    _init_repo(repo)
    worktree = repo / ".pHive/meta-team/worktrees/exp-rollback"
    candidate_ref = _make_worktree_candidate(
        repo,
        worktree,
        "exp-rollback",
        "rollback.txt",
        "ship me\n",
    )

    adapter = DirectCommitAdapter(repo)
    promotion = adapter.promote(
        {
            "experiment_id": "exp-rollback",
            "candidate_ref": candidate_ref,
            "target_branch": "main",
        },
        {"verdict": "pass"},
    )

    rollback = adapter.rollback(
        {"commit_ref": promotion.evidence.commit_ref, "target_branch": "main"},
        promotion.rollback_target,
    )

    assert rollback.success is True
    assert rollback.revert_ref == _git(repo, "rev-parse", "HEAD")
    assert rollback.revert_ref != promotion.evidence.commit_ref


def test_rollback_refuses_after_follow_up_commit_and_keeps_repo_clean(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    _init_repo(repo)
    conflict_file = repo / "conflict.txt"
    conflict_file.write_text("base\n")
    _git(repo, "add", "conflict.txt")
    _git(repo, "commit", "-m", "add conflict base")
    worktree = repo / ".pHive/meta-team/worktrees/exp-rollback-conflict"
    candidate_ref = _make_worktree_candidate(
        repo,
        worktree,
        "exp-rollback-conflict",
        "conflict.txt",
        "promoted change\n",
    )

    adapter = DirectCommitAdapter(repo)
    promotion = adapter.promote(
        {
            "experiment_id": "exp-rollback-conflict",
            "candidate_ref": candidate_ref,
            "target_branch": "main",
        },
        {"verdict": "pass"},
    )

    conflict_file.write_text("follow-up change\n")
    _git(repo, "add", "conflict.txt")
    _git(repo, "commit", "-m", "follow-up conflict")
    follow_up_head = _git(repo, "rev-parse", "HEAD")

    rollback = adapter.rollback(
        {"commit_ref": promotion.evidence.commit_ref, "target_branch": "main"},
        promotion.rollback_target,
    )

    assert rollback.success is False
    assert rollback.revert_ref is None
    assert rollback.notes == (
        f"rollback target advanced: expected {promotion.evidence.commit_ref}, got {follow_up_head}"
    )
    assert _git(repo, "rev-parse", "HEAD") == follow_up_head
    assert _git(repo, "status", "--porcelain") == ""


def test_rollback_refuses_when_target_branch_advanced(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    _init_repo(repo)
    worktree = repo / ".pHive/meta-team/worktrees/exp-rollback-advanced"
    candidate_ref = _make_worktree_candidate(
        repo,
        worktree,
        "exp-rollback-advanced",
        "rollback.txt",
        "ship me\n",
    )

    adapter = DirectCommitAdapter(repo)
    promotion = adapter.promote(
        {
            "experiment_id": "exp-rollback-advanced",
            "candidate_ref": candidate_ref,
            "target_branch": "main",
        },
        {"verdict": "pass"},
    )

    (repo / "follow-up.txt").write_text("advanced branch\n")
    _git(repo, "add", "follow-up.txt")
    _git(repo, "commit", "-m", "advance main")
    advanced_head = _git(repo, "rev-parse", "HEAD")

    rollback = adapter.rollback(
        {"commit_ref": promotion.evidence.commit_ref, "target_branch": "main"},
        promotion.rollback_target,
    )

    assert rollback.success is False
    assert rollback.revert_ref is None
    assert rollback.notes == (
        f"rollback target advanced: expected {promotion.evidence.commit_ref}, got {advanced_head}"
    )
    assert _git(repo, "rev-parse", "HEAD") == advanced_head


def test_rollback_raises_when_commit_ref_missing_from_envelope(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    _init_repo(repo)
    main_head = _git(repo, "rev-parse", "HEAD")

    adapter = DirectCommitAdapter(repo)
    rollback = adapter.rollback({"target_branch": "main"}, main_head)

    assert rollback.success is False
    assert rollback.revert_ref is None
    assert rollback.notes == "envelope missing commit_ref"
    assert _git(repo, "rev-parse", "HEAD") == main_head


def test_rollback_reports_failure_when_commit_is_not_reachable(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    _init_repo(repo)
    main_head = _git(repo, "rev-parse", "HEAD")

    adapter = DirectCommitAdapter(repo)
    rollback = adapter.rollback(
        {
            "commit_ref": "0000000000000000000000000000000000000000",
            "target_branch": "main",
        },
        main_head,
    )

    assert rollback.success is False
    assert rollback.revert_ref is None
    assert "unknown" in (rollback.notes or "").lower() or "unreachable" in (
        rollback.notes or ""
    ).lower()
    assert _git(repo, "rev-parse", "HEAD") == main_head


def test_interface_conformance(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    _init_repo(repo)
    worktree = repo / ".pHive/meta-team/worktrees/exp-interface"
    candidate_ref = _make_worktree_candidate(
        repo,
        worktree,
        "exp-interface",
        "interface.txt",
        "adapter contract\n",
    )

    adapter = DirectCommitAdapter(repo)
    assert isinstance(adapter, PromotionAdapter)
    assert inspect.isabstract(DirectCommitAdapter) is False

    result = adapter.promote(
        {
            "experiment_id": "exp-interface",
            "candidate_ref": candidate_ref,
            "target_branch": "main",
        },
        {"verdict": "pass"},
    )

    assert bool(result.evidence.commit_ref) is True
    assert bool(result.evidence.pr_ref) is False


def test_promotion_evidence_enforces_xor() -> None:
    with pytest.raises(ValueError):
        PromotionEvidence()

    with pytest.raises(ValueError):
        PromotionEvidence(commit_ref="abc123", pr_ref="42")

    evidence = PromotionEvidence(commit_ref="abc123")
    assert evidence.commit_ref == "abc123"
    assert evidence.pr_ref is None


def test_remove_worktree_is_idempotent_when_path_disappears(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    _init_repo(repo)
    worktree = repo / ".pHive/meta-team/worktrees/exp-gone"
    worktree.mkdir(parents=True)

    adapter = DirectCommitAdapter(repo)

    def fake_git(cwd: Path, *args: str) -> str:
        assert cwd == repo
        assert args == ("worktree", "remove", "--force", str(worktree))
        worktree.rmdir()
        raise subprocess.CalledProcessError(1, ["git", *args], stderr="fatal: working tree does not exist")

    monkeypatch.setattr(DIRECT_COMMIT_MODULE, "_git", fake_git)

    adapter._remove_worktree(worktree, force=True)

    assert not worktree.exists()
