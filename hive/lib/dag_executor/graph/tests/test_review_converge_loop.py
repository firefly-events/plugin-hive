"""t-006: review.workflow.yaml converge-loop structural tests.

s4-retire-runtime-loop: Walker (graph.walker) and executor LOOP dispatch
are retired. AC1/AC2/AC3/AC6 Walker tests are removed. Retained here are
the structural YAML / expanded-graph checks that remain valid regardless of
the runtime implementation:

  AC4: max_attempts: 1 hard-halt removed from development.classic.workflow.yaml
  structural: wiring of gate-review and integrate in the expanded classic graph.
"""

from __future__ import annotations

from pathlib import Path

from hive.lib.dag_executor.graph import NodeType, load_workflow


_WORKFLOWS = Path(__file__).resolve().parents[5] / "hive" / "workflows"

REVIEW_PATH = _WORKFLOWS / "review.workflow.yaml"
CLASSIC_PATH = _WORKFLOWS / "development.classic.workflow.yaml"


# ---------------------------------------------------------------------------
# AC4: max_attempts: 1 hard-halt removed from development.classic.workflow.yaml
# ---------------------------------------------------------------------------


def test_classic_gate_review_present_as_terminal_safety_gate():
    """Maintainer design (post-t-006 / s3): gate-review is the terminal safety
    gate, positioned AFTER the converge-loop. It preserves prod bug #26 (a final
    needs_revision verdict must block integrate) — bounded retries do not license
    silent integration of an unresolved review.

    After s3-convergence-signal: expand_loops unrolls the LOOP body into round
    copies and rewires gate-review's depends_on to the last round's exit node
    (e.g. fix-cycle-review__r3). The pre-unroll depends_on on review-converge-loop
    is no longer visible in the loaded graph.
    """
    import yaml

    # Raw YAML: gate-review must depend on review-converge-loop (pre-unroll)
    with open(CLASSIC_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    steps_raw = {s["id"]: s for s in raw.get("steps", [])}
    assert "gate-review" in steps_raw, "gate-review must exist in YAML"
    raw_deps = steps_raw["gate-review"].get("depends_on", [])
    assert "review-converge-loop" in raw_deps, (
        f"gate-review must depend on review-converge-loop in the YAML (pre-unroll); got {raw_deps!r}"
    )

    # Expanded graph: gate-review exists and is a GATE node
    graph = load_workflow(CLASSIC_PATH)
    assert "gate-review" in graph.nodes, (
        "gate-review terminal safety gate must exist in classic after unrolling (preserves #26)"
    )
    node = graph.nodes["gate-review"]
    assert node.node_type == NodeType.GATE, "gate-review must be a GATE node"
    # After unrolling, gate-review depends on the last round exit (not the LOOP node)
    assert not any("review-converge-loop" in dep for dep in node.depends_on), (
        "After unrolling, review-converge-loop should NOT appear in gate-review.depends_on; "
        f"got {node.depends_on!r}"
    )
    # Must depend on the last round's body exit node
    assert any("fix-cycle-review__r" in dep for dep in node.depends_on), (
        f"gate-review must depend on a fix-cycle-review round copy after unrolling; "
        f"got {node.depends_on!r}"
    )


def test_classic_gate_review_is_single_shot():
    """The terminal safety gate is single-shot: max_attempts == 1. A gate just
    re-evaluates the same verdict, so re-dispatch is wasted — fail loud at once."""
    graph = load_workflow(CLASSIC_PATH)
    node = graph.nodes["gate-review"]
    assert node.retry is not None, "gate-review must have a retry config"
    assert node.retry.get("max_attempts") == 1, (
        f"gate-review max_attempts must be 1 (single-shot); got {node.retry.get('max_attempts')!r}"
    )


# ---------------------------------------------------------------------------
# Classic workflow: review-converge-loop wiring
# ---------------------------------------------------------------------------


def test_classic_integrate_depends_on_loop_and_terminal_gate():
    """Maintainer design (post-t-006): integrate must depend on BOTH the
    converge-loop AND the terminal gate-review safety gate, so it cannot run
    until the loop has iterated and the final verdict passed the #26 guard."""
    # Raw YAML check: integrate depends on review-converge-loop (pre-unroll)
    import yaml
    with open(CLASSIC_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    steps_raw = {s["id"]: s for s in raw.get("steps", [])}
    integrate_raw_deps = steps_raw.get("integrate", {}).get("depends_on", [])
    assert "review-converge-loop" in integrate_raw_deps, (
        f"integrate must depend on review-converge-loop in YAML (pre-unroll); "
        f"got {integrate_raw_deps!r}"
    )

    # Expanded graph: integrate depends on gate-review and last round exit
    graph = load_workflow(CLASSIC_PATH)
    integrate = graph.nodes.get("integrate")
    assert integrate is not None, "integrate node must exist in classic"
    assert "gate-review" in integrate.depends_on, (
        "integrate must depend on gate-review (terminal safety gate) so it is "
        f"gated on the final verdict; got {integrate.depends_on!r}"
    )
    # After unrolling, review-converge-loop in depends_on is rewritten to last round exit
    assert not any("review-converge-loop" in dep for dep in integrate.depends_on), (
        f"After unrolling, review-converge-loop must not appear in integrate.depends_on; "
        f"got {integrate.depends_on!r}"
    )
    assert any("fix-cycle-review__r" in dep for dep in integrate.depends_on), (
        f"integrate must depend on a fix-cycle-review round exit after unrolling; "
        f"got {integrate.depends_on!r}"
    )


def test_classic_review_converge_loop_depends_on_review():
    """review-converge-loop must depend on review so the reviewer runs first.
    Checked against the raw YAML (pre-unroll) since the LOOP is removed after expansion.
    """
    import yaml
    with open(CLASSIC_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    steps_raw = {s["id"]: s for s in raw.get("steps", [])}
    assert "review-converge-loop" in steps_raw, "review-converge-loop must exist in YAML"
    loop_deps = steps_raw["review-converge-loop"].get("depends_on", [])
    assert "review" in loop_deps, (
        f"review-converge-loop must depend on review (pre-unroll); got {loop_deps!r}"
    )
