from __future__ import annotations

import importlib
import sqlite3
import sys
from pathlib import Path

import pytest

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.handlers import NodeOutput
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import (
    Walker,
    _phase_blocked_slug,
    _record_skipped,
)
from hive.lib.dag_executor.graph import Graph, Node, NodeType


def _kg_schema(db_path: Path) -> None:
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute(
            """
            CREATE TABLE triples (
              subject TEXT,
              predicate TEXT,
              object TEXT,
              valid_from TEXT,
              valid_until TEXT,
              source_epic TEXT,
              source_agent TEXT
            )
            """
        )
        conn.execute(
            "CREATE UNIQUE INDEX idx_unique_triple ON triples(subject, predicate, object, source_epic)"
        )
        conn.commit()


def _rows(db_path: Path) -> list[tuple[str, str, str, str, str | None, str, str]]:
    with sqlite3.connect(str(db_path)) as conn:
        return conn.execute(
            """
            SELECT subject, predicate, object, valid_from, valid_until, source_epic, source_agent
            FROM triples
            ORDER BY valid_from, subject
            """
        ).fetchall()


def _load_kg_emit(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, knob: str = "phase"):
    config_path = tmp_path / "hive.config.yaml"
    config_path.write_text(f"emit_lifecycle_at: {knob}\n", encoding="utf-8")
    monkeypatch.setenv("HIVE_CONFIG", str(config_path))
    sys.modules.pop("hive.lib.config", None)
    sys.modules.pop("hive.lib.kg_emit", None)
    return importlib.import_module("hive.lib.kg_emit")


def _upstream_skip_graph() -> Graph:
    first = Node(
        id="upstream-a",
        agent="developer",
        node_type=NodeType.AGENT,
        skip_when="true",
    )
    second = Node(
        id="upstream-b",
        agent="developer",
        node_type=NodeType.AGENT,
        skip_when="true",
    )
    join = Node(
        id="join-phase",
        agent="developer",
        node_type=NodeType.AGENT,
        depends_on=["upstream-a", "upstream-b"],
    )
    return Graph(
        workflow_name="kg-emit-blocked-test",
        nodes={node.id: node for node in [first, second, join]},
        edges=[],
    )


def _noop_dispatcher() -> Dispatcher:
    def handler(node, inputs, run_id):
        return NodeOutput(outputs={"ok": True}, meta={})

    return Dispatcher(handlers={NodeType.AGENT: handler})


def test_record_skipped_emits_phase_blocked_upstream_skip_shape(monkeypatch, tmp_path):
    db_path = tmp_path / "kg.sqlite"
    _kg_schema(db_path)
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(db_path))
    kg_emit = _load_kg_emit(monkeypatch, tmp_path)
    kg_emit.reset_kg_writes_counter_for_test()

    result = _record_skipped(
        None,
        "join-phase",
        {
            "reason": "trigger_rule:none_failed_min_one_success",
            "upstream_statuses": {"upstream-a": "skipped", "upstream-b": "skipped"},
        },
        source_epic="kg-signal-revival",
    )

    assert result is None
    row = _rows(db_path)[0]
    assert row[0] == "join-phase"
    assert row[1] == "phase_blocked"
    assert row[2] == "upstream-skipped"
    assert row[3]
    assert row[4] is None
    assert row[5] == "kg-signal-revival"
    assert row[6] == "dag-executor"
    assert kg_emit.get_kg_writes_counter_snapshot()["kg_writes_total"]["phase_blocked"] == 1


def test_phase_blocked_respects_off_knob(monkeypatch, tmp_path):
    db_path = tmp_path / "kg.sqlite"
    _kg_schema(db_path)
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(db_path))
    _load_kg_emit(monkeypatch, tmp_path, knob="off")

    _record_skipped(
        None,
        "join-phase",
        {"upstream_statuses": {"upstream-a": "skipped"}},
        source_epic="kg-signal-revival",
    )

    assert _rows(db_path) == []


def test_phase_blocked_missing_kg_sqlite_is_silent_noop(monkeypatch, tmp_path):
    missing = tmp_path / "missing.sqlite"
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(missing))
    _load_kg_emit(monkeypatch, tmp_path)

    result = _record_skipped(
        None,
        "join-phase",
        {"upstream_statuses": {"upstream-a": "skipped"}},
        source_epic="kg-signal-revival",
    )

    assert result is None


def test_walker_synthetic_dag_forces_upstream_skip_triple(monkeypatch, tmp_path):
    db_path = tmp_path / "kg.sqlite"
    _kg_schema(db_path)
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(db_path))
    kg_emit = _load_kg_emit(monkeypatch, tmp_path)
    kg_emit.reset_kg_writes_counter_for_test()

    tel = Telemetry(run_id="rid-kg-blocked")
    Walker().walk(
        _upstream_skip_graph(),
        _noop_dispatcher(),
        "rid-kg-blocked",
        tel,
        context={"epic_id": "kg-signal-revival"},
    )

    rows = _rows(db_path)
    join_rows = [row for row in rows if row[0] == "join-phase"]
    assert len(join_rows) == 1
    assert join_rows[0][1] == "phase_blocked"
    assert join_rows[0][2] == "upstream-skipped"
    assert join_rows[0][5] == "kg-signal-revival"
    assert join_rows[0][6] == "dag-executor"
    assert kg_emit.get_kg_writes_counter_snapshot()["kg_writes_total"]["phase_blocked"] == 3


def test_phase_blocked_slug_taxonomy_is_sanitized_and_bounded():
    assert _phase_blocked_slug({"upstream_statuses": {"a": "failed"}}) == "upstream-failed"
    assert _phase_blocked_slug({"upstream_statuses": {"a": "skipped"}}) == "upstream-skipped"
    assert _phase_blocked_slug({"reason": "when_predicate_false"}) == "trigger-rule-skip"

    for slug in [
        _phase_blocked_slug({"upstream_statuses": {"a": "failed"}}),
        _phase_blocked_slug({"upstream_statuses": {"a": "skipped"}}),
        _phase_blocked_slug({"reason": "when_predicate_false"}),
    ]:
        assert len(slug) <= 32
        assert slug == slug.lower()
        assert all(ch.isalnum() or ch == "-" for ch in slug)
