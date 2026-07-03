"""s6-bdd-converge-loop: TDD RED phase — failing tests pinning expected behavior.

Acceptance criteria (from story spec s6-bdd-converge-loop.yaml):
  AC1: behavior_satisfied=true at round 2 → round 3 body nodes are Skipped
       (structural: round 3 skip_when references bdd-test__r2.output.behavior_satisfied == true)
  AC2: behavior_satisfied never true → all max_rounds run, then gate-bdd blocks integrate
  AC3: loops.bdd_converge.enabled=false → single degenerate implement→test pass (no __r2 copies)
  AC4: loops.bdd_converge.max_rounds=N → up to N round-copies emitted in expanded graph

Structural guards:
  S1: development.bdd.workflow.yaml must contain a bdd-converge-loop LOOP node
  S2: bdd-converge-loop must declare feature: bdd_converge and convergence_signal: behavior_satisfied
  S3: body nodes (bdd-implement + bdd-test) must carry sub_graph: bdd-converge-cycle
  S4: bdd-test body node must declare output behavior_satisfied of type json
  S5: gate-bdd must exist and use a grammar-legal dotpath predicate referencing behavior_satisfied
  S6: integrate must depend on bdd-converge-loop and gate-bdd (pre-unroll)
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from hive.lib.dag_executor.executor.errors import GateFailedError
from hive.lib.dag_executor.executor.handlers.gate import GateHandler
from hive.lib.dag_executor.graph import NodeType, load_workflow


# ---------------------------------------------------------------------------
# Paths and constants
# ---------------------------------------------------------------------------

_WORKFLOWS = Path(__file__).resolve().parents[5] / "hive" / "workflows"
BDD_PATH = _WORKFLOWS / "development.bdd.workflow.yaml"

_LOOP_ID = "bdd-converge-loop"
_GATE_ID = "gate-bdd"
_SUB_GRAPH = "bdd-converge-cycle"
_SIGNAL = "behavior_satisfied"
_FEATURE = "bdd_converge"
_IMPLEMENT_BODY = "bdd-implement"
_TESTER_BODY = "bdd-test"


# ---------------------------------------------------------------------------
# S1 / S2: LOOP node exists in raw YAML with correct loop_config
# ---------------------------------------------------------------------------


def test_bdd_loop_node_present_in_yaml():
    """S1: development.bdd.workflow.yaml must declare a bdd-converge-loop LOOP node.

    FAILS RED because the current BDD workflow has a flat implement→test structure
    with no LOOP node.
    """
    with open(BDD_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    steps = {s["id"]: s for s in raw.get("steps", [])}
    assert _LOOP_ID in steps, (
        f"bdd-converge-loop LOOP node must exist in development.bdd.workflow.yaml; "
        f"found steps: {list(steps)!r}"
    )
    node = steps[_LOOP_ID]
    assert node.get("node_type") == "loop", (
        f"bdd-converge-loop must have node_type: loop; got {node.get('node_type')!r}"
    )


def test_bdd_loop_config_feature_and_signal():
    """S2: loop_config must declare feature: bdd_converge and convergence_signal: behavior_satisfied.

    FAILS RED because bdd-converge-loop does not yet exist.
    """
    with open(BDD_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    steps = {s["id"]: s for s in raw.get("steps", [])}
    assert _LOOP_ID in steps, "bdd-converge-loop must exist (see test_bdd_loop_node_present_in_yaml)"
    lc = steps[_LOOP_ID].get("loop_config", {})
    assert lc.get("feature") == _FEATURE, (
        f"loop_config.feature must be 'bdd_converge'; got {lc.get('feature')!r}"
    )
    assert lc.get("convergence_signal") == _SIGNAL, (
        f"loop_config.convergence_signal must be 'behavior_satisfied'; "
        f"got {lc.get('convergence_signal')!r}"
    )
    assert lc.get("sub_graph") == _SUB_GRAPH, (
        f"loop_config.sub_graph must be 'bdd-converge-cycle'; got {lc.get('sub_graph')!r}"
    )
    assert isinstance(lc.get("max_rounds"), int) and lc["max_rounds"] >= 2, (
        f"loop_config.max_rounds must be an int >= 2; got {lc.get('max_rounds')!r}"
    )


# ---------------------------------------------------------------------------
# S3 / S4: body nodes in raw YAML
# ---------------------------------------------------------------------------


def test_body_nodes_carry_sub_graph_tag():
    """S3: bdd-implement and bdd-test must carry sub_graph: bdd-converge-cycle.

    FAILS RED because current BDD workflow nodes have no sub_graph tag
    and are named implement/test, not bdd-implement/bdd-test.
    """
    with open(BDD_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    body_nodes = [s for s in raw.get("steps", []) if s.get("sub_graph") == _SUB_GRAPH]
    assert len(body_nodes) >= 2, (
        f"At least 2 body nodes must carry sub_graph: bdd-converge-cycle; "
        f"found {len(body_nodes)}: {[n['id'] for n in body_nodes]!r}"
    )
    body_ids = {n["id"] for n in body_nodes}
    assert _IMPLEMENT_BODY in body_ids, (
        f"'{_IMPLEMENT_BODY}' must be a body node in sub_graph bdd-converge-cycle; "
        f"body nodes found: {sorted(body_ids)!r}"
    )
    assert _TESTER_BODY in body_ids, (
        f"'{_TESTER_BODY}' must be a body node in sub_graph bdd-converge-cycle; "
        f"body nodes found: {sorted(body_ids)!r}"
    )


def test_tester_body_node_declares_behavior_satisfied_output():
    """S4: bdd-test body node must declare output 'behavior_satisfied' of type json.

    FAILS RED because no body node currently exists with sub_graph tag or this output.
    """
    with open(BDD_PATH, encoding="utf-8") as fh:
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
# S5: gate-bdd in raw YAML + grammar-legal predicate
# ---------------------------------------------------------------------------


def test_bdd_gate_bdd_present_in_yaml():
    """S5a: gate-bdd must exist with node_type: gate in raw YAML.

    FAILS RED because gate-bdd does not yet exist in the workflow.
    """
    with open(BDD_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    steps = {s["id"]: s for s in raw.get("steps", [])}
    assert _GATE_ID in steps, (
        f"gate-bdd must exist in development.bdd.workflow.yaml; "
        f"found steps: {list(steps)!r}"
    )
    node = steps[_GATE_ID]
    assert node.get("node_type") == "gate", (
        f"gate-bdd must have node_type: gate; got {node.get('node_type')!r}"
    )


def test_bdd_gate_bdd_uses_dotpath_predicate():
    """S5b: gate-bdd.gate must be a grammar-legal dotpath predicate referencing behavior_satisfied.

    FAILS RED because gate-bdd does not yet exist.
    """
    with open(BDD_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    steps = {s["id"]: s for s in raw.get("steps", [])}
    assert _GATE_ID in steps, "gate-bdd must exist (see test_bdd_gate_bdd_present_in_yaml)"
    gate_pred = steps[_GATE_ID].get("gate", "")
    assert _SIGNAL in gate_pred, (
        f"gate-bdd.gate must reference 'behavior_satisfied'; got {gate_pred!r}"
    )
    assert gate_pred.startswith("$"), (
        f"gate-bdd.gate must be a dotpath predicate starting with '$'; got {gate_pred!r}"
    )
    assert "== true" in gate_pred, (
        f"gate-bdd.gate must assert '== true'; got {gate_pred!r}"
    )


# ---------------------------------------------------------------------------
# S6: integrate wiring in raw YAML (pre-unroll)
# ---------------------------------------------------------------------------


def test_integrate_depends_on_loop_and_gate_preunroll():
    """S6: integrate must depend on bdd-converge-loop and gate-bdd (pre-unroll).

    FAILS RED because integrate currently depends on ['review', 'gate-review'], not the
    bdd-converge-loop or terminal gate-bdd.
    """
    with open(BDD_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    steps = {s["id"]: s for s in raw.get("steps", [])}
    integrate_deps = steps.get("integrate", {}).get("depends_on", [])
    assert _LOOP_ID in integrate_deps, (
        f"integrate must depend on bdd-converge-loop in raw YAML (pre-unroll); "
        f"got {integrate_deps!r}"
    )
    assert _GATE_ID in integrate_deps, (
        f"integrate must depend on gate-bdd in raw YAML (pre-unroll); "
        f"got {integrate_deps!r}"
    )


# ---------------------------------------------------------------------------
# AC3: config toggle — enabled=false → single degenerate pass
# ---------------------------------------------------------------------------


def test_ac3_disabled_loop_emits_single_pass(monkeypatch):
    """AC3: when loops.bdd_converge.enabled=false, exactly one round of body nodes is emitted.

    Only bdd-implement__r1 and bdd-test__r1 appear; no __r2 copies.

    FAILS RED because bdd-converge-loop does not yet exist so load_workflow
    produces no round copies at all.
    """
    monkeypatch.setenv("HIVE_LOOPS_BDD_CONVERGE_ENABLED", "false")
    graph = load_workflow(BDD_PATH)

    round_1_implement = f"{_IMPLEMENT_BODY}__r1"
    assert round_1_implement in graph.nodes, (
        f"When bdd_converge disabled, {_IMPLEMENT_BODY}__r1 must exist; "
        f"nodes: {sorted(graph.nodes)!r}"
    )
    round_2_implement = f"{_IMPLEMENT_BODY}__r2"
    assert round_2_implement not in graph.nodes, (
        f"When bdd_converge disabled, {_IMPLEMENT_BODY}__r2 must NOT exist; "
        f"nodes: {sorted(graph.nodes)!r}"
    )
    # The bare LOOP node must be gone after expansion
    assert _LOOP_ID not in graph.nodes, (
        f"After expansion, bdd-converge-loop LOOP node must be removed; "
        f"nodes: {sorted(graph.nodes)!r}"
    )


# ---------------------------------------------------------------------------
# AC4: max_rounds=N → N round-copies emitted
# ---------------------------------------------------------------------------


def test_ac4_max_rounds_5_emits_five_round_copies(monkeypatch):
    """AC4: when max_rounds=5, the expander emits bdd-implement__r1..r5 (5 copies).

    FAILS RED because no LOOP node exists yet → no round copies at all.
    """
    monkeypatch.setenv("HIVE_LOOPS_BDD_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_BDD_CONVERGE_MAX_ROUNDS", "5")
    graph = load_workflow(BDD_PATH)

    for k in range(1, 6):
        rid = f"{_IMPLEMENT_BODY}__r{k}"
        assert rid in graph.nodes, (
            f"max_rounds=5 must emit {_IMPLEMENT_BODY}__r{k}; "
            f"implement round nodes found: "
            f"{sorted(n for n in graph.nodes if f'{_IMPLEMENT_BODY}__r' in n)!r}"
        )
    assert f"{_IMPLEMENT_BODY}__r6" not in graph.nodes, (
        "max_rounds=5 must not emit bdd-implement__r6"
    )


# ---------------------------------------------------------------------------
# AC1 structural: round k>1 nodes carry skip_when on behavior_satisfied
# ---------------------------------------------------------------------------


def test_ac1_round3_nodes_carry_skip_when_on_behavior_satisfied(monkeypatch):
    """AC1: when max_rounds >= 3, each round-k>1 body node carries skip_when referencing
    the tester's prior-round behavior_satisfied output in dotpath form.

    Specifically: round 3 bdd-implement node must have skip_when pointing at
    bdd-test__r2.output.behavior_satisfied == true.

    FAILS RED because no LOOP node / round copies exist yet.
    """
    monkeypatch.setenv("HIVE_LOOPS_BDD_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_BDD_CONVERGE_MAX_ROUNDS", "3")
    graph = load_workflow(BDD_PATH)

    # Round 1 must NOT have a skip_when
    r1_impl = graph.nodes.get(f"{_IMPLEMENT_BODY}__r1")
    assert r1_impl is not None, (
        f"{_IMPLEMENT_BODY}__r1 must exist when max_rounds=3"
    )
    assert r1_impl.skip_when is None, (
        f"{_IMPLEMENT_BODY}__r1.skip_when must be None (always runs); "
        f"got {r1_impl.skip_when!r}"
    )

    # Round 3 body nodes must have skip_when referencing bdd-test__r2.output.behavior_satisfied
    r3_impl = graph.nodes.get(f"{_IMPLEMENT_BODY}__r3")
    assert r3_impl is not None, (
        f"{_IMPLEMENT_BODY}__r3 must exist when max_rounds=3"
    )
    assert r3_impl.skip_when is not None, (
        f"{_IMPLEMENT_BODY}__r3.skip_when must be set (convergence short-circuit)"
    )
    assert _SIGNAL in r3_impl.skip_when, (
        f"{_IMPLEMENT_BODY}__r3.skip_when must reference '{_SIGNAL}'; "
        f"got {r3_impl.skip_when!r}"
    )
    assert "__r2.output." in r3_impl.skip_when, (
        f"{_IMPLEMENT_BODY}__r3.skip_when must reference a __r2 round copy; "
        f"got {r3_impl.skip_when!r}"
    )
    assert "== true" in r3_impl.skip_when, (
        f"{_IMPLEMENT_BODY}__r3.skip_when must assert '== true'; "
        f"got {r3_impl.skip_when!r}"
    )


def test_ac1_round3_tester_skip_when_references_prior_round(monkeypatch):
    """AC1 (tester): bdd-test__r3 must also carry skip_when referencing bdd-test__r2.

    Both body nodes in the cycle are skipped when behavior_satisfied was already
    achieved in the prior round. This ensures round 3 is fully skipped, not just
    the implementer.

    FAILS RED because no body node round copies exist yet.
    """
    monkeypatch.setenv("HIVE_LOOPS_BDD_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_BDD_CONVERGE_MAX_ROUNDS", "3")
    graph = load_workflow(BDD_PATH)

    r3_tester = graph.nodes.get(f"{_TESTER_BODY}__r3")
    assert r3_tester is not None, (
        f"{_TESTER_BODY}__r3 must exist when max_rounds=3"
    )
    assert r3_tester.skip_when is not None, (
        f"{_TESTER_BODY}__r3.skip_when must be set (convergence short-circuit); "
        f"got None"
    )
    assert _SIGNAL in r3_tester.skip_when, (
        f"{_TESTER_BODY}__r3.skip_when must reference '{_SIGNAL}'; "
        f"got {r3_tester.skip_when!r}"
    )
    assert "__r2" in r3_tester.skip_when, (
        f"{_TESTER_BODY}__r3.skip_when must reference __r2; "
        f"got {r3_tester.skip_when!r}"
    )


# ---------------------------------------------------------------------------
# AC2: max_rounds exhausted + terminal gate blocks integrate
# ---------------------------------------------------------------------------


def test_ac2_gate_bdd_in_expanded_graph(monkeypatch):
    """AC2 (structural): gate-bdd must exist in the expanded graph as a GATE node.

    After max_rounds run, gate-bdd blocks integrate when behavior_satisfied != true.

    FAILS RED because gate-bdd is not in the YAML yet.
    """
    monkeypatch.setenv("HIVE_LOOPS_BDD_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_BDD_CONVERGE_MAX_ROUNDS", "3")
    graph = load_workflow(BDD_PATH)

    assert _GATE_ID in graph.nodes, (
        f"gate-bdd must exist in expanded BDD graph; "
        f"nodes: {sorted(graph.nodes)!r}"
    )
    gate_node = graph.nodes[_GATE_ID]
    assert gate_node.node_type == NodeType.GATE, (
        f"gate-bdd must be a GATE node; got {gate_node.node_type!r}"
    )


def test_ac2_gate_bdd_rewired_to_last_round(monkeypatch):
    """AC2 (structural): after expansion, gate-bdd must depend on the last round's
    bdd-test body node exit (e.g. bdd-test__r3 when max_rounds=3), not the LOOP node.

    FAILS RED because gate-bdd does not exist yet.
    """
    monkeypatch.setenv("HIVE_LOOPS_BDD_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_BDD_CONVERGE_MAX_ROUNDS", "3")
    graph = load_workflow(BDD_PATH)

    assert _GATE_ID in graph.nodes, "gate-bdd must exist in expanded graph"
    gate_node = graph.nodes[_GATE_ID]

    # The LOOP node must NOT appear in depends_on after unrolling
    assert _LOOP_ID not in gate_node.depends_on, (
        f"After unrolling, {_LOOP_ID} must NOT appear in gate-bdd.depends_on; "
        f"got {gate_node.depends_on!r}"
    )
    # Must depend on a last-round body node (__r3)
    last_round_deps = [dep for dep in gate_node.depends_on if "__r3" in dep]
    assert last_round_deps, (
        f"gate-bdd must depend on a __r3 (last round) body node after unrolling; "
        f"got {gate_node.depends_on!r}"
    )


def test_ac2_gate_predicate_rewired_to_last_round_producer(monkeypatch):
    """AC2 (structural): gate-bdd.gate must reference the last-round bdd-test body node
    (e.g. $bdd-test__r3.output.behavior_satisfied == true) after unrolling.

    FAILS RED because gate-bdd does not exist yet.
    """
    monkeypatch.setenv("HIVE_LOOPS_BDD_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_BDD_CONVERGE_MAX_ROUNDS", "3")
    graph = load_workflow(BDD_PATH)

    assert _GATE_ID in graph.nodes, "gate-bdd must exist in expanded graph"
    gate_node = graph.nodes[_GATE_ID]

    gate_pred = gate_node.gate or ""
    assert _SIGNAL in gate_pred, (
        f"gate-bdd.gate must reference '{_SIGNAL}' after expansion; got {gate_pred!r}"
    )
    # After unrolling, the LOOP node id must not appear in the predicate
    assert _LOOP_ID not in gate_pred, (
        f"After unrolling, '{_LOOP_ID}' must not appear in gate-bdd.gate; "
        f"got {gate_pred!r}"
    )
    # Must reference last round __r3
    assert "__r3" in gate_pred, (
        f"gate-bdd.gate must reference __r3 (last round) after unrolling; "
        f"got {gate_pred!r}"
    )


def test_ac2_integrate_depends_on_gate_in_expanded_graph(monkeypatch):
    """AC2 (structural): in the expanded graph, integrate must depend on gate-bdd
    so it cannot run until the terminal gate passes.

    FAILS RED because gate-bdd and the loop do not exist yet.
    """
    monkeypatch.setenv("HIVE_LOOPS_BDD_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_BDD_CONVERGE_MAX_ROUNDS", "3")
    graph = load_workflow(BDD_PATH)

    integrate = graph.nodes.get("integrate")
    assert integrate is not None, "integrate node must exist in BDD graph"
    assert _GATE_ID in integrate.depends_on, (
        f"integrate must depend on gate-bdd in expanded graph; "
        f"got {integrate.depends_on!r}"
    )
    # After unrolling, the bare LOOP node must not appear in integrate.depends_on
    assert _LOOP_ID not in integrate.depends_on, (
        f"After unrolling, bdd-converge-loop must not appear in integrate.depends_on; "
        f"got {integrate.depends_on!r}"
    )


# ---------------------------------------------------------------------------
# E1/E2: GateHandler direct invocation — convergence signal evaluation
#
# These tests exercise GateHandler directly with a manually constructed
# materialised-output dict, bypassing the walker. They pin the gate's
# dotpath-predicate evaluation logic for the BDD convergence signal so that
# the gate behaviour is tested independently of walker skip-forward path.
# ---------------------------------------------------------------------------


def _make_output_graph(per_node: dict[str, dict]) -> dict[str, dict]:
    """Wrap per-node output dicts in the {node_id: {output: {...}}} shape
    that GateHandler's __output_graph input expects."""
    return {node_id: {"output": outputs} for node_id, outputs in per_node.items()}


def test_e1_gate_bdd_passes_when_last_round_emits_true(monkeypatch):
    """E1: GateHandler returns gate_passed=True when last-round bdd-test emits behavior_satisfied=True.

    Positive path for AC2: when all max_rounds run and the terminal round achieves
    behavior_satisfied=True, gate-bdd must pass and allow integrate to proceed.

    FAILS RED because gate-bdd does not exist and its predicate cannot be evaluated.
    """
    monkeypatch.setenv("HIVE_LOOPS_BDD_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_BDD_CONVERGE_MAX_ROUNDS", "3")
    graph = load_workflow(BDD_PATH)

    gate_node = graph.nodes[_GATE_ID]
    gate_pred = gate_node.gate or ""
    assert "__r3" in gate_pred, (
        f"E1 pre-condition: gate predicate must reference __r3; got {gate_pred!r}"
    )

    # Simulate: r1 not satisfied, r2 not satisfied, r3 satisfied
    output_graph = _make_output_graph({
        f"{_TESTER_BODY}__r1": {_SIGNAL: False},
        f"{_TESTER_BODY}__r2": {_SIGNAL: False},
        f"{_TESTER_BODY}__r3": {_SIGNAL: True},
    })

    handler = GateHandler()
    result = handler.handle(gate_node, {"__output_graph": output_graph}, "run-e1")
    assert result.outputs.get("gate_passed") is True, (
        f"gate-bdd must pass when {_TESTER_BODY}__r3.output.{_SIGNAL}=True"
    )


def test_e2_gate_bdd_blocks_when_behavior_never_satisfied(monkeypatch):
    """E2: GateHandler raises GateFailedError when last-round bdd-test emits behavior_satisfied=False.

    Blocking path for AC2: when behavior_satisfied is never True across all max_rounds,
    the terminal gate must block integrate (fail loud, not silent pass).

    FAILS RED because gate-bdd does not exist.
    """
    monkeypatch.setenv("HIVE_LOOPS_BDD_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_BDD_CONVERGE_MAX_ROUNDS", "3")
    graph = load_workflow(BDD_PATH)

    gate_node = graph.nodes[_GATE_ID]

    # Simulate: all 3 rounds ran and none achieved behavior_satisfied=True
    output_graph = _make_output_graph({
        f"{_TESTER_BODY}__r1": {_SIGNAL: False},
        f"{_TESTER_BODY}__r2": {_SIGNAL: False},
        f"{_TESTER_BODY}__r3": {_SIGNAL: False},
    })

    handler = GateHandler()
    with pytest.raises(GateFailedError, match=_SIGNAL):
        handler.handle(gate_node, {"__output_graph": output_graph}, "run-e2")
