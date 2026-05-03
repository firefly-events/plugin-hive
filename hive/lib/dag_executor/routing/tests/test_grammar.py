"""Grammar-layer tests — every operator parses; disallowed constructs reject.

Two angles per the story spec:
  * Acceptance: each of the 8 operators + literal types + dot-path
    forms produce the expected AST node.
  * Rejection: parens, ``=~``, ``success()`` / ``failure()``,
    arithmetic ``+ - * /``, and any function call are refused at
    parse time and surface as Skipped (fail-closed).
"""

from __future__ import annotations

import pytest

from hive.lib.dag_executor.routing import (
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
    Skipped,
    parse,
)


# --- positive: every operator parses ------------------------------------


@pytest.mark.parametrize(
    "expr,cls",
    [
        ("$a.output.x == true", Equals),
        ("$a.output.x != false", NotEquals),
        ("$a.output.x < 10", Lt),
        ("$a.output.x <= 10", Lte),
        ("$a.output.x > 10", Gt),
        ("$a.output.x >= 10", Gte),
        ("$a.output.x == true && $b.output.y == true", And),
        ("$a.output.x == true || $b.output.y == true", Or),
    ],
)
def test_each_operator_parses_to_expected_root(expr: str, cls):
    ast = parse(expr)
    assert isinstance(ast, cls)


def test_literal_kinds_parse():
    ast = parse("$a.output.x == true")
    assert isinstance(ast.right, Literal)
    assert ast.right.kind == "bool"
    assert ast.right.value is True

    ast = parse("$a.output.x == false")
    assert isinstance(ast.right, Literal) and ast.right.kind == "bool"
    assert ast.right.value is False

    ast = parse("$a.output.x == null")
    assert isinstance(ast.right, Literal) and ast.right.kind == "null"
    assert ast.right.value is None

    ast = parse("$a.output.x == 42")
    assert isinstance(ast.right, Literal) and ast.right.kind == "int"
    assert ast.right.value == 42

    ast = parse("$a.output.x == 3.14")
    assert isinstance(ast.right, Literal) and ast.right.kind == "float"
    assert ast.right.value == 3.14


def test_dotpath_parses_with_segments():
    ast = parse("$step.output.metrics.signal == true")
    assert isinstance(ast.left, DotPath)
    assert ast.left.node_id == "step"
    assert ast.left.field_path == ("output", "metrics", "signal")


def test_dotpath_with_hyphen_in_node_id():
    # Hive node ids are kebab-case in workflow YAMLs; the lexer must accept that.
    ast = parse("$design-review.output.verdict == true")
    assert isinstance(ast.left, DotPath)
    assert ast.left.node_id == "design-review"


# --- negative: disallowed constructs are rejected (Skipped) -------------


@pytest.mark.parametrize(
    "expr",
    [
        "($a.output.x == true)",
        "$a.output.x == true && ($b.output.y == false)",
        "$a.output.name =~ pattern",
        "success()",
        "failure()",
        "success() && $a.output.x == true",
        "$a.output.x + 1 == 2",
        "$a.output.x - 1 == 2",
        "$a.output.x * 2 == 4",
        "$a.output.x / 2 == 1",
        "len($a.output.list) == 0",
    ],
)
def test_disallowed_constructs_return_skipped(expr: str):
    result = parse(expr)
    assert isinstance(result, Skipped), (
        f"expected Skipped for disallowed construct {expr!r}, got {result!r}"
    )


def test_dotpath_without_field_segment_is_skipped():
    # `$a` alone is not a valid atom — the field path is required.
    assert isinstance(parse("$a == true"), Skipped)


def test_bareword_identifier_is_skipped():
    # `bar == true` (no `$`) is a bareword reference, not an atom.
    assert isinstance(parse("bar == true"), Skipped)


def test_empty_predicate_is_skipped():
    assert isinstance(parse(""), Skipped)
    assert isinstance(parse("   "), Skipped)


def test_non_string_input_is_skipped():
    assert isinstance(parse(None), Skipped)  # type: ignore[arg-type]
    assert isinstance(parse(42), Skipped)  # type: ignore[arg-type]
