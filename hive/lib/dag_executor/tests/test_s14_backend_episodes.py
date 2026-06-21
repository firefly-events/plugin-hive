"""s14-backend-episodes — unified resolver + episode markers + resume tests.

AC1: A single shared resolver (resolve_spawn_binding) selects the binding for
     all four flows. No per-flow copy of the logic. Config knob {flow}.mode
     is consulted after env.

AC2: Episode markers are written via emit_run_episode when a DAG flow completes.
     The episode_hook wiring in run() delivers the call.

AC3: Resume works per flow — interrupt mid-graph → re-run with same run_id
     resumes from run_state without re-running completed nodes.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.handlers import NodeOutput
from hive.lib.dag_executor.executor.run_id import make_run_id
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker
from hive.lib.dag_executor.graph.model import Graph, Node, NodeType
from hive.lib.dag_executor.run import _read_mode_knob, resolve_spawn_binding
from hive.lib.dag_executor.run_state import (
    NodeStatus,
    RunStatus,
    load,
    mark_failed,
    resume_run,
    save,
    set_last_successful_node,
    set_node_output,
    set_node_status,
)
from hive.lib.dag_executor.run_state.store import create


# ─────────────────────────── helpers ────────────────────────────────────────


def _linear_graph(workflow_name: str, node_count: int = 3) -> Graph:
    """Build a linear chain: n0 → n1 → … → n{count-1}."""
    nodes: dict[str, Node] = {}
    for i in range(node_count):
        nid = f"n{i}"
        deps = [f"n{i - 1}"] if i > 0 else []
        nodes[nid] = Node(id=nid, node_type=NodeType.AGENT, agent="developer", depends_on=deps)
    return Graph(workflow_name=workflow_name, nodes=nodes)


class _StubHandler:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def handle(self, node: Node, inputs: dict, run_id: str) -> NodeOutput:
        self.calls.append(node.id)
        return NodeOutput(outputs={"id": node.id})


class _FlakyHandler:
    """Fails on target node first call; succeeds thereafter."""

    def __init__(self, target: str) -> None:
        self.target = target
        self.failed_once = False
        self.calls: list[str] = []

    def handle(self, node: Node, inputs: dict, run_id: str) -> NodeOutput:
        self.calls.append(node.id)
        from hive.lib.dag_executor.executor.errors import HandlerError

        if node.id == self.target and not self.failed_once:
            self.failed_once = True
            raise HandlerError(f"injected failure at {node.id}")
        return NodeOutput(outputs={"id": node.id})


def _dispatcher(handler) -> Dispatcher:
    return Dispatcher(handlers={NodeType.AGENT: handler.handle})


# ═══════════════════════════════════════════════════════════════════════════
# AC1 — single shared resolver, config-knob reading
# ═══════════════════════════════════════════════════════════════════════════


def test_resolver_defaults_to_local():
    name, spawn = resolve_spawn_binding(env={})
    assert name == "local"
    from hive.lib.dag_executor.executor import LocalAgentSpawn

    assert isinstance(spawn, LocalAgentSpawn)


def test_resolver_env_overrides_default():
    name, _ = resolve_spawn_binding(env={"HIVE_EXECUTION_MODE": "local"})
    assert name == "local"


def test_resolver_explicit_binding_beats_env():
    name, _ = resolve_spawn_binding("local", env={"HIVE_EXECUTION_MODE": "multica"})
    assert name == "local"


def test_resolver_config_knob_fallback(tmp_path: Path):
    """When env is unset, {flow}.mode from config drives binding selection."""
    consumer_config = tmp_path / ".pHive" / "hive.config.yaml"
    consumer_config.parent.mkdir(parents=True)
    consumer_config.write_text(
        "execution:\n  mode: local\n",
        encoding="utf-8",
    )
    name, _ = resolve_spawn_binding(env={}, repo_root=tmp_path, flow="execution")
    assert name == "local"


def test_resolver_planning_mode_knob(tmp_path: Path):
    """planning.mode knob is consulted when flow='planning'."""
    consumer_config = tmp_path / ".pHive" / "hive.config.yaml"
    consumer_config.parent.mkdir(parents=True)
    consumer_config.write_text(
        "planning:\n  mode: local\n",
        encoding="utf-8",
    )
    name, _ = resolve_spawn_binding(env={}, repo_root=tmp_path, flow="planning")
    assert name == "local"


def test_resolver_env_beats_config_knob(tmp_path: Path):
    """HIVE_EXECUTION_MODE env takes precedence over config knob."""
    consumer_config = tmp_path / ".pHive" / "hive.config.yaml"
    consumer_config.parent.mkdir(parents=True)
    consumer_config.write_text(
        "execution:\n  mode: multica\n",
        encoding="utf-8",
    )
    name, _ = resolve_spawn_binding(env={"HIVE_EXECUTION_MODE": "local"}, repo_root=tmp_path)
    assert name == "local"


def test_read_mode_knob_absent_returns_none(tmp_path: Path):
    """_read_mode_knob returns None when config has no {flow}.mode."""
    config = tmp_path / ".pHive" / "hive.config.yaml"
    config.parent.mkdir(parents=True)
    config.write_text("executor: hive-dag\n", encoding="utf-8")
    assert _read_mode_knob(tmp_path, flow="execution") is None


def test_read_mode_knob_missing_config(tmp_path: Path):
    """_read_mode_knob returns None when config file is absent."""
    assert _read_mode_knob(tmp_path, flow="execution") is None


def test_read_mode_knob_malformed_config(tmp_path: Path):
    """_read_mode_knob returns None for YAML parse errors (fail-open to local)."""
    config = tmp_path / ".pHive" / "hive.config.yaml"
    config.parent.mkdir(parents=True)
    config.write_text(":: bad yaml ::\n", encoding="utf-8")
    assert _read_mode_knob(tmp_path, flow="execution") is None


def test_all_four_skills_reference_shared_resolver():
    """All four flow SKILL.md files must reference the shared resolver module."""
    repo_root = Path(__file__).resolve().parents[4]
    skills = {
        "plan": repo_root / "skills" / "hive" / "skills" / "planning-routing" / "SKILL.md",
        "execute": repo_root / "skills" / "execute" / "SKILL.md",
        "test": repo_root / "skills" / "test" / "SKILL.md",
        "review": repo_root / "skills" / "review" / "SKILL.md",
    }
    for flow_name, skill_path in skills.items():
        assert skill_path.exists(), f"{flow_name} SKILL.md not found at {skill_path}"
        text = skill_path.read_text(encoding="utf-8")
        assert "hive.lib.dag_executor.run" in text, (
            f"{flow_name} SKILL.md must reference hive.lib.dag_executor.run "
            f"(the shared resolver module) — no per-flow copy of binding logic"
        )


# ═══════════════════════════════════════════════════════════════════════════
# AC2 — episode markers written via episode_hook
# ═══════════════════════════════════════════════════════════════════════════


def _write_stub_workflow(tmp_path: Path, workflow_name: str) -> Path:
    """Write a minimal single-agent workflow YAML for testing run()."""
    wf_dir = tmp_path / "workflows"
    wf_dir.mkdir(exist_ok=True)
    wf_path = wf_dir / f"{workflow_name}.workflow.yaml"
    payload = {
        "name": workflow_name,
        "steps": [
            {"id": "step-a", "node_type": "agent", "agent": "developer"},
        ],
    }
    import yaml as _yaml

    wf_path.write_text(_yaml.safe_dump(payload), encoding="utf-8")
    return wf_path


def test_episode_hook_called_after_successful_run(tmp_path: Path):
    """episode_hook is invoked with correct args after run() completes."""
    from hive.lib.dag_executor.executor import StubAgentSpawn
    from hive.lib.dag_executor.run import run

    wf_path = _write_stub_workflow(tmp_path, "plan")
    stub = StubAgentSpawn(canned_outputs={"step-a": {"result": "ok"}})
    hook_calls: list[dict] = []

    def _hook(**kwargs):
        hook_calls.append(dict(kwargs))

    run(
        wf_path,
        spawn=stub,
        episode_hook=_hook,
        flow="plan",
    )
    assert hook_calls, "episode_hook was not called"
    call = hook_calls[0]
    assert call["flow"] == "plan"
    assert call["status"] == "completed"
    assert "run_id" in call
    assert "workflow" in call
    assert "outputs" in call


def test_emit_run_episode_writes_marker(tmp_path: Path):
    """emit_run_episode writes a dag-run.yaml with correct fields."""
    from hive.lib.dag_executor.episode import emit_run_episode

    rid = make_run_id("test-flow")
    outputs = {"n0": NodeOutput(outputs={"id": "n0"}), "n1": NodeOutput(outputs={"id": "n1"})}

    marker_path = emit_run_episode(
        run_id=rid,
        workflow="test-swarm",
        flow="test",
        status="completed",
        outputs=outputs,
        state_dir=tmp_path,
    )

    assert marker_path.exists()
    data = yaml.safe_load(marker_path.read_text(encoding="utf-8"))
    assert data["run_id"] == rid
    assert data["workflow"] == "test-swarm"
    assert data["flow"] == "test"
    assert data["status"] == "completed"
    assert sorted(data["completed_nodes"]) == ["n0", "n1"]
    assert data["emitted_at"]


@pytest.mark.parametrize("flow,workflow", [
    ("plan", "plan"),
    ("execution", "development.classic"),
    ("test", "test-swarm"),
    ("review", "review"),
])
def test_emit_run_episode_per_flow(tmp_path: Path, flow: str, workflow: str):
    """emit_run_episode can write markers for every flow without error."""
    from hive.lib.dag_executor.episode import emit_run_episode

    rid = make_run_id(workflow)
    marker_path = emit_run_episode(
        run_id=rid,
        workflow=workflow,
        flow=flow,
        status="completed",
        outputs={},
        state_dir=tmp_path,
    )
    assert marker_path.exists()
    data = yaml.safe_load(marker_path.read_text(encoding="utf-8"))
    assert data["flow"] == flow
    assert data["workflow"] == workflow


def test_episode_hook_receives_correct_flow_label(tmp_path: Path):
    """episode_hook's 'flow' matches the flow arg passed to run()."""
    from unittest.mock import MagicMock

    from hive.lib.dag_executor.executor import StubAgentSpawn
    from hive.lib.dag_executor.run import run

    wf_path = _write_stub_workflow(tmp_path, "plan")
    stub = StubAgentSpawn(canned_outputs={"step-a": {"result": "ok"}})
    hook = MagicMock()

    run(wf_path, spawn=stub, episode_hook=hook, flow="plan")

    hook.assert_called_once()
    _, kwargs = hook.call_args
    assert kwargs["flow"] == "plan"


# ═══════════════════════════════════════════════════════════════════════════
# AC3 — resume works across every flow
# ═══════════════════════════════════════════════════════════════════════════


@pytest.fixture
def runs_root(tmp_path: Path) -> Path:
    root = tmp_path / "runs"
    root.mkdir()
    return root


def _run_until_failure(
    workflow_name: str,
    fail_at: str,
    runs_root: Path,
) -> tuple[str, list[str], list[str]]:
    """Walk a linear graph, injecting failure at `fail_at` node.

    Returns (run_id, calls_before_failure, expected_replay_start).
    """
    graph = _linear_graph(workflow_name)
    rid = make_run_id(workflow_name)
    handler = _FlakyHandler(fail_at)
    dispatcher = _dispatcher(handler)
    telemetry = Telemetry(run_id=rid)

    state = create(rid, workflow_name)
    save(state, root=runs_root)

    # Walk; the flaky handler raises on `fail_at`, which propagates out.
    # We catch and mark failure so state is saved for resume.
    order = ["n0", "n1", "n2"]
    node_outputs: dict[str, NodeOutput] = {}

    for nid in order:
        node = graph.nodes[nid]
        try:
            out = dispatcher.dispatch(node, {}, rid)
        except Exception as exc:
            # Simulate Walker: record failure + freeze
            state = set_node_status(state, nid, NodeStatus.FAILED)
            if nid != "n0":
                prev = order[order.index(nid) - 1]
                state = set_last_successful_node(state, prev)
            from hive.lib.dag_executor.run_state.store import mark_failed as _mf

            state = _mf(state, {"node_id": nid, "message": str(exc)})
            save(state, root=runs_root)
            break
        node_outputs[nid] = out
        state = set_node_output(state, nid, dict(out.outputs))
        state = set_node_status(state, nid, NodeStatus.COMPLETED)
        state = set_last_successful_node(state, nid)
        save(state, root=runs_root)

    return rid, handler.calls, handler.calls[:]


@pytest.mark.parametrize("flow_name,workflow_name,fail_node", [
    ("plan", "plan", "n1"),
    ("execution", "development.classic", "n1"),
    ("test", "test-swarm", "n1"),
    ("review", "review", "n1"),
])
def test_resume_skips_completed_nodes(
    runs_root: Path,
    flow_name: str,
    workflow_name: str,
    fail_node: str,
):
    """For each flow, resume replays from failure point without re-running completed nodes."""
    graph = _linear_graph(workflow_name)
    rid = make_run_id(workflow_name)

    # ── Step 1: initial run up to failure at n1 ──
    handler = _FlakyHandler(fail_node)
    dispatcher = _dispatcher(handler)
    telemetry = Telemetry(run_id=rid)

    state = create(rid, workflow_name)
    # Walk n0 (succeeds)
    n0_out = dispatcher.dispatch(graph.nodes["n0"], {}, rid)
    state = set_node_output(state, "n0", dict(n0_out.outputs))
    state = set_node_status(state, "n0", NodeStatus.COMPLETED)
    state = set_last_successful_node(state, "n0")
    save(state, root=runs_root)

    # Walk n1 (fails)
    try:
        dispatcher.dispatch(graph.nodes["n1"], {}, rid)
    except Exception as exc:
        state = set_node_status(state, "n1", NodeStatus.FAILED)
        from hive.lib.dag_executor.run_state.store import mark_failed as _mf

        state = _mf(state, {"node_id": "n1", "message": str(exc)})
        save(state, root=runs_root)

    first_pass_calls = list(handler.calls)  # ["n0", "n1"]

    # ── Step 2: resume ──
    resume_handler = _StubHandler()
    resume_dispatcher = _dispatcher(resume_handler)
    resume_telemetry = Telemetry(run_id=rid)

    final_state = resume_run(
        rid,
        graph,
        Walker(),
        resume_dispatcher,
        resume_telemetry,
        runs_root=runs_root,
    )

    # n0 must NOT be re-executed (it was already completed)
    assert "n0" not in resume_handler.calls, (
        f"[{flow_name}] n0 was already completed; resume must not re-execute it"
    )
    # n1 and n2 must have run in the replay
    assert "n1" in resume_handler.calls, (
        f"[{flow_name}] n1 (failed node) must be re-executed in resume"
    )
    assert "n2" in resume_handler.calls, (
        f"[{flow_name}] n2 must execute after successful resume of n1"
    )
    # Final state must be COMPLETED
    assert final_state.status == RunStatus.COMPLETED, (
        f"[{flow_name}] final run state must be COMPLETED after successful resume"
    )


def test_resume_already_completed_raises(runs_root: Path):
    """resume_run on a completed run raises AlreadyCompletedError."""
    from hive.lib.dag_executor.run_state import AlreadyCompletedError
    from hive.lib.dag_executor.run_state.store import mark_completed

    rid = make_run_id("plan")
    state = create(rid, "plan")
    state = mark_completed(state)
    save(state, root=runs_root)

    graph = _linear_graph("plan")
    handler = _StubHandler()
    dispatcher = _dispatcher(handler)
    telemetry = Telemetry(run_id=rid)

    with pytest.raises(AlreadyCompletedError):
        resume_run(rid, graph, Walker(), dispatcher, telemetry, runs_root=runs_root)

    # Completed run must not have been touched
    assert not handler.calls


def test_resume_workflow_slug_mismatch_raises(runs_root: Path):
    """resume_run rejects a graph whose workflow name differs from stored slug."""
    from hive.lib.dag_executor.run_state import ResumeFromInvalidStateError
    from hive.lib.dag_executor.run_state.store import mark_failed

    rid = make_run_id("plan")
    state = create(rid, "plan")
    state = mark_failed(state, {"message": "forced"})
    save(state, root=runs_root)

    # Try resuming with a different graph
    graph = _linear_graph("development.classic")
    handler = _StubHandler()
    dispatcher = _dispatcher(handler)
    telemetry = Telemetry(run_id=rid)

    with pytest.raises(ResumeFromInvalidStateError):
        resume_run(rid, graph, Walker(), dispatcher, telemetry, runs_root=runs_root)
