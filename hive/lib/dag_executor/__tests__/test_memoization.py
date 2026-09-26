"""b-contract-derived-dag b2 — reconcile-on-drift memoization.

Covers the b2 acceptance criteria against the production Walker:
  * cache HIT (hash matches prior success) → node skipped, output reused;
  * cache MISS (inputs changed) → node runs normally;
  * a memoized skip records status=REUSED in RunState (never absent);
  * schema_version 0 (old) migrates to 1 and stays readable on load;
  * b2 flag OFF → node runs even when inputs are unchanged (inert);
  * replay reloads a REUSED node (does not break the replay path);
  * the memo hash covers ALL three drift dimensions (resolved inputs +
    node config + workflow/skill version) — the load-bearing invariant.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.errors import HandlerError
from hive.lib.dag_executor.executor.handlers import NodeOutput
from hive.lib.dag_executor.executor.run_id import make_run_id
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker, _compute_memo_hash
from hive.lib.dag_executor.graph import Graph, InputBinding, Node, NodeType
from hive.lib.dag_executor.run_state import NodeStatus, load


# ─────────────────────────── helpers ────────────────────────────────────────


def _node(node_id: str, inputs: list[InputBinding] | None = None, **kw) -> Node:
    return Node(
        id=node_id,
        agent="developer",
        node_type=NodeType.AGENT,
        inputs=inputs or [],
        **kw,
    )


def _graph(nodes: list[Node], version: str | None = "1") -> Graph:
    return Graph(
        workflow_name="memo-test",
        version=version,
        nodes={n.id: n for n in nodes},
    )


class _CountingDispatcher:
    """Wraps Dispatcher; records which node ids were actually dispatched."""

    def __init__(self, outputs_by_id: dict[str, dict]):
        self.calls: list[str] = []

        def handler(node, inputs, run_id):
            self.calls.append(node.id)
            return NodeOutput(outputs=dict(outputs_by_id.get(node.id, {})))

        self.dispatcher = Dispatcher(handlers={NodeType.AGENT: handler})


def _boom_dispatcher() -> Dispatcher:
    def handler(node, inputs, run_id):
        raise AssertionError(f"node {node.id!r} was dispatched but should have been reused")

    return Dispatcher(handlers={NodeType.AGENT: handler})


def _event_types(tel: Telemetry) -> list[str]:
    return [e["event_type"] for e in tel.events]


# ─────────────────────────── AC3 + AC5: cache hit ───────────────────────────


def test_cache_hit_skips_node_and_reuses_output(tmp_path: Path):
    rs = tmp_path / "runs"
    graph = _graph([_node("a")])

    # Run 1 (b2 on) establishes the memo hash + cached output.
    d1 = _CountingDispatcher({"a": {"v": 1}})
    rid1 = make_run_id("memo-test")
    Walker().walk(
        graph, d1.dispatcher, rid1, Telemetry(run_id=rid1),
        context={"memoize": True}, run_state_path=rs,
    )
    assert d1.calls == ["a"]
    state1 = load(rid1, root=rs)
    assert "a" in state1.node_hashes
    assert state1.output_graph["a"] == {"v": 1}

    # Run 2 (b2 on, prior_state=state1). Inputs unchanged → cache HIT.
    # A boom dispatcher proves the node is NEVER dispatched.
    rid2 = make_run_id("memo-test")
    tel2 = Telemetry(run_id=rid2)
    materialised = Walker().walk(
        graph, _boom_dispatcher(), rid2, tel2,
        context={"memoize": True}, run_state_path=rs, prior_state=state1,
    )
    # Reused output surfaced to downstream via materialised.
    assert materialised["a"].outputs == {"v": 1}
    assert "node_reused" in _event_types(tel2)
    # AC5: the reused node carries status=reused in RunState (not absent).
    state2 = load(rid2, root=rs)
    assert state2.node_statuses["a"] == NodeStatus.REUSED
    assert state2.output_graph["a"] == {"v": 1}


# ─────────────────────────── AC4: cache miss ────────────────────────────────


def test_cache_miss_when_inputs_change_runs_normally(tmp_path: Path):
    rs = tmp_path / "runs"
    # Node consumes a context-sourced input, so changing the context value
    # changes the resolved inputs → the memo hash must differ.
    node = _node(
        "a",
        inputs=[InputBinding(name="k", source="context", context_key="k")],
    )
    graph = _graph([node])

    d1 = _CountingDispatcher({"a": {"v": 1}})
    rid1 = make_run_id("memo-test")
    Walker().walk(
        graph, d1.dispatcher, rid1, Telemetry(run_id=rid1),
        context={"memoize": True, "k": "x"}, run_state_path=rs,
    )
    state1 = load(rid1, root=rs)

    # Run 2 with a DIFFERENT context value → resolved inputs changed → miss.
    d2 = _CountingDispatcher({"a": {"v": 2}})
    rid2 = make_run_id("memo-test")
    tel2 = Telemetry(run_id=rid2)
    Walker().walk(
        graph, d2.dispatcher, rid2, tel2,
        context={"memoize": True, "k": "y"}, run_state_path=rs, prior_state=state1,
    )
    assert d2.calls == ["a"], "cache miss must dispatch the node"
    assert "node_reused" not in _event_types(tel2)
    state2 = load(rid2, root=rs)
    assert state2.node_statuses["a"] == NodeStatus.COMPLETED


# ─────────────────────────── AC7: flag off is inert ─────────────────────────


def test_flag_off_runs_node_even_when_inputs_unchanged(tmp_path: Path):
    rs = tmp_path / "runs"
    graph = _graph([_node("a")])

    d1 = _CountingDispatcher({"a": {"v": 1}})
    rid1 = make_run_id("memo-test")
    Walker().walk(
        graph, d1.dispatcher, rid1, Telemetry(run_id=rid1),
        context={"memoize": True}, run_state_path=rs,
    )
    state1 = load(rid1, root=rs)

    # Run 2 with b2 OFF: even though the hash would match, the node runs.
    d2 = _CountingDispatcher({"a": {"v": 1}})
    rid2 = make_run_id("memo-test")
    tel2 = Telemetry(run_id=rid2)
    Walker().walk(
        graph, d2.dispatcher, rid2, tel2,
        context={}, run_state_path=rs, prior_state=state1,
    )
    assert d2.calls == ["a"], "b2 disabled must run the node"
    assert "node_reused" not in _event_types(tel2)
    state2 = load(rid2, root=rs)
    assert state2.node_statuses["a"] == NodeStatus.COMPLETED
    # b2 off writes no memo hash (state is pre-b2 identical in shape).
    assert state2.node_hashes == {}


# ─────────────────────────── AC6: schema migration ──────────────────────────


def test_load_migrates_v0_run_state_to_v1(tmp_path: Path):
    rs = tmp_path / "runs"
    rid = make_run_id("memo-test")
    run_dir = rs / rid
    run_dir.mkdir(parents=True)
    # A pre-b2 (v0) run state — no node_hashes, schema_version 0.
    v0_payload = {
        "run_id": rid,
        "workflow_slug": "memo-test",
        "started_at": "2026-01-01T00:00:00+00:00",
        "last_updated_at": "2026-01-01T00:00:00+00:00",
        "status": "completed",
        "last_successful_node_id": "a",
        "node_statuses": {"a": "completed"},
        "output_graph": {"a": {"v": 1}},
        "failure_info": None,
        "schema_version": 0,
        "frozen": True,
    }
    (run_dir / "run_state.yaml").write_text(yaml.safe_dump(v0_payload), encoding="utf-8")

    state = load(rid, root=rs)
    # Bumped to v1 and back-filled node_hashes, all other fields readable.
    assert state.schema_version == 1
    assert state.node_hashes == {}
    assert state.output_graph == {"a": {"v": 1}}
    assert state.node_statuses == {"a": NodeStatus.COMPLETED}
    assert state.last_successful_node_id == "a"


# ─────────────────────────── AC8: replay reloads reused ─────────────────────


def test_replay_reloads_reused_node(tmp_path: Path):
    """A REUSED node must be treated as done on replay (not re-dispatched).

    Regression guard: b2 adds REUSED to the replay reload set alongside
    COMPLETED; this proves the replay path consumes a reused node's cached
    output instead of re-running it.
    """
    from dataclasses import replace

    from hive.lib.dag_executor.run_state import RunStatus
    from hive.lib.dag_executor.run_state.store import create

    rs = tmp_path / "runs"
    a = _node("a")
    b = _node(
        "b",
        depends_on=["a"],
        inputs=[
            InputBinding(
                name="piped", source="step_output", step_id="a", output_name="v"
            )
        ],
    )
    graph = _graph([a, b])

    rid = make_run_id("memo-test")
    # Prior state: `a` was REUSED (cached), `b` FAILED — replay resumes at b.
    state = create(rid, "memo-test")
    state = replace(
        state,
        status=RunStatus.FAILED,
        last_successful_node_id="a",
        node_statuses={"a": NodeStatus.REUSED, "b": NodeStatus.FAILED},
        output_graph={"a": {"v": 99}},
    )

    d = _CountingDispatcher({"b": {"done": True}})
    rid_tel = Telemetry(run_id=rid)
    final = Walker().replay(graph, d.dispatcher, rid, rid_tel, state, runs_root=rs)

    # `a` (REUSED) is NOT re-dispatched; only the failed `b` re-runs.
    assert d.calls == ["b"]
    assert final.status == RunStatus.COMPLETED


# ─────────────────── review invariant: 3-dimension hash ─────────────────────


def test_memo_hash_covers_inputs_node_config_and_version():
    """The conservative hash changes when ANY drift dimension changes.

    Under-invalidation (a hash missing a dimension) is the epic's highest
    risk: it would silently serve stale output. This pins that the hash
    covers resolved inputs, node config, AND workflow/skill version.
    """
    node = _node("a")
    graph = _graph([node], version="1")
    base = _compute_memo_hash(node, {"x": 1}, graph)

    # (1) resolved inputs change → hash changes.
    assert _compute_memo_hash(node, {"x": 2}, graph) != base

    # (2) node config change (agent) → hash changes.
    other_node = _node("a")
    other_node.agent = "reviewer"
    assert _compute_memo_hash(other_node, {"x": 1}, graph) != base

    # (3) workflow/skill version change → hash changes.
    v2_graph = _graph([node], version="2")
    assert _compute_memo_hash(node, {"x": 1}, v2_graph) != base

    # Identical everything → hash stable (a genuine cache hit).
    assert _compute_memo_hash(node, {"x": 1}, graph) == base


# ─────────── Finding 1: step_file CONTENT is a hash dimension ────────────────


def test_step_file_content_change_causes_cache_miss(tmp_path: Path):
    # A node whose prompt lives in a step_file. Editing the file content
    # (same inputs + node config) MUST change the memo hash — otherwise the
    # handler would read a new prompt yet the node would be wrongly reused.
    step = tmp_path / "step.md"
    step.write_text("original prompt", encoding="utf-8")
    node = _node("a", step_file="step.md")
    graph = _graph([node])
    ctx = {"repo_root": str(tmp_path)}

    h_before = _compute_memo_hash(node, {}, graph, ctx)
    assert h_before is not None

    step.write_text("EDITED prompt — real behaviour change", encoding="utf-8")
    h_after = _compute_memo_hash(node, {}, graph, ctx)
    assert h_after is not None
    assert h_after != h_before, "step_file content change must invalidate the memo hash"


def test_unreadable_step_file_is_not_memoized(tmp_path: Path):
    # A declared step_file that cannot be resolved/read → fail-safe: the hash
    # is None so the node is never memoized (a spurious re-run beats a false
    # hit on stale output).
    node = _node("a", step_file="does-not-exist.md")
    graph = _graph([node])
    assert _compute_memo_hash(node, {}, graph, {"repo_root": str(tmp_path)}) is None


def test_step_file_change_makes_walker_run_node(tmp_path: Path):
    # End-to-end at the walker: run 1 memoizes a step_file node; editing the
    # step content before run 2 forces a cache MISS (the node runs again).
    rs = tmp_path / "runs"
    step = tmp_path / "step.md"
    step.write_text("v1", encoding="utf-8")
    graph = _graph([_node("a", step_file="step.md")])
    ctx = {"memoize": True, "repo_root": str(tmp_path)}

    d1 = _CountingDispatcher({"a": {"v": 1}})
    rid1 = make_run_id("memo-test")
    Walker().walk(
        graph, d1.dispatcher, rid1, Telemetry(run_id=rid1),
        context=ctx, run_state_path=rs,
    )
    state1 = load(rid1, root=rs)
    assert "a" in state1.node_hashes  # memoized when readable + unchanged

    # Edit the prompt → run 2 must NOT reuse.
    step.write_text("v2 — changed", encoding="utf-8")
    d2 = _CountingDispatcher({"a": {"v": 2}})
    rid2 = make_run_id("memo-test")
    tel2 = Telemetry(run_id=rid2)
    Walker().walk(
        graph, d2.dispatcher, rid2, tel2,
        context=ctx, run_state_path=rs, prior_state=state1,
    )
    assert d2.calls == ["a"], "changed step_file content must force a cache miss"
    assert "node_reused" not in _event_types(tel2)


# ─────────── Finding 2: b2 works end-to-end through run_workflow ─────────────


def test_run_workflow_memoizes_second_run_end_to_end(tmp_path: Path):
    # Drive the PUBLIC front door (run_workflow) twice with a persisted
    # run_state + memoize enabled. The second run must discover the first
    # run's state and REUSE the unchanged node — without a hand-supplied
    # prior_state (that is the production dag-multica invocation shape).
    from hive.lib.dag_executor import run_workflow

    rs = tmp_path / "runs"
    wf = tmp_path / "memo-e2e.workflow.yaml"
    wf.write_text(
        yaml.safe_dump(
            {
                "name": "memo-e2e",
                "version": "1",
                "steps": [{"id": "a", "agent": "developer"}],
            }
        ),
        encoding="utf-8",
    )

    d1 = _CountingDispatcher({"a": {"v": 1}})
    rid1 = make_run_id("memo-e2e")
    run_workflow(
        wf, d1.dispatcher, run_id=rid1,
        run_state_path=rs, context={"memoize": True},
    )
    assert d1.calls == ["a"]
    assert load(rid1, root=rs).status.value == "completed"

    # Second run through the front door — a boom dispatcher proves the node
    # is reused (never dispatched) via the auto-loaded prior state.
    rid2 = make_run_id("memo-e2e")
    run_workflow(
        wf, _boom_dispatcher(), run_id=rid2,
        run_state_path=rs, context={"memoize": True},
    )
    state2 = load(rid2, root=rs)
    assert state2.node_statuses["a"] == NodeStatus.REUSED
    assert state2.output_graph["a"] == {"v": 1}


def test_run_workflow_flag_off_does_not_memoize(tmp_path: Path):
    # Same two-run shape but memoize OFF → the front door supplies no prior
    # state and the node runs both times (b2 inert).
    from hive.lib.dag_executor import run_workflow

    rs = tmp_path / "runs"
    wf = tmp_path / "memo-e2e.workflow.yaml"
    wf.write_text(
        yaml.safe_dump(
            {"name": "memo-e2e", "version": "1", "steps": [{"id": "a", "agent": "developer"}]}
        ),
        encoding="utf-8",
    )

    d1 = _CountingDispatcher({"a": {"v": 1}})
    run_workflow(wf, d1.dispatcher, run_id=make_run_id("memo-e2e"), run_state_path=rs, context={})

    d2 = _CountingDispatcher({"a": {"v": 1}})
    rid2 = make_run_id("memo-e2e")
    run_workflow(wf, d2.dispatcher, run_id=rid2, run_state_path=rs, context={})
    assert d2.calls == ["a"], "b2 off must run the node even through run_workflow"
    assert load(rid2, root=rs).node_statuses["a"] == NodeStatus.COMPLETED
