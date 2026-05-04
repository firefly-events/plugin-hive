"""Walker tests — Kahn topo-sort, sequential dispatch, optional-step semantics."""

from __future__ import annotations

import pytest

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.errors import (
    HandlerError,
    WalkerCycleError,
)
from hive.lib.dag_executor.executor.handlers import NodeOutput
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker, _topological_order
from hive.lib.dag_executor.graph import (
    ConditionalEdge,
    Graph,
    InputBinding,
    Node,
    NodeType,
)


def _agent_node(node_id: str, depends_on: list[str] | None = None, **kw) -> Node:
    return Node(
        id=node_id,
        agent="developer",
        node_type=NodeType.AGENT,
        depends_on=depends_on or [],
        **kw,
    )


def _graph_with(nodes: list[Node]) -> Graph:
    edges = [
        ConditionalEdge(from_node_id=p, to_node_id=n.id)
        for n in nodes
        for p in n.depends_on
    ]
    return Graph(workflow_name="test", nodes={n.id: n for n in nodes}, edges=edges)


def _stub_dispatcher(outputs_by_id: dict[str, dict]) -> Dispatcher:
    """Dispatcher whose AGENT handler returns canned outputs by node id."""

    def handler(node, inputs, run_id):
        return NodeOutput(outputs=dict(outputs_by_id.get(node.id, {})))

    return Dispatcher(handlers={NodeType.AGENT: handler})


def _emit_types(tel: Telemetry) -> list[str]:
    return [e["event_type"] for e in tel.events]


def test_topo_sort_linear_chain():
    g = _graph_with(
        [
            _agent_node("a"),
            _agent_node("b", depends_on=["a"]),
            _agent_node("c", depends_on=["b"]),
        ]
    )
    assert _topological_order(g) == ["a", "b", "c"]


def test_topo_sort_diamond():
    g = _graph_with(
        [
            _agent_node("a"),
            _agent_node("b", depends_on=["a"]),
            _agent_node("c", depends_on=["a"]),
            _agent_node("d", depends_on=["b", "c"]),
        ]
    )
    order = _topological_order(g)
    assert order.index("a") < order.index("b") < order.index("d")
    assert order.index("a") < order.index("c") < order.index("d")


def test_topo_sort_cycle_raises():
    g = _graph_with(
        [
            _agent_node("a", depends_on=["b"]),
            _agent_node("b", depends_on=["a"]),
        ]
    )
    with pytest.raises(WalkerCycleError):
        _topological_order(g)


def test_walk_emits_started_and_completed_per_node():
    g = _graph_with([_agent_node("a"), _agent_node("b", depends_on=["a"])])
    tel = Telemetry(run_id="rid-1")
    Walker().walk(g, _stub_dispatcher({"a": {"x": 1}, "b": {"y": 2}}), "rid-1", tel)
    assert _emit_types(tel) == [
        "node_started",
        "node_completed",
        "node_started",
        "node_completed",
    ]


def test_walk_materialises_outputs_for_downstream_use():
    """Inputs of node `b` resolve from node `a`'s materialised outputs."""

    def handler(node, inputs, run_id):
        if node.id == "a":
            return NodeOutput(outputs={"shared": 42})
        # `b` should observe `a`'s output via input binding
        assert inputs == {"piped": 42}, f"inputs not materialised: {inputs}"
        return NodeOutput(outputs={"final": inputs["piped"]})

    a = _agent_node("a", outputs=[])
    b = _agent_node(
        "b",
        depends_on=["a"],
        inputs=[
            InputBinding(
                name="piped",
                source="step_output",
                step_id="a",
                output_name="shared",
            )
        ],
    )
    g = _graph_with([a, b])
    tel = Telemetry(run_id="rid-1")
    out = Walker().walk(g, Dispatcher(handlers={NodeType.AGENT: handler}), "rid-1", tel)
    assert out["b"].outputs == {"final": 42}


def test_optional_step_failure_continues_walk():
    def handler(node, inputs, run_id):
        if node.id == "a":
            raise HandlerError("boom")
        return NodeOutput(outputs={"ok": True})

    a = _agent_node("a", optional=True)
    b = _agent_node("b", depends_on=["a"])
    g = _graph_with([a, b])
    tel = Telemetry(run_id="rid-1")
    out = Walker().walk(g, Dispatcher(handlers={NodeType.AGENT: handler}), "rid-1", tel)
    assert "b" in out
    assert "node_failed" in _emit_types(tel)


def test_required_step_failure_propagates():
    def handler(node, inputs, run_id):
        raise HandlerError("boom")

    g = _graph_with([_agent_node("a")])  # default optional=False
    tel = Telemetry(run_id="rid-1")
    with pytest.raises(HandlerError):
        Walker().walk(g, Dispatcher(handlers={NodeType.AGENT: handler}), "rid-1", tel)
    assert "node_failed" in _emit_types(tel)


def test_skip_when_present_emits_node_skipped():
    """skip_when predicate evaluation is hde-3a; presence triggers skip."""
    g = _graph_with([_agent_node("a", skip_when="some_predicate")])
    tel = Telemetry(run_id="rid-1")
    Walker().walk(g, _stub_dispatcher({}), "rid-1", tel)
    assert _emit_types(tel) == ["node_skipped"]


def test_every_emitted_event_carries_run_id():
    g = _graph_with([_agent_node("a")])
    tel = Telemetry(run_id="rid-xyz")
    Walker().walk(g, _stub_dispatcher({"a": {}}), "rid-xyz", tel)
    assert all(e["run_id"] == "rid-xyz" for e in tel.events)
