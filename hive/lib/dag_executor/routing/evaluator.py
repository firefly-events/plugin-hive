"""Evaluator for parsed predicates against an output graph.

Public entry point: ``evaluate(ast, output_graph) -> bool``.

Fail-closed semantics:
  * ``ast`` is a ``Skipped`` sentinel → return False (parser already
    flagged the cause).
  * Dot-path references a node id that has no output recorded → False.
  * Dot-path resolves a missing field → False.
  * Numeric comparison receives a non-finite or non-numeric value on
    EITHER side → False.
  * Type mismatch on equality (e.g. comparing string to bool literal
    when the dot-path returned a string) → False.

The evaluator NEVER raises to its caller. Helpers raise typed
exceptions internally; the public entry catches them and returns
False so an invalid predicate cannot abort the run.

Output-graph contract: ``output_graph[node_id]`` is a dict with at
least one ``"output"`` key (mirrors ``RunState.output_graph`` plus
the materialised-outputs view the walker hands the evaluator).
Dot-paths that don't traverse ``output`` as the first segment
(e.g., ``$step.skipped`` for status fns) are rejected at PARSE time
implicitly because the field-path is required after ``$nodeId``;
status fns themselves are blocked at the lexer.
"""

from __future__ import annotations

import math
from typing import Any

from .errors import PredicateEvalError, Skipped
from .grammar import (
    And,
    DotPath,
    Equals,
    Gt,
    Gte,
    Literal,
    Lt,
    Lte,
    NotEquals,
    NUMERIC_COMPARISONS,
    Or,
)


def _resolve_dotpath(path: DotPath, output_graph: dict[str, Any]) -> Any:
    """Walk ``$nodeId.f1.f2...`` against ``output_graph``.

    Missing intermediate keys raise PredicateEvalError so the public
    ``evaluate`` can convert to False. Lists/scalars in the middle of
    a path are treated as missing — predicates address structured
    output, not arbitrary container traversal.
    """

    if path.node_id not in output_graph:
        raise PredicateEvalError(
            f"node id {path.node_id!r} has no recorded output"
        )
    cursor: Any = output_graph[path.node_id]
    if not path.field_path or path.field_path[0] != "output":
        raise PredicateEvalError(
            f"dot-path must start with 'output': "
            f"${path.node_id}.{'.'.join(path.field_path)}"
        )
    for seg in path.field_path:
        if not isinstance(cursor, dict) or seg not in cursor:
            raise PredicateEvalError(
                f"field {seg!r} missing on path "
                f"${path.node_id}.{'.'.join(path.field_path)}"
            )
        cursor = cursor[seg]
    return cursor


def _resolve_operand(node: Any, output_graph: dict[str, Any]) -> Any:
    if isinstance(node, Literal):
        return node.value
    if isinstance(node, DotPath):
        return _resolve_dotpath(node, output_graph)
    raise PredicateEvalError(
        f"operand of unexpected AST node type: {type(node).__name__}"
    )


def _is_finite_number(value: Any) -> bool:
    """True iff value is int/float (excluding bool) AND finite.

    bool is a subclass of int in Python — explicitly exclude it so
    `true < 2` does NOT silently coerce True to 1 and pass.
    """

    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    if isinstance(value, float):
        return math.isfinite(value)
    return False


def _eval_operand_fail_closed(node: Any, output_graph: dict[str, Any]) -> bool:
    """Evaluate one And/Or operand, converting a PredicateEvalError raised
    ANYWHERE inside it to False for that operand only.

    pr20-fable-review T1: without this, `evaluate()`'s top-level try/except
    is the ONLY place a PredicateEvalError is caught — so an error raised
    while evaluating one operand of an `Or` (e.g. a missing/empty mid-chain
    round in the rec-1 last-successful-round OR-chain,
    `$r1.output.x == true || $r2.output.x == true || $r3.output.x == true`,
    where round 2 optional-failed with `outputs={}`) aborts evaluation of
    the ENTIRE expression before later `Or` terms (round 3's genuinely
    converged signal) are ever reached, poisoning the whole gate to False.
    Fail-closed-to-False is the correct direction for a single missing
    field, but it must be scoped to the operand that actually failed, not
    propagate past sibling `||` branches that may still resolve True.
    """
    try:
        return _eval_node(node, output_graph)
    except PredicateEvalError:
        return False


def _eval_node(node: Any, output_graph: dict[str, Any]) -> bool:
    """Evaluate a boolean-valued AST node.

    Short-circuits ``&&`` / ``||`` left-to-right per language conventions.
    """

    if isinstance(node, And):
        left_val = _eval_operand_fail_closed(node.left, output_graph)
        if not left_val:
            return False
        return _eval_operand_fail_closed(node.right, output_graph)
    if isinstance(node, Or):
        left_val = _eval_operand_fail_closed(node.left, output_graph)
        if left_val:
            return True
        return _eval_operand_fail_closed(node.right, output_graph)

    if isinstance(node, (Equals, NotEquals)):
        left = _resolve_operand(node.left, output_graph)
        right = _resolve_operand(node.right, output_graph)
        # Strict equality: type mismatch (bool vs int included) is False.
        # Python's `True == 1` would otherwise sneak through.
        if type(left) is not type(right):
            equal = False
        else:
            equal = left == right
        return equal if isinstance(node, Equals) else not equal

    if isinstance(node, NUMERIC_COMPARISONS):
        left = _resolve_operand(node.left, output_graph)
        right = _resolve_operand(node.right, output_graph)
        if not _is_finite_number(left) or not _is_finite_number(right):
            raise PredicateEvalError(
                "numeric comparison requires finite numeric operands on both sides"
            )
        if isinstance(node, Lt):
            return left < right
        if isinstance(node, Lte):
            return left <= right
        if isinstance(node, Gt):
            return left > right
        if isinstance(node, Gte):
            return left >= right

    if isinstance(node, Literal):
        # A bare literal is a degenerate predicate; only `true` evaluates true.
        if node.kind == "bool":
            return bool(node.value)
        raise PredicateEvalError(
            "non-boolean literal at the top of an expression is not a boolean predicate"
        )

    if isinstance(node, DotPath):
        # A bare dot-path predicate evaluates to the truthiness of the
        # resolved value, but we restrict to bool to avoid surprising
        # truthiness semantics on numbers/strings.
        value = _resolve_dotpath(node, output_graph)
        if not isinstance(value, bool):
            raise PredicateEvalError(
                "bare dot-path predicate must resolve to a boolean"
            )
        return value

    raise PredicateEvalError(
        f"cannot evaluate AST node of type {type(node).__name__}"
    )


def evaluate(ast: Any, output_graph: dict[str, Any]) -> bool:
    """Evaluate a parsed predicate against an output graph.

    Fail-closed: any internal exception (missing field, type mismatch,
    Skipped sentinel) produces False rather than propagating. The
    caller (walker) emits a ``predicate_evaluated`` warning event when
    it observes a Skipped or fail-closed False so the divergence is
    visible in run telemetry.
    """

    if isinstance(ast, Skipped):
        return False
    try:
        return bool(_eval_node(ast, output_graph))
    except PredicateEvalError:
        return False
