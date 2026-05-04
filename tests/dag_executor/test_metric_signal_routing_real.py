"""Canonical hde-3a + hde-3b joint acceptance test.

Loads the real `meta-team-cycle.workflow.yaml`, drives stub agents that
emit the structured output_format JSON declared by step-02-analysis +
step-02b-external-research, and asserts that the executor walker
routes between step-03 (proposal) and step-03b (backlog-fallback)
according to the canonical AND-of-empty rule documented in:

  * `hive/workflows/steps/meta-team-cycle/step-02-analysis.md` OUTPUT FORMAT
  * `maintainer-skills/meta-meta-optimize/SKILL.md:80-98`
  * `tests/meta_meta/test_routing_findings.py` (the prose lock)

Once these tests pass, the prose branch in
`maintainer-skills/meta-meta-optimize/SKILL.md` is mechanical YAML
routing — that is the leverage hde-3b ships.
"""

from __future__ import annotations

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
META_TEAM_CYCLE = WORKFLOWS / "meta-team-cycle.workflow.yaml"


def _canned_outputs(
    *,
    findings_count: int,
    metric_signal: bool,
    external_candidates_count: int,
) -> dict[str, dict[str, Any]]:
    """Build per-step canned outputs for a routing scenario.

    Only `analysis`, `external-research`, and the two routing-target
    steps need plausible payloads — the rest of the cycle is canned
    with arbitrary non-empty outputs so the walker can dispatch them.
    """

    findings = [{"id": f"finding-{n}"} for n in range(findings_count)]
    external_candidates = [
        {"id": f"ext-{n}"} for n in range(external_candidates_count)
    ]
    return {
        "boot": {
            "cycle_id": "cycle-test",
            "prior_ledger": {},
            "boot_report": "boot",
        },
        "analysis": {
            "findings": findings,
            "analysis_report": "report",
            "metric_signal": metric_signal,
            "findings_count": findings_count,
        },
        "external-research": {
            "external_research_candidates": external_candidates,
            "research_summary": "summary",
            "external_candidates_count": external_candidates_count,
        },
        "proposal": {
            "approved_proposals": [],
            "skipped_proposals": [],
        },
        "backlog-fallback": {
            "backlog_dry_run_report": {"decision": "no-fallback-available"},
        },
        "implementation": {
            "changes_made": [],
            "implementation_report": "none",
        },
        "testing": {
            "test_results": [],
            "validation_report": "none",
        },
        "evaluation": {
            "evaluation_results": {"evaluations": [], "cycle_verdict": "passed"},
            "verdict": "passed",
        },
        "promotion": {
            "promoted_changes": [],
            "reverted_changes": [],
        },
        "close": {
            "morning_summary": "summary",
        },
    }


def _walk(canned: dict[str, dict[str, Any]]) -> tuple[Telemetry, dict]:
    graph = load_workflow(META_TEAM_CYCLE)
    run_id = make_run_id("meta-team-cycle")
    spy = StubAgentSpawn(canned_outputs=canned)
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)
    tel = Telemetry(run_id=run_id)
    materialised = Walker().walk(graph, dispatcher, run_id, tel)
    return tel, materialised


def _node_skipped_reasons(tel: Telemetry, step_id: str) -> list[str]:
    return [
        e["payload"].get("reason", "")
        for e in tel.events
        if e["event_type"] == "node_skipped" and e["step_id"] == step_id
    ]


# ---------------------------------------------------------------------------
# Canonical AND-of-empty routing fixture (hde-3a + hde-3b joint acceptance)
# ---------------------------------------------------------------------------


def test_metric_signal_alone_routes_to_proposal_skips_backlog_fallback():
    canned = _canned_outputs(
        findings_count=0,
        metric_signal=True,
        external_candidates_count=0,
    )
    _, materialised = _walk(canned)
    assert "proposal" in materialised
    assert "backlog-fallback" not in materialised


def test_findings_alone_with_no_metric_signal_routes_to_proposal():
    """Reproduces the meta-2026-04-29 regression scenario: 8 findings,
    metric_signal=false, zero external candidates. Must route to
    proposal (step-03), NOT backlog-fallback (step-03b)."""

    canned = _canned_outputs(
        findings_count=8,
        metric_signal=False,
        external_candidates_count=0,
    )
    _, materialised = _walk(canned)
    assert "proposal" in materialised
    assert "backlog-fallback" not in materialised


def test_external_candidates_alone_routes_to_proposal():
    canned = _canned_outputs(
        findings_count=0,
        metric_signal=False,
        external_candidates_count=3,
    )
    _, materialised = _walk(canned)
    assert "proposal" in materialised
    assert "backlog-fallback" not in materialised


def test_all_signals_empty_routes_to_backlog_fallback_skips_proposal():
    canned = _canned_outputs(
        findings_count=0,
        metric_signal=False,
        external_candidates_count=0,
    )
    tel, materialised = _walk(canned)
    assert "backlog-fallback" in materialised
    assert "proposal" not in materialised
    # Telemetry confirms the skip reason was the predicate, not trigger_rule.
    reasons = _node_skipped_reasons(tel, "proposal")
    assert "when_predicate_false" in reasons


def test_all_three_signals_present_routes_to_proposal():
    canned = _canned_outputs(
        findings_count=2,
        metric_signal=True,
        external_candidates_count=2,
    )
    _, materialised = _walk(canned)
    assert "proposal" in materialised
    assert "backlog-fallback" not in materialised


# ---------------------------------------------------------------------------
# Fail-closed semantics: missing required output_format field
# ---------------------------------------------------------------------------


def test_missing_metric_signal_field_fails_closed_to_skip():
    """When step-02-analysis omits the `metric_signal` field, the
    step-03 predicate's middle clause references a field the upstream
    didn't materialise. Per hde-3a's fail-closed contract, that clause
    is False; if the other two clauses are also False/empty, the whole
    OR resolves False and step-03 skips with a `predicate_evaluated`
    warning event — does NOT crash the run."""

    canned = _canned_outputs(
        findings_count=0,
        metric_signal=False,
        external_candidates_count=0,
    )
    # Strip the field so the predicate sees a missing dotpath segment.
    del canned["analysis"]["metric_signal"]
    tel, materialised = _walk(canned)

    # Run did not crash; analysis still completed.
    assert "analysis" in materialised
    # `proposal` skipped via fail-closed predicate.
    assert "proposal" not in materialised
    pred_events = [
        e
        for e in tel.events
        if e["event_type"] == "predicate_evaluated" and e["step_id"] == "proposal"
    ]
    assert pred_events, "expected at least one predicate_evaluated event for proposal"
    # The evaluator surfaces False either via parse fail-closed or by a
    # missing-field result-False — both are acceptable fail-closed paths.
    payload = pred_events[-1]["payload"]
    assert payload.get("result") is False


# ---------------------------------------------------------------------------
# Schema-aware assertions on step output structure
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "field,kind",
    [
        ("metric_signal", bool),
        ("findings_count", int),
    ],
)
def test_analysis_output_carries_routing_fields_in_declared_types(field, kind):
    canned = _canned_outputs(
        findings_count=4,
        metric_signal=True,
        external_candidates_count=0,
    )
    _, materialised = _walk(canned)
    assert field in materialised["analysis"].outputs
    assert isinstance(materialised["analysis"].outputs[field], kind)


def test_external_research_output_carries_count_in_declared_type():
    canned = _canned_outputs(
        findings_count=0,
        metric_signal=False,
        external_candidates_count=2,
    )
    _, materialised = _walk(canned)
    assert "external_candidates_count" in materialised["external-research"].outputs
    assert isinstance(
        materialised["external-research"].outputs["external_candidates_count"], int
    )
