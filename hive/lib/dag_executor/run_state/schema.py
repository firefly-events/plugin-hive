"""RunState dataclass + schema-version contract.

Schema is pinned at version 0 from day one. The `migrate_v0_to_v1`
stub exists so the migration path is a real (callable) shape before
v1 lands — the architect lock from §6 of the architect-memo (cheap
now, impossible to retrofit). Future schema changes carry their own
migration step that wraps this stub.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


SCHEMA_VERSION: int = 0


class RunStatus(str, Enum):
    """Top-level run lifecycle states."""

    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SUSPENDED = "suspended"


class NodeStatus(str, Enum):
    """Per-node lifecycle states recorded in `RunState.node_statuses`."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    SKIPPED = "skipped"
    FAILED = "failed"


@dataclass(frozen=False)
class RunState:
    """Per-workflow-execution durable state.

    Mutations go through `store.set_*` / `store.mark_*` functions which
    return a NEW RunState; in-place mutation is intentionally NOT part
    of the public API. The `frozen` flag flips to True on
    `mark_completed` / `mark_failed` / `mark_suspended` so post-terminal
    writes raise `RunStateFrozenError` (security:plan-audit finding #5
    — `freeze()` immutability).
    """

    run_id: str
    workflow_slug: str
    started_at: str
    last_updated_at: str
    status: RunStatus = RunStatus.RUNNING
    last_successful_node_id: str | None = None
    node_statuses: dict[str, NodeStatus] = field(default_factory=dict)
    output_graph: dict[str, dict[str, Any]] = field(default_factory=dict)
    failure_info: dict[str, Any] | None = None
    schema_version: int = SCHEMA_VERSION
    frozen: bool = False


def to_dict(state: RunState) -> dict[str, Any]:
    """Serialize a RunState for YAML write."""

    return {
        "run_id": state.run_id,
        "workflow_slug": state.workflow_slug,
        "schema_version": state.schema_version,
        "started_at": state.started_at,
        "last_updated_at": state.last_updated_at,
        "status": state.status.value,
        "last_successful_node_id": state.last_successful_node_id,
        "node_statuses": {nid: s.value for nid, s in state.node_statuses.items()},
        "output_graph": dict(state.output_graph),
        "failure_info": state.failure_info,
        "frozen": state.frozen,
    }


def from_dict(payload: dict[str, Any]) -> RunState:
    """Deserialize a RunState from a YAML-loaded dict."""

    return RunState(
        run_id=payload["run_id"],
        workflow_slug=payload["workflow_slug"],
        started_at=payload["started_at"],
        last_updated_at=payload["last_updated_at"],
        status=RunStatus(payload["status"]),
        last_successful_node_id=payload.get("last_successful_node_id"),
        node_statuses={
            nid: NodeStatus(s) for nid, s in (payload.get("node_statuses") or {}).items()
        },
        output_graph=dict(payload.get("output_graph") or {}),
        failure_info=payload.get("failure_info"),
        schema_version=payload.get("schema_version", SCHEMA_VERSION),
        frozen=bool(payload.get("frozen", False)),
    )


def migrate_v0_to_v1(v0_data: dict[str, Any]) -> dict[str, Any]:
    """v0 → v1 migration shape stub.

    No v1 schema exists yet; this is a deliberate passthrough so the
    migration code path is callable before any v1 data shows up.
    Future v1 lands as a follow-up story when a real schema change
    is needed; that story replaces this stub body.
    """

    return dict(v0_data)
