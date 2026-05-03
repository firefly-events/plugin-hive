"""Walker-integration tests for hde-3a routing.

Covers:
  * `when:` predicate False → node skipped + ``predicate_evaluated``
    event emitted with ``result: false``.
  * `when:` predicate True → node runs as normal.
  * Invalid `when:` predicate (parse error) → fail-closed skip.
  * Multi-upstream join with `none_failed_min_one_success`:
      - both upstream COMPLETED → RUN
      - all upstream SKIPPED (via `when` cascade) → SKIP
      - mixed COMPLETED + SKIPPED → RUN (≥1 success).

Spine-parity invariant is also touched: a graph with NO `when:` and no
multi-upstream joins must produce IDENTICAL telemetry to the hde-2
path (covered by ``test_spine_parity.py``; this file is the
complement, exercising new wiring without breaking the old).
"""

from __future__ import annotations

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.handlers import NodeOutput
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker
from hive.lib.dag_executor.graph import (
    ConditionalEdge,
    Graph,
    Node,
    NodeType,
)


def _agent(node_id: str, depends_on=None, **kw) -> Node:
    return Node(
        id=node_id,
        agent="developer",
        node_type=NodeType.AGENT,
        depends_on=depends_on or [],
        **kw,
    )


def _graph(nodes: list[Node]) -> Graph:
    edges = [
        ConditionalEdge(from_node_id=p, to_node_id=n.id)
        for n in nodes
        for p in n.depends_on
    ]
    return Graph(workflow_name="test", nodes={n.id: n for n in nodes}, edges=edges)


def _stub_dispatcher(outputs: dict[str, dict]) -> Dispatcher:
    def handler(node, inputs, run_id):
        return NodeOutput(outputs=dict(outputs.get(node.id, {})))

    return Dispatcher(handlers={NodeType.AGENT: handler})


def _event_kinds(tel: Telemetry) -> list[tuple[str, str]]:
    return [(e["event_type"], e["step_id"]) for e in tel.events]


# --- when: predicate -----------------------------------------------------


def test_when_predicate_false_skips_downstream():
    a = _agent("a")
    b = _agent("b", depends_on=["a"], when="$a.output.signal == true")
    g = _graph([a, b])
    tel = Telemetry(run_id="rid")
    out = Walker().walk(
        g,
        _stub_dispatcher({"a": {"signal": False}}),
        "rid",
        tel,
    )
    assert "a" in out
    # `b` was skipped because the predicate is false.
    assert "b" not in out
    kinds = _event_kinds(tel)
    assert ("predicate_evaluated", "b") in kinds
    assert ("node_skipped", "b") in kinds


def test_when_predicate_true_runs_node():
    a = _agent("a")
    b = _agent("b", depends_on=["a"], when="$a.output.signal == true")
    g = _graph([a, b])
    tel = Telemetry(run_id="rid")
    out = Walker().walk(
        g,
        _stub_dispatcher({"a": {"signal": True}, "b": {"ok": True}}),
        "rid",
        tel,
    )
    assert "a" in out and "b" in out
    kinds = _event_kinds(tel)
    assert ("predicate_evaluated", "b") in kinds
    assert ("node_completed", "b") in kinds


def test_when_invalid_predicate_fails_closed_to_skip():
    a = _agent("a")
    b = _agent("b", depends_on=["a"], when="(garbage)")
    g = _graph([a, b])
    tel = Telemetry(run_id="rid")
    out = Walker().walk(
        g,
        _stub_dispatcher({"a": {"signal": True}}),
        "rid",
        tel,
    )
    assert "b" not in out
    pred_events = [e for e in tel.events if e["event_type"] == "predicate_evaluated"]
    assert pred_events
    payload = pred_events[0]["payload"]
    assert payload["result"] is False
    assert payload.get("fail_closed") is True


def test_when_predicate_against_missing_field_fails_closed():
    a = _agent("a")
    b = _agent("b", depends_on=["a"], when="$a.output.does_not_exist == true")
    g = _graph([a, b])
    tel = Telemetry(run_id="rid")
    out = Walker().walk(
        g,
        _stub_dispatcher({"a": {"signal": True}}),
        "rid",
        tel,
    )
    assert "b" not in out


# --- trigger_rule at multi-upstream joins -------------------------------


def test_join_runs_when_at_least_one_upstream_completed():
    a = _agent("a")
    b = _agent("b", when="$a.output.signal == true")  # standalone, will skip
    c = _agent("c", depends_on=["a", "b"])
    g = _graph([a, b, c])
    tel = Telemetry(run_id="rid")
    out = Walker().walk(
        g,
        _stub_dispatcher({"a": {"signal": False}, "c": {"ok": True}}),
        "rid",
        tel,
    )
    # `b` skipped via when, `a` completed → join `c` runs (≥1 success).
    assert "a" in out and "c" in out
    assert "b" not in out


def test_join_skips_when_all_upstreams_skipped():
    # Root nodes that get skipped via `when:`-on-root predicate would
    # be rejected at parse time (no upstream to reference). To
    # legitimately produce a SKIP-only fan-in, gate two upstreams via
    # a true root that publishes a flag both downstreams check.
    root = _agent("root")
    left = _agent("left", depends_on=["root"], when="$root.output.flag == true")
    right = _agent("right", depends_on=["root"], when="$root.output.flag == true")
    join = _agent("join", depends_on=["left", "right"])
    g = _graph([root, left, right, join])
    tel = Telemetry(run_id="rid")
    out = Walker().walk(
        g,
        _stub_dispatcher({"root": {"flag": False}}),
        "rid",
        tel,
    )
    assert "root" in out
    assert "left" not in out and "right" not in out
    # Join skipped under none_failed_min_one_success.
    assert "join" not in out
    skipped_events = [
        e for e in tel.events
        if e["event_type"] == "node_skipped" and e["step_id"] == "join"
    ]
    assert skipped_events
    assert skipped_events[0]["payload"]["reason"].startswith("trigger_rule:")


def test_join_runs_with_mixed_completed_and_skipped():
    root = _agent("root")
    left = _agent("left", depends_on=["root"], when="$root.output.flag == true")
    right = _agent("right", depends_on=["root"])  # always runs
    join = _agent("join", depends_on=["left", "right"])
    g = _graph([root, left, right, join])
    tel = Telemetry(run_id="rid")
    out = Walker().walk(
        g,
        _stub_dispatcher(
            {
                "root": {"flag": False},
                "right": {"ok": True},
                "join": {"ok": True},
            }
        ),
        "rid",
        tel,
    )
    # left skipped, right completed → join still runs (≥1 success).
    assert "left" not in out
    assert "right" in out and "join" in out
