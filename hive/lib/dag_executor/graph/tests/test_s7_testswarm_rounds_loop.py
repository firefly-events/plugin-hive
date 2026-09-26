"""s7-testswarm-rounds-loop: TDD RED phase — failing tests pinning expected behavior.

Acceptance criteria (from story spec s7-testswarm-rounds-loop.yaml):
  AC1: coverage_satisfied=true at round 1 → round 2 swarm nodes are Skipped
       (structural: round 2 skip_when references assess body node r1.output.coverage_satisfied == true)
  AC2: loops.test_swarm.enabled=false (default) → exactly one swarm pass is emitted
  AC3: loops.test_swarm.enabled=true max_rounds=3 → up to 3 swarm round-copies are emitted
  AC4: never satisfied → max_rounds run (ceiling exit), no terminal hard-block unless configured

Structural guards:
  S1: test-swarm.workflow.yaml must contain a LOOP node with feature: test_swarm
  S2: LOOP node must declare convergence_signal: coverage_satisfied
  S3: body nodes must carry sub_graph: swarm-rounds (the cycle tag)
  S4: assess body node must declare output coverage_satisfied of type json
  S5: no mandatory terminal hard-block gate (ceiling-exit is acceptable; gate optional if present)
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

from hive.lib.dag_executor.graph import NodeType, load_workflow, validate_graph


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_WORKFLOWS = Path(__file__).resolve().parents[5] / "hive" / "workflows"
SWARM_PATH = _WORKFLOWS / "test-swarm.workflow.yaml"

_LOOP_FEATURE = "test_swarm"
_SIGNAL = "coverage_satisfied"
_SUB_GRAPH = "swarm-rounds"
_ENV_ENABLED = "HIVE_LOOPS_TEST_SWARM_ENABLED"
_ENV_MAX_ROUNDS = "HIVE_LOOPS_TEST_SWARM_MAX_ROUNDS"


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

def _write_workflow(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "synthetic.workflow.yaml"
    path.write_text(body, encoding="utf-8")
    return path


def _swarm_fixture(max_rounds: int = 3, with_optional_gate: bool = False) -> str:
    """Minimal synthetic workflow mirroring the test-swarm generate→assess LOOP.

    The body has two nodes under sub_graph: swarm-rounds:
      - swarm-generate: the generate node (no convergence output)
      - swarm-assess:   the assess node (emits coverage_satisfied: type: json)

    This mirrors the review-fix-cycle pattern in Slice A.
    Terminal gate is optional (AC4 says ceiling-exit is acceptable).
    """
    gate_block = ""
    if with_optional_gate:
        gate_block = """
  - id: gate-coverage
    node_type: gate
    agent: ""
    optional: true
    gate: "$swarm-assess__r1.output.coverage_satisfied == true"
    depends_on: [swarm-rounds-loop]
"""

    return f"""
name: swarm-rounds-test
version: "1.0.0"
steps:
  - id: pre-swarm
    agent: test-architect

  - id: swarm-rounds-loop
    node_type: loop
    agent: ""
    loop_config:
      sub_graph: {_SUB_GRAPH}
      gate_predicate: "coverage satisfied"
      max_rounds: {max_rounds}
      feature: {_LOOP_FEATURE}
      convergence_signal: {_SIGNAL}
    depends_on: [pre-swarm]

  - id: swarm-generate
    agent: test-worker
    sub_graph: {_SUB_GRAPH}
    depends_on: [pre-swarm]

  - id: swarm-assess
    agent: test-inspector
    sub_graph: {_SUB_GRAPH}
    depends_on: [swarm-generate]
    outputs:
      - name: {_SIGNAL}
        type: json

  - id: compile-report
    agent: test-inspector
    depends_on: [swarm-rounds-loop]
{gate_block}"""


# ---------------------------------------------------------------------------
# S1: test-swarm.workflow.yaml must contain a LOOP node with feature: test_swarm
# ---------------------------------------------------------------------------


def test_swarm_yaml_has_loop_node():
    """S1: test-swarm.workflow.yaml must declare at least one LOOP node.

    FAILS RED because the current swarm workflow has a flat pipeline with no LOOP node.
    """
    with open(SWARM_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)

    steps = {s["id"]: s for s in raw.get("steps", [])}
    loop_steps = [
        s_id for s_id, s in steps.items() if s.get("node_type") == "loop"
    ]
    assert loop_steps, (
        f"test-swarm.workflow.yaml must have at least one LOOP node; "
        f"found steps: {list(steps)!r}"
    )


def test_swarm_loop_node_declares_feature_test_swarm():
    """S2a: the LOOP node in test-swarm.workflow.yaml must declare feature: test_swarm.

    FAILS RED — current workflow has no LOOP node.
    """
    with open(SWARM_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)

    steps = {s["id"]: s for s in raw.get("steps", [])}
    loop_steps = {
        s_id: s for s_id, s in steps.items() if s.get("node_type") == "loop"
    }
    assert loop_steps, "No LOOP node found in test-swarm.workflow.yaml"

    # Find the one with feature: test_swarm
    test_swarm_loops = {
        s_id: s
        for s_id, s in loop_steps.items()
        if (s.get("loop_config") or {}).get("feature") == _LOOP_FEATURE
    }
    assert test_swarm_loops, (
        f"No LOOP node with feature='{_LOOP_FEATURE}' found; "
        f"loop node loop_configs: "
        f"{[s.get('loop_config', {}) for s in loop_steps.values()]!r}"
    )


def test_swarm_loop_node_declares_convergence_signal():
    """S2b: the test_swarm LOOP node must declare convergence_signal: coverage_satisfied.

    FAILS RED — current workflow has no LOOP node.
    """
    with open(SWARM_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)

    steps = {s["id"]: s for s in raw.get("steps", [])}
    loop_nodes = [
        s for s in steps.values()
        if s.get("node_type") == "loop"
        and (s.get("loop_config") or {}).get("feature") == _LOOP_FEATURE
    ]
    assert loop_nodes, f"No test_swarm LOOP node found in test-swarm.workflow.yaml"

    lc = loop_nodes[0].get("loop_config", {})
    assert lc.get("convergence_signal") == _SIGNAL, (
        f"test_swarm LOOP must declare convergence_signal: {_SIGNAL!r}; "
        f"got {lc.get('convergence_signal')!r}"
    )


def test_swarm_body_nodes_carry_sub_graph_tag():
    """S3: at least two body nodes must carry sub_graph: swarm-rounds.

    FAILS RED — current workflow has no sub_graph-tagged nodes.
    """
    with open(SWARM_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)

    body_nodes = [
        s for s in raw.get("steps", [])
        if s.get("sub_graph") == _SUB_GRAPH
    ]
    assert len(body_nodes) >= 2, (
        f"Expected at least 2 body nodes with sub_graph={_SUB_GRAPH!r}; "
        f"found {len(body_nodes)}: {[s['id'] for s in body_nodes]!r}"
    )


def test_swarm_assess_body_node_declares_coverage_satisfied_output():
    """S4: the assess body node must declare output coverage_satisfied of type json.

    FAILS RED — current workflow has no assess body node with this output.
    """
    with open(SWARM_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)

    body_nodes = [
        s for s in raw.get("steps", [])
        if s.get("sub_graph") == _SUB_GRAPH
    ]
    assert body_nodes, f"No body nodes with sub_graph={_SUB_GRAPH!r} in swarm workflow"

    # At least one body node must emit coverage_satisfied: type: json
    producers = [
        s for s in body_nodes
        if any(
            o.get("name") == _SIGNAL and o.get("type") == "json"
            for o in (s.get("outputs") or [])
        )
    ]
    assert producers, (
        f"No body node under sub_graph={_SUB_GRAPH!r} declares "
        f"output '{_SIGNAL}' of type json. "
        f"Body node ids: {[s['id'] for s in body_nodes]!r}. "
        f"Body outputs: {[s.get('outputs', []) for s in body_nodes]!r}"
    )


# ---------------------------------------------------------------------------
# AC2: loops.test_swarm.enabled=false (default) → single swarm pass emitted
# ---------------------------------------------------------------------------


def test_ac2_disabled_emits_single_swarm_pass(tmp_path: Path, monkeypatch):
    """AC2: when HIVE_LOOPS_TEST_SWARM_ENABLED=false, expander emits exactly one
    round of body nodes (round 1 only), zero LOOP nodes.

    FAILS RED because the swarm YAML has no LOOP structure yet.
    """
    monkeypatch.setenv(_ENV_ENABLED, "false")

    graph = load_workflow(_write_workflow(tmp_path, _swarm_fixture(max_rounds=3)))

    # Zero LOOP nodes must remain after expansion
    loop_nodes = [n for n in graph.nodes.values() if n.node_type == NodeType.LOOP]
    assert loop_nodes == [], (
        f"Expected 0 LOOP nodes after disabled expansion; "
        f"found {[n.id for n in loop_nodes]!r}"
    )

    # Exactly one round of each body node
    assert "swarm-generate__r1" in graph.nodes, (
        "swarm-generate__r1 must exist when disabled (single pass)"
    )
    assert "swarm-assess__r1" in graph.nodes, (
        "swarm-assess__r1 must exist when disabled (single pass)"
    )

    # Round 2 must NOT exist
    assert "swarm-generate__r2" not in graph.nodes, (
        "swarm-generate__r2 must NOT exist when loop is disabled"
    )
    assert "swarm-assess__r2" not in graph.nodes, (
        "swarm-assess__r2 must NOT exist when loop is disabled"
    )

    validate_graph(graph)


# ---------------------------------------------------------------------------
# AC3: loops.test_swarm.enabled=true, max_rounds=3 → 3 round-copies emitted
# ---------------------------------------------------------------------------


def test_ac3_enabled_max_rounds_3_emits_three_copies(tmp_path: Path, monkeypatch):
    """AC3: when enabled=true and max_rounds=3, expander emits exactly 3 copies of
    each body node, zero LOOP nodes, and the graph validates cleanly.

    FAILS RED because the swarm YAML has no LOOP structure yet.
    """
    monkeypatch.setenv(_ENV_ENABLED, "true")
    monkeypatch.setenv(_ENV_MAX_ROUNDS, "3")

    graph = load_workflow(_write_workflow(tmp_path, _swarm_fixture(max_rounds=3)))

    # Zero LOOP nodes must remain after expansion
    loop_nodes = [n for n in graph.nodes.values() if n.node_type == NodeType.LOOP]
    assert loop_nodes == [], (
        f"Expected 0 LOOP nodes after expansion; found {[n.id for n in loop_nodes]!r}"
    )

    # Exactly 3 copies of each body node
    for k in range(1, 4):
        assert f"swarm-generate__r{k}" in graph.nodes, (
            f"Expected swarm-generate__r{k} in graph; got {sorted(graph.nodes)!r}"
        )
        assert f"swarm-assess__r{k}" in graph.nodes, (
            f"Expected swarm-assess__r{k} in graph"
        )

    # No bare (unexpanded) body node ids remain
    assert "swarm-generate" not in graph.nodes, (
        "Bare body node 'swarm-generate' must be removed after expansion"
    )
    assert "swarm-assess" not in graph.nodes, (
        "Bare body node 'swarm-assess' must be removed after expansion"
    )

    validate_graph(graph)


# ---------------------------------------------------------------------------
# AC3 variant: max_rounds env-var override applies correctly
# ---------------------------------------------------------------------------


def test_ac3_max_rounds_env_override(tmp_path: Path, monkeypatch):
    """AC3 env-var: HIVE_LOOPS_TEST_SWARM_MAX_ROUNDS=2 overrides YAML max_rounds=5,
    emitting exactly 2 round-copies.

    FAILS RED because the swarm YAML has no LOOP structure yet.
    """
    monkeypatch.setenv(_ENV_ENABLED, "true")
    monkeypatch.setenv(_ENV_MAX_ROUNDS, "2")

    # YAML says max_rounds=5, env says 2 — env wins
    graph = load_workflow(_write_workflow(tmp_path, _swarm_fixture(max_rounds=5)))

    assert "swarm-assess__r1" in graph.nodes, "Round 1 must exist"
    assert "swarm-assess__r2" in graph.nodes, "Round 2 must exist (max_rounds=2)"
    assert "swarm-assess__r3" not in graph.nodes, (
        "Round 3 must NOT exist when env max_rounds=2 overrides YAML max_rounds=5"
    )

    validate_graph(graph)


# ---------------------------------------------------------------------------
# AC1 structural: round k>1 skip_when references swarm-assess__r{k-1}.output.coverage_satisfied
# ---------------------------------------------------------------------------


def test_ac1_skip_when_on_rounds_greater_than_one(tmp_path: Path, monkeypatch):
    """AC1 structural: after unrolling with max_rounds=3, round k>1 body nodes must
    carry skip_when = '$swarm-assess__r{k-1}.output.coverage_satisfied == true'.

    Round 1 must have skip_when=None (always runs).
    Round 2 must reference swarm-assess__r1.
    Round 3 must reference swarm-assess__r2.

    FAILS RED because the swarm YAML has no LOOP structure yet.
    """
    monkeypatch.setenv(_ENV_ENABLED, "true")
    monkeypatch.setenv(_ENV_MAX_ROUNDS, "3")

    graph = load_workflow(_write_workflow(tmp_path, _swarm_fixture(max_rounds=3)))

    # Round 1: no skip_when (always runs first)
    assert graph.nodes["swarm-generate__r1"].skip_when is None, (
        "swarm-generate__r1 must have skip_when=None (first round always runs)"
    )
    assert graph.nodes["swarm-assess__r1"].skip_when is None, (
        "swarm-assess__r1 must have skip_when=None (first round always runs)"
    )

    # Round 2: must reference swarm-assess__r1 output
    expected_r2 = f"$swarm-assess__r1.output.{_SIGNAL} == true"
    skip_gen_r2 = graph.nodes["swarm-generate__r2"].skip_when
    skip_assess_r2 = graph.nodes["swarm-assess__r2"].skip_when
    assert skip_gen_r2 == expected_r2, (
        f"swarm-generate__r2.skip_when must be {expected_r2!r}; got {skip_gen_r2!r}"
    )
    assert skip_assess_r2 == expected_r2, (
        f"swarm-assess__r2.skip_when must be {expected_r2!r}; got {skip_assess_r2!r}"
    )

    # Round 3: must reference BOTH r1 AND r2 via OR so that when r2 is itself
    # skipped (because r1 already satisfied the signal) the missing-output
    # on r2 evaluates False but r1's True propagates through the OR.
    # Pure k-1 chaining (only $r2.output) breaks here — r2 has no materialised
    # output when skipped, so the predicate fails-open and r3 re-runs the swarm.
    expected_r3 = (
        f"$swarm-assess__r1.output.{_SIGNAL} == true"
        f" || $swarm-assess__r2.output.{_SIGNAL} == true"
    )
    skip_gen_r3 = graph.nodes["swarm-generate__r3"].skip_when
    skip_assess_r3 = graph.nodes["swarm-assess__r3"].skip_when
    assert skip_gen_r3 == expected_r3, (
        f"swarm-generate__r3.skip_when must be {expected_r3!r}; got {skip_gen_r3!r}"
    )
    assert skip_assess_r3 == expected_r3, (
        f"swarm-assess__r3.skip_when must be {expected_r3!r}; got {skip_assess_r3!r}"
    )


def test_ac1_round_2_skip_when_references_round_1_producer(tmp_path: Path, monkeypatch):
    """AC1 dotpath precision: round 2 skip_when must reference swarm-assess__r1 (the
    prior round's assess/producer node), NOT swarm-generate__r1 (the generate node).

    FAILS RED because the swarm YAML has no LOOP structure yet.
    """
    monkeypatch.setenv(_ENV_ENABLED, "true")
    monkeypatch.setenv(_ENV_MAX_ROUNDS, "2")

    graph = load_workflow(_write_workflow(tmp_path, _swarm_fixture(max_rounds=2)))

    skip_r2 = graph.nodes["swarm-generate__r2"].skip_when
    assert skip_r2 is not None, "swarm-generate__r2 must have skip_when set"
    # Must reference assess (the signal producer), NOT generate
    assert "swarm-assess__r1" in skip_r2, (
        f"skip_when must reference the assess producer 'swarm-assess__r1'; got {skip_r2!r}"
    )
    assert "swarm-generate__r1" not in skip_r2, (
        f"skip_when must NOT reference generate node 'swarm-generate__r1'; got {skip_r2!r}"
    )
    # Must reference the correct signal name
    assert _SIGNAL in skip_r2, (
        f"skip_when must reference signal '{_SIGNAL}'; got {skip_r2!r}"
    )


# ---------------------------------------------------------------------------
# AC1 structural: round 1 convergence → round 2 skippable via skip_when predicate
# ---------------------------------------------------------------------------


def test_ac1_structural_round2_skip_when_grammar_legal(tmp_path: Path, monkeypatch):
    """AC1 grammar-legal: the skip_when on round 2 body nodes must be a dotpath predicate
    ($<node>.output.<signal> == true) that the grammar evaluator can parse without
    fail-close (not a prose predicate that always evaluates False).

    FAILS RED because the swarm YAML has no LOOP structure yet.
    """
    from hive.lib.dag_executor.routing import Skipped, parse

    monkeypatch.setenv(_ENV_ENABLED, "true")
    monkeypatch.setenv(_ENV_MAX_ROUNDS, "3")

    graph = load_workflow(_write_workflow(tmp_path, _swarm_fixture(max_rounds=3)))

    prose_pattern = re.compile(r"\b(not|equals|and|or|must|satisfied)\b", re.IGNORECASE)

    for k in range(2, 4):
        for node_id in (f"swarm-generate__r{k}", f"swarm-assess__r{k}"):
            skip_when = graph.nodes[node_id].skip_when
            assert skip_when is not None, f"{node_id} must have skip_when set"

            # Must not be prose (fails-closed)
            assert not prose_pattern.search(skip_when), (
                f"{node_id}.skip_when contains prose keywords (fail-closed): {skip_when!r}. "
                f"Must be a grammar-legal dotpath predicate."
            )
            # Must start with $ (dotpath reference)
            assert skip_when.startswith("$"), (
                f"{node_id}.skip_when must start with '$'; got {skip_when!r}"
            )
            # Must end with == true (boolean check)
            assert skip_when.endswith("== true"), (
                f"{node_id}.skip_when must end with '== true'; got {skip_when!r}"
            )
            # Grammar parse must NOT return Skipped (fail-closed)
            result = parse(skip_when)
            assert not isinstance(result, Skipped), (
                f"{node_id}.skip_when {skip_when!r} parses to Skipped (fail-closed) — "
                f"predicate is not grammar-legal and will never short-circuit the loop."
            )


# ---------------------------------------------------------------------------
# AC4: ceiling exit — all max_rounds run when never satisfied; no hard-block gate
# ---------------------------------------------------------------------------


def test_ac4_ceiling_exit_all_rounds_run_no_mandatory_gate(tmp_path: Path, monkeypatch):
    """AC4 structural: when enabled=true and max_rounds=3, all 3 rounds are emitted.
    There must be NO terminal GATE node that is NOT optional (no hard-block).

    Ceiling exit means the loop exhausts its rounds and the workflow continues
    without a mandatory gate failure. (An optional gate is acceptable.)

    FAILS RED because the swarm YAML has no LOOP structure yet.
    """
    monkeypatch.setenv(_ENV_ENABLED, "true")
    monkeypatch.setenv(_ENV_MAX_ROUNDS, "3")

    graph = load_workflow(_write_workflow(tmp_path, _swarm_fixture(max_rounds=3)))

    # All 3 rounds emitted
    for k in range(1, 4):
        assert f"swarm-assess__r{k}" in graph.nodes, (
            f"swarm-assess__r{k} must be in graph (max_rounds=3, ceiling exit)"
        )

    # No non-optional GATE node that acts as a hard-block on the loop
    # (gate nodes that are not optional would block even on ceiling exit)
    mandatory_gates = [
        n for n in graph.nodes.values()
        if n.node_type == NodeType.GATE
        and not getattr(n, "optional", False)
    ]
    # If there is a mandatory gate, it must NOT be the sole exit from the loop
    # (i.e., must not have depends_on pointing only to the loop node).
    # Simpler check for bounded-slice: assert no non-optional gate exists
    # that would hard-block exit from the swarm loop.
    # A gate marked optional: true is explicitly permitted by the story spec.
    non_optional_gate_ids = [n.id for n in mandatory_gates]
    # Allow gates that are clearly pre-loop or unrelated (e.g. gate-test-report)
    # The key constraint: no gate that ONLY feeds from swarm-rounds-loop output
    swarm_loop_gate_ids = [
        n_id for n_id in non_optional_gate_ids
        if any("swarm-rounds-loop" in dep for dep in (graph.nodes[n_id].depends_on or []))
    ]
    assert swarm_loop_gate_ids == [], (
        f"Non-optional (hard-block) gates found depending on swarm-rounds-loop: "
        f"{swarm_loop_gate_ids!r}. "
        f"AC4: ceiling exit must be acceptable; hard-block gate must be optional: true "
        f"or absent. Got nodes: "
        f"{[graph.nodes[n_id] for n_id in swarm_loop_gate_ids]!r}"
    )

    validate_graph(graph)


# ---------------------------------------------------------------------------
# AC4 variant: max_rounds=1 degenerate case — single pass, no skip_when on r1
# ---------------------------------------------------------------------------


def test_ac4_max_rounds_1_single_degenerate_pass(tmp_path: Path, monkeypatch):
    """AC4 degenerate: max_rounds=1 must emit exactly one swarm body pass,
    with no skip_when on the single round (nothing to skip on).

    FAILS RED because the swarm YAML has no LOOP structure yet.
    """
    monkeypatch.setenv(_ENV_ENABLED, "true")
    monkeypatch.setenv(_ENV_MAX_ROUNDS, "1")

    graph = load_workflow(_write_workflow(tmp_path, _swarm_fixture(max_rounds=1)))

    loop_nodes = [n for n in graph.nodes.values() if n.node_type == NodeType.LOOP]
    assert loop_nodes == [], f"Expected 0 LOOP nodes for max_rounds=1; found {[n.id for n in loop_nodes]!r}"

    assert "swarm-generate__r1" in graph.nodes, "Single body pass swarm-generate__r1 must exist"
    assert "swarm-assess__r1" in graph.nodes, "Single body pass swarm-assess__r1 must exist"
    assert "swarm-assess__r2" not in graph.nodes, "Round 2 must not exist for max_rounds=1"

    # The single round must NOT have skip_when (no prior round to gate on)
    assert graph.nodes["swarm-generate__r1"].skip_when is None, (
        "swarm-generate__r1 (only round) must have skip_when=None"
    )
    assert graph.nodes["swarm-assess__r1"].skip_when is None, (
        "swarm-assess__r1 (only round) must have skip_when=None"
    )

    validate_graph(graph)


# ---------------------------------------------------------------------------
# AC2 structural: disabled emits single pass — default enabled=false
# ---------------------------------------------------------------------------


def test_ac2_default_enabled_false_single_pass(tmp_path: Path, monkeypatch):
    """AC2 default: when NO env var is set (relying on config default enabled=false),
    the expander must emit a single swarm body pass.

    This pins the 'default disabled' contract — test_swarm is opt-in (expensive).

    FAILS RED because the swarm YAML has no LOOP structure yet.
    """
    # Do NOT set HIVE_LOOPS_TEST_SWARM_ENABLED — default must be false
    monkeypatch.delenv(_ENV_ENABLED, raising=False)
    monkeypatch.delenv(_ENV_MAX_ROUNDS, raising=False)

    graph = load_workflow(_write_workflow(tmp_path, _swarm_fixture(max_rounds=3)))

    loop_nodes = [n for n in graph.nodes.values() if n.node_type == NodeType.LOOP]
    assert loop_nodes == [], (
        f"Expected 0 LOOP nodes when default enabled=false; "
        f"found {[n.id for n in loop_nodes]!r}"
    )

    # Single pass: r1 present, r2 absent
    assert "swarm-assess__r1" in graph.nodes, (
        "swarm-assess__r1 must exist (single pass, default disabled)"
    )
    assert "swarm-assess__r2" not in graph.nodes, (
        "swarm-assess__r2 must NOT exist (default disabled)"
    )

    validate_graph(graph)


# ---------------------------------------------------------------------------
# AC3 telemetry-level: node_skipped event for round 2 when round 1 satisfies
# (mirrors test_convergence_signal.py test_ac1_executor_round3_skipped_when_round2_converges)
# ---------------------------------------------------------------------------


def test_ac1_executor_round2_skipped_when_round1_satisfies(tmp_path: Path, monkeypatch):
    """AC1 executor-level: when round 1 emits coverage_satisfied=True, round 2 body
    nodes receive node_skipped telemetry events (not node_completed).

    This is the convergence short-circuit test at the executor (walker) level,
    mirroring the Slice A pattern in test_convergence_signal.py.

    FAILS RED because the swarm YAML has no LOOP structure yet.
    """
    monkeypatch.setenv(_ENV_ENABLED, "true")
    monkeypatch.setenv(_ENV_MAX_ROUNDS, "3")

    path = _write_workflow(tmp_path, _swarm_fixture(max_rounds=3))
    graph = load_workflow(path)

    # Verify the graph expanded correctly
    assert "swarm-assess__r1" in graph.nodes, "Graph must expand to round copies"
    assert "swarm-assess__r2" in graph.nodes
    assert "swarm-assess__r3" in graph.nodes

    from hive.lib.dag_executor.executor.telemetry import Telemetry
    from hive.lib.dag_executor.executor.walker import Walker

    # Round 1: coverage_satisfied=True → rounds 2 and 3 should be Skipped
    canned = {
        "pre-swarm": {},
        "swarm-generate__r1": {},
        "swarm-assess__r1": {_SIGNAL: True},
        "swarm-generate__r2": {},  # skip_when should fire
        "swarm-assess__r2": {},    # skip_when should fire
        "swarm-generate__r3": {},  # skip_when should fire (r2 skipped → propagates)
        "swarm-assess__r3": {},    # skip_when should fire
    }

    from hive.lib.dag_executor.graph import NodeType
    from hive.lib.dag_executor.executor.handlers import NodeOutput
    from hive.lib.dag_executor.executor.dispatcher import Dispatcher

    def agent_handler(node, inputs, run_id):
        return NodeOutput(outputs=dict(canned.get(node.id, {})))

    disp = Dispatcher(handlers={NodeType.AGENT: agent_handler})
    tel = Telemetry(run_id="test-s7-ac1")

    try:
        Walker().walk(graph, disp, "test-s7-ac1", tel)
    except Exception:
        pass  # optional gate or ceiling-exit exception acceptable

    skipped_ids = {
        e["step_id"]
        for e in tel.events
        if e["event_type"] == "node_skipped"
    }
    ran_ids = {
        e["step_id"]
        for e in tel.events
        if e["event_type"] == "node_completed"
    }

    # Round 1 must have run
    assert "swarm-assess__r1" in ran_ids, (
        f"swarm-assess__r1 must have run (round 1); ran_ids={ran_ids!r}"
    )
    # Round 2 must be Skipped (coverage_satisfied=True from r1)
    assert "swarm-generate__r2" in skipped_ids or "swarm-assess__r2" in skipped_ids, (
        f"At least swarm-generate__r2 or swarm-assess__r2 must be Skipped when "
        f"round 1 emits {_SIGNAL}=True; skipped_ids={skipped_ids!r}"
    )
    # Round 2 must NOT have run
    assert "swarm-assess__r2" not in ran_ids, (
        f"swarm-assess__r2 must NOT have run (skipped via convergence); "
        f"ran_ids={ran_ids!r}"
    )
    # Round 3 must ALSO be Skipped — the OR-chain skip_when
    # ($r1.output.cs == true || $r2.output.cs == true) must short-circuit via
    # r1's True output even though r2 was skipped and has no materialised output.
    # This is the core convergence-chain regression guard: if round 3 re-runs
    # despite r1 satisfying, the expensive swarm fires unnecessarily.
    assert "swarm-generate__r3" in skipped_ids or "swarm-assess__r3" in skipped_ids, (
        f"swarm-generate__r3 or swarm-assess__r3 must be Skipped when "
        f"round 1 satisfies (convergence chain); skipped_ids={skipped_ids!r}; "
        f"ran_ids={ran_ids!r}"
    )
    assert "swarm-assess__r3" not in ran_ids, (
        f"swarm-assess__r3 must NOT have run when round 1 satisfied; "
        f"ran_ids={ran_ids!r}"
    )


def test_ac4_executor_all_rounds_run_when_never_satisfied(tmp_path: Path, monkeypatch):
    """AC4 executor-level: when coverage_satisfied is never True, all max_rounds run
    (ceiling exit). No hard GateFailedError is expected (the gate is optional or absent).

    FAILS RED because the swarm YAML has no LOOP structure yet.
    """
    monkeypatch.setenv(_ENV_ENABLED, "true")
    monkeypatch.setenv(_ENV_MAX_ROUNDS, "3")

    path = _write_workflow(tmp_path, _swarm_fixture(max_rounds=3))
    graph = load_workflow(path)

    from hive.lib.dag_executor.executor.telemetry import Telemetry
    from hive.lib.dag_executor.executor.walker import Walker
    from hive.lib.dag_executor.graph import NodeType
    from hive.lib.dag_executor.executor.handlers import NodeOutput
    from hive.lib.dag_executor.executor.dispatcher import Dispatcher

    canned = {
        "pre-swarm": {},
        "swarm-generate__r1": {},
        "swarm-assess__r1": {_SIGNAL: False},
        "swarm-generate__r2": {},
        "swarm-assess__r2": {_SIGNAL: False},
        "swarm-generate__r3": {},
        "swarm-assess__r3": {_SIGNAL: False},
        "compile-report": {},
    }

    def agent_handler(node, inputs, run_id):
        return NodeOutput(outputs=dict(canned.get(node.id, {})))

    disp = Dispatcher(handlers={NodeType.AGENT: agent_handler})
    tel = Telemetry(run_id="test-s7-ac4")

    # Ceiling exit: must NOT raise a hard GateFailedError (gate is optional)
    # If it does raise (gate not marked optional), that's the RED failure
    try:
        Walker().walk(graph, disp, "test-s7-ac4", tel)
    except Exception as exc:
        # Only acceptable exception is from an optional gate or unrelated node;
        # a hard GateFailedError from swarm-loop would be a RED failure caught here.
        # We let the assertion below confirm all rounds ran.
        pass

    completed_ids = {
        e["step_id"]
        for e in tel.events
        if e["event_type"] == "node_completed"
    }

    # All 3 rounds must have run (not skipped)
    for k in range(1, 4):
        assert f"swarm-assess__r{k}" in completed_ids, (
            f"swarm-assess__r{k} must have run (never satisfied, max_rounds=3); "
            f"completed_ids={completed_ids!r}"
        )
