"""Regression tests for the step-03 / step-03b routing rule.

Background: meta-2026-04-29 nightly cycle conflated `metric_signal: false`
with "no actionable input" and routed 8 structural findings into step-03b
backlog-fallback instead of step-03 proposal. The routing rule was
clarified to use an AND-of-empty gate across `findings`,
`external_research_candidates`, and `metric_signal`. These tests pin that
contract into both the step file and both SKILL.md routers (maintainer +
public) so the bug cannot silently regress.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path


STEP_03B = Path("hive/workflows/steps/meta-team-cycle/step-03b-backlog-fallback.md")
STEP_02 = Path("hive/workflows/steps/meta-team-cycle/step-02-analysis.md")
MAINTAINER_SKILL = Path("maintainer-skills/meta-meta-optimize/SKILL.md")
PUBLIC_SKILL = Path("skills/hive/skills/meta-optimize/SKILL.md")


def _section(text: str, start_header: str, end_header: str) -> str:
    start = text.index(start_header) + len(start_header)
    end = text.index(end_header, start)
    return text[start:end]


class Step03bRoutingGateTests(unittest.TestCase):
    """Step-03b's MANDATORY EXECUTION RULES must encode AND-of-empty gate."""

    def setUp(self) -> None:
        self.text = STEP_03B.read_text(encoding="utf-8")
        self.mandatory = _section(
            self.text,
            "## MANDATORY EXECUTION RULES (READ FIRST)",
            "## EXECUTION PROTOCOLS",
        )

    def test_routes_to_03b_only_when_all_three_empty(self) -> None:
        # ZERO findings AND ZERO external candidates AND no metric signal
        self.assertRegex(
            self.mandatory,
            r"ZERO\s+findings.*ZERO\s+external_research_candidates.*no metric signal",
        )

    def test_findings_force_step_03_route(self) -> None:
        self.assertIn(
            "If ANY of the three actionable inputs exist, the cycle MUST route to step-03-proposal",
            self.mandatory,
        )

    def test_metric_signal_documented_as_orthogonal(self) -> None:
        self.assertIn("perf-baseline-only flag", self.mandatory)
        self.assertIn("orthogonal to findings", self.mandatory)


class Step03bEligibilityCheckTests(unittest.TestCase):
    """The §1 eligibility check must reject misroutes."""

    def setUp(self) -> None:
        self.text = STEP_03B.read_text(encoding="utf-8")

    def test_findings_nonempty_returns_to_step_03(self) -> None:
        self.assertRegex(
            self.text,
            r"step 2 `findings` is non-empty:\s*STOP and return to step-03-proposal",
        )

    def test_external_candidates_nonempty_returns_to_step_03(self) -> None:
        self.assertRegex(
            self.text,
            r"`external_research_candidates` is non-empty:\s*STOP and return to step-03-proposal",
        )

    def test_metric_signal_present_returns_to_step_03(self) -> None:
        self.assertRegex(
            self.text,
            r"metric signal is present.*STOP and return to step-03-proposal",
        )

    def test_failure_mode_misroute_is_rejected(self) -> None:
        self.assertIn(
            "even though step 2 produced findings",
            self.text,
        )


class MaintainerSkillRoutingTests(unittest.TestCase):
    """maintainer-skills/.../SKILL.md must encode the same gate."""

    def setUp(self) -> None:
        self.text = MAINTAINER_SKILL.read_text(encoding="utf-8")
        self.section = _section(self.text, "### Step 3 Proposal", "### Step 4 Implementation")

    def test_step_03_runs_on_findings_or_external_or_metric(self) -> None:
        self.assertIn("`findings`", self.section)
        self.assertIn("`external_research_candidates`", self.section)
        self.assertIn("metric signal is present", self.section)

    def test_step_03b_only_when_all_three_empty(self) -> None:
        self.assertIn(
            "ONLY when ALL three are empty: zero findings AND zero external candidates AND no metric signal",
            self.section,
        )

    def test_metric_signal_orthogonal_to_findings(self) -> None:
        self.assertIn("orthogonal to findings", self.section)
        self.assertIn(
            "MUST route to step-03, not step-03b",
            self.section,
        )


class PublicSkillRoutingTests(unittest.TestCase):
    """skills/hive/skills/meta-optimize/SKILL.md must encode the same gate."""

    def setUp(self) -> None:
        self.text = PUBLIC_SKILL.read_text(encoding="utf-8")
        self.section = _section(self.text, "### Step 3 Proposal", "### Step 4 Implementation")

    def test_step_03_runs_on_findings_or_external_or_metric(self) -> None:
        self.assertIn("`findings`", self.section)
        self.assertIn("`external_research_candidates`", self.section)
        self.assertIn("metric signal is present", self.section)

    def test_step_03b_only_when_all_three_empty(self) -> None:
        self.assertIn(
            "ONLY when ALL three are empty: zero findings AND zero external candidates AND no usable metric signal",
            self.section,
        )

    def test_findings_with_no_perf_delta_routes_to_step_03(self) -> None:
        self.assertIn(
            "MUST route to step-03, not step-03b",
            self.section,
        )


class Step02MetricSignalContractTests(unittest.TestCase):
    """step-02-analysis.md must document `metric_signal` as orthogonal."""

    def setUp(self) -> None:
        self.text = STEP_02.read_text(encoding="utf-8")

    def test_metric_signal_documented_as_perf_baseline_only(self) -> None:
        self.assertIn("`metric_signal` field", self.text)
        self.assertIn("perf-baseline-only", self.text)

    def test_metric_signal_not_a_proxy_for_findings(self) -> None:
        self.assertIn(
            "NOT a proxy for",
            self.text,
        )


class Meta20260429RegressionScenarioTests(unittest.TestCase):
    """Replays the meta-2026-04-29 cycle-state shape and asserts correct route."""

    def _route(self, *, findings: list, external_candidates: list, metric_signal: bool) -> str:
        """Pure-Python router mirroring the documented AND-of-empty rule."""
        if findings or external_candidates or metric_signal:
            return "step-03-proposal"
        return "step-03b-backlog-fallback"

    def test_meta_20260429_8_findings_no_metric_routes_to_step_03(self) -> None:
        # Reproduces the exact failure mode from PR #30: 8 findings, metric_signal: false,
        # zero external candidates. Must route to step-03, NOT step-03b.
        route = self._route(
            findings=[{"id": f"finding-{n}"} for n in range(8)],
            external_candidates=[],
            metric_signal=False,
        )
        self.assertEqual(route, "step-03-proposal")

    def test_truly_empty_cycle_routes_to_03b(self) -> None:
        route = self._route(findings=[], external_candidates=[], metric_signal=False)
        self.assertEqual(route, "step-03b-backlog-fallback")

    def test_metric_signal_alone_routes_to_step_03(self) -> None:
        route = self._route(findings=[], external_candidates=[], metric_signal=True)
        self.assertEqual(route, "step-03-proposal")

    def test_external_candidates_alone_routes_to_step_03(self) -> None:
        route = self._route(
            findings=[],
            external_candidates=[{"id": "external-proposal-1"}],
            metric_signal=False,
        )
        self.assertEqual(route, "step-03-proposal")


if __name__ == "__main__":
    unittest.main()
