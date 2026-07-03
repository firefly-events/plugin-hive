"""Telemetry shim for the DAG executor.

This module wraps the metrics substrate but does NOT call
`hive.lib.metrics.core.append_event`. `append_event` enforces a tight
metrics-experiment schema (`metric_type` ∈ {tokens, wall_clock_ms,
fix_loop_iterations, first_attempt_pass, human_escalation}, plus
`story_id` xor `proposal_id`) that is not call-compatible with the
executor's per-node event taxonomy (`node_started`, `node_completed`,
`tool_gating_overridden`, ...). Forcing executor events through that
validator would either pollute the metrics catalog with non-metric
noise or require fabricating story_id from workflow_slug — both
rejected by the team-lead audit (option C in the schema-resolution
SendMessage).

The executor stream uses its OWN schema, defined here as
`REQUIRED_EXECUTOR_EVENT_FIELDS`:

  {run_id, step_id, event_type, timestamp, payload}

Persistence: events are JSONL-appended to `events/{run_id}.jsonl`
under the metrics root via `hive.lib.metrics.paths.resolve_metrics_path`,
mirroring `append_event`'s file convention. Same stream, different
validator. The `append_event` function itself is untouched.

Reserved event_type values:
  * `node_started`, `node_completed`, `node_skipped`, `node_failed`
  * `predicate_evaluated` (reserved for hde-3a)
  * `gate_checked`
  * `tool_gating_overridden`
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Callable

from hive.lib.metrics.paths import resolve_metrics_path

from .errors import TelemetryError


REQUIRED_EXECUTOR_EVENT_FIELDS = frozenset(
    {"run_id", "step_id", "event_type", "timestamp", "payload"}
)


# Reserved event types the executor recognises. Adding a new type
# requires a corresponding entry here so misspellings are caught early.
RESERVED_EVENT_TYPES = frozenset(
    {
        "node_started",
        "node_completed",
        "node_skipped",
        "node_failed",
        "predicate_evaluated",
        "gate_checked",
        "tool_gating_overridden",
        # Worktree lifecycle events (hde-6 isolation subsystem)
        "worktree_created",
        "worktree_cleanup_success",
        "worktree_preserved_on_failure",
        # Pause/approve gate lifecycle (hde-8)
        "pause_suspended",
        "pause_resumed",
        "pause_rejected",
        "pause_timeout",
        # C2: bounded retry re-dispatch (one event per retry attempt)
        "node_retry",
        # c-generalize-loop C1: one event per LOOP converge-loop round
        "loop_round",
        # b-contract-derived-dag b2: one event per memoized cache-hit skip
        "node_reused",
    }
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _jsonl_writer(event: dict[str, Any], run_id: str) -> None:
    """Append a single event as one JSONL line under the metrics events dir.

    Mirrors `hive.lib.metrics.core.append_event`'s atomic-append style:
    open in append mode, write one JSON-serialised line, close. POSIX
    O_APPEND guarantees the per-line append is atomic on local
    filesystems (writes < PIPE_BUF). No fsync — caller may add it
    later if crash-survivability becomes a hard requirement.
    """
    event_path = resolve_metrics_path("events", f"{run_id}.jsonl", for_write=True)
    with event_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, sort_keys=True))
        handle.write("\n")


class Telemetry:
    """Per-run telemetry sink with strict executor-event schema.

    Buffer-by-default for tests (`self.events`). Pass `writer=` to
    inject a custom sink, or `persist=True` to use the default JSONL
    writer that lands events under the metrics root.
    """

    def __init__(
        self,
        run_id: str,
        writer: Callable[[dict[str, Any], str], None] | None = None,
        persist: bool = False,
    ) -> None:
        if not isinstance(run_id, str) or not run_id:
            raise TelemetryError("Telemetry requires a non-empty run_id")
        self.run_id = run_id
        self.events: list[dict[str, Any]] = []
        if writer is not None:
            self._writer: Callable[[dict[str, Any], str], None] | None = writer
        elif persist:
            self._writer = _jsonl_writer
        else:
            self._writer = None

    def emit(
        self,
        event_type: str,
        step_id: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Stamp run_id + timestamp and record a strict-schema event.

        Builds an event of exactly five top-level fields:
            {run_id, step_id, event_type, timestamp, payload}
        Caller-supplied data goes inside `payload`. Validates field
        PRESENCE against REQUIRED_EXECUTOR_EVENT_FIELDS and rejects
        unknown event_types. AC #3's "satisfies REQUIRED_EVENT_FIELDS"
        is satisfied via this presence-check; the stream is on the same
        events/ directory as append_event but uses the executor schema
        rather than the metrics-experiment schema.
        """
        if event_type not in RESERVED_EVENT_TYPES:
            raise TelemetryError(f"unknown executor event_type: {event_type!r}")
        if not isinstance(step_id, str) or not step_id:
            raise TelemetryError("step_id must be a non-empty string")
        if payload is None:
            payload = {}
        if not isinstance(payload, dict):
            raise TelemetryError("payload must be a dict or None")

        event: dict[str, Any] = {
            "run_id": self.run_id,
            "step_id": step_id,
            "event_type": event_type,
            "timestamp": _now_iso(),
            "payload": dict(payload),
        }

        missing = sorted(REQUIRED_EXECUTOR_EVENT_FIELDS - set(event))
        if missing:  # pragma: no cover — defensive; constructor builds all 5
            raise TelemetryError(
                f"event missing required fields: {', '.join(missing)}"
            )

        self.events.append(event)
        if self._writer is not None:
            self._writer(event, self.run_id)
        return event
