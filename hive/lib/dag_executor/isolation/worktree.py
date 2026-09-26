"""WorktreeManager — `git worktree add/remove` lifecycle.

Reuses the same shell idiom as `hive/lib/meta-experiment/direct_commit_adapter.py`:
direct subprocess invocations against `git worktree`. We do NOT
reimplement the ff-only-merge / HEAD-verification primitives that
DirectCommitAdapter owns — the adapter handles promotion; this module
handles the lifecycle of an isolated worktree.

Security boundary (security:plan-audit finding #8):
The git worktree boundary isolates BRANCH STATE, not filesystem writes.
A handler that calls `os.chdir` or opens an absolute path escapes the
worktree the moment it does so. This module refuses attacker-planted
symlinks in the destination path and audits every tracked symlink in
the pinned commit's tree (not just those under `.claude/`) against the
future worktree root. Audit and materialization share one pinned
commit OID. Beyond those barriers, the trust boundary is documented in
`cycle-state-schema.md` and enforced by handler review.
"""

from __future__ import annotations

import subprocess
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from pathlib import PurePosixPath
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


@dataclass(frozen=True)
class WorktreePreparation:
    """Immutable result of the pre-load worktree security barrier."""

    commit_oid: str
    requested_ref: str


def _pin_commit(repo_path: Path, treeish: str) -> str:
    """Resolve ``treeish`` once so audit and checkout share one immutable OID."""

    result = subprocess.run(
        [
            "git",
            "rev-parse",
            "--verify",
            "--end-of-options",
            f"{treeish}^{{commit}}",
        ],
        cwd=str(repo_path),
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise WorktreeLifecycleError(
            "cannot pin worktree source before security audit: "
            f"git rev-parse {treeish} failed in {repo_path}: "
            f"{result.stderr.strip()}"
        )
    return result.stdout.strip()


def _git_tree_symlinks(
    repo_path: Path,
    commit_oid: str,
) -> dict[PurePosixPath, str]:
    """Return tracked symlinks in ``commit_oid`` as path -> target.

    Read the committed tree that ``git worktree add`` will materialize rather
    than the caller's filesystem. That keeps the audit effective for dangling
    links and for links whose working-tree representation has been modified.
    """

    result = subprocess.run(
        ["git", "ls-tree", "-rz", "--full-tree", commit_oid],
        cwd=str(repo_path),
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace").strip()
        raise WorktreeLifecycleError(
            f"cannot audit tracked symlinks before worktree creation: "
            f"git ls-tree {commit_oid} failed in {repo_path}: {stderr}"
        )

    links: dict[PurePosixPath, str] = {}
    for record in result.stdout.split(b"\0"):
        if not record:
            continue
        metadata, raw_path = record.split(b"\t", 1)
        mode, _object_type, object_id = metadata.split(b" ", 2)
        if mode != b"120000":
            continue
        blob = subprocess.run(
            ["git", "cat-file", "blob", object_id.decode("ascii")],
            cwd=str(repo_path),
            capture_output=True,
            check=False,
        )
        if blob.returncode != 0:
            stderr = blob.stderr.decode("utf-8", errors="replace").strip()
            raise WorktreeLifecycleError(
                f"cannot audit tracked symlink "
                f"{raw_path.decode('utf-8', errors='replace')!r}: {stderr}"
            )
        path = PurePosixPath(raw_path.decode("utf-8", errors="surrogateescape"))
        target = blob.stdout.decode("utf-8", errors="surrogateescape")
        links[path] = target
    return links


# Cap on total symlink-chain hops resolved per audited source. A well-formed
# tree never needs anywhere close to this many chained links; a self-growing
# chain (e.g. `.claude/a -> a/a`, which appends a component to `pending` on
# every hop and therefore never repeats a `(current, pending)` state) would
# otherwise spin the cycle guard forever. Bounding total expansions turns that
# unbounded loop into a bounded one and lets us fail CLOSED instead of hanging.
_MAX_SYMLINK_EXPANSIONS = 40


def _target_escapes_future_worktree(
    source: PurePosixPath,
    target: str,
    links: dict[PurePosixPath, str],
) -> bool:
    """Resolve one symlink with POSIX component semantics in a virtual worktree.

    The virtual root represents the future worktree root. Every component is
    consumed in order, and a tracked symlink is expanded as soon as its path is
    reached, before a later suffix (including ``..``) is processed.

    Total symlink expansions are capped at ``_MAX_SYMLINK_EXPANSIONS``. A
    chain that keeps growing (rather than repeating a prior state and hitting
    the cycle guard below) is treated as an escape once the cap is exceeded —
    fail closed, never spin indefinitely.
    """

    target_path = PurePosixPath(target)
    if target_path.is_absolute():
        # An absolute link is interpreted against the host filesystem root,
        # never against the future worktree root. This includes absolute links
        # back into the source repository.
        return True

    resolved = list(source.parent.parts)
    pending = deque(target_path.parts)
    expanded: set[tuple[PurePosixPath, tuple[str, ...]]] = set()
    expansions = 0

    while pending:
        component = pending.popleft()
        if component in ("", "."):
            continue
        if component == "..":
            if not resolved:
                return True
            resolved.pop()
            continue

        resolved.append(component)
        current = PurePosixPath(*resolved)
        chained_target = links.get(current)
        if chained_target is None:
            continue

        expansions += 1
        if expansions > _MAX_SYMLINK_EXPANSIONS:
            # Fail closed: an unbounded / self-growing chain never proves
            # containment, so treat it as an escape rather than spin forever.
            return True

        state = (current, tuple(pending))
        if state in expanded:
            # A symlink cycle never reaches an external target. It may be
            # unusable at runtime, but it does not violate this containment
            # contract.
            return False
        expanded.add(state)
        resolved.pop()

        chained_path = PurePosixPath(chained_target)
        if chained_path.is_absolute():
            return True
        pending.extendleft(reversed(chained_path.parts))

    return False


def _audit_tracked_symlinks(repo_path: Path, commit_oid: str) -> None:
    """Reject any tracked symlink escaping the future worktree.

    Resolution is performed from pinned git tree data, not ``Path.resolve()``.
    Consequently relative, absolute, chained, and dangling symlinks are handled
    deterministically even when the checkout differs from the committed tree.
    Internal dangling links and other internal links remain allowed.

    Scope covers every tracked symlink in the pinned commit's tree, not just
    those under ``.claude/`` — a tracked symlink anywhere (``hooks/``,
    ``scripts/``, elsewhere) that resolves outside the future worktree root is
    exactly as capable of redirecting a handler's filesystem writes as one
    under ``.claude/`` would be. ``links`` (from ``_git_tree_symlinks``) is
    already tree-wide, so widening the audited set costs nothing extra.
    """

    repo_root = repo_path.resolve(strict=True)
    links = _git_tree_symlinks(repo_root, commit_oid)

    for source_relative, initial_target in links.items():
        if _target_escapes_future_worktree(
            source_relative,
            initial_target,
            links,
        ):
            raise WorktreeContaminationError(
                "security precondition failed: tracked symlink "
                f"escapes future worktree: {source_relative} -> "
                f"{initial_target} (commit {commit_oid})"
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

    def preflight(self, branch: str | None = None) -> WorktreePreparation:
        """Pin and audit the exact commit intended for worktree materialization."""

        requested_ref = branch or "HEAD"
        commit_oid = _pin_commit(self.repo_path, requested_ref)
        _audit_tracked_symlinks(self.repo_path, commit_oid)
        return WorktreePreparation(
            commit_oid=commit_oid,
            requested_ref=requested_ref,
        )

    def create(
        self,
        run_id: str,
        branch: str | None = None,
        preparation: WorktreePreparation | None = None,
    ) -> Path:
        """Create a fresh worktree at `<runs_root>/{run_id}/`."""

        prepared = preparation or self.preflight(branch)
        if branch is not None and prepared.requested_ref != branch:
            raise WorktreeLifecycleError(
                "worktree preparation ref mismatch: "
                f"prepared {prepared.requested_ref}, requested {branch}"
            )
        # Defend direct callers and forged/stale preparation objects too. The
        # second audit is cheap and remains pinned to the same immutable OID.
        _audit_tracked_symlinks(self.repo_path, prepared.commit_oid)

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

        # Materialize the exact audited object, never the mutable branch/ref.
        args = [
            "worktree",
            "add",
            "--detach",
            str(target),
            prepared.commit_oid,
        ]
        _git(self.repo_path, *args)
        actual_oid = _git(target, "rev-parse", "HEAD")
        if actual_oid != prepared.commit_oid:
            raise WorktreeLifecycleError(
                "created worktree commit differs from audited commit: "
                f"expected {prepared.commit_oid}, found {actual_oid}"
            )
        if self.telemetry is not None:
            self.telemetry.emit(
                "worktree_created",
                run_id,
                {
                    "path": str(target),
                    "branch": branch,
                    "commit_oid": prepared.commit_oid,
                },
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
