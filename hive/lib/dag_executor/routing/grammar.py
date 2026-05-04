"""AST dataclasses for the strict-Archon predicate grammar.

Grammar lock (user-gate Q5 = strict_archon):

  * Operators: ``==, !=, >, >=, <, <=, &&, ||``
  * Literals: ``true``, ``false``, ``null``, integers, floats
  * Field access: ``$nodeId.output.field`` (dot-path)
  * Precedence: ``&&`` binds tighter than ``||``; no parentheses
  * REJECTED: parens, regex (``=~``), status fns (``success()`` / ``failure()``),
    arithmetic (``+ - * /``), function calls of any kind

Cultural lock: grammar additions require an epic, not a story
(Argo two-grammar migration debt is the cautionary tale). New
operators MUST go through epic-level review even if they look "tiny".
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Literal:
    """A boolean, numeric, or null literal.

    `kind` records which subtype the lexer recognised so the evaluator
    can enforce numeric-only ops without re-inferring from `value`.
    """

    value: Any
    kind: str  # "bool" | "int" | "float" | "null"


@dataclass(frozen=True)
class DotPath:
    """A `$nodeId.output.field` reference.

    `node_id` is the bareword between the leading `$` and the first
    `.`. `field_path` is the remaining tuple of segments — typically
    `("output", "<name>")`, but the grammar permits arbitrary depth so
    nested output structures (e.g., `$step.output.metrics.signal`) round-trip.
    """

    node_id: str
    field_path: tuple[str, ...]


@dataclass(frozen=True)
class Equals:
    left: Any
    right: Any


@dataclass(frozen=True)
class NotEquals:
    left: Any
    right: Any


@dataclass(frozen=True)
class Lt:
    left: Any
    right: Any


@dataclass(frozen=True)
class Lte:
    left: Any
    right: Any


@dataclass(frozen=True)
class Gt:
    left: Any
    right: Any


@dataclass(frozen=True)
class Gte:
    left: Any
    right: Any


@dataclass(frozen=True)
class And:
    left: Any
    right: Any


@dataclass(frozen=True)
class Or:
    left: Any
    right: Any


# Public AST union — typed via `Any` field annotations above to keep
# stdlib-only and avoid forward-reference gymnastics. Consumers that
# care should match on the dataclass type via isinstance.
ASTNode = (
    Literal
    | DotPath
    | Equals
    | NotEquals
    | Lt
    | Lte
    | Gt
    | Gte
    | And
    | Or
)


COMPARISON_NODES = (Equals, NotEquals, Lt, Lte, Gt, Gte)
NUMERIC_COMPARISONS = (Lt, Lte, Gt, Gte)
