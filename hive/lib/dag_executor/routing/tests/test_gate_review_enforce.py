"""#26: the gate-review node must BLOCK integrate when the review verdict is
needs_revision. Live execute showed integrate running despite needs_revision
(gate-review skipped) — reproduce + lock the enforcement here.

Parametrized over classic, tdd, and bdd so a future fourth methodology is
one list entry away.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from hive.lib.dag_executor.executor import AgentHandler, Dispatcher
from hive.lib.dag_executor.executor.errors import GateFailedError
from hive.lib.dag_executor.executor.handlers.gate import GateHandler
from hive.lib.dag_executor.executor.handlers.reconcile import ReconcileHandler
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker
from hive.lib.dag_executor.executor.run_id import make_run_id
from hive.lib.dag_executor.graph import NodeType, load_workflow

_WORKFLOWS = Path(__file__).resolve().parents[4] / "workflows"

CLASSIC = _WORKFLOWS / "development.classic.workflow.yaml"
TDD = _WORKFLOWS / "development.tdd.workflow.yaml"
BDD = _WORKFLOWS / "development.bdd.workflow.yaml"

METHODOLOGIES = [
    pytest.param(CLASSIC, id="classic"),
    pytest.param(TDD, id="tdd"),
    pytest.param(BDD, id="bdd"),
]


class _Canned:
    def __init__(self, canned: dict[str, dict[str, Any]]):
        self.canned = canned
        self.calls: list[str] = []

    def __call__(self, agent, step_file_content, inputs, run_id, step_id):
        self.calls.append(step_id)
        return dict(self.canned.get(step_id, {}))


def _run(workflow_path: Path, verdict: str) -> tuple[list[str], BaseException | None]:
    graph = load_workflow(workflow_path)
    spawn = _Canned(
        {
            # classic nodes
            "preflight": {
                "preflight_status": "READY",
                "needs_backend": True,
                "needs_frontend": False,
            },
            "backend-implement": {"implementation": "function makeMove(){}"},
            "codex-review": {"review_verdict": verdict},
            # tdd nodes
            "research": {"research_findings": "findings"},
            "write-brief": {"research_brief": "brief"},
            "test-spec": {"test_files": "tests", "test_manifest": "manifest"},
            "implement": {"implementation": "function makeMove(){}"},
            # bdd nodes
            "behavior-spec": {"behavior_specs": "specs"},
            # shared (classic uses "test" too)
            "test": {
                "test_results": "28 passing",
                "test_artifacts": ["game.test.js"],
            },
            "review": {"review_verdict": verdict, "review_findings": "..."},
            "integrate": {"commit_ref": "deadbeef"},
        }
    )
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spawn).handle)
    dispatcher.register(NodeType.GATE, GateHandler().handle)
    dispatcher.register(NodeType.RECONCILE, ReconcileHandler().handle)
    run_id = make_run_id("gate-review")
    tel = Telemetry(run_id=run_id)
    err: BaseException | None = None
    try:
        Walker().walk(
            graph, dispatcher, run_id, tel,
            context={"story_spec": "<<spec>>"},
        )
    except BaseException as exc:  # noqa: BLE001 — capture for assertion
        err = exc
    return spawn.calls, err


@pytest.mark.parametrize("workflow_path", METHODOLOGIES)
def test_gate_review_blocks_integrate_on_needs_revision(workflow_path):
    calls, err = _run(workflow_path, "needs_revision")
    assert isinstance(err, GateFailedError), (
        f"gate-review must BLOCK on needs_revision; got err={err!r}, calls={calls}"
    )
    assert "integrate" not in calls, "integrate must NOT run when review needs_revision"


@pytest.mark.parametrize("workflow_path", METHODOLOGIES)
def test_gate_review_allows_integrate_on_passed(workflow_path):
    calls, err = _run(workflow_path, "passed")
    assert err is None, f"passed verdict must not block; got {err!r}"
    assert "integrate" in calls, "integrate must run when review passed"


@pytest.mark.parametrize("workflow_path", METHODOLOGIES)
def test_gate_review_has_max_attempts_1(workflow_path):
    """gate-review bounded-retry: max_attempts must be exactly 1 in all three graphs."""
    graph = load_workflow(workflow_path)
    node = graph.nodes.get("gate-review")
    assert node is not None, (
        f"gate-review node must exist in {workflow_path.name}"
    )
    assert node.retry is not None, "gate-review must have retry config"
    assert node.retry.get("max_attempts") == 1, (
        f"gate-review max_attempts must be 1; got {node.retry.get('max_attempts')!r}"
    )
