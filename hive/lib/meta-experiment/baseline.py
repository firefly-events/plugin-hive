"""Capture baseline metric snapshots from recorded run events."""

from __future__ import annotations

from datetime import datetime, timezone
import math
from typing import Any

from hive.lib.metrics import MetricsValidationError, read_run_events

from . import envelope

_REQUIRED_EVENT_FIELDS = {
    "event_id",
    "timestamp",
    "run_id",
    "metric_type",
    "value",
    "unit",
    "dimensions",
    "source",
}
_EVENT_METRIC_TYPES = {
    "tokens": ("number", "tokens"),
    "wall_clock_ms": ("number", "ms"),
    "fix_loop_iterations": ("number", "iterations"),
    "first_attempt_pass": ("bool", "bool"),
    "human_escalation": ("bool", "bool"),
}


class NoBaselineError(Exception):
    """Raised when a run does not have usable metrics for baseline capture."""


def capture_from_run(run_id: str) -> dict[str, Any] | None:
    """Return the latest valid metrics snapshot for a run, if present."""
    events = read_run_events(run_id)
    if not events:
        return None

    metrics: dict[str, Any] = {}
    for event in events:
        if _should_skip_event_row(event):
            continue
        _validate_event_row(event, run_id)
        metrics[event["metric_type"]] = event["value"]

    if not metrics:
        return None

    return {
        "captured_at": _utc_now_iso(),
        "metrics": metrics,
    }


def persist_to_envelope(experiment_id: str, snapshot: dict[str, Any]) -> dict[str, Any]:
    """Persist a captured metrics snapshot through the envelope wrapper."""
    return envelope.set_metrics_snapshot(experiment_id, snapshot)


def capture_and_persist(experiment_id: str, run_id: str) -> dict[str, Any]:
    """Capture a run baseline and persist it to the experiment envelope."""
    snapshot = capture_from_run(run_id)
    if snapshot is None:
        raise NoBaselineError(f"no baseline metrics available for run_id={run_id}")
    return persist_to_envelope(experiment_id, snapshot)


def _validate_event_row(event: dict[str, Any], run_id: str) -> None:
    missing = sorted(_REQUIRED_EVENT_FIELDS - set(event))
    if missing:
        raise MetricsValidationError(f"event missing required fields: {', '.join(missing)}")

    if event["run_id"] != run_id:
        raise MetricsValidationError("event run_id must match requested run_id")

    has_story = "story_id" in event and event["story_id"] not in (None, "")
    has_proposal = "proposal_id" in event and event["proposal_id"] not in (None, "")
    if has_story == has_proposal:
        raise MetricsValidationError("event must contain exactly one of story_id or proposal_id")

    metric_type = event["metric_type"]
    if metric_type not in _EVENT_METRIC_TYPES:
        raise MetricsValidationError(f"unsupported metric_type: {metric_type}")

    expected_value_kind, expected_unit = _EVENT_METRIC_TYPES[metric_type]
    if event["unit"] != expected_unit:
        raise MetricsValidationError(
            f"metric_type {metric_type} requires unit {expected_unit}, got {event['unit']}"
        )

    value = event["value"]
    if expected_value_kind == "number":
        if not _is_number(value):
            raise MetricsValidationError(f"metric_type {metric_type} requires numeric value")
    elif not isinstance(value, bool):
        raise MetricsValidationError(f"metric_type {metric_type} requires boolean value")

    if not isinstance(event["timestamp"], str):
        raise MetricsValidationError("timestamp must be a string")
    try:
        datetime.fromisoformat(event["timestamp"].replace("Z", "+00:00"))
    except ValueError as exc:
        raise MetricsValidationError(
            f"timestamp is not valid ISO-8601: {event['timestamp']}"
        ) from exc

    if not isinstance(event["dimensions"], dict):
        raise MetricsValidationError("dimensions must be an object when provided")
    if not isinstance(event["event_id"], str):
        raise MetricsValidationError("event_id must be a string")


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _should_skip_event_row(event: dict[str, Any]) -> bool:
    metric_type = event.get("metric_type")
    if metric_type not in _EVENT_METRIC_TYPES:
        return False

    expected_value_kind, _ = _EVENT_METRIC_TYPES[metric_type]
    return expected_value_kind == "number" and isinstance(event.get("value"), float) and not math.isfinite(
        event["value"]
    )


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
