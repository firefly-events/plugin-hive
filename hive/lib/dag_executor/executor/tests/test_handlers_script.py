"""Tests for ScriptHandler — bash command execution, stdout capture."""

from __future__ import annotations

import pytest

from hive.lib.dag_executor.executor.errors import ScriptHandlerError
from hive.lib.dag_executor.executor.handlers.script import ScriptHandler
from hive.lib.dag_executor.graph import Node, NodeType


def _script_node(task: str, timeout_ms: int | None = None) -> Node:
    return Node(
        id="script-x",
        agent="developer",
        node_type=NodeType.SCRIPT,
        task=task,
        timeout_ms=timeout_ms,
    )


def test_runs_bash_and_captures_stdout():
    out = ScriptHandler().handle(_script_node("echo hello"), inputs={}, run_id="rid-1")
    assert out.outputs["stdout"].strip() == "hello"
    assert out.meta["returncode"] == 0


def test_python_inline_via_python3():
    out = ScriptHandler().handle(
        _script_node('python3 -c "print(2 + 2)"'),
        inputs={},
        run_id="rid-1",
    )
    assert out.outputs["stdout"].strip() == "4"


def test_failing_command_raises():
    with pytest.raises(ScriptHandlerError):
        ScriptHandler().handle(_script_node("false"), inputs={}, run_id="rid-1")


def test_empty_task_raises():
    node = Node(id="bad", agent="developer", node_type=NodeType.SCRIPT, task=None)
    with pytest.raises(ScriptHandlerError):
        ScriptHandler().handle(node, inputs={}, run_id="rid-1")


def test_timeout_raises_script_handler_error():
    with pytest.raises(ScriptHandlerError):
        ScriptHandler().handle(
            _script_node("sleep 2", timeout_ms=100),
            inputs={},
            run_id="rid-1",
        )
