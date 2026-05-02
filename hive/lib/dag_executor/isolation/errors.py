"""Typed exceptions for the isolation subsystem."""

from __future__ import annotations


class IsolationError(Exception):
    """Base for every isolation failure."""


class WorktreeCollisionError(IsolationError):
    """Target worktree path already exists (would clobber prior run)."""


class NestedWorktreeError(IsolationError):
    """Tried to create a nested git worktree outside the documented path.

    Git does not support nested worktrees. The single sanctioned
    nesting case is the meta-meta-optimize co-existence path, which
    reuses the outer worktree rather than creating a new one. Any
    other nested-context attempt raises this error.
    """


class WorktreeLifecycleError(IsolationError):
    """`git worktree add/remove` failed in a recoverable but reportable way."""


class WorktreeContaminationError(IsolationError):
    """Target worktree path contains a symlink before `git worktree add`.

    Security:plan-audit finding #8 mitigation — defends against an
    attacker-planted symlink under `.pHive/runs/{run_id}/` that could
    redirect filesystem writes outside the worktree. The git worktree
    itself does not jail filesystem writes; this check is a defensive
    layer on top.
    """
