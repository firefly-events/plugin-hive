"""#26: the classic workflow's gate-review node must BLOCK integrate when the
review verdict is needs_revision. Live execute showed integrate running despite
needs_revision (gate-review skipped) — reproduce + lock the enforcement here.
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

CLASSIC = (
    Path(__file__).resolve().parents[4]
    / "workflows"
    / "development.classic.workflow.yaml"
)


class _Canned:
    def __init__(self, canned: dict[str, dict[str, Any]]):
        self.canned = canned
        self.calls: list[str] = []

    def __call__(self, agent, step_file_content, inputs, run_id, step_id):
        self.calls.append(step_id)
        return dict(self.canned.get(step_id, {}))


def _run(verdict: str) -> tuple[list[str], BaseException | None]:
    graph = load_workflow(CLASSIC)
    spawn = _Canned(
        {
            "preflight": {
                "preflight_status": "READY",
                "needs_backend": True,
                "needs_frontend": False,
            },
            "backend-implement": {"implementation": "function makeMove(){}"},
            "test": {
                "test_results": "28 passing",
                "test_artifacts": ["game.test.js"],
            },
            "review": {"review_verdict": verdict, "review_findings": "..."},
            "codex-review": {"review_verdict": verdict},
            "integrate": {"commit_ref": "deadbeef"},
        }
    )
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spawn).handle)
    dispatcher.register(NodeType.GATE, GateHandler().handle)
    dispatcher.register(NodeType.RECONCILE, ReconcileHandler().handle)
    run_id = make_run_id("classic-gate-review")
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


def test_gate_review_blocks_integrate_on_needs_revision():
    calls, err = _run("needs_revision")
    assert isinstance(err, GateFailedError), (
        f"gate-review must BLOCK on needs_revision; got err={err!r}, calls={calls}"
    )
    assert "integrate" not in calls, "integrate must NOT run when review needs_revision"


def test_gate_review_allows_integrate_on_passed():
    calls, err = _run("passed")
    assert err is None, f"passed verdict must not block; got {err!r}"
    assert "integrate" in calls, "integrate must run when review passed"
