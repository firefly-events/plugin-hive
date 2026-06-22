"""Tests for the executor's Telemetry shim.

Schema lock (per team-lead resolution of the schema-conflict SendMessage):
the executor stream uses its own REQUIRED_EXECUTOR_EVENT_FIELDS schema
({run_id, step_id, event_type, timestamp, payload}). It writes to the
same `events/{run_id}.jsonl` file convention as `append_event`, but
does NOT call `append_event` — the metrics-experiment validator there
enforces a `metric_type`/`story_id` shape incompatible with the
executor's per-node taxonomy.
"""

from __future__ import annotations

import json

import pytest

from hive.lib.dag_executor.executor.errors import TelemetryError
from hive.lib.dag_executor.executor.telemetry import (
    REQUIRED_EXECUTOR_EVENT_FIELDS,
    RESERVED_EVENT_TYPES,
    Telemetry,
)


def test_emit_returns_strict_schema_event():
    tel = Telemetry(run_id="rid-1")
    event = tel.emit("node_started", "step-x", {"foo": "bar"})
    assert set(event) == set(REQUIRED_EXECUTOR_EVENT_FIELDS)
    assert event["run_id"] == "rid-1"
    assert event["step_id"] == "step-x"
    assert event["event_type"] == "node_started"
    assert event["payload"] == {"foo": "bar"}
    assert "timestamp" in event
    assert tel.events == [event]


def test_emit_payload_defaults_to_empty_dict():
    tel = Telemetry(run_id="rid-1")
    event = tel.emit("node_started", "step-x")
    assert event["payload"] == {}


def test_emit_rejects_unknown_event_type():
    tel = Telemetry(run_id="rid-1")
    with pytest.raises(TelemetryError):
        tel.emit("bogus_event", "step-x", {})


def test_emit_rejects_empty_step_id():
    tel = Telemetry(run_id="rid-1")
    with pytest.raises(TelemetryError):
        tel.emit("node_started", "", {})


def test_emit_rejects_non_dict_payload():
    tel = Telemetry(run_id="rid-1")
    with pytest.raises(TelemetryError):
        tel.emit("node_started", "step-x", "not-a-dict")  # type: ignore[arg-type]


def test_constructor_rejects_empty_run_id():
    with pytest.raises(TelemetryError):
        Telemetry(run_id="")


def test_required_fields_constant_is_authoritative():
    """Five fields, no more, no less — locked by team-lead audit."""
    assert REQUIRED_EXECUTOR_EVENT_FIELDS == frozenset(
        {"run_id", "step_id", "event_type", "timestamp", "payload"}
    )


def test_writer_hook_receives_validated_event():
    captured: list[tuple[dict, str]] = []
    tel = Telemetry(
        run_id="rid-1",
        writer=lambda evt, rid: captured.append((evt, rid)),
    )
    tel.emit("node_started", "step-x", {"k": "v"})
    assert len(captured) == 1
    evt, rid = captured[0]
    assert rid == "rid-1"
    assert evt["payload"] == {"k": "v"}


def test_persist_true_writes_jsonl_to_metrics_root(tmp_path, monkeypatch):
    """Default persistence writes to events/{run_id}.jsonl under metrics root."""
    monkeypatch.setenv("METRICS_ROOT", str(tmp_path))
    run_id = "rid-persist-test"
    tel = Telemetry(run_id=run_id, persist=True)
    tel.emit("node_started", "step-x", {})
    tel.emit("node_completed", "step-x", {"outputs": ["a", "b"]})

    jsonl = tmp_path / "events" / f"{run_id}.jsonl"
    assert jsonl.exists()
    lines = [json.loads(line) for line in jsonl.read_text().splitlines() if line]
    assert len(lines) == 2
    assert lines[0]["event_type"] == "node_started"
    assert lines[1]["event_type"] == "node_completed"
    assert lines[1]["payload"] == {"outputs": ["a", "b"]}


def test_persist_false_does_not_write(tmp_path, monkeypatch):
    """Default (buffer-only) leaves no file behind."""
    monkeypatch.setenv("METRICS_ROOT", str(tmp_path))
    tel = Telemetry(run_id="rid-no-persist")
    tel.emit("node_started", "step-x", {})
    assert not (tmp_path / "events").exists()


def test_reserved_event_types_are_authoritative():
    expected = {
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
        # C2: bounded retry re-dispatch
        "node_retry",
    }
    assert RESERVED_EVENT_TYPES == expected


def test_jsonl_writer_appends_atomically(tmp_path, monkeypatch):
    """Five sequential emits produce five JSONL lines (append, no overwrite)."""
    monkeypatch.setenv("METRICS_ROOT", str(tmp_path))
    run_id = "rid-append-test"
    tel = Telemetry(run_id=run_id, persist=True)
    for i in range(5):
        tel.emit("node_started", f"step-{i}", {})
    jsonl = tmp_path / "events" / f"{run_id}.jsonl"
    lines = [line for line in jsonl.read_text().splitlines() if line]
    assert len(lines) == 5
    parsed = [json.loads(line) for line in lines]
    assert [p["step_id"] for p in parsed] == [f"step-{i}" for i in range(5)]
