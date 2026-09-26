"""Tests for UserGateHandler's `human_gate_ms` timing emit (s1-gate-timing-metric)."""

from __future__ import annotations

import json
import time

import pytest

from hive.lib.dag_executor.executor.handlers import user_gate as user_gate_module
from hive.lib.dag_executor.executor.handlers.user_gate import UserGateHandler
from hive.lib.dag_executor.graph import Node, NodeType
from hive.lib.dag_executor.pause.errors import PauseRejectedError
from hive.lib.dag_executor.pause.signal import SignalKind, SignalResult
from hive.lib.metrics.paths import resolve_metrics_path


def _gate_node(node_id: str = "gate-1", auto_pass_when: str | None = None) -> Node:
    return Node(
        id=node_id,
        agent="developer",
        node_type=NodeType.USER_GATE,
        auto_pass_when=auto_pass_when,
    )


def _read_events(run_id: str) -> list[dict]:
    path = resolve_metrics_path("events", f"{run_id}.jsonl")
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


@pytest.fixture(autouse=True)
def _metrics_root(tmp_path, monkeypatch):
    monkeypatch.setenv("METRICS_ROOT", str(tmp_path / "metrics"))
    yield


def _mock_wait_for_signal(monkeypatch, kind: SignalKind, reason: str | None = None):
    def _fake_wait_for_signal(**kwargs):
        return SignalResult(kind=kind, reason=reason, sentinel_path=kwargs["runs_root"] / "sentinel")

    monkeypatch.setattr(user_gate_module, "wait_for_signal", _fake_wait_for_signal)
    monkeypatch.setattr(user_gate_module, "generate", lambda run_id, node_id, runs_root: "tok")


def test_approve_emits_human_gate_ms_when_metrics_on(tmp_path, monkeypatch):
    monkeypatch.setenv("HIVE_METRICS_TEST_ENABLE", "1")  # sentinel, unused directly
    monkeypatch.setattr(user_gate_module, "_metrics_opt_in", lambda: True)
    _mock_wait_for_signal(monkeypatch, SignalKind.APPROVED)

    handler = UserGateHandler(runs_root=tmp_path / "runs")
    out = handler.handle(_gate_node(), inputs={}, run_id="run-1")

    assert out.outputs["user_gate"] == "approved"
    events = _read_events("run-1")
    assert len(events) == 1
    event = events[0]
    assert event["metric_type"] == "human_gate_ms"
    assert event["unit"] == "ms"
    assert isinstance(event["value"], int)
    assert event["value"] >= 0
    assert event["dimensions"] == {"node_id": "gate-1", "decision": "approve", "run_id": "run-1"}
    assert event["proposal_id"] == "runtime:gate-1"


def test_reject_emits_human_gate_ms_with_reject_decision(tmp_path, monkeypatch):
    monkeypatch.setattr(user_gate_module, "_metrics_opt_in", lambda: True)
    _mock_wait_for_signal(monkeypatch, SignalKind.REJECTED, reason="not ready")

    handler = UserGateHandler(runs_root=tmp_path / "runs")
    with pytest.raises(PauseRejectedError):
        handler.handle(_gate_node(), inputs={}, run_id="run-2")

    events = _read_events("run-2")
    assert len(events) == 1
    assert events[0]["dimensions"]["decision"] == "reject"


def test_no_emit_when_metrics_opt_in_off(tmp_path, monkeypatch):
    monkeypatch.setattr(user_gate_module, "_metrics_opt_in", lambda: False)
    _mock_wait_for_signal(monkeypatch, SignalKind.APPROVED)

    handler = UserGateHandler(runs_root=tmp_path / "runs")
    handler.handle(_gate_node(), inputs={}, run_id="run-3")

    assert _read_events("run-3") == []


def test_multiple_gates_key_by_node_id(tmp_path, monkeypatch):
    monkeypatch.setattr(user_gate_module, "_metrics_opt_in", lambda: True)
    _mock_wait_for_signal(monkeypatch, SignalKind.APPROVED)

    handler = UserGateHandler(runs_root=tmp_path / "runs")
    handler.handle(_gate_node("gate-a"), inputs={}, run_id="run-4")
    handler.handle(_gate_node("gate-b"), inputs={}, run_id="run-4")

    events = _read_events("run-4")
    assert len(events) == 2
    node_ids = {e["dimensions"]["node_id"] for e in events}
    assert node_ids == {"gate-a", "gate-b"}


def test_uses_story_id_from_inputs_when_present(tmp_path, monkeypatch):
    monkeypatch.setattr(user_gate_module, "_metrics_opt_in", lambda: True)
    _mock_wait_for_signal(monkeypatch, SignalKind.APPROVED)

    handler = UserGateHandler(runs_root=tmp_path / "runs")
    handler.handle(_gate_node(), inputs={"story_id": "s1-gate-timing-metric"}, run_id="run-5")

    events = _read_events("run-5")
    assert events[0]["story_id"] == "s1-gate-timing-metric"
    assert "proposal_id" not in events[0]


def test_metrics_opt_in_reads_hive_config(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("CONFIG_FILE", raising=False)
    monkeypatch.delenv("HIVE_ROOT", raising=False)
    (tmp_path / "hive.config.yaml").write_text("metrics:\n  enabled: true\n", encoding="utf-8")

    assert user_gate_module._metrics_opt_in() is True


def test_metrics_opt_in_defaults_false_without_config(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("CONFIG_FILE", raising=False)
    monkeypatch.delenv("HIVE_ROOT", raising=False)

    assert user_gate_module._metrics_opt_in() is False


def test_approve_survives_metrics_emit_failure(tmp_path, monkeypatch):
    # A metric-emit failure must never turn an already-approved gate into a
    # run failure — the gate outcome has to win regardless of telemetry.
    monkeypatch.setattr(user_gate_module, "_metrics_opt_in", lambda: True)
    monkeypatch.setattr(
        user_gate_module,
        "append_event",
        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("emit boom")),
    )
    _mock_wait_for_signal(monkeypatch, SignalKind.APPROVED)

    handler = UserGateHandler(runs_root=tmp_path / "runs")
    out = handler.handle(_gate_node(), inputs={}, run_id="run-6")

    assert out.outputs["user_gate"] == "approved"


def test_reject_raises_pause_rejected_despite_metrics_emit_failure(tmp_path, monkeypatch):
    # The reject path must still raise the original PauseRejectedError, not
    # whatever exception the metrics emit happened to throw.
    monkeypatch.setattr(user_gate_module, "_metrics_opt_in", lambda: True)
    monkeypatch.setattr(
        user_gate_module,
        "append_event",
        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("emit boom")),
    )
    _mock_wait_for_signal(monkeypatch, SignalKind.REJECTED, reason="not ready")

    handler = UserGateHandler(runs_root=tmp_path / "runs")
    with pytest.raises(PauseRejectedError, match="not ready"):
        handler.handle(_gate_node(), inputs={}, run_id="run-7")


def test_elapsed_ms_uses_persisted_wall_clock_across_replay(tmp_path, monkeypatch):
    # Simulate a crash-restart replay: the pause sentinel + opened_at marker
    # already exist from a prior (crashed) process by the time `_halt` runs
    # again, so timing must be recovered from the persisted wall-clock start
    # rather than reset to ~0 by a fresh `time.monotonic()` baseline.
    monkeypatch.setattr(user_gate_module, "_metrics_opt_in", lambda: True)
    _mock_wait_for_signal(monkeypatch, SignalKind.APPROVED)

    runs_root = tmp_path / "runs"
    opened_at_path = runs_root / "run-8" / "pause" / "gate-1.opened_at"
    opened_at_path.parent.mkdir(parents=True, exist_ok=True)
    backdated = time.time() - 5  # pretend the gate opened 5s ago
    opened_at_path.write_text(str(backdated), encoding="utf-8")

    handler = UserGateHandler(runs_root=runs_root)
    handler.handle(_gate_node(), inputs={}, run_id="run-8")

    events = _read_events("run-8")
    assert len(events) == 1
    assert events[0]["value"] >= 4000  # ~5s, not ~0ms
