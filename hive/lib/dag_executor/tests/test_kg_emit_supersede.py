from __future__ import annotations

import importlib
import sqlite3
import sys
from pathlib import Path

import pytest


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


def _load_kg_emit(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, knob: str = "phase"):
    config_path = tmp_path / "hive.config.yaml"
    config_path.write_text(f"emit_lifecycle_at: {knob}\n", encoding="utf-8")
    monkeypatch.setenv("HIVE_CONFIG", str(config_path))
    sys.modules.pop("hive.lib.config", None)
    sys.modules.pop("hive.lib.kg_emit", None)
    return importlib.import_module("hive.lib.kg_emit")


def _rows(db_path: Path) -> list[tuple[str, str, str, str, str | None, str, str]]:
    with sqlite3.connect(str(db_path)) as conn:
        return conn.execute(
            """
            SELECT subject, predicate, object, valid_from, valid_until, source_epic, source_agent
            FROM triples
            ORDER BY predicate, object
            """
        ).fetchall()


def test_emit_superseded_updates_prior_and_inserts_event_in_one_call(monkeypatch, tmp_path):
    db_path = tmp_path / "kg.sqlite"
    _kg_schema(db_path)
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(db_path))
    kg_emit = _load_kg_emit(monkeypatch, tmp_path)
    kg_emit.reset_kg_writes_counter_for_test()
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute(
            """
            INSERT INTO triples
              (subject, predicate, object, valid_from, source_epic, source_agent)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("story-1", "story-spec", "old-hash", "2026-05-01T00:00:00Z", "kg-signal-revival", "plan"),
        )
        conn.commit()

    result = kg_emit.emit_superseded(
        subject="story-1",
        predicate="story-spec",
        prior_object="old-hash",
        new_object="new-hash",
        source_epic="kg-signal-revival",
        source_agent="plan",
    )

    assert result["emitted"] is True
    assert result["metadata"]["prior_valid_until_updated"] is True
    rows = _rows(db_path)
    prior = [row for row in rows if row[1] == "story-spec"][0]
    event = [row for row in rows if row[1] == "superseded"][0]
    assert prior[4] is not None
    assert event[0] == "story-1"
    assert event[2] == "old-hash->new-hash"
    assert event[4] is None
    assert kg_emit.get_kg_writes_counter_snapshot()["kg_writes_total"]["superseded"] == 1


def test_emit_superseded_off_knob_noop(monkeypatch, tmp_path):
    db_path = tmp_path / "kg.sqlite"
    _kg_schema(db_path)
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(db_path))
    kg_emit = _load_kg_emit(monkeypatch, tmp_path, knob="off")

    result = kg_emit.emit_superseded(
        subject="story-1",
        predicate="story-spec",
        prior_object="old-hash",
        new_object="new-hash",
        source_epic="kg-signal-revival",
        source_agent="plan",
    )

    assert result == {"emitted": False, "metadata": None}
    assert _rows(db_path) == []


def test_emit_superseded_missing_sqlite_noop(monkeypatch, tmp_path):
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(tmp_path / "missing.sqlite"))
    kg_emit = _load_kg_emit(monkeypatch, tmp_path)

    result = kg_emit.emit_superseded(
        subject="story-1",
        predicate="story-spec",
        prior_object="old-hash",
        new_object="new-hash",
        source_epic="kg-signal-revival",
        source_agent="plan",
    )

    assert result == {"emitted": False, "metadata": None}


def test_emit_superseded_prior_not_found_still_emits_provenance(monkeypatch, tmp_path):
    db_path = tmp_path / "kg.sqlite"
    _kg_schema(db_path)
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(db_path))
    kg_emit = _load_kg_emit(monkeypatch, tmp_path)

    result = kg_emit.emit_superseded(
        subject="story-1",
        predicate="story-spec",
        prior_object="old-hash",
        new_object="new-hash",
        source_epic="kg-signal-revival",
        source_agent="plan",
    )

    assert result["emitted"] is True
    assert result["metadata"]["prior_valid_until_updated"] is False
    assert _rows(db_path)[0][1:3] == ("superseded", "old-hash->new-hash")


def test_emit_superseded_sanitizes_prior_and_new_objects(monkeypatch, tmp_path):
    db_path = tmp_path / "kg.sqlite"
    _kg_schema(db_path)
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(db_path))
    kg_emit = _load_kg_emit(monkeypatch, tmp_path)

    result = kg_emit.emit_superseded(
        subject="story-1",
        predicate="story-spec",
        prior_object='Old File "/tmp/private/a.py", line 2',
        new_object="New Value /tmp/private/b.py",
        source_epic="kg-signal-revival",
        source_agent="plan",
    )

    assert result["metadata"]["prior_object"] == "old"
    assert result["metadata"]["new_object"] == "new-value"
    assert _rows(db_path)[0][2] == "old->new-value"
