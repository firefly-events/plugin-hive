"""s7 — ReconcileHandler unit tests.

Acceptance criteria:
  AC1: Given branch + sha inputs, handler invokes cli.mjs reconcile and
       ff-merges; downstream gate sees committed files.
  AC2: Given no sha (local binding), handler is a clean no-op.
  AC3: Given non-ff or missing sha (after fetch), handler fails loud.
  AC4: Dispatcher routes NodeType.RECONCILE to ReconcileHandler without
       touching AgentHandler or GateHandler.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.errors import ReconcileHandlerError
from hive.lib.dag_executor.executor.handlers.reconcile import ReconcileHandler
from hive.lib.dag_executor.graph import Node, NodeType


# ── helpers ────────────────────────────────────────────────────────────────────

def _reconcile_node(node_id: str = "reconcile-1") -> Node:
    return Node(id=node_id, agent="", node_type=NodeType.RECONCILE)


def _make_handler(tmp_path=None) -> ReconcileHandler:
    from pathlib import Path
    cli = (tmp_path / "cli.mjs") if tmp_path else Path("/fake/cli.mjs")
    return ReconcileHandler(cli_path=cli)


def _ok_result(data: dict | None = None) -> SimpleNamespace:
    payload = data or {"merged": True, "sha": "abc123", "output": "Fast-forward\n"}
    return SimpleNamespace(stdout=json.dumps(payload), stderr="", returncode=0)


def _fail_result(stderr: str = "NON_FF: fast-forward merge failed") -> SimpleNamespace:
    return SimpleNamespace(stdout="", stderr=stderr, returncode=1)


# ── AC2: local no-op ───────────────────────────────────────────────────────────

def test_local_noop_when_sha_absent(tmp_path):
    handler = _make_handler(tmp_path)
    out = handler.handle(_reconcile_node(), inputs={}, run_id="run-1")
    assert out.outputs == {}
    assert out.meta.get("reconcile") == "noop"


def test_local_noop_when_sha_empty_string(tmp_path):
    handler = _make_handler(tmp_path)
    out = handler.handle(_reconcile_node(), inputs={"sha": ""}, run_id="run-1")
    assert out.outputs == {}
    assert out.meta.get("reconcile") == "noop"


def test_local_noop_when_sha_none(tmp_path):
    handler = _make_handler(tmp_path)
    out = handler.handle(_reconcile_node(), inputs={"sha": None}, run_id="run-1")
    assert out.outputs == {}
    assert out.meta.get("reconcile") == "noop"


# ── AC1: ff-merge materialises files ──────────────────────────────────────────

def test_ff_merge_invokes_cli_with_correct_args(tmp_path):
    handler = _make_handler(tmp_path)
    inputs = {
        "sha": "abc123",
        "branch": "agent/dev/branch",
        "repo": "git@github.com:org/repo.git",
    }
    with patch("subprocess.run", return_value=_ok_result()) as mock_run:
        out = handler.handle(_reconcile_node(), inputs=inputs, run_id="run-x")

    cmd = mock_run.call_args[0][0]
    assert "reconcile" in cmd
    assert "--repo" in cmd
    repo_idx = cmd.index("--repo") + 1
    assert cmd[repo_idx] == "git@github.com:org/repo.git"
    assert "--branch" in cmd
    branch_idx = cmd.index("--branch") + 1
    assert cmd[branch_idx] == "agent/dev/branch"
    assert "--sha" in cmd
    sha_idx = cmd.index("--sha") + 1
    assert cmd[sha_idx] == "abc123"

    assert out.outputs["merged"] is True
    assert out.outputs["sha"] == "abc123"


def test_ff_merge_passes_work_dir_when_provided(tmp_path):
    handler = _make_handler(tmp_path)
    inputs = {
        "sha": "deadbeef",
        "branch": "agent/xyz",
        "repo": "git@github.com:org/repo.git",
        "work_dir": "/some/work/dir",
    }
    with patch("subprocess.run", return_value=_ok_result()) as mock_run:
        handler.handle(_reconcile_node(), inputs=inputs, run_id="run-y")

    cmd = mock_run.call_args[0][0]
    assert "--work-dir" in cmd
    wd_idx = cmd.index("--work-dir") + 1
    assert cmd[wd_idx] == "/some/work/dir"


def test_ff_merge_omits_work_dir_when_absent(tmp_path):
    handler = _make_handler(tmp_path)
    inputs = {
        "sha": "deadbeef",
        "branch": "agent/xyz",
        "repo": "git@github.com:org/repo.git",
    }
    with patch("subprocess.run", return_value=_ok_result()) as mock_run:
        handler.handle(_reconcile_node(), inputs=inputs, run_id="run-z")

    cmd = mock_run.call_args[0][0]
    assert "--work-dir" not in cmd


# ── AC3: non-ff / missing sha fails loud ──────────────────────────────────────

def test_non_ff_merge_raises_reconcile_handler_error(tmp_path):
    handler = _make_handler(tmp_path)
    inputs = {
        "sha": "cafebabe",
        "branch": "agent/dev",
        "repo": "git@github.com:org/repo.git",
    }
    with patch("subprocess.run", return_value=_fail_result("NON_FF: diverged")):
        with pytest.raises(ReconcileHandlerError, match="failed"):
            handler.handle(_reconcile_node(), inputs=inputs, run_id="run-ff")


def test_missing_branch_with_sha_raises(tmp_path):
    handler = _make_handler(tmp_path)
    with pytest.raises(ReconcileHandlerError, match="branch"):
        handler.handle(
            _reconcile_node(),
            inputs={"sha": "abc123", "repo": "git@github.com:org/repo.git"},
            run_id="run-nb",
        )


def test_missing_repo_with_sha_raises(tmp_path):
    handler = _make_handler(tmp_path)
    with pytest.raises(ReconcileHandlerError, match="repo"):
        handler.handle(
            _reconcile_node(),
            inputs={"sha": "abc123", "branch": "agent/dev"},
            run_id="run-nr",
        )


def test_cli_non_json_stdout_raises(tmp_path):
    handler = _make_handler(tmp_path)
    inputs = {"sha": "abc123", "branch": "b", "repo": "r"}
    bad = SimpleNamespace(stdout="not json", stderr="", returncode=0)
    with patch("subprocess.run", return_value=bad):
        with pytest.raises(ReconcileHandlerError, match="non-JSON"):
            handler.handle(_reconcile_node(), inputs=inputs, run_id="run-bad")


def test_cli_non_dict_json_raises(tmp_path):
    handler = _make_handler(tmp_path)
    inputs = {"sha": "abc123", "branch": "b", "repo": "r"}
    bad = SimpleNamespace(stdout=json.dumps([1, 2, 3]), stderr="", returncode=0)
    with patch("subprocess.run", return_value=bad):
        with pytest.raises(ReconcileHandlerError, match="non-dict"):
            handler.handle(_reconcile_node(), inputs=inputs, run_id="run-nd")


def test_timeout_raises_reconcile_handler_error(tmp_path):
    import subprocess as sp
    handler = _make_handler(tmp_path)
    inputs = {"sha": "abc123", "branch": "b", "repo": "r"}
    with patch("subprocess.run", side_effect=sp.TimeoutExpired(cmd="node", timeout=0.1)):
        with pytest.raises(ReconcileHandlerError, match="timed out"):
            handler.handle(_reconcile_node(), inputs=inputs, run_id="run-to")


# ── AC4: dispatcher routes RECONCILE without touching AgentHandler/GateHandler ─

def test_dispatcher_routes_reconcile_node():
    d = Dispatcher()
    inputs = {}  # no sha → no-op path, no subprocess needed
    out = d.dispatch(_reconcile_node(), inputs=inputs, run_id="disp-1")
    assert out.meta.get("reconcile") == "noop"


def test_dispatcher_reconcile_does_not_affect_agent_handler():
    """Registering AgentHandler and then dispatching a reconcile node must not
    invoke the agent handler at all."""
    from hive.lib.dag_executor.executor.handlers import AgentHandler, StubAgentSpawn

    spy = StubAgentSpawn(canned_outputs={"agent-n": {"result": "oops"}})
    d = Dispatcher()
    d.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)

    # Dispatch reconcile — spy must never be called
    d.dispatch(_reconcile_node(), inputs={}, run_id="disp-2")
    assert spy.calls == [], "AgentHandler must not be invoked for a reconcile node"


def test_dispatcher_reconcile_does_not_affect_gate_handler():
    """Dispatching a reconcile node must not invoke GateHandler."""
    from hive.lib.dag_executor.executor.handlers import GateHandler

    gate_calls: list = []
    original_handle = GateHandler().handle

    def spy_gate(node, inputs, run_id):
        gate_calls.append(node.id)
        return original_handle(node, inputs, run_id)

    d = Dispatcher(handlers={NodeType.GATE: spy_gate})
    d.dispatch(_reconcile_node(), inputs={}, run_id="disp-3")
    assert gate_calls == [], "GateHandler must not be invoked for a reconcile node"


# ── Gate-after-reconcile sees committed files (integration shape) ──────────────

def test_gate_after_reconcile_receives_merged_outputs(tmp_path):
    """Simulates the agent → reconcile → gate sequence at the handler level.

    The reconcile node's outputs (merged, sha) are made available as
    inputs to the gate, proving the pipeline wiring works end-to-end
    without a real subprocess.
    """
    from hive.lib.dag_executor.executor.handlers.gate import GateHandler
    from hive.lib.dag_executor.graph import Node, NodeType

    reconcile_handler = _make_handler(tmp_path)
    reconcile_inputs = {
        "sha": "abc123",
        "branch": "agent/dev",
        "repo": "git@github.com:org/repo.git",
    }
    merged_payload = {"merged": True, "sha": "abc123", "output": "Fast-forward\n"}

    with patch("subprocess.run", return_value=_ok_result(merged_payload)):
        reconcile_out = reconcile_handler.handle(
            _reconcile_node(), inputs=reconcile_inputs, run_id="seq-1"
        )

    # Gate sees reconcile outputs — confirm sha flowed through
    assert reconcile_out.outputs["merged"] is True
    assert reconcile_out.outputs["sha"] == "abc123"

    # Gate node uses the reconcile output — "sha must not be empty" confirms
    # the merged sha flowed through to the gate's input context.
    gate_node = Node(
        id="gate-1",
        agent="",
        node_type=NodeType.GATE,
        gate="sha must not be empty",
    )
    gate_inputs = dict(reconcile_out.outputs)
    gate_out = GateHandler().handle(gate_node, inputs=gate_inputs, run_id="seq-1")
    assert gate_out.outputs.get("gate_passed") is True
