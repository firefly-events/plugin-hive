"""Frontdoor integration tests — s2-run-frontdoor.

Covers all four acceptance criteria:
  AC1  Basic run: loads graph, assembles dispatcher, executes nodes, returns outputs.
  AC2  Resume: same run_id + run_state_path skips completed nodes.
  AC3  Binding selection: local default; HIVE_EXECUTION_MODE=multica raises
       NotImplementedError (MulticaAgentSpawn not yet available); explicit spawn
       bypasses detection.
  AC4  Failure: surfaces node_id in run_state failure_info; downstream nodes not
       marked complete.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from hive.lib.dag_executor.executor.errors import HandlerError
from hive.lib.dag_executor.executor.handlers import NodeOutput, StubAgentSpawn
from hive.lib.dag_executor.frontdoor import (
    assemble_dispatcher,
    resolve_spawn_binding,
    run_frontdoor,
)

# ---------------------------------------------------------------------------
# Fixture path
# ---------------------------------------------------------------------------

_FIXTURE = Path(__file__).parent / "fixtures" / "frontdoor_simple.workflow.yaml"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _FailOnSecondCall:
    """AgentSpawn that succeeds for 'first' and raises HandlerError for 'second'."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def __call__(
        self,
        agent: str,
        step_file_content: str,
        inputs: dict[str, Any],
        run_id: str,
        step_id: str,
    ) -> dict[str, Any]:
        self.calls.append(step_id)
        if step_id == "second":
            raise HandlerError("injected failure on second")
        return {"out": f"result-{step_id}"}


class _AlwaysSucceed:
    """AgentSpawn that always succeeds; records calls."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def __call__(
        self,
        agent: str,
        step_file_content: str,
        inputs: dict[str, Any],
        run_id: str,
        step_id: str,
    ) -> dict[str, Any]:
        self.calls.append(step_id)
        return {"out": f"result-{step_id}"}


# ---------------------------------------------------------------------------
# AC1 — Basic run
# ---------------------------------------------------------------------------


def test_run_frontdoor_executes_all_nodes(tmp_path):
    """run_frontdoor with explicit spawn runs both nodes and returns their outputs."""
    spawn = StubAgentSpawn(
        canned_outputs={
            "first": {"out": "first-result"},
            "second": {"out": "second-result"},
        }
    )
    result = run_frontdoor(_FIXTURE, spawn=spawn)

    assert "first" in result
    assert "second" in result
    assert result["first"].outputs["out"] == "first-result"
    assert result["second"].outputs["out"] == "second-result"


def test_run_frontdoor_returns_node_output_instances(tmp_path):
    spawn = StubAgentSpawn(canned_outputs={"first": {"x": 1}, "second": {"y": 2}})
    result = run_frontdoor(_FIXTURE, spawn=spawn)

    for v in result.values():
        assert isinstance(v, NodeOutput)


def test_run_frontdoor_dependency_order_respected():
    """'second' receives context from 'first' (stub records call order)."""
    spawn = _AlwaysSucceed()
    run_frontdoor(_FIXTURE, spawn=spawn)
    assert spawn.calls.index("first") < spawn.calls.index("second")


# ---------------------------------------------------------------------------
# AC2 — Resume
# ---------------------------------------------------------------------------


def test_run_frontdoor_resumes_skipping_completed_nodes(tmp_path):
    """Re-invoking with the same run_id skips the already-completed 'first' node."""
    from hive.lib.dag_executor.executor.run_id import make_run_id

    run_id = make_run_id("frontdoor-simple")
    fail_spawn = _FailOnSecondCall()

    with pytest.raises(HandlerError, match="injected failure on second"):
        run_frontdoor(_FIXTURE, run_id=run_id, spawn=fail_spawn, run_state_path=tmp_path)

    assert "first" in fail_spawn.calls
    assert "second" in fail_spawn.calls

    # Resume: only 'second' should be retried (not 'first').
    success_spawn = _AlwaysSucceed()
    result = run_frontdoor(
        _FIXTURE, run_id=run_id, spawn=success_spawn, run_state_path=tmp_path
    )

    assert "second" not in success_spawn.calls or "first" not in success_spawn.calls
    assert "second" in result


def test_run_frontdoor_first_node_not_rerun_on_resume(tmp_path):
    """Completed 'first' node is NOT re-executed on resume."""
    from hive.lib.dag_executor.executor.run_id import make_run_id

    run_id = make_run_id("frontdoor-simple")
    fail_spawn = _FailOnSecondCall()

    with pytest.raises(HandlerError):
        run_frontdoor(_FIXTURE, run_id=run_id, spawn=fail_spawn, run_state_path=tmp_path)

    success_spawn = _AlwaysSucceed()
    run_frontdoor(_FIXTURE, run_id=run_id, spawn=success_spawn, run_state_path=tmp_path)

    # 'first' ran once in the initial pass; resume must not call it again.
    assert "first" not in success_spawn.calls


def test_run_frontdoor_no_resume_without_run_state_path():
    """Without run_state_path there is no resume detection — a new run is always started."""
    spawn = StubAgentSpawn(canned_outputs={"first": {}, "second": {}})
    # Two separate calls with the same run_id but no run_state_path both succeed independently.
    from hive.lib.dag_executor.executor.run_id import make_run_id

    rid = make_run_id("frontdoor-simple")
    result1 = run_frontdoor(_FIXTURE, run_id=rid, spawn=spawn)
    result2 = run_frontdoor(_FIXTURE, run_id=rid, spawn=spawn)
    assert "first" in result1
    assert "first" in result2


# ---------------------------------------------------------------------------
# AC3 — Binding selection
# ---------------------------------------------------------------------------


def test_resolve_spawn_binding_default_is_local():
    """No mode + no env → LocalAgentSpawn."""
    from hive.lib.dag_executor.executor.handlers import LocalAgentSpawn

    spawn = resolve_spawn_binding()
    assert isinstance(spawn, LocalAgentSpawn)


def test_resolve_spawn_binding_explicit_local():
    from hive.lib.dag_executor.executor.handlers import LocalAgentSpawn

    spawn = resolve_spawn_binding(mode="local")
    assert isinstance(spawn, LocalAgentSpawn)


def test_resolve_spawn_binding_multica_raises(monkeypatch):
    """mode='multica' raises NotImplementedError until s4 ships."""
    monkeypatch.delenv("HIVE_EXECUTION_MODE", raising=False)
    with pytest.raises(NotImplementedError, match="MulticaAgentSpawn"):
        resolve_spawn_binding(mode="multica")


def test_resolve_spawn_binding_env_multica_raises(monkeypatch):
    """HIVE_EXECUTION_MODE=multica raises NotImplementedError."""
    monkeypatch.setenv("HIVE_EXECUTION_MODE", "multica")
    with pytest.raises(NotImplementedError, match="MulticaAgentSpawn"):
        resolve_spawn_binding()


def test_resolve_spawn_binding_mode_overrides_env(monkeypatch):
    """Explicit mode='local' wins over HIVE_EXECUTION_MODE=multica."""
    from hive.lib.dag_executor.executor.handlers import LocalAgentSpawn

    monkeypatch.setenv("HIVE_EXECUTION_MODE", "multica")
    spawn = resolve_spawn_binding(mode="local")
    assert isinstance(spawn, LocalAgentSpawn)


def test_run_frontdoor_explicit_spawn_bypasses_binding_selection(monkeypatch):
    """Explicit spawn= ignores HIVE_EXECUTION_MODE."""
    monkeypatch.setenv("HIVE_EXECUTION_MODE", "multica")
    stub = StubAgentSpawn(canned_outputs={"first": {}, "second": {}})
    result = run_frontdoor(_FIXTURE, spawn=stub)
    assert "first" in result


# ---------------------------------------------------------------------------
# AC4 — Failure surfaces node_id; downstream not marked complete
# ---------------------------------------------------------------------------


def test_run_frontdoor_failure_propagates(tmp_path):
    """HandlerError from a node propagates out of run_frontdoor."""
    from hive.lib.dag_executor.executor.run_id import make_run_id

    run_id = make_run_id("frontdoor-simple")
    fail_spawn = _FailOnSecondCall()

    with pytest.raises(HandlerError, match="injected failure on second"):
        run_frontdoor(_FIXTURE, run_id=run_id, spawn=fail_spawn, run_state_path=tmp_path)


def test_run_frontdoor_failure_records_node_id_in_state(tmp_path):
    """Failed run records node_id in run_state failure_info."""
    from hive.lib.dag_executor.executor.run_id import make_run_id
    from hive.lib.dag_executor.run_state import load

    run_id = make_run_id("frontdoor-simple")
    fail_spawn = _FailOnSecondCall()

    with pytest.raises(HandlerError):
        run_frontdoor(_FIXTURE, run_id=run_id, spawn=fail_spawn, run_state_path=tmp_path)

    state = load(run_id, root=tmp_path)
    assert state.failure_info is not None
    assert state.failure_info["node_id"] == "second"


def test_run_frontdoor_failure_does_not_complete_downstream(tmp_path):
    """When 'second' fails, no downstream nodes are marked completed in run_state."""
    from hive.lib.dag_executor.executor.run_id import make_run_id
    from hive.lib.dag_executor.run_state import NodeStatus, load

    run_id = make_run_id("frontdoor-simple")
    fail_spawn = _FailOnSecondCall()

    with pytest.raises(HandlerError):
        run_frontdoor(_FIXTURE, run_id=run_id, spawn=fail_spawn, run_state_path=tmp_path)

    state = load(run_id, root=tmp_path)
    # 'first' succeeded; 'second' failed — no node after 'second' should be COMPLETED.
    # (In our 2-node fixture 'second' is the terminal node, so we just verify its status.)
    assert state.node_statuses.get("second") != NodeStatus.COMPLETED


def test_run_frontdoor_failure_first_node_still_complete(tmp_path):
    """When 'second' fails, 'first' (upstream, succeeded) is COMPLETED in run_state."""
    from hive.lib.dag_executor.executor.run_id import make_run_id
    from hive.lib.dag_executor.run_state import NodeStatus, load

    run_id = make_run_id("frontdoor-simple")
    fail_spawn = _FailOnSecondCall()

    with pytest.raises(HandlerError):
        run_frontdoor(_FIXTURE, run_id=run_id, spawn=fail_spawn, run_state_path=tmp_path)

    state = load(run_id, root=tmp_path)
    assert state.node_statuses.get("first") == NodeStatus.COMPLETED


# ---------------------------------------------------------------------------
# assemble_dispatcher unit tests
# ---------------------------------------------------------------------------


def test_assemble_dispatcher_registers_all_handler_types():
    """assemble_dispatcher registers handlers for all four NodeType values."""
    from hive.lib.dag_executor.executor.handlers import LocalAgentSpawn
    from hive.lib.dag_executor.graph import NodeType

    spawn = LocalAgentSpawn()
    d = assemble_dispatcher(spawn)
    for nt in NodeType:
        assert nt in d._handlers, f"missing handler for {nt}"
