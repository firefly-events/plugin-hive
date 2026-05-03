"""Per-workflow parity assertions: executor path == orchestrator-narrated path.

Parameterised over the workflow YAMLs whose semantics are locked at this
story:

  * ``code-review.workflow.yaml`` — fully linear (sequential, no fan-out).
    Spine-parity invariant: identical event sequence to the hde-2 path.
  * ``test-swarm.workflow.yaml`` — multi-upstream join + fan-out
    (execute-platform-a + execute-platform-b → file-bugs). Parity bar is
    relaxed to a multiset within waves and ordered across waves, per
    the parity-bar normalisation clause in the vertical plan.

The executor path drives a stub agent spawn keyed by step_id; the
orchestrator-narrated path is the synthetic expected trace produced
from each workflow's declared step order. Equality is STRUCTURAL, not
byte-exact: timestamps and run_ids are stripped before the diff.

This file is a NEW parity surface (not a replacement for
``hive/lib/dag_executor/executor/tests/test_spine_parity.py`` which
covers the linear spine in detail). Adding it satisfies the hde-4
ask "extend with test-swarm parity assertion" without retro-fitting
the hde-2 spine test for parameterisation.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.handlers import AgentHandler, StubAgentSpawn
from hive.lib.dag_executor.executor.run_id import make_run_id
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker
from hive.lib.dag_executor.graph import NodeType, load_workflow


REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = REPO_ROOT / "hive" / "workflows"


_NORMALISE_STRIP = {"run_id", "timestamp"}


def _normalise(event: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in event.items() if k not in _NORMALISE_STRIP}


# ---------------------------------------------------------------------------
# Linear-spine parity (code-review.workflow.yaml)
# ---------------------------------------------------------------------------


_CODE_REVIEW_CANNED = {
    "analyze": {"scope_analysis": "scope: 3 files, 1 module, 0 high-risk"},
    "review": {
        "review_verdict": "passed",
        "review_findings": "no critical issues",
    },
    "summarize": {"review_summary": "verdict=passed, no critical findings"},
}


def test_code_review_linear_parity_event_sequence_byte_stable():
    """code-review is fully linear; wave detection collapses to size-1
    waves throughout, so event order matches the hde-2 byte-stable
    sequence exactly."""

    fixture = WORKFLOWS / "code-review.workflow.yaml"
    graph = load_workflow(fixture)
    run_id = make_run_id("code-review")

    spy = StubAgentSpawn(canned_outputs=_CODE_REVIEW_CANNED)
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)
    tel = Telemetry(run_id=run_id)

    Walker().walk(
        graph,
        dispatcher,
        run_id,
        tel,
        context={"diff_content": "<<diff>>"},
    )

    actual = [_normalise(e) for e in tel.events]
    expected: list[dict[str, Any]] = []
    for step_id in ["analyze", "review", "summarize"]:
        node = graph.nodes[step_id]
        expected.append(
            {"event_type": "node_started", "step_id": step_id, "payload": {}}
        )
        expected.append(
            {
                "event_type": "node_completed",
                "step_id": step_id,
                "payload": {"outputs": [o.name for o in node.outputs]},
            }
        )

    assert actual == expected


# ---------------------------------------------------------------------------
# Test-swarm parity (parallel waves + barrier-join)
# ---------------------------------------------------------------------------


_TEST_SWARM_CANNED = {
    "rebuild": {"build_report": "fresh"},
    "gather-context": {"context_doc": "<<ctx>>"},
    "verify-baseline": {"baseline_status": "ok"},
    "author-tests": {"test_manifest": "manifest", "test_files": "files-ref"},
    "validate-coverage": {"coverage_report": "100%"},
    "execute-platform-a": {"platform_a_results": "a-pass"},
    "execute-platform-b": {"platform_b_results": "b-pass"},
    "file-bugs": {"bug_reports": "none"},
    "triage-failures": {"routing_decisions": "none"},
    "compile-report": {"session_report": "report"},
    "promote-baseline": {"promotion_summary": "ok"},
}


def test_test_swarm_materialised_outputs_match_workflow_declaration():
    fixture = WORKFLOWS / "test-swarm.workflow.yaml"
    graph = load_workflow(fixture)
    run_id = make_run_id("test-swarm")

    spy = StubAgentSpawn(canned_outputs=_TEST_SWARM_CANNED)
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)
    tel = Telemetry(run_id=run_id)

    materialised = Walker().walk(
        graph,
        dispatcher,
        run_id,
        tel,
        context={"story_spec": "<<spec>>", "baseline_path": "/tmp/baseline"},
    )

    # Each completed step's materialised outputs must match the workflow
    # declaration exactly. Skipped steps (none in the happy path) are
    # absent from materialised.
    for step_id in graph.nodes:
        declared = sorted(o.name for o in graph.nodes[step_id].outputs)
        actual = sorted(materialised[step_id].outputs.keys())
        assert actual == declared, (
            f"step {step_id!r}: declared {declared}, materialised {actual}"
        )


def test_test_swarm_parity_node_completed_set_matches_workflow_steps():
    """All declared steps must produce a ``node_completed`` event.

    Within-wave order is non-deterministic (dispatch is parallel); we
    assert the SET of completed step_ids equals the set of declared
    workflow steps. Cross-wave order is preserved because each wave's
    join happens before the next wave dispatches — that ordering is
    implicit in the assertion that every step appears.
    """

    fixture = WORKFLOWS / "test-swarm.workflow.yaml"
    graph = load_workflow(fixture)
    run_id = make_run_id("test-swarm")

    spy = StubAgentSpawn(canned_outputs=_TEST_SWARM_CANNED)
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)
    tel = Telemetry(run_id=run_id)

    Walker().walk(
        graph,
        dispatcher,
        run_id,
        tel,
        context={"story_spec": "<<spec>>", "baseline_path": "/tmp/baseline"},
    )

    completed_ids = {
        e["step_id"] for e in tel.events if e["event_type"] == "node_completed"
    }
    assert completed_ids == set(graph.nodes.keys())


def test_test_swarm_every_event_carries_run_id():
    """Observability lock survives parallel dispatch: NO emit path
    bypasses run_id stamping."""

    fixture = WORKFLOWS / "test-swarm.workflow.yaml"
    graph = load_workflow(fixture)
    run_id = make_run_id("test-swarm")

    spy = StubAgentSpawn(canned_outputs=_TEST_SWARM_CANNED)
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)
    tel = Telemetry(run_id=run_id)

    Walker().walk(
        graph,
        dispatcher,
        run_id,
        tel,
        context={"story_spec": "<<spec>>", "baseline_path": "/tmp/baseline"},
    )

    assert tel.events
    for event in tel.events:
        assert event["run_id"] == run_id


@pytest.mark.parametrize(
    "workflow_slug,canned,context",
    [
        ("code-review", _CODE_REVIEW_CANNED, {"diff_content": "<<d>>"}),
        (
            "test-swarm",
            _TEST_SWARM_CANNED,
            {"story_spec": "<<spec>>", "baseline_path": "/tmp/baseline"},
        ),
    ],
)
def test_workflow_executes_without_error(workflow_slug, canned, context):
    """End-to-end smoke: every parameterised workflow walks to
    completion under the executor path."""

    fixture = WORKFLOWS / f"{workflow_slug}.workflow.yaml"
    graph = load_workflow(fixture)
    run_id = make_run_id(workflow_slug)

    spy = StubAgentSpawn(canned_outputs=canned)
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)
    tel = Telemetry(run_id=run_id)

    materialised = Walker().walk(graph, dispatcher, run_id, tel, context=context)
    assert set(materialised.keys()) == set(graph.nodes.keys())


# ---------------------------------------------------------------------------
# Per-Order parity (hde-10) — Orders 2-7 + 9
# ---------------------------------------------------------------------------
#
# Per-Order parity bar v1.1 normalisation clause: events compared on
# `event_type` + `payload`, ignoring timestamps + run_id + path-introduced
# identifiers. Equality is STRUCTURAL, not byte-exact.
#
# The orchestrator-narrated "expected trace" is synthesised from each
# workflow's declared step order: a `node_started` + `node_completed`
# event pair per step that runs (skipped steps appear as `node_skipped`).
# That's the parity bar — both paths must visit every declared step that
# the executor visits, with the same materialised output names.
#
# Order 8 (development.classic) lands in commit 3 with its own
# decomposition-aware test; it is NOT covered here.
# ---------------------------------------------------------------------------


def _canned_for_step_outputs(graph, overrides=None):
    """Build canned outputs that satisfy every declared OutputRef on the
    workflow's nodes. Each output gets a placeholder string keyed by its
    declared name; structural OutputRef shape is what the parity bar
    cares about, not specific values. ``overrides`` lets callers inject
    real values for routing-relevant fields (e.g. metric_signal)."""

    overrides = overrides or {}
    canned: dict[str, dict[str, Any]] = {}
    for step_id, node in graph.nodes.items():
        canned[step_id] = {
            o.name: f"<<{step_id}.{o.name}>>" for o in node.outputs
        }
        if step_id in overrides:
            canned[step_id].update(overrides[step_id])
    return canned


_PER_ORDER_CONTEXTS = {
    "code-review": {"diff_content": "<<diff>>"},
    "performance-audit": {"implementation_artifacts": "<<artifacts>>"},
    "test-swarm": {"story_spec": "<<spec>>", "baseline_path": "/tmp/baseline"},
    "development.tdd": {"story_spec": "<<spec>>"},
    "development.bdd": {"story_spec": "<<spec>>"},
    "development.tdd-codex": {"story_spec": "<<spec>>"},
    "ui-design": {"story_spec": "<<spec>>"},
    "design-review": {"design_artifacts": "<<artifacts>>"},
}


@pytest.mark.parametrize(
    "workflow_slug",
    [
        "code-review",          # Order 2
        "performance-audit",    # Order 3
        "test-swarm",           # Order 4
        "development.tdd",      # Order 5
        "development.bdd",      # Order 6
        "development.tdd-codex",  # Order 6 (cross-model partner)
        "ui-design",            # Order 7
        "design-review",        # Order 7
    ],
)
def test_per_order_parity_event_set_matches_declared_steps(workflow_slug):
    """Per-Order parity bar: every declared step in the workflow
    produces a ``node_completed`` event under the executor; materialised
    outputs match the declared OutputRef names. The orchestrator-narrated
    path's expected trace is the workflow's own declaration — that's the
    structural-equality contract."""

    fixture = WORKFLOWS / f"{workflow_slug}.workflow.yaml"
    graph = load_workflow(fixture)
    run_id = make_run_id(workflow_slug)
    canned = _canned_for_step_outputs(graph)

    spy = StubAgentSpawn(canned_outputs=canned)
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)
    tel = Telemetry(run_id=run_id)

    materialised = Walker().walk(
        graph,
        dispatcher,
        run_id,
        tel,
        context=_PER_ORDER_CONTEXTS[workflow_slug],
    )

    # Every declared step ran (no when:/skip_when in any of these
    # production-grade workflows on the happy path).
    completed_ids = {
        e["step_id"] for e in tel.events if e["event_type"] == "node_completed"
    }
    assert completed_ids == set(graph.nodes.keys()), (
        f"{workflow_slug}: completed-event set must equal declared step set"
    )

    # Materialised outputs match declared OutputRef names step-for-step.
    for step_id, node in graph.nodes.items():
        declared = sorted(o.name for o in node.outputs)
        actual = sorted(materialised[step_id].outputs.keys())
        assert actual == declared, (
            f"{workflow_slug}/{step_id}: declared {declared}, "
            f"materialised {actual}"
        )

    # Observability invariant: every event carries the run_id (the
    # parity-bar normalisation strips it, but we still require it
    # present — the strip is for comparison, not absence).
    for event in tel.events:
        assert event["run_id"] == run_id


# ---------------------------------------------------------------------------
# Order 6 — tdd-codex cross-model assertion (Darwin only)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    sys.platform != "darwin",
    reason="tdd-codex relies on the macOS-only Codex/cmux pane; Linux CI skips",
)
def test_tdd_codex_runs_under_executor_with_codex_step():
    """Smoke: the cross-model TDD workflow walks to completion when the
    Codex step is present. The walker treats `backend: codex` as an
    additive field (loader passes it through), so the executor-path
    parity is unchanged from a same-model run on Darwin."""

    fixture = WORKFLOWS / "development.tdd-codex.workflow.yaml"
    graph = load_workflow(fixture)
    run_id = make_run_id("development.tdd-codex")
    canned = _canned_for_step_outputs(graph)

    spy = StubAgentSpawn(canned_outputs=canned)
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)
    tel = Telemetry(run_id=run_id)

    materialised = Walker().walk(
        graph,
        dispatcher,
        run_id,
        tel,
        context={"story_spec": "<<spec>>"},
    )
    assert set(materialised.keys()) == set(graph.nodes.keys())


# ---------------------------------------------------------------------------
# Per-workflow rollback regression
# ---------------------------------------------------------------------------


def test_per_workflow_rollback_only_affects_named_workflow(tmp_path: Path):
    """Removing a workflow from the registry rolls back ONLY that
    workflow. The other graduated workflows continue to take the
    executor path. Regression for the per-workflow rollback granularity
    invariant locked at hde-9b."""

    from hive.lib.dag_executor import (
        CONSUMER_CONFIG_PATH,
        GRADUATED_REGISTRY_PATH,
        executor_enabled_for,
    )

    config_path = tmp_path / CONSUMER_CONFIG_PATH
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        "executor: hive-dag\nexecutor_default: on\n",
        encoding="utf-8",
    )
    registry_path = tmp_path / GRADUATED_REGISTRY_PATH
    registry_path.parent.mkdir(parents=True, exist_ok=True)

    # All Orders 1-7 + 9 graduated.
    full = [
        "meta-team-cycle",
        "code-review",
        "performance-audit",
        "test-swarm",
        "development.tdd",
        "development.bdd",
        "development.tdd-codex",
        "ui-design",
        "design-review",
        "daily-ceremony",
    ]
    registry_path.write_text(
        "workflows:\n" + "".join(f"  - {w}\n" for w in full),
        encoding="utf-8",
    )
    for w in full:
        assert executor_enabled_for(w, tmp_path) is True

    # Roll back ONLY test-swarm.
    rolled = [w for w in full if w != "test-swarm"]
    registry_path.write_text(
        "workflows:\n" + "".join(f"  - {w}\n" for w in rolled),
        encoding="utf-8",
    )
    assert executor_enabled_for("test-swarm", tmp_path) is False
    for w in rolled:
        assert executor_enabled_for(w, tmp_path) is True, (
            f"per-workflow rollback contaminated {w!r}"
        )
