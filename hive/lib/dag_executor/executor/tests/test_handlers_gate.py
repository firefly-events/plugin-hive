"""Tests for GateHandler — `must not be empty` predicate (presence check)."""

from __future__ import annotations

import pytest

from hive.lib.dag_executor.executor.errors import GateFailedError
from hive.lib.dag_executor.executor.handlers.gate import GateHandler
from hive.lib.dag_executor.graph import Node, NodeType


def _gate_node(predicate: str | None) -> Node:
    return Node(
        id="gate-x",
        agent="developer",
        node_type=NodeType.GATE,
        gate=predicate,
    )


def test_gate_passes_when_input_non_empty():
    handler = GateHandler()
    out = handler.handle(
        _gate_node("test_artifacts must not be empty"),
        inputs={"test_artifacts": ["a.py"]},
        run_id="rid-1",
    )
    assert out.outputs["gate_passed"] is True


def test_gate_fails_when_input_empty_list():
    handler = GateHandler()
    with pytest.raises(GateFailedError):
        handler.handle(
            _gate_node("test_artifacts must not be empty"),
            inputs={"test_artifacts": []},
            run_id="rid-1",
        )


def test_gate_fails_when_input_missing():
    handler = GateHandler()
    with pytest.raises(GateFailedError):
        handler.handle(
            _gate_node("test_artifacts must not be empty"),
            inputs={},
            run_id="rid-1",
        )


def test_gate_fails_when_input_none():
    handler = GateHandler()
    with pytest.raises(GateFailedError):
        handler.handle(
            _gate_node("test_artifacts must not be empty"),
            inputs={"test_artifacts": None},
            run_id="rid-1",
        )


def test_gate_unknown_predicate_raises_with_hde3a_pointer():
    """Richer predicates land in hde-3a; reject unfamiliar predicates here."""
    handler = GateHandler()
    with pytest.raises(GateFailedError) as excinfo:
        handler.handle(
            _gate_node("count(test_artifacts) > 5"),
            inputs={"test_artifacts": ["a.py"]},
            run_id="rid-1",
        )
    assert "hde-3a" in str(excinfo.value)


def test_empty_predicate_raises():
    with pytest.raises(GateFailedError):
        GateHandler().handle(_gate_node(""), inputs={}, run_id="rid-1")
