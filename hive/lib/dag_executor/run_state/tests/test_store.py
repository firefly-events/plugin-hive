"""Narrow-mutation API + freeze immutability + path-traversal defense."""

from __future__ import annotations

from pathlib import Path

import pytest

from hive.lib.dag_executor.executor.run_id import make_run_id
from hive.lib.dag_executor.run_state import (
    InvalidRunIdError,
    NodeStatus,
    RunStateFrozenError,
    RunStateNotFoundError,
    RunStatus,
    SCHEMA_VERSION,
    SchemaVersionMismatchError,
    create,
    load,
    mark_completed,
    mark_failed,
    mark_suspended,
    save,
    set_last_successful_node,
    set_node_output,
    set_node_status,
    validate_run_id,
)


@pytest.fixture
def runs_root(tmp_path: Path) -> Path:
    return tmp_path / "runs"


def _fresh(slug: str = "code-review") -> tuple[str, str]:
    rid = make_run_id(slug)
    return rid, slug


def test_create_initializes_with_schema_version_zero():
    rid, slug = _fresh()
    s = create(rid, slug)
    assert s.run_id == rid
    assert s.workflow_slug == slug
    assert s.schema_version == SCHEMA_VERSION == 0
    assert s.status == RunStatus.RUNNING
    assert s.frozen is False
    assert s.node_statuses == {}


def test_set_node_status_returns_new_dataclass_input_unchanged():
    rid, slug = _fresh()
    s0 = create(rid, slug)
    s1 = set_node_status(s0, "step-1", NodeStatus.RUNNING)
    assert s1 is not s0
    assert s0.node_statuses == {}, "original must be unchanged (narrow-mutation discipline)"
    assert s1.node_statuses == {"step-1": NodeStatus.RUNNING}


def test_set_node_output_does_not_mutate_input_output_graph():
    rid, slug = _fresh()
    s0 = create(rid, slug)
    s1 = set_node_output(s0, "step-1", {"verdict": "pass"})
    assert s0.output_graph == {}
    assert s1.output_graph == {"step-1": {"verdict": "pass"}}


def test_save_then_load_round_trip(runs_root: Path):
    rid, slug = _fresh()
    s0 = create(rid, slug)
    s1 = set_node_status(s0, "step-1", NodeStatus.COMPLETED)
    s2 = set_node_output(s1, "step-1", {"verdict": "pass"})
    s3 = set_last_successful_node(s2, "step-1")
    save(s3, root=runs_root)
    loaded = load(rid, root=runs_root)
    assert loaded.run_id == rid
    assert loaded.node_statuses == {"step-1": NodeStatus.COMPLETED}
    assert loaded.output_graph == {"step-1": {"verdict": "pass"}}
    assert loaded.last_successful_node_id == "step-1"


def test_load_missing_file_raises_not_found(runs_root: Path):
    rid = make_run_id("missing")
    with pytest.raises(RunStateNotFoundError):
        load(rid, root=runs_root)


def test_load_unsupported_schema_version_raises(runs_root: Path):
    rid, slug = _fresh()
    s = create(rid, slug)
    save(s, root=runs_root)
    path = runs_root / rid / "run_state.yaml"
    text = path.read_text(encoding="utf-8")
    path.write_text(text.replace("schema_version: 0", "schema_version: 99"))
    with pytest.raises(SchemaVersionMismatchError):
        load(rid, root=runs_root)


def test_mark_completed_freezes_run():
    rid, slug = _fresh()
    s0 = create(rid, slug)
    s1 = mark_completed(s0)
    assert s1.frozen is True
    assert s1.status == RunStatus.COMPLETED


def test_frozen_run_rejects_further_mutations():
    rid, slug = _fresh()
    s = mark_completed(create(rid, slug))
    with pytest.raises(RunStateFrozenError):
        set_node_status(s, "step-1", NodeStatus.COMPLETED)
    with pytest.raises(RunStateFrozenError):
        set_node_output(s, "step-1", {})
    with pytest.raises(RunStateFrozenError):
        mark_completed(s)


def test_mark_failed_freezes_with_failure_info():
    rid, slug = _fresh()
    s = mark_failed(create(rid, slug), {"node_id": "step-1", "error_class": "Boom"})
    assert s.frozen is True
    assert s.status == RunStatus.FAILED
    assert s.failure_info == {"node_id": "step-1", "error_class": "Boom"}


def test_mark_suspended_freezes_for_pause():
    rid, slug = _fresh()
    s = mark_suspended(create(rid, slug))
    assert s.frozen is True
    assert s.status == RunStatus.SUSPENDED


# ---------------------------------------------------------------------
# Path-traversal defense (security:plan-audit finding #5)
# ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "../etc/passwd",
        "../../../tmp/x",
        "foo/bar",
        "foo\\bar",
        "foo\x00bar",
        ".hidden-run",
        "not-a-ulid-shape",
        "0000000000000000000000000000",  # missing slug
        "0000000000000000000000000000-",  # empty slug
        "I000000000000000000000000-test",  # invalid Crockford char `I`
    ],
)
def test_validate_run_id_rejects_bad_inputs(bad: str):
    with pytest.raises(InvalidRunIdError):
        validate_run_id(bad)


def test_validate_run_id_accepts_canonical_make_run_id():
    rid = make_run_id("code-review")
    validate_run_id(rid)  # no raise


def test_load_rejects_path_traversal_run_id(runs_root: Path):
    with pytest.raises(InvalidRunIdError):
        load("../../../etc/passwd", root=runs_root)


def test_save_rejects_path_traversal_run_id(runs_root: Path):
    bad = create.__wrapped__ if hasattr(create, "__wrapped__") else None
    rid_legit, slug = _fresh()
    state = create(rid_legit, slug)
    state.run_id = "../escape"
    with pytest.raises(InvalidRunIdError):
        save(state, root=runs_root)
