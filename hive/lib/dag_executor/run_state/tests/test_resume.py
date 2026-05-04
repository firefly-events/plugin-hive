"""--resume <run-id>: failure injection + idempotent replay + parity.

Synthetic 3-node workflow built directly via Graph/Node so we don't
depend on a fixture YAML file. Handler outputs are deterministic and
keyed by node id (stub agent shape borrowed from hde-2 spine parity).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.handlers import NodeOutput
from hive.lib.dag_executor.executor.run_id import make_run_id
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker
from hive.lib.dag_executor.graph.model import Graph, Node, NodeType
from hive.lib.dag_executor.run_state import (
    AlreadyCompletedError,
    NodeStatus,
    ResumeFromInvalidStateError,
    RunStatus,
    load,
    mark_completed,
    mark_suspended,
    resume_run,
    save,
)


# ---------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------


def _build_graph() -> Graph:
    """3-node linear workflow: a → b → c."""

    nodes = {
        "a": Node(id="a", node_type=NodeType.AGENT, agent="developer"),
        "b": Node(id="b", node_type=NodeType.AGENT, agent="developer", depends_on=["a"]),
        "c": Node(id="c", node_type=NodeType.AGENT, agent="developer", depends_on=["b"]),
    }
    return Graph(workflow_name="resume-test", nodes=nodes)


class _StubHandler:
    """Returns a deterministic output keyed by node id."""

    def __init__(self):
        self.calls: list[str] = []

    def handle(self, node, inputs, run_id):
        self.calls.append(node.id)
        return NodeOutput(outputs={"id": node.id, "marker": f"out-{node.id}"})


class _FlakyHandler:
    """Raises on `target_node_id` first call; succeeds thereafter."""

    def __init__(self, target_node_id: str):
        self.target = target_node_id
        self.failed_once = False
        self.calls: list[str] = []

    def handle(self, node, inputs, run_id):
        self.calls.append(node.id)
        if node.id == self.target and not self.failed_once:
            self.failed_once = True
            raise RuntimeError(f"injected failure at {node.id}")
        return NodeOutput(outputs={"id": node.id, "marker": f"out-{node.id}"})


def _dispatcher_for(handler) -> Dispatcher:
    return Dispatcher(handlers={NodeType.AGENT: handler.handle})


@pytest.fixture
def runs_root(tmp_path: Path) -> Path:
    return tmp_path / "runs"


# ---------------------------------------------------------------------
# Persistence on the success path
# ---------------------------------------------------------------------


def test_walk_with_persistence_writes_run_state_yaml(runs_root: Path):
    graph = _build_graph()
    rid = make_run_id("resume-test")
    walker = Walker()
    handler = _StubHandler()
    walker.walk(
        graph=graph,
        dispatcher=_dispatcher_for(handler),
        run_id=rid,
        telemetry=Telemetry(run_id=rid),
        run_state_path=runs_root,
    )
    state = load(rid, root=runs_root)
    assert state.status == RunStatus.COMPLETED
    assert state.node_statuses == {
        "a": NodeStatus.COMPLETED,
        "b": NodeStatus.COMPLETED,
        "c": NodeStatus.COMPLETED,
    }
    assert state.last_successful_node_id == "c"
    assert state.frozen is True


# ---------------------------------------------------------------------
# Failure on the success path → checkpoint captures last successful node
# ---------------------------------------------------------------------


def test_walk_failure_records_last_successful_node_and_marks_failed(runs_root: Path):
    graph = _build_graph()
    rid = make_run_id("resume-test")
    walker = Walker()
    handler = _FlakyHandler(target_node_id="b")
    with pytest.raises(RuntimeError):
        walker.walk(
            graph=graph,
            dispatcher=_dispatcher_for(handler),
            run_id=rid,
            telemetry=Telemetry(run_id=rid),
            run_state_path=runs_root,
        )
    state = load(rid, root=runs_root)
    assert state.status == RunStatus.FAILED
    assert state.last_successful_node_id == "a"
    assert state.failure_info is not None
    assert state.failure_info["node_id"] == "b"
    assert state.failure_info["error_class"] == "RuntimeError"
    assert state.node_statuses["b"] == NodeStatus.FAILED


# ---------------------------------------------------------------------
# Resume re-executes failed node FIRST then continues forward
# ---------------------------------------------------------------------


def test_resume_replays_failed_node_first_then_continues(runs_root: Path):
    graph = _build_graph()
    rid = make_run_id("resume-test")
    walker = Walker()

    flaky = _FlakyHandler(target_node_id="b")
    with pytest.raises(RuntimeError):
        walker.walk(
            graph=graph,
            dispatcher=_dispatcher_for(flaky),
            run_id=rid,
            telemetry=Telemetry(run_id=rid),
            run_state_path=runs_root,
        )

    # Resume — the flaky handler now succeeds on retry.
    final_state = resume_run(
        run_id=rid,
        graph=graph,
        walker=walker,
        dispatcher=_dispatcher_for(flaky),
        telemetry=Telemetry(run_id=rid),
        runs_root=runs_root,
    )
    assert final_state.status == RunStatus.COMPLETED
    assert final_state.last_successful_node_id == "c"
    assert final_state.node_statuses == {
        "a": NodeStatus.COMPLETED,
        "b": NodeStatus.COMPLETED,
        "c": NodeStatus.COMPLETED,
    }
    # `a` was completed in the first pass; replay must NOT re-execute it.
    # `b` failed first, retried successfully, then `c` runs.
    assert flaky.calls == ["a", "b", "b", "c"]


def test_resume_idempotent_handler_produces_same_outputs(runs_root: Path):
    graph = _build_graph()
    rid = make_run_id("resume-test")
    walker = Walker()
    flaky = _FlakyHandler(target_node_id="b")
    with pytest.raises(RuntimeError):
        walker.walk(
            graph=graph,
            dispatcher=_dispatcher_for(flaky),
            run_id=rid,
            telemetry=Telemetry(run_id=rid),
            run_state_path=runs_root,
        )
    final_state = resume_run(
        run_id=rid,
        graph=graph,
        walker=walker,
        dispatcher=_dispatcher_for(flaky),
        telemetry=Telemetry(run_id=rid),
        runs_root=runs_root,
    )
    # `a` output preserved from first walk; `b` and `c` re-materialized.
    assert final_state.output_graph["a"] == {"id": "a", "marker": "out-a"}
    assert final_state.output_graph["b"] == {"id": "b", "marker": "out-b"}
    assert final_state.output_graph["c"] == {"id": "c", "marker": "out-c"}


# ---------------------------------------------------------------------
# Resume status guards
# ---------------------------------------------------------------------


def test_resume_completed_run_raises_already_completed(runs_root: Path):
    graph = _build_graph()
    rid = make_run_id("resume-test")
    walker = Walker()
    walker.walk(
        graph=graph,
        dispatcher=_dispatcher_for(_StubHandler()),
        run_id=rid,
        telemetry=Telemetry(run_id=rid),
        run_state_path=runs_root,
    )
    with pytest.raises(AlreadyCompletedError):
        resume_run(
            run_id=rid,
            graph=graph,
            walker=walker,
            dispatcher=_dispatcher_for(_StubHandler()),
            telemetry=Telemetry(run_id=rid),
            runs_root=runs_root,
        )


def test_resume_suspended_run_delegates_to_pause_path(runs_root: Path):
    rid = make_run_id("resume-test")
    from hive.lib.dag_executor.run_state import create

    state = create(rid, "resume-test")
    state = mark_suspended(state)
    save(state, root=runs_root)
    with pytest.raises(ResumeFromInvalidStateError):
        resume_run(
            run_id=rid,
            graph=_build_graph(),
            walker=Walker(),
            dispatcher=_dispatcher_for(_StubHandler()),
            telemetry=Telemetry(run_id=rid),
            runs_root=runs_root,
        )
