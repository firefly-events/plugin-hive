"""RunState dataclass + schema-version contract.

Schema version 1 (b-contract-derived-dag b2). v0 pinned the schema from
day one with a `migrate_v0_to_v1` stub so the migration path was a real,
callable shape before v1 landed (architect lock, §6). b2 lands the first
real v1 change: a `node_hashes` map (per-node memoization hash) plus the
`NodeStatus.REUSED` marker. `migrate_v0_to_v1` now back-fills a v0 run
state into the v1 shape (schema_version → 1, `node_hashes` → {}) so old
run states stay readable. Future schema changes carry their own step.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


SCHEMA_VERSION: int = 1


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
    # b2 memoization: a cache-hit skip. The node's resolved-input hash
    # matched the prior successful run's stored hash, so its output_graph
    # entry was reused instead of re-executed. Distinct from COMPLETED so
    # audit/replay can tell "executed this run" from "cache-hit reuse"
    # (deterministic-spine audit invariant) — a reused node is NEVER absent
    # from RunState.
    REUSED = "reused"


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
    started_at: str = ""
    last_updated_at: str = ""
    status: RunStatus = RunStatus.RUNNING
    last_successful_node_id: str | None = None
    node_statuses: dict[str, NodeStatus] = field(default_factory=dict)
    output_graph: dict[str, dict[str, Any]] = field(default_factory=dict)
    # b2 memoization (schema v1): node_id -> memo hash (resolved inputs +
    # node config + workflow/skill version). A subsequent run reuses a
    # node's output_graph entry only when its freshly computed hash equals
    # the stored one. Empty for every node that ran before b2 / with b2 off.
    node_hashes: dict[str, str] = field(default_factory=dict)
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
        "node_hashes": dict(state.node_hashes),
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
        node_hashes=dict(payload.get("node_hashes") or {}),
        failure_info=payload.get("failure_info"),
        schema_version=payload.get("schema_version", SCHEMA_VERSION),
        frozen=bool(payload.get("frozen", False)),
    )


def migrate_v0_to_v1(v0_data: dict[str, Any]) -> dict[str, Any]:
    """v0 → v1 migration (b2).

    Back-fills a v0 run state into the v1 shape: bumps ``schema_version``
    to 1 and adds an empty ``node_hashes`` map (v0 predates memoization,
    so no node has a stored hash — every node re-runs, which is the safe
    conservative default). All other fields pass through untouched, so the
    run state stays readable. Returns a NEW dict (the input is never
    mutated) and is idempotent — running it on a v1 dict leaves it at v1.
    """

    migrated = dict(v0_data)
    migrated["schema_version"] = 1
    migrated.setdefault("node_hashes", {})
    return migrated
