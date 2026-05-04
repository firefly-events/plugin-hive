"""Order 9 (hde-10) — daily-ceremony plan-approval pause migration.

The prose plan-approval gate (formerly `planning-approve-plan`, an
orchestrator-driven step that paused mid-skill until the user typed
"yes"/"approve"/"go") graduates to a declarative ``node_type: pause``
node (`plan-approval`) under the executor. Operator approval is a
sentinel file at:

  ``<runs_root>/<run_id>/pause/plan-approval.{approve,reject}``

The sentinel body must contain the signed token from the
`pause_suspended` telemetry event (the pause module's anti-forgery
guard from hde-8).

These tests cover the synthetic operator path:
  * ``.approve`` sentinel + valid token → walker resumes, full cycle
    completes, NodeOutput records `paused: True, approved: True`.
  * ``.reject`` sentinel + valid token → handler raises
    `PauseRejectedError`, walker fails the run cleanly.
  * Workflow shape: `execution-kick-off` depends on `plan-approval` —
    the pause sits squarely between planning and execution, exactly
    where the prose gate did.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.handlers import (
    AgentHandler,
    PauseHandler,
    StubAgentSpawn,
)
from hive.lib.dag_executor.executor.run_id import make_run_id
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker
from hive.lib.dag_executor.graph import NodeType, load_workflow


REPO_ROOT = Path(__file__).resolve().parents[2]
DAILY_CEREMONY = REPO_ROOT / "hive" / "workflows" / "daily-ceremony.workflow.yaml"


def _build_dispatcher(
    canned: dict[str, dict[str, Any]],
    runs_root: Path,
    telemetry: Telemetry,
) -> Dispatcher:
    spy = StubAgentSpawn(canned_outputs=canned)
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)
    dispatcher.register(
        NodeType.PAUSE,
        PauseHandler(
            runs_root=runs_root,
            telemetry=telemetry,
            poll_interval=0.05,
        ).handle,
    )
    return dispatcher


def _all_nodes_canned(graph) -> dict[str, dict[str, Any]]:
    canned: dict[str, dict[str, Any]] = {}
    for step_id, node in graph.nodes.items():
        canned[step_id] = {
            o.name: f"<<{step_id}.{o.name}>>" for o in node.outputs
        }
    return canned


def _wait_until(predicate, timeout=2.0, poll=0.02):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(poll)
    return predicate()


def _wait_for_pause_token(tel: Telemetry, step_id: str, timeout: float = 5.0) -> str:
    """Block until ``pause_suspended`` for ``step_id`` lands and return its
    token. Asserts on timeout so a stuck operator thread surfaces as a
    test failure rather than a silent hang on Walker().walk()."""

    ready = _wait_until(
        lambda: any(
            e["event_type"] == "pause_suspended" and e["step_id"] == step_id
            for e in tel.events
        ),
        timeout=timeout,
    )
    assert ready, f"timed out waiting for pause_suspended event for {step_id!r}"
    for e in tel.events:
        if e["event_type"] == "pause_suspended" and e["step_id"] == step_id:
            token = e.get("payload", {}).get("token")
            assert token, (
                f"pause_suspended payload missing token for {step_id!r}: {e}"
            )
            return token
    raise AssertionError(
        f"pause_suspended event vanished between wait and read for {step_id!r}"
    )


def test_plan_approval_pause_node_replaces_prose_gate():
    """Structural assertion: the workflow ships a ``node_type: pause``
    node at the planning→execution boundary. The prose
    `planning-approve-plan` agent step is gone; ``execution-kick-off``
    depends on the new pause node."""

    graph = load_workflow(DAILY_CEREMONY)
    assert "plan-approval" in graph.nodes, (
        "expected pause node `plan-approval`; was the prose gate removed?"
    )
    assert "planning-approve-plan" not in graph.nodes, (
        "old prose gate `planning-approve-plan` should be replaced by `plan-approval`"
    )
    assert graph.nodes["plan-approval"].node_type == NodeType.PAUSE
    assert "plan-approval" in graph.nodes["execution-kick-off"].depends_on


def test_plan_approval_resumes_when_approve_sentinel_written(tmp_path: Path):
    """Synthetic operator workflow: writer thread waits for the pause
    suspension telemetry, reads the signed token, writes
    ``plan-approval.approve`` with the token; walker resumes and the
    full cycle completes."""

    graph = load_workflow(DAILY_CEREMONY)
    run_id = make_run_id("daily-ceremony")
    runs_root = tmp_path / "runs"
    tel = Telemetry(run_id=run_id)
    dispatcher = _build_dispatcher(_all_nodes_canned(graph), runs_root, tel)

    def operator():
        # Wait for the pause_suspended event to land in telemetry, then
        # write the approve sentinel with the signed token from it.
        token = _wait_for_pause_token(tel, "plan-approval")
        sentinel_dir = runs_root / run_id / "pause"
        sentinel_dir.mkdir(parents=True, exist_ok=True)
        (sentinel_dir / "plan-approval.approve").write_text(token, encoding="utf-8")

    op_thread = threading.Thread(target=operator, daemon=False)
    op_thread.start()

    materialised = Walker().walk(graph, dispatcher, run_id, tel)
    op_thread.join(timeout=5.0)
    assert not op_thread.is_alive(), "operator thread did not finish"

    assert "plan-approval" in materialised
    assert materialised["plan-approval"].outputs.get("paused") is True
    assert materialised["plan-approval"].outputs.get("approved") is True
    # Downstream execution ran (its `depends_on: plan-approval` was
    # satisfied by the resume).
    assert "execution-kick-off" in materialised
    # Telemetry recorded the resume event.
    resumed = [
        e for e in tel.events
        if e["event_type"] == "pause_resumed" and e["step_id"] == "plan-approval"
    ]
    assert resumed, "expected at least one pause_resumed event"


def test_plan_approval_fails_cleanly_when_reject_sentinel_written(tmp_path: Path):
    """The reject path: sentinel `.reject` is written; pause handler
    raises PauseRejectedError; walker maps that to a failed step.
    Downstream `execution-kick-off` does not run."""

    from hive.lib.dag_executor.pause.errors import PauseRejectedError

    graph = load_workflow(DAILY_CEREMONY)
    run_id = make_run_id("daily-ceremony")
    runs_root = tmp_path / "runs"
    tel = Telemetry(run_id=run_id)
    dispatcher = _build_dispatcher(_all_nodes_canned(graph), runs_root, tel)

    def operator():
        token = _wait_for_pause_token(tel, "plan-approval")
        sentinel_dir = runs_root / run_id / "pause"
        sentinel_dir.mkdir(parents=True, exist_ok=True)
        # Sentinel format: line 1 = token; blank line; reason.
        (sentinel_dir / "plan-approval.reject").write_text(
            f"{token}\n\nuser declined plan",
            encoding="utf-8",
        )

    op_thread = threading.Thread(target=operator, daemon=False)
    op_thread.start()

    # Walker tolerates the rejection: it raises PauseRejectedError into
    # the dispatcher, which marks the node failed; downstream skips.
    # The walker itself does NOT propagate — see hde-8 walker
    # integration. We assert the failure-path semantics via telemetry.
    try:
        Walker().walk(graph, dispatcher, run_id, tel)
    except PauseRejectedError:
        # Some walker integrations re-raise; both shapes are valid for
        # the rejection-clean-fail contract — what matters is that the
        # rejection telemetry landed and downstream did not run.
        pass
    op_thread.join(timeout=5.0)
    assert not op_thread.is_alive(), "operator thread did not finish"

    rejected = [
        e for e in tel.events
        if e["event_type"] == "pause_rejected" and e["step_id"] == "plan-approval"
    ]
    assert rejected, "expected pause_rejected telemetry on .reject sentinel"
    started_kickoff = [
        e for e in tel.events
        if e["event_type"] == "node_started" and e["step_id"] == "execution-kick-off"
    ]
    assert not started_kickoff, (
        "execution-kick-off must not start when plan-approval is rejected"
    )
