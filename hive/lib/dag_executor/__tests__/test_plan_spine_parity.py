"""Spine-parity coverage for plan.workflow.yaml with user_gate nodes."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from hive.lib.dag_executor.executor import StubAgentSpawn
from hive.lib.dag_executor.graph import NodeType, load_workflow, validate_graph
from hive.lib.dag_executor.pause import SignalKind, SignalResult
from hive.lib.dag_executor.run import run


PLAN_WORKFLOW = Path("hive/workflows/plan.workflow.yaml")


def test_plan_workflow_validates_with_user_gate_nodes() -> None:
    graph = load_workflow(PLAN_WORKFLOW)

    validate_graph(graph)

    user_gates = {
        node_id
        for node_id, node in graph.nodes.items()
        if node.node_type == NodeType.USER_GATE
    }
    assert user_gates == {"design-gate", "hv-gate", "so-gate"}
    assert graph.nodes["author"].depends_on == ["research", "design-gate"]
    assert set(graph.nodes["reconcile"].depends_on) == {"hv-gate", "so-gate"}


def test_plan_workflow_spine_runs_clean_under_executor() -> None:
    stub = StubAgentSpawn(
        canned_outputs={
            "research": {"research_brief": "research"},
            "design": {"design_discussion": "design"},
            "author": {
                "epic_dir": ".pHive/epics/plan-dag-cutover",
                "commit_sha": "",
                "branch": "",
                "repo": "",
                "work_dir": "",
            },
            "hv": {"confidence": 90, "first_run": False},
            "so": {
                "open_questions": [],
                "open_questions_count": 0,
                "first_run": False,
            },
        }
    )
    approved = SignalResult(
        kind=SignalKind.APPROVED,
        reason=None,
        sentinel_path=Path("/tmp/run/pause/design-gate.approve"),
    )

    with patch("hive.lib.dag_executor.executor.handlers.user_gate.wait_for_signal") as wait:
        wait.return_value = approved
        materialised = run(
            PLAN_WORKFLOW,
            spawn=stub,
            run_id="s5-plan-spine-parity",
            context={"requirement": "test plan cutover"},
        )

    assert set(materialised) == {
        "research",
        "design",
        "design-gate",
        "author",
        "hv",
        "hv-gate",
        "so",
        "so-gate",
        "reconcile",
        "output-validation",
    }
    completed = list(materialised)
    assert completed.index("research") < completed.index("author")
    assert completed.index("design") < completed.index("design-gate") < completed.index("author")
    assert completed.index("author") < completed.index("hv") < completed.index("hv-gate")
    assert completed.index("author") < completed.index("so") < completed.index("so-gate")
    assert completed.index("hv-gate") < completed.index("reconcile")
    assert completed.index("so-gate") < completed.index("reconcile")
    assert completed.index("reconcile") < completed.index("output-validation")
    assert materialised["hv-gate"].outputs["user_gate"] == "passed"
    assert materialised["so-gate"].outputs["user_gate"] == "passed"
    assert materialised["output-validation"].outputs["gate_passed"] is True
