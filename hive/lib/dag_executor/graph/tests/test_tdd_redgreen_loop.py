"""s5-tdd-redgreen-loop: TDD RED phase — failing tests pinning expected behavior.

Acceptance criteria (from story spec s5-tdd-redgreen-loop.yaml):
  AC1: tests_green=true at round 2 → round 3 implement/test nodes are skipped
       (structural: round 3 skip_when references tester body node r2.output.tests_green == true)
  AC2: tests_green never true → all max_rounds run, then terminal gate-tests-green blocks integrate
  AC3: loops.tdd_red_green.enabled=false → single degenerate implement→test pass (no rounds)
  AC4: loops.tdd_red_green.max_rounds=5 → up to 5 round-copies emitted in expanded graph

Structural guards:
  S1: development.tdd.workflow.yaml must contain a tdd-red-green-loop LOOP node
  S2: tdd-red-green-loop must declare feature: tdd_red_green and convergence_signal: tests_green
  S3: body nodes (implement + tester) must carry sub_graph: tdd-red-green-cycle
  S4: tester body node must declare output tests_green of type json
  S5: gate-tests-green must exist and use a grammar-legal dotpath predicate
  S6: integrate must depend on both tdd-red-green-loop and gate-tests-green (pre-unroll)

Known limitation — AC1 early-convergence end-to-end path (skip-forward):
  When convergence happens at round k < max_rounds, tdd-tester__r{k+1..N} carry
  skip_when and are skipped by the walker.  The walker currently maps skipped-node
  outputs to None (walker.py:637).  gate-tests-green references tdd-tester__rN
  (the static last round), so its dotpath predicate evaluates against None →
  fail-closed → integrate is blocked even though convergence happened at r{k}.
  Fix requires skip-forward output propagation in the walker or the unroller;
  both are outside this bounded slice.  Tests E1/E2 below cover the gate
  handler behaviour with a direct-invocation harness so the gate logic is
  validated independently of the walker skip path.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml

from hive.lib.dag_executor.executor.errors import GateFailedError
from hive.lib.dag_executor.executor.handlers.agent import NodeOutput
from hive.lib.dag_executor.executor.handlers.gate import GateHandler
from hive.lib.dag_executor.graph import NodeType, load_workflow


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_WORKFLOWS = Path(__file__).resolve().parents[5] / "hive" / "workflows"
TDD_PATH = _WORKFLOWS / "development.tdd.workflow.yaml"

_LOOP_ID = "tdd-red-green-loop"
_GATE_ID = "gate-tests-green"
_SUB_GRAPH = "tdd-red-green-cycle"
_SIGNAL = "tests_green"
_FEATURE = "tdd_red_green"


# ---------------------------------------------------------------------------
# S1 / S2: LOOP node exists in raw YAML with correct loop_config
# ---------------------------------------------------------------------------


def test_tdd_loop_node_present_in_yaml():
    """S1: development.tdd.workflow.yaml must declare a tdd-red-green-loop LOOP node.

    FAILS RED because the current TDD workflow has a flat implement→test structure
    with no LOOP node.
    """
    with open(TDD_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    steps = {s["id"]: s for s in raw.get("steps", [])}
    assert _LOOP_ID in steps, (
        f"tdd-red-green-loop LOOP node must exist in development.tdd.workflow.yaml; "
        f"found steps: {list(steps)!r}"
    )
    node = steps[_LOOP_ID]
    assert node.get("node_type") == "loop", (
        f"tdd-red-green-loop must have node_type: loop; got {node.get('node_type')!r}"
    )


def test_tdd_loop_config_feature_and_signal():
    """S2: loop_config must declare feature: tdd_red_green and convergence_signal: tests_green.

    FAILS RED because tdd-red-green-loop does not yet exist.
    """
    with open(TDD_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    steps = {s["id"]: s for s in raw.get("steps", [])}
    assert _LOOP_ID in steps, "tdd-red-green-loop must exist (see test_tdd_loop_node_present_in_yaml)"
    lc = steps[_LOOP_ID].get("loop_config", {})
    assert lc.get("feature") == _FEATURE, (
        f"loop_config.feature must be 'tdd_red_green'; got {lc.get('feature')!r}"
    )
    assert lc.get("convergence_signal") == _SIGNAL, (
        f"loop_config.convergence_signal must be 'tests_green'; got {lc.get('convergence_signal')!r}"
    )
    assert lc.get("sub_graph") == _SUB_GRAPH, (
        f"loop_config.sub_graph must be 'tdd-red-green-cycle'; got {lc.get('sub_graph')!r}"
    )
    assert isinstance(lc.get("max_rounds"), int) and lc["max_rounds"] >= 2, (
        f"loop_config.max_rounds must be an int >= 2; got {lc.get('max_rounds')!r}"
    )


# ---------------------------------------------------------------------------
# S3 / S4: body nodes in raw YAML
# ---------------------------------------------------------------------------


def test_body_nodes_carry_sub_graph_tag():
    """S3: implement and at least one tester node must carry sub_graph: tdd-red-green-cycle.

    FAILS RED because current TDD workflow nodes have no sub_graph tag.
    """
    with open(TDD_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    body_nodes = [s for s in raw.get("steps", []) if s.get("sub_graph") == _SUB_GRAPH]
    assert len(body_nodes) >= 2, (
        f"At least 2 body nodes must carry sub_graph: tdd-red-green-cycle; "
        f"found {len(body_nodes)}: {[n['id'] for n in body_nodes]!r}"
    )
    body_ids = {n["id"] for n in body_nodes}
    assert "implement" in body_ids, (
        f"'implement' must be a body node in sub_graph tdd-red-green-cycle; "
        f"body nodes found: {sorted(body_ids)!r}"
    )


def test_tester_body_node_declares_tests_green_output():
    """S4: one body node must declare output 'tests_green' of type json.

    FAILS RED because no body node currently exists, let alone declares tests_green.
    """
    with open(TDD_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    body_nodes = [s for s in raw.get("steps", []) if s.get("sub_graph") == _SUB_GRAPH]
    producers = []
    for node in body_nodes:
        for out in node.get("outputs", []):
            if out.get("name") == _SIGNAL and out.get("type") == "json":
                producers.append(node["id"])
    assert producers, (
        f"At least one body node in sub_graph '{_SUB_GRAPH}' must declare "
        f"output '{_SIGNAL}' with type json. Body nodes: "
        f"{[n['id'] for n in body_nodes]!r}"
    )


# ---------------------------------------------------------------------------
# S5: gate-tests-green in raw YAML + grammar-legal predicate
# ---------------------------------------------------------------------------


def test_tdd_gate_tests_green_present_in_yaml():
    """S5a: gate-tests-green must exist with node_type: gate in raw YAML.

    FAILS RED because gate-tests-green does not yet exist in the workflow.
    """
    with open(TDD_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    steps = {s["id"]: s for s in raw.get("steps", [])}
    assert _GATE_ID in steps, (
        f"gate-tests-green must exist in development.tdd.workflow.yaml; "
        f"found steps: {list(steps)!r}"
    )
    node = steps[_GATE_ID]
    assert node.get("node_type") == "gate", (
        f"gate-tests-green must have node_type: gate; got {node.get('node_type')!r}"
    )


def test_tdd_gate_tests_green_uses_dotpath_predicate():
    """S5b: gate-tests-green.gate must be a grammar-legal dotpath predicate referencing tests_green.

    FAILS RED because gate-tests-green does not yet exist.
    """
    with open(TDD_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    steps = {s["id"]: s for s in raw.get("steps", [])}
    assert _GATE_ID in steps, "gate-tests-green must exist (see test_tdd_gate_tests_green_present_in_yaml)"
    gate_pred = steps[_GATE_ID].get("gate", "")
    # Grammar-legal dotpath form: $<node_id>.output.tests_green == true
    assert _SIGNAL in gate_pred, (
        f"gate-tests-green.gate must reference 'tests_green'; got {gate_pred!r}"
    )
    assert gate_pred.startswith("$"), (
        f"gate-tests-green.gate must be a dotpath predicate starting with '$'; "
        f"got {gate_pred!r}"
    )
    assert "== true" in gate_pred, (
        f"gate-tests-green.gate must assert '== true'; got {gate_pred!r}"
    )


# ---------------------------------------------------------------------------
# S6: integrate wiring in raw YAML (pre-unroll)
# ---------------------------------------------------------------------------


def test_integrate_depends_on_loop_and_gate_preunroll():
    """S6: integrate must depend on tdd-red-green-loop and gate-tests-green (pre-unroll).

    FAILS RED because integrate currently depends on ['review', 'gate-review'], not the
    tdd-red-green loop or terminal gate.
    """
    with open(TDD_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    steps = {s["id"]: s for s in raw.get("steps", [])}
    integrate_deps = steps.get("integrate", {}).get("depends_on", [])
    assert _LOOP_ID in integrate_deps, (
        f"integrate must depend on tdd-red-green-loop in raw YAML (pre-unroll); "
        f"got {integrate_deps!r}"
    )
    assert _GATE_ID in integrate_deps, (
        f"integrate must depend on gate-tests-green in raw YAML (pre-unroll); "
        f"got {integrate_deps!r}"
    )


# ---------------------------------------------------------------------------
# AC3: config toggle — enabled=false → single degenerate pass
# ---------------------------------------------------------------------------


def test_ac3_disabled_loop_emits_single_pass(monkeypatch):
    """AC3: when loops.tdd_red_green.enabled=false, exactly one round of body nodes is emitted.

    Only implement__r1 (and the tester body__r1) appear. No __r2 copies.

    FAILS RED because tdd-red-green-loop does not yet exist so load_workflow
    produces no round copies at all.
    """
    monkeypatch.setenv("HIVE_LOOPS_TDD_RED_GREEN_ENABLED", "false")
    graph = load_workflow(TDD_PATH)

    # Body node ids should appear as __r1 only (single degenerate pass)
    round_1_implement = "implement__r1"
    assert round_1_implement in graph.nodes, (
        f"When tdd_red_green disabled, implement__r1 must exist; "
        f"nodes: {sorted(graph.nodes)!r}"
    )
    # Round 2 must NOT exist — disabled means single pass
    round_2_implement = "implement__r2"
    assert round_2_implement not in graph.nodes, (
        f"When tdd_red_green disabled, implement__r2 must NOT exist; "
        f"nodes: {sorted(graph.nodes)!r}"
    )
    # The bare (unrolled) LOOP node must be gone
    assert _LOOP_ID not in graph.nodes, (
        f"After expansion, tdd-red-green-loop LOOP node must be removed; "
        f"nodes: {sorted(graph.nodes)!r}"
    )


# ---------------------------------------------------------------------------
# AC4: max_rounds=5 → 5 round-copies emitted
# ---------------------------------------------------------------------------


def test_ac4_max_rounds_5_emits_five_round_copies(monkeypatch):
    """AC4: when max_rounds=5, the expander emits implement__r1..r5 (5 copies).

    FAILS RED because no LOOP node exists yet → no round copies at all.
    """
    monkeypatch.setenv("HIVE_LOOPS_TDD_RED_GREEN_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_TDD_RED_GREEN_MAX_ROUNDS", "5")
    graph = load_workflow(TDD_PATH)

    for k in range(1, 6):
        rid = f"implement__r{k}"
        assert rid in graph.nodes, (
            f"max_rounds=5 must emit implement__r{k}; "
            f"implement round nodes found: {sorted(n for n in graph.nodes if 'implement__r' in n)!r}"
        )
    # Round 6 must NOT exist
    assert "implement__r6" not in graph.nodes, (
        "max_rounds=5 must not emit implement__r6"
    )


# ---------------------------------------------------------------------------
# AC1: convergence short-circuit — skip_when on round 3+ nodes
# ---------------------------------------------------------------------------


def test_ac1_round3_nodes_carry_skip_when_on_tests_green(monkeypatch):
    """AC1: when max_rounds >= 3, each round-k>1 body node carries skip_when referencing
    the tester's prior-round tests_green output in dotpath form.

    Specifically: round 3 implement node must have skip_when pointing at
    <tester_body_id>__r2.output.tests_green == true.

    FAILS RED because no LOOP node / round copies exist yet.
    """
    monkeypatch.setenv("HIVE_LOOPS_TDD_RED_GREEN_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_TDD_RED_GREEN_MAX_ROUNDS", "3")
    graph = load_workflow(TDD_PATH)

    # Round 1 must NOT have a skip_when
    r1_impl = graph.nodes.get("implement__r1")
    assert r1_impl is not None, (
        "implement__r1 must exist when max_rounds=3"
    )
    assert r1_impl.skip_when is None, (
        f"implement__r1.skip_when must be None (always runs); got {r1_impl.skip_when!r}"
    )

    # Round 3 body nodes must have skip_when referencing <tester>__r2.output.tests_green == true
    r3_impl = graph.nodes.get("implement__r3")
    assert r3_impl is not None, (
        "implement__r3 must exist when max_rounds=3"
    )
    assert r3_impl.skip_when is not None, (
        "implement__r3.skip_when must be set (convergence short-circuit)"
    )
    # Must reference prior round's tests_green in dotpath form
    assert _SIGNAL in r3_impl.skip_when, (
        f"implement__r3.skip_when must reference '{_SIGNAL}'; got {r3_impl.skip_when!r}"
    )
    assert "__r2.output." in r3_impl.skip_when, (
        f"implement__r3.skip_when must reference a __r2 round copy; got {r3_impl.skip_when!r}"
    )
    assert "== true" in r3_impl.skip_when, (
        f"implement__r3.skip_when must assert '== true'; got {r3_impl.skip_when!r}"
    )


# ---------------------------------------------------------------------------
# AC2: max_rounds exhausted + terminal gate blocks integrate
# ---------------------------------------------------------------------------


def test_ac2_gate_tests_green_in_expanded_graph(monkeypatch):
    """AC2 (structural): gate-tests-green must exist in the expanded graph as a GATE node.

    After max_rounds run, gate-tests-green blocks integrate when tests_green != true.

    FAILS RED because gate-tests-green is not in the YAML yet.
    """
    monkeypatch.setenv("HIVE_LOOPS_TDD_RED_GREEN_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_TDD_RED_GREEN_MAX_ROUNDS", "3")
    graph = load_workflow(TDD_PATH)

    assert _GATE_ID in graph.nodes, (
        f"gate-tests-green must exist in expanded TDD graph; "
        f"nodes: {sorted(graph.nodes)!r}"
    )
    gate_node = graph.nodes[_GATE_ID]
    assert gate_node.node_type == NodeType.GATE, (
        f"gate-tests-green must be a GATE node; got {gate_node.node_type!r}"
    )


def test_ac2_gate_tests_green_rewired_to_last_round(monkeypatch):
    """AC2 (structural): after expansion, gate-tests-green must depend on the last round's
    tester body node exit (e.g. <tester>__r3 when max_rounds=3), not the LOOP node.

    FAILS RED because gate-tests-green does not exist yet.
    """
    monkeypatch.setenv("HIVE_LOOPS_TDD_RED_GREEN_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_TDD_RED_GREEN_MAX_ROUNDS", "3")
    graph = load_workflow(TDD_PATH)

    assert _GATE_ID in graph.nodes, "gate-tests-green must exist in expanded graph"
    gate_node = graph.nodes[_GATE_ID]

    # The LOOP node must NOT appear in depends_on after unrolling
    assert _LOOP_ID not in gate_node.depends_on, (
        f"After unrolling, {_LOOP_ID} must NOT appear in gate-tests-green.depends_on; "
        f"got {gate_node.depends_on!r}"
    )
    # Must depend on a last-round body node (__r3)
    last_round_deps = [dep for dep in gate_node.depends_on if "__r3" in dep]
    assert last_round_deps, (
        f"gate-tests-green must depend on a __r3 (last round) body node after unrolling; "
        f"got {gate_node.depends_on!r}"
    )


def test_ac2_gate_predicate_rewired_to_last_round_producer(monkeypatch):
    """AC2 (structural): gate-tests-green.gate must reference the last-round tester body node
    (e.g. $<tester>__r3.output.tests_green == true) after unrolling, not the LOOP node id.

    FAILS RED because gate-tests-green does not exist yet.
    """
    monkeypatch.setenv("HIVE_LOOPS_TDD_RED_GREEN_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_TDD_RED_GREEN_MAX_ROUNDS", "3")
    graph = load_workflow(TDD_PATH)

    assert _GATE_ID in graph.nodes, "gate-tests-green must exist in expanded graph"
    gate_node = graph.nodes[_GATE_ID]

    gate_pred = gate_node.gate or ""
    assert _SIGNAL in gate_pred, (
        f"gate-tests-green.gate must reference '{_SIGNAL}' after expansion; got {gate_pred!r}"
    )
    # After unrolling, the LOOP node id must not appear in the predicate
    assert _LOOP_ID not in gate_pred, (
        f"After unrolling, '{_LOOP_ID}' must not appear in gate-tests-green.gate; "
        f"got {gate_pred!r}"
    )
    # Must reference last round __r3
    assert "__r3" in gate_pred, (
        f"gate-tests-green.gate must reference __r3 (last round) after unrolling; "
        f"got {gate_pred!r}"
    )


def test_ac2_integrate_depends_on_gate_in_expanded_graph(monkeypatch):
    """AC2 (structural): in the expanded graph, integrate must depend on gate-tests-green
    so it cannot run until the terminal gate passes.

    FAILS RED because gate-tests-green and the loop do not exist yet.
    """
    monkeypatch.setenv("HIVE_LOOPS_TDD_RED_GREEN_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_TDD_RED_GREEN_MAX_ROUNDS", "3")
    graph = load_workflow(TDD_PATH)

    integrate = graph.nodes.get("integrate")
    assert integrate is not None, "integrate node must exist in TDD graph"
    assert _GATE_ID in integrate.depends_on, (
        f"integrate must depend on gate-tests-green in expanded graph; "
        f"got {integrate.depends_on!r}"
    )
    # After unrolling, the bare LOOP node must not appear in integrate.depends_on
    assert _LOOP_ID not in integrate.depends_on, (
        f"After unrolling, tdd-red-green-loop must not appear in integrate.depends_on; "
        f"got {integrate.depends_on!r}"
    )


# ---------------------------------------------------------------------------
# E1/E2: executor-level gate handler tests (finding 4 — coverage gap)
#
# These tests exercise GateHandler directly with a manually constructed
# materialised-output dict, bypassing the walker.  They pin the gate's
# dotpath-predicate evaluation logic for the TDD convergence signal so that
# the gate behaviour is tested independently of the walker's skip-forward
# limitation (see module docstring for the full limitation description).
# ---------------------------------------------------------------------------


def _make_output_graph(per_node: dict[str, dict]) -> dict[str, dict]:
    """Wrap per-node output dicts in the ``{node_id: {output: {...}}}`` shape
    that GateHandler's ``__output_graph`` input expects."""
    return {node_id: {"output": outputs} for node_id, outputs in per_node.items()}


def test_e1_gate_tests_green_passes_when_last_round_emits_true(monkeypatch):
    """E1: GateHandler returns gate_passed=True when the last-round tester emits tests_green=True.

    This is the positive path for AC2 (all max_rounds run; terminal round achieves
    green).  The gate predicate is evaluated against a materialised output graph that
    includes tdd-tester__r3.output.tests_green=True, matching the expanded gate
    predicate ``$tdd-tester__r3.output.tests_green == true``.
    """
    monkeypatch.setenv("HIVE_LOOPS_TDD_RED_GREEN_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_TDD_RED_GREEN_MAX_ROUNDS", "3")
    graph = load_workflow(TDD_PATH)

    gate_node = graph.nodes[_GATE_ID]
    # Confirm the gate predicate was rewritten to reference __r3 (unroller contract)
    gate_pred = gate_node.gate or ""
    assert "__r3" in gate_pred, (
        f"E1 pre-condition: gate predicate must reference __r3; got {gate_pred!r}"
    )

    # Simulate: r1 ran (red), r2 ran (red), r3 ran (green)
    output_graph = _make_output_graph({
        "tdd-tester__r1": {"tests_green": False},
        "tdd-tester__r2": {"tests_green": False},
        "tdd-tester__r3": {"tests_green": True},
    })

    handler = GateHandler()
    result = handler.handle(gate_node, {"__output_graph": output_graph}, "run-e1")
    assert result.outputs.get("gate_passed") is True, (
        "gate-tests-green must pass when tdd-tester__r3.output.tests_green=True"
    )


def test_e2_gate_tests_green_blocks_when_tests_never_green(monkeypatch):
    """E2: GateHandler raises GateFailedError when last-round tester emits tests_green=False.

    This is the blocking path for AC2: when tests_green is never True across all
    max_rounds, the terminal gate must block integrate (fail loud, not silent pass).
    """
    monkeypatch.setenv("HIVE_LOOPS_TDD_RED_GREEN_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_TDD_RED_GREEN_MAX_ROUNDS", "3")
    graph = load_workflow(TDD_PATH)

    gate_node = graph.nodes[_GATE_ID]

    # Simulate: all 3 rounds ran and none achieved green
    output_graph = _make_output_graph({
        "tdd-tester__r1": {"tests_green": False},
        "tdd-tester__r2": {"tests_green": False},
        "tdd-tester__r3": {"tests_green": False},
    })

    handler = GateHandler()
    with pytest.raises(GateFailedError, match="tests_green"):
        handler.handle(gate_node, {"__output_graph": output_graph}, "run-e2")


def test_e3_implement_body_node_declares_commit_metadata_outputs(monkeypatch):
    """E3: the implement body node must declare commit_sha/branch/repo/work_dir outputs.

    This guards finding 2: without these output declarations the unroller's
    output_producers map has no entry for commit metadata and falls back to the
    tester exit node (tdd-tester__rN), which only emits tests_green.  With the
    declarations, output_producers correctly maps commit_sha/branch/repo/work_dir
    to implement__rN so reconcile-implement binds from the right body node.

    Note: on early convergence (implement__rN skipped) these still resolve to None
    via the walker's skip→None path; that requires the paired skip-forward story.
    """
    with open(TDD_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)

    steps = {s["id"]: s for s in raw.get("steps", [])}
    implement = steps.get("implement")
    assert implement is not None, "implement body node must exist in YAML"
    output_names = {o["name"] for o in implement.get("outputs", [])}

    for field in ("commit_sha", "branch", "repo", "work_dir"):
        assert field in output_names, (
            f"implement body node must declare output '{field}' so the unroller "
            f"maps commit metadata to implement__rN (not the tester fallback); "
            f"declared outputs: {sorted(output_names)!r}"
        )
