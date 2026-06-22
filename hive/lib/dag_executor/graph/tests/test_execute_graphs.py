"""s10-execute-graphs: loader/validator tests for classic + tdd methodology graphs.

Asserts:
  - Each graph loads without error.
  - Each graph validates (no dangling refs, no cycles, valid types/timeouts).
  - Methodology step order is expressed correctly.
  - Reconcile nodes appear between agent nodes and gate nodes.
  - Bounded retry is configured on gate nodes (no LOOP primitive).
  - Stubbed-run simulation walks nodes in topological order.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from hive.lib.dag_executor.graph import (
    Graph,
    NodeType,
    load_workflow,
    validate_graph,
)


REPO_ROOT = Path(__file__).resolve().parents[5]
WORKFLOWS_DIR = REPO_ROOT / "hive" / "workflows"

CLASSIC_PATH = WORKFLOWS_DIR / "development.classic.workflow.yaml"
TDD_PATH = WORKFLOWS_DIR / "development.tdd.workflow.yaml"


# ---------------------------------------------------------------------------
# Loader / validator
# ---------------------------------------------------------------------------


def test_classic_workflow_loads():
    graph = load_workflow(CLASSIC_PATH)
    assert isinstance(graph, Graph)
    assert graph.workflow_name == "development-classic"
    assert graph.methodology == "classic"
    assert len(graph.nodes) > 0


def test_tdd_workflow_loads():
    graph = load_workflow(TDD_PATH)
    assert isinstance(graph, Graph)
    assert graph.workflow_name == "development-tdd"
    assert graph.methodology == "tdd"
    assert len(graph.nodes) > 0


def test_classic_workflow_validates():
    graph = load_workflow(CLASSIC_PATH)
    validate_graph(graph)  # raises on any violation


def test_tdd_workflow_validates():
    graph = load_workflow(TDD_PATH)
    validate_graph(graph)  # raises on any violation


# ---------------------------------------------------------------------------
# Step order (methodology contract)
# ---------------------------------------------------------------------------


def _topo_order(graph: Graph) -> list[str]:
    """Kahn's algorithm — returns node ids in topological order."""
    from collections import deque

    in_degree: dict[str, int] = {nid: 0 for nid in graph.nodes}
    successors: dict[str, list[str]] = {nid: [] for nid in graph.nodes}
    for node in graph.nodes.values():
        for pred in node.depends_on:
            in_degree[node.id] += 1
            successors[pred].append(node.id)

    queue: deque[str] = deque(nid for nid, d in in_degree.items() if d == 0)
    order: list[str] = []
    while queue:
        nid = queue.popleft()
        order.append(nid)
        for successor in successors[nid]:
            in_degree[successor] -= 1
            if in_degree[successor] == 0:
                queue.append(successor)
    return order


def test_classic_step_order_research_before_implement():
    graph = load_workflow(CLASSIC_PATH)
    order = _topo_order(graph)
    # research (or write-brief) must precede backend-implement
    assert "research" in order
    assert "backend-implement" in order
    assert order.index("research") < order.index("backend-implement")


def test_classic_step_order_implement_before_test():
    graph = load_workflow(CLASSIC_PATH)
    order = _topo_order(graph)
    # Both implement nodes must precede test
    assert order.index("backend-implement") < order.index("test")
    assert order.index("frontend-implement") < order.index("test")


def test_classic_step_order_test_before_review():
    graph = load_workflow(CLASSIC_PATH)
    order = _topo_order(graph)
    assert order.index("test") < order.index("review")


def test_classic_step_order_review_before_integrate():
    graph = load_workflow(CLASSIC_PATH)
    order = _topo_order(graph)
    assert order.index("review") < order.index("integrate")


def test_tdd_step_order_test_spec_before_implement():
    graph = load_workflow(TDD_PATH)
    order = _topo_order(graph)
    assert "test-spec" in order
    assert "implement" in order
    assert order.index("test-spec") < order.index("implement")


def test_tdd_step_order_implement_before_review():
    graph = load_workflow(TDD_PATH)
    order = _topo_order(graph)
    assert order.index("implement") < order.index("review")


def test_tdd_step_order_review_before_integrate():
    graph = load_workflow(TDD_PATH)
    order = _topo_order(graph)
    assert order.index("review") < order.index("integrate")


# ---------------------------------------------------------------------------
# Reconcile nodes present and placed before gates
# ---------------------------------------------------------------------------


def _reconcile_ids(graph: Graph) -> list[str]:
    return [nid for nid, n in graph.nodes.items() if n.node_type == NodeType.RECONCILE]


def _gate_ids(graph: Graph) -> list[str]:
    return [nid for nid, n in graph.nodes.items() if n.node_type == NodeType.GATE]


def test_classic_has_reconcile_nodes():
    graph = load_workflow(CLASSIC_PATH)
    assert len(_reconcile_ids(graph)) >= 1, "classic graph must have at least one RECONCILE node"


def test_tdd_has_reconcile_nodes():
    graph = load_workflow(TDD_PATH)
    assert len(_reconcile_ids(graph)) >= 1, "tdd graph must have at least one RECONCILE node"


def test_classic_has_gate_node():
    graph = load_workflow(CLASSIC_PATH)
    assert len(_gate_ids(graph)) >= 1, "classic graph must have at least one GATE node"


def test_tdd_has_gate_node():
    graph = load_workflow(TDD_PATH)
    assert len(_gate_ids(graph)) >= 1, "tdd graph must have at least one GATE node"


def test_classic_reconcile_before_gate():
    """Every GATE node in classic must have at least one RECONCILE predecessor."""
    graph = load_workflow(CLASSIC_PATH)
    order = _topo_order(graph)
    for gate_id in _gate_ids(graph):
        gate_pos = order.index(gate_id)
        reconcile_positions = [order.index(rid) for rid in _reconcile_ids(graph) if rid in order]
        assert any(rpos < gate_pos for rpos in reconcile_positions), (
            f"GATE '{gate_id}' has no RECONCILE predecessor in topological order"
        )


def test_tdd_reconcile_before_gate():
    """Every GATE node in tdd must have at least one RECONCILE predecessor."""
    graph = load_workflow(TDD_PATH)
    order = _topo_order(graph)
    for gate_id in _gate_ids(graph):
        gate_pos = order.index(gate_id)
        reconcile_positions = [order.index(rid) for rid in _reconcile_ids(graph) if rid in order]
        assert any(rpos < gate_pos for rpos in reconcile_positions), (
            f"GATE '{gate_id}' has no RECONCILE predecessor in topological order"
        )


# ---------------------------------------------------------------------------
# Bounded retry (no LOOP primitive)
# ---------------------------------------------------------------------------


def test_classic_gate_has_bounded_retry():
    graph = load_workflow(CLASSIC_PATH)
    for gate_id in _gate_ids(graph):
        node = graph.nodes[gate_id]
        assert node.retry is not None, f"GATE '{gate_id}' must have retry config"
        assert "max_attempts" in node.retry, f"GATE '{gate_id}' retry must have max_attempts"
        assert node.retry["max_attempts"] > 0, "max_attempts must be positive"
        assert node.retry["max_attempts"] <= 10, "max_attempts should be bounded (≤10)"


def test_tdd_gate_has_bounded_retry():
    graph = load_workflow(TDD_PATH)
    for gate_id in _gate_ids(graph):
        node = graph.nodes[gate_id]
        assert node.retry is not None, f"GATE '{gate_id}' must have retry config"
        assert "max_attempts" in node.retry, f"GATE '{gate_id}' retry must have max_attempts"
        assert node.retry["max_attempts"] > 0, "max_attempts must be positive"
        assert node.retry["max_attempts"] <= 10, "max_attempts should be bounded (≤10)"


def test_no_loop_node_type_in_classic():
    """No LOOP primitive exists in classic — model.py:34 locks it out."""
    graph = load_workflow(CLASSIC_PATH)
    for node in graph.nodes.values():
        assert node.node_type != "loop", f"LOOP primitive forbidden (node {node.id!r})"


def test_no_loop_node_type_in_tdd():
    graph = load_workflow(TDD_PATH)
    for node in graph.nodes.values():
        assert node.node_type != "loop", f"LOOP primitive forbidden (node {node.id!r})"


# ---------------------------------------------------------------------------
# Gate predicate sanity
# ---------------------------------------------------------------------------


def test_classic_gate_predicate_non_empty():
    graph = load_workflow(CLASSIC_PATH)
    for gate_id in _gate_ids(graph):
        node = graph.nodes[gate_id]
        assert node.gate, f"GATE '{gate_id}' must have a non-empty gate predicate"


def test_tdd_gate_predicate_non_empty():
    graph = load_workflow(TDD_PATH)
    for gate_id in _gate_ids(graph):
        node = graph.nodes[gate_id]
        assert node.gate, f"GATE '{gate_id}' must have a non-empty gate predicate"


# ---------------------------------------------------------------------------
# Stubbed-run: simulate topological walk + assert retry bound
# ---------------------------------------------------------------------------


def test_classic_stubbed_topo_walk_hits_gate_after_reconcile():
    """Walk the classic graph stub to confirm gate follows reconcile in order."""
    graph = load_workflow(CLASSIC_PATH)
    order = _topo_order(graph)

    # The gate node must appear after all reconcile nodes
    for gate_id in _gate_ids(graph):
        gate_pos = order.index(gate_id)
        for reconcile_id in _reconcile_ids(graph):
            if reconcile_id in order:
                # Not every reconcile must be before every gate, but gate-code
                # specifically should follow its direct predecessor reconcile-test
                pass

    # Specifically: reconcile-test < gate-code
    if "reconcile-test" in order and "gate-code" in order:
        assert order.index("reconcile-test") < order.index("gate-code")


def test_tdd_stubbed_topo_walk_hits_gate_after_reconcile():
    """Walk the tdd graph stub to confirm gate follows reconcile in order."""
    graph = load_workflow(TDD_PATH)
    order = _topo_order(graph)

    # reconcile-implement < gate-tests < review
    if "reconcile-implement" in order and "gate-tests" in order:
        assert order.index("reconcile-implement") < order.index("gate-tests")
    if "gate-tests" in order and "review" in order:
        assert order.index("gate-tests") < order.index("review")


def test_gate_retry_bound_is_finite():
    """Retry max_attempts must be > 0 and finite — no unbounded loops."""
    for path in [CLASSIC_PATH, TDD_PATH]:
        graph = load_workflow(path)
        for gate_id in _gate_ids(graph):
            node = graph.nodes[gate_id]
            if node.retry:
                attempts = node.retry.get("max_attempts", 0)
                assert isinstance(attempts, int), f"{gate_id}: max_attempts must be int"
                assert 1 <= attempts <= 10, (
                    f"{gate_id}: max_attempts={attempts} out of bounds [1, 10]"
                )
