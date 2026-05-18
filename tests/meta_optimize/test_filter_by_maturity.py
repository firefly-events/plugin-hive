"""Tests for the maturity-aware metric-recommendation gate.

Covers story `mhg-1-brownfield-maturity-metrics`: the four acceptance-criteria
paths reduced to the programmatic surface in `metric_registry.filter_by_maturity()`.
The kickoff prompt + skill-level guidance message are exercised by hand
(per the story's `test` step) since there is no automated kickoff suite.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REGISTRY_PATH = ROOT / "skills/hive/skills/meta-optimize/metric_registry.py"


def _load_registry_module():
    module_name = "tests.meta_optimize._metric_registry_filter_by_maturity"
    spec = importlib.util.spec_from_file_location(module_name, REGISTRY_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load metric_registry.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def test_mature_returns_full_set_unchanged() -> None:
    registry = _load_registry_module()
    full = {"tokens": 1, "wall_clock_ms": 2, "first_attempt_pass": 3}

    result = registry.filter_by_maturity(full, "mature")

    assert result["recommended"] == full
    assert result["guidance"] is None
    assert result["maturity"] == "mature"


def test_established_returns_full_set_unchanged() -> None:
    registry = _load_registry_module()
    full = {"tokens": 1, "fix_loop_iterations": 2}

    result = registry.filter_by_maturity(full, "established")

    assert result["recommended"] == full
    assert result["guidance"] is None


def test_greenfield_replaces_with_guidance_and_empty_set() -> None:
    registry = _load_registry_module()
    full = {"tokens": 1, "wall_clock_ms": 2}

    result = registry.filter_by_maturity(full, "greenfield")

    assert result["recommended"] == {}
    assert result["guidance"] is not None
    assert "greenfield" in result["guidance"]
    assert "gather signal first" in result["guidance"].lower()


def test_early_replaces_with_guidance_and_empty_set() -> None:
    registry = _load_registry_module()
    full = {"tokens": 1}

    result = registry.filter_by_maturity(full, "early")

    assert result["recommended"] == {}
    assert result["guidance"] is not None
    assert "early" in result["guidance"]


def test_unknown_value_signals_reprompt_with_none_guidance() -> None:
    """Unknown/missing maturity must NOT silently filter the set.

    Callers (the skill, downstream tooling) inspect ``guidance is None`` AND
    ``maturity not in MATURITY_LEVELS`` to decide they need to re-prompt
    the user. Withholding the metric set on unknown would surprise existing
    callers; instead we pass through with a signal.
    """
    registry = _load_registry_module()
    full = {"tokens": 1}

    for bad in (None, "", "not_detected", "intermediate", 42):
        result = registry.filter_by_maturity(full, bad)  # type: ignore[arg-type]
        assert result["recommended"] == full, f"failed for {bad!r}"
        assert result["guidance"] is None, f"failed for {bad!r}"
        assert not registry.is_known_maturity(bad), f"failed for {bad!r}"


def test_iterable_input_is_normalized_to_dict() -> None:
    """Callers may pass an iterable of metric names instead of a dict."""
    registry = _load_registry_module()

    result = registry.filter_by_maturity(["tokens", "wall_clock_ms"], "mature")

    assert result["recommended"] == {"tokens": True, "wall_clock_ms": True}


def test_maturity_levels_constant_is_locked_to_four_values() -> None:
    """The four-level enum is part of the public contract — guard against drift."""
    registry = _load_registry_module()

    assert registry.MATURITY_LEVELS == frozenset(
        {"greenfield", "early", "established", "mature"}
    )


def test_is_known_maturity_accepts_only_four_values() -> None:
    registry = _load_registry_module()

    for ok in ("greenfield", "early", "established", "mature"):
        assert registry.is_known_maturity(ok)

    for bad in ("Greenfield", "MATURE", "stable", "production", None, ""):
        assert not registry.is_known_maturity(bad)  # type: ignore[arg-type]
