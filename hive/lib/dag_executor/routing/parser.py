"""Recursive-descent parser for the strict-Archon predicate grammar.

Public entry point: ``parse(expr) -> ASTNode | Skipped``.

The parser is fail-closed at the *parse* layer: malformed input does
NOT raise to callers — it returns a ``Skipped`` sentinel carrying the
reason. The walker treats ``Skipped`` as a False predicate and emits a
``predicate_evaluated`` telemetry event so the divergence is visible
without halting the run.

Grammar (informal, see ``hive/references/predicate-grammar.md`` for
the formal EBNF):

    expr        := or_expr
    or_expr     := and_expr ( '||' and_expr )*
    and_expr    := comparison ( '&&' comparison )*
    comparison  := atom ( ('==' | '!=' | '<' | '<=' | '>' | '>=') atom )?
    atom        := literal | dotpath
    literal     := 'true' | 'false' | 'null' | INT | FLOAT
    dotpath     := '$' IDENT ( '.' IDENT )+

Precedence is enforced by the recursive-descent layering: ``||`` is
the loosest, ``&&`` binds tighter, comparisons are the tightest.
There are no parentheses — adding them is an epic-level grammar
change, not a story-level patch.

Disallowed constructs (rejected with PredicateParseError → Skipped):
    parentheses, ``=~`` regex, ``success()`` / ``failure()`` calls,
    arithmetic ``+ - * /``, ANY function call syntax.
"""

from __future__ import annotations

import re
from typing import Any

from .errors import PredicateParseError, Skipped
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


# --- lexer ---------------------------------------------------------------

# Order matters: longer operators must come before their prefixes
# (``==`` before ``=``-led tokens, ``<=`` before ``<``, etc.). The
# regex anchors at start of the unconsumed slice and the lexer
# discards leading whitespace on each step.
_TOKEN_SPECS: list[tuple[str, re.Pattern[str]]] = [
    ("OP_AND", re.compile(r"&&")),
    ("OP_OR", re.compile(r"\|\|")),
    ("OP_EQ", re.compile(r"==")),
    ("OP_NEQ", re.compile(r"!=")),
    ("OP_LTE", re.compile(r"<=")),
    ("OP_GTE", re.compile(r">=")),
    ("OP_LT", re.compile(r"<")),
    ("OP_GT", re.compile(r">")),
    ("DOLLAR", re.compile(r"\$")),
    ("DOT", re.compile(r"\.")),
    ("FLOAT", re.compile(r"-?\d+\.\d+")),
    ("INT", re.compile(r"-?\d+")),
    ("IDENT", re.compile(r"[A-Za-z_][A-Za-z0-9_-]*")),
]

_WHITESPACE = re.compile(r"\s+")


# Sentinel patterns we recognise specifically so the error message
# names what we rejected. Anything else falls into "unexpected character".
_DISALLOWED_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\("), "parentheses are not part of the strict-Archon grammar"),
    (re.compile(r"\)"), "parentheses are not part of the strict-Archon grammar"),
    (re.compile(r"=~"), "regex match operator is not allowed"),
    (re.compile(r"\+"), "arithmetic operators are not allowed"),
    (re.compile(r"\*"), "arithmetic operators are not allowed"),
    (re.compile(r"/"), "arithmetic operators are not allowed"),
]


def _lex(expr: str) -> list[tuple[str, str]]:
    """Tokenise ``expr`` into a list of (kind, text) tuples.

    Raises PredicateParseError on a disallowed construct or any
    character we cannot classify. Whitespace is consumed silently.
    """

    tokens: list[tuple[str, str]] = []
    i = 0
    n = len(expr)
    while i < n:
        ws = _WHITESPACE.match(expr, i)
        if ws is not None:
            i = ws.end()
            continue
        if i >= n:
            break

        # Reject disallowed constructs FIRST so the error message is
        # specific instead of "unexpected character at position 5".
        for pattern, message in _DISALLOWED_PATTERNS:
            if pattern.match(expr, i) is not None:
                raise PredicateParseError(
                    f"{message} (at column {i})"
                )

        matched = False
        for kind, pattern in _TOKEN_SPECS:
            match = pattern.match(expr, i)
            if match is None:
                continue
            text = match.group(0)
            if kind == "IDENT":
                # Reject function-call syntax: any IDENT followed
                # immediately by '(' is treated as a disallowed call,
                # not an identifier we accept. (We also reject '('
                # in the disallowed-patterns scan above, but checking
                # here gives a more informative message.)
                end = match.end()
                if end < n and expr[end] == "(":
                    raise PredicateParseError(
                        "function call syntax is not allowed "
                        f"(found {text!r}( at column {i})"
                    )
            tokens.append((kind, text))
            i = match.end()
            matched = True
            break

        if not matched:
            raise PredicateParseError(
                f"unexpected character {expr[i]!r} at column {i}"
            )

    return tokens


# --- parser --------------------------------------------------------------


class _Parser:
    """Hand-rolled recursive-descent parser.

    Per-method invariant: each ``_parse_*`` consumes exactly the tokens
    that belong to its production and leaves ``self.pos`` pointing at
    the next unread token. Callers do NOT need to peek; the methods
    handle the look-ahead internally.
    """

    def __init__(self, tokens: list[tuple[str, str]]) -> None:
        self.tokens = tokens
        self.pos = 0

    def _peek(self) -> tuple[str, str] | None:
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def _advance(self) -> tuple[str, str]:
        token = self.tokens[self.pos]
        self.pos += 1
        return token

    def parse(self) -> Any:
        ast = self._parse_or()
        if self.pos != len(self.tokens):
            remaining = self.tokens[self.pos]
            raise PredicateParseError(
                f"trailing tokens after expression: {remaining!r}"
            )
        return ast

    def _parse_or(self) -> Any:
        node = self._parse_and()
        while True:
            tok = self._peek()
            if tok is None or tok[0] != "OP_OR":
                return node
            self._advance()
            right = self._parse_and()
            node = Or(left=node, right=right)

    def _parse_and(self) -> Any:
        node = self._parse_comparison()
        while True:
            tok = self._peek()
            if tok is None or tok[0] != "OP_AND":
                return node
            self._advance()
            right = self._parse_comparison()
            node = And(left=node, right=right)

    def _parse_comparison(self) -> Any:
        left = self._parse_atom()
        tok = self._peek()
        if tok is None:
            return left
        op_kind = tok[0]
        if op_kind not in {
            "OP_EQ",
            "OP_NEQ",
            "OP_LT",
            "OP_LTE",
            "OP_GT",
            "OP_GTE",
        }:
            return left
        self._advance()
        right = self._parse_atom()
        cls = {
            "OP_EQ": Equals,
            "OP_NEQ": NotEquals,
            "OP_LT": Lt,
            "OP_LTE": Lte,
            "OP_GT": Gt,
            "OP_GTE": Gte,
        }[op_kind]
        return cls(left=left, right=right)

    def _parse_atom(self) -> Any:
        tok = self._peek()
        if tok is None:
            raise PredicateParseError("unexpected end of expression")
        kind, text = tok
        if kind == "DOLLAR":
            return self._parse_dotpath()
        if kind == "IDENT" and text == "true":
            self._advance()
            return Literal(value=True, kind="bool")
        if kind == "IDENT" and text == "false":
            self._advance()
            return Literal(value=False, kind="bool")
        if kind == "IDENT" and text == "null":
            self._advance()
            return Literal(value=None, kind="null")
        if kind == "IDENT":
            raise PredicateParseError(
                f"bareword identifier {text!r} is not a valid atom — "
                "use $nodeId.output.field for field references"
            )
        if kind == "INT":
            self._advance()
            return Literal(value=int(text), kind="int")
        if kind == "FLOAT":
            self._advance()
            return Literal(value=float(text), kind="float")
        raise PredicateParseError(
            f"unexpected token {text!r} (kind={kind}) at atom position"
        )

    def _parse_dotpath(self) -> DotPath:
        # Consume '$'.
        self._advance()
        head = self._peek()
        if head is None or head[0] != "IDENT":
            raise PredicateParseError(
                "expected node identifier after '$'"
            )
        node_id = self._advance()[1]
        segments: list[str] = []
        while True:
            tok = self._peek()
            if tok is None or tok[0] != "DOT":
                break
            self._advance()
            seg = self._peek()
            if seg is None or seg[0] != "IDENT":
                raise PredicateParseError(
                    "expected identifier after '.' in dot-path"
                )
            segments.append(self._advance()[1])
        if not segments:
            raise PredicateParseError(
                f"dot-path ${node_id} must have at least one field segment "
                "(e.g. $step.output.field)"
            )
        return DotPath(node_id=node_id, field_path=tuple(segments))


def parse(expr: str) -> Any:
    """Parse a predicate string into an AST or a Skipped sentinel.

    Fail-closed: any malformed input returns ``Skipped(reason=...)``
    instead of raising. The caller is expected to treat ``Skipped``
    as a False predicate and emit a telemetry warning event.
    """

    if not isinstance(expr, str):
        return Skipped(reason=f"predicate must be str, got {type(expr).__name__}")
    if not expr.strip():
        return Skipped(reason="empty predicate")
    try:
        tokens = _lex(expr)
        if not tokens:
            return Skipped(reason="empty predicate after tokenisation")
        ast = _Parser(tokens).parse()
    except PredicateParseError as exc:
        return Skipped(reason=str(exc))
    return ast
