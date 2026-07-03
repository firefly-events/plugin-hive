"""s3-convergence-signal: TDD RED phase — failing tests pinning expected behavior.

Acceptance criteria (from story spec s3-convergence-signal.yaml):
  AC1: reviewer emits review_passed=true at round 2 → round 3 body is Skipped
       (executor-level: actual skip_when evaluation; structural: round 3 skip_when
       references review-step__r2.output.review_passed)
  AC2: review_passed never true → all max_rounds run AND terminal gate blocks (bug #26 preserved)
       (executor-level: all rounds in materialised; gate raises GateFailedError)
  AC3: loop template body never declares its convergence signal → loader fails loudly
       naming the template + signal; empty body with declared signal also fails loud
  AC4: boolean predicate ($<node>__rK.output.<signal> == true) parses without fail-close

Structural guards:
  S1: LoopConfig must carry convergence_signal: str | None field
  S2: per-round k>1 skip_when must be grammar-legal dotpath form (not prose gate_predicate)
  S3: classic workflow review-converge-loop declares convergence_signal in loop_config YAML
  S4: classic workflow gate-review uses a grammar-legal predicate (not prose)
  S5: grep guard — no prose predicate survives as a loop skip_when on an unrolled graph
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

from hive.lib.dag_executor.graph import NodeType, load_workflow, validate_graph
from hive.lib.dag_executor.graph.errors import GraphLoadError, LoopConfigError
from hive.lib.dag_executor.routing import Skipped, parse


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_WORKFLOWS = Path(__file__).resolve().parents[5] / "hive" / "workflows"
CLASSIC_PATH = _WORKFLOWS / "development.classic.workflow.yaml"


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

def _write_workflow(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "synthetic.workflow.yaml"
    path.write_text(body, encoding="utf-8")
    return path


def _loop_fixture_with_signal(
    convergence_signal: str = "review_passed",
    producer: str = "review-step",
    max_rounds: int = 3,
) -> str:
    """Minimal workflow with one LOOP node that declares a convergence_signal.

    The body has two nodes: fix-step and review-step. review-step (the
    *producer*) declares ``convergence_signal`` as a boolean output.
    This is the well-formed case; the loader should accept it and the
    expander should produce grammar-legal skip_when predicates.
    """
    return f"""
name: convergence-signal-test
version: "1.0.0"
steps:
  - id: pre-loop
    agent: developer

  - id: review-converge-loop
    node_type: loop
    agent: ""
    loop_config:
      sub_graph: review-fix-cycle
      gate_predicate: "whatever placeholder"
      max_rounds: {max_rounds}
      feature: review_converge
      convergence_signal: {convergence_signal}
    depends_on: [pre-loop]

  - id: fix-step
    agent: developer
    sub_graph: review-fix-cycle
    depends_on: [pre-loop]

  - id: {producer}
    agent: reviewer
    sub_graph: review-fix-cycle
    depends_on: [fix-step]
    outputs:
      - name: {convergence_signal}
        type: json

  - id: terminal-gate
    node_type: gate
    agent: ""
    gate: "$terminal-gate.output.{convergence_signal} == true"
    depends_on: [review-converge-loop]
"""


def _loop_fixture_missing_signal(convergence_signal: str = "review_passed") -> str:
    """Workflow where the LOOP declares a convergence_signal that NO body node produces."""
    return f"""
name: missing-signal-test
version: "1.0.0"
steps:
  - id: review-converge-loop
    node_type: loop
    agent: ""
    loop_config:
      sub_graph: review-fix-cycle
      gate_predicate: "whatever placeholder"
      max_rounds: 3
      feature: review_converge
      convergence_signal: {convergence_signal}
    depends_on: []

  - id: fix-step
    agent: developer
    sub_graph: review-fix-cycle
    outputs:
      - name: implementation
        type: string

  - id: review-step
    agent: reviewer
    sub_graph: review-fix-cycle
    depends_on: [fix-step]
    outputs:
      - name: review_verdict
        type: string
      # NOTE: {convergence_signal} is NOT declared here — loader must fail loudly

  - id: terminal-gate
    node_type: gate
    agent: ""
    gate: "placeholder"
    depends_on: [review-converge-loop]
"""


# ---------------------------------------------------------------------------
# S1: LoopConfig must carry convergence_signal: str | None field
# ---------------------------------------------------------------------------


def test_loop_config_has_convergence_signal_field():
    """LoopConfig must accept convergence_signal as a named field and round-trip it.

    Fails RED because LoopConfig currently has no convergence_signal field —
    passing it will raise TypeError (unexpected keyword argument).
    """
    from hive.lib.dag_executor.graph.model import LoopConfig

    lc = LoopConfig(
        sub_graph="review-fix-cycle",
        gate_predicate="whatever",
        max_rounds=3,
        feature="review_converge",
        convergence_signal="review_passed",
    )
    assert lc.convergence_signal == "review_passed", (
        f"LoopConfig.convergence_signal must round-trip; got {lc.convergence_signal!r}"
    )


def test_loop_config_convergence_signal_defaults_to_none():
    """LoopConfig.convergence_signal must default to None when not provided.

    Fails RED until the field is added to the dataclass.
    """
    from hive.lib.dag_executor.graph.model import LoopConfig

    lc = LoopConfig(sub_graph="s", gate_predicate="p", max_rounds=1)
    assert lc.convergence_signal is None, (
        f"LoopConfig.convergence_signal must default to None; got {lc.convergence_signal!r}"
    )


# ---------------------------------------------------------------------------
# AC3: loader fails loudly when body never declares the convergence signal
# ---------------------------------------------------------------------------


def test_loader_fails_when_body_missing_convergence_signal(tmp_path: Path):
    """Loading a workflow where the declared convergence_signal is not emitted
    by any body node must raise a GraphLoadError (or LoopConfigError subtype)
    that names both the loop template id and the missing signal name.

    Fails RED because the loader has no such validation today.
    """
    path = _write_workflow(tmp_path, _loop_fixture_missing_signal("review_passed"))

    with pytest.raises((GraphLoadError, LoopConfigError)) as exc_info:
        load_workflow(path)

    msg = str(exc_info.value)
    assert "review_passed" in msg, (
        f"Error must name the missing signal 'review_passed'; got: {msg!r}"
    )
    # Must name the offending loop node or sub_graph
    assert "review-converge-loop" in msg or "review-fix-cycle" in msg or "review_converge" in msg, (
        f"Error must name the offending loop template; got: {msg!r}"
    )


def test_loader_accepts_well_formed_convergence_signal(tmp_path: Path, monkeypatch):
    """Inverse of AC3: a body that DOES declare the signal must load cleanly.

    Fails RED because: (a) LoopConfig lacks the field so YAML can't round-trip it,
    and (b) the loader has no validation to pass/fail.
    """
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_MAX_ROUNDS", "3")

    path = _write_workflow(
        tmp_path, _loop_fixture_with_signal("review_passed", producer="review-step")
    )
    # Must not raise
    graph = load_workflow(path)
    validate_graph(graph)
    # Expanded graph has round copies (at least r1)
    assert "review-step__r1" in graph.nodes, (
        "Well-formed convergence_signal workflow must expand to round copies"
    )


# ---------------------------------------------------------------------------
# S2 / AC1: per-round k>1 skip_when is a grammar-legal per-round dotpath
# ---------------------------------------------------------------------------


def test_skip_when_is_grammar_legal_dotpath_form(tmp_path: Path, monkeypatch):
    """After unrolling, round k>1 body nodes must carry skip_when of the form:
      $<producer>__r{k-1}.output.<signal> == true
    (not the prose gate_predicate string).

    Fails RED because the expander currently assigns gate_predicate as skip_when.
    """
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_MAX_ROUNDS", "3")

    path = _write_workflow(
        tmp_path, _loop_fixture_with_signal("review_passed", producer="review-step")
    )
    graph = load_workflow(path)

    # Round 1: no skip_when (always runs)
    assert graph.nodes["review-step__r1"].skip_when is None, (
        "Round 1 body copy must have skip_when=None (always runs)"
    )
    assert graph.nodes["fix-step__r1"].skip_when is None

    # Round 2: must reference review-step__r1.output.review_passed
    expected_r2 = "$review-step__r1.output.review_passed == true"
    skip_fix_r2 = graph.nodes["fix-step__r2"].skip_when
    skip_review_r2 = graph.nodes["review-step__r2"].skip_when
    assert skip_fix_r2 == expected_r2, (
        f"fix-step__r2 skip_when must be {expected_r2!r}; got {skip_fix_r2!r}"
    )
    assert skip_review_r2 == expected_r2, (
        f"review-step__r2 skip_when must be {expected_r2!r}; got {skip_review_r2!r}"
    )

    # Round 3: must be an OR-chain over ALL prior rounds (r1 || r2).
    # Rationale: if round 1 converges, round 2 is skipped (output=None).
    # A k-1-only predicate ($r2.signal == true) evaluates None → False,
    # so round 3 would re-run despite convergence already having occurred.
    # The OR-chain short-circuits on any prior True, correctly skipping r3.
    expected_r3 = (
        "$review-step__r1.output.review_passed == true"
        " || $review-step__r2.output.review_passed == true"
    )
    skip_fix_r3 = graph.nodes["fix-step__r3"].skip_when
    skip_review_r3 = graph.nodes["review-step__r3"].skip_when
    assert skip_fix_r3 == expected_r3, (
        f"fix-step__r3 skip_when must be OR-chain {expected_r3!r}; got {skip_fix_r3!r}"
    )
    assert skip_review_r3 == expected_r3, (
        f"review-step__r3 skip_when must be OR-chain {expected_r3!r}; got {skip_review_r3!r}"
    )


def test_skip_when_is_not_prose_predicate(tmp_path: Path, monkeypatch):
    """Round k>1 skip_when must NOT be a prose/English predicate (which fails-closed).

    A prose predicate (like "review_verdict not equals needs_revision") would
    cause the grammar evaluator to fail-closed to False every time, meaning
    round k+1 always runs — loops never short-circuit.

    Fails RED because the expander currently copies gate_predicate (prose) to skip_when.
    """
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_MAX_ROUNDS", "3")

    path = _write_workflow(
        tmp_path, _loop_fixture_with_signal("review_passed", producer="review-step")
    )
    graph = load_workflow(path)

    prose_pattern = re.compile(r"\b(not|equals|and|or|must)\b", re.IGNORECASE)

    for k in range(2, 4):
        for node_id in (f"fix-step__r{k}", f"review-step__r{k}"):
            skip_when = graph.nodes[node_id].skip_when
            assert skip_when is not None, f"{node_id} must have skip_when set"
            # Must not contain prose keywords
            assert not prose_pattern.search(skip_when), (
                f"{node_id}.skip_when contains prose keywords (fail-closed): {skip_when!r}. "
                f"Must be a grammar-legal dotpath predicate."
            )
            # Must start with $ (dotpath reference)
            assert skip_when.startswith("$"), (
                f"{node_id}.skip_when must start with '$' (dotpath); got {skip_when!r}"
            )
            # Must end with == true
            assert skip_when.endswith("== true"), (
                f"{node_id}.skip_when must end with '== true' (boolean); got {skip_when!r}"
            )


# ---------------------------------------------------------------------------
# AC4: grammar-legal boolean predicate parses without fail-close
# ---------------------------------------------------------------------------


def test_boolean_predicate_form_parses_without_fail_close():
    """The per-round convergence predicate ($<node>__r{k}.output.<signal> == true)
    must parse without the grammar returning a Skipped sentinel (fail-closed).

    This tests AC4: the grammar ALREADY supports this form (dotpath == bool literal).
    A Skipped result means fail-closed: the evaluator would always return False and
    loops would never short-circuit regardless of the round output.
    """
    expr = "$review-step__r1.output.review_passed == true"
    result = parse(expr)
    assert not isinstance(result, Skipped), (
        f"Grammar-legal predicate {expr!r} must parse without fail-close; "
        f"got Skipped — this predicate form would make loops never converge."
    )


def test_prose_predicate_fails_closed():
    """Prose predicates (current gate_predicate) must fail-closed to Skipped.

    This is the ROOT CAUSE of the bug: prose predicates are blocked by the
    grammar and return Skipped, causing skip_when to always evaluate False,
    so loops always run all max_rounds.

    This test will PASS (prose always fails-closed) — it documents why the
    fix is necessary.
    """
    prose = "review_verdict not equals needs_revision"
    result = parse(prose)
    assert isinstance(result, Skipped), (
        f"Prose predicate {prose!r} must fail-closed (Skipped); got {result!r}. "
        f"If this passes, the grammar is too permissive."
    )


# ---------------------------------------------------------------------------
# S3: classic workflow declares convergence_signal in YAML loop_config
# ---------------------------------------------------------------------------


def test_classic_loop_config_has_convergence_signal_in_yaml():
    """review-converge-loop in development.classic.workflow.yaml must declare
    convergence_signal in its loop_config. Without this, the loader cannot
    validate body outputs and the expander cannot build grammar-legal skip_when.

    Fails RED because the classic YAML currently has no convergence_signal.
    """
    with open(CLASSIC_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)

    steps = {s["id"]: s for s in raw.get("steps", [])}
    assert "review-converge-loop" in steps, (
        "review-converge-loop step must exist in classic workflow"
    )
    lc = steps["review-converge-loop"].get("loop_config", {})
    assert "convergence_signal" in lc, (
        f"review-converge-loop.loop_config must declare convergence_signal; got keys: {list(lc)}"
    )
    assert lc["convergence_signal"] == "review_passed", (
        f"convergence_signal must be 'review_passed'; got {lc['convergence_signal']!r}"
    )


def test_classic_loop_config_has_feature_field_in_yaml():
    """review-converge-loop must declare feature: review_converge so the expander
    actually unrolls it. Without feature, the expander skips the LOOP node.

    Fails RED because the classic YAML currently has no feature field in loop_config.
    """
    with open(CLASSIC_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)

    steps = {s["id"]: s for s in raw.get("steps", [])}
    lc = steps["review-converge-loop"].get("loop_config", {})
    assert "feature" in lc, (
        f"review-converge-loop.loop_config must declare feature (for expander opt-in); "
        f"got keys: {list(lc)}"
    )
    assert lc["feature"] == "review_converge", (
        f"feature must be 'review_converge'; got {lc['feature']!r}"
    )


# ---------------------------------------------------------------------------
# S4 / AC2: classic gate-review uses grammar-legal boolean predicate (not prose)
# ---------------------------------------------------------------------------


def test_classic_gate_review_predicate_is_grammar_legal():
    """gate-review in development.classic.workflow.yaml must use a grammar-legal
    predicate (a dotpath == bool literal form) so it actually evaluates the
    convergence signal. A prose predicate fails-closed to False and always blocks.

    Fails RED because the current gate-review gate is prose:
    'review_verdict must not equal needs_revision'
    """
    with open(CLASSIC_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)

    steps = {s["id"]: s for s in raw.get("steps", [])}
    assert "gate-review" in steps, "gate-review must exist in classic"
    gate_pred = steps["gate-review"].get("gate", "")

    result = parse(gate_pred)
    assert not isinstance(result, Skipped), (
        f"gate-review predicate {gate_pred!r} fails-closed (Skipped). "
        f"Must be a grammar-legal boolean predicate like "
        f"'$<reviewer>__r3.output.review_passed == true' (or a well-formed dotpath form). "
        f"A prose predicate always blocks integrate (bug #26 false-positive)."
    )


def test_classic_gate_review_predicate_references_review_passed():
    """gate-review in classic must reference review_passed (the boolean output),
    not review_verdict (a string field, which fails string-equality in grammar).

    Fails RED because the current gate-review gate references review_verdict prose.
    """
    with open(CLASSIC_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)

    steps = {s["id"]: s for s in raw.get("steps", [])}
    gate_pred = steps["gate-review"].get("gate", "")

    assert "review_passed" in gate_pred, (
        f"gate-review predicate must reference 'review_passed' (boolean); "
        f"got {gate_pred!r}. String field 'review_verdict' cannot be compared "
        f"in the grammar (no string literals)."
    )


# ---------------------------------------------------------------------------
# S5 / Grep guard: no prose predicate in any loop skip_when after unrolling
# ---------------------------------------------------------------------------


def test_no_prose_predicate_in_loop_skip_when(tmp_path: Path, monkeypatch):
    """After unrolling, no round-copy node should carry a prose skip_when.

    A prose skip_when fails-closed to False every time, making round short-
    circuit impossible. This is the root-cause bug that s3 fixes.

    Fails RED because the expander currently uses gate_predicate (prose) as skip_when.
    """
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_MAX_ROUNDS", "3")

    path = _write_workflow(
        tmp_path, _loop_fixture_with_signal("review_passed", producer="review-step")
    )
    graph = load_workflow(path)

    violations: list[tuple[str, str]] = []
    for node_id, node in graph.nodes.items():
        if node.skip_when is None:
            continue
        result = parse(node.skip_when)
        if isinstance(result, Skipped):
            violations.append((node_id, node.skip_when))

    assert violations == [], (
        f"Found {len(violations)} node(s) with prose (fail-closed) skip_when predicates:\n"
        + "\n".join(f"  {nid}: {sw!r}" for nid, sw in violations)
        + "\nThese will always evaluate False, preventing loop short-circuit."
    )


# ---------------------------------------------------------------------------
# AC1 structural: round 3 would be Skipped when round 2 signal is true
# (graph-level: skip_when for r3 references r2 producer output)
# ---------------------------------------------------------------------------


def test_round_3_skip_when_references_round_2_producer(tmp_path: Path, monkeypatch):
    """AC1 structural proof: round 3's skip_when must reference the ROUND 2 producer
    output (not round 1 or a static string). When the round 2 node emits
    review_passed=true, the skip_when predicate evaluates True and round 3 is Skipped.

    This is the graph-structural precondition for AC1 (runtime convergence).

    Fails RED: skip_when is currently the prose gate_predicate (same for all rounds),
    not a per-round reference.
    """
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_MAX_ROUNDS", "3")

    path = _write_workflow(
        tmp_path, _loop_fixture_with_signal("review_passed", producer="review-step")
    )
    graph = load_workflow(path)

    skip_when_r3 = graph.nodes["fix-step__r3"].skip_when
    # Must reference review-step__r2 (k-1 part of the OR-chain)
    assert "review-step__r2" in (skip_when_r3 or ""), (
        f"fix-step__r3.skip_when must reference 'review-step__r2' (k-1 term of OR-chain); "
        f"got {skip_when_r3!r}"
    )
    # OR-chain fix: r1 MUST also be in r3's skip_when (all-prior-rounds contract).
    # The old k-1-only contract excluded r1 — that was the bug. Drop the negative assertion.
    assert "review-step__r1" in (skip_when_r3 or ""), (
        f"fix-step__r3.skip_when must reference 'review-step__r1' (OR-chain includes ALL prior rounds); "
        f"got {skip_when_r3!r}"
    )
    # Must reference review_passed
    assert "review_passed" in (skip_when_r3 or ""), (
        f"fix-step__r3.skip_when must reference signal 'review_passed'; "
        f"got {skip_when_r3!r}"
    )


# ---------------------------------------------------------------------------
# AC3 (extra): loader fails loud for empty body when signal is declared
# ---------------------------------------------------------------------------


def _loop_fixture_empty_body(convergence_signal: str = "review_passed") -> str:
    """Workflow where the LOOP declares a convergence_signal but sub_graph has ZERO body nodes.

    No step is tagged with sub_graph: review-fix-cycle. The loader must fail loud
    (not silently skip) because the signal can never be produced.
    """
    return f"""
name: empty-body-signal-test
version: "1.0.0"
steps:
  - id: review-converge-loop
    node_type: loop
    agent: ""
    loop_config:
      sub_graph: review-fix-cycle
      gate_predicate: "whatever placeholder"
      max_rounds: 3
      feature: review_converge
      convergence_signal: {convergence_signal}
    depends_on: []

  - id: post-loop-step
    agent: developer
    # NOTE: sub_graph is NOT set — the body is empty
    depends_on: [review-converge-loop]

  - id: terminal-gate
    node_type: gate
    agent: ""
    gate: "placeholder"
    depends_on: [review-converge-loop]
"""


def test_loader_fails_loud_for_empty_body_with_signal(tmp_path: Path):
    """AC3 (empty body): a LOOP that declares convergence_signal but has ZERO body
    nodes must fail with a loud GraphLoadError, not silently continue.

    Previously loader.py:217-218 did `if not body_nodes: continue` — this test
    pins the new fail-loud behavior.
    """
    path = _write_workflow(tmp_path, _loop_fixture_empty_body("review_passed"))

    with pytest.raises((GraphLoadError, LoopConfigError)) as exc_info:
        load_workflow(path)

    msg = str(exc_info.value)
    assert "review_passed" in msg, (
        f"Error must name the missing signal 'review_passed'; got: {msg!r}"
    )
    assert "review-converge-loop" in msg or "review-fix-cycle" in msg, (
        f"Error must name the offending loop template; got: {msg!r}"
    )


_DEP_LESS_BODY_WORKFLOW = """
name: dep-less-body-test
version: "1.0.0"
steps:
  - id: pre-loop
    agent: developer

  - id: review-converge-loop
    node_type: loop
    agent: ""
    loop_config:
      sub_graph: review-fix-cycle
      gate_predicate: "whatever placeholder"
      max_rounds: 3
      feature: review_converge
      convergence_signal: review_passed
    depends_on: [pre-loop]

  - id: fix-step
    agent: developer
    sub_graph: review-fix-cycle
    # NOTE: no depends_on at all — the dep-less body node this test targets.
    outputs:
      - name: review_passed
        type: json

  - id: terminal-gate
    node_type: gate
    agent: ""
    gate: "$review-converge-loop.output.review_passed == true"
    depends_on: [review-converge-loop]
"""


def test_loader_fails_loud_for_dep_less_body_node(tmp_path: Path):
    """pr20-fable-review T3: a loop-body node with an empty `depends_on`
    must fail loudly at load time.

    Previously `_entry_nodes` (unroll.py) treats a dep-less body node as
    neither an entry node (its `any(dep not in body_ids ...)` check is
    vacuously False over an empty depends_on) nor a recipient of an
    external dep at round 1 — every round copy of that node ends up with
    `depends_on == []`, so ALL its round copies dispatch concurrently in
    the walker's first wave instead of one round at a time.
    """
    path = _write_workflow(tmp_path, _DEP_LESS_BODY_WORKFLOW)

    with pytest.raises(GraphLoadError) as exc_info:
        load_workflow(path)

    msg = str(exc_info.value)
    assert "fix-step" in msg, f"Error must name the dep-less body node; got: {msg!r}"
    assert "depends_on" in msg, f"Error must mention depends_on; got: {msg!r}"


_NESTED_LOOP_WORKFLOW = """
name: nested-loop-test
version: "1.0.0"
steps:
  - id: pre-loop
    agent: developer

  - id: outer-loop
    node_type: loop
    agent: ""
    loop_config:
      sub_graph: outer-cycle
      gate_predicate: "whatever placeholder"
      max_rounds: 3
      feature: review_converge
      convergence_signal: outer_signal
    depends_on: [pre-loop]

  - id: inner-loop
    node_type: loop
    agent: ""
    sub_graph: outer-cycle
    depends_on: [pre-loop]
    loop_config:
      sub_graph: inner-cycle
      gate_predicate: "whatever placeholder"
      max_rounds: 2
      feature: tdd_red_green
      convergence_signal: inner_signal
    outputs:
      - name: outer_signal
        type: json

  - id: inner-step
    agent: developer
    sub_graph: inner-cycle
    depends_on: [pre-loop]
    outputs:
      - name: inner_signal
        type: json

  - id: terminal-gate
    node_type: gate
    agent: ""
    gate: "$outer-loop.output.outer_signal == true"
    depends_on: [outer-loop]
"""


def test_loader_fails_loud_for_nested_loops(tmp_path: Path):
    """pr20-fable-review T4: an outer LOOP whose body contains another LOOP
    node must fail loudly at load time rather than reach expansion, where
    the outer pass deletes the inner LOOP node as an ordinary body member
    without ever expanding its own body.
    """
    path = _write_workflow(tmp_path, _NESTED_LOOP_WORKFLOW)

    with pytest.raises(GraphLoadError) as exc_info:
        load_workflow(path)

    msg = str(exc_info.value)
    assert "outer-loop" in msg, f"Error must name the outer loop; got: {msg!r}"
    assert "inner-loop" in msg, f"Error must name the nested inner loop; got: {msg!r}"


# ---------------------------------------------------------------------------
# AC1 / AC2 executor-level: real convergence + non-convergence execution tests
# ---------------------------------------------------------------------------


def _executor_workflow_yaml(max_rounds: int = 3) -> str:
    """Minimal workflow for executor-level convergence tests.

    Includes a terminal gate using the GateHandler-supported prose form
    ``review_passed must equal true`` so the gate actually evaluates the
    last round's boolean convergence signal (bug-#26 preserved).
    """
    return f"""
name: executor-convergence-test
version: "1.0.0"
steps:
  - id: pre-loop
    agent: developer

  - id: review-converge-loop
    node_type: loop
    agent: ""
    loop_config:
      sub_graph: review-fix-cycle
      gate_predicate: "whatever placeholder"
      max_rounds: {max_rounds}
      feature: review_converge
      convergence_signal: review_passed
    depends_on: [pre-loop]

  - id: fix-step
    agent: developer
    sub_graph: review-fix-cycle
    depends_on: [pre-loop]

  - id: review-step
    agent: reviewer
    sub_graph: review-fix-cycle
    depends_on: [fix-step]
    outputs:
      - name: review_passed
        type: json

  - id: terminal-gate
    node_type: gate
    agent: ""
    gate: "$review-converge-loop.output.review_passed == true"
    depends_on: [review-converge-loop]
    inputs:
      - name: review_passed
        source: step_output
        step_id: review-converge-loop
        output_name: review_passed
"""


def _make_convergence_dispatcher(round_outputs_by_step: dict[str, dict]) -> "Dispatcher":
    """Build a Dispatcher whose AGENT handler returns canned outputs by node id.

    ``round_outputs_by_step`` maps node_id → dict of output values.
    Missing node_ids return empty outputs.
    """
    from hive.lib.dag_executor.executor.dispatcher import Dispatcher
    from hive.lib.dag_executor.executor.handlers import NodeOutput

    def agent_handler(node, inputs, run_id):
        return NodeOutput(outputs=dict(round_outputs_by_step.get(node.id, {})))

    return Dispatcher(handlers={NodeType.AGENT: agent_handler})


def test_ac1_executor_round3_skipped_when_round2_converges(tmp_path: Path, monkeypatch):
    """AC1 executor-level: when round 2 emits review_passed=True, round 3 body nodes
    are Skipped (not executed). This tests the actual skip_when predicate evaluation
    in the executor walker, not just the graph-structural wiring.

    The test was absent from the RED phase; adding it here validates that the
    skip_when evaluation bug (presence-only skip, not predicate evaluation) is fixed.
    """
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_MAX_ROUNDS", "3")

    path = _write_workflow(tmp_path, _executor_workflow_yaml(max_rounds=3))
    graph = load_workflow(path)

    # Verify the graph expanded correctly
    assert "review-step__r1" in graph.nodes
    assert "review-step__r2" in graph.nodes
    assert "review-step__r3" in graph.nodes

    from hive.lib.dag_executor.executor.telemetry import Telemetry
    from hive.lib.dag_executor.executor.walker import Walker

    # Round 1: review_passed=False (not converged)
    # Round 2: review_passed=True (converged!)
    # Round 3 body should be Skipped
    canned = {
        "pre-loop": {},
        "fix-step__r1": {},
        "review-step__r1": {"review_passed": False},
        "fix-step__r2": {},
        "review-step__r2": {"review_passed": True},
        "fix-step__r3": {},   # should be Skipped — skip_when == True
        "review-step__r3": {},  # should be Skipped — upstream skipped
    }
    disp = _make_convergence_dispatcher(canned)
    tel = Telemetry(run_id="test-ac1")

    # The terminal gate may raise (review-step__r3 is skipped → None → gate fails).
    # We only care that round 3 body nodes are Skipped — wrap the gate failure.
    try:
        Walker().walk(graph, disp, "test-ac1", tel)
    except Exception:
        pass  # terminal gate exception is expected when last round is skipped

    # Collect skipped node ids from telemetry (field is step_id per Telemetry schema)
    skipped_ids = {
        e["step_id"]
        for e in tel.events
        if e["event_type"] == "node_skipped"
    }

    assert "fix-step__r3" in skipped_ids, (
        f"fix-step__r3 must be Skipped when round 2 converges; "
        f"skipped_ids={skipped_ids!r}"
    )
    assert "review-step__r3" in skipped_ids, (
        f"review-step__r3 must be Skipped when round 2 converges; "
        f"skipped_ids={skipped_ids!r}"
    )

    # Rounds 1 and 2 must have run (in materialised, i.e., not skipped)
    ran_ids = {
        e["step_id"]
        for e in tel.events
        if e["event_type"] == "node_completed"
    }
    assert "review-step__r1" in ran_ids, (
        "review-step__r1 must have run (round 1)"
    )
    assert "review-step__r2" in ran_ids, (
        "review-step__r2 must have run (round 2)"
    )
    assert "fix-step__r3" not in ran_ids, (
        "fix-step__r3 must NOT have run (round 3 skipped due to convergence)"
    )


def test_ac2_executor_all_rounds_run_and_gate_blocks(tmp_path: Path, monkeypatch):
    """AC2 executor-level: when review_passed is never True, all max_rounds run
    AND the terminal gate blocks integration (bug-#26 preserved).

    This is the non-convergence path: the loop exhausts its ceiling and the
    terminal gate sees False → raises GateFailedError → integrate cannot run.
    """
    from hive.lib.dag_executor.executor.errors import GateFailedError
    from hive.lib.dag_executor.executor.telemetry import Telemetry
    from hive.lib.dag_executor.executor.walker import Walker

    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_MAX_ROUNDS", "3")

    path = _write_workflow(tmp_path, _executor_workflow_yaml(max_rounds=3))
    graph = load_workflow(path)

    # All rounds: review_passed=False (never converges)
    canned = {
        "pre-loop": {},
        "fix-step__r1": {},
        "review-step__r1": {"review_passed": False},
        "fix-step__r2": {},
        "review-step__r2": {"review_passed": False},
        "fix-step__r3": {},
        "review-step__r3": {"review_passed": False},
    }
    disp = _make_convergence_dispatcher(canned)
    tel = Telemetry(run_id="test-ac2")

    # Terminal gate must block — GateFailedError propagates from the walker
    with pytest.raises((GateFailedError, Exception)) as exc_info:
        Walker().walk(graph, disp, "test-ac2", tel)

    # Verify the exception is gate-related (not a bug in something else)
    err_msg = str(exc_info.value)
    assert "gate" in err_msg.lower() or "review_passed" in err_msg.lower(), (
        f"Expected gate-related failure; got: {err_msg!r}"
    )

    # All 3 rounds must have run (not Skipped)
    completed_ids = {
        e["step_id"]
        for e in tel.events
        if e["event_type"] == "node_completed"
    }
    for k in range(1, 4):
        assert f"review-step__r{k}" in completed_ids, (
            f"review-step__r{k} must have run (max_rounds={3}, review_passed always False); "
            f"completed_ids={completed_ids!r}"
        )
        assert f"fix-step__r{k}" in completed_ids, (
            f"fix-step__r{k} must have run (round {k})"
        )


# ---------------------------------------------------------------------------
# rec-1 AC1: skip propagates past a gap (converge at r1 → r2 AND r3 skipped)
# ---------------------------------------------------------------------------


def test_skip_past_gap_or_chain_graph_structure(tmp_path: Path, monkeypatch):
    """Graph-structural proof of skip-past-gap via the OR-chain.

    For a 3-round loop, round 3's skip_when must include the r1 signal so that
    when r1 converges (r2 becomes skipped/None), the OR-chain still evaluates True
    and skips r3.  This pinpoints the contract that prevents the 'gap' failure mode.

    Should PASS once the OR-chain is emitted (impl already in place from s3 fix).
    """
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_MAX_ROUNDS", "3")

    path = _write_workflow(
        tmp_path, _loop_fixture_with_signal("review_passed", producer="review-step")
    )
    graph = load_workflow(path)

    # r2 skip_when should reference only r1 (single prior round)
    expected_r2 = "$review-step__r1.output.review_passed == true"
    assert graph.nodes["fix-step__r2"].skip_when == expected_r2, (
        f"fix-step__r2.skip_when must be {expected_r2!r}; "
        f"got {graph.nodes['fix-step__r2'].skip_when!r}"
    )

    # r3 skip_when must include BOTH r1 and r2 (OR-chain over all prior rounds)
    sw_r3 = graph.nodes["fix-step__r3"].skip_when or ""
    assert "review-step__r1" in sw_r3, (
        f"fix-step__r3.skip_when must include r1 term to cover skip-past-gap; got {sw_r3!r}"
    )
    assert "review-step__r2" in sw_r3, (
        f"fix-step__r3.skip_when must include r2 term; got {sw_r3!r}"
    )
    assert "||" in sw_r3, (
        f"fix-step__r3.skip_when must join terms with '||'; got {sw_r3!r}"
    )


def test_skip_past_gap_executor_r1_converge_skips_r2_and_r3(tmp_path: Path, monkeypatch):
    """AC1 executor-level: convergence at r1 causes BOTH r2 and r3 to be skipped.

    This is the 'skip past a gap' scenario:
    - r1 runs and emits review_passed=True
    - r2 skip_when ($r1.output.review_passed == true) → evaluates True → r2 SKIPPED
    - r3 skip_when (OR-chain) → r1 term evaluates True even though r2 is None → r3 SKIPPED

    Fails RED (against current impl) if the OR-chain is absent or the runtime
    evaluator doesn't short-circuit on the r1 True when r2 is skipped/None.
    """
    from hive.lib.dag_executor.executor.telemetry import Telemetry
    from hive.lib.dag_executor.executor.walker import Walker

    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_MAX_ROUNDS", "3")

    path = _write_workflow(tmp_path, _executor_workflow_yaml(max_rounds=3))
    graph = load_workflow(path)

    # Round 1 converges immediately; rounds 2 and 3 should both be skipped.
    canned = {
        "pre-loop": {},
        "fix-step__r1": {},
        "review-step__r1": {"review_passed": True},
        # r2 and r3 should NOT be dispatched to — if they are, it is a bug.
        "fix-step__r2": {"review_passed": False},
        "review-step__r2": {"review_passed": False},
        "fix-step__r3": {"review_passed": False},
        "review-step__r3": {"review_passed": False},
    }
    disp = _make_convergence_dispatcher(canned)
    tel = Telemetry(run_id="test-skip-past-gap")

    try:
        Walker().walk(graph, disp, "test-skip-past-gap", tel)
    except Exception:
        pass  # terminal-gate may raise; we only inspect skip events

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

    assert "fix-step__r2" in skipped_ids, (
        f"fix-step__r2 must be skipped (r1 converged); skipped={skipped_ids!r}"
    )
    assert "review-step__r2" in skipped_ids, (
        f"review-step__r2 must be skipped (r1 converged); skipped={skipped_ids!r}"
    )
    assert "fix-step__r3" in skipped_ids, (
        f"fix-step__r3 must be skipped (OR-chain covers the gap at r2); skipped={skipped_ids!r}"
    )
    assert "review-step__r3" in skipped_ids, (
        f"review-step__r3 must be skipped (OR-chain covers the gap at r2); skipped={skipped_ids!r}"
    )
    # r1 must have run
    assert "review-step__r1" in ran_ids, "review-step__r1 must have run (round 1)"


# ---------------------------------------------------------------------------
# rec-1 AC3: early-converged run → terminal gate PROCEEDS (last-successful-round)
# ---------------------------------------------------------------------------


def test_early_converge_gate_integrates(tmp_path: Path, monkeypatch):
    """AC: when a loop converges early (r1 of 3), the terminal gate must READ the
    last successful round's signal and PASS — integrate is not blocked.

    Today the gate is rewritten to reference the STATIC last round ($__rN).  When
    rN is skipped, its output is None → gate evaluates False → raises GateFailedError
    → integrate is wrongly blocked.

    The fix (last-successful-round gate redirect) makes the gate reference the last
    un-skipped round (r1 here) whose output IS True → gate passes → no exception.

    Fails RED against current impl (static __rN binding causes gate to fail-close).
    """
    from hive.lib.dag_executor.executor.telemetry import Telemetry
    from hive.lib.dag_executor.executor.walker import Walker

    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_MAX_ROUNDS", "3")

    path = _write_workflow(tmp_path, _executor_workflow_yaml(max_rounds=3))
    graph = load_workflow(path)

    # r1 converges; r2 and r3 are skipped by OR-chain skip_when.
    canned = {
        "pre-loop": {},
        "fix-step__r1": {},
        "review-step__r1": {"review_passed": True},
    }
    disp = _make_convergence_dispatcher(canned)
    tel = Telemetry(run_id="test-early-converge-gate")

    # Must NOT raise — the gate should redirect to r1's True output and pass.
    Walker().walk(graph, disp, "test-early-converge-gate", tel)

    completed_ids = {
        e["step_id"]
        for e in tel.events
        if e["event_type"] == "node_completed"
    }
    assert "review-step__r1" in completed_ids, "r1 must have run"
    # The terminal gate must have completed (not errored / raised)
    assert "terminal-gate" in completed_ids, (
        f"terminal-gate must have completed when loop converged at r1; "
        f"completed={completed_ids!r}"
    )


# ---------------------------------------------------------------------------
# rec-1 AC4: never-converged run → gate blocks (bug-#26 preserved)
# Duplicates AC2 for explicitness per rec-1 acceptance_criteria.
# ---------------------------------------------------------------------------


def test_never_converge_gate_blocks_bug26(tmp_path: Path, monkeypatch):
    """rec-1 AC: when all rounds run and review_passed stays False, the terminal
    gate must block integrate (raise an exception). Bug-#26 is preserved.

    This is a dedicated rec-1 pin independent of the earlier test_ac2 test.
    Must PASS against current impl (static last-round binding reads False → blocks).
    Must continue to PASS after the last-successful-round fix (False stays False).
    """
    from hive.lib.dag_executor.executor.errors import GateFailedError
    from hive.lib.dag_executor.executor.telemetry import Telemetry
    from hive.lib.dag_executor.executor.walker import Walker

    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_REVIEW_CONVERGE_MAX_ROUNDS", "3")

    path = _write_workflow(tmp_path, _executor_workflow_yaml(max_rounds=3))
    graph = load_workflow(path)

    canned = {
        "pre-loop": {},
        "fix-step__r1": {},
        "review-step__r1": {"review_passed": False},
        "fix-step__r2": {},
        "review-step__r2": {"review_passed": False},
        "fix-step__r3": {},
        "review-step__r3": {"review_passed": False},
    }
    disp = _make_convergence_dispatcher(canned)
    tel = Telemetry(run_id="test-never-converge")

    with pytest.raises((GateFailedError, Exception)):
        Walker().walk(graph, disp, "test-never-converge", tel)

    # All 3 rounds must have run (no premature skip)
    completed_ids = {
        e["step_id"]
        for e in tel.events
        if e["event_type"] == "node_completed"
    }
    for k in range(1, 4):
        assert f"review-step__r{k}" in completed_ids, (
            f"review-step__r{k} must have run; completed={completed_ids!r}"
        )


# ---------------------------------------------------------------------------
# rec-1 AC5-6: config-file drives enabled + max_rounds (no env var)
# ---------------------------------------------------------------------------


def _test_swarm_loop_fixture(yaml_max_rounds: int = 5) -> str:
    """Minimal test_swarm loop fixture.  Feature defaults to disabled (opt-in).
    Used to probe config-file-driven feature toggling.
    """
    return f"""
name: test-swarm-config-probe
version: "1.0.0"
steps:
  - id: pre-swarm
    agent: developer

  - id: test-runner
    node_type: loop
    agent: ""
    loop_config:
      sub_graph: swarm-cycle
      gate_predicate: "whatever placeholder"
      max_rounds: {yaml_max_rounds}
      feature: test_swarm
      convergence_signal: all_passed
    depends_on: [pre-swarm]

  - id: run-tests
    agent: tester
    sub_graph: swarm-cycle
    # pr20-fable-review T3: every loop-body node must declare a dependency
    # (loader.py _validate_body_nodes_have_deps rejects an empty depends_on)
    # so the expander can establish round-to-round ordering.
    depends_on: [pre-swarm]
    outputs:
      - name: all_passed
        type: json

  - id: terminal-gate
    node_type: gate
    agent: ""
    gate: "$test-runner.output.all_passed == true"
    depends_on: [test-runner]
"""


def test_config_file_drives_enabled_no_env(tmp_path: Path, monkeypatch):
    """AC5: loops.test_swarm.enabled=true set ONLY in hive.config.yaml (no env var)
    must cause the expander to emit multi-round copies.

    test_swarm defaults to disabled (FEATURE_DEFAULTS[test_swarm]=False) so without
    the config file the expander emits a single degenerate round.

    Fails RED against current impl: _resolve_feature reads only env vars and never
    consults the config file, so the feature stays disabled.
    """
    # Write a project-level hive.config.yaml into tmp_path and chdir there so
    # the default resolve_loop_config project path (cwd / hive.config.yaml) finds it.
    config_path = tmp_path / "hive.config.yaml"
    config_path.write_text(
        "loops:\n  test_swarm:\n    enabled: true\n    max_rounds: 3\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)

    # Ensure no env vars interfere
    monkeypatch.delenv("HIVE_LOOPS_TEST_SWARM_ENABLED", raising=False)
    monkeypatch.delenv("HIVE_LOOPS_TEST_SWARM_MAX_ROUNDS", raising=False)

    path = _write_workflow(tmp_path, _test_swarm_loop_fixture(yaml_max_rounds=5))
    graph = load_workflow(path)

    # If enabled via config, we expect at least r2 (multi-round expansion).
    assert "run-tests__r1" in graph.nodes, "run-tests__r1 must always exist"
    assert "run-tests__r2" in graph.nodes, (
        "run-tests__r2 must exist when config file sets loops.test_swarm.enabled=true; "
        "if missing, _resolve_feature is ignoring the config file"
    )
    assert "run-tests__r3" in graph.nodes, (
        "run-tests__r3 must exist when config file sets max_rounds=3"
    )


def test_config_file_drives_max_rounds_no_env(tmp_path: Path, monkeypatch):
    """AC6: loops.test_swarm.max_rounds=2 in hive.config.yaml (with enabled via env,
    but no MAX_ROUNDS env) must override the YAML loop_config max_rounds of 5.

    After the fix, precedence is env > config file > yaml default.
    The YAML loop_config has max_rounds=5 but the config file sets 2.

    Fails RED against current impl: _resolve_feature falls back to yaml_max_rounds
    when HIVE_LOOPS_TEST_SWARM_MAX_ROUNDS is absent, so 5 rounds would be emitted.
    """
    config_path = tmp_path / "hive.config.yaml"
    config_path.write_text(
        "loops:\n  test_swarm:\n    enabled: true\n    max_rounds: 2\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)

    # enabled comes from env; MAX_ROUNDS env is absent so config should provide it
    monkeypatch.setenv("HIVE_LOOPS_TEST_SWARM_ENABLED", "true")
    monkeypatch.delenv("HIVE_LOOPS_TEST_SWARM_MAX_ROUNDS", raising=False)

    path = _write_workflow(tmp_path, _test_swarm_loop_fixture(yaml_max_rounds=5))
    graph = load_workflow(path)

    assert "run-tests__r1" in graph.nodes, "r1 must exist"
    assert "run-tests__r2" in graph.nodes, "r2 must exist (max_rounds=2 from config)"
    assert "run-tests__r3" not in graph.nodes, (
        "run-tests__r3 must NOT exist when config file sets max_rounds=2; "
        "got 3+ rounds — _resolve_feature is not consulting the config file for max_rounds"
    )


def test_env_overrides_config_file_max_rounds(tmp_path: Path, monkeypatch):
    """AC6 (env wins): env HIVE_LOOPS_TEST_SWARM_MAX_ROUNDS=2 must override
    hive.config.yaml max_rounds=5 and the YAML loop_config max_rounds=10.

    Must PASS both before and after the fix (env already wins today); retained to
    confirm the fix does not accidentally break the env-first precedence rule.
    """
    config_path = tmp_path / "hive.config.yaml"
    config_path.write_text(
        "loops:\n  test_swarm:\n    enabled: true\n    max_rounds: 5\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)

    monkeypatch.setenv("HIVE_LOOPS_TEST_SWARM_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_TEST_SWARM_MAX_ROUNDS", "2")

    path = _write_workflow(tmp_path, _test_swarm_loop_fixture(yaml_max_rounds=10))
    graph = load_workflow(path)

    assert "run-tests__r1" in graph.nodes
    assert "run-tests__r2" in graph.nodes
    assert "run-tests__r3" not in graph.nodes, (
        "run-tests__r3 must NOT exist — env max_rounds=2 must win over config+yaml"
    )


# ---------------------------------------------------------------------------
# rec-1 P1: non-signal input bindings resolve from last run round (not static rN)
# ---------------------------------------------------------------------------


def _tdd_like_workflow_yaml(max_rounds: int = 3) -> str:
    """TDD-like workflow exposing the P1 non-signal input-binding defect.

    The loop body has implement (non-signal producer) and tdd-tester (signal
    producer).  A post-loop gate-tests node uses a PROSE predicate
    ``implementation must not be empty`` against an input binding wired to
    the loop's ``implementation`` output.

    P1 scenario (early convergence at r1, 3 rounds):
    - implement__r1, tdd-tester__r1 run; tdd-tester__r1 emits tests_green=True.
    - implement__r2, tdd-tester__r2, implement__r3, tdd-tester__r3 are SKIPPED.
    - Static final-round binding: gate-tests.implementation → implement__r3
      (skipped) → None → "implementation must not be empty" fires → gate BLOCKS.
    - With the P1 fix (fallback_step_ids = [implement__r2, implement__r1]):
      implement__r3 is skipped, implement__r2 is skipped, implement__r1 is
      materialised → implementation = "the code" → gate PASSES.
    """
    return f"""
name: tdd-p1-integration-test
version: "1.0.0"
steps:
  - id: write-brief
    agent: researcher

  - id: tdd-red-green-loop
    node_type: loop
    agent: ""
    loop_config:
      sub_graph: tdd-cycle
      gate_predicate: "whatever placeholder"
      max_rounds: {max_rounds}
      feature: tdd_loop
      convergence_signal: tests_green
    depends_on: [write-brief]

  - id: implement
    agent: developer
    sub_graph: tdd-cycle
    depends_on: [write-brief]
    outputs:
      - name: implementation
        type: string
      - name: commit_sha
        type: string

  - id: tdd-tester
    agent: tester
    sub_graph: tdd-cycle
    depends_on: [implement]
    outputs:
      - name: tests_green
        type: json

  - id: gate-tests
    node_type: gate
    agent: ""
    gate: "implementation must not be empty"
    depends_on: [tdd-red-green-loop]
    inputs:
      - name: implementation
        source: step_output
        step_id: tdd-red-green-loop
        output_name: implementation

  - id: terminal-gate
    node_type: gate
    agent: ""
    gate: "$tdd-red-green-loop.output.tests_green == true"
    depends_on: [tdd-red-green-loop]
"""


def test_p1_early_converge_non_signal_input_binding_has_fallbacks(tmp_path: Path, monkeypatch):
    """Graph-structural: after unrolling with a convergence signal, post-loop input
    bindings for NON-SIGNAL outputs must carry fallback_step_ids (rN-1 … r1).

    Without fallbacks: on early convergence, the static rN binding resolves to None
    because rN is skipped.  With fallbacks, the walker falls back to the last
    materialised round.
    """
    monkeypatch.setenv("HIVE_LOOPS_TDD_LOOP_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_TDD_LOOP_MAX_ROUNDS", "3")

    path = _write_workflow(tmp_path, _tdd_like_workflow_yaml(max_rounds=3))
    graph = load_workflow(path)

    gate_tests = graph.nodes["gate-tests"]
    impl_binding = next((b for b in gate_tests.inputs if b.name == "implementation"), None)
    assert impl_binding is not None, "gate-tests must have an 'implementation' input binding"

    # Primary binding must point to static final round (rN)
    assert impl_binding.step_id == "implement__r3", (
        f"implementation binding primary step_id must be implement__r3 (static rN); "
        f"got {impl_binding.step_id!r}"
    )

    # Must carry fallback_step_ids in reverse round order (rN-1, …, r1)
    assert hasattr(impl_binding, "fallback_step_ids"), (
        "InputBinding must have fallback_step_ids attribute"
    )
    expected_fallbacks = ["implement__r2", "implement__r1"]
    assert impl_binding.fallback_step_ids == expected_fallbacks, (
        f"fallback_step_ids must be {expected_fallbacks!r} (rN-1 → r1 order); "
        f"got {impl_binding.fallback_step_ids!r}"
    )


def test_p1_early_converge_non_signal_binding_resolves_last_run_round(
    tmp_path: Path, monkeypatch
):
    """AC (P1 fix): when a loop converges early (r1 of 3), post-loop nodes with
    input bindings to NON-SIGNAL outputs must resolve from the last run round (r1),
    not the static final round (r3, which is skipped → None).

    Specifically: gate-tests checks 'implementation must not be empty' via an input
    binding to the loop's 'implementation' output.  Before the fix, the binding
    points to implement__r3 (skipped) → None → gate blocks.  After the fix,
    fallback_step_ids = [implement__r2, implement__r1]; implement__r2 is also
    skipped; implement__r1 is materialised → implementation resolved → gate passes.

    This test was RED before the P1 fix (static rN binding, no fallbacks).
    """
    from hive.lib.dag_executor.executor.dispatcher import Dispatcher
    from hive.lib.dag_executor.executor.handlers import NodeOutput
    from hive.lib.dag_executor.executor.telemetry import Telemetry
    from hive.lib.dag_executor.executor.walker import Walker

    monkeypatch.setenv("HIVE_LOOPS_TDD_LOOP_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_TDD_LOOP_MAX_ROUNDS", "3")

    path = _write_workflow(tmp_path, _tdd_like_workflow_yaml(max_rounds=3))
    graph = load_workflow(path)

    # r1 converges immediately.  r2 and r3 should be skipped by the OR-chain.
    # implement__r1 produces a non-empty implementation.
    canned = {
        "write-brief": {},
        "implement__r1": {"implementation": "the code", "commit_sha": "abc123"},
        "tdd-tester__r1": {"tests_green": True},
    }

    def agent_handler(node, inputs, run_id):
        return NodeOutput(outputs=dict(canned.get(node.id, {})))

    disp = Dispatcher(handlers={NodeType.AGENT: agent_handler})
    tel = Telemetry(run_id="test-p1-binding")

    # Must NOT raise.  gate-tests must resolve implementation from implement__r1
    # (last run round) via fallback_step_ids and pass "implementation must not be empty".
    Walker().walk(graph, disp, "test-p1-binding", tel)

    completed_ids = {
        e["step_id"] for e in tel.events if e["event_type"] == "node_completed"
    }
    skipped_ids = {
        e["step_id"] for e in tel.events if e["event_type"] == "node_skipped"
    }

    assert "gate-tests" in completed_ids, (
        f"gate-tests must have completed; 'implementation must not be empty' must "
        f"resolve from implement__r1 (last run round) via fallback_step_ids, not "
        f"from implement__r3 (skipped → None). completed={completed_ids!r}"
    )
    # r2 and r3 body nodes must be skipped (convergence at r1)
    assert "implement__r2" in skipped_ids, "implement__r2 must be skipped (r1 converged)"
    assert "implement__r3" in skipped_ids, "implement__r3 must be skipped (r1 converged)"


def test_p1_full_run_non_signal_binding_still_resolves_final_round(
    tmp_path: Path, monkeypatch
):
    """Non-regression: when the loop does NOT converge early (all rounds run),
    the static final round (rN) binding must still resolve correctly.

    The fallback_step_ids change must not break the non-convergence path: when
    rN is materialised (full run), the primary binding step_id == rN is not in
    skipped and resolves normally.
    """
    from hive.lib.dag_executor.executor.dispatcher import Dispatcher
    from hive.lib.dag_executor.executor.errors import GateFailedError
    from hive.lib.dag_executor.executor.handlers import NodeOutput
    from hive.lib.dag_executor.executor.telemetry import Telemetry
    from hive.lib.dag_executor.executor.walker import Walker

    monkeypatch.setenv("HIVE_LOOPS_TDD_LOOP_ENABLED", "true")
    monkeypatch.setenv("HIVE_LOOPS_TDD_LOOP_MAX_ROUNDS", "3")

    path = _write_workflow(tmp_path, _tdd_like_workflow_yaml(max_rounds=3))
    graph = load_workflow(path)

    # All 3 rounds run; tests_green stays False until r3. gate-tests must
    # resolve implementation from implement__r3 (the static rN binding, materialised).
    canned = {
        "write-brief": {},
        "implement__r1": {"implementation": "v1", "commit_sha": "sha1"},
        "tdd-tester__r1": {"tests_green": False},
        "implement__r2": {"implementation": "v2", "commit_sha": "sha2"},
        "tdd-tester__r2": {"tests_green": False},
        "implement__r3": {"implementation": "v3", "commit_sha": "sha3"},
        "tdd-tester__r3": {"tests_green": False},
    }

    def agent_handler(node, inputs, run_id):
        return NodeOutput(outputs=dict(canned.get(node.id, {})))

    disp = Dispatcher(handlers={NodeType.AGENT: agent_handler})
    tel = Telemetry(run_id="test-p1-full-run")

    # terminal-gate blocks (tests_green always False) → GateFailedError expected.
    # gate-tests must pass (implementation from rN = "v3", not empty).
    with pytest.raises((GateFailedError, Exception)):
        Walker().walk(graph, disp, "test-p1-full-run", tel)

    completed_ids = {
        e["step_id"] for e in tel.events if e["event_type"] == "node_completed"
    }
    # gate-tests must have completed (not failed on "implementation must not be empty")
    assert "gate-tests" in completed_ids, (
        f"gate-tests must complete when full run provides implementation from rN; "
        f"completed={completed_ids!r}"
    )


# ---------------------------------------------------------------------------
# rec-1 compound-gate safety: OR-chain must NOT be injected into compound gates
# ---------------------------------------------------------------------------

_COMPOUND_GATE_WORKFLOW = """
name: compound-gate-test
version: "1.0.0"
steps:
  - id: pre-loop
    agent: developer

  - id: review-converge-loop
    node_type: loop
    agent: ""
    loop_config:
      sub_graph: review-fix-cycle
      gate_predicate: "whatever placeholder"
      max_rounds: 3
      feature: review_converge
      convergence_signal: review_passed
    depends_on: [pre-loop]

  - id: fix-step
    agent: developer
    sub_graph: review-fix-cycle
    depends_on: [pre-loop]

  - id: review-step
    agent: reviewer
    sub_graph: review-fix-cycle
    depends_on: [fix-step]
    outputs:
      - name: review_passed
        type: json
      - name: ok
        type: json

  - id: terminal-gate
    node_type: gate
    agent: ""
    gate: "$review-converge-loop.output.review_passed == true && $review-converge-loop.output.ok == true"
    depends_on: [review-converge-loop]
"""


def test_compound_gate_on_multi_round_loop_rejected_at_load_time(tmp_path: Path):
    """pr20-fable-review T2 (supersedes the rec-1 "no OR-chain injection" test).

    rec-1 established that a compound gate (``$loop.output.sig == true &&
    $loop.output.other == true``) must NOT receive an OR-chain rewrite — the
    OR-chain has higher precedence than the residual ``&&`` term and Archon
    grammar has no parentheses to scope it safely. That part is still true
    and unchanged.

    What rec-1 left as a silent fallback (generic static-last-round
    substitution) is a real gap: if the loop converges before the last
    round, the static last-round reference has no materialised output, both
    operands fail-closed to False (evaluator.py), and the compound gate
    false-blocks a run that actually converged — with no OR-chain fallback
    for either operand to catch it. pr20-fable-review T2 closes this at load
    time instead of leaving it a silent runtime foot-gun: a gate that
    references a multi-round (`max_rounds > 1`) loop's `convergence_signal`
    inside a compound expression (`&&`/`||`) is now a `GraphLoadError` at
    `load_workflow` time, with a clear message telling the author to split
    the compound condition into two gate nodes or gate on the pure signal
    alone (which DOES get the OR-chain).
    """
    from hive.lib.dag_executor.graph.errors import GraphLoadError

    path = _write_workflow(tmp_path, _COMPOUND_GATE_WORKFLOW)
    with pytest.raises(GraphLoadError, match=r"(?i)compound gate"):
        load_workflow(path)
