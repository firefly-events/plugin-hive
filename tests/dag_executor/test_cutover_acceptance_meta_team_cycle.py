"""Order 1 acceptance cutover — meta-team-cycle (hde-10).

This test locks in the FIRST workflow graduation under the executor
path. It is intentionally distinct from
``test_metric_signal_routing_real.py`` (which proves the routing
predicate is correct in isolation) and from
``test_consumer_config_flag.py`` (which proves the four-corner gate
truth table). The acceptance contract here is:

  1. ``meta-team-cycle`` is in the canonical graduation registry under
     the ``workflows:`` key (the canonical schema from hde-9a/9b — NOT
     ``graduated_workflows:``, the spec drift caught in hde-9b).
  2. With the consumer flag ON and the registry pointing at
     ``meta-team-cycle``, ``executor_enabled_for("meta-team-cycle")``
     returns True. With the flag OFF, the executor path is NOT taken.
  3. End-to-end: when stub agents emit the structured ``output_format``
     contract from step-02-analysis (``metric_signal``,
     ``findings_count``) and step-02b-external-research
     (``external_candidates_count``), the executor's predicate
     evaluator routes ``proposal`` vs ``backlog-fallback`` per the
     AND-of-empty rule from hde-3b. This is the structural retirement
     of the PR #31 bug class — the prose decision branch is now
     mechanical YAML.

Order 1 is the ACCEPTANCE proof. Production graduations for the other
workflows (Orders 2-9) ship in subsequent commits with their own
parity tests.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml

from hive.lib.dag_executor import (
    CONSUMER_CONFIG_PATH,
    GRADUATED_REGISTRY_PATH,
    executor_enabled_for,
    is_workflow_graduated,
)
from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.handlers import AgentHandler, StubAgentSpawn
from hive.lib.dag_executor.executor.run_id import make_run_id
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker
from hive.lib.dag_executor.graph import NodeType, load_workflow


REPO_ROOT = Path(__file__).resolve().parents[2]
META_TEAM_CYCLE = REPO_ROOT / "hive" / "workflows" / "meta-team-cycle.workflow.yaml"
CANONICAL_REGISTRY = REPO_ROOT / GRADUATED_REGISTRY_PATH


# ---------------------------------------------------------------------------
# Canonical-registry membership (the file shipped on this commit)
# ---------------------------------------------------------------------------


def test_meta_team_cycle_listed_in_canonical_registry() -> None:
    """The repo's canonical registry must list meta-team-cycle under the
    canonical ``workflows:`` key. Guards against the
    ``graduated_workflows:`` drift caught in hde-9b."""

    text = CANONICAL_REGISTRY.read_text(encoding="utf-8")
    parsed = yaml.safe_load(text)
    assert isinstance(parsed, dict), "registry top-level must be a mapping"
    assert "graduated_workflows" not in parsed, (
        "spec drift: the canonical key is `workflows:`, not "
        "`graduated_workflows:` (hde-9b lock)"
    )
    workflows = parsed.get("workflows")
    assert isinstance(workflows, list), "`workflows:` must be a list"
    assert workflows and workflows[0] == "meta-team-cycle", (
        "Order 1 acceptance: meta-team-cycle must be the FIRST graduation "
        f"(got {workflows[0] if workflows else 'empty list'!r})"
    )


def test_is_workflow_graduated_resolves_meta_team_cycle_against_repo_root() -> None:
    """Read against the real repo root. The reader must agree with the
    canonical YAML on disk; no synthesis."""

    assert is_workflow_graduated("meta-team-cycle", REPO_ROOT) is True


# ---------------------------------------------------------------------------
# Gate truth table (acceptance, not production)
# ---------------------------------------------------------------------------


def _write_consumer_config(root: Path, body: str) -> None:
    target = root / CONSUMER_CONFIG_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body, encoding="utf-8")


def _write_registry(root: Path, workflows: list[str]) -> None:
    target = root / GRADUATED_REGISTRY_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    yaml_lines = ["workflows:"] + [f"  - {name}" for name in workflows]
    target.write_text("\n".join(yaml_lines) + "\n", encoding="utf-8")


def test_acceptance_flag_on_meta_team_cycle_in_registry_executor_path(tmp_path: Path) -> None:
    """Flag ON + meta-team-cycle in registry → executor path."""

    _write_consumer_config(
        tmp_path,
        "executor: hive-dag\nexecutor_default: on\n",
    )
    _write_registry(tmp_path, ["meta-team-cycle"])
    assert executor_enabled_for("meta-team-cycle", tmp_path) is True


def test_acceptance_flag_off_meta_team_cycle_in_registry_orchestrator_path(tmp_path: Path) -> None:
    """Flag OFF (the shipped baseline) → orchestrator path even if
    registry lists meta-team-cycle. The default-OFF posture survives."""

    _write_consumer_config(
        tmp_path,
        "executor: hive-dag\nexecutor_default: off\n",
    )
    _write_registry(tmp_path, ["meta-team-cycle"])
    assert executor_enabled_for("meta-team-cycle", tmp_path) is False


# ---------------------------------------------------------------------------
# AND-of-empty routing — structural retirement of PR #31's bug class
# ---------------------------------------------------------------------------
#
# The acceptance bar for Order 1 is that the prose decision branch from
# `maintainer-skills/meta-meta-optimize/SKILL.md` no longer requires an
# orchestrator to "judge" routing. The executor evaluates the YAML
# `when:` predicates declared by step-02-analysis + step-02b-external-
# research and routes mechanically. PR #31 surfaced when an
# orchestrator conflated `metric_signal` with non-empty findings —
# that conflation cannot recur because routing is now a function of
# explicit fields, not prose interpretation. See
# `feedback_metric_signal_findings_conflation` and hde-3b.
# ---------------------------------------------------------------------------


def _canned_outputs(
    *,
    findings_count: int,
    metric_signal: bool,
    external_candidates_count: int,
) -> dict[str, dict[str, Any]]:
    """Per-step canned outputs that satisfy the structural output_format
    contract on step-02-analysis + step-02b-external-research and keep
    the rest of the cycle dispatchable. Same shape as
    ``test_metric_signal_routing_real.py``; reused so a single change to
    the structured contract is caught in both surfaces."""

    findings = [{"id": f"finding-{n}"} for n in range(findings_count)]
    external_candidates = [
        {"id": f"ext-{n}"} for n in range(external_candidates_count)
    ]
    return {
        "boot": {
            "cycle_id": "cycle-acceptance",
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


@pytest.mark.parametrize(
    "scenario_name,findings_count,metric_signal,external_candidates_count",
    [
        ("findings-only", 1, False, 0),
        ("metric-signal-only", 0, True, 0),
        ("external-candidates-only", 0, False, 1),
        ("all-three", 4, True, 2),
    ],
)
def test_any_actionable_signal_routes_to_proposal_full_cycle_completes(
    scenario_name: str,
    findings_count: int,
    metric_signal: bool,
    external_candidates_count: int,
) -> None:
    """When ANY of the three actionable signals is non-empty:
        * proposal runs (the OR predicate is true)
        * backlog-fallback skips (the AND predicate is false)
        * all downstream cycle steps complete (04-08).

    This is the OR side of the AND-of-empty rule. The bug class that
    PR #31 produced — orchestrator routing on a single conflated
    signal — is structurally impossible: the predicate evaluator binds
    by name to declared output_format fields. There is no "metric
    signal proxy" any longer."""

    canned = _canned_outputs(
        findings_count=findings_count,
        metric_signal=metric_signal,
        external_candidates_count=external_candidates_count,
    )
    _, materialised = _walk(canned)
    assert "proposal" in materialised, (
        f"scenario {scenario_name}: proposal must run when any signal is non-empty"
    )
    assert "backlog-fallback" not in materialised, (
        f"scenario {scenario_name}: backlog-fallback must skip when proposal runs"
    )
    # Cycle steps 04-08 all completed.
    for downstream in ("implementation", "testing", "evaluation", "promotion", "close"):
        assert downstream in materialised, (
            f"scenario {scenario_name}: downstream step {downstream!r} must complete"
        )


def test_all_three_signals_empty_routes_to_backlog_fallback() -> None:
    """The AND side of AND-of-empty: zero findings, zero metric signal,
    zero external candidates → backlog-fallback runs, proposal skips
    via ``when_predicate_false``. Cycle continues through 04-08 from the
    fallback's outputs (the rest of the chain depends on
    proposal/backlog-fallback implicitly via implementation's
    ``depends_on: proposal``)."""

    canned = _canned_outputs(
        findings_count=0,
        metric_signal=False,
        external_candidates_count=0,
    )
    tel, materialised = _walk(canned)
    assert "backlog-fallback" in materialised
    assert "proposal" not in materialised
    skip_reasons = [
        e["payload"].get("reason")
        for e in tel.events
        if e["event_type"] == "node_skipped" and e["step_id"] == "proposal"
    ]
    assert "when_predicate_false" in skip_reasons, (
        "proposal must skip via predicate, not via trigger_rule"
    )


# ---------------------------------------------------------------------------
# Graduation registry sanity — the executor path activates only when
# meta-team-cycle is present in the registry. Removing it (rollback)
# returns the workflow to the orchestrator path even with the flag on.
# ---------------------------------------------------------------------------


def test_executor_path_activates_only_when_in_registry(tmp_path: Path) -> None:
    """Functions as the ``--update-graduation-registry`` parity sanity
    check from the brief: the gate trips on registry membership.
    Removing meta-team-cycle from a registry rolls back to the
    orchestrator path; adding it (and only it) flips the path
    back to executor — per-workflow rollback granularity preserved."""

    # Flag on, registry empty: orchestrator path.
    _write_consumer_config(
        tmp_path,
        "executor: hive-dag\nexecutor_default: on\n",
    )
    _write_registry(tmp_path, [])
    assert executor_enabled_for("meta-team-cycle", tmp_path) is False

    # Flag on, meta-team-cycle in registry: executor path.
    _write_registry(tmp_path, ["meta-team-cycle"])
    assert executor_enabled_for("meta-team-cycle", tmp_path) is True

    # Flag on, meta-team-cycle removed (rollback), other workflow added:
    # orchestrator path for meta-team-cycle, executor path for the other.
    _write_registry(tmp_path, ["code-review"])
    assert executor_enabled_for("meta-team-cycle", tmp_path) is False
    assert executor_enabled_for("code-review", tmp_path) is True
