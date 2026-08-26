"""s2 — tests for the production front door (binding assembly + selection + run)."""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from hive.lib.dag_executor.executor import LocalAgentSpawn, MulticaAgentSpawn, StubAgentSpawn
from hive.lib.dag_executor.executor.errors import AgentHandlerError
from hive.lib.dag_executor.graph import NodeType
from hive.lib.dag_executor.run import (
    assemble_dispatcher,
    register_binding,
    resolve_spawn_binding,
    run,
)


def _write_workflow(tmp_path: Path) -> Path:
    wf = tmp_path / "frontdoor.workflow.yaml"
    wf.write_text(
        textwrap.dedent(
            """
            name: frontdoor-test
            description: minimal two-node agent graph for the front-door test
            version: "1.0.0"
            steps:
              - id: research
                agent: researcher
                task: do research
                depends_on: []
                inputs:
                  - name: story_id
                    source: context
                    context_key: story_id
                  - name: story_spec
                    source: context
                    context_key: story_spec
              - id: author
                agent: technical-writer
                task: write it up
                depends_on:
                  - research
            """
        ).strip()
        + "\n",
        encoding="utf-8",
    )
    return wf


# ---- binding selection -------------------------------------------------

def test_resolve_binding_defaults_to_local():
    name, spawn = resolve_spawn_binding(None, env={})
    assert name == "local"
    assert isinstance(spawn, LocalAgentSpawn)


def test_resolve_binding_env_override_local():
    name, spawn = resolve_spawn_binding(None, env={"HIVE_EXECUTION_MODE": "local"})
    assert name == "local"
    assert isinstance(spawn, LocalAgentSpawn)


def test_resolve_binding_explicit_beats_env():
    # explicit "local" wins even when env asks for multica
    name, _ = resolve_spawn_binding("local", env={"HIVE_EXECUTION_MODE": "multica"})
    assert name == "local"


def test_resolve_binding_multica_resolves(tmp_path):
    # s6: multica binding is now built — resolves to MulticaAgentSpawn
    name, spawn = resolve_spawn_binding("multica", env={}, repo_root=tmp_path)
    assert name == "multica"
    assert isinstance(spawn, MulticaAgentSpawn)


def test_resolve_binding_unknown_raises():
    with pytest.raises(ValueError, match="unknown spawn binding"):
        resolve_spawn_binding("nope", env={})


def test_register_binding_is_resolvable():
    sentinel = StubAgentSpawn()
    register_binding("fake-mode", lambda **_: sentinel)
    name, spawn = resolve_spawn_binding("fake-mode", env={})
    assert name == "fake-mode"
    assert spawn is sentinel


# ---- dispatcher assembly ----------------------------------------------

def test_assemble_dispatcher_registers_agent_handler():
    stub = StubAgentSpawn(canned_outputs={"n1": {"ok": True}})
    dispatcher = assemble_dispatcher(stub)

    class _Node:
        id = "n1"
        agent = "researcher"
        node_type = NodeType.AGENT
        step_file = None

    out = dispatcher.dispatch(_Node(), {}, "run-1")
    assert out.outputs == {"ok": True}
    assert stub.calls and stub.calls[0]["agent"] == "researcher"


# ---- end-to-end front door --------------------------------------------

def test_run_end_to_end_with_stub(tmp_path):
    wf = _write_workflow(tmp_path)
    stub = StubAgentSpawn(
        canned_outputs={"research": {"x": 1}, "author": {"y": 2}}
    )
    materialised = run(wf, spawn=stub, run_id="frontdoor-run")
    assert set(materialised) == {"research", "author"}
    assert materialised["research"].outputs == {"x": 1}
    assert materialised["author"].outputs == {"y": 2}
    # both agent nodes dispatched through the injected binding, in order
    assert [c["step_id"] for c in stub.calls] == ["research", "author"]


def test_run_rereads_story_spec_when_rerun_context_is_null(tmp_path):
    wf = _write_workflow(tmp_path)
    repo = tmp_path / "repo"
    story = repo / ".pHive" / "epics" / "epic-1" / "stories" / "story-1.yaml"
    story.parent.mkdir(parents=True)
    story.write_text("id: story-1\ntitle: refreshed rerun spec\n", encoding="utf-8")
    stub = StubAgentSpawn()

    run(
        wf,
        spawn=stub,
        run_id="rerun-story-spec",
        repo_root=repo,
        context={
            "epic_id": "epic-1",
            "story_id": "story-1",
            "story_spec": None,
        },
        env={},
    )

    assert stub.calls[0]["inputs"]["story_spec"] == {
        "id": "story-1",
        "title": "refreshed rerun spec",
    }


def test_run_persists_run_state(tmp_path):
    wf = _write_workflow(tmp_path)
    state = tmp_path / "run-state.json"
    stub = StubAgentSpawn(
        canned_outputs={"research": {"x": 1}, "author": {"y": 2}}
    )
    # run_id omitted -> run_workflow generates a schema-valid <ULID>-<slug> id
    run(wf, spawn=stub, run_state_path=state)
    assert state.exists(), "run_state file should be written when run_state_path is set"


# ---- L1: episode_hook fires on failure ----------------------------------------

class _FailingSpawn:
    """AgentSpawn that always raises AgentHandlerError on first node dispatch."""

    def __call__(
        self,
        agent: str,
        step_file_content: str,
        inputs: dict,
        run_id: str,
        step_id: str,
        timeout_ms: int | None = None,
    ) -> dict:
        raise AgentHandlerError("intentional spawn failure")


def test_run_episode_hook_called_with_failed_status_on_exception(tmp_path):
    """L1: when run_workflow raises, episode_hook is called with status='failed'."""
    wf = _write_workflow(tmp_path)
    hook_calls: list[dict] = []

    def episode_hook(**kwargs):
        hook_calls.append(dict(kwargs))

    with pytest.raises(AgentHandlerError, match="intentional spawn failure"):
        run(wf, spawn=_FailingSpawn(), run_id="fail-run", episode_hook=episode_hook)

    assert len(hook_calls) == 1, "episode_hook must be called exactly once on failure"
    assert hook_calls[0]["status"] == "failed"
    assert hook_calls[0]["run_id"] == "fail-run"


def test_run_episode_hook_exception_does_not_suppress_original_error(tmp_path):
    """L1: if episode_hook itself raises on failure, the original exception still propagates."""
    wf = _write_workflow(tmp_path)

    def bad_hook(**kwargs):
        raise ValueError("hook error")

    with pytest.raises(AgentHandlerError, match="intentional spawn failure"):
        run(wf, spawn=_FailingSpawn(), run_id="fail-run2", episode_hook=bad_hook)
