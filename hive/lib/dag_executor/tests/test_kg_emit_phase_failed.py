from __future__ import annotations

import importlib
import sqlite3
import sys
from pathlib import Path

import pytest

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.errors import HandlerError
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker
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
            ORDER BY valid_from
            """
        ).fetchall()


def _load_kg_emit(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, knob: str = "phase"):
    config_path = tmp_path / "hive.config.yaml"
    config_path.write_text(f"emit_lifecycle_at: {knob}\n", encoding="utf-8")
    monkeypatch.setenv("HIVE_CONFIG", str(config_path))
    sys.modules.pop("hive.lib.config", None)
    sys.modules.pop("hive.lib.kg_emit", None)
    return importlib.import_module("hive.lib.kg_emit")


def _failing_graph() -> Graph:
    node = Node(id="fail-phase", agent="developer", node_type=NodeType.AGENT)
    return Graph(workflow_name="kg-emit-test", nodes={node.id: node}, edges=[])


def _failing_dispatcher(message: str) -> Dispatcher:
    def handler(node, inputs, run_id):
        raise HandlerError(message)

    return Dispatcher(handlers={NodeType.AGENT: handler})


def test_emit_kg_event_writes_js_parity_triple_shape(monkeypatch, tmp_path):
    db_path = tmp_path / "kg.sqlite"
    _kg_schema(db_path)
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(db_path))
    kg_emit = _load_kg_emit(monkeypatch, tmp_path)
    kg_emit.reset_kg_writes_counter_for_test()

    result = kg_emit.emit_kg_event(
        subject="story-1",
        predicate="phase_failed",
        obj="handler-error",
        source_epic="kg-signal-revival",
        source_agent="tester",
    )

    assert result["emitted"] is True
    row = _rows(db_path)[0]
    assert row[0] == "story-1"
    assert row[1] == "phase_failed"
    assert row[2] == "handler-error"
    assert row[3]
    assert row[4] is None
    assert row[5] == "kg-signal-revival"
    assert row[6] == "tester"
    assert sorted(result["metadata"].keys()) == [
        "object",
        "predicate",
        "source_agent",
        "source_epic",
        "subject",
        "valid_from",
        "valid_until",
    ]
    assert kg_emit.get_kg_writes_counter_snapshot()["kg_writes_total"]["phase_failed"] == 1


def test_emit_lifecycle_at_off_no_write(monkeypatch, tmp_path):
    db_path = tmp_path / "kg.sqlite"
    _kg_schema(db_path)
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(db_path))
    kg_emit = _load_kg_emit(monkeypatch, tmp_path, knob="off")
    kg_emit.reset_kg_writes_counter_for_test()

    result = kg_emit.emit_kg_event(
        subject="story-1",
        predicate="phase_failed",
        obj="handler-error",
        source_epic="kg-signal-revival",
        source_agent="tester",
    )

    assert result == {"emitted": False, "metadata": None}
    assert _rows(db_path) == []
    assert kg_emit.get_kg_writes_counter_snapshot() == {"kg_writes_total": {}}


def test_missing_kg_sqlite_is_silent_noop(monkeypatch, tmp_path):
    missing = tmp_path / "missing.sqlite"
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(missing))
    kg_emit = _load_kg_emit(monkeypatch, tmp_path)

    result = kg_emit.emit_kg_event(
        subject="story-1",
        predicate="phase_failed",
        obj="handler-error",
        source_epic="kg-signal-revival",
        source_agent="tester",
    )

    assert result == {"emitted": False, "metadata": None}


def test_sanitize_obj_strips_sensitive_fragments_and_caps_length(monkeypatch, tmp_path):
    kg_emit = _load_kg_emit(monkeypatch, tmp_path)
    raw = (
        'Boom!\nFile "/Users/don/project/hive/lib/secret.py", line 27, in run\n'
        "/Users/don/project/private/token.txt: API_KEY=abc123 "
        + "X" * 100
    )

    sanitized = kg_emit.sanitize_obj(raw)

    assert sanitized == sanitized.lower()
    assert len(sanitized) <= 80
    assert "\n" not in sanitized
    assert "/" not in sanitized
    assert "file" not in sanitized
    assert "line-27" not in sanitized
    assert "users" not in sanitized
    assert all(ch.isalnum() or ch == "-" for ch in sanitized)


def test_walker_terminal_failure_emits_phase_failed(monkeypatch, tmp_path):
    db_path = tmp_path / "kg.sqlite"
    _kg_schema(db_path)
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(db_path))
    kg_emit = _load_kg_emit(monkeypatch, tmp_path)
    kg_emit.reset_kg_writes_counter_for_test()

    tel = Telemetry(run_id="rid-kg-fail")
    with pytest.raises(HandlerError):
        Walker().walk(
            _failing_graph(),
            _failing_dispatcher("File \"/tmp/secret.py\", line 9\nFailure /tmp/private/key"),
            "rid-kg-fail",
            tel,
            context={"epic_id": "kg-signal-revival"},
        )

    rows = _rows(db_path)
    # s3-phase-lifecycle-wire: entering the node also emits phase_started,
    # so filter to the phase_failed triple under test.
    failed_rows = [row for row in rows if row[1] == "phase_failed"]
    assert len(failed_rows) == 1
    assert failed_rows[0][0] == "fail-phase"
    assert failed_rows[0][2] == "failure"
    assert failed_rows[0][5] == "kg-signal-revival"
    assert failed_rows[0][6] == "dag-executor"
    assert kg_emit.get_kg_writes_counter_snapshot()["kg_writes_total"]["phase_failed"] > 0


def test_walker_terminal_failure_respects_off_knob(monkeypatch, tmp_path):
    db_path = tmp_path / "kg.sqlite"
    _kg_schema(db_path)
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(db_path))
    _load_kg_emit(monkeypatch, tmp_path, knob="off")

    tel = Telemetry(run_id="rid-kg-off")
    with pytest.raises(HandlerError):
        Walker().walk(
            _failing_graph(),
            _failing_dispatcher("boom"),
            "rid-kg-off",
            tel,
            context={"epic_id": "kg-signal-revival"},
        )

    assert _rows(db_path) == []
