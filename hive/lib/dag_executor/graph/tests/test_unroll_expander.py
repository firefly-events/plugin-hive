"""s2-unroll-expander: TDD RED phase — failing tests that pin the expected behavior.

Acceptance criteria (from story spec s2-unroll-expander.yaml):
  AC1: max_rounds=3 enabled → 3 body-copy sets, 0 LOOP nodes, validates
  AC2: loops.<feature>.enabled=false → exactly one body pass, no round-gates
  AC3: max_rounds=1 → single degenerate body pass
  AC4: deterministic ids — same node ids across two loads of the same workflow
  AC5: each round-copy k>1 carries skip_when referencing the convergence signal
  AC6: terminal gate node survives as a distinct node regardless of enabled/max_rounds
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from hive.lib.dag_executor.graph import NodeType, load_workflow, validate_graph


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

def _write_workflow(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "synthetic.workflow.yaml"
    path.write_text(body, encoding="utf-8")
    return path


def _loop_fixture(max_rounds: int = 3) -> str:
    """Minimal workflow with one LOOP node, two body nodes, and a terminal gate."""
    return f"""
name: unroll-test
version: "1.0.0"
steps:
  - id: pre-loop
    agent: developer

  - id: review-converge-loop
    node_type: loop
    agent: ""
    loop_config:
      sub_graph: review-fix-cycle
      gate_predicate: "review_verdict not equals needs_revision"
      max_rounds: {max_rounds}
      feature: review_converge
    depends_on: [pre-loop]

  - id: fix-step
    agent: developer
    sub_graph: review-fix-cycle
    depends_on: [pre-loop]

  - id: review-step
    agent: reviewer
    sub_graph: review-fix-cycle
    depends_on: [fix-step]

  - id: terminal-gate
    node_type: gate
    agent: ""
    gate: "review_verdict not equals needs_revision"
    depends_on: [review-converge-loop]

  - id: integrate
    agent: developer
    depends_on: [terminal-gate]
"""


# ---------------------------------------------------------------------------
# AC1: max_rounds=3 enabled → 3 body-copy sets, 0 LOOP nodes, validates
# ---------------------------------------------------------------------------


def test_ac1_three_rounds_zero_loop_nodes_validates(tmp_path: Path, monkeypatch):
    """After unrolling a 3-round LOOP node, the graph must have exactly 3 copies
    of every body node, zero LOOP-type nodes, and must pass validate_graph."""
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_MAX_ROUNDS", "3")

    graph = load_workflow(_write_workflow(tmp_path, _loop_fixture(max_rounds=3)))

    # Zero LOOP nodes must remain after expansion
    loop_nodes = [n for n in graph.nodes.values() if n.node_type == NodeType.LOOP]
    assert loop_nodes == [], (
        f"Expected 0 LOOP nodes after expansion; found {[n.id for n in loop_nodes]!r}"
    )

    # Exactly 3 copies of each body node (fix-step__r1 .. fix-step__r3)
    for k in range(1, 4):
        assert f"fix-step__r{k}" in graph.nodes, (
            f"Expected round-copy fix-step__r{k} in graph; got {sorted(graph.nodes)!r}"
        )
        assert f"review-step__r{k}" in graph.nodes, (
            f"Expected round-copy review-step__r{k} in graph"
        )

    # No bare (unexpanded) body node ids remain
    assert "fix-step" not in graph.nodes, (
        "Bare body node 'fix-step' must be removed after expansion"
    )
    assert "review-step" not in graph.nodes, (
        "Bare body node 'review-step' must be removed after expansion"
    )

    # Graph must validate cleanly (no dangling refs, no cycles)
    validate_graph(graph)


# ---------------------------------------------------------------------------
# AC2: loops.<feature>.enabled=false → exactly one body pass, no round-gates
# ---------------------------------------------------------------------------


def test_ac2_disabled_emits_single_body_pass(tmp_path: Path, monkeypatch):
    """When loops.review_converge.enabled is false, the expander emits exactly
    one body pass (round 1), no round-gate nodes, and zero LOOP nodes."""
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_ENABLED", "false")

    graph = load_workflow(_write_workflow(tmp_path, _loop_fixture(max_rounds=3)))

    # Zero LOOP nodes
    loop_nodes = [n for n in graph.nodes.values() if n.node_type == NodeType.LOOP]
    assert loop_nodes == [], (
        f"Expected 0 LOOP nodes after disabled expansion; found {[n.id for n in loop_nodes]!r}"
    )

    # Exactly one round of body nodes
    assert "fix-step__r1" in graph.nodes, (
        "Expected single body pass fix-step__r1 when disabled"
    )
    assert "review-step__r1" in graph.nodes, (
        "Expected single body pass review-step__r1 when disabled"
    )

    # Rounds 2 and 3 must NOT exist
    assert "fix-step__r2" not in graph.nodes, (
        "Round 2 body copy must NOT exist when loop is disabled"
    )
    assert "fix-step__r3" not in graph.nodes, (
        "Round 3 body copy must NOT exist when loop is disabled"
    )

    # No round-gate nodes (no nodes whose id contains "__round_gate")
    round_gate_nodes = [n_id for n_id in graph.nodes if "round_gate" in n_id]
    assert round_gate_nodes == [], (
        f"No round-gate nodes expected when disabled; found {round_gate_nodes!r}"
    )

    validate_graph(graph)


# ---------------------------------------------------------------------------
# AC3: max_rounds=1 → single degenerate body pass
# ---------------------------------------------------------------------------


def test_ac3_max_rounds_one_emits_single_pass(tmp_path: Path, monkeypatch):
    """max_rounds=1 (even when enabled) must emit a single degenerate body pass,
    with no round-gate nodes and no skip_when on the single copy."""
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_MAX_ROUNDS", "1")

    graph = load_workflow(_write_workflow(tmp_path, _loop_fixture(max_rounds=1)))

    loop_nodes = [n for n in graph.nodes.values() if n.node_type == NodeType.LOOP]
    assert loop_nodes == [], (
        f"Expected 0 LOOP nodes for max_rounds=1; found {[n.id for n in loop_nodes]!r}"
    )

    assert "fix-step__r1" in graph.nodes, "Single body pass fix-step__r1 must exist"
    assert "review-step__r1" in graph.nodes, "Single body pass review-step__r1 must exist"
    assert "fix-step__r2" not in graph.nodes, "Round 2 must not exist for max_rounds=1"

    # The single copy must NOT have skip_when (no prior round to gate on)
    assert graph.nodes["fix-step__r1"].skip_when is None, (
        "Round 1 (only round) must have skip_when=None"
    )

    validate_graph(graph)


# ---------------------------------------------------------------------------
# AC4: deterministic ids — byte-identical across two loads
# ---------------------------------------------------------------------------


def test_ac4_node_ids_are_deterministic(tmp_path: Path, monkeypatch):
    """Loading the same workflow twice must produce byte-identical node id sets."""
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_MAX_ROUNDS", "3")

    workflow_path = _write_workflow(tmp_path, _loop_fixture(max_rounds=3))

    graph_a = load_workflow(workflow_path)
    graph_b = load_workflow(workflow_path)

    ids_a = sorted(graph_a.nodes.keys())
    ids_b = sorted(graph_b.nodes.keys())

    assert ids_a == ids_b, (
        f"Node ids must be deterministic across loads.\nFirst:  {ids_a}\nSecond: {ids_b}"
    )

    # Spot-check round ids are present and stable
    for k in range(1, 4):
        assert f"fix-step__r{k}" in graph_a.nodes
        assert f"review-step__r{k}" in graph_a.nodes


# ---------------------------------------------------------------------------
# AC5: each round-copy k>1 carries skip_when referencing the convergence signal
# ---------------------------------------------------------------------------


def test_ac5_skip_when_on_rounds_greater_than_one(tmp_path: Path, monkeypatch):
    """Body-node copies for round k>1 must carry a non-None skip_when value
    that references the convergence signal name from loop_config (a placeholder
    string — concrete predicate wired in s3)."""
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_MAX_ROUNDS", "3")

    graph = load_workflow(_write_workflow(tmp_path, _loop_fixture(max_rounds=3)))

    # Round 1: no skip_when
    assert graph.nodes["fix-step__r1"].skip_when is None, (
        "Round 1 body copy must have skip_when=None (always runs)"
    )
    assert graph.nodes["review-step__r1"].skip_when is None, (
        "Round 1 body copy must have skip_when=None"
    )

    # Rounds 2 and 3: skip_when must be set (non-None, non-empty string)
    for k in range(2, 4):
        skip_when_fix = graph.nodes[f"fix-step__r{k}"].skip_when
        assert skip_when_fix is not None and skip_when_fix != "", (
            f"fix-step__r{k} must have skip_when set to the convergence signal; "
            f"got {skip_when_fix!r}"
        )
        skip_when_review = graph.nodes[f"review-step__r{k}"].skip_when
        assert skip_when_review is not None and skip_when_review != "", (
            f"review-step__r{k} must have skip_when set to the convergence signal; "
            f"got {skip_when_review!r}"
        )


# ---------------------------------------------------------------------------
# AC6: terminal gate survives regardless of enabled/max_rounds
# ---------------------------------------------------------------------------


def test_ac6_terminal_gate_survives_when_enabled(tmp_path: Path, monkeypatch):
    """The terminal gate node (positioned after the loop, not a body member)
    must survive as a distinct non-LOOP node when the loop is enabled."""
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_MAX_ROUNDS", "3")

    graph = load_workflow(_write_workflow(tmp_path, _loop_fixture(max_rounds=3)))

    assert "terminal-gate" in graph.nodes, (
        "terminal-gate must survive as a distinct node when loop is enabled"
    )
    gate_node = graph.nodes["terminal-gate"]
    assert gate_node.node_type == NodeType.GATE, (
        f"terminal-gate must remain a GATE node; got {gate_node.node_type!r}"
    )
    validate_graph(graph)


def test_ac6_terminal_gate_survives_when_disabled(tmp_path: Path, monkeypatch):
    """The terminal gate node must survive as a distinct GATE node even when
    the loop feature is disabled (enabled=false). Dropping it is prod-bug-#26."""
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_ENABLED", "false")

    graph = load_workflow(_write_workflow(tmp_path, _loop_fixture(max_rounds=3)))

    assert "terminal-gate" in graph.nodes, (
        "terminal-gate must survive as a distinct node when loop is DISABLED (prod-bug-#26)"
    )
    gate_node = graph.nodes["terminal-gate"]
    assert gate_node.node_type == NodeType.GATE, (
        f"terminal-gate must remain a GATE node when disabled; got {gate_node.node_type!r}"
    )
    validate_graph(graph)


def test_ac6_terminal_gate_survives_max_rounds_one(tmp_path: Path, monkeypatch):
    """The terminal gate node must survive when max_rounds=1."""
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_MAX_ROUNDS", "1")

    graph = load_workflow(_write_workflow(tmp_path, _loop_fixture(max_rounds=1)))

    assert "terminal-gate" in graph.nodes, (
        "terminal-gate must survive as a distinct node for max_rounds=1"
    )
    assert graph.nodes["terminal-gate"].node_type == NodeType.GATE


# ---------------------------------------------------------------------------
# Structural: expand_loops is importable from graph.unroll (module must exist)
# ---------------------------------------------------------------------------


def test_expand_loops_is_importable():
    """The expander entry-point must be importable from hive.lib.dag_executor.graph.unroll.
    This fails until unroll.py is created."""
    from hive.lib.dag_executor.graph import unroll  # noqa: F401  # module must exist

    assert hasattr(unroll, "expand_loops"), (
        "hive.lib.dag_executor.graph.unroll must export expand_loops()"
    )


# ---------------------------------------------------------------------------
# Structural: LoopConfig must have a `feature` field
# ---------------------------------------------------------------------------


def test_loop_config_has_feature_field():
    """LoopConfig must have a `feature: str | None` field (added by s2).
    This fails until model.py is updated."""
    from hive.lib.dag_executor.graph.model import LoopConfig

    lc = LoopConfig(
        sub_graph="review-fix-cycle",
        gate_predicate="review_verdict not equals needs_revision",
        max_rounds=3,
        feature="review_converge",
    )
    assert lc.feature == "review_converge", (
        f"LoopConfig.feature must round-trip; got {lc.feature!r}"
    )

    lc_none = LoopConfig(
        sub_graph="s",
        gate_predicate="p",
        max_rounds=1,
    )
    assert lc_none.feature is None, (
        "LoopConfig.feature must default to None when not provided"
    )
