"""Evaluator-layer tests — synthetic output graphs, fail-closed missing fields.

Includes the canonical ``metric_signal == true`` / ``== false`` fixture
called out in the story spec. The fixture is SYNTHETIC — it does not
reach into a real workflow file — so the evaluator can be unit-tested
without spinning up the executor.
"""

from __future__ import annotations

from hive.lib.dag_executor.routing import (
    Skipped,
    evaluate,
    parse,
)


# --- canonical metric_signal fixture ------------------------------------


def _metric_signal_graph(value: bool) -> dict:
    """Synthetic output graph mimicking what hde-3a's first real
    consumer (meta-optimize / triage routing) will hand to the evaluator.
    """

    return {
        "triage": {
            "output": {
                "metric_signal": value,
                "change_verdict": "approve",
                "cycle_verdict": "advance",
            }
        }
    }


def test_metric_signal_true_branch():
    ast = parse("$triage.output.metric_signal == true")
    assert evaluate(ast, _metric_signal_graph(True)) is True
    assert evaluate(ast, _metric_signal_graph(False)) is False


def test_metric_signal_false_branch():
    ast = parse("$triage.output.metric_signal == false")
    assert evaluate(ast, _metric_signal_graph(True)) is False
    assert evaluate(ast, _metric_signal_graph(False)) is True


# --- change_verdict vs cycle_verdict (Risk #13 lock) --------------------


def test_change_verdict_vs_cycle_verdict_disambiguation():
    """Predicates referencing the change-level value MUST address
    ``$step.output.change_verdict`` explicitly — bare ``$step.output.verdict``
    is undefined under the documented contract. The evaluator can't
    block the typo (no schema), but the doc lock + this fixture make
    the distinction visible in tests.
    """

    graph = _metric_signal_graph(True)
    change_eq = parse('$triage.output.change_verdict == null')
    # Type mismatch (string vs null literal) is fail-closed False.
    assert evaluate(change_eq, graph) is False

    bare_verdict = parse('$triage.output.verdict == null')
    # Field "verdict" doesn't exist on the synthetic graph → False.
    assert evaluate(bare_verdict, graph) is False


# --- missing field / missing node fail-closed ---------------------------


def test_missing_node_id_fails_closed_false():
    ast = parse("$ghost.output.x == true")
    assert evaluate(ast, _metric_signal_graph(True)) is False


def test_missing_field_fails_closed_false():
    ast = parse("$triage.output.does_not_exist == true")
    assert evaluate(ast, _metric_signal_graph(True)) is False


def test_evaluating_skipped_returns_false():
    """Parsing an invalid predicate yields Skipped; evaluating Skipped
    returns False without touching the output graph.
    """

    sk = parse("(invalid)")
    assert isinstance(sk, Skipped)
    assert evaluate(sk, {}) is False


# --- type / numeric semantics -------------------------------------------


def test_strict_type_equality_blocks_bool_int_coercion():
    """``True == 1`` is True under Python — the evaluator must reject
    cross-type equality so predicate semantics are predictable.
    """

    graph = {"a": {"output": {"flag": True, "n": 1}}}
    bool_vs_int = parse("$a.output.flag == 1")
    assert evaluate(bool_vs_int, graph) is False
    int_vs_int = parse("$a.output.n == 1")
    assert evaluate(int_vs_int, graph) is True


def test_numeric_comparison_rejects_non_numeric_operand():
    graph = {"a": {"output": {"name": "alice", "n": 5}}}
    ast = parse("$a.output.name < 10")
    assert evaluate(ast, graph) is False


def test_numeric_comparison_rejects_bool_operand():
    """bool is a subclass of int in Python — explicitly rejected."""

    graph = {"a": {"output": {"flag": True}}}
    ast = parse("$a.output.flag < 5")
    assert evaluate(ast, graph) is False


def test_numeric_comparison_works_for_int_and_float():
    graph = {"a": {"output": {"n": 5}}, "b": {"output": {"n": 7.5}}}
    assert evaluate(parse("$a.output.n < 10"), graph) is True
    assert evaluate(parse("$a.output.n <= 5"), graph) is True
    assert evaluate(parse("$a.output.n > 4"), graph) is True
    assert evaluate(parse("$a.output.n >= 5"), graph) is True
    assert evaluate(parse("$b.output.n > 7"), graph) is True


def test_short_circuit_and(monkeypatch):
    """``False && <missing>`` short-circuits to False without evaluating
    the right side, so a missing-field RHS does not even get looked up.

    Detection: monkeypatch the dotpath resolver to flip a flag if it is
    asked for node ``b``. A regression that turns short-circuit into
    eager evaluation raises through this path, failing the test.
    """

    from hive.lib.dag_executor.routing import evaluator as ev_mod

    rhs_touched = {"called": False}
    real_resolve = ev_mod._resolve_dotpath

    def spy_resolve(path, output_graph):
        if path.node_id == "b":
            rhs_touched["called"] = True
            raise AssertionError("RHS resolved despite short-circuit")
        return real_resolve(path, output_graph)

    monkeypatch.setattr(ev_mod, "_resolve_dotpath", spy_resolve)

    graph = {"a": {"output": {"x": False}}}
    ast = parse("$a.output.x == true && $b.output.y == true")
    assert evaluate(ast, graph) is False
    assert rhs_touched["called"] is False


def test_short_circuit_or(monkeypatch):
    """``True || <missing>`` short-circuits to True without evaluating RHS."""

    from hive.lib.dag_executor.routing import evaluator as ev_mod

    rhs_touched = {"called": False}
    real_resolve = ev_mod._resolve_dotpath

    def spy_resolve(path, output_graph):
        if path.node_id == "ghost":
            rhs_touched["called"] = True
            raise AssertionError("RHS resolved despite short-circuit")
        return real_resolve(path, output_graph)

    monkeypatch.setattr(ev_mod, "_resolve_dotpath", spy_resolve)

    graph = {"a": {"output": {"x": True}}}
    ast = parse("$a.output.x == true || $ghost.output.y == true")
    assert evaluate(ast, graph) is True
    assert rhs_touched["called"] is False


def test_or_chain_mid_chain_missing_round_does_not_poison_later_true_term():
    """pr20-fable-review T1: an OR-chain gate over rounds
    (`$r1... || $r2... || $r3...`, the shape unroll.py emits for
    rec-1 last-successful-round convergence gates) must not let a
    PredicateEvalError raised while resolving one term (a round that
    optional-failed with ``outputs={}`` — the node id IS recorded but its
    ``output`` dict is missing/empty) abort evaluation of a LATER term that
    would resolve True. Round 2 here has no recorded output; round 3 emits
    x=true. Before the fix, the error raised evaluating round 2's operand
    propagated past round 3's `||` term straight to `evaluate()`'s
    top-level catch, forcing the whole gate False even though round 3
    converged.
    """
    graph = {
        "r1": {"output": {"x": False}},
        # r2 optional-failed: node id present (dispatched) but no "output"
        # key recorded — resolving $r2.output.x raises PredicateEvalError.
        "r2": {},
        "r3": {"output": {"x": True}},
    }
    ast = parse(
        "$r1.output.x == true || $r2.output.x == true || $r3.output.x == true"
    )
    assert evaluate(ast, graph) is True


def test_and_chain_mid_chain_missing_operand_still_fails_closed_false():
    """Companion to the OR-chain fix above: an AND chain with a missing
    operand must still evaluate False overall (fail-closed direction for
    AND is unchanged — only OR's sibling-branch isolation is new)."""
    graph = {
        "r1": {"output": {"x": True}},
        "r2": {},
    }
    ast = parse("$r1.output.x == true && $r2.output.x == true")
    assert evaluate(ast, graph) is False


def test_combined_and_or_evaluation():
    graph = {
        "a": {"output": {"x": True}},
        "b": {"output": {"y": False}},
        "c": {"output": {"z": True}},
    }
    # (a && b) || c — `(False) || True` → True
    ast = parse(
        "$a.output.x == true && $b.output.y == true || $c.output.z == true"
    )
    assert evaluate(ast, graph) is True

    # (a && c) || b — `(True) || False` → True
    ast2 = parse(
        "$a.output.x == true && $c.output.z == true || $b.output.y == true"
    )
    assert evaluate(ast2, graph) is True


def test_string_equality_supported():
    graph = {"step": {"output": {"verdict": "approve"}}}
    ast = parse('$step.output.verdict == "approve"')
    # Strings as literals are NOT in the grammar — string equality is
    # fail-closed because there's no string literal type. Documented.
    assert isinstance(ast, Skipped)


def test_null_equality():
    graph = {"a": {"output": {"x": None}}}
    ast = parse("$a.output.x == null")
    assert evaluate(ast, graph) is True


def test_null_inequality():
    graph = {"a": {"output": {"x": 7}}}
    ast = parse("$a.output.x != null")
    # Type mismatch (int vs None) — strict equality is False, so != is True.
    assert evaluate(ast, graph) is True


def test_intermediate_non_dict_fails_closed():
    """If a path traverses through a list or scalar, return False."""

    graph = {"a": {"output": {"items": [1, 2, 3]}}}
    ast = parse("$a.output.items.first == 1")
    assert evaluate(ast, graph) is False
