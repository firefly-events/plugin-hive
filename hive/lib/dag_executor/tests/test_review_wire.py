"""s13-review-flow — review/SKILL.md DAG-front-door seam tests.

Verifies:
  AC1: review.workflow.yaml loads cleanly and contains a reconcile node
       before a gate node that checks the committed review artifact.
  AC2: When mode_decision==multica, skills/review/SKILL.md routes to the DAG
       front door (review.workflow.yaml, binding=multica).
  AC3: Backend unset → existing local solo reviewer pipeline preserved; DAG
       dispatch not invoked when mode_decision != multica.
  AC4: Bounded retry configured on reviewer node (no loop primitive).
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.handlers import AgentHandler, StubAgentSpawn
from hive.lib.dag_executor.executor.run_id import make_run_id
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker
from hive.lib.dag_executor.graph import NodeType, load_workflow

REPO_ROOT = Path(__file__).resolve().parents[4]
REVIEW_SKILL = REPO_ROOT / "skills" / "review" / "SKILL.md"
REVIEW_WORKFLOW = REPO_ROOT / "hive" / "workflows" / "review.workflow.yaml"


def skill_text() -> str:
    return REVIEW_SKILL.read_text(encoding="utf-8")


def review_workflow_data() -> dict:
    return yaml.safe_load(REVIEW_WORKFLOW.read_bytes())


# ── AC1: review.workflow.yaml structure ─────────────────────────────────────


def test_review_workflow_exists():
    assert REVIEW_WORKFLOW.exists(), (
        f"review.workflow.yaml not found at {REVIEW_WORKFLOW}"
    )


def test_review_workflow_loads():
    data = review_workflow_data()
    assert isinstance(data, dict), "review.workflow.yaml must parse as a dict"
    assert "steps" in data, "review.workflow.yaml must have a steps key"


def test_review_workflow_has_reviewer_node():
    data = review_workflow_data()
    reviewer_steps = [
        s for s in data["steps"]
        if s.get("node_type", "agent") == "agent" and s.get("agent") == "reviewer"
    ]
    assert reviewer_steps, (
        "review.workflow.yaml must contain at least one agent node with agent=reviewer"
    )


def test_review_workflow_has_reconcile_node():
    data = review_workflow_data()
    reconcile_steps = [
        s for s in data["steps"] if s.get("node_type") == "reconcile"
    ]
    assert reconcile_steps, (
        "review.workflow.yaml must contain at least one reconcile node (s7)"
    )


def test_review_workflow_has_gate_node():
    data = review_workflow_data()
    gate_steps = [s for s in data["steps"] if s.get("node_type") == "gate"]
    assert gate_steps, (
        "review.workflow.yaml must contain at least one gate node (s3)"
    )


def test_review_workflow_reconcile_before_gate():
    """Reconcile node must appear before the gate node in the step list."""
    data = review_workflow_data()
    steps = data["steps"]
    reconcile_indices = [
        i for i, s in enumerate(steps) if s.get("node_type") == "reconcile"
    ]
    gate_indices = [
        i for i, s in enumerate(steps) if s.get("node_type") == "gate"
    ]
    assert reconcile_indices, "No reconcile node found"
    assert gate_indices, "No gate node found"
    assert min(reconcile_indices) < max(gate_indices), (
        "reconcile node must appear before the gate node in review.workflow.yaml"
    )


def test_review_workflow_gate_depends_on_reconcile():
    """The gate node must depend directly on the reconcile node."""
    data = review_workflow_data()
    gate_steps = [s for s in data["steps"] if s.get("node_type") == "gate"]
    reconcile_ids = {s["id"] for s in data["steps"] if s.get("node_type") == "reconcile"}

    for gate in gate_steps:
        deps = set(gate.get("depends_on", []))
        assert deps & reconcile_ids, (
            f"Gate node '{gate['id']}' must depend on a reconcile node; "
            f"depends_on={list(deps)}, reconcile nodes={list(reconcile_ids)}"
        )


def test_review_workflow_gate_checks_review_artifact():
    """Gate node must reference review_artifact to validate the committed review."""
    data = review_workflow_data()
    gate_steps = [s for s in data["steps"] if s.get("node_type") == "gate"]
    assert gate_steps, "No gate node found"
    gate = gate_steps[-1]
    input_names = [inp["name"] for inp in gate.get("inputs", [])]
    assert "review_artifact" in input_names, (
        f"Gate node '{gate['id']}' must take review_artifact as input; "
        f"inputs={input_names}"
    )


def test_review_workflow_gate_predicate_valid():
    """Gate predicate must be a valid hde-2 predicate referencing review_artifact."""
    data = review_workflow_data()
    gate_steps = [s for s in data["steps"] if s.get("node_type") == "gate"]
    assert gate_steps, "No gate node found"
    predicate = gate_steps[-1].get("gate", "")
    assert predicate, f"Gate node '{gate_steps[-1]['id']}' must have a gate predicate string"
    _NOT_EMPTY = re.compile(r"^(?P<name>[\w.-]+)\s+must\s+not\s+be\s+empty$", re.IGNORECASE)
    assert _NOT_EMPTY.match(predicate), (
        f"Gate predicate must match hde-2 'X must not be empty' form; got: '{predicate}'"
    )
    assert "review_artifact" in predicate, (
        f"Gate predicate must reference review_artifact; got: '{predicate}'"
    )


# ── AC4: bounded retry on reviewer node (no loop primitive) ─────────────────


def test_review_workflow_reviewer_has_retry():
    """The reviewer producer node must have a retry block."""
    data = review_workflow_data()
    reviewer_steps = [
        s for s in data["steps"]
        if s.get("node_type", "agent") == "agent" and s.get("agent") == "reviewer"
    ]
    assert reviewer_steps, "No reviewer agent node found"
    reviewer = reviewer_steps[0]
    assert reviewer.get("retry"), (
        f"Reviewer node '{reviewer['id']}' must have a retry block for bounded revise"
    )
    assert reviewer["retry"].get("max_attempts"), (
        f"Reviewer node '{reviewer['id']}' retry block must have max_attempts"
    )


def test_review_workflow_has_no_loop_node():
    """pr20-fable-review M1: review.workflow.yaml previously carried a
    disconnected `review-converge-loop` LOOP node — no `feature:`, no
    `convergence_signal:`, and zero body nodes tagged `sub_graph:
    review-fix-cycle`. It had empty `depends_on` and nothing depended on it,
    so it never participated in the reviewer -> reconcile-review ->
    gate-review-artifact chain; its only effect was to survive
    `expand_loops` (which only unrolls feature-tagged loops) and crash the
    walker with `LoopNodeInvariantError` on any real run. This workflow has
    no in-graph fix/implement agent — a needs_revision verdict is handled
    OUTSIDE this graph (skills/review/SKILL.md step 7 re-triggers /execute
    pickup) — so the vestigial loop was removed rather than wired. Assert it
    never comes back without a deliberate, wired re-introduction."""
    data = review_workflow_data()
    loop_steps = [s for s in data["steps"] if s.get("node_type") == "loop"]
    assert not loop_steps, (
        f"review.workflow.yaml must contain zero LOOP nodes; got {loop_steps!r}. "
        "If reintroducing an in-graph review<->fix loop, wire it properly: "
        "loop_config.feature + convergence_signal, and tag real body nodes "
        "`sub_graph: <name>` (see development.classic.workflow.yaml's "
        "review-converge-loop for the pattern)."
    )


# ── AC2: multica mode routes to DAG front door ───────────────────────────────


def test_multica_routes_to_dag_front_door():
    """skills/review/SKILL.md must reference hive.lib.dag_executor.run for multica dispatch."""
    text = skill_text()
    assert "hive.lib.dag_executor.run" in text, (
        "skills/review/SKILL.md must reference hive.lib.dag_executor.run for multica DAG dispatch"
    )


def test_multica_uses_multica_binding():
    """skills/review/SKILL.md must specify binding=multica for the DAG front-door path."""
    text = skill_text()
    assert 'binding="multica"' in text or "binding=multica" in text, (
        "skills/review/SKILL.md must specify binding=multica when dispatching via DAG front door"
    )


def test_multica_references_review_workflow():
    """skills/review/SKILL.md must reference review.workflow.yaml for multica dispatch."""
    text = skill_text()
    assert "review.workflow.yaml" in text, (
        "skills/review/SKILL.md must reference review.workflow.yaml in the DAG front-door path"
    )


def test_multica_info_log_uses_dag_multica_reason():
    """INFO log for the multica DAG path must use reason=dag-multica."""
    text = skill_text()
    assert "dag-multica" in text, (
        "skills/review/SKILL.md must use dag-multica reason token in the INFO log"
    )


def test_multica_info_log_example_present():
    """INFO log template must name review routing vocabulary."""
    text = skill_text()
    assert "review routing:" in text, (
        "skills/review/SKILL.md must include an INFO log line using 'review routing:' vocabulary"
    )


def test_multica_states_artifact_readiness_not_user_signoff():
    """SKILL.md must clarify graph completion is artifact-readiness only."""
    text = skill_text()
    assert "artifact-readiness signal" in text, (
        "skills/review/SKILL.md must state that DAG graph completion is an "
        "artifact-readiness signal only — not a user sign-off"
    )


# ── AC3: local fallback — backend unset preserves existing local pipeline ─────


def test_local_fallback_preserved():
    """When mode_decision != multica, existing local reviewer pipeline is unchanged."""
    text = skill_text()
    assert "no regression" in text.lower() or "unchanged" in text.lower(), (
        "skills/review/SKILL.md must state that existing local paths are unchanged "
        "when backend is unset"
    )


def test_inline_solo_reviewer_section_still_present():
    """Local solo reviewer steps must still be present in SKILL.md."""
    text = skill_text()
    assert "Phase 1" in text, (
        "skills/review/SKILL.md must preserve Phase 1 (inline solo reviewer) for local fallback"
    )


def test_fallback_on_daemon_down_described():
    """SKILL.md must describe local fallback when dag-multica daemon is down."""
    text = skill_text()
    assert "falling back to local" in text, (
        "skills/review/SKILL.md must describe local fallback behavior "
        "when dag-multica daemon is down or dispatch fails"
    )


# ── pr20-fable-review M1 regression guard: end-to-end Walker().walk() ───────


def test_review_workflow_walks_end_to_end_without_loop_invariant_error():
    """pr20-fable-review M1: this is the crash the review-converge-loop bug
    class produced — `load_workflow` + `expand_loops` used to leave
    ['review-converge-loop'] as a surviving LOOP node, and no test ever
    actually ran `Walker().walk()` against review.workflow.yaml (the old
    `test_review_wire.py` suite only checked YAML structure), so the crash
    stayed latent behind a green suite. Drive the real walker end-to-end with
    a canned reviewer output and assert it completes cleanly with no
    LoopNodeInvariantError (or any other exception) and no surviving LOOP
    nodes in the loaded graph."""
    graph = load_workflow(REVIEW_WORKFLOW)

    # Zero LOOP nodes must survive load_workflow's expand_loops pass.
    loop_nodes = [n for n in graph.nodes.values() if n.node_type == NodeType.LOOP]
    assert not loop_nodes, (
        f"review.workflow.yaml must have zero surviving LOOP nodes after "
        f"load_workflow; got {[n.id for n in loop_nodes]!r}"
    )

    canned = {
        "reviewer": {
            "review_artifact": "verdict: passed\nfindings: []\n",
            "commit_sha": "deadbeef",
            "review_passed": True,
            "verify_evidence": {"status": "verified"},
        },
    }
    spy = StubAgentSpawn(canned_outputs=canned)
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)
    run_id = make_run_id("review")
    tel = Telemetry(run_id=run_id)

    result = Walker().walk(
        graph,
        dispatcher,
        run_id,
        tel,
        context={
            "diff_target": "main..feature",
            "pr_number": None,
            "branch": "feature",
            "review_artifact_path": "/tmp/review.yaml",
        },
    )

    assert "reviewer" in result
    assert "gate-review-artifact" in result
