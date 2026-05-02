"""Telemetry shim for the DAG executor.

This module wraps the metrics substrate (`hive.lib.metrics.core`) but
does NOT call `append_event` directly — `append_event` enforces a tight
metrics-experiment schema (`metric_type` ∈ {tokens, wall_clock_ms,
fix_loop_iterations, first_attempt_pass, human_escalation}, plus
`story_id` xor `proposal_id`) that is not call-compatible with the
executor's per-node event taxonomy (`node_started`, `node_completed`,
`tool_gating_overridden`, ...). Forcing executor events through the
metrics validator would require fabricating story_id from
workflow_slug and force-fitting `metric_type=wall_clock_ms`, which the
story rejects.

Instead, this telemetry layer:
  * Validates field PRESENCE against `REQUIRED_EVENT_FIELDS` from the
    metrics module (the observability lock per the team-lead audit).
  * Stamps `run_id` on every event, refusing emits that omit it.
  * Buffers events in-memory by default so tests and the spine parity
    test can read the emitted stream structurally.
  * Exposes a write hook so production wiring (later slice) can persist
    to a separate stream (`events/executor/{run_id}.jsonl`) without
    coupling to the metrics-experiment validator.

Reserved event_type values:
  * `node_started`, `node_completed`, `node_skipped`, `node_failed`
  * `predicate_evaluated` (reserved for hde-3a)
  * `gate_checked`
  * `tool_gating_overridden`
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Callable

from hive.lib.metrics.core import REQUIRED_EVENT_FIELDS

from .errors import TelemetryError


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
    }
)


# Default values for metrics-vocabulary fields the executor does not
# semantically populate. Every emit auto-fills these so the field-
# presence contract from REQUIRED_EVENT_FIELDS is satisfied without
# forcing every call site to fabricate metric_type/value/unit. Callers
# that DO have a numeric measurement (e.g. node duration) override them.
_EXECUTOR_DEFAULTS: dict[str, Any] = {
    "metric_type": "executor_event",
    "value": 0,
    "unit": "event",
    "dimensions": {},
    "source": "dag_executor",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class Telemetry:
    """Per-run telemetry sink.

    Buffer-by-default: tests inspect `self.events` directly. Pass a
    `writer` callable to persist events; the callable receives the
    fully-validated event dict and the run_id.
    """

    def __init__(
        self,
        run_id: str,
        writer: Callable[[dict[str, Any], str], None] | None = None,
    ) -> None:
        if not isinstance(run_id, str) or not run_id:
            raise TelemetryError("Telemetry requires a non-empty run_id")
        self.run_id = run_id
        self.events: list[dict[str, Any]] = []
        self._writer = writer

    def emit(self, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Stamp run_id + timestamp + event_type and record the event.

        Validates field PRESENCE against REQUIRED_EVENT_FIELDS — the
        executor stream uses the same field names but a different
        metric_type vocabulary, so the schema-compatibility contract is
        "names present, run_id matches"; deeper validation belongs to
        whichever consumer reads the stream.
        """
        if event_type not in RESERVED_EVENT_TYPES:
            raise TelemetryError(f"unknown executor event_type: {event_type!r}")
        if not isinstance(payload, dict):
            raise TelemetryError("payload must be a dict")
        if "run_id" in payload and payload["run_id"] != self.run_id:
            raise TelemetryError(
                f"payload run_id {payload['run_id']!r} != telemetry.run_id {self.run_id!r}"
            )

        event = dict(payload)
        event.setdefault("run_id", self.run_id)
        event.setdefault("timestamp", _now_iso())
        event.setdefault("event_id", f"evt-{uuid.uuid4().hex[:12]}")
        for key, default in _EXECUTOR_DEFAULTS.items():
            event.setdefault(key, default)
        event["event_type"] = event_type

        missing = sorted(REQUIRED_EVENT_FIELDS - set(event))
        if missing:
            raise TelemetryError(
                f"event missing required fields: {', '.join(missing)}"
            )

        self.events.append(event)
        if self._writer is not None:
            self._writer(event, self.run_id)
        return event
