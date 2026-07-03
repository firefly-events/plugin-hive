"""#26: the gate-review node must BLOCK integrate when the review verdict is
needs_revision. Live execute showed integrate running despite needs_revision
(gate-review skipped) — reproduce + lock the enforcement here.

Parametrized over classic, tdd, and bdd so a future fourth methodology is
one list entry away.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from hive.lib.dag_executor.executor import AgentHandler, Dispatcher
from hive.lib.dag_executor.executor.errors import GateFailedError
from hive.lib.dag_executor.executor.handlers.gate import GateHandler
from hive.lib.dag_executor.executor.handlers.reconcile import ReconcileHandler
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker
from hive.lib.dag_executor.executor.run_id import make_run_id
from hive.lib.dag_executor.graph import NodeType, load_workflow

_WORKFLOWS = Path(__file__).resolve().parents[4] / "workflows"

CLASSIC = _WORKFLOWS / "development.classic.workflow.yaml"
TDD = _WORKFLOWS / "development.tdd.workflow.yaml"
BDD = _WORKFLOWS / "development.bdd.workflow.yaml"

METHODOLOGIES = [
    pytest.param(CLASSIC, id="classic"),
    pytest.param(TDD, id="tdd"),
    pytest.param(BDD, id="bdd"),
]


class _Canned:
    def __init__(self, canned: dict[str, dict[str, Any]]):
        self.canned = canned
        self.calls: list[str] = []

    def __call__(self, agent, step_file_content, inputs, run_id, step_id):
        self.calls.append(step_id)
        return dict(self.canned.get(step_id, {}))


def _run(workflow_path: Path, verdict: str) -> tuple[list[str], BaseException | None]:
    graph = load_workflow(workflow_path)

    # s3-convergence-signal: the boolean convergence signal for review-fix-cycle
    # body nodes. True = converged (round k+1..N will be Skipped); False = still
    # needs_revision (all max_rounds run, terminal gate blocks integrate).
    review_passed = verdict != "needs_revision"

    spawn = _Canned(
        {
            # classic nodes
            "preflight": {
                "preflight_status": "READY",
                "needs_backend": True,
                "needs_frontend": False,
            },
            "backend-implement": {"implementation": "function makeMove(){}"},
            "codex-review": {"review_verdict": verdict},
            # tdd nodes
            "research": {"research_findings": "findings"},
            "write-brief": {"research_brief": "brief"},
            "test-spec": {"test_files": "tests", "test_manifest": "manifest"},
            "implement": {"implementation": "function makeMove(){}"},
            # bdd nodes
            "behavior-spec": {"behavior_specs": "specs"},
            # shared (classic uses "test" too)
            "test": {
                "test_results": "28 passing",
                "test_artifacts": ["game.test.js"],
            },
            "review": {"review_verdict": verdict, "review_findings": "..."},
            "integrate": {"commit_ref": "deadbeef"},
            # s3-convergence-signal: classic review-fix-cycle body round copies.
            # fix-cycle-implement rounds are body steps (no required outputs).
            "fix-cycle-implement__r1": {},
            "fix-cycle-implement__r2": {},
            "fix-cycle-implement__r3": {},
            # fix-cycle-review rounds emit review_passed (bool convergence signal).
            # When review_passed=True, rounds k+1..N are Skipped (skip_when fires).
            # When False, all max_rounds run and the terminal gate blocks.
            "fix-cycle-review__r1": {
                "review_verdict": verdict,
                "review_findings": "...",
                "review_passed": review_passed,
            },
            "fix-cycle-review__r2": {
                "review_verdict": verdict,
                "review_findings": "...",
                "review_passed": review_passed,
            },
            "fix-cycle-review__r3": {
                "review_verdict": verdict,
                "review_findings": "...",
                "review_passed": review_passed,
            },
            # rec-1: tdd-red-green-loop body round copies.
            # implement__r{k} produce the implementation artifact needed by gate-tests.
            # tdd-tester__r1 and __r2 always return False so rounds 2 and 3 run
            # (avoids early-convergence skip that would make implement__r3 absent).
            # tdd-tester__r3 uses review_passed so gate-tests-green passes on
            # "passed" verdict and blocks on "needs_revision" (bug-#26 preserved).
            "implement__r1": {"implementation": "function makeMove(){}"},
            "implement__r2": {"implementation": "function makeMove(){}"},
            "implement__r3": {"implementation": "function makeMove(){}"},
            "tdd-tester__r1": {"tests_green": False},
            "tdd-tester__r2": {"tests_green": False},
            "tdd-tester__r3": {"tests_green": review_passed},
            # rec-1: bdd-converge-loop body round copies.
            # bdd-implement__r{k} produce implementation for bdd-test inputs.
            # bdd-test__r3 uses review_passed so gate-bdd passes on "passed" and
            # blocks on "needs_revision".
            "bdd-implement__r1": {"implementation": "function makeMove(){}"},
            "bdd-implement__r2": {"implementation": "function makeMove(){}"},
            "bdd-implement__r3": {"implementation": "function makeMove(){}"},
            "bdd-test__r1": {"behavior_satisfied": False},
            "bdd-test__r2": {"behavior_satisfied": False},
            "bdd-test__r3": {"behavior_satisfied": review_passed},
        }
    )
    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn=spawn).handle)
    dispatcher.register(NodeType.GATE, GateHandler().handle)
    dispatcher.register(NodeType.RECONCILE, ReconcileHandler().handle)
    run_id = make_run_id("gate-review")
    tel = Telemetry(run_id=run_id)
    err: BaseException | None = None
    try:
        Walker().walk(
            graph, dispatcher, run_id, tel,
            context={"story_spec": "<<spec>>"},
        )
    except BaseException as exc:  # noqa: BLE001 — capture for assertion
        err = exc
    return spawn.calls, err


@pytest.mark.parametrize("workflow_path", METHODOLOGIES)
def test_gate_review_blocks_integrate_on_needs_revision(workflow_path):
    calls, err = _run(workflow_path, "needs_revision")
    assert isinstance(err, GateFailedError), (
        f"gate-review must BLOCK on needs_revision; got err={err!r}, calls={calls}"
    )
    assert "integrate" not in calls, "integrate must NOT run when review needs_revision"


@pytest.mark.parametrize("workflow_path", METHODOLOGIES)
def test_gate_review_allows_integrate_on_passed(workflow_path):
    calls, err = _run(workflow_path, "passed")
    assert err is None, f"passed verdict must not block; got {err!r}"
    assert "integrate" in calls, "integrate must run when review passed"


_CANONICAL_PREDICATE = "review_verdict must not equal needs_revision"

# s3-convergence-signal: classic workflow's gate-review predicate changed from
# the prose form to a grammar-legal dotpath predicate. After unrolling (which
# rewrites $review-converge-loop → $fix-cycle-review__rN), the gate predicate
# in the expanded graph references the actual last-round body reviewer node.
_CLASSIC_PREDICATE_PREFIX = "$fix-cycle-review__r"  # rewired to last round


@pytest.mark.parametrize("workflow_path", METHODOLOGIES)
def test_gate_review_predicate_matches_classic_verbatim(workflow_path):
    """AC-1/AC-2: gate-review predicate must be well-formed.

    For TDD/BDD: predicate must be byte-for-byte the classic prose string.
    For CLASSIC: predicate was changed to a grammar-legal dotpath boolean predicate
    (s3-convergence-signal) — assert it references review_passed and is parseable.
    """
    from hive.lib.dag_executor.routing import Skipped, parse

    graph = load_workflow(workflow_path)
    node = graph.nodes.get("gate-review")
    assert node is not None, (
        f"gate-review node must exist in {workflow_path.name}"
    )
    assert node.node_type is NodeType.GATE, (
        f"gate-review must be a gate node in {workflow_path.name}; got {node.node_type}"
    )

    if workflow_path == CLASSIC:
        # s3-convergence-signal: classic gate-review uses a grammar-legal dotpath
        # predicate ($fix-cycle-review__rN.output.review_passed == true) that the
        # unroller rewrites from $review-converge-loop.output.review_passed == true.
        gate_pred = node.gate or ""
        assert "review_passed" in gate_pred, (
            f"classic gate-review predicate must reference 'review_passed'; got {gate_pred!r}"
        )
        assert _CLASSIC_PREDICATE_PREFIX in gate_pred, (
            f"classic gate-review predicate must reference a fix-cycle-review__rN node "
            f"(unrolled from review-converge-loop); got {gate_pred!r}"
        )
        result = parse(gate_pred)
        assert not isinstance(result, Skipped), (
            f"classic gate-review predicate must be grammar-legal (parseable); "
            f"got Skipped for {gate_pred!r}"
        )
    else:
        assert node.gate == _CANONICAL_PREDICATE, (
            f"gate-review predicate in {workflow_path.name} must match classic "
            f"verbatim {_CANONICAL_PREDICATE!r}; got {node.gate!r}"
        )


@pytest.mark.parametrize("workflow_path", METHODOLOGIES)
def test_integrate_depends_on_gate_review(workflow_path):
    """AC-1/AC-2: integrate must depend on gate-review so the gate is interposed
    between review and integrate (not bypassed via a direct review->integrate edge)."""
    graph = load_workflow(workflow_path)
    integrate = graph.nodes.get("integrate")
    assert integrate is not None, (
        f"integrate node must exist in {workflow_path.name}"
    )
    assert "gate-review" in integrate.depends_on, (
        f"integrate.depends_on in {workflow_path.name} must include 'gate-review'; "
        f"got {integrate.depends_on!r}"
    )


@pytest.mark.parametrize("workflow_path", METHODOLOGIES)
def test_gate_review_has_max_attempts_1(workflow_path):
    """gate-review bounded-retry: max_attempts must be exactly 1 in all three graphs."""
    graph = load_workflow(workflow_path)
    node = graph.nodes.get("gate-review")
    assert node is not None, (
        f"gate-review node must exist in {workflow_path.name}"
    )
    assert node.retry is not None, "gate-review must have retry config"
    assert node.retry.get("max_attempts") == 1, (
        f"gate-review max_attempts must be 1; got {node.retry.get('max_attempts')!r}"
    )
