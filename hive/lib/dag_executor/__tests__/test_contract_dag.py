"""b-contract-derived-dag b1 — Requires/Ensures contract-derived edges.

Covers the two b1 acceptance criteria:
  * steps with Requires/Ensures synthesize the dependency graph (no
    hand-authored depends_on needed for those edges);
  * two steps Ensures-ing the SAME key raise a LOUD error naming BOTH
    steps + the duplicate key (fail the whole plan, not a silent guess).

Plus the additive back-compat guarantees: hand-authored depends_on still
works and is augmented (not replaced), and a contract-free workflow is a
no-op.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml

from hive.lib.dag_executor.graph.errors import DuplicateEnsuresError
from hive.lib.dag_executor.graph.loader import load_workflow
from hive.lib.dag_executor.graph.validator import validate_graph


def _write_workflow(tmp_path: Path, steps: list[dict[str, Any]], **top: Any) -> Path:
    payload: dict[str, Any] = {"name": "contract-test", "steps": steps}
    payload.update(top)
    path = tmp_path / "contract-test.workflow.yaml"
    path.write_text(yaml.safe_dump(payload), encoding="utf-8")
    return path


def test_requires_ensures_synthesizes_dependency_edge(tmp_path: Path):
    # producer `a` ensures "plan"; consumer `b` requires "plan". No
    # hand-authored depends_on anywhere — the edge must be synthesized.
    graph = load_workflow(
        _write_workflow(
            tmp_path,
            [
                {"id": "a", "agent": "planner", "ensures": ["plan"]},
                {"id": "b", "agent": "developer", "requires": ["plan"]},
            ],
        )
    )
    assert graph.nodes["b"].depends_on == ["a"]
    # The synthesized edge is present in the edge list too.
    assert any(e.from_node_id == "a" and e.to_node_id == "b" for e in graph.edges)
    # And it round-trips through the validator + topological sort cleanly.
    validate_graph(graph)


def test_multiple_requires_synthesize_all_producer_edges(tmp_path: Path):
    graph = load_workflow(
        _write_workflow(
            tmp_path,
            [
                {"id": "a", "agent": "planner", "ensures": ["plan"]},
                {"id": "c", "agent": "researcher", "ensures": ["research"]},
                {
                    "id": "b",
                    "agent": "developer",
                    "requires": ["plan", "research"],
                },
            ],
        )
    )
    assert graph.nodes["b"].depends_on == ["a", "c"]


def test_synthesized_edges_augment_hand_authored_depends_on(tmp_path: Path):
    # `b` already hand-authors depends_on [gate]; the contract edge to `a`
    # is ADDED, not replaced.
    graph = load_workflow(
        _write_workflow(
            tmp_path,
            [
                {"id": "gate", "agent": "gatekeeper"},
                {"id": "a", "agent": "planner", "ensures": ["plan"]},
                {
                    "id": "b",
                    "agent": "developer",
                    "depends_on": ["gate"],
                    "requires": ["plan"],
                },
            ],
        )
    )
    assert graph.nodes["b"].depends_on == ["gate", "a"]


def test_duplicate_ensures_raises_loud_error_naming_both(tmp_path: Path):
    path = _write_workflow(
        tmp_path,
        [
            {"id": "a", "agent": "planner", "ensures": ["plan"]},
            {"id": "b", "agent": "planner-2", "ensures": ["plan"]},
        ],
    )
    with pytest.raises(DuplicateEnsuresError) as excinfo:
        load_workflow(path)
    err = excinfo.value
    assert err.output_key == "plan"
    assert {err.first_node_id, err.second_node_id} == {"a", "b"}
    # The message names BOTH steps and the duplicate key.
    message = str(err)
    assert "plan" in message
    assert "a" in message and "b" in message


def test_no_contracts_is_a_noop(tmp_path: Path):
    # A contract-free workflow keeps its hand-authored depends_on verbatim.
    graph = load_workflow(
        _write_workflow(
            tmp_path,
            [
                {"id": "a", "agent": "planner"},
                {"id": "b", "agent": "developer", "depends_on": ["a"]},
            ],
        )
    )
    assert graph.nodes["a"].depends_on == []
    assert graph.nodes["b"].depends_on == ["a"]


def test_unsatisfied_requires_synthesizes_nothing(tmp_path: Path):
    # A required key nobody ensures (e.g. supplied from run context) yields
    # no edge and no error — permissive by design.
    graph = load_workflow(
        _write_workflow(
            tmp_path,
            [
                {"id": "b", "agent": "developer", "requires": ["external"]},
            ],
        )
    )
    assert graph.nodes["b"].depends_on == []


def test_self_ensure_and_require_does_not_self_edge(tmp_path: Path):
    graph = load_workflow(
        _write_workflow(
            tmp_path,
            [
                {
                    "id": "a",
                    "agent": "developer",
                    "ensures": ["x"],
                    "requires": ["x"],
                },
            ],
        )
    )
    assert graph.nodes["a"].depends_on == []


def test_same_node_duplicate_ensures_is_not_a_conflict(tmp_path: Path):
    # A single node listing the same key twice is not a two-producer
    # conflict — no error.
    graph = load_workflow(
        _write_workflow(
            tmp_path,
            [
                {"id": "a", "agent": "planner", "ensures": ["plan", "plan"]},
                {"id": "b", "agent": "developer", "requires": ["plan"]},
            ],
        )
    )
    assert graph.nodes["b"].depends_on == ["a"]
