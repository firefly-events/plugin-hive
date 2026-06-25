"""Story s5 coverage for `node_type: user_gate`."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from hive.lib.dag_executor.executor.handlers.user_gate import (
    OUTPUT_GRAPH_INPUT,
    UserGateHandler,
)
from hive.lib.dag_executor.graph import Node, NodeType
from hive.lib.dag_executor.pause import SignalKind, SignalResult
from hive.lib.dag_executor.pause.errors import PauseRejectedError


def _node(auto_pass_when: str | None) -> Node:
    return Node(
        id="gate",
        agent="architect",
        node_type=NodeType.USER_GATE,
        auto_pass_when=auto_pass_when,
        timeout_ms=5000,
    )


def _inputs(step_id: str, output: dict) -> dict:
    return {OUTPUT_GRAPH_INPUT: {step_id: {"output": output}}}


def _approved() -> SignalResult:
    return SignalResult(
        kind=SignalKind.APPROVED,
        reason=None,
        sentinel_path=Path("/tmp/run/pause/gate.approve"),
    )


def test_auto_pass_true_writes_no_sentinel(tmp_path: Path) -> None:
    handler = UserGateHandler(runs_root=tmp_path)

    with patch("hive.lib.dag_executor.executor.handlers.user_gate.generate") as generate:
        result = handler.handle(
            _node("$hv.output.first_run == false && $hv.output.confidence >= 80"),
            _inputs("hv", {"first_run": False, "confidence": 91}),
            "run-001",
        )

    assert result.outputs["user_gate"] == "passed"
    generate.assert_not_called()


def test_predicate_false_halts_and_waits_for_signal(tmp_path: Path) -> None:
    handler = UserGateHandler(runs_root=tmp_path)

    with patch("hive.lib.dag_executor.executor.handlers.user_gate.wait_for_signal") as wait:
        wait.return_value = _approved()
        handler.handle(
            _node("$hv.output.confidence >= 80"),
            _inputs("hv", {"confidence": 20}),
            "run-001",
        )

    wait.assert_called_once()


def test_missing_auto_pass_when_always_halts(tmp_path: Path) -> None:
    handler = UserGateHandler(runs_root=tmp_path)

    with patch("hive.lib.dag_executor.executor.handlers.user_gate.wait_for_signal") as wait:
        wait.return_value = _approved()
        result = handler.handle(_node(None), {}, "run-001")

    assert result.outputs["user_gate"] == "approved"
    wait.assert_called_once()


def test_approve_sentinel_resumes_forward(tmp_path: Path) -> None:
    handler = UserGateHandler(runs_root=tmp_path)

    with patch("hive.lib.dag_executor.executor.handlers.user_gate.wait_for_signal") as wait:
        wait.return_value = _approved()
        result = handler.handle(
            _node("$hv.output.confidence >= 80"),
            _inputs("hv", {"confidence": 10}),
            "run-001",
        )

    assert result.outputs == {"user_gate": "approved", "resumed": True}


def test_reject_sentinel_is_terminal_failure(tmp_path: Path) -> None:
    handler = UserGateHandler(runs_root=tmp_path)

    with patch("hive.lib.dag_executor.executor.handlers.user_gate.wait_for_signal") as wait:
        wait.return_value = SignalResult(
            kind=SignalKind.REJECTED,
            reason="needs revision",
            sentinel_path=Path("/tmp/run/pause/gate.reject"),
        )
        with pytest.raises(PauseRejectedError, match="needs revision"):
            handler.handle(
                _node("$hv.output.confidence >= 80"),
                _inputs("hv", {"confidence": 10}),
                "run-001",
            )


@pytest.mark.parametrize(
    ("expr", "step_id", "output"),
    [
        ("$hv.output.confidence >= 80", "hv", {"first_run": False}),
        (
            "$so.output.first_run == false && $so.output.open_questions_count == 0",
            "so",
            {"first_run": False},
        ),
        (
            "$hv.output.first_run == false && $hv.output.confidence >= 80",
            "hv",
            {"confidence": 100},
        ),
    ],
)
def test_absent_dotpath_fails_closed_for_all_plan_gate_signals(
    tmp_path: Path,
    expr: str,
    step_id: str,
    output: dict,
) -> None:
    handler = UserGateHandler(runs_root=tmp_path)

    with patch("hive.lib.dag_executor.executor.handlers.user_gate.wait_for_signal") as wait:
        wait.return_value = _approved()
        handler.handle(_node(expr), _inputs(step_id, output), "run-001")

    wait.assert_called_once()
