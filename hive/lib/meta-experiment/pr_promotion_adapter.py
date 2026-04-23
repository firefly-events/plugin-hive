"""Public PR-only promotion adapter for the meta-optimize Q5 decision.

The public contract in ``hive/references/meta-optimize-contract.md`` and the
Q5 promotion decision require retained changes to leave the target repository
as PR-shaped artifacts rather than direct mutations of the target branch.
"""

from __future__ import annotations

from pathlib import Path
import re
import subprocess
from typing import Any

from .direct_commit_adapter import DEFAULT_TARGET_BRANCH, DEFAULT_WORKTREES_SUBPATH, PromotionFailure
from .promotion_adapter import (
    PromotionAdapter,
    PromotionEvidence,
    PromotionResult,
    RollbackResult,
)


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


class PrPromotionAdapter(PromotionAdapter):
    """Emit PR-shaped promotion evidence without mutating the target branch.

    This adapter implements the public Q5 ``PR-only`` path described in
    ``meta-optimize-contract.md``. Successful promotion creates or updates a
    feature branch artifact and returns explicit ``pr_ref`` plus ``pr_state``
    evidence for closure rather than overloading ``commit_ref``.
    """

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
        candidate_ref = envelope["candidate_ref"]
        rollback_target = self._resolve_branch_head(target_branch)

        if self._requests_direct_mutation(envelope, decision):
            raise PromotionFailure(
                "direct mutation is unsupported by PrPromotionAdapter",
                rollback_target=rollback_target,
                notes="Q5 requires PR-style artifacts only",
            )

        if verdict == "needs_revision":
            self._remove_worktree(worktree_path, force=True)
            raise PromotionFailure(
                "needs_revision verdict — adapter does not promote",
                rollback_target=rollback_target,
                notes="worktree discarded without touching target branch",
            )

        if verdict not in {"pass", "needs_optimization"}:
            raise PromotionFailure(
                f"unsupported verdict: {verdict}",
                rollback_target=rollback_target,
            )

        self._validate_worktree_candidate(worktree_path, candidate_ref)
        pr_branch_ref = self._pr_branch_ref(experiment_id)
        pr_ref = self._pr_ref(pr_branch_ref)

        notes_parts = [f"PR artifact emitted for {target_branch}"]
        optimization_note = decision.get("optimization_note")
        if optimization_note:
            notes_parts.append(f"optimization_note: {optimization_note}")

        try:
            _git(self.repo_path, "branch", "-f", pr_branch_ref, candidate_ref)
            self._remove_worktree(worktree_path, force=False)
            return PromotionResult(
                success=True,
                evidence=PromotionEvidence(pr_ref=pr_ref, pr_state="open"),
                rollback_target=pr_branch_ref,
                notes="; ".join(notes_parts),
            )
        except subprocess.CalledProcessError as error:
            raise PromotionFailure(
                self._stderr_reason(error, "failed to emit PR artifact"),
                rollback_target=pr_branch_ref,
                notes="; ".join(notes_parts),
            ) from error

    def rollback(self, envelope: dict[str, Any], rollback_ref: str) -> RollbackResult:
        pr_branch_ref = self._resolve_pr_branch_ref(envelope)
        if not pr_branch_ref:
            return RollbackResult(
                success=False,
                revert_ref=None,
                rollback_target=None,
                notes="envelope missing pr_branch_ref/pr_ref",
            )

        if rollback_ref != pr_branch_ref:
            return RollbackResult(
                success=False,
                revert_ref=None,
                rollback_target=pr_branch_ref,
                notes=f"rollback_ref mismatch: expected {pr_branch_ref}, got {rollback_ref}",
            )

        try:
            branch_tip = _git(self.repo_path, "rev-parse", pr_branch_ref)
        except subprocess.CalledProcessError as error:
            return RollbackResult(
                success=False,
                revert_ref=None,
                rollback_target=pr_branch_ref,
                notes=self._stderr_reason(error, "unable to resolve PR branch"),
            )

        try:
            _git(self.repo_path, "branch", "-D", pr_branch_ref)
            return RollbackResult(
                success=True,
                revert_ref=branch_tip,
                rollback_target=pr_branch_ref,
                notes="deleted PR branch artifact",
            )
        except subprocess.CalledProcessError as error:
            return RollbackResult(
                success=False,
                revert_ref=None,
                rollback_target=pr_branch_ref,
                notes=self._stderr_reason(error, "failed to delete PR branch"),
            )

    def _validate_worktree_candidate(self, worktree_path: Path, candidate_ref: str) -> None:
        if not worktree_path.exists():
            raise PromotionFailure(f"worktree does not exist: {worktree_path}")

        head_ref = _git(worktree_path, "rev-parse", "HEAD")
        if head_ref != candidate_ref:
            raise PromotionFailure(
                f"worktree HEAD {head_ref} does not match candidate_ref {candidate_ref}"
            )

    def _resolve_branch_head(self, branch_name: str) -> str:
        try:
            return _git(self.repo_path, "rev-parse", branch_name)
        except subprocess.CalledProcessError as error:
            raise PromotionFailure(
                self._stderr_reason(error, f"unable to resolve target branch {branch_name}"),
                rollback_target=branch_name,
            ) from error

    def _remove_worktree(self, worktree_path: Path, *, force: bool) -> None:
        if not worktree_path.exists():
            return

        args = ["worktree", "remove"]
        if force:
            args.append("--force")
        args.append(str(worktree_path))

        try:
            _git(self.repo_path, *args)
        except subprocess.CalledProcessError:
            if not worktree_path.exists():
                return
            if not force:
                self._remove_worktree(worktree_path, force=True)
                return
            if not self._worktree_is_registered(worktree_path):
                return
            raise

    def _requests_direct_mutation(self, envelope: dict[str, Any], decision: dict[str, Any]) -> bool:
        direct_values = {"commit", "commit_ref", "direct", "direct_commit", "direct-mutation"}
        requested = [
            envelope.get("promotion_mode"),
            decision.get("promotion_mode"),
            decision.get("artifact_type"),
        ]
        return any(isinstance(value, str) and value in direct_values for value in requested)

    def _resolve_pr_branch_ref(self, envelope: dict[str, Any]) -> str | None:
        explicit_branch = envelope.get("pr_branch_ref")
        if isinstance(explicit_branch, str) and explicit_branch.strip():
            return explicit_branch

        pr_ref = envelope.get("pr_ref")
        if not isinstance(pr_ref, str) or "#" not in pr_ref:
            return None
        return pr_ref.rsplit("#", 1)[1].strip() or None

    def _pr_branch_ref(self, experiment_id: str) -> str:
        sanitized = self._sanitize_experiment_id(experiment_id)
        return f"meta-improvement/pr/{sanitized}"

    def _pr_ref(self, pr_branch_ref: str) -> str:
        owner = self.repo_path.parent.name or "local"
        repo = self.repo_path.name
        return f"pr://{owner}/{repo}#{pr_branch_ref}"

    def _stderr_reason(self, error: subprocess.CalledProcessError, fallback: str) -> str:
        stderr = (error.stderr or "").strip()
        return stderr or fallback

    def _sanitize_experiment_id(self, experiment_id: str) -> str:
        sanitized = experiment_id.replace(" ", "-")
        sanitized = "".join(ch for ch in sanitized if ch.isprintable() and ord(ch) >= 32)
        for token in ("..", "~", "^", ":", "?", "*", "[", "\\"):
            sanitized = sanitized.replace(token, "-")
        while sanitized.endswith(".lock"):
            sanitized = sanitized[: -len(".lock")]
        sanitized = re.sub(r"/+", "/", sanitized)
        sanitized = sanitized.strip("./")
        if not sanitized:
            raise ValueError("experiment_id is empty after sanitization")
        return sanitized

    def _worktree_is_registered(self, worktree_path: Path) -> bool:
        registered_path = worktree_path.resolve()
        porcelain = _git(self.repo_path, "worktree", "list", "--porcelain")
        for line in porcelain.splitlines():
            if not line.startswith("worktree "):
                continue
            listed_path = Path(line.removeprefix("worktree ").strip()).resolve()
            if listed_path == registered_path:
                return True
        return False
