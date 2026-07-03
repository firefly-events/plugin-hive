"""c-generalize-loop C2: additive reference-passing layer.

Proves the additive lean-flow layer that sits ALONGSIDE the typed
point-to-point ``InputBinding`` contract:

  * a node writes an output to a filesystem pointer and a downstream
    ``source: reference`` binding reads it lazily (round-trip);
  * a missing pointer at resolution time raises a CLEAR error naming the
    pointer — never a silent None;
  * no Open-Prose SDK dependency (the module imports stdlib only);
  * existing typed bindings (literal / context / step_output) continue
    to resolve unchanged (backward-compatible).
"""

from __future__ import annotations

import ast as _ast
from pathlib import Path

import pytest

from hive.lib.dag_executor.executor.handlers import NodeOutput
from hive.lib.dag_executor.executor.reference import (
    MissingReferenceError,
    read_reference,
    write_reference,
)
from hive.lib.dag_executor.executor.walker import _resolve_one
from hive.lib.dag_executor.graph import InputBinding


# ---------------------------------------------------------------------------
# Round-trip: write a pointer, resolve it via a reference binding
# ---------------------------------------------------------------------------

def test_reference_round_trip(tmp_path) -> None:
    write_reference(tmp_path, "refs/review.md", "verdict: passed\nfindings: none\n")

    binding = InputBinding(
        name="review",
        source="reference",
        reference_pointer="refs/review.md",
    )
    resolved = _resolve_one(
        binding,
        materialised={},
        context={"run_working_dir": str(tmp_path)},
        skipped=set(),
    )
    assert resolved == "verdict: passed\nfindings: none\n"


def test_reference_round_trip_via_direct_helpers(tmp_path) -> None:
    path = write_reference(tmp_path, "nested/dir/out.txt", "hello reference")
    assert Path(path).is_file()
    assert read_reference(tmp_path, "nested/dir/out.txt") == "hello reference"


# ---------------------------------------------------------------------------
# Missing pointer → clear error naming the pointer (not silent None)
# ---------------------------------------------------------------------------

def test_missing_pointer_raises_clear_error(tmp_path) -> None:
    binding = InputBinding(
        name="review",
        source="reference",
        reference_pointer="refs/does-not-exist.md",
    )
    with pytest.raises(MissingReferenceError) as exc:
        _resolve_one(
            binding,
            materialised={},
            context={"run_working_dir": str(tmp_path)},
            skipped=set(),
        )
    # Error must name the missing pointer, not resolve to None.
    assert "refs/does-not-exist.md" in str(exc.value)
    assert exc.value.pointer == "refs/does-not-exist.md"


def test_missing_pointer_is_not_silent_none(tmp_path) -> None:
    with pytest.raises(MissingReferenceError):
        read_reference(tmp_path, "absent.txt")


# ---------------------------------------------------------------------------
# No Open-Prose SDK dependency (concept only, no import)
# ---------------------------------------------------------------------------

def test_reference_module_has_no_sdk_import() -> None:
    src = Path(
        "hive/lib/dag_executor/executor/reference.py"
    ).read_text(encoding="utf-8")
    tree = _ast.parse(src)
    imported: list[str] = []
    for node in _ast.walk(tree):
        if isinstance(node, _ast.Import):
            imported.extend(alias.name for alias in node.names)
        elif isinstance(node, _ast.ImportFrom):
            imported.append(node.module or "")
    lowered = " ".join(imported).lower()
    assert "prose" not in lowered, f"reference layer must not import an Open-Prose SDK: {imported}"
    # Positive control: stdlib + local sibling module only (the ImportFrom
    # for `from .errors import ...` surfaces as the bare module name "errors").
    allowed = {"__future__", "pathlib", "typing", "errors"}
    assert all(mod in allowed for mod in imported), imported


# ---------------------------------------------------------------------------
# Backward-compat: existing typed bindings resolve unchanged
# ---------------------------------------------------------------------------

def test_literal_binding_unchanged() -> None:
    binding = InputBinding(name="x", source="literal", value=42)
    assert _resolve_one(binding, {}, {}, set()) == 42


def test_context_binding_unchanged() -> None:
    binding = InputBinding(name="x", source="context", context_key="story_spec")
    assert _resolve_one(binding, {}, {"story_spec": "SPEC"}, set()) == "SPEC"


def test_step_output_binding_unchanged() -> None:
    binding = InputBinding(
        name="impl",
        source="step_output",
        step_id="implement",
        output_name="implementation",
    )
    materialised = {"implement": NodeOutput(outputs={"implementation": "code"})}
    assert _resolve_one(binding, materialised, {}, set()) == "code"


def test_step_output_missing_optional_still_none() -> None:
    binding = InputBinding(
        name="impl",
        source="step_output",
        step_id="implement",
        output_name="implementation",
        optional=True,
    )
    # Missing upstream + optional → None (unchanged legacy behaviour).
    assert _resolve_one(binding, {}, {}, set()) is None


def test_reference_binding_round_trips_through_to_dict() -> None:
    binding = InputBinding(
        name="review",
        source="reference",
        reference_pointer="refs/out.md",
    )
    d = binding.to_dict()
    assert d["source"] == "reference"
    assert d["reference_pointer"] == "refs/out.md"
    # A non-reference binding must NOT carry the key (additive omission).
    plain = InputBinding(name="x", source="context", context_key="k")
    assert "reference_pointer" not in plain.to_dict()
