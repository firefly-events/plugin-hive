from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any

from .errors import MetricsConflictError, MetricsNotFoundError, MetricsValidationError
from .paths import resolve_metrics_path
from .yamlish import dump_yaml, load_yaml

REQUIRED_EVENT_FIELDS = {
    "event_id",
    "timestamp",
    "run_id",
    "metric_type",
    "value",
    "unit",
}
EVENT_METRIC_TYPES = {
    "tokens": ("number", "tokens"),
    "wall_clock_ms": ("number", "ms"),
    "fix_loop_iterations": ("number", "iterations"),
    "first_attempt_pass": ("bool", "bool"),
    "human_escalation": ("bool", "bool"),
}

CREATE_REQUIRED_ENVELOPE_FIELDS = {
    "experiment_id",
    "swarm_id",
    "target_ref",
    "baseline_ref",
    "candidate_ref",
    "policy_ref",
    "decision",
    "observation_window",
    "regression_watch",
}
IMMUTABLE_ENVELOPE_FIELDS = {
    "experiment_id",
    "swarm_id",
    "target_ref",
    "baseline_ref",
    "candidate_ref",
    "policy_ref",
    "observation_window",
}
MUTABLE_ENVELOPE_FIELDS = {
    "decision",
    "regression_watch",
    "metrics_snapshot",
    "commit_ref",
    "rollback_ref",
}
DECISION_TRANSITIONS = {
    "pending": {"accept", "reject"},
    "accept": {"reverted"},
    "reject": set(),
    "reverted": set(),
}


def append_event(event_dict: dict[str, Any], run_id: str) -> dict[str, Any]:
    event = deepcopy(event_dict)
    _validate_run_id(run_id)
    _validate_event(event, run_id)
    event_path = resolve_metrics_path("events", f"{run_id}.jsonl", for_write=True)
    with event_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, sort_keys=True))
        handle.write("\n")
    return event


def create_envelope(envelope_dict: dict[str, Any]) -> dict[str, Any]:
    envelope = deepcopy(envelope_dict)
    _validate_create_envelope(envelope)
    envelope_path = _envelope_path(envelope["experiment_id"])
    if envelope_path.exists():
        raise MetricsConflictError(
            f"envelope already exists for experiment_id={envelope['experiment_id']}"
        )
    _write_yaml(envelope_path, envelope)
    return envelope


def update_envelope(experiment_id: str, updates_dict: dict[str, Any]) -> dict[str, Any]:
    if not updates_dict:
        raise MetricsValidationError("updates_dict must not be empty")
    current = read_envelope(experiment_id)
    updated = deepcopy(current)

    for field, value in updates_dict.items():
        if field in IMMUTABLE_ENVELOPE_FIELDS:
            raise MetricsValidationError(f"field is immutable after create: {field}")
        if field not in MUTABLE_ENVELOPE_FIELDS:
            raise MetricsValidationError(f"field is not narrow-mutable: {field}")

        if field == "decision":
            updated[field] = _next_decision(current.get(field), value)
        elif field == "commit_ref":
            updated[field] = _set_once_field(field, current.get(field), value)
        elif field == "rollback_ref":
            updated[field] = _set_once_field(field, current.get(field), value)
        elif field == "metrics_snapshot":
            if _is_closed(current):
                raise MetricsValidationError("metrics_snapshot is immutable after closure")
            updated[field] = value
        elif field == "regression_watch":
            updated[field] = _update_regression_watch(current.get(field), value)

    _write_yaml(_envelope_path(experiment_id), updated)
    return updated


def read_run_events(run_id: str) -> list[dict[str, Any]]:
    _validate_run_id(run_id)
    event_path = resolve_metrics_path("events", f"{run_id}.jsonl")
    if not event_path.exists():
        return []

    rows: list[dict[str, Any]] = []
    with event_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped:
                continue
            rows.append(json.loads(stripped))
    return rows


def read_envelope(experiment_id: str) -> dict[str, Any]:
    envelope_path = _envelope_path(experiment_id)
    if not envelope_path.exists():
        raise MetricsNotFoundError(f"envelope not found for experiment_id={experiment_id}")
    return load_yaml(envelope_path.read_text(encoding="utf-8"))


def read_baseline_metrics(envelope_dict: dict[str, Any]) -> Any:
    baseline_ref = envelope_dict.get("baseline_ref")
    if not baseline_ref:
        raise MetricsValidationError("envelope missing baseline_ref")

    baseline_experiment_id = _baseline_experiment_id(baseline_ref)
    if baseline_experiment_id is None:
        raise MetricsValidationError(
            f"unsupported baseline_ref; expected envelope reference or experiment id: {baseline_ref}"
        )

    baseline_envelope = read_envelope(baseline_experiment_id)
    metrics_snapshot = baseline_envelope.get("metrics_snapshot")
    if metrics_snapshot is None:
        raise MetricsValidationError(
            f"baseline envelope is missing metrics_snapshot: {baseline_experiment_id}"
        )
    return metrics_snapshot


def delta_compare(
    baseline_metrics: dict[str, Any], candidate_metrics: dict[str, Any]
) -> dict[str, dict[str, Any]]:
    baseline_values = _metric_value_map(baseline_metrics)
    candidate_values = _metric_value_map(candidate_metrics)

    deltas: dict[str, dict[str, Any]] = {}
    for metric_name in sorted(set(baseline_values) | set(candidate_values)):
        baseline = baseline_values.get(metric_name)
        candidate = candidate_values.get(metric_name)
        if isinstance(baseline, bool) or isinstance(candidate, bool):
            deltas[metric_name] = {
                "baseline": baseline,
                "candidate": candidate,
                "changed": baseline != candidate,
            }
            continue

        if not _is_number_or_none(baseline) or not _is_number_or_none(candidate):
            raise MetricsValidationError(
                f"metric '{metric_name}' must be numeric or boolean in both snapshots"
            )

        delta = None if baseline is None or candidate is None else candidate - baseline
        if baseline in (None, 0) or candidate is None:
            delta_pct = None
        else:
            delta_pct = (delta / baseline) * 100
        deltas[metric_name] = {
            "baseline": baseline,
            "candidate": candidate,
            "delta": delta,
            "delta_pct": delta_pct,
        }
    return deltas


def _validate_event(event: dict[str, Any], run_id: str) -> None:
    missing = sorted(REQUIRED_EVENT_FIELDS - set(event))
    if missing:
        raise MetricsValidationError(f"event missing required fields: {', '.join(missing)}")

    has_story = "story_id" in event and event["story_id"] not in (None, "")
    has_proposal = "proposal_id" in event and event["proposal_id"] not in (None, "")
    if has_story == has_proposal:
        raise MetricsValidationError("event must contain exactly one of story_id or proposal_id")

    if event["run_id"] != run_id:
        raise MetricsValidationError("event run_id must match append_event run_id")

    metric_type = event["metric_type"]
    if metric_type not in EVENT_METRIC_TYPES:
        raise MetricsValidationError(f"unsupported metric_type: {metric_type}")
    expected_value_kind, expected_unit = EVENT_METRIC_TYPES[metric_type]
    if event["unit"] != expected_unit:
        raise MetricsValidationError(
            f"metric_type {metric_type} requires unit {expected_unit}, got {event['unit']}"
        )

    if expected_value_kind == "number":
        if not _is_number(event["value"]):
            raise MetricsValidationError(f"metric_type {metric_type} requires numeric value")
    elif not isinstance(event["value"], bool):
        raise MetricsValidationError(f"metric_type {metric_type} requires boolean value")

    if "timestamp" in event:
        _parse_timestamp(event["timestamp"])
    if "dimensions" in event and not isinstance(event["dimensions"], dict):
        raise MetricsValidationError("dimensions must be an object when provided")
    if "event_id" in event and not isinstance(event["event_id"], str):
        raise MetricsValidationError("event_id must be a string")


def _validate_create_envelope(envelope: dict[str, Any]) -> None:
    missing = sorted(CREATE_REQUIRED_ENVELOPE_FIELDS - set(envelope))
    if missing:
        raise MetricsValidationError(
            f"envelope missing create-required fields: {', '.join(missing)}"
        )

    experiment_id = envelope.get("experiment_id")
    if not isinstance(experiment_id, str) or not experiment_id:
        raise MetricsValidationError("experiment_id must be a non-empty string")
    _validate_relative_identifier(experiment_id, "experiment_id")

    if envelope["decision"] not in DECISION_TRANSITIONS:
        raise MetricsValidationError("decision must be one of pending, accept, reject, reverted")

    if not isinstance(envelope["observation_window"], dict):
        raise MetricsValidationError("observation_window must be a mapping")
    if not isinstance(envelope["regression_watch"], dict):
        raise MetricsValidationError("regression_watch must be a mapping")


def _envelope_path(experiment_id: str) -> Path:
    _validate_relative_identifier(experiment_id, "experiment_id")
    return resolve_metrics_path("experiments", f"{experiment_id}.yaml", for_write=False)


def _write_yaml(path: Path, payload: dict[str, Any]) -> None:
    safe_path = resolve_metrics_path(*path.relative_to(resolve_metrics_path()).parts, for_write=True)
    safe_path.write_text(dump_yaml(payload), encoding="utf-8")


def _validate_run_id(run_id: str) -> None:
    _validate_relative_identifier(run_id, "run_id")


def _validate_relative_identifier(value: str, field_name: str) -> None:
    if not isinstance(value, str) or not value:
        raise MetricsValidationError(f"{field_name} must be a non-empty string")
    if Path(value).is_absolute():
        raise MetricsValidationError(f"{field_name} must not be an absolute path")
    if "/" in value or "\\" in value or ".." in value:
        raise MetricsValidationError(f"{field_name} must not contain path separators or traversal")


def _parse_timestamp(value: str) -> None:
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise MetricsValidationError(f"timestamp is not valid ISO-8601: {value}") from exc


def _set_once_field(field_name: str, current_value: Any, new_value: Any) -> Any:
    if current_value not in (None, "") and current_value != new_value:
        raise MetricsValidationError(f"{field_name} is immutable after first write")
    return new_value


def _next_decision(current: Any, new_value: Any) -> str:
    if new_value not in DECISION_TRANSITIONS:
        raise MetricsValidationError(f"invalid decision value: {new_value}")
    if current not in DECISION_TRANSITIONS:
        raise MetricsValidationError(f"invalid current decision value: {current}")
    if new_value == current:
        return new_value
    if new_value not in DECISION_TRANSITIONS[current]:
        raise MetricsValidationError(f"forbidden decision transition: {current} -> {new_value}")
    return new_value


def _update_regression_watch(current: Any, new_value: Any) -> Any:
    if not isinstance(new_value, dict):
        raise MetricsValidationError("regression_watch must be a mapping")
    if not isinstance(current, dict):
        return new_value

    current_state = current.get("state")
    new_state = new_value.get("state")
    if current_state == "tripped" and new_state == "armed":
        raise MetricsValidationError("regression_watch cannot transition from tripped to armed")
    for field in ("tripped_by", "tripped_at"):
        if current.get(field) not in (None, "") and new_value.get(field) in (None, ""):
            raise MetricsValidationError(f"regression_watch.{field} cannot be cleared once set")
    return new_value


def _is_closed(envelope: dict[str, Any]) -> bool:
    required = ("decision", "commit_ref", "metrics_snapshot", "rollback_ref")
    return all(envelope.get(field) not in (None, "") for field in required)


def _baseline_experiment_id(baseline_ref: str) -> str | None:
    candidate = baseline_ref
    if ":" in baseline_ref:
        prefix, _, suffix = baseline_ref.partition(":")
        if prefix not in {"envelope", "experiment"}:
            return None
        candidate = suffix
    if not candidate:
        return None
    _validate_relative_identifier(candidate, "baseline_ref")
    return candidate


def _metric_value_map(metrics: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(metrics, dict):
        raise MetricsValidationError("metrics snapshot must be a mapping")
    if isinstance(metrics.get("metrics"), dict):
        return metrics["metrics"]
    return metrics


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _is_number_or_none(value: Any) -> bool:
    return value is None or _is_number(value)

