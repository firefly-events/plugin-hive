"""Parity tests: every shipped workflow YAML must load and validate.

These tests guard the executor's promise that any workflow checked into
`hive/workflows/` can be walked. They run from the repo root.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from hive.lib.dag_executor.graph import (
    Graph,
    load_all_workflows,
    load_workflow,
    validate_graph,
)


REPO_ROOT = Path(__file__).resolve().parents[5]
WORKFLOWS_DIR = REPO_ROOT / "hive" / "workflows"

# At authoring time the directory holds 12 workflows (post-security-audit
# merge in commit 689fb6b). The story spec referenced 11 from before that
# merge. The MIN floor protects against regressions; the file-glob count
# guards against silent loader skips.
EXPECTED_MIN_WORKFLOWS = 11


def _shipped_workflow_paths() -> list[Path]:
    return sorted(WORKFLOWS_DIR.glob("*.workflow.yaml"))


def test_workflows_dir_has_files():
    """Sanity: the workflows directory exists and contains at least the floor."""
    paths = _shipped_workflow_paths()
    assert len(paths) >= EXPECTED_MIN_WORKFLOWS, (
        f"expected >= {EXPECTED_MIN_WORKFLOWS} workflow files, "
        f"found {len(paths)} under {WORKFLOWS_DIR}"
    )


def test_load_all_workflows_matches_disk():
    """The loader returns one Graph per *.workflow.yaml on disk."""
    paths = _shipped_workflow_paths()
    graphs = load_all_workflows(WORKFLOWS_DIR)
    assert len(graphs) == len(paths), (
        f"load_all_workflows returned {len(graphs)} graphs but disk has "
        f"{len(paths)} *.workflow.yaml files"
    )


@pytest.mark.parametrize("path", _shipped_workflow_paths(), ids=lambda p: p.name)
def test_each_workflow_loads_with_nodes(path: Path):
    """Each workflow parses into a Graph with at least one node."""
    graph = load_workflow(path)
    assert isinstance(graph, Graph)
    assert len(graph.nodes) > 0, f"{path.name} produced a graph with zero nodes"


@pytest.mark.parametrize("path", _shipped_workflow_paths(), ids=lambda p: p.name)
def test_each_workflow_validates(path: Path):
    """Every shipped workflow must pass the validator (post-expand).

    s4-retire-runtime-loop: validate_graph is now a post-expand gate — it
    rejects any LOOP node that reaches the executor. Workflows that still
    carry unexpanded LOOP nodes (authoring-only, no `feature` opt-in tag)
    are valid at the authoring/YAML level but must be expanded before
    executor validation.

    pr20-fable-review T5: previously an unexpanded-LOOP workflow skipped
    the WHOLE validator (`pytest.skip`), which hid cycle/dangling-dep
    defects in the rest of the graph behind the same exemption meant only
    for the LOOP-runtime-invariant rule. Narrow the exemption to just that
    one rule via `validate_graph(graph, allow_unexpanded_loop=True)` — every
    other check (dangling refs, cycles, input sources, output types,
    timeouts) still runs.
    """
    from hive.lib.dag_executor.graph.model import NodeType as _NodeType
    graph = load_workflow(path)
    loop_nodes = [n for n in graph.nodes.values() if n.node_type == _NodeType.LOOP]
    validate_graph(graph, allow_unexpanded_loop=bool(loop_nodes))


def test_per_step_and_per_input_optional_distinct():
    """development.classic ships both flavors of `optional` — they must not collapse.

    Post-Order-8 (hde-10): the legacy `implement` step is decomposed
    into `backend-implement` + `frontend-implement`. The optional-flag
    parity now applies to the new nodes.
    """
    graph = load_workflow(WORKFLOWS_DIR / "development.classic.workflow.yaml")

    # Per-step `optional: true` lives on at least one step (e.g., `research`,
    # `write-brief`, `codex-review`). Per-input `optional: true` lives on
    # bindings that consume previously-optional steps (e.g., the implement
    # nodes' `research_brief` input). Both must survive on the loaded Graph.
    research = graph.nodes["research"]
    assert research.optional is True, "per-step `optional: true` lost on `research`"

    backend = graph.nodes["backend-implement"]
    assert backend.optional is False, "backend-implement should be required (per-step)"
    research_brief_binding = next(
        b for b in backend.inputs if b.name == "research_brief"
    )
    assert research_brief_binding.optional is True, (
        "per-input `optional: true` lost on backend-implement.research_brief"
    )

    frontend = graph.nodes["frontend-implement"]
    backend_impl_binding = next(
        b for b in frontend.inputs if b.name == "backend_implementation"
    )
    assert backend_impl_binding.optional is True, (
        "per-input `optional: true` lost on frontend-implement.backend_implementation"
    )


def test_decomposed_developer_agents_round_trip_as_raw_strings():
    """Generic developer agent strings on the decomposed implement nodes
    must NOT be resolved by the loader. Post-Order-8 (hde-10) the
    decomposition uses explicit `backend-developer` / `frontend-developer`
    persona names because the YAML-level decomposition expresses the
    domain split that the legacy generic `developer` deferred to runtime."""
    graph = load_workflow(WORKFLOWS_DIR / "development.classic.workflow.yaml")
    assert graph.nodes["backend-implement"].agent == "backend-developer"
    assert graph.nodes["frontend-implement"].agent == "frontend-developer"
