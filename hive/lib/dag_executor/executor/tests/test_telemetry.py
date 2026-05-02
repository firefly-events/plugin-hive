"""Tests for the executor's Telemetry shim.

Notes:
  * The shim wraps `REQUIRED_EVENT_FIELDS` from `hive.lib.metrics.core`
    as a presence check. It deliberately does NOT call
    `hive.lib.metrics.core.append_event` because that validator
    enforces a metrics-experiment vocabulary (`metric_type` ∈
    {tokens, wall_clock_ms, ...}) incompatible with the executor's
    per-node taxonomy. See `telemetry.py` module docstring for the
    full rationale.
"""

from __future__ import annotations

import pytest

from hive.lib.dag_executor.executor.errors import TelemetryError
from hive.lib.dag_executor.executor.telemetry import (
    RESERVED_EVENT_TYPES,
    Telemetry,
)
from hive.lib.metrics.core import REQUIRED_EVENT_FIELDS


def _full_payload(step_id: str = "step-x") -> dict[str, object]:
    """Payload that satisfies REQUIRED_EVENT_FIELDS as a presence check."""
    return {
        "event_id": "evt-1",
        "metric_type": "wall_clock_ms",
        "value": 0,
        "unit": "ms",
        "dimensions": {"step_id": step_id},
        "source": "executor",
    }


def test_emit_stamps_run_id_and_timestamp_and_event_type():
    tel = Telemetry(run_id="rid-1")
    event = tel.emit("node_started", _full_payload())
    assert event["run_id"] == "rid-1"
    assert event["event_type"] == "node_started"
    assert "timestamp" in event
    assert tel.events == [event]


def test_emit_rejects_unknown_event_type():
    tel = Telemetry(run_id="rid-1")
    with pytest.raises(TelemetryError):
        tel.emit("bogus_event", _full_payload())


def test_emit_rejects_payload_with_mismatched_run_id():
    tel = Telemetry(run_id="rid-a")
    payload = _full_payload()
    payload["run_id"] = "rid-b"
    with pytest.raises(TelemetryError):
        tel.emit("node_started", payload)


def test_emit_auto_fills_executor_defaults_for_compact_payloads():
    """Walker emits compact payloads (e.g. {'step_id': 'a'}); shim must
    auto-fill metric_type/value/unit/dimensions/source/event_id so the
    REQUIRED_EVENT_FIELDS presence check is satisfied."""
    tel = Telemetry(run_id="rid-1")
    event = tel.emit("node_started", {"step_id": "a"})
    assert event["metric_type"] == "executor_event"
    assert event["unit"] == "event"
    assert event["source"] == "dag_executor"
    assert event["dimensions"] == {}
    assert event["value"] == 0
    assert event["event_id"].startswith("evt-")


def test_emit_caller_can_override_defaults():
    tel = Telemetry(run_id="rid-1")
    event = tel.emit(
        "node_completed",
        {"step_id": "a", "metric_type": "wall_clock_ms", "value": 42, "unit": "ms"},
    )
    assert event["metric_type"] == "wall_clock_ms"
    assert event["value"] == 42
    assert event["unit"] == "ms"


def test_constructor_rejects_empty_run_id():
    with pytest.raises(TelemetryError):
        Telemetry(run_id="")


def test_required_fields_match_metrics_substrate():
    """Schema-compatibility contract: same field names as metrics layer."""
    tel = Telemetry(run_id="rid-1")
    event = tel.emit("node_completed", _full_payload())
    assert REQUIRED_EVENT_FIELDS <= set(event)


def test_writer_hook_receives_validated_event():
    captured: list[tuple[dict, str]] = []
    tel = Telemetry(
        run_id="rid-1",
        writer=lambda evt, rid: captured.append((evt, rid)),
    )
    tel.emit("node_started", _full_payload())
    assert len(captured) == 1
    evt, rid = captured[0]
    assert rid == "rid-1"
    assert evt["event_type"] == "node_started"


def test_reserved_event_types_are_authoritative():
    expected = {
        "node_started",
        "node_completed",
        "node_skipped",
        "node_failed",
        "predicate_evaluated",
        "gate_checked",
        "tool_gating_overridden",
    }
    assert RESERVED_EVENT_TYPES == expected
