"""Tests for `node_type: user_gate` (story s3-conditional-user-gate)."""

from __future__ import annotations

import threading
import time
from pathlib import Path
from unittest.mock import patch

import pytest

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.handlers import NodeOutput
from hive.lib.dag_executor.executor.handlers.user_gate import (
    OUTPUT_GRAPH_INPUT,
    UserGateHandler,
)
from hive.lib.dag_executor.executor.run_id import make_run_id
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker, _is_user_gate_node
from hive.lib.dag_executor.graph import ConditionalEdge, Graph, Node, NodeType
from hive.lib.dag_executor.graph.loader import load_workflow
from hive.lib.dag_executor.pause import SignalKind, SignalResult, generate
from hive.lib.dag_executor.pause.errors import PauseRejectedError


def _make_node(
    node_id: str = "test-gate",
    node_type: NodeType = NodeType.USER_GATE,
    auto_pass_when: str | None = None,
    depends_on: list[str] | None = None,
    timeout_ms: int | None = 5000,
) -> Node:
    return Node(
        id=node_id,
        agent="architect",
        node_type=node_type,
        auto_pass_when=auto_pass_when,
        depends_on=depends_on or [],
        outputs=[{"name": "gate_verdict", "type": "string"}],
        timeout_ms=timeout_ms,
    )


class _FakeTelemetry:
    def __init__(self) -> None:
        self.events: list[tuple[str, str, dict]] = []

    def emit(self, event: str, node_id: str, payload: dict) -> None:
        self.events.append((event, node_id, payload))


def _output_graph(**outputs: dict) -> dict:
    return {OUTPUT_GRAPH_INPUT: {node_id: {"output": output} for node_id, output in outputs.items()}}


def _approved(path: str = "/tmp/user_gate.approve") -> SignalResult:
    return SignalResult(kind=SignalKind.APPROVED, reason=None, sentinel_path=Path(path))


def test_auto_pass_when_true_proceeds_without_sentinel(tmp_path: Path) -> None:
    handler = UserGateHandler(runs_root=tmp_path, telemetry=_FakeTelemetry())
    node = _make_node(
        auto_pass_when="$hv.output.first_run == false && $hv.output.confidence >= 80"
    )

    with patch("hive.lib.dag_executor.executor.handlers.user_gate.generate") as mock_generate:
        result = handler.handle(
            node,
            _output_graph(hv={"first_run": False, "confidence": 90}),
            "run-001",
        )

    assert result.outputs["user_gate"] == "passed"
    mock_generate.assert_not_called()


def test_hv_first_run_halts_even_with_high_confidence(tmp_path: Path) -> None:
    handler = UserGateHandler(runs_root=tmp_path, telemetry=_FakeTelemetry())
    node = _make_node(
        auto_pass_when="$hv.output.first_run == false && $hv.output.confidence >= 80"
    )

    with patch("hive.lib.dag_executor.executor.handlers.user_gate.wait_for_signal") as mock_wait:
        mock_wait.return_value = _approved()
        handler.handle(
            node,
            _output_graph(hv={"first_run": True, "confidence": 100}),
            "run-001",
        )

    mock_wait.assert_called_once()


def test_hv_low_confidence_halts_on_non_first_run(tmp_path: Path) -> None:
    handler = UserGateHandler(runs_root=tmp_path, telemetry=_FakeTelemetry())
    node = _make_node(
        auto_pass_when="$hv.output.first_run == false && $hv.output.confidence >= 80"
    )

    with patch("hive.lib.dag_executor.executor.handlers.user_gate.wait_for_signal") as mock_wait:
        mock_wait.return_value = _approved()
        handler.handle(
            node,
            _output_graph(hv={"first_run": False, "confidence": 79}),
            "run-001",
        )

    mock_wait.assert_called_once()


def test_so_zero_open_questions_auto_passes_on_non_first_run(tmp_path: Path) -> None:
    handler = UserGateHandler(runs_root=tmp_path, telemetry=_FakeTelemetry())
    node = _make_node(
        auto_pass_when="$so.output.first_run == false && $so.output.open_questions_count == 0"
    )

    with patch("hive.lib.dag_executor.executor.handlers.user_gate.generate") as mock_generate:
        result = handler.handle(
            node,
            _output_graph(so={"first_run": False, "open_questions_count": 0}),
            "run-001",
        )

    assert result.outputs["user_gate"] == "passed"
    mock_generate.assert_not_called()


def test_so_open_questions_halts(tmp_path: Path) -> None:
    handler = UserGateHandler(runs_root=tmp_path, telemetry=_FakeTelemetry())
    node = _make_node(
        auto_pass_when="$so.output.first_run == false && $so.output.open_questions_count == 0"
    )

    with patch("hive.lib.dag_executor.executor.handlers.user_gate.wait_for_signal") as mock_wait:
        mock_wait.return_value = _approved()
        handler.handle(
            node,
            _output_graph(so={"first_run": False, "open_questions_count": 1}),
            "run-001",
        )

    mock_wait.assert_called_once()


def test_so_first_run_halts_even_with_zero_open_questions(tmp_path: Path) -> None:
    handler = UserGateHandler(runs_root=tmp_path, telemetry=_FakeTelemetry())
    node = _make_node(
        auto_pass_when="$so.output.first_run == false && $so.output.open_questions_count == 0"
    )

    with patch("hive.lib.dag_executor.executor.handlers.user_gate.wait_for_signal") as mock_wait:
        mock_wait.return_value = _approved()
        handler.handle(
            node,
            _output_graph(so={"first_run": True, "open_questions_count": 0}),
            "run-001",
        )

    mock_wait.assert_called_once()


def test_auto_pass_when_false_suspends(tmp_path: Path) -> None:
    telemetry = _FakeTelemetry()
    handler = UserGateHandler(runs_root=tmp_path, telemetry=telemetry)
    node = _make_node(auto_pass_when="$hv.output.confidence >= 80")

    with patch("hive.lib.dag_executor.executor.handlers.user_gate.wait_for_signal") as mock_wait:
        mock_wait.return_value = _approved()
        handler.handle(node, _output_graph(hv={"confidence": 40}), "run-001")

    assert any(event[0] == "pause_suspended" for event in telemetry.events)
    mock_wait.assert_called_once()


def test_missing_auto_pass_when_always_halts(tmp_path: Path) -> None:
    handler = UserGateHandler(runs_root=tmp_path, telemetry=_FakeTelemetry())
    node = _make_node(auto_pass_when=None)

    with patch("hive.lib.dag_executor.executor.handlers.user_gate.wait_for_signal") as mock_wait:
        mock_wait.return_value = _approved()
        result = handler.handle(node, {}, "run-001")

    assert result.outputs["user_gate"] == "approved"
    mock_wait.assert_called_once()


def test_missing_dotpath_fails_closed_and_halts(tmp_path: Path) -> None:
    handler = UserGateHandler(runs_root=tmp_path, telemetry=_FakeTelemetry())
    node = _make_node(auto_pass_when="$hv.output.confidence >= 80")

    with patch("hive.lib.dag_executor.executor.handlers.user_gate.wait_for_signal") as mock_wait:
        mock_wait.return_value = _approved()
        handler.handle(node, _output_graph(hv={}), "run-001")

    mock_wait.assert_called_once()


def test_approve_sentinel_resumes_forward(tmp_path: Path) -> None:
    handler = UserGateHandler(runs_root=tmp_path, telemetry=_FakeTelemetry())
    node = _make_node(auto_pass_when="$hv.output.confidence >= 80")

    with patch("hive.lib.dag_executor.executor.handlers.user_gate.wait_for_signal") as mock_wait:
        mock_wait.return_value = _approved("/tmp/run-001/pause/test-gate.approve")
        result = handler.handle(node, _output_graph(hv={"confidence": 10}), "run-001")

    assert result.outputs == {"user_gate": "approved", "resumed": True}


def test_reject_sentinel_is_terminal_failure(tmp_path: Path) -> None:
    handler = UserGateHandler(runs_root=tmp_path, telemetry=_FakeTelemetry())
    node = _make_node(auto_pass_when="$hv.output.confidence >= 80")

    with patch("hive.lib.dag_executor.executor.handlers.user_gate.wait_for_signal") as mock_wait:
        mock_wait.return_value = SignalResult(
            kind=SignalKind.REJECTED,
            reason="needs human revision",
            sentinel_path=Path("/tmp/run-001/pause/test-gate.reject"),
        )
        with pytest.raises(PauseRejectedError, match="needs human revision"):
            handler.handle(node, _output_graph(hv={"confidence": 10}), "run-001")


def test_user_gate_nodes_are_detected_as_sequential_barriers() -> None:
    assert _is_user_gate_node(_make_node(node_type=NodeType.USER_GATE)) is True
    assert _is_user_gate_node(_make_node(node_type=NodeType.PAUSE)) is False
    assert _is_user_gate_node(_make_node(node_type=NodeType.AGENT)) is False


def test_walker_dispatches_user_gate_before_parallel_siblings() -> None:
    call_order: list[str] = []
    root = _make_node("root", node_type=NodeType.AGENT)
    gate = _make_node(
        "gate",
        auto_pass_when="$root.output.ready == true",
        depends_on=["root"],
    )
    sibling = _make_node("sibling", node_type=NodeType.AGENT, depends_on=["root"])
    graph = Graph(
        workflow_name="test",
        nodes={n.id: n for n in [root, gate, sibling]},
        edges=[
            ConditionalEdge("root", "gate"),
            ConditionalEdge("root", "sibling"),
        ],
    )

    def agent_handler(node, inputs, run_id):
        call_order.append(node.id)
        return NodeOutput(outputs={"ready": True})

    def user_gate_handler(node, inputs, run_id):
        call_order.append(node.id)
        return NodeOutput(outputs={"user_gate": "passed"})

    dispatcher = Dispatcher(
        handlers={
            NodeType.AGENT: agent_handler,
            NodeType.USER_GATE: user_gate_handler,
        }
    )

    Walker().walk(graph, dispatcher, "run-001", Telemetry(run_id="run-001"))

    assert call_order.index("gate") < call_order.index("sibling")


def test_human_only_actor_contract_is_documented() -> None:
    docstring = UserGateHandler.__doc__ or ""
    module_docstring = __import__(
        "hive.lib.dag_executor.executor.handlers.user_gate",
        fromlist=["__doc__"],
    ).__doc__ or ""
    combined = f"{docstring}\n{module_docstring}".lower()
    assert "human" in combined
    assert "ci" in combined or "automation" in combined


def test_narrated_path_without_user_gate_never_invokes_handler() -> None:
    graph = Graph(
        workflow_name="narrated",
        nodes={"agent": _make_node("agent", node_type=NodeType.AGENT)},
        edges=[],
    )
    dispatcher = Dispatcher(handlers={NodeType.AGENT: lambda node, inputs, run_id: NodeOutput(outputs={})})

    with patch.object(UserGateHandler, "handle") as mock_handle:
        Walker().walk(graph, dispatcher, "run-001", Telemetry(run_id="run-001"))

    mock_handle.assert_not_called()


def test_plan_workflow_parses_with_user_gate_nodes() -> None:
    workflow_path = Path("hive/workflows/plan.workflow.yaml")
    graph = load_workflow(workflow_path)

    user_gate_nodes = [
        node for node in graph.nodes.values()
        if node.node_type == NodeType.USER_GATE
    ]
    assert user_gate_nodes
    assert graph.nodes["design-gate"].auto_pass_when is None
    assert "design-gate" in graph.nodes["author"].depends_on
    assert "design" not in graph.nodes["author"].depends_on
    assert graph.nodes["hv-gate"].auto_pass_when == (
        "$hv.output.first_run == false && $hv.output.confidence >= 80"
    )
    assert graph.nodes["so-gate"].auto_pass_when == (
        "$so.output.first_run == false && $so.output.open_questions_count == 0"
    )
    assert set(graph.nodes["reconcile"].depends_on) >= {"hv-gate", "so-gate"}


def test_user_gate_run_state_suspends_then_resumes(tmp_path: Path) -> None:
    from hive.lib.dag_executor.run_state import RunStatus, load

    root = _make_node("root", node_type=NodeType.AGENT)
    gate = _make_node(
        "gate",
        auto_pass_when="$root.output.ready == true",
        depends_on=["root"],
        timeout_ms=5000,
    )
    after = _make_node("after", node_type=NodeType.AGENT, depends_on=["gate"])
    graph = Graph(
        workflow_name="test",
        nodes={n.id: n for n in [root, gate, after]},
        edges=[ConditionalEdge("root", "gate"), ConditionalEdge("gate", "after")],
    )
    run_id = make_run_id("user-gate")
    runs_root = tmp_path / "runs"
    state_root = tmp_path / "state"
    telemetry = Telemetry(run_id=run_id)
    handler = UserGateHandler(runs_root=runs_root, telemetry=telemetry, poll_interval=0.02)
    dispatcher = Dispatcher(
        handlers={
            NodeType.AGENT: lambda node, inputs, rid: NodeOutput(outputs={"ready": False}),
            NodeType.USER_GATE: handler.handle,
        }
    )
    captured_status: dict[str, RunStatus | None] = {}

    def approve_after_suspended() -> None:
        state_file = state_root / run_id / "run_state.yaml"
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if state_file.exists():
                snapshot = load(run_id, root=state_root)
                if snapshot.status == RunStatus.SUSPENDED:
                    captured_status["mid_gate"] = snapshot.status
                    break
            time.sleep(0.01)
        token = generate(run_id, "gate", runs_root)
        path = runs_root / run_id / "pause" / "gate.approve"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(token, encoding="utf-8")

    thread = threading.Thread(target=approve_after_suspended)
    thread.start()
    materialised = Walker().walk(
        graph,
        dispatcher,
        run_id,
        telemetry,
        run_state_path=state_root,
    )
    thread.join(timeout=5)

    assert captured_status["mid_gate"] == RunStatus.SUSPENDED
    assert load(run_id, root=state_root).status == RunStatus.COMPLETED
    assert "after" in materialised
