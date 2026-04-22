"""Maintainer-local promotion adapter that promotes via direct commits."""

from __future__ import annotations

from pathlib import Path
import subprocess
from typing import Any

from .promotion_adapter import (
    PromotionAdapter,
    PromotionEvidence,
    PromotionResult,
    RollbackResult,
)

DEFAULT_TARGET_BRANCH = "main"
DEFAULT_WORKTREES_SUBPATH = ".pHive/meta-team/worktrees"


class PromotionFailure(Exception):
    """Raised when a promotion attempt fails after enforcing cleanup."""

    def __init__(
        self,
        reason: str,
        *,
        rollback_target: str | None = None,
        notes: str = "",
    ) -> None:
        super().__init__(reason)
        self.rollback_target = rollback_target
        self.notes = notes
        self.reason = reason


def _git(cwd: Path, *args: str) -> str:
    """Run a git command and return stripped stdout."""

    completed = subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


class DirectCommitAdapter(PromotionAdapter):
    """Promote a worktree tip into the live repo via direct commit."""

    def __init__(self, repo_path: Path | str, worktrees_root: Path | str | None = None) -> None:
        self.repo_path = Path(repo_path)
        self.worktrees_root = (
            Path(worktrees_root)
            if worktrees_root is not None
            else self.repo_path / DEFAULT_WORKTREES_SUBPATH
        )

    def promote(self, envelope: dict[str, Any], decision: dict[str, Any]) -> PromotionResult:
        verdict = decision["verdict"]
        experiment_id = envelope["experiment_id"]
        target_branch = envelope.get("target_branch", DEFAULT_TARGET_BRANCH)
        worktree_path = Path(envelope.get("worktree_path") or (self.worktrees_root / experiment_id))

        if verdict == "needs_revision":
            self._remove_worktree(worktree_path, force=True)
            raise PromotionFailure(
                "needs_revision verdict — adapter does not promote",
                notes="worktree discarded without touching main tree",
            )

        if verdict not in {"pass", "needs_optimization"}:
            raise PromotionFailure(f"unsupported verdict: {verdict}")

        candidate_ref = envelope["candidate_ref"]
        self._validate_worktree_candidate(worktree_path, candidate_ref)
        self._checkout_branch(target_branch)
        # Capture rollback_target BEFORE mutating main so failure cleanup can restore main.
        rollback_target = _git(self.repo_path, "rev-parse", "HEAD")

        notes_parts: list[str] = []
        optimization_note = decision.get("optimization_note")
        if optimization_note:
            notes_parts.append(f"optimization_note: {optimization_note}")

        try:
            try:
                _git(self.repo_path, "merge", "--ff-only", candidate_ref)
                notes_parts.insert(0, "promoted via fast-forward merge")
            except subprocess.CalledProcessError as merge_error:
                notes_parts.append(self._stderr_note(merge_error, prefix="ff-only merge failed"))
                self._abort_git_op("merge")
                self._reset_head(rollback_target)
                raise PromotionFailure(
                    self._stderr_reason(merge_error, "ff-only merge failed"),
                    rollback_target=rollback_target,
                    notes="; ".join(notes_parts),
                ) from merge_error

            commit_ref = _git(self.repo_path, "rev-parse", "HEAD")
            self._remove_worktree(worktree_path, force=False)
            return PromotionResult(
                success=True,
                evidence=PromotionEvidence(commit_ref=commit_ref),
                rollback_target=rollback_target,
                notes="; ".join(notes_parts),
            )
        except PromotionFailure:
            raise
        except subprocess.CalledProcessError as error:
            self._abort_git_op("merge")
            self._reset_head(rollback_target)
            raise PromotionFailure(
                self._stderr_reason(error, "promotion failed"),
                rollback_target=rollback_target,
                notes="; ".join(notes_parts),
            ) from error

    def rollback(self, envelope: dict[str, Any], rollback_ref: str) -> RollbackResult:
        target_branch = envelope.get("target_branch", DEFAULT_TARGET_BRANCH)
        commit_to_revert = envelope.get("commit_ref")
        if not commit_to_revert:
            return RollbackResult(
                success=False,
                revert_ref=None,
                notes="envelope missing commit_ref",
            )
        self._checkout_branch(target_branch)

        try:
            parent_ref = _git(self.repo_path, "rev-parse", f"{commit_to_revert}^")
        except subprocess.CalledProcessError as error:
            return RollbackResult(
                success=False,
                revert_ref=None,
                notes=self._stderr_reason(error, "unable to resolve promoted commit parent"),
            )

        if parent_ref != rollback_ref:
            return RollbackResult(
                success=False,
                revert_ref=None,
                notes=f"rollback_ref mismatch: expected {parent_ref}, got {rollback_ref}",
            )

        actual_head = _git(self.repo_path, "rev-parse", "HEAD")
        if actual_head != commit_to_revert:
            return RollbackResult(
                success=False,
                revert_ref=None,
                notes=f"rollback target advanced: expected {commit_to_revert}, got {actual_head}",
            )

        try:
            _git(self.repo_path, "revert", "--no-edit", commit_to_revert)
            revert_ref = _git(self.repo_path, "rev-parse", "HEAD")
            return RollbackResult(
                success=True,
                revert_ref=revert_ref,
                notes="reverted via git revert",
            )
        except subprocess.CalledProcessError as error:
            self._abort_git_op("revert")
            return RollbackResult(
                success=False,
                revert_ref=None,
                notes=self._stderr_reason(error, "git revert failed"),
            )

    def _validate_worktree_candidate(self, worktree_path: Path, candidate_ref: str) -> None:
        if not worktree_path.exists():
            raise PromotionFailure(f"worktree does not exist: {worktree_path}")

        head_ref = _git(worktree_path, "rev-parse", "HEAD")
        if head_ref != candidate_ref:
            raise PromotionFailure(
                f"worktree HEAD {head_ref} does not match candidate_ref {candidate_ref}"
            )

    def _checkout_branch(self, target_branch: str) -> None:
        _git(self.repo_path, "checkout", target_branch)

    def _remove_worktree(self, worktree_path: Path, *, force: bool) -> None:
        if not worktree_path.exists():
            return

        args = ["worktree", "remove"]
        if force:
            args.append("--force")
        args.append(str(worktree_path))

        try:
            _git(self.repo_path, *args)
        except subprocess.CalledProcessError as error:
            if not worktree_path.exists():
                return
            if not force:
                self._remove_worktree(worktree_path, force=True)
                return
            stderr = (error.stderr or "").lower()
            if "does not exist" in stderr or "not found" in stderr or "not a working tree" in stderr:
                return
            raise

    def _abort_git_op(self, op_name: str) -> None:
        try:
            _git(self.repo_path, op_name, "--abort")
        except subprocess.CalledProcessError:
            return

    def _reset_head(self, target_ref: str) -> None:
        _git(self.repo_path, "reset", "--hard", target_ref)

    def _stderr_note(self, error: subprocess.CalledProcessError, *, prefix: str) -> str:
        detail = self._stderr_reason(error, prefix)
        if detail == prefix:
            return detail
        return f"{prefix}: {detail}"

    def _stderr_reason(self, error: subprocess.CalledProcessError, fallback: str) -> str:
        stderr = (error.stderr or "").strip()
        return stderr or fallback
