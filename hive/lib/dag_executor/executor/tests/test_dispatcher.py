"""Dispatcher — node_type → handler routing tests."""

from __future__ import annotations

import pytest

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.errors import DispatcherError
from hive.lib.dag_executor.executor.handlers import (
    AgentHandler,
    NodeOutput,
    StubAgentSpawn,
)
from hive.lib.dag_executor.graph import Node, NodeType


def _node(node_type: NodeType, **kwargs) -> Node:
    base = {"id": "n1", "agent": "developer", "node_type": node_type}
    base.update(kwargs)
    return Node(**base)


def test_agent_handler_must_be_explicitly_registered():
    """Default Dispatcher has no AgentHandler — caller injects one with a spawn."""
    d = Dispatcher()
    with pytest.raises(DispatcherError):
        d.dispatch(_node(NodeType.AGENT, step_file=None), inputs={}, run_id="rid-1")


def test_agent_handler_routing_after_register():
    spy = StubAgentSpawn(canned_outputs={"n1": {"verdict": "ok"}})
    d = Dispatcher()
    d.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)
    out = d.dispatch(_node(NodeType.AGENT, step_file=None), inputs={}, run_id="rid-1")
    assert out.outputs == {"verdict": "ok"}


def test_script_routing_runs_task():
    d = Dispatcher()
    out = d.dispatch(
        _node(NodeType.SCRIPT, task="echo hi"),
        inputs={},
        run_id="rid-1",
    )
    assert out.outputs["stdout"].strip() == "hi"


def test_pause_routing_dispatches_to_registered_handler():
    """Pause handlers require explicit configuration (runs_root +
    telemetry); the default-dispatcher binding works structurally
    but a real call needs a sentinel-coordinated environment, so
    the routing-level test substitutes a non-blocking handler."""

    from hive.lib.dag_executor.executor.handlers import NodeOutput

    def _stub_pause(node, inputs, run_id):
        return NodeOutput(outputs={"paused": True, "approved": True}, meta={})

    d = Dispatcher(handlers={NodeType.PAUSE: _stub_pause})
    out = d.dispatch(_node(NodeType.PAUSE), inputs={}, run_id="rid-1")
    assert out.outputs["approved"] is True


def test_pluggable_handler_override():
    """Tests can substitute a handler entirely without touching production code."""

    def fake_handler(node, inputs, run_id):
        return NodeOutput(outputs={"called_with": node.id})

    d = Dispatcher(handlers={NodeType.AGENT: fake_handler})
    out = d.dispatch(_node(NodeType.AGENT, step_file=None), inputs={}, run_id="rid-1")
    assert out.outputs == {"called_with": "n1"}
