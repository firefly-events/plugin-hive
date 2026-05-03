"""Predicate-routing subpackage for the Hive DAG executor (hde-3a).

Public surface:

  * ``parse(expr) -> ASTNode | Skipped``
  * ``evaluate(ast, output_graph) -> bool``
  * ``none_failed_min_one_success(upstream_statuses) -> ActivationDecision``
  * AST classes (``Equals``, ``NotEquals``, ``Lt``, ``Lte``, ``Gt``,
    ``Gte``, ``And``, ``Or``, ``DotPath``, ``Literal``)
  * Error types (``RoutingError``, ``PredicateParseError``,
    ``PredicateEvalError``, ``TriggerRuleViolationError``)
  * ``Skipped`` sentinel
  * ``ActivationDecision`` enum

Design locks (do NOT relax at the story level):

  * Strict-Archon grammar (user-gate Q5). No parens, regex, status
    fns, arithmetic, or function calls.
  * trigger_rule = ``none_failed_min_one_success`` ONLY (user-gate Q3).
  * Fail-closed: invalid predicate text and missing fields produce
    False, never raise to the caller.
  * Cultural lock: grammar additions require an epic, not a story.
    See ``hive/references/predicate-grammar.md``.
"""

from __future__ import annotations

from .errors import (
    PredicateEvalError,
    PredicateParseError,
    RoutingError,
    Skipped,
    TriggerRuleViolationError,
)
from .evaluator import evaluate
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
    Or,
)
from .parallel import (
    ParallelScheduler,
    ScheduleResult,
    decide_join_activation,
    disambiguate_insight_slug,
)
from .parser import parse
from .trigger_rule import ActivationDecision, none_failed_min_one_success

__all__ = [
    "ActivationDecision",
    "And",
    "DotPath",
    "Equals",
    "Gt",
    "Gte",
    "Literal",
    "Lt",
    "Lte",
    "NotEquals",
    "Or",
    "ParallelScheduler",
    "PredicateEvalError",
    "PredicateParseError",
    "RoutingError",
    "ScheduleResult",
    "Skipped",
    "TriggerRuleViolationError",
    "decide_join_activation",
    "disambiguate_insight_slug",
    "evaluate",
    "none_failed_min_one_success",
    "parse",
]
