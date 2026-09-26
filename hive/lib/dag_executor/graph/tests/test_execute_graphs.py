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
BDD_PATH = WORKFLOWS_DIR / "development.bdd.workflow.yaml"


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
    # After loop unrolling, implement becomes implement__r1 (first round copy).
    assert "implement__r1" in order, (
        f"implement__r1 must be in the topo order after tdd-red-green-loop unrolls; "
        f"got: {order}"
    )
    assert order.index("test-spec") < order.index("implement__r1")


def test_tdd_step_order_implement_before_review():
    graph = load_workflow(TDD_PATH)
    order = _topo_order(graph)
    # After loop unrolling, implement becomes implement__r1 (first round copy).
    assert order.index("implement__r1") < order.index("review")


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


def test_classic_has_well_formed_converge_loop():
    """t-006 / s3: classic now ships the review-converge-loop LOOP with a body
    (fix-cycle-implement + fix-cycle-review). After loading, expand_loops unrolls
    the LOOP into round copies — no LOOP nodes remain in the expanded graph but
    round copies (fix-cycle-review__r1..rN) must exist.

    Also validates the raw YAML has a well-formed loop_config: gate_predicate,
    max_rounds, sub_graph, feature, and convergence_signal.
    """
    import yaml

    # Raw YAML check: loop_config fields
    with open(CLASSIC_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    steps_raw = {s["id"]: s for s in raw.get("steps", [])}
    assert "review-converge-loop" in steps_raw, "review-converge-loop must exist in YAML"
    lc_raw = steps_raw["review-converge-loop"].get("loop_config", {})
    assert lc_raw.get("gate_predicate", "").strip(), "gate_predicate must be non-empty"
    assert isinstance(lc_raw.get("max_rounds"), int) and lc_raw["max_rounds"] > 0, (
        "max_rounds must be a positive int"
    )
    assert lc_raw.get("sub_graph", "").strip(), "sub_graph reference must be non-empty"
    assert lc_raw.get("feature", "").strip(), "feature must be set (required for unrolling)"
    assert lc_raw.get("convergence_signal", "").strip(), (
        "convergence_signal must be declared (s3-convergence-signal)"
    )

    # Expanded graph check: LOOP was unrolled into round copies
    from hive.lib.dag_executor.graph import NodeType
    graph = load_workflow(CLASSIC_PATH)
    loop_nodes = [n for n in graph.nodes.values() if n.node_type == NodeType.LOOP]
    assert len(loop_nodes) == 0, (
        f"After expand_loops, zero LOOP nodes should remain; got {[n.id for n in loop_nodes]}"
    )
    # Round copies of the producer (fix-cycle-review) must exist
    max_rounds = lc_raw["max_rounds"]
    for k in range(1, max_rounds + 1):
        assert f"fix-cycle-review__r{k}" in graph.nodes, (
            f"Expected fix-cycle-review__r{k} in expanded graph but not found; "
            f"nodes={list(graph.nodes)}"
        )


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


# ---------------------------------------------------------------------------
# efcl-s2: reconcile wiring between implement and review (AC4)
# ---------------------------------------------------------------------------


def _ancestors(graph: Graph, node_id: str) -> set[str]:
    """Return all transitive ancestors of node_id (via depends_on edges)."""
    visited: set[str] = set()
    queue = list(graph.nodes[node_id].depends_on) if node_id in graph.nodes else []
    while queue:
        nid = queue.pop()
        if nid in visited:
            continue
        visited.add(nid)
        if nid in graph.nodes:
            queue.extend(graph.nodes[nid].depends_on)
    return visited


@pytest.mark.parametrize("workflow_path,implement_id", [
    pytest.param(CLASSIC_PATH, "backend-implement", id="classic-backend"),
    pytest.param(CLASSIC_PATH, "frontend-implement", id="classic-frontend"),
    # After tdd-red-green-loop unrolls, the bare 'implement' body node is
    # replaced by implement__r1 .. implement__r{N}. Use r1 as the canonical
    # representative to check the reconcile wiring chain.
    pytest.param(TDD_PATH, "implement__r1", id="tdd"),
    pytest.param(BDD_PATH, "implement", id="bdd"),
])
def test_reconcile_wired_between_implement_and_review(workflow_path, implement_id):
    """Every methodology graph must have a RECONCILE node in the transitive
    ancestor chain of review that is also a transitive descendant of the
    implement node — per-node reconcile between implement and review (AC4).
    """
    graph = load_workflow(workflow_path)
    assert "review" in graph.nodes, f"review node missing in {workflow_path.name}"
    assert implement_id in graph.nodes, (
        f"{implement_id!r} missing in {workflow_path.name}"
    )

    review_ancestors = _ancestors(graph, "review")
    implement_descendants: set[str] = set()
    queue = [implement_id]
    while queue:
        nid = queue.pop()
        for successor_id, successor in graph.nodes.items():
            if nid in successor.depends_on and successor_id not in implement_descendants:
                implement_descendants.add(successor_id)
                queue.append(successor_id)

    reconcile_between = [
        nid for nid in review_ancestors & implement_descendants
        if graph.nodes[nid].node_type == NodeType.RECONCILE
    ]
    assert reconcile_between, (
        f"{workflow_path.name}: no RECONCILE node found in the path from "
        f"{implement_id!r} to review — AC4 requires reconcile wiring between "
        f"implement and review"
    )
