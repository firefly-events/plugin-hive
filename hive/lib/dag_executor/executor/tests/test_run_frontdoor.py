"""s2 — tests for the production front door (binding assembly + selection + run)."""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from hive.lib.dag_executor.executor import LocalAgentSpawn, StubAgentSpawn
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


def test_resolve_binding_multica_not_built():
    with pytest.raises(NotImplementedError, match="s6-multica-spawn"):
        resolve_spawn_binding("multica", env={})


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


def test_run_persists_run_state(tmp_path):
    wf = _write_workflow(tmp_path)
    state = tmp_path / "run-state.json"
    stub = StubAgentSpawn(
        canned_outputs={"research": {"x": 1}, "author": {"y": 2}}
    )
    # run_id omitted -> run_workflow generates a schema-valid <ULID>-<slug> id
    run(wf, spawn=stub, run_state_path=state)
    assert state.exists(), "run_state file should be written when run_state_path is set"
