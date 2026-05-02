"""Spine parity test — code-review.workflow.yaml runs E2E with diff-zero.

Per the parity-bar normalisation clause in vertical-plan.md §1:
"events compared on event_type + payload, IGNORING timestamps, run_id,
and any other path-introduced identifiers; equality is STRUCTURAL not
byte-exact."

The orchestrator-narrated path is the contract today: for each step
in the workflow's declared order, the orchestrator narrates a "step
started → agent invoked → step completed" sequence and stores each
agent's output keyed by step id. The executor path is the runtime
substitute — same sequence, machine-driven. The diff bar is therefore:

  1. Same set of (event_type, step_id) pairs in the same order, where
     timestamps, run_id, event_id, and the executor-default fields are
     stripped.
  2. Same materialised output set (step_id → output_names).

This test does NOT exercise step_file passing because
code-review.workflow.yaml uses inline `task:` strings with no
`step_file:` references — that branch of the agent handler is covered
in `test_handlers_agent.py::test_step_file_content_passed_verbatim`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.handlers import AgentHandler, StubAgentSpawn
from hive.lib.dag_executor.executor.run_id import make_run_id
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker
from hive.lib.dag_executor.graph import NodeType, load_workflow


REPO_ROOT = Path(__file__).resolve().parents[5]
SPINE_FIXTURE = REPO_ROOT / "hive" / "workflows" / "code-review.workflow.yaml"


# Canned outputs for the stub agent — deterministic, keyed by step id.
# Mirrors what the orchestrator-narrated path would synthesise from
# each agent's reply.
_CANNED = {
    "analyze": {"scope_analysis": "scope: 3 files, 1 module, 0 high-risk areas"},
    "review": {
        "review_verdict": "passed",
        "review_findings": "no critical issues",
    },
    "summarize": {"review_summary": "verdict=passed, no critical findings"},
}


# Path-stripped fields. Anything in this set is removed before the
# structural diff so timestamps and run_id (path-introduced
# identifiers per the parity clause) don't make the diff fail.
_NORMALISE_STRIP = {
    "run_id",
    "timestamp",
    "event_id",
    "metric_type",
    "value",
    "unit",
    "dimensions",
    "source",
}


def _normalise(event: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in event.items() if k not in _NORMALISE_STRIP}


def _orchestrator_narrated_events() -> list[dict[str, Any]]:
    """The expected event sequence under the orchestrator-narrated path.

    For code-review.workflow.yaml, the orchestrator's narration produces
    `node_started → node_completed` for each step in topological order.
    Materialised output names mirror each step's declared `outputs`.
    """
    graph = load_workflow(SPINE_FIXTURE)
    expected: list[dict[str, Any]] = []
    for step_id in ["analyze", "review", "summarize"]:
        node = graph.nodes[step_id]
        expected.append({"event_type": "node_started", "step_id": step_id})
        expected.append(
            {
                "event_type": "node_completed",
                "step_id": step_id,
                "outputs": [o.name for o in node.outputs],
            }
        )
    return expected


def _executor_events() -> tuple[list[dict[str, Any]], dict[str, list[str]]]:
    """Walk the spine workflow through the executor with stub agent handler."""
    graph = load_workflow(SPINE_FIXTURE)
    run_id = make_run_id("code-review")
    spy = StubAgentSpawn(canned_outputs=_CANNED)
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)
    telemetry = Telemetry(run_id=run_id)
    materialised = Walker().walk(
        graph,
        dispatcher,
        run_id,
        telemetry,
        context={"diff_content": "<<diff>>"},
    )
    output_names = {sid: list(out.outputs.keys()) for sid, out in materialised.items()}
    return [_normalise(e) for e in telemetry.events], output_names


def test_spine_parity_event_sequence_diffs_to_zero():
    actual, _ = _executor_events()
    expected = _orchestrator_narrated_events()
    assert actual == expected, (
        "executor event sequence diverges from orchestrator-narrated path:\n"
        f"  expected: {expected}\n"
        f"  actual:   {actual}"
    )


def test_spine_parity_materialised_outputs_diff_to_zero():
    """Each step's materialised output names must match the workflow declaration."""
    _, output_names = _executor_events()
    graph = load_workflow(SPINE_FIXTURE)
    for step_id in ["analyze", "review", "summarize"]:
        declared = sorted(o.name for o in graph.nodes[step_id].outputs)
        actual = sorted(output_names.get(step_id, []))
        assert actual == declared, (
            f"step {step_id!r}: expected outputs {declared}, got {actual}"
        )


def test_spine_parity_every_event_carries_run_id():
    """Observability lock: NO emit path bypasses run_id stamping."""
    graph = load_workflow(SPINE_FIXTURE)
    run_id = make_run_id("code-review")
    spy = StubAgentSpawn(canned_outputs=_CANNED)
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)
    telemetry = Telemetry(run_id=run_id)
    Walker().walk(graph, dispatcher, run_id, telemetry, context={"diff_content": "<<diff>>"})

    assert telemetry.events, "executor produced zero events"
    for event in telemetry.events:
        assert event["run_id"] == run_id


def test_spine_parity_agent_handler_invoked_with_raw_developer_string():
    """Risk #2 HIGH defense at the spine level: workflow YAML uses
    `agent: researcher` and `agent: reviewer` — the spy MUST receive
    those raw strings unchanged, never resolved to a sub-persona."""
    graph = load_workflow(SPINE_FIXTURE)
    run_id = make_run_id("code-review")
    spy = StubAgentSpawn(canned_outputs=_CANNED)
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)
    Walker().walk(
        graph,
        dispatcher,
        run_id,
        Telemetry(run_id=run_id),
        context={"diff_content": "<<diff>>"},
    )

    raw_agents = [c["agent"] for c in spy.calls]
    declared_agents = [graph.nodes[s].agent for s in ["analyze", "review", "summarize"]]
    assert raw_agents == declared_agents, (
        f"agent strings were transformed before agent-spawn: {raw_agents} != {declared_agents}"
    )
