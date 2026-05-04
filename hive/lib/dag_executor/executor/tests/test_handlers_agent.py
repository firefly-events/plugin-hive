"""Risk #2 HIGH defense — agent handler must NOT bypass agent-spawn.

These tests use a spy/mock as the spawn callable and assert the EXACT
invocation shape passed in. They guard against:
  * Loader-side resolution leaking into the handler (raw `developer`
    must reach agent-spawn unchanged).
  * step_file content being summarised, paraphrased, or trimmed.
  * run_id and step_id failing to propagate.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from hive.lib.dag_executor.executor.errors import AgentHandlerError
from hive.lib.dag_executor.executor.handlers.agent import (
    AgentHandler,
    NodeOutput,
    StubAgentSpawn,
)
from hive.lib.dag_executor.graph import Node, NodeType


def _make_node(step_file: str | None = None) -> Node:
    return Node(
        id="implement",
        agent="developer",  # generic — must NOT be pre-resolved
        node_type=NodeType.AGENT,
        step_file=step_file,
    )


def test_raw_agent_string_preserved_through_dispatch():
    spy = StubAgentSpawn(canned_outputs={"implement": {"summary": "ok"}})
    handler = AgentHandler(spawn=spy)
    handler.handle(_make_node(), inputs={}, run_id="rid-1")

    assert len(spy.calls) == 1
    call = spy.calls[0]
    # Risk #2 HIGH: generic `developer` MUST reach agent-spawn raw.
    assert call["agent"] == "developer", (
        f"agent string was resolved before agent-spawn dispatch: {call['agent']!r}"
    )
    assert call["run_id"] == "rid-1"
    assert call["step_id"] == "implement"


def test_step_file_content_passed_verbatim(tmp_path: Path):
    step_file = tmp_path / "step.md"
    content = (
        "# Step file\n\n"
        "**Bold marker** — must survive verbatim.\n\n"
        "```python\nx = 1  # don't paraphrase me\n```\n"
        "Trailing whitespace too:    \n"
    )
    step_file.write_text(content, encoding="utf-8")

    spy = StubAgentSpawn()
    handler = AgentHandler(spawn=spy)
    handler.handle(_make_node(step_file=str(step_file)), inputs={}, run_id="rid-1")

    call = spy.calls[0]
    assert call["step_file_content"] == content, (
        "step_file content was transformed before agent-spawn dispatch"
    )


def test_step_file_resolves_relative_to_repo_root(tmp_path: Path):
    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    rel = Path("hive/workflows/steps/sample.md")
    full = repo_root / rel
    full.parent.mkdir(parents=True)
    full.write_text("hello world", encoding="utf-8")

    spy = StubAgentSpawn()
    handler = AgentHandler(spawn=spy, repo_root=repo_root)
    handler.handle(_make_node(step_file=str(rel)), inputs={}, run_id="rid-1")

    assert spy.calls[0]["step_file_content"] == "hello world"


def test_missing_step_file_raises_agent_handler_error(tmp_path: Path):
    handler = AgentHandler(spawn=StubAgentSpawn())
    missing = tmp_path / "does-not-exist.md"
    with pytest.raises(AgentHandlerError):
        handler.handle(_make_node(step_file=str(missing)), inputs={}, run_id="rid-1")


def test_inputs_propagate_to_spawn():
    spy = StubAgentSpawn()
    handler = AgentHandler(spawn=spy)
    inputs = {"diff": "<<diff>>", "scope_analysis": {"files_changed": 3}}
    handler.handle(_make_node(), inputs=inputs, run_id="rid-1")

    assert spy.calls[0]["inputs"] == inputs


def test_node_with_no_step_file_passes_empty_string():
    spy = StubAgentSpawn()
    handler = AgentHandler(spawn=spy)
    handler.handle(_make_node(), inputs={}, run_id="rid-1")
    assert spy.calls[0]["step_file_content"] == ""


def test_handler_returns_node_output_with_canned_outputs():
    spy = StubAgentSpawn(canned_outputs={"implement": {"verdict": "ok"}})
    handler = AgentHandler(spawn=spy)
    out = handler.handle(_make_node(), inputs={}, run_id="rid-1")
    assert isinstance(out, NodeOutput)
    assert out.outputs == {"verdict": "ok"}


def test_non_dict_spawn_return_raises():
    def bad_spawn(**_kwargs):
        return "not-a-dict"

    handler = AgentHandler(spawn=bad_spawn)
    with pytest.raises(AgentHandlerError):
        handler.handle(_make_node(), inputs={}, run_id="rid-1")
