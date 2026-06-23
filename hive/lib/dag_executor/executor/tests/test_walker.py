"""Walker tests — Kahn topo-sort, sequential dispatch, optional-step semantics."""

from __future__ import annotations

import pytest

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.errors import (
    HandlerError,
    WalkerCycleError,
)
from hive.lib.dag_executor.executor.handlers import NodeOutput
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker, _topological_order
from hive.lib.dag_executor.graph import (
    ConditionalEdge,
    Graph,
    InputBinding,
    Node,
    NodeType,
)


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


def _stub_dispatcher(outputs_by_id: dict[str, dict]) -> Dispatcher:
    """Dispatcher whose AGENT handler returns canned outputs by node id."""

    def handler(node, inputs, run_id):
        return NodeOutput(outputs=dict(outputs_by_id.get(node.id, {})))

    return Dispatcher(handlers={NodeType.AGENT: handler})


def _emit_types(tel: Telemetry) -> list[str]:
    return [e["event_type"] for e in tel.events]


def test_topo_sort_linear_chain():
    g = _graph_with(
        [
            _agent_node("a"),
            _agent_node("b", depends_on=["a"]),
            _agent_node("c", depends_on=["b"]),
        ]
    )
    assert _topological_order(g) == ["a", "b", "c"]


def test_topo_sort_diamond():
    g = _graph_with(
        [
            _agent_node("a"),
            _agent_node("b", depends_on=["a"]),
            _agent_node("c", depends_on=["a"]),
            _agent_node("d", depends_on=["b", "c"]),
        ]
    )
    order = _topological_order(g)
    assert order.index("a") < order.index("b") < order.index("d")
    assert order.index("a") < order.index("c") < order.index("d")


def test_topo_sort_cycle_raises():
    g = _graph_with(
        [
            _agent_node("a", depends_on=["b"]),
            _agent_node("b", depends_on=["a"]),
        ]
    )
    with pytest.raises(WalkerCycleError):
        _topological_order(g)


def test_walk_emits_started_and_completed_per_node():
    g = _graph_with([_agent_node("a"), _agent_node("b", depends_on=["a"])])
    tel = Telemetry(run_id="rid-1")
    Walker().walk(g, _stub_dispatcher({"a": {"x": 1}, "b": {"y": 2}}), "rid-1", tel)
    assert _emit_types(tel) == [
        "node_started",
        "node_completed",
        "node_started",
        "node_completed",
    ]


def test_walk_materialises_outputs_for_downstream_use():
    """Inputs of node `b` resolve from node `a`'s materialised outputs."""

    def handler(node, inputs, run_id):
        if node.id == "a":
            return NodeOutput(outputs={"shared": 42})
        # `b` should observe `a`'s output via input binding
        assert inputs == {"piped": 42}, f"inputs not materialised: {inputs}"
        return NodeOutput(outputs={"final": inputs["piped"]})

    a = _agent_node("a", outputs=[])
    b = _agent_node(
        "b",
        depends_on=["a"],
        inputs=[
            InputBinding(
                name="piped",
                source="step_output",
                step_id="a",
                output_name="shared",
            )
        ],
    )
    g = _graph_with([a, b])
    tel = Telemetry(run_id="rid-1")
    out = Walker().walk(g, Dispatcher(handlers={NodeType.AGENT: handler}), "rid-1", tel)
    assert out["b"].outputs == {"final": 42}


def test_optional_step_failure_continues_walk():
    def handler(node, inputs, run_id):
        if node.id == "a":
            raise HandlerError("boom")
        return NodeOutput(outputs={"ok": True})

    a = _agent_node("a", optional=True)
    b = _agent_node("b", depends_on=["a"])
    g = _graph_with([a, b])
    tel = Telemetry(run_id="rid-1")
    out = Walker().walk(g, Dispatcher(handlers={NodeType.AGENT: handler}), "rid-1", tel)
    assert "b" in out
    assert "node_failed" in _emit_types(tel)


def test_required_step_failure_propagates():
    def handler(node, inputs, run_id):
        raise HandlerError("boom")

    g = _graph_with([_agent_node("a")])  # default optional=False
    tel = Telemetry(run_id="rid-1")
    with pytest.raises(HandlerError):
        Walker().walk(g, Dispatcher(handlers={NodeType.AGENT: handler}), "rid-1", tel)
    assert "node_failed" in _emit_types(tel)


def test_skip_when_present_emits_node_skipped():
    """skip_when predicate evaluation is hde-3a; presence triggers skip."""
    g = _graph_with([_agent_node("a", skip_when="some_predicate")])
    tel = Telemetry(run_id="rid-1")
    Walker().walk(g, _stub_dispatcher({}), "rid-1", tel)
    assert _emit_types(tel) == ["node_skipped"]


def test_every_emitted_event_carries_run_id():
    g = _graph_with([_agent_node("a")])
    tel = Telemetry(run_id="rid-xyz")
    Walker().walk(g, _stub_dispatcher({"a": {}}), "rid-xyz", tel)
    assert all(e["run_id"] == "rid-xyz" for e in tel.events)


# ── s2 / efcl-s2: implement sentinel visible to review via reconcile ──────────


def _reconcile_node(node_id: str, depends_on: list[str] | None = None) -> Node:
    return Node(
        id=node_id,
        agent="reconciler",
        node_type=NodeType.RECONCILE,
        depends_on=depends_on or [],
    )


def test_implement_sentinel_visible_in_review_via_reconcile_node(tmp_path):
    """Graph: implement → reconcile-implement → review.

    The implement node writes a sentinel file to work_dir. The reconcile
    node (stub) copies work_dir contents to repo_root. The review node
    asserts the sentinel file is readable in repo_root before integrate.
    """
    import shutil
    from pathlib import Path

    work_dir = tmp_path / "work_dir"
    work_dir.mkdir()
    sentinel = work_dir / "sentinel.txt"
    sentinel.write_text("implement output", encoding="utf-8")

    repo_root = tmp_path / "repo_root"
    repo_root.mkdir()

    review_saw_sentinel: list[bool] = []

    def agent_handler(node, inputs, run_id):
        if node.id == "implement":
            return NodeOutput(outputs={"implementation": "done", "work_dir": str(work_dir)})
        if node.id == "review":
            review_saw_sentinel.append((repo_root / "sentinel.txt").exists())
            return NodeOutput(outputs={"review_verdict": "passed"})
        return NodeOutput(outputs={})

    def reconcile_handler(node, inputs, run_id):
        wdir = Path(inputs.get("work_dir") or "")
        if wdir.is_dir():
            shutil.copytree(str(wdir), str(repo_root), dirs_exist_ok=True)
        return NodeOutput(outputs={}, meta={"reconcile": "done"})

    nodes = [
        Node(id="implement", agent="developer", node_type=NodeType.AGENT),
        Node(
            id="reconcile-implement",
            agent="reconciler",
            node_type=NodeType.RECONCILE,
            depends_on=["implement"],
            inputs=[
                InputBinding(
                    name="work_dir",
                    source="step_output",
                    step_id="implement",
                    output_name="work_dir",
                    optional=True,
                ),
            ],
        ),
        Node(
            id="review",
            agent="reviewer",
            node_type=NodeType.AGENT,
            depends_on=["reconcile-implement"],
        ),
    ]
    g = _graph_with(nodes)
    dispatcher = Dispatcher(handlers={
        NodeType.AGENT: agent_handler,
        NodeType.RECONCILE: reconcile_handler,
    })
    Walker().walk(g, dispatcher, "rid-sentinel", Telemetry(run_id="rid-sentinel"))
    assert review_saw_sentinel == [True], (
        "review must see implement's sentinel file after reconcile materialises it"
    )


def test_walker_inline_reconcile_fires_after_implement(tmp_path):
    """Walker's per-node reconcile fires for implement nodes with commit_sha.

    Graph: implement → review (no explicit reconcile node). The walker's
    inline _per_node_reconcile must invoke the dispatcher's reconcile handler
    with the implement node's commit_sha before review is dispatched.
    """
    reconcile_calls: list[str] = []

    def agent_handler(node, inputs, run_id):
        if node.id == "implement":
            return NodeOutput(outputs={
                "implementation": "done",
                "commit_sha": "abc1234",
                "branch": "agent/impl/x",
                "repo": "git@github.com:org/repo.git",
                "work_dir": str(tmp_path / "work"),
            })
        return NodeOutput(outputs={"review_verdict": "passed"})

    def reconcile_handler(node, inputs, run_id):
        reconcile_calls.append(inputs.get("sha", ""))
        return NodeOutput(outputs={}, meta={"reconcile": "done"})

    nodes = [
        Node(id="implement", agent="developer", node_type=NodeType.AGENT),
        Node(id="review", agent="reviewer", node_type=NodeType.AGENT, depends_on=["implement"]),
    ]
    g = _graph_with(nodes)
    dispatcher = Dispatcher(handlers={
        NodeType.AGENT: agent_handler,
        NodeType.RECONCILE: reconcile_handler,
    })
    Walker().walk(g, dispatcher, "rid-inline", Telemetry(run_id="rid-inline"))
    assert reconcile_calls == ["abc1234"], (
        "walker must invoke per-node reconcile with commit_sha after implement terminates"
    )


def test_walker_inline_reconcile_noop_without_commit_sha():
    """Walker's per-node reconcile is a no-op when implement returns no commit_sha."""
    reconcile_calls: list[str] = []

    def agent_handler(node, inputs, run_id):
        if node.id == "implement":
            return NodeOutput(outputs={"implementation": "done"})
        return NodeOutput(outputs={})

    def reconcile_handler(node, inputs, run_id):
        reconcile_calls.append(node.id)
        return NodeOutput(outputs={})

    nodes = [
        Node(id="implement", agent="developer", node_type=NodeType.AGENT),
        Node(id="review", agent="reviewer", node_type=NodeType.AGENT, depends_on=["implement"]),
    ]
    g = _graph_with(nodes)
    dispatcher = Dispatcher(handlers={
        NodeType.AGENT: agent_handler,
        NodeType.RECONCILE: reconcile_handler,
    })
    Walker().walk(g, dispatcher, "rid-noop", Telemetry(run_id="rid-noop"))
    assert reconcile_calls == [], (
        "per-node reconcile must be a no-op when no commit_sha is present"
    )


def test_nonoptional_reconcile_node_failure_aborts_before_review(tmp_path):
    """The authoritative barrier is the graph's NON-optional reconcile node:
    when materialisation fails (e.g. NON_FF on the Multica substrate), that node
    fails the run so the downstream review never reads a stale tree. (The inline
    _per_node_reconcile is best-effort only — it must NOT be the thing that
    raises, to keep resume state consistent, #5.)"""
    review_dispatched: list[str] = []

    def agent_handler(node, inputs, run_id):
        if node.id == "implement":
            return NodeOutput(outputs={
                "implementation": "done",
                "commit_sha": "abc1234",
                "branch": "agent/impl/x",
                "repo": "git@github.com:org/repo.git",
                "work_dir": str(tmp_path / "work"),
            })
        review_dispatched.append(node.id)
        return NodeOutput(outputs={"review_verdict": "passed"})

    def reconcile_handler(node, inputs, run_id):
        raise HandlerError("NON_FF: cannot fast-forward")

    nodes = [
        Node(id="implement", agent="developer", node_type=NodeType.AGENT),
        Node(
            id="reconcile-implement",
            agent="reconciler",
            node_type=NodeType.RECONCILE,
            depends_on=["implement"],
            optional=False,
        ),
        Node(
            id="review",
            agent="reviewer",
            node_type=NodeType.AGENT,
            depends_on=["reconcile-implement"],
        ),
    ]
    g = _graph_with(nodes)
    dispatcher = Dispatcher(handlers={
        NodeType.AGENT: agent_handler,
        NodeType.RECONCILE: reconcile_handler,
    })
    with pytest.raises(HandlerError, match="NON_FF"):
        Walker().walk(g, dispatcher, "rid-fail", Telemetry(run_id="rid-fail"))
    assert review_dispatched == [], (
        "review must NOT run when the non-optional reconcile node failed"
    )


# ── s2 / efcl-s2: parallel dispatch group serialization + idempotency ─────────


def test_parallel_implement_wave_reconciles_serially_without_corruption(tmp_path):
    """AC2: two implement nodes in the same parallel dispatch group.

    backend-implement and frontend-implement are both ready in one wave (they
    share the same single ancestor and neither depends on the other), so the
    walker dispatches them through ``_dispatch_parallel_wave``. Each writes a
    distinct sentinel into its own work_dir; the per-node reconcile materialises
    both into a shared repo_root. The reconcile handler is wrapped with a
    re-entrancy guard that fails if two reconciles are ever active at once —
    asserting the walker serialises them. Afterwards review must see BOTH
    sentinels with uncorrupted (un-interleaved) content.
    """
    import shutil
    from pathlib import Path

    repo_root = tmp_path / "repo_root"
    repo_root.mkdir()

    backend_wd = tmp_path / "backend_wd"
    backend_wd.mkdir()
    (backend_wd / "backend.txt").write_text("backend-output", encoding="utf-8")

    frontend_wd = tmp_path / "frontend_wd"
    frontend_wd.mkdir()
    (frontend_wd / "frontend.txt").write_text("frontend-output", encoding="utf-8")

    reconcile_shas: list[str] = []
    active = {"count": 0}
    overlap_seen = {"hit": False}
    review_saw: dict[str, bool] = {}

    def agent_handler(node, inputs, run_id):
        if node.id == "backend-implement":
            return NodeOutput(outputs={
                "commit_sha": "be-sha", "work_dir": str(backend_wd),
            })
        if node.id == "frontend-implement":
            return NodeOutput(outputs={
                "commit_sha": "fe-sha", "work_dir": str(frontend_wd),
            })
        if node.id == "review":
            review_saw["backend"] = (
                (repo_root / "backend.txt").read_text(encoding="utf-8") == "backend-output"
                if (repo_root / "backend.txt").exists() else False
            )
            review_saw["frontend"] = (
                (repo_root / "frontend.txt").read_text(encoding="utf-8") == "frontend-output"
                if (repo_root / "frontend.txt").exists() else False
            )
            return NodeOutput(outputs={"review_verdict": "passed"})
        return NodeOutput(outputs={})

    def reconcile_handler(node, inputs, run_id):
        # Re-entrancy guard: if the walker ever ran two reconciles concurrently
        # this counter would exceed 1 and corrupt the shared repo_root.
        active["count"] += 1
        if active["count"] > 1:
            overlap_seen["hit"] = True
        reconcile_shas.append(inputs.get("sha", ""))
        wdir = Path(inputs.get("work_dir") or "")
        if wdir.is_dir():
            shutil.copytree(str(wdir), str(repo_root), dirs_exist_ok=True)
        active["count"] -= 1
        return NodeOutput(outputs={}, meta={"reconcile": "done"})

    nodes = [
        Node(id="seed", agent="developer", node_type=NodeType.AGENT),
        Node(id="backend-implement", agent="developer",
             node_type=NodeType.AGENT, depends_on=["seed"]),
        Node(id="frontend-implement", agent="developer",
             node_type=NodeType.AGENT, depends_on=["seed"]),
        Node(id="review", agent="reviewer", node_type=NodeType.AGENT,
             depends_on=["backend-implement", "frontend-implement"]),
    ]
    g = _graph_with(nodes)
    dispatcher = Dispatcher(handlers={
        NodeType.AGENT: agent_handler,
        NodeType.RECONCILE: reconcile_handler,
    })
    Walker().walk(g, dispatcher, "rid-parallel", Telemetry(run_id="rid-parallel"))

    assert sorted(reconcile_shas) == ["be-sha", "fe-sha"], (
        "both implement nodes in the parallel wave must trigger a per-node reconcile"
    )
    assert not overlap_seen["hit"], (
        "per-node reconciles in a parallel wave must be serialised — no overlap"
    )
    assert review_saw == {"backend": True, "frontend": True}, (
        "review must see both sentinels with uncorrupted content after reconcile"
    )


def test_per_node_reconcile_is_idempotent_on_already_merged_tree(tmp_path):
    """AC3 / idempotency: a second reconcile of already-merged artifacts must
    not re-copy, duplicate, or corrupt the review checkout.

    The same implement→review walk is run twice against the same repo_root,
    exactly as a re-dispatch (retry) would re-invoke the per-node reconcile on
    work already materialised. The tree must be byte-identical and contain no
    duplicated entries after the second pass.
    """
    import shutil
    from pathlib import Path

    repo_root = tmp_path / "repo_root"
    repo_root.mkdir()

    work_dir = tmp_path / "work_dir"
    (work_dir / "pkg").mkdir(parents=True)
    (work_dir / "pkg" / "module.py").write_text("x = 1\n", encoding="utf-8")

    def agent_handler(node, inputs, run_id):
        if node.id == "implement":
            return NodeOutput(outputs={
                "commit_sha": "sha-idem", "work_dir": str(work_dir),
            })
        return NodeOutput(outputs={"review_verdict": "passed"})

    def reconcile_handler(node, inputs, run_id):
        wdir = Path(inputs.get("work_dir") or "")
        if wdir.is_dir():
            # dirs_exist_ok=True is the idempotent copy path used by the real
            # ReconcileHandler; a repeat invocation overwrites in place.
            shutil.copytree(str(wdir), str(repo_root), dirs_exist_ok=True)
        return NodeOutput(outputs={})

    nodes = [
        Node(id="implement", agent="developer", node_type=NodeType.AGENT),
        Node(id="review", agent="reviewer", node_type=NodeType.AGENT,
             depends_on=["implement"]),
    ]
    g = _graph_with(nodes)
    dispatcher = Dispatcher(handlers={
        NodeType.AGENT: agent_handler,
        NodeType.RECONCILE: reconcile_handler,
    })

    def snapshot() -> dict[str, str]:
        return {
            str(p.relative_to(repo_root)): p.read_text(encoding="utf-8")
            for p in sorted(repo_root.rglob("*")) if p.is_file()
        }

    Walker().walk(g, dispatcher, "rid-idem-1", Telemetry(run_id="rid-idem-1"))
    first = snapshot()
    Walker().walk(g, dispatcher, "rid-idem-2", Telemetry(run_id="rid-idem-2"))
    second = snapshot()

    assert first == {"pkg/module.py": "x = 1\n"}, (
        "first reconcile must materialise the implement tree exactly once"
    )
    assert second == first, (
        "a second per-node reconcile must not re-copy, duplicate, or corrupt "
        "already-merged artifacts (idempotency)"
    )
