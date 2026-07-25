"""Worktree-per-run isolation for the DAG executor.

Public surface: a `WorktreeManager` that wraps `git worktree add/remove`
plus a `NestingDetector` that handles the meta-meta-optimize co-existence
path (Risk #5 mitigation — inner /execute reuses the outer skill's
worktree rather than nesting a new one, since git does not support
nested worktrees).
"""

from .errors import (
    IsolationError,
    NestedWorktreeError,
    WorktreeCollisionError,
    WorktreeContaminationError,
    WorktreeLifecycleError,
)
from .nesting import (
    NestingDetector,
    decide_run_worktree,
    detect_outer_worktree,
    is_meta_meta_optimize_worktree,
)
from .worktree import WorktreeManager, WorktreePreparation

__all__ = [
    "IsolationError",
    "NestedWorktreeError",
    "NestingDetector",
    "WorktreeCollisionError",
    "WorktreeContaminationError",
    "WorktreeLifecycleError",
    "WorktreeManager",
    "WorktreePreparation",
    "decide_run_worktree",
    "detect_outer_worktree",
    "is_meta_meta_optimize_worktree",
]
