"""Runtime tests for the 4 VERIFIED blocker findings from the Codex cross-LLM review.

C1 — reconcile metadata wired end-to-end for Multica path.
C2 — Walker bounded retry actually executes re-dispatch.
C3 — Gate schema-validates committed artifacts (not just presence).
C4 — Per-flow env var (HIVE_{FLOW}_MODE) resolves correctly.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.errors import GateFailedError, HandlerError
from hive.lib.dag_executor.executor.handlers import NodeOutput
from hive.lib.dag_executor.executor.handlers.gate import GateHandler
from hive.lib.dag_executor.executor.handlers.reconcile import ReconcileHandler
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker
from hive.lib.dag_executor.graph import ConditionalEdge, Graph, Node, NodeType
from hive.lib.dag_executor.run import resolve_spawn_binding


# ── helpers ─────────────────────────────────────────────────────────────────

def _reconcile_node(node_id: str = "reconcile-1") -> Node:
    return Node(id=node_id, agent="", node_type=NodeType.RECONCILE)


def _make_reconcile_handler(tmp_path) -> ReconcileHandler:
    cli = tmp_path / "cli.mjs"
    return ReconcileHandler(cli_path=cli)


def _ok_result(data: dict | None = None) -> SimpleNamespace:
    payload = data or {"merged": True, "sha": "abc123", "output": "Fast-forward\n"}
    return SimpleNamespace(stdout=json.dumps(payload), stderr="", returncode=0)


def _agent_node(node_id: str, depends_on: list[str] | None = None, **kw) -> Node:
    return Node(
        id=node_id,
        agent="developer",
        node_type=NodeType.AGENT,
        depends_on=depends_on or [],
        **kw,
    )


def _graph_with(nodes: list[Node]) -> Graph:
    edges = [
        ConditionalEdge(from_node_id=p, to_node_id=n.id)
        for n in nodes
        for p in n.depends_on
    ]
    return Graph(workflow_name="test", nodes={n.id: n for n in nodes}, edges=edges)


# ── C1: MulticaAgentSpawn emits commit_sha + branch + repo ──────────────────

class TestC1MulticaReconcileWire:
    """C1 runtime: MulticaAgentSpawn emits full reconcile contract."""

    def test_multica_spawn_emits_commit_sha_alias(self, tmp_path):
        """MulticaAgentSpawn must return commit_sha as alias for code_push_sha."""
        from hive.lib.dag_executor.executor.handlers.agent import MulticaAgentSpawn

        spawn = MulticaAgentSpawn(cli_path=tmp_path / "cli.mjs", repo_root=tmp_path)

        terminal = {
            "status": "completed",
            "code_push_sha": "deadbeef",
            "branch": "feat/my-branch",
            "repo": "git@github.com:org/repo.git",
            "work_dir": "/some/work",
        }

        with (
            patch.object(spawn, "_resolve_tracker_id", return_value="tracker-1"),
            patch.object(spawn, "_dispatch", return_value=None),
            patch.object(spawn, "_poll", return_value=terminal),
        ):
            result = spawn(
                agent="developer",
                step_file_content="",
                inputs={},
                run_id="run-1",
                step_id="author",
            )

        assert result["commit_sha"] == "deadbeef", "commit_sha must alias code_push_sha"
        assert result["branch"] == "feat/my-branch"
        assert result["repo"] == "git@github.com:org/repo.git"
        assert result["work_dir"] == "/some/work"

    def test_reconcile_receives_branch_and_repo_from_spawn_output(self, tmp_path):
        """Reconcile handler invoked with branch + repo from MulticaAgentSpawn outputs."""
        handler = _make_reconcile_handler(tmp_path)
        inputs = {
            "sha": "abc123",
            "branch": "feat/my-branch",
            "repo": "git@github.com:org/repo.git",
            "work_dir": "/work",
        }
        with patch("subprocess.run", return_value=_ok_result()) as mock_run:
            out = handler.handle(_reconcile_node(), inputs=inputs, run_id="run-x")

        cmd = mock_run.call_args[0][0]
        assert "--branch" in cmd
        assert cmd[cmd.index("--branch") + 1] == "feat/my-branch"
        assert "--repo" in cmd
        assert cmd[cmd.index("--repo") + 1] == "git@github.com:org/repo.git"
        assert "--sha" in cmd
        assert cmd[cmd.index("--sha") + 1] == "abc123"
        assert out.outputs.get("merged") is True

    def test_reconcile_noop_when_commit_sha_none(self, tmp_path):
        """Local path: commit_sha=None (MulticaAgentSpawn returns None for sha) → no-op."""
        handler = _make_reconcile_handler(tmp_path)
        # Simulate what happens when the spawn returns commit_sha=None (local run)
        out = handler.handle(
            _reconcile_node(),
            inputs={"sha": None, "branch": "feat/x", "repo": "r"},
            run_id="run-local",
        )
        assert out.meta.get("reconcile") == "noop"

    def test_reconcile_raises_loud_when_branch_missing_with_sha(self, tmp_path):
        """sha present but branch absent → ReconcileHandlerError (not a silent no-op)."""
        from hive.lib.dag_executor.executor.errors import ReconcileHandlerError

        handler = _make_reconcile_handler(tmp_path)
        with pytest.raises(ReconcileHandlerError, match="branch"):
            handler.handle(
                _reconcile_node(),
                inputs={"sha": "abc123", "repo": "git@github.com:org/repo.git"},
                run_id="run-nb",
            )

    def test_gate_runs_after_real_reconcile(self, tmp_path):
        """Gate receives merged outputs only after reconcile ff-merges (R5 invariant)."""
        handler = _make_reconcile_handler(tmp_path)
        inputs = {
            "sha": "abc123",
            "branch": "feat/x",
            "repo": "git@github.com:org/repo.git",
        }
        merged_payload = {"merged": True, "sha": "abc123", "output": "Fast-forward\n"}
        with patch("subprocess.run", return_value=_ok_result(merged_payload)):
            reconcile_out = handler.handle(_reconcile_node(), inputs=inputs, run_id="r1")

        assert reconcile_out.outputs["merged"] is True

        gate_node = Node(id="gate-1", agent="", node_type=NodeType.GATE, gate="sha must not be empty")
        gate_out = GateHandler().handle(gate_node, inputs=dict(reconcile_out.outputs), run_id="r1")
        assert gate_out.outputs["gate_passed"] is True


# ── C2: Walker bounded retry ─────────────────────────────────────────────────

class TestC2WalkerRetry:
    """C2 runtime: Walker re-dispatches node up to retry.max_attempts."""

    def _stub_dispatcher(self, fail_n_times: int, node_id: str = "a") -> tuple[Dispatcher, list]:
        calls: list[int] = []

        def handler(node, inputs, run_id):
            call_num = len(calls) + 1
            calls.append(call_num)
            if len(calls) <= fail_n_times:
                raise HandlerError(f"attempt {len(calls)} failed")
            return NodeOutput(outputs={"result": "ok"})

        return Dispatcher(handlers={NodeType.AGENT: handler}), calls

    def test_node_succeeds_after_two_failures_with_max_attempts_3(self):
        """Node fails twice then succeeds → run completes, 3 total dispatches."""
        dispatcher, calls = self._stub_dispatcher(fail_n_times=2)
        tel = Telemetry(run_id="run-1")
        node = _agent_node("a", retry={"max_attempts": 3})
        graph = _graph_with([node])

        result = Walker().walk(graph, dispatcher, "run-1", tel, context={})

        assert result["a"].outputs == {"result": "ok"}
        assert len(calls) == 3, f"expected 3 attempts, got {len(calls)}"

        retry_events = [e for e in tel.events if e["event_type"] == "node_retry"]
        assert len(retry_events) == 2, "must emit one node_retry event per retry attempt"
        for ev in retry_events:
            assert ev["payload"]["max_attempts"] == 3

    def test_node_exhausts_max_attempts_and_fails(self):
        """Node always fails with max_attempts: 2 → exactly 2 attempts, run fails."""
        calls: list[int] = []

        def always_fail(node, inputs, run_id):
            calls.append(len(calls) + 1)
            raise HandlerError("always fails")

        dispatcher = Dispatcher(handlers={NodeType.AGENT: always_fail})
        node = _agent_node("a", retry={"max_attempts": 2})
        graph = _graph_with([node])

        with pytest.raises(HandlerError, match="always fails"):
            Walker().walk(graph, dispatcher, "run-2", Telemetry(run_id="run-2"), context={})

        assert len(calls) == 2, f"expected exactly 2 attempts, got {len(calls)}"

    def test_retry_telemetry_events_carry_attempt_and_error(self):
        """node_retry events must carry attempt number, max_attempts, and error string."""
        dispatcher, _ = self._stub_dispatcher(fail_n_times=1)
        tel = Telemetry(run_id="run-3")
        node = _agent_node("a", retry={"max_attempts": 2})
        graph = _graph_with([node])

        Walker().walk(graph, dispatcher, "run-3", tel, context={})

        retry_events = [e for e in tel.events if e["event_type"] == "node_retry"]
        assert len(retry_events) == 1
        payload = retry_events[0]["payload"]
        assert payload["attempt"] == 1
        assert payload["max_attempts"] == 2
        assert "failed" in payload["error"]

    def test_no_retry_without_retry_field(self):
        """Nodes without retry field: exactly 1 attempt, failure propagates."""
        calls: list[int] = []

        def always_fail(node, inputs, run_id):
            calls.append(1)
            raise HandlerError("fail")

        dispatcher = Dispatcher(handlers={NodeType.AGENT: always_fail})
        node = _agent_node("a")  # no retry field
        graph = _graph_with([node])

        with pytest.raises(HandlerError):
            Walker().walk(graph, dispatcher, "run-4", Telemetry(run_id="run-4"), context={})

        assert calls == [1], "must not retry without retry field"

    def test_retry_in_parallel_wave(self):
        """Retry also works when nodes are dispatched in a parallel wave."""
        calls_a: list[int] = []
        calls_b: list[int] = []

        def handler(node, inputs, run_id):
            if node.id == "a":
                calls_a.append(len(calls_a) + 1)
                if len(calls_a) == 1:
                    raise HandlerError("a fails on first attempt")
                return NodeOutput(outputs={"x": "from-a"})
            calls_b.append(len(calls_b) + 1)
            return NodeOutput(outputs={"y": "from-b"})

        dispatcher = Dispatcher(handlers={NodeType.AGENT: handler})
        # a and b both depend on nothing → parallel wave
        a = _agent_node("a", retry={"max_attempts": 2})
        b = _agent_node("b")
        graph = _graph_with([a, b])

        result = Walker().walk(graph, dispatcher, "run-5", Telemetry(run_id="run-5"), context={})

        assert result["a"].outputs == {"x": "from-a"}
        assert len(calls_a) == 2
        assert result["b"].outputs == {"y": "from-b"}


# ── C3: Gate schema validation ───────────────────────────────────────────────

class TestC3GateSchemaValidation:
    """C3 runtime: Gate 'must be valid plan-epic' triggers actual schema check."""

    def _gate_node(self, predicate: str) -> Node:
        return Node(id="gate-1", agent="", node_type=NodeType.GATE, gate=predicate)

    def test_presence_check_still_works(self):
        """Backward compat: 'must not be empty' still passes for non-empty values."""
        node = self._gate_node("epic_dir must not be empty")
        out = GateHandler().handle(node, inputs={"epic_dir": ".pHive/epics/abc"}, run_id="r")
        assert out.outputs["gate_passed"] is True

    def test_schema_valid_predicate_passes_for_valid_epic(self, tmp_path):
        """'must be valid plan-epic' passes when epic dir conforms to schema."""
        from hive.lib.dag_executor.validate_output import validate_plan_output

        epic_dir = tmp_path / "epics" / "epic-1"
        stories_dir = epic_dir / "stories"
        stories_dir.mkdir(parents=True)
        (epic_dir / "epic.yaml").write_text(
            "name: My Epic\nstories:\n  - id: s1\n    title: Story 1\n",
            encoding="utf-8",
        )
        (stories_dir / "s1.yaml").write_text(
            "id: s1\ntitle: Story 1\nacceptance_criteria:\n  - works\nsteps:\n  - do it\n",
            encoding="utf-8",
        )

        node = self._gate_node("epic_dir must be valid plan-epic")
        out = GateHandler().handle(node, inputs={"epic_dir": str(epic_dir)}, run_id="r")
        assert out.outputs["gate_passed"] is True

    def test_schema_valid_predicate_fails_for_invalid_epic(self, tmp_path):
        """'must be valid plan-epic' FAILS for non-empty but schema-invalid epic."""
        epic_dir = tmp_path / "epics" / "epic-bad"
        epic_dir.mkdir(parents=True)
        # epic.yaml exists but missing required 'name' field and has no stories
        (epic_dir / "epic.yaml").write_text("description: oops\n", encoding="utf-8")

        node = self._gate_node("epic_dir must be valid plan-epic")
        with pytest.raises(GateFailedError, match="schema validation"):
            GateHandler().handle(node, inputs={"epic_dir": str(epic_dir)}, run_id="r")

    def test_schema_valid_predicate_fails_for_missing_story_file(self, tmp_path):
        """'must be valid plan-epic' fails when a declared story file is missing."""
        epic_dir = tmp_path / "epics" / "epic-missing"
        epic_dir.mkdir(parents=True)
        (epic_dir / "epic.yaml").write_text(
            "name: Epic\nstories:\n  - id: s99\n    title: Missing Story\n",
            encoding="utf-8",
        )
        # No stories/s99.yaml created

        node = self._gate_node("epic_dir must be valid plan-epic")
        with pytest.raises(GateFailedError, match="schema validation"):
            GateHandler().handle(node, inputs={"epic_dir": str(epic_dir)}, run_id="r")

    def test_empty_epic_dir_fails_with_schema_valid_predicate(self, tmp_path):
        """Empty epic_dir value fails fast (no file to validate)."""
        node = self._gate_node("epic_dir must be valid plan-epic")
        with pytest.raises(GateFailedError, match="empty"):
            GateHandler().handle(node, inputs={"epic_dir": ""}, run_id="r")


# ── C4: Per-flow env resolver ────────────────────────────────────────────────

class TestC4PerFlowEnvResolver:
    """C4 runtime: HIVE_{FLOW}_MODE takes precedence over HIVE_EXECUTION_MODE."""

    def test_hive_planning_mode_routes_multica_for_plan_flow(self, tmp_path):
        """HIVE_PLANNING_MODE=multica with flow='planning' resolves multica."""
        name, _ = resolve_spawn_binding(
            None,
            env={"HIVE_PLANNING_MODE": "multica"},
            repo_root=tmp_path,
            flow="planning",
        )
        assert name == "multica"

    def test_hive_planning_mode_does_not_affect_execution_flow(self, tmp_path):
        """HIVE_PLANNING_MODE=multica with flow='execution' falls through to local."""
        name, _ = resolve_spawn_binding(
            None,
            env={"HIVE_PLANNING_MODE": "multica"},
            repo_root=tmp_path,
            flow="execution",
        )
        assert name == "local"

    def test_per_flow_beats_global_execution_mode(self, tmp_path):
        """HIVE_PLANNING_MODE beats HIVE_EXECUTION_MODE for flow='planning'."""
        name, _ = resolve_spawn_binding(
            None,
            env={
                "HIVE_PLANNING_MODE": "local",
                "HIVE_EXECUTION_MODE": "multica",
            },
            repo_root=tmp_path,
            flow="planning",
        )
        assert name == "local"

    def test_global_execution_mode_fallback_when_no_per_flow(self, tmp_path):
        """HIVE_EXECUTION_MODE applies for plan flow when no per-flow var is set."""
        name, _ = resolve_spawn_binding(
            None,
            env={"HIVE_EXECUTION_MODE": "multica"},
            repo_root=tmp_path,
            flow="planning",
        )
        assert name == "multica"

    def test_explicit_arg_beats_per_flow_env(self, tmp_path):
        """Explicit binding arg always wins over any env var."""
        name, _ = resolve_spawn_binding(
            "local",
            env={"HIVE_PLANNING_MODE": "multica", "HIVE_EXECUTION_MODE": "multica"},
            repo_root=tmp_path,
            flow="planning",
        )
        assert name == "local"

    def test_config_knob_fallback_when_no_env(self, tmp_path):
        """Config knob is consulted when per-flow env and HIVE_EXECUTION_MODE are both unset."""
        config = tmp_path / ".pHive" / "hive.config.yaml"
        config.parent.mkdir(parents=True)
        config.write_text("planning:\n  mode: multica\n", encoding="utf-8")

        name, _ = resolve_spawn_binding(
            None,
            env={},
            repo_root=tmp_path,
            flow="planning",
        )
        assert name == "multica"

    def test_precedence_full_chain(self, tmp_path):
        """Full precedence: explicit > per-flow env > HIVE_EXECUTION_MODE > config > local."""
        config = tmp_path / ".pHive" / "hive.config.yaml"
        config.parent.mkdir(parents=True)
        config.write_text("planning:\n  mode: multica\n", encoding="utf-8")

        # Without explicit arg: per-flow wins
        name, _ = resolve_spawn_binding(
            None,
            env={"HIVE_PLANNING_MODE": "local", "HIVE_EXECUTION_MODE": "multica"},
            repo_root=tmp_path,
            flow="planning",
        )
        assert name == "local", "per-flow env must beat HIVE_EXECUTION_MODE"

        # Without per-flow env: HIVE_EXECUTION_MODE wins over config
        name, _ = resolve_spawn_binding(
            None,
            env={"HIVE_EXECUTION_MODE": "local"},
            repo_root=tmp_path,
            flow="planning",
        )
        assert name == "local", "HIVE_EXECUTION_MODE must beat config knob"

        # Without any env: config knob wins over default local
        name, _ = resolve_spawn_binding(
            None,
            env={},
            repo_root=tmp_path,
            flow="planning",
        )
        assert name == "multica", "config knob must beat default local"
