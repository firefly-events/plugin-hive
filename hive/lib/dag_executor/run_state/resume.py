"""--resume <run-id> entry point.

Replays a previously-failed or interrupted executor run from the last
successful node onward. The previously-failed node re-executes FIRST
(idempotent contract per Temporal/Dagster/Prefect — handlers must be
safe to re-execute against the same inputs).

Status transition rules:
  * `COMPLETED` → `AlreadyCompletedError` (no replay of completed runs).
  * `FAILED` or `RUNNING` → load run_state, identify replay starting
    point, re-execute from there.
  * `SUSPENDED` → delegated to hde-8 pause-resume path; this story
    raises `ResumeFromInvalidStateError` if encountered (hde-8 wires
    its own resume entry).
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from .errors import AlreadyCompletedError, ResumeFromInvalidStateError
from .schema import NodeStatus, RunState, RunStatus
from .store import (
    load,
    mark_completed,
    mark_failed,
    save,
    set_last_successful_node,
    set_node_output,
    set_node_status,
    unfreeze_for_resume,
)

if TYPE_CHECKING:
    from hive.lib.dag_executor.executor.dispatcher import Dispatcher
    from hive.lib.dag_executor.executor.telemetry import Telemetry
    from hive.lib.dag_executor.executor.walker import Walker
    from hive.lib.dag_executor.graph import Graph


def _replay_starting_index(order: list[str], state: RunState) -> int:
    """Index in topo order from which replay begins.

    The previously-failed node re-executes FIRST. We do this by
    starting at the node AFTER `last_successful_node_id` (which is
    the failed/interrupted node by definition). If no successful node
    is recorded, replay restarts from the top.
    """

    if state.last_successful_node_id is None:
        return 0
    try:
        return order.index(state.last_successful_node_id) + 1
    except ValueError:
        return 0


def _validate_resumable(state: RunState) -> None:
    if state.status == RunStatus.COMPLETED:
        raise AlreadyCompletedError(
            f"run {state.run_id!r} already completed; nothing to resume"
        )
    if state.status == RunStatus.SUSPENDED:
        raise ResumeFromInvalidStateError(
            f"run {state.run_id!r} is suspended; use the pause-resume path (hde-8)"
        )


def resume_run(
    run_id: str,
    graph: "Graph",
    walker: "Walker",
    dispatcher: "Dispatcher",
    telemetry: "Telemetry",
    runs_root: Path | None = None,
    context: dict[str, Any] | None = None,
) -> RunState:
    """Replay a previously failed/interrupted run from the last checkpoint."""

    state = load(run_id, root=runs_root)
    _validate_resumable(state)
    if state.workflow_slug and graph.workflow_name != state.workflow_slug:
        raise ResumeFromInvalidStateError(
            f"run {run_id!r} belongs to workflow {state.workflow_slug!r}, "
            f"not {graph.workflow_name!r}"
        )
    state = unfreeze_for_resume(state)  # sole sanctioned freeze bypass

    # Walker drives the replay; it consults `state` for already-completed
    # nodes (skip + reuse output) vs. nodes-to-re-execute (failed node
    # re-executes first; everything topologically after it follows).
    return walker.replay(
        graph=graph,
        dispatcher=dispatcher,
        run_id=run_id,
        telemetry=telemetry,
        state=state,
        runs_root=runs_root,
        context=context or {},
    )


__all__ = [
    "AlreadyCompletedError",
    "NodeStatus",
    "ResumeFromInvalidStateError",
    "_replay_starting_index",
    "_validate_resumable",
    "mark_completed",
    "mark_failed",
    "resume_run",
    "save",
    "set_last_successful_node",
    "set_node_output",
    "set_node_status",
]
