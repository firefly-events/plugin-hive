"""Parser-layer tests — fail-closed, AST round-trip, precedence locks.

Precedence: ``&&`` binds tighter than ``||``, so ``a && b || c`` MUST
parse as ``(a && b) || c``. Locked here so future grammar refactors
can't silently flip associativity.
"""

from __future__ import annotations

from hive.lib.dag_executor.routing import (
    And,
    DotPath,
    Equals,
    Literal,
    Or,
    Skipped,
    parse,
)


def test_and_binds_tighter_than_or():
    """``a && b || c`` → ``Or(And(a, b), c)``."""

    ast = parse(
        "$a.output.x == true && $b.output.y == true || $c.output.z == true"
    )
    assert isinstance(ast, Or)
    assert isinstance(ast.left, And)
    assert isinstance(ast.right, Equals)
    # Right-side `c` is the standalone clause, NOT a sub-And.
    assert isinstance(ast.right.left, DotPath)
    assert ast.right.left.node_id == "c"


def test_or_left_associativity():
    """``a || b || c`` → ``Or(Or(a, b), c)``."""

    ast = parse(
        "$a.output.x == true || $b.output.y == true || $c.output.z == true"
    )
    assert isinstance(ast, Or)
    assert isinstance(ast.left, Or)
    assert isinstance(ast.right, Equals)
    assert ast.right.left.node_id == "c"


def test_and_left_associativity():
    """``a && b && c`` → ``And(And(a, b), c)``."""

    ast = parse(
        "$a.output.x == true && $b.output.y == true && $c.output.z == true"
    )
    assert isinstance(ast, And)
    assert isinstance(ast.left, And)
    assert isinstance(ast.right, Equals)
    assert ast.right.left.node_id == "c"


def test_comparison_round_trip_dotpath_vs_literal():
    ast = parse("$step.output.field == true")
    assert isinstance(ast, Equals)
    assert isinstance(ast.left, DotPath)
    assert ast.left.field_path == ("output", "field")
    assert isinstance(ast.right, Literal)
    assert ast.right.value is True


def test_dotpath_against_dotpath():
    """Both sides may be dot-paths."""

    ast = parse("$a.output.x == $b.output.y")
    assert isinstance(ast, Equals)
    assert isinstance(ast.left, DotPath)
    assert isinstance(ast.right, DotPath)
    assert ast.left.node_id == "a" and ast.right.node_id == "b"


def test_negative_integer_literal_round_trip():
    ast = parse("$a.output.x == -5")
    assert isinstance(ast, Equals)
    assert ast.right.value == -5
    assert ast.right.kind == "int"


def test_trailing_garbage_is_skipped():
    """Trailing tokens after a complete expression are fail-closed."""

    assert isinstance(parse("$a.output.x == true && && $b.output.y == false"), Skipped)
    assert isinstance(parse("$a.output.x == true junk"), Skipped)


def test_unterminated_comparison_is_skipped():
    assert isinstance(parse("$a.output.x =="), Skipped)
    assert isinstance(parse("== $a.output.x"), Skipped)


def test_double_logical_op_is_skipped():
    assert isinstance(parse("$a.output.x == true && && $b.output.y == false"), Skipped)


def test_lone_logical_op_is_skipped():
    assert isinstance(parse("&&"), Skipped)
    assert isinstance(parse("||"), Skipped)


def test_dotpath_segment_must_follow_dot():
    """``$a.`` is malformed — segment is required after every ``.``."""

    assert isinstance(parse("$a."), Skipped)
    assert isinstance(parse("$a.output."), Skipped)
