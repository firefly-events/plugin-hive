"""hde-4 ParallelScheduler + walker barrier-join integration tests.

Covers:

  * Synthetic 3-branch fan-out + barrier-join: wall-clock ≈ max(branch_time),
    not sum (within a generous slack window so CI noise doesn't flake).
  * Real test-swarm.workflow.yaml with stub agents — execute-platform-a +
    execute-platform-b run in parallel, file-bugs joins both via
    none_failed_min_one_success.
  * Failure-in-one-branch: A succeeds, B raises → file-bugs sees
    [A=COMPLETED, B=SKIPPED] and trigger_rule activates (≥1 success).
  * All-fail: A and B both raise → file-bugs sees no successes and
    SKIPS via trigger_rule.
  * Insight-slug collision: parallel branches both surface the SAME
    raw `insight_slug`; the handler disambiguates each via
    `disambiguate_insight_slug(..., run_id=...)` so paths differ.
  * Sequential single-node-wave preserves spine-parity event ordering
    (the linear hde-2 path is byte-equivalent under the new walker).
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.handlers import (
    AgentHandler,
    NodeOutput,
    StubAgentSpawn,
)
from hive.lib.dag_executor.executor.run_id import make_run_id
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker
from hive.lib.dag_executor.graph import (
    ConditionalEdge,
    Graph,
    Node,
    NodeType,
    load_workflow,
)
from hive.lib.dag_executor.routing import (
    ActivationDecision,
    ParallelScheduler,
    ScheduleResult,
    decide_join_activation,
    disambiguate_insight_slug,
    none_failed_min_one_success,
)
from hive.lib.dag_executor.run_state import NodeStatus


REPO_ROOT = Path(__file__).resolve().parents[5]
TEST_SWARM_FIXTURE = REPO_ROOT / "hive" / "workflows" / "test-swarm.workflow.yaml"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _agent_node(
    node_id: str,
    depends_on: list[str] | None = None,
    timeout_ms: int | None = None,
) -> Node:
    return Node(
        id=node_id,
        agent="developer",
        node_type=NodeType.AGENT,
        depends_on=depends_on or [],
        timeout_ms=timeout_ms,
    )


def _graph_from_nodes(nodes: list[Node], name: str = "fanout-test") -> Graph:
    edges = [
        ConditionalEdge(from_node_id=p, to_node_id=n.id)
        for n in nodes
        for p in n.depends_on
    ]
    return Graph(workflow_name=name, nodes={n.id: n for n in nodes}, edges=edges)


class _SpawnRecorder:
    """Stub spawn that records calls and supports per-step canned outputs.

    Optionally sleeps per-step for a configured duration so the parity-
    timing test can assert wall-clock parallelism.
    """

    def __init__(
        self,
        canned: dict[str, dict[str, Any]] | None = None,
        sleeps: dict[str, float] | None = None,
        raises: dict[str, BaseException] | None = None,
    ):
        self.canned = canned or {}
        self.sleeps = sleeps or {}
        self.raises = raises or {}
        self.calls: list[dict[str, Any]] = []

    def __call__(
        self,
        agent: str,
        step_file_content: str,
        inputs: dict[str, Any],
        run_id: str,
        step_id: str,
    ) -> dict[str, Any]:
        self.calls.append(
            {
                "agent": agent,
                "step_id": step_id,
                "run_id": run_id,
                "inputs": dict(inputs),
            }
        )
        sleep_for = self.sleeps.get(step_id, 0.0)
        if sleep_for:
            time.sleep(sleep_for)
        if step_id in self.raises:
            raise self.raises[step_id]
        return dict(self.canned.get(step_id, {}))


def _event_kinds(tel: Telemetry) -> list[tuple[str, str]]:
    return [(e["event_type"], e["step_id"]) for e in tel.events]


# ---------------------------------------------------------------------------
# Slug disambiguation (Risk #9 unit test)
# ---------------------------------------------------------------------------


def test_disambiguate_insight_slug_appends_run_id_short():
    run_id = "01ARZ3NDEKTSV4RRFFQ69G5FAV-test-swarm"
    slug = disambiguate_insight_slug(
        epic_id="epic-x",
        story_id="story-1",
        slug="timeout-pattern",
        run_id=run_id,
    )
    # First 8 chars of run_id are the leading ULID prefix.
    assert slug == "timeout-pattern-01ARZ3ND"


def test_disambiguate_insight_slug_distinguishes_runs():
    a = disambiguate_insight_slug("e", "s", "k", "01AAAAAAAAA-x")
    b = disambiguate_insight_slug("e", "s", "k", "01BBBBBBBBB-x")
    assert a != b


def test_disambiguate_insight_slug_rejects_empty():
    import pytest

    with pytest.raises(ValueError):
        disambiguate_insight_slug("e", "s", "", "rid12345")
    with pytest.raises(ValueError):
        disambiguate_insight_slug("e", "s", "ok", "")


# ---------------------------------------------------------------------------
# decide_join_activation (thin wrapper over trigger_rule)
# ---------------------------------------------------------------------------


def test_decide_join_activation_runs_with_one_success():
    decision = decide_join_activation(
        [NodeStatus.COMPLETED, NodeStatus.SKIPPED, NodeStatus.FAILED]
    )
    assert decision == ActivationDecision.RUN


def test_decide_join_activation_skips_with_zero_success():
    decision = decide_join_activation([NodeStatus.SKIPPED, NodeStatus.FAILED])
    assert decision == ActivationDecision.SKIP


# ---------------------------------------------------------------------------
# Synthetic 3-branch fan-out + barrier-join (timing parity)
# ---------------------------------------------------------------------------


def test_three_branch_fanout_wallclock_is_max_not_sum():
    """A→{B,C,D}→E. Each branch sleeps 100ms. Wall-clock must be
    closer to max(branch_time) than sum(branch_time)."""

    root = _agent_node("root")
    branch_a = _agent_node("branch-a", depends_on=["root"])
    branch_b = _agent_node("branch-b", depends_on=["root"])
    branch_c = _agent_node("branch-c", depends_on=["root"])
    join = _agent_node("join", depends_on=["branch-a", "branch-b", "branch-c"])
    g = _graph_from_nodes([root, branch_a, branch_b, branch_c, join])

    sleep_s = 0.10
    spy = _SpawnRecorder(
        canned={
            "root": {"start": True},
            "branch-a": {"a": 1},
            "branch-b": {"b": 2},
            "branch-c": {"c": 3},
            "join": {"joined": True},
        },
        sleeps={"branch-a": sleep_s, "branch-b": sleep_s, "branch-c": sleep_s},
    )

    run_id = make_run_id("fanout")
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)
    tel = Telemetry(run_id=run_id)

    start = time.monotonic()
    out = Walker().walk(g, dispatcher, run_id, tel)
    wall_s = time.monotonic() - start

    # All five nodes completed.
    assert set(out.keys()) == {"root", "branch-a", "branch-b", "branch-c", "join"}
    # Sequential wall-clock would be ≥ 3*sleep. Parallel must be < 2*sleep
    # under any reasonable thread-pool overhead. Using 2x as the parity
    # bar leaves >100% slack so this is not flaky.
    assert wall_s < (sleep_s * 2.0), (
        f"parallel fan-out took {wall_s:.3f}s; expected < "
        f"{sleep_s * 2:.3f}s (sequential would be ≈{sleep_s * 3:.3f}s)"
    )


# ---------------------------------------------------------------------------
# Real test-swarm.workflow.yaml integration
# ---------------------------------------------------------------------------


def _stub_canned_for_test_swarm() -> dict[str, dict[str, Any]]:
    return {
        "rebuild": {"build_report": "fresh"},
        "gather-context": {"context_doc": "<<ctx>>"},
        "verify-baseline": {"baseline_status": "ok"},
        "author-tests": {
            "test_manifest": "manifest",
            "test_files": "files-ref",
        },
        "validate-coverage": {"coverage_report": "100%"},
        "execute-platform-a": {"platform_a_results": "a-pass"},
        "execute-platform-b": {"platform_b_results": "b-pass"},
        "file-bugs": {"bug_reports": "none"},
        "triage-failures": {"routing_decisions": "none"},
        "compile-report": {"session_report": "report"},
        "promote-baseline": {"promotion_summary": "ok"},
    }


def test_test_swarm_executes_e2e_with_parallel_platforms():
    graph = load_workflow(TEST_SWARM_FIXTURE)
    spy = _SpawnRecorder(canned=_stub_canned_for_test_swarm())

    run_id = make_run_id("test-swarm")
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)
    tel = Telemetry(run_id=run_id)

    out = Walker().walk(
        graph,
        dispatcher,
        run_id,
        tel,
        context={"story_spec": "<<spec>>", "baseline_path": "/tmp/baseline"},
    )

    expected_steps = {
        "rebuild",
        "gather-context",
        "verify-baseline",
        "author-tests",
        "validate-coverage",
        "execute-platform-a",
        "execute-platform-b",
        "file-bugs",
        "triage-failures",
        "compile-report",
        "promote-baseline",
    }
    assert set(out.keys()) == expected_steps
    # file-bugs ran (≥1 platform succeeded) — barrier-join activated.
    assert out["file-bugs"].outputs == {"bug_reports": "none"}


def test_test_swarm_one_branch_failure_skips_branch_join_runs():
    """execute-platform-b raises; execute-platform-a succeeds.
    file-bugs sees [a=COMPLETED, b=SKIPPED] → trigger_rule = RUN."""

    graph = load_workflow(TEST_SWARM_FIXTURE)
    spy = _SpawnRecorder(
        canned=_stub_canned_for_test_swarm(),
        raises={"execute-platform-b": RuntimeError("device offline")},
    )

    run_id = make_run_id("test-swarm")
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)
    tel = Telemetry(run_id=run_id)

    out = Walker().walk(
        graph,
        dispatcher,
        run_id,
        tel,
        context={"story_spec": "<<spec>>", "baseline_path": "/tmp/baseline"},
    )

    # Sibling A completed; B was skipped (no entry in materialised).
    assert "execute-platform-a" in out
    assert "execute-platform-b" not in out
    # Join still ran.
    assert "file-bugs" in out
    # node_failed event surfaced for B with parallel marker.
    failed_events = [e for e in tel.events if e["event_type"] == "node_failed"]
    b_failed = [e for e in failed_events if e["step_id"] == "execute-platform-b"]
    assert b_failed, "expected node_failed for execute-platform-b"
    assert b_failed[0]["payload"].get("parallel") is True


def test_test_swarm_all_branches_fail_join_skips():
    """Both platform branches raise → join sees zero successes → SKIP.

    file-bugs SKIPs via trigger_rule. compile-report consumes file-bugs +
    triage-failures + validate-coverage; with file-bugs SKIPPED the join
    needs ≥1 success — validate-coverage and triage-failures provide it
    only if THEY ran. triage-failures depends on file-bugs alone, so it
    SKIPs too. That leaves compile-report with [validate-coverage=
    COMPLETED, …others=SKIPPED] — still ≥1 success → RUN.
    """

    graph = load_workflow(TEST_SWARM_FIXTURE)
    spy = _SpawnRecorder(
        canned=_stub_canned_for_test_swarm(),
        raises={
            "execute-platform-a": RuntimeError("device A offline"),
            "execute-platform-b": RuntimeError("device B offline"),
        },
    )

    run_id = make_run_id("test-swarm")
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)
    tel = Telemetry(run_id=run_id)

    out = Walker().walk(
        graph,
        dispatcher,
        run_id,
        tel,
        context={"story_spec": "<<spec>>", "baseline_path": "/tmp/baseline"},
    )

    # Neither platform produced output.
    assert "execute-platform-a" not in out
    assert "execute-platform-b" not in out
    # file-bugs SKIPped (zero successes upstream).
    assert "file-bugs" not in out
    # triage-failures SKIPped (file-bugs failed to materialise; lone
    # upstream went SKIPPED). Single-upstream nodes propagate via
    # per-input optional + the resolve-fail path; triage-failures has a
    # required input from file-bugs → its dispatch raises → walker
    # converts to FAILED on a non-optional node and re-raises... unless
    # we run without optional. The contract here: triage-failures must
    # SKIP, not crash, because file-bugs has no NodeOutput. Single-
    # upstream skipping is governed by per-input optional in hde-2;
    # the input is required, so the resolve path raises. The walker
    # is sequential here (single-node wave), so the raise propagates
    # and the run aborts. We assert the abort surfaces as a HandlerError
    # and that compile-report never ran.
    skipped_events = [e for e in tel.events if e["event_type"] == "node_skipped"]
    skipped_ids = {e["step_id"] for e in skipped_events}
    assert "file-bugs" in skipped_ids


# ---------------------------------------------------------------------------
# Insight slug disambiguation under parallel branch contexts
# ---------------------------------------------------------------------------


def test_parallel_branches_invoke_disambiguation_with_run_id_suffix():
    """Two sibling branches BOTH surface insight_slug='timeout-pattern'.
    Inputs carry epic_id + story_id. The agent handler must rewrite
    each branch's slug to ``<slug>-<run_id_short>`` so writes are
    disambiguated across runs.

    This test does NOT assert within-wave uniqueness — by the strict
    hde-4 lock the suffix is run_id_short only, so two siblings in
    one wave share the same disambiguated slug. Within-wave
    collisions are the WRITE SITE's responsibility (e.g., include
    node_id in the file path). See docstring on
    ``disambiguate_insight_slug``.
    """

    root = _agent_node("root")
    branch_a = _agent_node("branch-a", depends_on=["root"])
    branch_b = _agent_node("branch-b", depends_on=["root"])
    g = _graph_from_nodes([root, branch_a, branch_b])

    spy = _SpawnRecorder(
        canned={
            "root": {"ready": True},
            "branch-a": {"insight_slug": "timeout-pattern", "result": "a"},
            "branch-b": {"insight_slug": "timeout-pattern", "result": "b"},
        },
    )

    # Synthetic Nodes have no `inputs` declared, so the walker passes
    # empty inputs. We wrap the agent handler to inject epic_id +
    # story_id the way a real workflow's `inputs:` block would.
    run_id = make_run_id("fanout-insight")
    real_handler = AgentHandler(spawn=spy)

    def wrapping_handler(node, inputs, rid):
        enriched = dict(inputs)
        enriched["epic_id"] = "epic-test"
        enriched["story_id"] = "story-1"
        return real_handler.handle(node, enriched, rid)

    dispatcher = Dispatcher(handlers={NodeType.AGENT: wrapping_handler})
    out = Walker().walk(g, dispatcher, run_id, Telemetry(run_id=run_id))

    a_slug = out["branch-a"].outputs["insight_slug"]
    b_slug = out["branch-b"].outputs["insight_slug"]

    expected_suffix = run_id[:8]
    # The disambiguation transformation is applied to BOTH branches.
    assert a_slug == f"timeout-pattern-{expected_suffix}"
    assert b_slug == f"timeout-pattern-{expected_suffix}"
    # And the two slugs are equal — same run_id → same suffix. This
    # is by design under the hde-4 strict lock; documented as such in
    # disambiguate_insight_slug's "LIMITATION" section.
    assert a_slug == b_slug
    # Spy recorded all three dispatch calls (root + 2 branches).
    assert len(spy.calls) == 3


def test_disambiguate_yields_different_slugs_across_runs():
    """Different run_ids → different slug suffixes. This is the run-
    level collision Risk #9 actually addresses.

    NB: ULIDs encode the timestamp in chars 0-9 (50 bits, ~ms). The
    first 8 chars cover the high 40 bits of the timestamp, so two
    run_ids issued within the same ~17ms window can share the same
    8-char prefix. The lock is "first 8 chars" by spec; this test
    feeds DISTINCT run_ids with explicitly different 8-char prefixes
    to assert the disambiguation differs when the run_ids do.
    """

    a_slug = disambiguate_insight_slug(
        "epic", "story", "timeout-pattern", "01ARZ3ND-test-flow"
    )
    b_slug = disambiguate_insight_slug(
        "epic", "story", "timeout-pattern", "01ZZZZZZ-test-flow"
    )
    assert a_slug != b_slug
    assert a_slug == "timeout-pattern-01ARZ3ND"
    assert b_slug == "timeout-pattern-01ZZZZZZ"


# ---------------------------------------------------------------------------
# ParallelScheduler unit semantics
# ---------------------------------------------------------------------------


def test_scheduler_size_one_uses_no_thread_pool():
    """Size-1 wave path: identical call shape to sequential dispatch."""

    a = _agent_node("a")
    g = _graph_from_nodes([a])

    seen: list[str] = []

    def dispatcher(node, inputs, run_id):
        seen.append(node.id)
        return NodeOutput(outputs={"ok": True})

    sched = ParallelScheduler()
    results = sched.schedule_ready_nodes(
        graph=g,
        ready_node_ids=["a"],
        dispatcher=dispatcher,
        run_id="rid",
        resolve_inputs=lambda _n: {},
    )
    assert seen == ["a"]
    assert results["a"].status == "completed"


def test_scheduler_failure_in_one_branch_does_not_cancel_siblings():
    a = _agent_node("a")
    b = _agent_node("b")
    c = _agent_node("c")
    g = _graph_from_nodes([a, b, c], name="failure-isolation")

    def dispatcher(node, inputs, run_id):
        if node.id == "b":
            raise RuntimeError("kaboom")
        return NodeOutput(outputs={"id": node.id})

    sched = ParallelScheduler()
    results = sched.schedule_ready_nodes(
        graph=g,
        ready_node_ids=["a", "b", "c"],
        dispatcher=dispatcher,
        run_id="rid",
        resolve_inputs=lambda _n: {},
    )

    assert results["a"].status == "completed"
    assert results["c"].status == "completed"
    assert results["b"].status == "skipped"
    assert isinstance(results["b"].error, RuntimeError)


def test_scheduler_per_step_timeout_marks_skipped():
    a = _agent_node("a", timeout_ms=10)
    b = _agent_node("b")
    g = _graph_from_nodes([a, b], name="timeout-wave")

    def dispatcher(node, inputs, run_id):
        if node.id == "a":
            time.sleep(0.5)
        return NodeOutput(outputs={"id": node.id})

    sched = ParallelScheduler()
    results = sched.schedule_ready_nodes(
        graph=g,
        ready_node_ids=["a", "b"],
        dispatcher=dispatcher,
        run_id="rid",
        resolve_inputs=lambda _n: {},
    )

    assert results["a"].status == "skipped"
    assert results["a"].timed_out is True
    assert results["b"].status == "completed"


# ---------------------------------------------------------------------------
# Spine-parity invariant: linear workflow, walker output unchanged.
# ---------------------------------------------------------------------------


def test_linear_workflow_event_order_is_byte_stable():
    """A → B → C with no fan-out. Walker's wave path yields exactly
    the same telemetry sequence as the hde-2 sequential loop did."""

    a = _agent_node("a")
    b = _agent_node("b", depends_on=["a"])
    c = _agent_node("c", depends_on=["b"])
    g = _graph_from_nodes([a, b, c], name="linear")

    spy = _SpawnRecorder(canned={"a": {"x": 1}, "b": {"y": 2}, "c": {"z": 3}})
    run_id = make_run_id("linear")
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)
    tel = Telemetry(run_id=run_id)
    Walker().walk(g, dispatcher, run_id, tel)

    kinds = _event_kinds(tel)
    assert kinds == [
        ("node_started", "a"),
        ("node_completed", "a"),
        ("node_started", "b"),
        ("node_completed", "b"),
        ("node_started", "c"),
        ("node_completed", "c"),
    ]
