"""Dataclass equality, field stability, and to_dict round-trip checks."""

from __future__ import annotations

from hive.lib.dag_executor.graph import (
    ConditionalEdge,
    Graph,
    InputBinding,
    Node,
    NodeType,
    OutputRef,
)


def test_node_type_enum_values():
    assert {nt.value for nt in NodeType} == {"agent", "script", "gate", "pause", "reconcile", "user_gate"}


def test_input_binding_equality_and_per_input_optional():
    a = InputBinding(name="x", source="step_output", step_id="prev", output_name="r", optional=True)
    b = InputBinding(name="x", source="step_output", step_id="prev", output_name="r", optional=True)
    assert a == b
    # per-input `optional` round-trips via to_dict
    assert a.to_dict()["optional"] is True


def test_input_binding_to_dict_omits_unset_optionals():
    binding = InputBinding(name="x", source="context", context_key="k")
    d = binding.to_dict()
    assert d == {"name": "x", "source": "context", "context_key": "k"}
    assert "optional" not in d
    assert "step_id" not in d


def test_node_per_step_optional_distinct_from_per_input_optional():
    """Both flags coexist on the same node and must round-trip independently."""
    inp = InputBinding(name="payload", source="step_output", step_id="up", output_name="o", optional=True)
    node = Node(id="n", agent="developer", inputs=[inp], optional=True)

    d = node.to_dict()
    assert d["optional"] is True  # per-step
    assert d["inputs"][0]["optional"] is True  # per-input
    # toggle one — the other must not move
    node.optional = False
    d2 = node.to_dict()
    assert d2["optional"] is False
    assert d2["inputs"][0]["optional"] is True


def test_node_default_node_type_is_agent():
    node = Node(id="n", agent="developer")
    assert node.node_type == NodeType.AGENT


def test_node_to_dict_carries_additive_fields():
    node = Node(
        id="n",
        agent="developer",
        when="some predicate",
        tools=["Read", "Edit"],
        disallowed_tools=["Bash"],
        skip_when="story.complexity == 'low'",
        gate="output not empty",
    )
    d = node.to_dict()
    assert d["when"] == "some predicate"
    assert d["tools"] == ["Read", "Edit"]
    assert d["disallowed_tools"] == ["Bash"]
    assert d["skip_when"] == "story.complexity == 'low'"
    assert d["gate"] == "output not empty"


def test_conditional_edge_with_predicate():
    edge = ConditionalEdge(from_node_id="a", to_node_id="b", when="ok")
    assert edge.to_dict() == {"from": "a", "to": "b", "when": "ok"}


def test_conditional_edge_without_predicate_omits_when():
    edge = ConditionalEdge(from_node_id="a", to_node_id="b")
    assert edge.to_dict() == {"from": "a", "to": "b"}


def test_output_ref_equality_and_round_trip():
    o1 = OutputRef(name="result", type="json")
    o2 = OutputRef(name="result", type="json")
    assert o1 == o2
    assert o1.to_dict() == {"name": "result", "type": "json"}


def test_graph_to_dict_round_trip_shape():
    node = Node(id="a", agent="developer", outputs=[OutputRef(name="r", type="string")])
    graph = Graph(workflow_name="test", version="1.0.0", nodes={"a": node})
    d = graph.to_dict()
    assert d["workflow_name"] == "test"
    assert d["version"] == "1.0.0"
    assert "a" in d["nodes"]
    assert d["nodes"]["a"]["agent"] == "developer"
    assert d["nodes"]["a"]["outputs"][0]["type"] == "string"


def test_agent_string_is_raw_no_resolution():
    """The model carries `agent` exactly as written; no resolution side-effect."""
    node = Node(id="a", agent="developer")
    assert node.agent == "developer"
    node2 = Node(id="b", agent="frontend-developer")
    assert node2.agent == "frontend-developer"
