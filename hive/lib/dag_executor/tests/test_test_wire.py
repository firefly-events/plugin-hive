"""s12-test-flow — test/SKILL.md DAG-front-door seam tests.

Verifies:
  AC1: test-swarm.workflow.yaml loads cleanly and contains a reconcile node
       before a gate node that checks the committed test report.
  AC2: When mode_decision==multica, skills/test/SKILL.md routes to the DAG
       front door (test-swarm.workflow.yaml, binding=multica).
  AC3: Backend unset → existing local swarm pipeline preserved; DAG dispatch
       not invoked when mode_decision != multica.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[4]
TEST_SKILL = REPO_ROOT / "skills" / "test" / "SKILL.md"
TEST_SWARM_WORKFLOW = REPO_ROOT / "hive" / "workflows" / "test-swarm.workflow.yaml"


def skill_text() -> str:
    return TEST_SKILL.read_text(encoding="utf-8")


def swarm_workflow_data() -> dict:
    return yaml.safe_load(TEST_SWARM_WORKFLOW.read_bytes())


# ── AC1: test-swarm.workflow.yaml reconcile + gate ───────────────────────────


def test_swarm_workflow_exists():
    assert TEST_SWARM_WORKFLOW.exists(), (
        f"test-swarm.workflow.yaml not found at {TEST_SWARM_WORKFLOW}"
    )


def test_swarm_workflow_loads():
    data = swarm_workflow_data()
    assert isinstance(data, dict), "test-swarm.workflow.yaml must parse as a dict"
    assert "steps" in data, "test-swarm.workflow.yaml must have a steps key"


def test_swarm_workflow_has_reconcile_node():
    data = swarm_workflow_data()
    reconcile_steps = [
        s for s in data["steps"] if s.get("node_type") == "reconcile"
    ]
    assert reconcile_steps, (
        "test-swarm.workflow.yaml must contain at least one reconcile node (s7)"
    )


def test_swarm_workflow_has_gate_node():
    data = swarm_workflow_data()
    gate_steps = [s for s in data["steps"] if s.get("node_type") == "gate"]
    assert gate_steps, (
        "test-swarm.workflow.yaml must contain at least one gate node (s3)"
    )


def test_swarm_workflow_reconcile_before_gate():
    """Reconcile node must appear before the gate node in the step list."""
    data = swarm_workflow_data()
    steps = data["steps"]
    ids = [s["id"] for s in steps]
    reconcile_indices = [
        i for i, s in enumerate(steps) if s.get("node_type") == "reconcile"
    ]
    gate_indices = [
        i for i, s in enumerate(steps) if s.get("node_type") == "gate"
    ]
    assert reconcile_indices, "No reconcile node found"
    assert gate_indices, "No gate node found"
    # At least one reconcile must precede at least one gate
    assert min(reconcile_indices) < max(gate_indices), (
        "reconcile node must appear before the gate node in test-swarm.workflow.yaml"
    )


def test_swarm_workflow_gate_depends_on_reconcile():
    """The gate node must depend (directly or transitively) on the reconcile node."""
    data = swarm_workflow_data()
    steps = {s["id"]: s for s in data["steps"]}
    gate_steps = [s for s in data["steps"] if s.get("node_type") == "gate"]
    reconcile_steps = {s["id"] for s in data["steps"] if s.get("node_type") == "reconcile"}

    for gate in gate_steps:
        deps = set(gate.get("depends_on", []))
        # Direct dependency on a reconcile node
        assert deps & reconcile_steps, (
            f"Gate node '{gate['id']}' must depend on a reconcile node; "
            f"depends_on={list(deps)}, reconcile nodes={list(reconcile_steps)}"
        )


def test_swarm_workflow_gate_checks_session_report():
    """Gate node must reference session_report to validate the test report artifact."""
    data = swarm_workflow_data()
    gate_steps = [s for s in data["steps"] if s.get("node_type") == "gate"]
    assert gate_steps, "No gate node found"
    gate = gate_steps[-1]
    input_names = [inp["name"] for inp in gate.get("inputs", [])]
    assert "session_report" in input_names, (
        f"Gate node '{gate['id']}' must take session_report as input to validate "
        f"the committed test report; inputs={input_names}"
    )


def test_swarm_workflow_gate_predicate_valid():
    """Gate predicate must be a valid hde-2 predicate and reference session_report."""
    data = swarm_workflow_data()
    gate_steps = [s for s in data["steps"] if s.get("node_type") == "gate"]
    assert gate_steps, "No gate node found"
    predicate = gate_steps[-1].get("gate", "")
    assert predicate, f"Gate node '{gate_steps[-1]['id']}' must have a gate predicate string"
    # Must be a valid hde-2 predicate ('{name} must not be empty')
    import re
    _NOT_EMPTY = re.compile(r"^(?P<name>[\w.-]+)\s+must\s+not\s+be\s+empty$", re.IGNORECASE)
    assert _NOT_EMPTY.match(predicate), (
        f"Gate predicate must match hde-2 'X must not be empty' form; got: '{predicate}'"
    )
    assert "session_report" in predicate, (
        f"Gate predicate must reference session_report; got: '{predicate}'"
    )


# ── AC2: multica mode routes to DAG front door ───────────────────────────────


def test_multica_routes_to_dag_front_door():
    """skills/test/SKILL.md must reference hive.lib.dag_executor.run for multica dispatch."""
    text = skill_text()
    assert "hive.lib.dag_executor.run" in text, (
        "skills/test/SKILL.md must reference hive.lib.dag_executor.run for multica DAG dispatch"
    )


def test_multica_uses_multica_binding():
    """skills/test/SKILL.md must specify binding=multica for the DAG front-door path."""
    text = skill_text()
    assert 'binding="multica"' in text or "binding=multica" in text, (
        "skills/test/SKILL.md must specify binding=multica when dispatching via DAG front door"
    )


def test_multica_references_test_swarm_workflow():
    """skills/test/SKILL.md must reference test-swarm.workflow.yaml for multica dispatch."""
    text = skill_text()
    assert "test-swarm.workflow.yaml" in text, (
        "skills/test/SKILL.md must reference test-swarm.workflow.yaml in the DAG front-door path"
    )


def test_multica_info_log_uses_dag_multica_reason():
    """INFO log for the multica DAG path must use reason=dag-multica."""
    text = skill_text()
    assert "dag-multica" in text, (
        "skills/test/SKILL.md must use dag-multica reason token in the INFO log for DAG/Multica dispatch"
    )


def test_multica_info_log_example_present():
    """INFO log template must name test routing vocabulary."""
    text = skill_text()
    assert "test routing:" in text, (
        "skills/test/SKILL.md must include an INFO log line using 'test routing:' vocabulary"
    )


def test_multica_states_artifact_readiness_not_user_signoff():
    """SKILL.md must clarify graph completion is artifact-readiness only."""
    text = skill_text()
    assert "artifact-readiness signal" in text, (
        "skills/test/SKILL.md must state that DAG graph completion is an "
        "artifact-readiness signal only — not a user sign-off"
    )


# ── AC3: local fallback — backend unset preserves existing swarm pipeline ─────


def test_local_fallback_preserved():
    """When mode_decision != multica, existing local swarm pipeline is unchanged."""
    text = skill_text()
    assert "no regression" in text.lower() or "unchanged" in text.lower(), (
        "skills/test/SKILL.md must state that existing local paths are unchanged "
        "when backend is unset"
    )


def test_swarm_pipeline_section_still_present():
    """Local swarm pipeline steps must still be documented in SKILL.md."""
    text = skill_text()
    assert "## Pipeline" in text, (
        "skills/test/SKILL.md must preserve the ## Pipeline section for local fallback"
    )


def test_fallback_on_daemon_down_described():
    """SKILL.md must describe local fallback when dag-multica daemon is down."""
    text = skill_text()
    assert "falling back to local" in text, (
        "skills/test/SKILL.md must describe local fallback behavior "
        "when dag-multica daemon is down or dispatch fails"
    )
