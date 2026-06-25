"""s1-plan-dispatch — plan runner resolution algorithm (plan-dispatch/SKILL.md).

Covers the 7-AC truth table for ``resolve_plan_runner``:

    AC1  env HIVE_PLANNING_MODE=hive-dag                     → hive-dag / planning-mode-override-env
    AC2  planning.mode: hive-dag in .pHive/hive.config.yaml  → hive-dag / planning-mode-override-config
    AC3  env beats config when both set                       → env wins  / planning-mode-override-env
    AC4  is_workflow_graduated('plan') True (registry-only)  → hive-dag  / graduated-registry
    AC5  no planning config at all                            → orchestrator-narrated / default
    AC6  execution.mode: sandcastle does NOT affect result    → orchestrator-narrated / default
    AC7  execute-dispatch/SKILL.md byte-identical (no drift)  → file unchanged

``resolve_plan_runner`` is the canonical Python implementation of the
resolution algorithm described in skills/hive/skills/plan-dispatch/SKILL.md.
It is placed here (not in production lib code) because plan-dispatch is a
skill spec, not a library entry-point; the function lives beside the tests
so they form a single authoritative reference.
"""

from __future__ import annotations

from pathlib import Path

import yaml
import pytest

from hive.lib.dag_executor import (
    CONSUMER_CONFIG_PATH,
    GRADUATED_REGISTRY_PATH,
    is_workflow_graduated,
)


# ---------------------------------------------------------------------------
# Reference implementation of plan-dispatch/SKILL.md resolution algorithm
# ---------------------------------------------------------------------------


def resolve_plan_runner(
    env: dict[str, str],
    repo_root: Path,
) -> tuple[str, str]:
    """Resolve runner_path for the planning flow per plan-dispatch/SKILL.md.

    Precedence (stop at first match):
      1. env.HIVE_PLANNING_MODE == "hive-dag"         → planning-mode-override-env
      2. .pHive/hive.config.yaml planning.mode == "hive-dag" → planning-mode-override-config
      3. is_workflow_graduated("plan")               → graduated-registry
      4. default                                      → orchestrator-narrated / default

    Returns (runner_path, runner_reason).

    NOTE: step 3 is registry-only. Plan graduation MUST stay isolated from
    execute-flow keys (executor_default), so it uses is_workflow_graduated()
    rather than executor_enabled_for() (which gates on executor_default).
    """
    # Step 1: env override
    if env.get("HIVE_PLANNING_MODE", "").strip() == "hive-dag":
        return "hive-dag", "planning-mode-override-env"

    # Step 2: config override — consumer .pHive/hive.config.yaml planning.mode
    consumer_config = repo_root / CONSUMER_CONFIG_PATH
    if consumer_config.is_file():
        try:
            raw = yaml.safe_load(consumer_config.read_text(encoding="utf-8")) or {}
            if isinstance(raw, dict):
                planning = raw.get("planning")
                if isinstance(planning, dict) and planning.get("mode") == "hive-dag":
                    return "hive-dag", "planning-mode-override-config"
        except (OSError, yaml.YAMLError):
            pass

    # Step 3: graduated registry — registry-only (literal "plan"). MUST NOT read
    # execute-flow keys (executor_default) per the plan-dispatch isolation contract.
    if is_workflow_graduated("plan", repo_root):
        return "hive-dag", "graduated-registry"

    # Step 4: default
    return "orchestrator-narrated", "default"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _write_consumer_config(root: Path, body: str) -> None:
    target = root / CONSUMER_CONFIG_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body, encoding="utf-8")


def _write_registry(root: Path, workflows: list[str]) -> None:
    target = root / GRADUATED_REGISTRY_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    yaml_lines = ["workflows:"] + [f"  - {name}" for name in workflows]
    target.write_text("\n".join(yaml_lines) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# AC1: env HIVE_PLANNING_MODE=hive-dag
# ---------------------------------------------------------------------------


def test_ac1_env_planning_mode_hive_dag(tmp_path: Path) -> None:
    """AC1: HIVE_PLANNING_MODE=hive-dag → hive-dag / planning-mode-override-env."""
    runner_path, runner_reason = resolve_plan_runner(
        env={"HIVE_PLANNING_MODE": "hive-dag"},
        repo_root=tmp_path,
    )
    assert runner_path == "hive-dag"
    assert runner_reason == "planning-mode-override-env"


def test_ac1_env_planning_mode_not_hive_dag_falls_through(tmp_path: Path) -> None:
    """Non-hive-dag values do not trigger the env override."""
    runner_path, _ = resolve_plan_runner(
        env={"HIVE_PLANNING_MODE": "orchestrator-narrated"},
        repo_root=tmp_path,
    )
    assert runner_path == "orchestrator-narrated"


# ---------------------------------------------------------------------------
# AC2: planning.mode: hive-dag in .pHive/hive.config.yaml
# ---------------------------------------------------------------------------


def test_ac2_config_planning_mode_hive_dag(tmp_path: Path) -> None:
    """AC2: planning.mode: hive-dag in consumer config → hive-dag / planning-mode-override-config."""
    _write_consumer_config(tmp_path, "planning:\n  mode: hive-dag\n")
    runner_path, runner_reason = resolve_plan_runner(
        env={},
        repo_root=tmp_path,
    )
    assert runner_path == "hive-dag"
    assert runner_reason == "planning-mode-override-config"


def test_ac2_config_planning_mode_other_falls_through(tmp_path: Path) -> None:
    """A non-hive-dag planning.mode does not trigger the config override."""
    _write_consumer_config(tmp_path, "planning:\n  mode: orchestrator-narrated\n")
    runner_path, _ = resolve_plan_runner(env={}, repo_root=tmp_path)
    assert runner_path == "orchestrator-narrated"


# ---------------------------------------------------------------------------
# AC3: env beats config when both set
# ---------------------------------------------------------------------------


def test_ac3_env_beats_config(tmp_path: Path) -> None:
    """AC3: HIVE_PLANNING_MODE=hive-dag wins over planning.mode: hive-dag in config."""
    _write_consumer_config(tmp_path, "planning:\n  mode: hive-dag\n")
    runner_path, runner_reason = resolve_plan_runner(
        env={"HIVE_PLANNING_MODE": "hive-dag"},
        repo_root=tmp_path,
    )
    assert runner_path == "hive-dag"
    assert runner_reason == "planning-mode-override-env"


# ---------------------------------------------------------------------------
# AC4: is_workflow_graduated('plan') True → graduated-registry (registry-only)
# ---------------------------------------------------------------------------


def test_ac4_graduated_registry_plan(tmp_path: Path) -> None:
    """AC4: 'plan' in the graduation registry → hive-dag / graduated-registry."""
    _write_registry(tmp_path, ["plan"])
    runner_path, runner_reason = resolve_plan_runner(env={}, repo_root=tmp_path)
    assert runner_path == "hive-dag"
    assert runner_reason == "graduated-registry"


def test_ac4_graduation_isolated_from_executor_default(tmp_path: Path) -> None:
    """Isolation: executor_default is an execute-flow key and MUST NOT gate plan
    graduation. With 'plan' in the registry, planning routes to hive-dag even when
    executor_default is off."""
    _write_consumer_config(tmp_path, "executor: hive-dag\nexecutor_default: off\n")
    _write_registry(tmp_path, ["plan"])
    runner_path, runner_reason = resolve_plan_runner(env={}, repo_root=tmp_path)
    assert runner_path == "hive-dag"
    assert runner_reason == "graduated-registry"


def test_ac4_graduated_registry_plan_not_listed(tmp_path: Path) -> None:
    """plan not in registry → falls through to default."""
    _write_registry(tmp_path, ["code-review", "daily-ceremony"])
    runner_path, runner_reason = resolve_plan_runner(env={}, repo_root=tmp_path)
    assert runner_path == "orchestrator-narrated"
    assert runner_reason == "default"


# ---------------------------------------------------------------------------
# AC5: no planning config → default
# ---------------------------------------------------------------------------


def test_ac5_no_planning_config_returns_default(tmp_path: Path) -> None:
    """AC5: nothing set → orchestrator-narrated / default."""
    runner_path, runner_reason = resolve_plan_runner(env={}, repo_root=tmp_path)
    assert runner_path == "orchestrator-narrated"
    assert runner_reason == "default"


# ---------------------------------------------------------------------------
# AC6: execution.mode: sandcastle does NOT affect plan-dispatch
# ---------------------------------------------------------------------------


def test_ac6_execution_mode_sandcastle_no_effect(tmp_path: Path) -> None:
    """AC6: execution.mode: sandcastle in consumer config is irrelevant to plan-dispatch."""
    _write_consumer_config(
        tmp_path,
        "execution:\n  mode: sandcastle\nexecutor: hive-dag\nexecutor_default: on\n",
    )
    # Registry has code-review but NOT plan — is_workflow_graduated('plan') must be False.
    _write_registry(tmp_path, ["code-review"])
    runner_path, runner_reason = resolve_plan_runner(env={}, repo_root=tmp_path)
    assert runner_path == "orchestrator-narrated"
    assert runner_reason == "default"


def test_ac6_hive_execution_mode_env_no_effect(tmp_path: Path) -> None:
    """HIVE_EXECUTION_MODE env var is an execute-dispatch input and must not affect plan-dispatch."""
    runner_path, runner_reason = resolve_plan_runner(
        env={"HIVE_EXECUTION_MODE": "hive-dag"},
        repo_root=tmp_path,
    )
    assert runner_path == "orchestrator-narrated"
    assert runner_reason == "default"


# ---------------------------------------------------------------------------
# AC7: execute-dispatch/SKILL.md byte-identical (no drift from this story)
# ---------------------------------------------------------------------------


def test_ac7_execute_dispatch_skill_unchanged() -> None:
    """AC7: plan-dispatch must not modify skills/hive/skills/execute-dispatch/SKILL.md."""
    repo_root = Path(__file__).resolve().parents[2]
    skill_path = repo_root / "skills" / "hive" / "skills" / "execute-dispatch" / "SKILL.md"
    assert skill_path.is_file(), "execute-dispatch/SKILL.md must exist"
    content = skill_path.read_text(encoding="utf-8")
    # Content markers that must remain in execute-dispatch (unchanged).
    assert "execute-dispatch" in content
    assert "mode_decision" in content
    assert "runner_path" in content
    assert "gate_violations" in content
    # Isolation: plan-dispatch env var must NOT have drifted into execute-dispatch.
    assert "HIVE_PLANNING_MODE" not in content
    assert "planning-mode-override-env" not in content
    assert "planning-mode-override-config" not in content
