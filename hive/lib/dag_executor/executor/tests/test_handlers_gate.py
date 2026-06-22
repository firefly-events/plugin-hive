"""Tests for GateHandler — `must not be empty` predicate (presence check)."""

from __future__ import annotations

import pytest

from hive.lib.dag_executor.executor.errors import GateFailedError
from hive.lib.dag_executor.executor.handlers.gate import GateHandler
from hive.lib.dag_executor.graph import Node, NodeType


def _gate_node(predicate: str | None) -> Node:
    return Node(
        id="gate-x",
        agent="developer",
        node_type=NodeType.GATE,
        gate=predicate,
    )


def test_gate_passes_when_input_non_empty():
    handler = GateHandler()
    out = handler.handle(
        _gate_node("test_artifacts must not be empty"),
        inputs={"test_artifacts": ["a.py"]},
        run_id="rid-1",
    )
    assert out.outputs["gate_passed"] is True


def test_gate_fails_when_input_empty_list():
    handler = GateHandler()
    with pytest.raises(GateFailedError):
        handler.handle(
            _gate_node("test_artifacts must not be empty"),
            inputs={"test_artifacts": []},
            run_id="rid-1",
        )


def test_gate_fails_when_input_missing():
    handler = GateHandler()
    with pytest.raises(GateFailedError):
        handler.handle(
            _gate_node("test_artifacts must not be empty"),
            inputs={},
            run_id="rid-1",
        )


def test_gate_fails_when_input_none():
    handler = GateHandler()
    with pytest.raises(GateFailedError):
        handler.handle(
            _gate_node("test_artifacts must not be empty"),
            inputs={"test_artifacts": None},
            run_id="rid-1",
        )


def test_gate_unknown_predicate_raises_with_hde3a_pointer():
    """Richer predicates land in hde-3a; reject unfamiliar predicates here."""
    handler = GateHandler()
    with pytest.raises(GateFailedError) as excinfo:
        handler.handle(
            _gate_node("count(test_artifacts) > 5"),
            inputs={"test_artifacts": ["a.py"]},
            run_id="rid-1",
        )
    assert "hde-3a" in str(excinfo.value)


def test_empty_predicate_raises():
    with pytest.raises(GateFailedError):
        GateHandler().handle(_gate_node(""), inputs={}, run_id="rid-1")


# --- #16: verdict gates (must equal / must not equal) ----------------------


def test_must_equal_passes_on_match():
    out = GateHandler().handle(
        _gate_node("review_verdict must equal passed"),
        inputs={"review_verdict": "passed"},
        run_id="rid-1",
    )
    assert out.outputs["gate_passed"] is True


def test_must_equal_fails_on_mismatch():
    with pytest.raises(GateFailedError):
        GateHandler().handle(
            _gate_node("review_verdict must equal passed"),
            inputs={"review_verdict": "needs_revision"},
            run_id="rid-1",
        )


def test_must_not_equal_blocks_named_value():
    """A needs_revision review must not silently integrate (#16)."""
    with pytest.raises(GateFailedError):
        GateHandler().handle(
            _gate_node("review_verdict must not equal needs_revision"),
            inputs={"review_verdict": "needs_revision"},
            run_id="rid-1",
        )


def test_must_not_equal_passes_other_verdicts():
    """passed and needs_optimization both proceed past the gate."""
    handler = GateHandler()
    for verdict in ("passed", "needs_optimization"):
        out = handler.handle(
            _gate_node("review_verdict must not equal needs_revision"),
            inputs={"review_verdict": verdict},
            run_id="rid-1",
        )
        assert out.outputs["gate_passed"] is True


def test_must_not_equal_is_case_insensitive():
    with pytest.raises(GateFailedError):
        GateHandler().handle(
            _gate_node("review_verdict must not equal needs_revision"),
            inputs={"review_verdict": "NEEDS_REVISION"},
            run_id="rid-1",
        )


@pytest.mark.parametrize(
    "inputs",
    [
        {},  # output key absent — upstream produced no verdict
        {"review_verdict": None},
        {"review_verdict": ""},
        {"review_verdict": "   "},
    ],
)
def test_must_not_equal_blocks_on_missing_or_empty_value(inputs):
    """A 'must not equal' gate must FAIL when the named value is absent/empty
    (Codex review of #316): `inputs.get(name)` -> None coerces to "none", which
    !=  the bad value, so the gate would PASS and integrate would run with NO
    verdict at all. A verdict gate cannot pass without a verdict — mirrors the
    #26 silent-skip lesson (fail loud, never silently ship).
    """
    with pytest.raises(GateFailedError):
        GateHandler().handle(
            _gate_node("review_verdict must not equal needs_revision"),
            inputs=inputs,
            run_id="rid-1",
        )


# --- #19: plan-epic schema gate anchors epic_dir to repo_root ---------------


def _write_valid_epic(epic_dir):
    """Minimal plan-epic that passes validate_plan_output."""
    (epic_dir / "stories").mkdir(parents=True)
    (epic_dir / "epic.yaml").write_text(
        "name: ttt-game\ntitle: TTT\nmethodology: classic\n"
        "stories:\n  - id: s1\n",
        encoding="utf-8",
    )
    (epic_dir / "stories" / "s1.yaml").write_text(
        "id: s1\ntitle: S1\n"
        "acceptance_criteria:\n  - does a thing\n"
        "steps:\n  - id: implement\n    description: do\n    agent: developer\n"
        "depends_on: []\n",
        encoding="utf-8",
    )


def test_plan_epic_gate_anchors_to_repo_root(tmp_path, monkeypatch):
    """The committed epic lives under repo_root, but the driver cwd is the
    plugin dir. A repo-relative epic_dir must resolve against repo_root (#19).
    """
    repo_root = tmp_path / "consumer-repo"
    _write_valid_epic(repo_root / ".pHive/epics/ttt-game")
    elsewhere = tmp_path / "plugin-cwd"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)

    out = GateHandler(repo_root=repo_root).handle(
        _gate_node("epic_dir must be valid plan-epic"),
        inputs={"epic_dir": ".pHive/epics/ttt-game"},
        run_id="rid-1",
    )
    assert out.outputs["gate_passed"] is True


def test_plan_epic_gate_without_repo_root_uses_cwd(tmp_path, monkeypatch):
    """Legacy behavior: no repo_root → resolve relative to cwd."""
    monkeypatch.chdir(tmp_path)
    _write_valid_epic(tmp_path / ".pHive/epics/ttt-game")
    out = GateHandler().handle(
        _gate_node("epic_dir must be valid plan-epic"),
        inputs={"epic_dir": ".pHive/epics/ttt-game"},
        run_id="rid-1",
    )
    assert out.outputs["gate_passed"] is True
