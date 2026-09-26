"""Per-workflow-execution run-state subsystem.

Public surface mirrors `hive.lib.meta-experiment.envelope`: a small
narrow-mutation API and a small set of typed errors. Walker integration
is opt-in via Walker.walk(..., run_state_path=...) — without that
parameter, the executor runs as in hde-2 (no persistence) and the
spine parity invariant is preserved.

`schema_version: 0` is pinned from day one. The migration path is
stubbed in `schema.migrate_v0_to_v1` so the contract exists before any
v1 schema lands.
"""

from .errors import (
    AlreadyCompletedError,
    InvalidRunIdError,
    ResumeFromInvalidStateError,
    RunStateError,
    RunStateFrozenError,
    RunStateNotFoundError,
    SchemaVersionMismatchError,
)
from .resume import resume_run
from .schema import (
    SCHEMA_VERSION,
    NodeStatus,
    RunState,
    RunStatus,
    migrate_v0_to_v1,
)
from .store import (
    create,
    find_latest_successful,
    load,
    mark_completed,
    mark_failed,
    mark_suspended,
    runs_root,
    save,
    set_last_successful_node,
    set_node_hash,
    set_node_output,
    set_node_status,
    set_status,
    unfreeze_for_resume,
    validate_run_id,
)

__all__ = [
    "AlreadyCompletedError",
    "ArchiveReport",
    "DEFAULT_THRESHOLD",
    "InvalidRunIdError",
    "NodeStatus",
    "ResumeFromInvalidStateError",
    "RunState",
    "RunStateError",
    "RunStateFrozenError",
    "RunStateNotFoundError",
    "RunStatus",
    "SCHEMA_VERSION",
    "SchemaVersionMismatchError",
    "TERMINAL_STATUSES",
    "archive_terminal_runs",
    "create",
    "default_archive_dest",
    "find_latest_successful",
    "load",
    "mark_completed",
    "mark_failed",
    "mark_suspended",
    "migrate_v0_to_v1",
    "resume_run",
    "runs_root",
    "save",
    "set_last_successful_node",
    "set_node_hash",
    "set_node_output",
    "set_node_status",
    "set_status",
    "unfreeze_for_resume",
    "validate_run_id",
]

# Archive exports are lazy: eager import would re-execute archive.py under
# `python -m hive.lib.dag_executor.run_state.archive` (the documented CLI)
# and trip runpy's "found in sys.modules" warning.
_ARCHIVE_EXPORTS = frozenset(
    {
        "ArchiveReport",
        "DEFAULT_THRESHOLD",
        "TERMINAL_STATUSES",
        "archive_terminal_runs",
        "default_archive_dest",
    }
)


def __getattr__(name: str):
    if name in _ARCHIVE_EXPORTS:
        from . import archive as _archive

        return getattr(_archive, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
