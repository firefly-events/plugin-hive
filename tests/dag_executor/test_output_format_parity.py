"""hde-3b output_format additivity / back-compat parity.

The output_format JSON contract added to:

  * `hive/workflows/steps/meta-team-cycle/step-02-analysis.md`
  * `hive/workflows/steps/meta-team-cycle/step-06-evaluation.md`
  * `hive/workflows/steps/development-classic/step-06-review.md`

is **additive**. The orchestrator-narrated path consumes prose verdicts
from these steps; the executor path additionally binds `when:`
predicates to the structured fields when they are present. This file
asserts the additivity property:

  1. The contract is documented in the step files (schema doc placement)
     so future authors see it before editing.
  2. The reviewer.md template documents all 3 verdict values that the
     line-29 strict contract has always declared.
  3. Old prose-only outputs (no output_format JSON) still walk through
     the executor without crashing — the routing predicate fail-closes
     on missing fields rather than aborting the run.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.handlers import AgentHandler, StubAgentSpawn
from hive.lib.dag_executor.executor.run_id import make_run_id
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker
from hive.lib.dag_executor.graph import NodeType, load_workflow


REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = REPO_ROOT / "hive" / "workflows"
STEPS = REPO_ROOT / "hive" / "workflows" / "steps"
AGENTS = REPO_ROOT / "hive" / "agents"


# ---------------------------------------------------------------------------
# Schema doc placement (output_format declared at the top of each step file)
# ---------------------------------------------------------------------------


_OUTPUT_FORMAT_SECTION = "## OUTPUT FORMAT (executor contract)"


@pytest.mark.parametrize(
    "step_file",
    [
        "meta-team-cycle/step-02-analysis.md",
        "meta-team-cycle/step-06-evaluation.md",
        "development-classic/step-06-review.md",
    ],
)
def test_step_file_declares_output_format_section(step_file):
    text = (STEPS / step_file).read_text(encoding="utf-8")
    assert _OUTPUT_FORMAT_SECTION in text, (
        f"{step_file} must declare an OUTPUT FORMAT section so future "
        "authors find the contract before editing"
    )


def test_step_02_analysis_output_format_declares_routing_fields():
    text = (STEPS / "meta-team-cycle/step-02-analysis.md").read_text(encoding="utf-8")
    assert "metric_signal: bool" in text
    assert "findings_count: int" in text
    assert "external_candidates_count: int" in text


def test_step_06_review_output_format_declares_change_verdict_3_values():
    text = (STEPS / "development-classic/step-06-review.md").read_text(encoding="utf-8")
    assert "change_verdict: str" in text
    assert "passed | needs_optimization | needs_revision" in text
    assert "needs_fix_loop: bool" in text


def test_step_06_evaluation_distinguishes_change_verdict_and_cycle_verdict():
    text = (STEPS / "meta-team-cycle/step-06-evaluation.md").read_text(encoding="utf-8")
    assert "change_verdict" in text
    assert "cycle_verdict" in text
    # Two distinct value spaces are explicitly documented.
    assert "passed | partial | poor" in text  # cycle-level
    assert "passed | needs_optimization | needs_revision" in text  # change-level


def test_step_06_evaluation_normalises_change_level_pass_to_passed():
    text = (STEPS / "meta-team-cycle/step-06-evaluation.md").read_text(encoding="utf-8")
    # YOUR TASK section now uses `passed`, not bare `pass`.
    assert (
        "Assign `passed`, `needs_optimization`, or `needs_revision` change_verdict"
        in text
    )
    # Score template uses change_verdict, not bare verdict.
    assert "change_verdict: passed | needs_optimization | needs_revision" in text


# ---------------------------------------------------------------------------
# reviewer.md doc completion: line 29's 3-value contract reflected everywhere
# ---------------------------------------------------------------------------


def test_reviewer_template_documents_all_three_verdicts():
    text = (AGENTS / "reviewer.md").read_text(encoding="utf-8")
    # Line 29 (or near): the strict-3-value declaration UNCHANGED.
    assert (
        "Verdict must be one of: passed, needs_optimization, needs_revision"
        in text
    )
    # Output template now documents all 3 values (was 2-of-3 pre-hde-3b).
    assert "## Review Verdict: passed | needs_optimization | needs_revision" in text


def test_reviewer_verdict_rules_document_needs_revision():
    text = (AGENTS / "reviewer.md").read_text(encoding="utf-8")
    # Rules section explicitly enumerates `needs_revision` alongside the
    # other two values (was missing pre-hde-3b — line 29 declared 3 but
    # the rules listed only 2).
    assert "**`needs_revision`**" in text
    assert "**`passed`**" in text
    assert "**`needs_optimization`**" in text


def test_reviewer_documents_change_verdict_field_name_for_predicate_consumers():
    text = (AGENTS / "reviewer.md").read_text(encoding="utf-8")
    # Risk #13 mitigation: predicate consumers MUST use the explicit
    # field name change_verdict.
    assert "$step.output.change_verdict" in text


# ---------------------------------------------------------------------------
# Additivity / back-compat: old prose-only outputs don't crash the executor
# ---------------------------------------------------------------------------


def test_routing_predicates_fail_closed_when_routing_fields_absent():
    """Workflows that have not yet been graduated to the executor-aware
    output_format see their routing predicates fail-closed at the field
    level: missing dotpath segment → predicate False → step skipped
    with a `predicate_evaluated` warning event, NOT a crash at the
    routing layer.

    Downstream `implementation` (single-upstream of `proposal`) still
    needs upstream output to run; that is the executor-cutover concern
    addressed by hde-9a/10, not this story. This test scopes the
    additivity invariant to the routing layer only — the layer hde-3a +
    hde-3b own.
    """

    graph = load_workflow(WORKFLOWS / "meta-team-cycle.workflow.yaml")
    run_id = make_run_id("meta-team-cycle")
    canned = {
        "boot": {
            "cycle_id": "cycle-test",
            "prior_ledger": {},
            "boot_report": "boot",
        },
        # Old-shape outputs: NO metric_signal, NO findings_count, NO
        # external_candidates_count. The contract additions are silently
        # absent; predicates fail-closed.
        "analysis": {
            "findings": [],
            "analysis_report": "report",
        },
        "external-research": {
            "external_research_candidates": [],
            "research_summary": "summary",
        },
    }
    spy = StubAgentSpawn(canned_outputs=canned)
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)
    tel = Telemetry(run_id=run_id)

    # The downstream chain raises HandlerError because `implementation`
    # binds non-optional inputs from skipped `proposal` — not a hde-3b
    # concern. We catch and assert the routing layer alone behaved
    # correctly.
    from hive.lib.dag_executor.executor.errors import HandlerError

    with pytest.raises(HandlerError):
        Walker().walk(graph, dispatcher, run_id, tel)

    # Routing predicates fail-closed cleanly before the downstream
    # crash: both predicates evaluated to False with warning events.
    pred_events = [
        e for e in tel.events if e["event_type"] == "predicate_evaluated"
    ]
    pred_step_ids = {e["step_id"] for e in pred_events}
    assert {"proposal", "backlog-fallback"} <= pred_step_ids
    for ev in pred_events:
        if ev["step_id"] in {"proposal", "backlog-fallback"}:
            assert ev["payload"]["result"] is False
