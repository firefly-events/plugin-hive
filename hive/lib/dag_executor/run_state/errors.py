"""Typed exceptions for the run-state subsystem.

Distinct from `hive.lib.dag_executor.executor.errors` so the L3 vs L2
boundary stays clear: executor-layer errors surface during walk; run-state
errors surface during persistence and resume.
"""

from __future__ import annotations


class RunStateError(Exception):
    """Base for every run-state failure."""


class RunStateNotFoundError(RunStateError):
    """`load(run_id)` could not find run_state.yaml on disk."""


class SchemaVersionMismatchError(RunStateError):
    """Loaded run_state.yaml carries an unsupported schema_version."""


class ResumeFromInvalidStateError(RunStateError):
    """`resume_run` invoked against a state that is not resumable."""


class AlreadyCompletedError(ResumeFromInvalidStateError):
    """Resume target's status is `completed` — nothing to replay."""


class InvalidRunIdError(RunStateError):
    """`run_id` failed format validation.

    Security:plan-audit finding #5 mitigation — reject path traversal
    and any non-ULID-shaped input before composing a filesystem path.
    """


class RunStateFrozenError(RunStateError):
    """Mutation attempted on a frozen (terminal) run-state.

    Security:plan-audit finding #5 mitigation — `mark_completed` /
    `mark_failed` / `mark_suspended` flip `frozen=True`. Subsequent
    `set_*` / `mark_*` calls on the same dataclass raise this error
    rather than silently overwriting a completed run.
    """
