"""Typed errors and the Skipped sentinel for the routing layer.

Routing is fail-closed: invalid predicate text or missing fields at
evaluation time MUST NOT raise to the caller. Internal helpers raise
typed exceptions; the public `parse` / `evaluate` entry points convert
those into a `Skipped` sentinel (parse) or a `False` return value
(evaluate) and emit a `predicate_evaluated` warning event so the
divergence is observable without halting the run.
"""

from __future__ import annotations


class RoutingError(Exception):
    """Base for every routing-layer failure."""


class PredicateParseError(RoutingError):
    """Predicate text could not be parsed under the strict-Archon grammar."""


class PredicateEvalError(RoutingError):
    """Predicate evaluation hit a runtime fault (missing field, type error)."""


class TriggerRuleViolationError(RoutingError):
    """trigger_rule policy could not be satisfied by upstream statuses."""


class Skipped:
    """Sentinel returned by `parse` when the predicate is invalid.

    `parse` is fail-closed: rather than raise on malformed input, it
    returns a `Skipped` instance and the caller treats the predicate
    as False. Equality is identity-based (one canonical reason per
    instance) so callers can distinguish parse failures from genuine
    AST nodes via `isinstance(result, Skipped)`.
    """

    __slots__ = ("reason",)

    def __init__(self, reason: str) -> None:
        self.reason = reason

    def __repr__(self) -> str:
        return f"Skipped(reason={self.reason!r})"
