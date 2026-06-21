"""s8 — tests for plan.workflow.yaml.

Acceptance criteria (from s8-plan-graph.yaml):
  AC1: load_workflow validates and expresses research+design parallel → author
       → reconcile → gate with single-agent nodes + OutputRef wiring.
  AC2: step_files for each node carry verbatim per-node instructions.
  AC4: no PAUSE node in the graph (user gates are orchestrator-local).

Front-door test: stubbed run asserts node-execution order and gate target.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from hive.lib.dag_executor.graph import load_workflow, validate_graph, NodeType
from hive.lib.dag_executor.executor import StubAgentSpawn
from hive.lib.dag_executor.run import run


REPO_ROOT = Path(__file__).resolve().parents[2]
PLAN_WORKFLOW = REPO_ROOT / "hive" / "workflows" / "plan.workflow.yaml"


# ── Loader / validator ────────────────────────────────────────────────────────

def test_plan_workflow_exists():
    assert PLAN_WORKFLOW.is_file(), f"plan.workflow.yaml not found at {PLAN_WORKFLOW}"


def test_plan_workflow_loads():
    graph = load_workflow(PLAN_WORKFLOW)
    assert graph.workflow_name == "plan"
    assert len(graph.nodes) >= 5


def test_plan_workflow_validates():
    graph = load_workflow(PLAN_WORKFLOW)
    validate_graph(graph)  # raises on any structural violation


# ── Node shape ────────────────────────────────────────────────────────────────

def test_research_and_design_are_parallel():
    """research and design have no depends_on — they run in parallel."""
    graph = load_workflow(PLAN_WORKFLOW)
    assert graph.nodes["research"].depends_on == []
    assert graph.nodes["design"].depends_on == []
    # Neither depends on the other
    assert "design" not in graph.nodes["research"].depends_on
    assert "research" not in graph.nodes["design"].depends_on


def test_author_depends_on_research_and_design():
    graph = load_workflow(PLAN_WORKFLOW)
    deps = set(graph.nodes["author"].depends_on)
    assert "research" in deps
    assert "design" in deps


def test_reconcile_node_type_and_depends_on_author():
    graph = load_workflow(PLAN_WORKFLOW)
    reconcile = graph.nodes["reconcile"]
    assert reconcile.node_type == NodeType.RECONCILE
    assert "author" in reconcile.depends_on


def test_gate_node_type_and_depends_on_reconcile():
    graph = load_workflow(PLAN_WORKFLOW)
    gate = graph.nodes["output-validation"]
    assert gate.node_type == NodeType.GATE
    assert "reconcile" in gate.depends_on


def test_gate_predicate_targets_epic_dir():
    """Gate predicate must reference the epic_dir output (s3 committed-epics check)."""
    graph = load_workflow(PLAN_WORKFLOW)
    gate = graph.nodes["output-validation"]
    assert gate.gate is not None
    assert "epic_dir" in gate.gate


# ── Single-agent nodes ────────────────────────────────────────────────────────

def test_single_agent_nodes():
    graph = load_workflow(PLAN_WORKFLOW)
    assert graph.nodes["research"].agent == "researcher"
    assert graph.nodes["design"].agent == "architect"
    assert graph.nodes["author"].agent == "technical-writer"


# ── OutputRef wiring ──────────────────────────────────────────────────────────

def test_author_receives_research_brief_and_design_discussion():
    """research_brief and design_discussion are both wired into author's inputs."""
    graph = load_workflow(PLAN_WORKFLOW)
    author_input_names = {b.name for b in graph.nodes["author"].inputs}
    assert "research_brief" in author_input_names
    assert "design_discussion" in author_input_names


def test_research_output_ref_wired():
    graph = load_workflow(PLAN_WORKFLOW)
    output_names = {o.name for o in graph.nodes["research"].outputs}
    assert "research_brief" in output_names


def test_design_output_ref_wired():
    graph = load_workflow(PLAN_WORKFLOW)
    output_names = {o.name for o in graph.nodes["design"].outputs}
    assert "design_discussion" in output_names


def test_author_epic_dir_output_wired_to_gate():
    """output-validation gate must bind epic_dir from author's step_output."""
    graph = load_workflow(PLAN_WORKFLOW)
    gate = graph.nodes["output-validation"]
    epic_dir_bindings = [
        b for b in gate.inputs
        if b.name == "epic_dir" and b.source == "step_output"
        and b.step_id == "author" and b.output_name == "epic_dir"
    ]
    assert len(epic_dir_bindings) == 1, (
        "output-validation gate must bind epic_dir from step_output:author"
    )


# ── No user gate in graph ─────────────────────────────────────────────────────

def test_no_pause_node_in_plan_graph():
    """User review/sign-off gates are orchestrator-local; no PAUSE node in graph."""
    graph = load_workflow(PLAN_WORKFLOW)
    pause_nodes = [nid for nid, n in graph.nodes.items() if n.node_type == NodeType.PAUSE]
    assert pause_nodes == [], (
        f"PAUSE nodes found in plan graph: {pause_nodes} — "
        "user gates must remain orchestrator-local (s9 wiring boundary)"
    )


# ── step_file paths resolve ───────────────────────────────────────────────────

def test_agent_step_files_exist():
    """Every step_file on an agent node must point at a real file."""
    graph = load_workflow(PLAN_WORKFLOW)
    missing = []
    for node in graph.nodes.values():
        if node.step_file:
            p = REPO_ROOT / node.step_file
            if not p.is_file():
                missing.append((node.id, node.step_file))
    assert missing == [], f"step_file paths do not resolve: {missing}"


# ── Stubbed front-door run ────────────────────────────────────────────────────

def test_stubbed_run_node_order_and_gate():
    """Stubbed executor: all five nodes complete; gate sees non-empty epic_dir."""
    stub = StubAgentSpawn(
        canned_outputs={
            "research": {"research_brief": "## Research Brief\ncodebase explored."},
            "design": {"design_discussion": "## Design Discussion\napproach agreed."},
            "author": {
                "epic_dir": ".pHive/epics/test-epic-s8",
                "commit_sha": "",  # empty → ReconcileHandler no-ops (local binding)
            },
        }
    )
    materialised = run(PLAN_WORKFLOW, spawn=stub, run_id="s8-plan-stubbed-run")

    # All five nodes must appear in materialised results
    assert set(materialised.keys()) == {
        "research", "design", "author", "reconcile", "output-validation"
    }, f"unexpected node set: {set(materialised.keys())}"

    # research and design must run before author
    completed_ids = list(materialised.keys())
    research_idx = completed_ids.index("research")
    design_idx = completed_ids.index("design")
    author_idx = completed_ids.index("author")
    reconcile_idx = completed_ids.index("reconcile")
    gate_idx = completed_ids.index("output-validation")

    assert research_idx < author_idx, "research must complete before author"
    assert design_idx < author_idx, "design must complete before author"
    assert author_idx < reconcile_idx, "author must complete before reconcile"
    assert reconcile_idx < gate_idx, "reconcile must complete before output-validation"

    # Gate must report passed
    gate_out = materialised["output-validation"]
    assert gate_out.outputs.get("gate_passed") is True, (
        f"gate did not pass: {gate_out.outputs}"
    )
