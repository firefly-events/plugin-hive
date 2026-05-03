"""Doc-grep lock for the AND-of-empty routing rule.

The meta-2026-04-29 nightly cycle routed 8 findings into step-03b
backlog-fallback because `metric_signal: false` was conflated with
"nothing actionable to do". The fix was a routing rule clarification
across multiple docs (step files + maintainer/public skill files +
workflow YAML). Memory `feedback_metric_signal_findings_conflation`
records the lesson; the prose lock at
`tests/meta_meta/test_routing_findings.py` pins the
MANDATORY EXECUTION RULES wording.

This file pins the SAME contract across the additional surfaces hde-3b
introduced or touched:

  1. step-02-analysis.md (OUTPUT FORMAT block + metric_signal note)
  2. step-03-proposal.md (ROUTING GATE section)
  3. step-03b-backlog-fallback.md (eligibility check)
  4. meta-team-cycle.workflow.yaml (when: predicates)
  5. maintainer-skills/meta-meta-optimize/SKILL.md (canonical fixture)

Each doc must reference both `metric_signal` and the AND-of-empty rule
(or its concrete predicate form). If any of the 5 lose that wording,
this test fails — the regression scenario is back in play.

Add new docs that encode the rule by extending ``ROUTING_DOCS``.
"""

from __future__ import annotations

from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]


ROUTING_DOCS = [
    REPO_ROOT / "hive/workflows/steps/meta-team-cycle/step-02-analysis.md",
    REPO_ROOT / "hive/workflows/steps/meta-team-cycle/step-03-proposal.md",
    REPO_ROOT / "hive/workflows/steps/meta-team-cycle/step-03b-backlog-fallback.md",
    REPO_ROOT / "hive/workflows/meta-team-cycle.workflow.yaml",
    REPO_ROOT / "maintainer-skills/meta-meta-optimize/SKILL.md",
]


@pytest.mark.parametrize("doc", ROUTING_DOCS, ids=lambda p: p.name)
def test_doc_references_metric_signal(doc: Path):
    text = doc.read_text(encoding="utf-8")
    assert "metric_signal" in text, (
        f"{doc.relative_to(REPO_ROOT)} must reference metric_signal — the "
        "AND-of-empty routing rule depends on it. See memory "
        "feedback_metric_signal_findings_conflation."
    )


@pytest.mark.parametrize("doc", ROUTING_DOCS, ids=lambda p: p.name)
def test_doc_encodes_and_of_empty_rule(doc: Path):
    """Each doc must encode the AND-of-empty rule either by its prose
    label or by a concrete predicate form (workflow YAML uses the
    predicate; step files use the prose label; skill files use both)."""

    text = doc.read_text(encoding="utf-8")
    has_label = "AND-of-empty" in text
    # Concrete predicate form — analysis output dotpath OR/AND wiring.
    has_predicate_or = (
        "$analysis.output.findings_count > 0"
        in text
    )
    has_predicate_and = (
        "$analysis.output.findings_count == 0"
        in text
    )
    # The routing-target step files describe the rule in prose without
    # using the literal label; they must spell out the three-input
    # eligibility wording instead.
    has_prose_rule = (
        "zero findings AND zero external" in text
        or "zero findings AND zero external_research_candidates" in text
        or "ANY of the three actionable" in text
        or "all three actionable inputs" in text
    )
    assert has_label or has_predicate_or or has_predicate_and or has_prose_rule, (
        f"{doc.relative_to(REPO_ROOT)} lost the AND-of-empty rule wording. "
        "Re-add the prose label, the concrete `when:` predicate, or the "
        "three-input eligibility prose. See "
        "tests/meta_meta/test_routing_findings.py for the original lock and "
        "memory feedback_metric_signal_findings_conflation for context."
    )


def test_workflow_yaml_when_predicates_match_canonical_form():
    """The canonical 3-clause OR / AND predicates wired in
    meta-team-cycle.workflow.yaml are the executor-facing encoding of
    the AND-of-empty rule. They must NOT silently regress to a
    single-signal `metric_signal == true` form (the brief's literal
    AC #5/#6 wording, which would re-introduce the meta-2026-04-29
    conflation bug)."""

    text = (REPO_ROOT / "hive/workflows/meta-team-cycle.workflow.yaml").read_text(
        encoding="utf-8"
    )
    expected_or = (
        '"$analysis.output.findings_count > 0 || '
        "$analysis.output.metric_signal == true || "
        '$external-research.output.external_candidates_count > 0"'
    )
    expected_and = (
        '"$analysis.output.findings_count == 0 && '
        "$analysis.output.metric_signal == false && "
        '$external-research.output.external_candidates_count == 0"'
    )
    assert expected_or in text, (
        "step-03 `when:` predicate has drifted from the canonical "
        "AND-of-empty (OR-of-non-empty) form. See "
        "feedback_metric_signal_findings_conflation."
    )
    assert expected_and in text, (
        "step-03b `when:` predicate has drifted from the canonical "
        "AND-of-empty form. See feedback_metric_signal_findings_conflation."
    )
