"""hde-9a — consumer-side executor flag + graduation registry gating.

Covers the four-corner truth table for `executor_enabled_for(workflow_name)`:

    flag missing                                          → orchestrator (False)
    flag present, executor_default: off                   → orchestrator (False)
    flag present, executor_default: on, NOT in registry   → orchestrator (False)
    flag present, executor_default: on, IN registry       → executor   (True)

Plus the wrapper invocation path: when both gates pass, `run_workflow`
hands off to the Walker via the public surface with run_state_path +
worktree_manager wired through.

Tests construct fake repo roots in tmp directories so the consumer-side
config layer is exercised without touching the real `.pHive/`. The
shipped baseline (`hive/hive.config.yaml`) is asserted untouched in
`test_shipped_config_unpolluted.py`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from hive.lib.dag_executor import (
    CONSUMER_CONFIG_PATH,
    EXECUTOR_HIVE_DAG,
    GRADUATED_REGISTRY_PATH,
    executor_enabled_for,
    is_workflow_graduated,
    load_executor_config,
    run_workflow,
)


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
# load_executor_config — file readers
# ---------------------------------------------------------------------------


def test_consumer_config_missing_returns_default_off(tmp_path: Path) -> None:
    cfg = load_executor_config(tmp_path)
    assert cfg == {"executor": None, "executor_default": False, "_present": False}


def test_consumer_config_off_returns_false(tmp_path: Path) -> None:
    _write_consumer_config(
        tmp_path,
        "executor: hive-dag\nexecutor_default: off\n",
    )
    cfg = load_executor_config(tmp_path)
    assert cfg["_present"] is True
    assert cfg["executor"] == EXECUTOR_HIVE_DAG
    # PyYAML 1.1 maps unquoted `off` to bool False; the reader normalises.
    assert cfg["executor_default"] is False


def test_consumer_config_on_returns_true(tmp_path: Path) -> None:
    _write_consumer_config(
        tmp_path,
        "executor: hive-dag\nexecutor_default: on\n",
    )
    cfg = load_executor_config(tmp_path)
    assert cfg["executor_default"] is True


def test_consumer_config_quoted_string_normalised(tmp_path: Path) -> None:
    _write_consumer_config(
        tmp_path,
        'executor: hive-dag\nexecutor_default: "on"\n',
    )
    assert load_executor_config(tmp_path)["executor_default"] is True


def test_consumer_config_malformed_fails_closed(tmp_path: Path) -> None:
    _write_consumer_config(tmp_path, ":\n  not: : : valid")
    cfg = load_executor_config(tmp_path)
    # Malformed file → default-off shape; no crash.
    assert cfg["executor_default"] is False
    assert cfg["executor"] is None


# ---------------------------------------------------------------------------
# is_workflow_graduated — registry reader
# ---------------------------------------------------------------------------


def test_registry_missing_returns_false(tmp_path: Path) -> None:
    assert is_workflow_graduated("code-review", tmp_path) is False


def test_registry_present_workflow_listed(tmp_path: Path) -> None:
    _write_registry(tmp_path, ["code-review", "test-swarm"])
    assert is_workflow_graduated("code-review", tmp_path) is True
    assert is_workflow_graduated("test-swarm", tmp_path) is True


def test_registry_present_workflow_absent(tmp_path: Path) -> None:
    _write_registry(tmp_path, ["code-review"])
    assert is_workflow_graduated("meta-team-cycle", tmp_path) is False


def test_registry_malformed_returns_false(tmp_path: Path) -> None:
    target = tmp_path / GRADUATED_REGISTRY_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("not-a-mapping\njust-a-scalar\n", encoding="utf-8")
    assert is_workflow_graduated("code-review", tmp_path) is False


# ---------------------------------------------------------------------------
# executor_enabled_for — combined truth table (the AC contract)
# ---------------------------------------------------------------------------


def test_flag_missing_orchestrator_path(tmp_path: Path) -> None:
    """AC: file missing → orchestrator path (default OFF)."""
    assert executor_enabled_for("code-review", tmp_path) is False


def test_flag_off_orchestrator_path(tmp_path: Path) -> None:
    """AC: executor_default: off → orchestrator path."""
    _write_consumer_config(
        tmp_path,
        "executor: hive-dag\nexecutor_default: off\n",
    )
    _write_registry(tmp_path, ["code-review"])
    assert executor_enabled_for("code-review", tmp_path) is False


def test_flag_on_workflow_not_in_registry(tmp_path: Path) -> None:
    """AC: flag on but workflow NOT in registry → orchestrator path."""
    _write_consumer_config(
        tmp_path,
        "executor: hive-dag\nexecutor_default: on\n",
    )
    _write_registry(tmp_path, ["code-review"])
    assert executor_enabled_for("meta-team-cycle", tmp_path) is False


def test_flag_on_registry_missing(tmp_path: Path) -> None:
    """AC: flag on but registry file missing → orchestrator path (registry empty)."""
    _write_consumer_config(
        tmp_path,
        "executor: hive-dag\nexecutor_default: on\n",
    )
    assert executor_enabled_for("code-review", tmp_path) is False


def test_flag_on_workflow_in_registry_executor_path(tmp_path: Path) -> None:
    """AC: flag on AND workflow IN registry → executor path."""
    _write_consumer_config(
        tmp_path,
        "executor: hive-dag\nexecutor_default: on\n",
    )
    _write_registry(tmp_path, ["code-review"])
    assert executor_enabled_for("code-review", tmp_path) is True


def test_flag_unknown_executor_value_fails_closed(tmp_path: Path) -> None:
    """AC: executor: <not hive-dag> fails closed to orchestrator path."""
    _write_consumer_config(
        tmp_path,
        "executor: some-future-runtime\nexecutor_default: on\n",
    )
    _write_registry(tmp_path, ["code-review"])
    assert executor_enabled_for("code-review", tmp_path) is False


# ---------------------------------------------------------------------------
# run_workflow — the executor invocation surface (called only when gates pass)
# ---------------------------------------------------------------------------


def test_run_workflow_invokes_walker_with_l3_surface(tmp_path: Path) -> None:
    """When both gates pass, /execute calls `run_workflow(...)`. Verify the
    wrapper hands run_state_path + worktree_manager to Walker.walk(...) and
    returns the materialised output graph."""

    from hive.lib.dag_executor.executor import (
        AgentHandler,
        Dispatcher,
        StubAgentSpawn,
        Telemetry,
    )
    from hive.lib.dag_executor.executor.run_id import make_run_id
    from hive.lib.dag_executor.graph import NodeType

    repo_root = Path(__file__).resolve().parents[2]
    workflow_path = repo_root / "hive" / "workflows" / "code-review.workflow.yaml"

    canned = {
        "analyze": {"scope_analysis": "scope: 0 files, 0 modules"},
        "review": {"review_verdict": "passed", "review_findings": "no issues"},
        "summarize": {"review_summary": "verdict=passed"},
    }
    spy = StubAgentSpawn(canned_outputs=canned)
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)

    run_id = make_run_id("code-review")
    telemetry = Telemetry(run_id=run_id)
    runs_root = tmp_path / "runs"

    materialised = run_workflow(
        workflow_path,
        dispatcher,
        run_id=run_id,
        telemetry=telemetry,
        run_state_path=runs_root,
        worktree_manager=None,  # caller-decided per hde-6 nesting policy
        context={"diff_content": "<<diff>>"},
    )

    # Materialised graph keyed by step id — matches spine parity expectations.
    assert set(materialised.keys()) == {"analyze", "review", "summarize"}
    # run-state was persisted under the runs root (`<root>/<run_id>/run_state.yaml`).
    persisted_state = runs_root / run_id / "run_state.yaml"
    assert persisted_state.is_file()
    # Telemetry events stamped with the run_id (executor invariant).
    assert telemetry.events
    for event in telemetry.events:
        assert event["run_id"] == run_id


def test_run_workflow_requires_explicit_dispatcher() -> None:
    """`run_workflow` does not synthesise a default dispatcher because the
    real AgentHandler requires an injected `spawn`. Callers (skill or test)
    own dispatcher assembly. Documented contract."""

    repo_root = Path(__file__).resolve().parents[2]
    workflow_path = repo_root / "hive" / "workflows" / "code-review.workflow.yaml"
    with pytest.raises(TypeError):
        run_workflow(workflow_path)  # type: ignore[call-arg]


# ---------------------------------------------------------------------------
# Cross-shape sanity: a typical /execute call site flow
# ---------------------------------------------------------------------------


def test_skill_dispatch_pattern_orchestrator_default(tmp_path: Path) -> None:
    """Mirrors the prose decision tree in skills/execute/SKILL.md step 5pre.

    No consumer config + no registry → orchestrator path. The skill's
    behaviour for non-opt-in consumers is unchanged from pre-hde-9a.
    """

    chosen_path: list[str] = []

    def dispatch(workflow_name: str, repo_root: Path) -> None:
        if executor_enabled_for(workflow_name, repo_root):
            chosen_path.append("executor")
        else:
            chosen_path.append("orchestrator")

    dispatch("code-review", tmp_path)
    dispatch("meta-team-cycle", tmp_path)
    assert chosen_path == ["orchestrator", "orchestrator"]


def test_skill_dispatch_pattern_per_workflow_gating(tmp_path: Path) -> None:
    """Flag on, registry lists `code-review` only. Executor path takes
    `code-review`; everything else falls to orchestrator."""

    _write_consumer_config(
        tmp_path,
        "executor: hive-dag\nexecutor_default: on\n",
    )
    _write_registry(tmp_path, ["code-review"])

    def dispatch(workflow_name: str) -> str:
        return "executor" if executor_enabled_for(workflow_name, tmp_path) else "orchestrator"

    assert dispatch("code-review") == "executor"
    assert dispatch("test-swarm") == "orchestrator"
    assert dispatch("meta-team-cycle") == "orchestrator"
