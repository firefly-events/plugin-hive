"""WorktreeManager — `git worktree add/remove` lifecycle.

Reuses the same shell idiom as `hive/lib/meta-experiment/direct_commit_adapter.py`:
direct subprocess invocations against `git worktree`. We do NOT
reimplement the ff-only-merge / HEAD-verification primitives that
DirectCommitAdapter owns — the adapter handles promotion; this module
handles the lifecycle of an isolated worktree.

Security boundary (security:plan-audit finding #8):
The git worktree boundary isolates BRANCH STATE, not filesystem writes.
A handler that calls `os.chdir` or opens an absolute path escapes the
worktree the moment it does so. The defensive layer this module
provides is `_check_no_symlink_contamination` — refuse to proceed if
the target path is a symlink (e.g., attacker-planted). Beyond that, the
trust boundary is documented in `cycle-state-schema.md` and enforced
by handler review.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import TYPE_CHECKING

from hive.lib.dag_executor.run_state.store import default_runs_root

from .errors import (
    NestedWorktreeError,
    WorktreeCollisionError,
    WorktreeContaminationError,
    WorktreeLifecycleError,
)

if TYPE_CHECKING:
    from hive.lib.dag_executor.executor.telemetry import Telemetry


_NESTED_WORKTREE_HINTS = (
    "is already a working tree",
    "is already registered",
    "is already checked out",
    "missing but locked",
    "already exists",
)


def _git(repo_path: Path, *args: str) -> str:
    """Run `git` in `repo_path` and return stdout (raises on non-zero).

    Distinguishes nested-worktree failures (`NestedWorktreeError`) from
    generic lifecycle failures so the caller can decide whether the
    error is structural or operational.
    """

    result = subprocess.run(
        ["git", *args],
        cwd=str(repo_path),
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        stderr = result.stderr.strip()
        is_worktree_add = len(args) >= 2 and args[0] == "worktree" and args[1] == "add"
        if is_worktree_add and any(hint in stderr for hint in _NESTED_WORKTREE_HINTS):
            raise NestedWorktreeError(
                f"nested worktree rejected by git: {stderr}. Use the "
                "meta-meta-optimize co-existence path (NestingDetector) "
                "instead of attempting nested `git worktree add`."
            )
        raise WorktreeLifecycleError(
            f"git {' '.join(args)} failed in {repo_path}: {stderr}"
        )
    return result.stdout.strip()


def _check_no_symlink_contamination(path: Path) -> None:
    """Refuse to proceed if `path` is a symlink (attacker-planted).

    `git worktree add` would happily follow such a symlink and write
    inside the redirected target. Defensive layer per security finding.
    """

    if path.is_symlink():
        raise WorktreeContaminationError(
            f"refusing to use symlinked worktree path: {path} -> {path.readlink()}"
        )


class WorktreeManager:
    """Create / cleanup / preserve worktrees at `<runs_root>/{run_id}/`."""

    def __init__(
        self,
        repo_path: Path | str,
        runs_root: Path | str | None = None,
        telemetry: "Telemetry | None" = None,
    ) -> None:
        self.repo_path = Path(repo_path)
        # Default resolves via the sdr-1 resolver anchored at the repo the
        # manager isolates for, so worktrees follow a relocated state dir.
        self.runs_root = (
            Path(runs_root)
            if runs_root is not None
            else default_runs_root(cwd=self.repo_path)
        )
        self.telemetry = telemetry

    def _path_for(self, run_id: str) -> Path:
        return (self.repo_path / self.runs_root / run_id).resolve(strict=False) \
            if not (self.runs_root.is_absolute()) else (self.runs_root / run_id)

    def create(self, run_id: str, branch: str | None = None) -> Path:
        """Create a fresh worktree at `<runs_root>/{run_id}/`."""

        target = self._path_for(run_id)
        if target.exists():
            raise WorktreeCollisionError(
                f"worktree path already exists: {target} (clobbering prior run not allowed)"
            )
        # Parent must exist for git worktree add. Check EVERY existing
        # ancestor: mkdir(parents=True) would traverse a symlinked
        # intermediate component before the parent-only check fires.
        # target.parents iterates immediate parent → root.
        parent = target.parent
        for ancestor in target.parents:
            if ancestor.exists():
                _check_no_symlink_contamination(ancestor)
        if not parent.exists():
            parent.mkdir(parents=True, exist_ok=True)

        args = ["worktree", "add", "--detach", str(target)]
        if branch is not None:
            args = ["worktree", "add", str(target), branch]
        _git(self.repo_path, *args)
        if self.telemetry is not None:
            self.telemetry.emit(
                "worktree_created",
                run_id,
                {"path": str(target), "branch": branch},
            )
        return target

    def cleanup_success(self, run_id: str) -> None:
        """Remove the worktree on successful run completion. Idempotent."""

        target = self._path_for(run_id)
        if not target.exists():
            return
        _git(self.repo_path, "worktree", "remove", "--force", str(target))
        if self.telemetry is not None:
            self.telemetry.emit(
                "worktree_cleanup_success",
                run_id,
                {"path": str(target)},
            )

    def preserve_on_failure(self, run_id: str) -> Path:
        """Leave the worktree dir for post-mortem investigation.

        Returns the preserved path. Emits a telemetry event so the
        operator knows where to look. Manual cleanup later via
        `git worktree prune` once the issue is resolved.
        """

        target = self._path_for(run_id)
        if self.telemetry is not None:
            self.telemetry.emit(
                "worktree_preserved_on_failure",
                run_id,
                {
                    "path": str(target),
                    "operator_action": "investigate then `git worktree prune`",
                },
            )
        return target
