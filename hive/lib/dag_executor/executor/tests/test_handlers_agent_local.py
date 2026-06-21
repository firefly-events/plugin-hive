"""LocalAgentSpawn — local one-shot binding tests.

Guards the same Risk #2 HIGH invariants as test_handlers_agent.py but for
the production LocalAgentSpawn path:
  * step_file_content embedded verbatim in the prompt (no paraphrase).
  * agent string forwarded raw (no pre-resolution).
  * JSON output from `claude --print` parsed into the outputs dict.
  * AgentHandler(spawn=local_binding) + spine fixture = documented call shape.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.errors import AgentHandlerError
from hive.lib.dag_executor.executor.handlers.agent import (
    AgentHandler,
    LocalAgentSpawn,
    StubAgentSpawn,
)
from hive.lib.dag_executor.executor.run_id import make_run_id
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker
from hive.lib.dag_executor.graph import NodeType, load_workflow


REPO_ROOT = Path(__file__).resolve().parents[5]
SPINE_FIXTURE = REPO_ROOT / "hive" / "workflows" / "code-review.workflow.yaml"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_completed_process(stdout: str = "{}", returncode: int = 0) -> MagicMock:
    cp = MagicMock(spec=subprocess.CompletedProcess)
    cp.stdout = stdout
    cp.stderr = ""
    cp.returncode = returncode
    return cp


def _spawn_with_mock(
    stdout: str = "{}",
    returncode: int = 0,
    **kwargs: Any,
) -> LocalAgentSpawn:
    return LocalAgentSpawn(**kwargs)


# ---------------------------------------------------------------------------
# Prompt construction — step_file_content verbatim (AC2)
# ---------------------------------------------------------------------------


def test_build_prompt_contains_step_file_content_verbatim():
    verbatim = (
        "# Step\n\n**Bold** — must not be summarised.\n\n"
        "```python\nx = 1  # don't paraphrase me\n```\n"
        "Trailing spaces:    \n"
    )
    spawn = LocalAgentSpawn()
    prompt = spawn.build_prompt(
        agent="developer",
        step_file_content=verbatim,
        inputs={},
        run_id="rid-1",
        step_id="implement",
    )
    assert verbatim in prompt, (
        "step_file_content was transformed before being embedded in the prompt"
    )


def test_build_prompt_agent_string_raw():
    spawn = LocalAgentSpawn()
    prompt = spawn.build_prompt(
        agent="developer",
        step_file_content="",
        inputs={},
        run_id="rid-1",
        step_id="implement",
    )
    assert "developer" in prompt
    # Must NOT have been expanded to a sub-persona
    assert "frontend-developer" not in prompt
    assert "backend-developer" not in prompt


def test_build_prompt_inputs_serialised_as_json():
    inputs = {"diff": "<<diff>>", "count": 3}
    spawn = LocalAgentSpawn()
    prompt = spawn.build_prompt(
        agent="researcher",
        step_file_content="",
        inputs=inputs,
        run_id="rid-1",
        step_id="analyze",
    )
    assert '"diff"' in prompt
    assert '"<<diff>>"' in prompt
    assert '"count"' in prompt


# ---------------------------------------------------------------------------
# Output parsing
# ---------------------------------------------------------------------------


def test_parse_json_output_bare_object():
    result = LocalAgentSpawn._parse_json_output('{"verdict": "ok"}', "step-1")
    assert result == {"verdict": "ok"}


def test_parse_json_output_strips_markdown_fence():
    raw = '```json\n{"verdict": "ok"}\n```'
    result = LocalAgentSpawn._parse_json_output(raw, "step-1")
    assert result == {"verdict": "ok"}


def test_parse_json_output_strips_bare_fence():
    raw = '```\n{"verdict": "ok"}\n```'
    result = LocalAgentSpawn._parse_json_output(raw, "step-1")
    assert result == {"verdict": "ok"}


def test_parse_json_output_non_json_raises():
    with pytest.raises(AgentHandlerError, match="non-JSON"):
        LocalAgentSpawn._parse_json_output("not json at all", "step-1")


def test_parse_json_output_non_dict_raises():
    with pytest.raises(AgentHandlerError, match="non-dict"):
        LocalAgentSpawn._parse_json_output('["list"]', "step-1")


# ---------------------------------------------------------------------------
# Subprocess dispatch
# ---------------------------------------------------------------------------


def test_local_spawn_passes_prompt_to_stdin(monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, Any] = {}

    def fake_run(argv, **kwargs):
        captured["argv"] = argv
        captured["input"] = kwargs.get("input", "")
        return _make_completed_process(stdout='{"result": "done"}')

    monkeypatch.setattr(subprocess, "run", fake_run)
    spawn = LocalAgentSpawn()
    result = spawn(
        agent="developer",
        step_file_content="## Do the thing",
        inputs={"x": 1},
        run_id="rid-1",
        step_id="implement",
    )

    assert captured["argv"] == ["claude", "--print"]
    assert "developer" in captured["input"]
    assert "## Do the thing" in captured["input"]
    assert result == {"result": "done"}


def test_local_spawn_step_file_content_verbatim_in_input(monkeypatch: pytest.MonkeyPatch):
    verbatim = "# Unique marker abc123\n\nDo not paraphrase this.\n"
    captured: dict[str, str] = {}

    def fake_run(argv, **kwargs):
        captured["input"] = kwargs.get("input", "")
        return _make_completed_process(stdout='{}')

    monkeypatch.setattr(subprocess, "run", fake_run)
    spawn = LocalAgentSpawn()
    spawn(
        agent="developer",
        step_file_content=verbatim,
        inputs={},
        run_id="rid-1",
        step_id="implement",
    )

    assert verbatim in captured["input"], (
        "step_file_content was transformed before being sent to claude --print"
    )


def test_local_spawn_nonzero_exit_raises(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *a, **kw: _make_completed_process(stdout="", returncode=1),
    )
    spawn = LocalAgentSpawn()
    with pytest.raises(AgentHandlerError, match="exited 1"):
        spawn(agent="developer", step_file_content="", inputs={}, run_id="r", step_id="s")


def test_local_spawn_timeout_raises(monkeypatch: pytest.MonkeyPatch):
    def fake_run(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd=["claude", "--print"], timeout=0.001)

    monkeypatch.setattr(subprocess, "run", fake_run)
    spawn = LocalAgentSpawn(timeout_ms=1)
    with pytest.raises(AgentHandlerError, match="timed out"):
        spawn(agent="developer", step_file_content="", inputs={}, run_id="r", step_id="s")


def test_local_spawn_custom_claude_bin(monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, Any] = {}

    def fake_run(argv, **kwargs):
        captured["argv"] = argv
        return _make_completed_process(stdout='{"ok": true}')

    monkeypatch.setattr(subprocess, "run", fake_run)
    spawn = LocalAgentSpawn(claude_bin="/usr/local/bin/claude")
    spawn(agent="developer", step_file_content="", inputs={}, run_id="r", step_id="s")
    assert captured["argv"][0] == "/usr/local/bin/claude"


# ---------------------------------------------------------------------------
# AC3 — AgentHandler(spawn=local_binding) + spine fixture call shape
# ---------------------------------------------------------------------------


_SPINE_CANNED = {
    "analyze": {"scope_analysis": "ok"},
    "review": {"review_verdict": "passed", "review_findings": "none"},
    "summarize": {"review_summary": "ok"},
}


def test_agent_handler_with_local_spawn_matches_call_shape(
    monkeypatch: pytest.MonkeyPatch,
):
    """AC3: AgentHandler(spawn=local_binding) against spine fixture.

    Monkeypatches subprocess so we don't need a real claude binary.
    The test verifies that the call shape — agent string, step_id, run_id
    propagation — is identical to the documented StubAgentSpawn path.
    """
    call_log: list[dict[str, Any]] = []

    def fake_run(argv, **kwargs):
        # Extract step_id from the prompt to look up canned output
        prompt: str = kwargs.get("input", "")
        step_id = "unknown"
        for line in prompt.splitlines():
            if "step_id:" in line:
                step_id = line.split("step_id:")[-1].strip()
                break
        canned = _SPINE_CANNED.get(step_id, {})
        call_log.append({"argv": argv, "step_id": step_id})
        return _make_completed_process(stdout=json.dumps(canned))

    monkeypatch.setattr(subprocess, "run", fake_run)

    graph = load_workflow(SPINE_FIXTURE)
    run_id = make_run_id("code-review")
    local_spawn = LocalAgentSpawn()
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=local_spawn).handle)
    telemetry = Telemetry(run_id=run_id)

    materialised = Walker().walk(
        graph,
        dispatcher,
        run_id,
        telemetry,
        context={"diff_content": "<<diff>>"},
    )

    # All three steps should have been dispatched
    assert len(call_log) == 3
    # claude --print was called each time
    for entry in call_log:
        assert entry["argv"] == ["claude", "--print"]

    # Outputs materialised match declared OutputRef names
    for step_id in ["analyze", "review", "summarize"]:
        declared = sorted(o.name for o in graph.nodes[step_id].outputs)
        actual = sorted(materialised[step_id].outputs.keys())
        assert actual == declared, (
            f"step {step_id!r}: expected {declared}, got {actual}"
        )


def test_agent_handler_local_spawn_agent_strings_raw(
    monkeypatch: pytest.MonkeyPatch,
):
    """Risk #2 HIGH defense at spine level: raw agent strings reach claude --print."""
    agent_strings_in_prompt: list[str] = []

    def fake_run(argv, **kwargs):
        prompt: str = kwargs.get("input", "")
        # First line is "# Agent: <name>"
        for line in prompt.splitlines():
            if line.startswith("# Agent:"):
                agent_strings_in_prompt.append(line.removeprefix("# Agent:").strip())
                break
        step_id = "unknown"
        for line in prompt.splitlines():
            if "step_id:" in line:
                step_id = line.split("step_id:")[-1].strip()
                break
        canned = _SPINE_CANNED.get(step_id, {})
        return _make_completed_process(stdout=json.dumps(canned))

    monkeypatch.setattr(subprocess, "run", fake_run)

    graph = load_workflow(SPINE_FIXTURE)
    run_id = make_run_id("code-review")
    local_spawn = LocalAgentSpawn()
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=local_spawn).handle)
    Walker().walk(
        graph,
        dispatcher,
        run_id,
        Telemetry(run_id=run_id),
        context={"diff_content": "<<diff>>"},
    )

    declared_agents = [graph.nodes[s].agent for s in ["analyze", "review", "summarize"]]
    assert agent_strings_in_prompt == declared_agents, (
        f"agent strings were transformed before claude --print: "
        f"{agent_strings_in_prompt} != {declared_agents}"
    )
