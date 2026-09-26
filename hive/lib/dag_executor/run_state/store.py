"""Narrow-mutation API for `run_state.yaml`.

Mirrors `hive.lib.meta-experiment.envelope`: each mutator returns a
new RunState dataclass; the input is never mutated in place. There
is no free-form YAML rewrite path — callers go through the named
functions below or the resume entry point.

Security guarantees baked in:
  * `validate_run_id` rejects path-traversal / non-ULID-shaped inputs
    before composing any filesystem path (security:plan-audit #5).
  * Terminal mutators (`mark_completed`, `mark_failed`,
    `mark_suspended`) flip `frozen=True`; subsequent `set_*` /
    `mark_*` calls against the frozen dataclass raise
    `RunStateFrozenError` (security:plan-audit #5 freeze immutability).
  * `save` writes atomically (temp + rename) so partial writes never
    surface.
"""

from __future__ import annotations

import os
import re
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from hive.lib.config import resolve_state_dir

from .errors import (
    InvalidRunIdError,
    RunStateFrozenError,
    RunStateNotFoundError,
    SchemaVersionMismatchError,
)
from .schema import (
    SCHEMA_VERSION,
    NodeStatus,
    RunState,
    RunStatus,
    from_dict,
    migrate_v0_to_v1,
    to_dict,
)


# 26-char Crockford ULID prefix + `-` + slug ≥1 char.
# Slug constrained to filesystem-safe characters per run_id.py contract.
_RUN_ID_PATTERN = re.compile(
    r"^(?P<ulid>[0-9A-HJKMNP-TV-Z]{26})-(?P<slug>[A-Za-z0-9][A-Za-z0-9_.-]*)$"
)

def default_runs_root(cwd: Path | None = None) -> Path:
    """Resolve `<state-dir>/runs` per call via the sdr-1 resolver.

    Precedence comes from ``hive.lib.config.resolve_state_dir``:
    ``HIVE_STATE_DIR`` env > ``paths.state_dir`` in hive.config.yaml >
    default ``.pHive`` under ``cwd``. Resolution happens per call (not
    frozen at import time) so a relocated state dir takes effect without
    re-importing. Note this relocates RUN STATE only — the executor
    opt-in config (`.pHive/hive.config.yaml`) and graduation registry
    (`.pHive/runtime/executor-graduated-workflows.yaml`) are fixed policy
    locks per design-decisions Q1 and do not move with the state dir.
    """

    base = Path(cwd) if cwd is not None else Path.cwd()
    return Path(resolve_state_dir(cwd=base, env=dict(os.environ))) / "runs"


def runs_root(root: Path | None = None) -> Path:
    """Resolve the runs/ root directory; defaults to `<state-dir>/runs/`."""

    return Path(root) if root is not None else default_runs_root()


def validate_run_id(run_id: str) -> None:
    """Reject any run_id that could escape the runs/ directory.

    Path-traversal defense: a run_id matching `../../etc/passwd` would
    compose to a malicious filesystem path under runs_root(). The
    canonical run_id from `make_run_id(workflow_slug)` is
    `<26-char ULID>-<slug>`; anything else is rejected outright.
    """

    if not isinstance(run_id, str) or not run_id:
        raise InvalidRunIdError("run_id must be a non-empty string")
    if any(ch in run_id for ch in ("/", "\\", "\x00")) or ".." in run_id:
        raise InvalidRunIdError(
            f"run_id contains forbidden character/sequence: {run_id!r}"
        )
    if run_id.startswith("."):
        raise InvalidRunIdError(f"run_id may not start with '.': {run_id!r}")
    if not _RUN_ID_PATTERN.match(run_id):
        raise InvalidRunIdError(
            f"run_id does not match `<ULID>-<slug>` pattern: {run_id!r}"
        )


def _state_path(run_id: str, root: Path | None = None) -> Path:
    validate_run_id(run_id)
    return runs_root(root) / run_id / "run_state.yaml"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _check_not_frozen(state: RunState) -> None:
    if state.frozen:
        raise RunStateFrozenError(
            f"run {state.run_id!r} is frozen ({state.status.value}); no further mutations allowed"
        )


def create(run_id: str, workflow_slug: str) -> RunState:
    """Initialize a fresh RunState for `run_id`."""

    validate_run_id(run_id)
    now = _now_iso()
    return RunState(
        run_id=run_id,
        workflow_slug=workflow_slug,
        started_at=now,
        last_updated_at=now,
        status=RunStatus.RUNNING,
        last_successful_node_id=None,
        node_statuses={},
        output_graph={},
        failure_info=None,
        schema_version=SCHEMA_VERSION,
        frozen=False,
    )


def load(run_id: str, root: Path | None = None) -> RunState:
    """Read and validate `<root>/<run_id>/run_state.yaml`."""

    path = _state_path(run_id, root)
    if not path.exists():
        raise RunStateNotFoundError(f"no run_state.yaml at {path}")
    with path.open("r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle) or {}
    schema_version = payload.get("schema_version", SCHEMA_VERSION)
    # b2: transparently migrate a v0 (pre-memoization) run state up to v1 so
    # it stays readable. Unknown FUTURE versions still raise loudly.
    if schema_version == 0:
        payload = migrate_v0_to_v1(payload)
        schema_version = payload.get("schema_version", SCHEMA_VERSION)
    if schema_version != SCHEMA_VERSION:
        raise SchemaVersionMismatchError(
            f"unsupported schema_version {schema_version!r}; expected {SCHEMA_VERSION}"
        )
    return from_dict(payload)


def find_latest_successful(
    workflow_slug: str,
    root: Path | None = None,
    exclude_run_id: str | None = None,
) -> RunState | None:
    """Return the most recent COMPLETED run for ``workflow_slug`` (b2).

    Scans ``<root>/`` for run directories, loads each readable run_state
    (migrating v0→v1 transparently), and returns the COMPLETED one with
    the newest ``last_updated_at`` (ISO-8601, lexicographically ordered),
    skipping ``exclude_run_id``. Returns None when none qualifies. This is
    how the public ``run_workflow`` front door discovers the prior
    successful run to memoize against — without it b2 is inert in
    production (a fresh run has no in-hand prior state).

    Malformed/unreadable run dirs are skipped, never raised — a corrupt
    sibling run must not break a live run's memo lookup.
    """

    base = runs_root(root)
    if not base.exists():
        return None
    best: RunState | None = None
    for child in sorted(base.iterdir()):
        if not child.is_dir():
            continue
        run_id = child.name
        if exclude_run_id is not None and run_id == exclude_run_id:
            continue
        try:
            state = load(run_id, root=base)
        except Exception:
            continue
        if state.workflow_slug != workflow_slug:
            continue
        if state.status != RunStatus.COMPLETED:
            continue
        if best is None or state.last_updated_at > best.last_updated_at:
            best = state
    return best


def save(state: RunState, root: Path | None = None) -> None:
    """Atomically persist `state` to `<root>/<run_id>/run_state.yaml`."""

    path = _state_path(state.run_id, root)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = to_dict(replace(state, last_updated_at=_now_iso()))
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(payload, handle, sort_keys=False)
    os.replace(tmp, path)


def set_node_status(state: RunState, node_id: str, status: NodeStatus) -> RunState:
    _check_not_frozen(state)
    new_statuses = dict(state.node_statuses)
    new_statuses[node_id] = status
    return replace(
        state,
        node_statuses=new_statuses,
        last_updated_at=_now_iso(),
    )


def set_node_output(state: RunState, node_id: str, output: dict[str, Any]) -> RunState:
    _check_not_frozen(state)
    new_outputs = dict(state.output_graph)
    new_outputs[node_id] = dict(output)
    return replace(
        state,
        output_graph=new_outputs,
        last_updated_at=_now_iso(),
    )


def set_node_hash(state: RunState, node_id: str, node_hash: str) -> RunState:
    """Record the b2 memoization hash for ``node_id`` (schema v1).

    Returns a new RunState; the input's ``node_hashes`` map is never
    mutated in place (narrow-mutation discipline). A subsequent run reuses
    this node's output_graph entry only when its recomputed hash matches
    the value stored here.
    """

    _check_not_frozen(state)
    new_hashes = dict(state.node_hashes)
    new_hashes[node_id] = node_hash
    return replace(
        state,
        node_hashes=new_hashes,
        last_updated_at=_now_iso(),
    )


def set_last_successful_node(state: RunState, node_id: str) -> RunState:
    _check_not_frozen(state)
    return replace(
        state,
        last_successful_node_id=node_id,
        last_updated_at=_now_iso(),
    )


def mark_completed(state: RunState) -> RunState:
    _check_not_frozen(state)
    return replace(
        state,
        status=RunStatus.COMPLETED,
        frozen=True,
        last_updated_at=_now_iso(),
    )


def mark_failed(state: RunState, failure_info: dict[str, Any]) -> RunState:
    _check_not_frozen(state)
    return replace(
        state,
        status=RunStatus.FAILED,
        failure_info=dict(failure_info),
        frozen=True,
        last_updated_at=_now_iso(),
    )


def mark_suspended(state: RunState) -> RunState:
    """Used by hde-8 pause; freezes the run for external resume signal.

    Two distinct call sites:
      * Walker special-case at pause-node enter (synchronous wait
        mode): the walker uses `set_status(SUSPENDED)` instead, so the
        state stays unfrozen across the wait — resume back to RUNNING
        is in-process. This `mark_suspended` is for the cross-process
        pause path where `--resume` re-enters via `resume_run`.
      * `pause.signal.wait_for_signal` after a host restart: the
        loaded state is frozen at SUSPENDED until `unfreeze_for_resume`
        flips frozen=False inside the resume entry.
    """

    _check_not_frozen(state)
    return replace(
        state,
        status=RunStatus.SUSPENDED,
        frozen=True,
        last_updated_at=_now_iso(),
    )


def set_status(state: RunState, status: RunStatus) -> RunState:
    """Non-terminal status transition — RUNNING ↔ SUSPENDED only.

    For terminal transitions (COMPLETED / FAILED), use the dedicated
    `mark_*` functions which freeze the state. This helper exists for
    the in-process pause path where the walker brackets the pause
    dispatch with SUSPENDED → RUNNING and never freezes.
    """

    _check_not_frozen(state)
    if status not in (RunStatus.RUNNING, RunStatus.SUSPENDED):
        raise RunStateFrozenError(
            f"set_status only handles RUNNING/SUSPENDED transitions; "
            f"use mark_completed/mark_failed/mark_suspended for {status.value!r}"
        )
    return replace(state, status=status, last_updated_at=_now_iso())


def unfreeze_for_resume(state: RunState) -> RunState:
    """Explicit unfreeze gate — the ONLY sanctioned way to revive a frozen run.

    `resume_run` calls this on a loaded SUSPENDED or FAILED state
    before replaying. Documented as a sanctioned bypass of the freeze
    invariant; the freeze guarantees the on-disk state is terminal
    until an operator deliberately resumes. COMPLETED runs are
    irrevocably terminal and cannot be unfrozen — re-opening one would
    let post-completion mutation slip past the freeze guarantee.
    """

    if state.status not in (RunStatus.SUSPENDED, RunStatus.FAILED):
        raise RunStateFrozenError(
            f"cannot resume run in status {state.status.value!r}; "
            "expected suspended or failed"
        )
    return replace(state, frozen=False, last_updated_at=_now_iso())
