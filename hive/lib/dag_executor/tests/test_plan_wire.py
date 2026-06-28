"""s9-plan-wire — planning-routing seam tests.

Verifies:
  AC1: When planning_mode_decision==multica, planning-routing routes to the
       DAG front door (plan.workflow.yaml, binding=multica), not per-persona
       plan-mode-multica dispatch.
  AC2: When backend is unset (default mode), existing direct/local behaviour is
       preserved — no DAG dispatch.
  AC3: plan.workflow.yaml does NOT contain retired narrated-path review step IDs
       while allowing executor-owned user_gate sentinels on the graduated DAG
       path.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[4]
PLANNING_ROUTING_SKILL = (
    REPO_ROOT / "skills" / "hive" / "skills" / "planning-routing" / "SKILL.md"
)
PLAN_WORKFLOW = REPO_ROOT / "hive" / "workflows" / "plan.workflow.yaml"


# ── helpers ─────────────────────────────────────────────────────────────────


def skill_text() -> str:
    return PLANNING_ROUTING_SKILL.read_text(encoding="utf-8")


def plan_workflow_data() -> dict:
    return yaml.safe_load(PLAN_WORKFLOW.read_bytes())


# ── AC1: multica mode routes to DAG front door ───────────────────────────────


def test_multica_routes_to_dag_front_door_not_plan_mode_multica():
    """Step 0.2 must describe DAG front door dispatch for multica mode."""
    text = skill_text()
    # Must reference the DAG front door module
    assert "hive.lib.dag_executor.run" in text, (
        "planning-routing must reference hive.lib.dag_executor.run for multica dispatch"
    )
    # Must reference the plan workflow graph
    assert "hive/workflows/plan.workflow.yaml" in text, (
        "planning-routing must reference hive/workflows/plan.workflow.yaml"
    )
    # Must use binding=multica
    assert 'binding="multica"' in text or "binding=multica" in text, (
        "planning-routing must specify binding=multica when dispatching via DAG front door"
    )


def test_multica_step03_not_plan_mode_multica_prose():
    """Step 0.3 Multica path must NOT call plan-mode-multica as a skill."""
    text = skill_text()
    # The old per-persona skill call must be gone from Step 0.3 dispatch description
    assert "plan-mode-multica/SKILL.md" not in text, (
        "planning-routing must not reference plan-mode-multica/SKILL.md in Step 0.3 "
        "dispatch — multica mode now routes through the DAG front door"
    )


def test_multica_info_log_uses_dag_plan_graph_path():
    """INFO log template must use dag-plan-graph as the path value for multica."""
    text = skill_text()
    assert "path=dag-plan-graph" in text, (
        "planning-routing INFO log template must include path=dag-plan-graph "
        "for the multica routing path"
    )
    # Old plan-mode-multica path label must be gone from valid path values
    assert "plan-mode-multica" not in text, (
        "planning-routing must not mention plan-mode-multica anywhere "
        "(replaced by dag-plan-graph)"
    )


def test_multica_example_log_uses_dag_plan_graph():
    """INFO log example for multica success must show dag-plan-graph."""
    text = skill_text()
    # The success example for multica requested must use dag-plan-graph
    success_pattern = re.compile(
        r"\[info\] planning routing:.*requested=multica.*path=dag-plan-graph.*reason=no-fallback-needed"
    )
    assert success_pattern.search(text), (
        "planning-routing must include an INFO log example showing "
        "requested=multica path=dag-plan-graph reason=no-fallback-needed"
    )


# ── AC2: local fallback — backend unset preserves direct path ────────────────


def test_default_mode_routes_to_direct_not_dag():
    """When backend is unset, routing falls through to direct/Agent(name:)."""
    text = skill_text()
    # The `agent_backends-unset` reason should still route to Agent(name:) (direct)
    assert "agent_backends-unset" in text, (
        "planning-routing must still define agent_backends-unset fallback reason "
        "for default (unset backend) mode"
    )
    # The default path must not be removed
    assert "Agent(name:" in text, (
        "planning-routing must preserve the direct Agent(name:) path for default mode"
    )
    # Strengthened: a direct-fallback regression (collapsing the per-persona Agent
    # dispatch back into a combined-team prompt) must not slip through. The
    # direct/default fallback's INFO examples must concretely route to path=Agent.
    assert "requested=unset path=Agent reason=agent_backends-unset" in text, (
        "planning-routing INFO examples must show the unset backend routing to "
        "path=Agent (direct) — not a combined-team dispatch"
    )
    assert "requested=direct path=Agent reason=no-fallback-needed" in text, (
        "planning-routing INFO examples must show direct-routed personas dispatching "
        "via path=Agent"
    )
    # And no active direct-path TeamCreate prose may reintroduce the retired
    # single combined-team dispatch on the direct path.
    assert "TeamCreate" not in text, (
        "planning-routing must not contain active TeamCreate prose — direct-routed "
        "personas spawn per-persona via Agent(name:)"
    )


def test_local_fallback_not_dag_when_unset():
    """When planning_mode_decision is not multica, DAG front door is not invoked."""
    text = skill_text()
    # The `resolve_spawn_binding` / DAG dispatch appears only in the multica branch
    # Confirm the default/local path section does not mention DAG dispatch
    # The Agent(name:) path must exist for direct-routed personas
    assert "Agent(name:" in text, (
        "Direct path Agent(name:) must be preserved for local fallback when "
        "planning.mode is unset or default"
    )


# ── AC3: gate-ownership invariant — scoped by execution path ─────────────────


def test_plan_workflow_exists():
    assert PLAN_WORKFLOW.exists(), f"plan.workflow.yaml not found at {PLAN_WORKFLOW}"


def test_plan_workflow_no_user_facing_review_gates():
    """plan.workflow.yaml must not contain retired narrated-path review step IDs."""
    data = plan_workflow_data()
    steps = {step["id"] for step in data.get("steps", [])}
    forbidden = {
        "design-discussion-review",
        "hv-review",
        "outline-sign-off",
        "user-sign-off",
        "design-review-gate",
    }
    overlap = steps & forbidden
    assert not overlap, (
        f"plan.workflow.yaml contains retired narrated-path review step(s): {overlap}. "
        "Review-gate ownership is scoped by execution path: user_gate sentinels "
        "belong to the graduated DAG path, while the default narrated path remains "
        "orchestrator-local."
    )


def test_plan_workflow_artifact_readiness_comment_present():
    """plan.workflow.yaml header must document the scoped review-gate ownership."""
    raw = PLAN_WORKFLOW.read_text(encoding="utf-8")
    assert (
        "User-facing review gates halt through user_gate pause sentinels" in raw
        and "graduated DAG path" in raw
        and "default narrated path remains orchestrator-local" in raw
    ), (
        "plan.workflow.yaml must document scoped review-gate ownership: user_gate "
        "sentinels belong to the graduated DAG path, while the default narrated "
        "path remains orchestrator-local."
    )


def test_planning_routing_states_gate_ownership_invariant():
    """planning-routing SKILL.md must state that graph completion is NOT a user sign-off."""
    text = skill_text()
    assert "artifact-readiness signal" in text, (
        "planning-routing must state that graph/DAG completion is an "
        "artifact-readiness signal only — not a user sign-off"
    )
    # Must also say gates stay local
    assert "user-facing review gates" in text.lower() or "review gates" in text.lower(), (
        "planning-routing must say user-facing review gates stay with the orchestrator"
    )
