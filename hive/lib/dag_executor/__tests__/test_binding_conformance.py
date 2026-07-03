"""Conformance test: all four skill hive-dag branches must call resolve_spawn_binding.

Asserts source text in each SKILL.md's DAG front-door code block rather than
testing runtime behaviour. Catches the specific regression (hardcoded binding=
literal) that story p-configurable-binding fixes.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parents[4]

# (skill_path, flow_arg) pairs — the hive-dag branch in each skill
SKILL_CONFIGS = [
    ("skills/plan/SKILL.md", "planning"),
    ("skills/execute/SKILL.md", "execution"),
    ("skills/test/SKILL.md", "execution"),
    ("skills/review/SKILL.md", "execution"),
]

# Literals that must NOT appear in the hive-dag code blocks
FORBIDDEN_LITERALS = [
    'binding="local"',
    "binding='local'",
    'binding="multica"',
    "binding='multica'",
]


def _extract_dag_code_block(text: str) -> str:
    """Return the first Python code block that contains a dag_executor/run call."""
    # Match fenced python blocks
    pattern = re.compile(r"```python\n(.*?)```", re.DOTALL)
    for match in pattern.finditer(text):
        block = match.group(1)
        if "dag_executor.run" in block or ("from hive.lib.dag_executor.run import" in block and "run(" in block):
            return block
    return ""


@pytest.mark.parametrize("skill_rel, expected_flow", SKILL_CONFIGS)
def test_skill_hive_dag_branch_uses_resolver(skill_rel: str, expected_flow: str) -> None:
    skill_path = REPO_ROOT / skill_rel
    assert skill_path.exists(), f"Skill file missing: {skill_path}"
    text = skill_path.read_text(encoding="utf-8")

    dag_block = _extract_dag_code_block(text)
    assert dag_block, f"No DAG front-door code block found in {skill_rel}"

    # Must call resolve_spawn_binding
    assert "resolve_spawn_binding" in dag_block, (
        f"{skill_rel}: hive-dag code block does not call resolve_spawn_binding. "
        "Expected to find `resolve_spawn_binding(flow=...)` replacing the hardcoded binding= literal."
    )

    # Must use correct flow argument
    assert f'flow="{expected_flow}"' in dag_block or f"flow='{expected_flow}'" in dag_block, (
        f"{skill_rel}: resolve_spawn_binding call does not use flow=\"{expected_flow}\". "
        f"Found block:\n{dag_block}"
    )

    # Must NOT contain hardcoded binding literals
    for literal in FORBIDDEN_LITERALS:
        assert literal not in dag_block, (
            f"{skill_rel}: hive-dag code block still contains hardcoded {literal!r}. "
            "This defeats config-driven substrate selection."
        )


# ---------------------------------------------------------------------------
# Runtime precedence tests (Codex review: the source-text checks above prove
# the skills *call* the resolver, but not that the resolver *honours* the
# config knobs the story promises). These exercise resolve_spawn_binding end
# to end across every precedence tier and both flows.
# ---------------------------------------------------------------------------

from hive.lib.dag_executor.run import (  # noqa: E402
    _BINDING_FACTORIES,
    register_binding,
    resolve_spawn_binding,
)

_SENTINEL = object()


@pytest.fixture
def dummy_binding():
    """Register a no-op binding so a resolved name can instantiate without the
    Node bridge; assert on the returned name. Cleaned up after each test."""
    name = "testbind"
    register_binding(name, lambda *a, **k: _SENTINEL)
    try:
        yield name
    finally:
        _BINDING_FACTORIES.pop(name, None)


def _write_config(root: Path, flow: str, mode: str) -> None:
    cfg = root / ".pHive" / "hive.config.yaml"
    cfg.parent.mkdir(parents=True, exist_ok=True)
    cfg.write_text(f"{flow}:\n  mode: {mode}\n", encoding="utf-8")


def test_explicit_arg_beats_env_and_config(dummy_binding, tmp_path):
    _write_config(tmp_path, "execution", "local")
    name, spawn = resolve_spawn_binding(
        dummy_binding,
        env={"HIVE_EXECUTION_MODE": "local", "HIVE_EXECUTION_MODE_X": "x"},
        repo_root=tmp_path,
        flow="execution",
    )
    assert name == dummy_binding and spawn is _SENTINEL


def test_per_flow_env_beats_global_env(dummy_binding, tmp_path):
    # HIVE_{FLOW}_MODE must win over HIVE_EXECUTION_MODE.
    name, _ = resolve_spawn_binding(
        None,
        env={"HIVE_PLANNING_MODE": dummy_binding, "HIVE_EXECUTION_MODE": "local"},
        repo_root=tmp_path,
        flow="planning",
    )
    assert name == dummy_binding


def test_global_env_beats_config(dummy_binding, tmp_path):
    _write_config(tmp_path, "execution", "local")
    name, _ = resolve_spawn_binding(
        None,
        env={"HIVE_EXECUTION_MODE": dummy_binding},
        repo_root=tmp_path,
        flow="execution",
    )
    assert name == dummy_binding


def test_config_knob_used_when_env_unset(dummy_binding, tmp_path):
    _write_config(tmp_path, "execution", dummy_binding)
    name, _ = resolve_spawn_binding(
        None, env={}, repo_root=tmp_path, flow="execution"
    )
    assert name == dummy_binding


def test_config_knob_is_per_flow(dummy_binding, tmp_path):
    # Config sets planning.mode only; an execution-flow resolve must NOT pick it
    # up, and must fall through to the default.
    _write_config(tmp_path, "planning", dummy_binding)
    name_plan, _ = resolve_spawn_binding(
        None, env={}, repo_root=tmp_path, flow="planning"
    )
    name_exec, _ = resolve_spawn_binding(
        None, env={}, repo_root=tmp_path, flow="execution"
    )
    assert name_plan == dummy_binding
    assert name_exec == "local"


def test_defaults_to_local_when_unset(tmp_path):
    name, _ = resolve_spawn_binding(
        None, env={}, repo_root=tmp_path, flow="execution"
    )
    assert name == "local"
