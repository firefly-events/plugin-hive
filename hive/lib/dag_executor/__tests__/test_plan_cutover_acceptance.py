"""Acceptance tests for the /plan hive-dag cutover."""

from __future__ import annotations

from pathlib import Path

import yaml

from hive.lib.dag_executor import (
    CONSUMER_CONFIG_PATH,
    GRADUATED_REGISTRY_PATH,
    is_workflow_graduated,
)


def _write_consumer_config(root: Path, body: str) -> None:
    target = root / CONSUMER_CONFIG_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body, encoding="utf-8")


def _write_registry(root: Path, workflows: list[str]) -> None:
    target = root / GRADUATED_REGISTRY_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        yaml.safe_dump({"workflows": workflows}, sort_keys=False),
        encoding="utf-8",
    )


def test_plan_graduated_when_registry_lists_plan(tmp_path: Path) -> None:
    """Plan graduation is registry-only: literal 'plan' in the graduation registry."""
    _write_registry(tmp_path, ["meta-team-cycle", "plan"])

    assert is_workflow_graduated("plan", tmp_path) is True


def test_plan_graduation_isolated_from_executor_default(tmp_path: Path) -> None:
    """executor_default is an execute-flow key and MUST NOT gate plan graduation.

    Per plan-dispatch/SKILL.md, planning runner resolution stays isolated from
    execute-flow config. 'plan' in the registry graduates even with
    executor_default off — that switch governs /execute, not /plan.
    """
    _write_consumer_config(tmp_path, "executor: hive-dag\nexecutor_default: false\n")
    _write_registry(tmp_path, ["plan"])

    assert is_workflow_graduated("plan", tmp_path) is True


def test_plan_not_graduated_when_registry_does_not_list_plan(tmp_path: Path) -> None:
    _write_registry(tmp_path, ["meta-team-cycle"])

    assert is_workflow_graduated("plan", tmp_path) is False


def test_default_narrated_plan_skill_path_remains_present() -> None:
    """The cutover branch still falls through to the narrated path by default."""

    repo_root = Path(__file__).resolve().parents[4]
    skill = (repo_root / "skills" / "plan" / "SKILL.md").read_text(encoding="utf-8")
    assert "runner_path == hive-dag" in skill
    assert "runner_path == orchestrator-narrated" in skill
    assert "Continue Phase A using the returned active planning team handles" in skill
