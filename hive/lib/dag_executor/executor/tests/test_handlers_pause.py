"""Pause handler — STUB. Full semantics in hde-8."""

from __future__ import annotations

from hive.lib.dag_executor.executor.handlers.pause import PauseHandler
from hive.lib.dag_executor.graph import Node, NodeType


def test_pause_stub_returns_immediately():
    node = Node(id="pause-x", agent="orchestrator", node_type=NodeType.PAUSE)
    out = PauseHandler().handle(node, inputs={}, run_id="rid-1")
    assert out.outputs["paused"] is False
    assert out.meta["stub"] is True
