"""Order 8 / Q9 path-A — development.classic implement decomposition.

The legacy single `implement` step is decomposed at the YAML level into
two declarative nodes (`backend-implement`, `frontend-implement`) each
guarded by a `when:` predicate against story-domain booleans surfaced
by `preflight`. Backend-first sequencing is preserved by
`frontend-implement.depends_on: [..., backend-implement]`.

Empty-domain stories (neither backend nor frontend) cause both implement
nodes to skip via `when_predicate_false`. The downstream `test` node
joins on both implement nodes; with both skipped, its
`trigger_rule: none_failed_min_one_success` (multi-upstream join policy)
cascades a SKIP through `test`, `review`, and the rest of the pipeline.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.handlers import AgentHandler, StubAgentSpawn
from hive.lib.dag_executor.executor.run_id import make_run_id
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker
from hive.lib.dag_executor.graph import NodeType, load_workflow


REPO_ROOT = Path(__file__).resolve().parents[2]
CLASSIC = REPO_ROOT / "hive" / "workflows" / "development.classic.workflow.yaml"


# ---------------------------------------------------------------------------
# Structural assertions on the decomposed YAML
# ---------------------------------------------------------------------------


def test_legacy_implement_node_removed():
    """The legacy `implement` step must be gone — the YAML decomposition
    does not leave it as a barrier or alias."""

    graph = load_workflow(CLASSIC)
    assert "implement" not in graph.nodes
    assert "backend-implement" in graph.nodes
    assert "frontend-implement" in graph.nodes


def test_when_predicates_address_preflight_outputs():
    """Strict-Archon grammar requires `$<node-id>.<field-path>`. The
    decomposition predicates address `preflight`'s `needs_backend` /
    `needs_frontend` outputs — never a nonexistent `$story.metadata.X`."""

    graph = load_workflow(CLASSIC)
    backend = graph.nodes["backend-implement"]
    frontend = graph.nodes["frontend-implement"]
    assert backend.when == "$preflight.output.needs_backend == true"
    assert frontend.when == "$preflight.output.needs_frontend == true"

    preflight_outputs = {o.name for o in graph.nodes["preflight"].outputs}
    assert "needs_backend" in preflight_outputs
    assert "needs_frontend" in preflight_outputs


def test_backend_first_sequencing():
    """frontend-implement depends_on backend-implement so the front-end
    agent can read the back-end's API surface (when both run)."""

    graph = load_workflow(CLASSIC)
    fi_deps = graph.nodes["frontend-implement"].depends_on
    assert "backend-implement" in fi_deps


def test_downstream_test_joins_on_both_implement_nodes():
    """The `test` step's depends_on covers both implement paths — that
    multi-upstream join is what enables the
    `none_failed_min_one_success` trigger_rule cascade for empty-domain
    stories. reconcile-backend and reconcile-frontend are the immediate
    predecessors of `test`; they materialise each implement agent's
    commit and sit directly between the implement nodes and `test`."""

    graph = load_workflow(CLASSIC)
    test_deps = graph.nodes["test"].depends_on
    # The reconcile-* nodes are the direct parents of `test`.
    # They sit between backend/frontend-implement and `test`.
    assert "reconcile-backend" in test_deps
    assert "reconcile-frontend" in test_deps
    # The implement nodes feed into the reconcile nodes (not test directly).
    assert "backend-implement" in graph.nodes["reconcile-backend"].depends_on
    assert "frontend-implement" in graph.nodes["reconcile-frontend"].depends_on


def test_step_files_split_per_domain():
    """The step file split is shipped — both new step files exist and
    each enforces single-domain scope."""

    backend_step = REPO_ROOT / "hive" / "workflows" / "steps" / "development-classic" / "step-03-implement-backend.md"
    frontend_step = REPO_ROOT / "hive" / "workflows" / "steps" / "development-classic" / "step-03-implement-frontend.md"
    assert backend_step.is_file()
    assert frontend_step.is_file()
    backend_text = backend_step.read_text(encoding="utf-8").lower()
    frontend_text = frontend_step.read_text(encoding="utf-8").lower()
    assert "backend scope only" in backend_text
    assert "frontend scope only" in frontend_text


# ---------------------------------------------------------------------------
# Multi-domain runtime (both predicates true)
# ---------------------------------------------------------------------------


def _canned_outputs(*, needs_backend: bool, needs_frontend: bool) -> dict[str, dict[str, Any]]:
    """Build canned outputs for development.classic. `preflight` carries
    the two domain booleans; the rest get placeholder values that
    satisfy declared OutputRef names."""

    canned: dict[str, dict[str, Any]] = {
        "preflight": {
            "preflight_status": "READY",
            "needs_backend": needs_backend,
            "needs_frontend": needs_frontend,
        },
        "research": {"research_findings": "findings"},
        "write-brief": {"research_brief": "brief"},
        "backend-implement": {"implementation": "<<backend>>"},
        "frontend-implement": {"implementation": "<<frontend>>"},
        "test": {"test_results": "ok", "test_artifacts": "artifact"},
        "platform-verify": {"platform_results": "ok"},
        "review": {"review_verdict": "passed", "review_findings": "none"},
        "codex-review": {"codex_verdict": "passed", "codex_findings": "none"},
        "optimize": {"optimized_implementation": "<<opt>>"},
        "dev-standby": {"fix_report": "none"},
        "integrate": {"commit_ref": "abc123"},
        "doc-check": {"doc_update_plan": "none"},
    }
    return canned


def _walk(canned: dict[str, dict[str, Any]]) -> tuple[Telemetry, dict]:
    graph = load_workflow(CLASSIC)
    run_id = make_run_id("development.classic")
    spy = StubAgentSpawn(canned_outputs=canned)
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)
    tel = Telemetry(run_id=run_id)
    materialised = Walker().walk(graph, dispatcher, run_id, tel, context={"story_spec": "<<spec>>"})
    return tel, materialised


def _started(tel: Telemetry) -> set[str]:
    return {e["step_id"] for e in tel.events if e["event_type"] == "node_started"}


def _completed(tel: Telemetry) -> set[str]:
    return {e["step_id"] for e in tel.events if e["event_type"] == "node_completed"}


def _skip_reasons(tel: Telemetry, step_id: str) -> list[str]:
    return [
        e["payload"].get("reason", "")
        for e in tel.events
        if e["event_type"] == "node_skipped" and e["step_id"] == step_id
    ]


def test_multi_domain_both_implement_nodes_run_backend_before_frontend():
    """Multi-domain story: needs_backend=true, needs_frontend=true →
    both implement nodes execute. backend-implement starts strictly
    before frontend-implement (frontend-implement depends_on
    backend-implement)."""

    canned = _canned_outputs(needs_backend=True, needs_frontend=True)
    tel, materialised = _walk(canned)

    assert "backend-implement" in materialised
    assert "frontend-implement" in materialised

    # Backend-first sequencing: backend's node_started precedes frontend's.
    started_order = [
        e["step_id"]
        for e in tel.events
        if e["event_type"] == "node_started"
        and e["step_id"] in {"backend-implement", "frontend-implement"}
    ]
    assert started_order == ["backend-implement", "frontend-implement"]

    # Downstream pipeline ran end-to-end.
    for downstream in ("test", "review", "integrate"):
        assert downstream in materialised


def test_backend_only_skips_frontend_implement():
    """Single-domain backend: needs_backend=true, needs_frontend=false →
    only backend-implement executes; frontend-implement skips via
    `when_predicate_false`. Downstream test runs (one upstream
    succeeded — `none_failed_min_one_success` permits it)."""

    canned = _canned_outputs(needs_backend=True, needs_frontend=False)
    tel, materialised = _walk(canned)

    assert "backend-implement" in materialised
    assert "frontend-implement" not in materialised
    assert "when_predicate_false" in _skip_reasons(tel, "frontend-implement")
    # Downstream survives — at least one upstream completed.
    assert "test" in materialised
    assert "review" in materialised


def test_frontend_only_skips_backend_implement():
    """Single-domain frontend: needs_backend=false, needs_frontend=true →
    only frontend-implement executes; backend-implement skips via
    `when_predicate_false`. Downstream test runs."""

    canned = _canned_outputs(needs_backend=False, needs_frontend=True)
    tel, materialised = _walk(canned)

    assert "backend-implement" not in materialised
    assert "frontend-implement" in materialised
    assert "when_predicate_false" in _skip_reasons(tel, "backend-implement")
    assert "test" in materialised
    assert "review" in materialised


def test_empty_domain_cascades_skip_through_pipeline():
    """Empty-domain story: needs_backend=false, needs_frontend=false →
    both implement nodes skip via `when_predicate_false`. The downstream
    `test` step joins on both via multi-upstream depends_on; per the
    `none_failed_min_one_success` trigger_rule, with zero upstreams
    completed, test SKIPS. The skip cascades through review,
    platform-verify, codex-review, optimize, dev-standby, integrate,
    doc-check."""

    canned = _canned_outputs(needs_backend=False, needs_frontend=False)
    tel, materialised = _walk(canned)

    # Both implement nodes skipped by predicate.
    assert "backend-implement" not in materialised
    assert "frontend-implement" not in materialised
    assert "when_predicate_false" in _skip_reasons(tel, "backend-implement")
    assert "when_predicate_false" in _skip_reasons(tel, "frontend-implement")

    # Downstream test skipped — its multi-upstream join saw zero
    # completed predecessors.
    assert "test" not in materialised
    test_skip_reasons = _skip_reasons(tel, "test")
    assert any("trigger_rule" in r for r in test_skip_reasons), (
        f"expected trigger_rule skip on test; got {test_skip_reasons!r}"
    )

    # The cascade continues: review (joins on test + platform-verify),
    # platform-verify (single-upstream of test), and the rest of the
    # pipeline did not complete.
    completed = _completed(tel)
    assert "review" not in completed
    assert "integrate" not in completed
    assert "doc-check" not in completed


# ---------------------------------------------------------------------------
# Per-Order parity sanity (Order 8) — observable behaviour normalises
# at the cycle-state + telemetry level despite the YAML decomposition.
# ---------------------------------------------------------------------------


def test_order_8_per_order_parity_completed_set_matches_active_steps():
    """The per-Order parity bar (v1.1 normalisation): for the
    multi-domain happy path, every NODE that has a satisfied predicate,
    a satisfied trigger_rule, AND no `skip_when` skip runs and emits
    node_completed. The YAML decomposition is the normalisation point
    — it changes the declared step set, not the structural-equality
    contract.

    Several legacy steps in development.classic carry a prose
    `skip_when:` (research/write-brief/codex-review/dev-standby/
    platform-verify/doc-check). The walker skips those pre-dispatch
    pending hde-3a evaluation. The parity bar locks the *active* subset
    — backend-implement + frontend-implement + the always-on spine
    (preflight, test, review, optimize, integrate)."""

    canned = _canned_outputs(needs_backend=True, needs_frontend=True)
    tel, materialised = _walk(canned)
    completed = _completed(tel)

    # Always-on spine for the multi-domain happy path.
    expected_active = {
        "preflight",
        "backend-implement",
        "frontend-implement",
        "test",
        "review",
        "optimize",
        "integrate",
    }
    assert expected_active.issubset(completed), (
        f"active spine missing: expected {expected_active}, got {completed}"
    )

    # Both implement nodes ran AND wrote `implementation`. Per-Order parity
    # confirms the YAML decomposition is observable: previously the single
    # `implement` step published one `implementation`; now two nodes publish
    # one each, with downstream binding from both.
    assert "implementation" in materialised["backend-implement"].outputs
    assert "implementation" in materialised["frontend-implement"].outputs

    # Materialised outputs match declared OutputRef names per active node.
    graph = load_workflow(CLASSIC)
    for step_id in completed:
        node = graph.nodes[step_id]
        declared = sorted(o.name for o in node.outputs)
        actual = sorted(materialised[step_id].outputs.keys())
        assert actual == declared, (
            f"{step_id}: declared {declared} vs materialised {actual}"
        )


# ---------------------------------------------------------------------------
# Registry membership for Order 8 (graduated in this commit)
# ---------------------------------------------------------------------------


def test_development_classic_in_canonical_registry():
    registry_path = REPO_ROOT / ".pHive" / "runtime" / "executor-graduated-workflows.yaml"
    parsed = yaml.safe_load(registry_path.read_text(encoding="utf-8"))
    assert "development.classic" in parsed.get("workflows", []), (
        "Order 8 (development.classic) must be in the graduation registry"
    )
