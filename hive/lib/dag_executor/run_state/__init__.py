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
    load,
    mark_completed,
    mark_failed,
    mark_suspended,
    runs_root,
    save,
    set_last_successful_node,
    set_node_output,
    set_node_status,
    validate_run_id,
)

__all__ = [
    "AlreadyCompletedError",
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
    "create",
    "load",
    "mark_completed",
    "mark_failed",
    "mark_suspended",
    "migrate_v0_to_v1",
    "resume_run",
    "runs_root",
    "save",
    "set_last_successful_node",
    "set_node_output",
    "set_node_status",
    "validate_run_id",
]
