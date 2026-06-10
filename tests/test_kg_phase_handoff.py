"""phase_handoff predicate declaration (b3-phase-handoff-declare).

hive/lib/handoff/dispatch.mjs emits ``phase_handoff`` triples; with FK
enforcement on (b2-fk-enforcement-audit) the predicate must be declared in
the predicates table or every emit raises IntegrityError. These tests pin:

1. The schema doc declares phase_handoff in its bootstrap DDL.
2. bootstrap_kg seeds phase_handoff on fresh DBs.
3. bootstrap_kg migrates existing DBs missing phase_handoff (idempotent).
4. emit_kg_event with predicate=phase_handoff succeeds under FK enforcement.

Run from the repo root with:

    python3 -m pytest tests/test_kg_phase_handoff.py
"""

from __future__ import annotations

import importlib
import sqlite3
import sys
from pathlib import Path

import pytest

from hive.lib.kg_bootstrap import SEED_PREDICATES, bootstrap_kg

REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DOC = REPO_ROOT / "hive" / "references" / "knowledge-graph-schema.md"

# Pre-b3 bootstrap DDL — an existing DB whose predicates table predates
# phase_handoff. Used to exercise the migration path.
_LEGACY_DDL = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS predicates (predicate TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS triples (
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL REFERENCES predicates(predicate),
  object TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  source_epic TEXT,
  source_agent TEXT
);
INSERT OR IGNORE INTO predicates VALUES
  ('decided'), ('superseded'), ('assigned_to'), ('blocked_by'), ('depends_on'),
  ('phase_started'), ('phase_complete'), ('phase_failed'), ('phase_blocked');
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_triple
  ON triples(subject, predicate, object, source_epic);
"""


def _predicates(db_path: Path) -> set[str]:
    with sqlite3.connect(str(db_path)) as conn:
        rows = conn.execute("SELECT predicate FROM predicates").fetchall()
    return {row[0] for row in rows}


def _load_kg_emit(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, knob: str = "phase"):
    config_path = tmp_path / "hive.config.yaml"
    config_path.write_text(f"emit_lifecycle_at: {knob}\n", encoding="utf-8")
    monkeypatch.setenv("HIVE_CONFIG", str(config_path))
    sys.modules.pop("hive.lib.config", None)
    sys.modules.pop("hive.lib.kg_emit", None)
    return importlib.import_module("hive.lib.kg_emit")


def test_schema_doc_declares_phase_handoff() -> None:
    text = SCHEMA_DOC.read_text(encoding="utf-8")
    assert "('phase_handoff')" in text, "bootstrap DDL must seed phase_handoff"
    assert "| `phase_handoff` |" in text, (
        "predicate vocabulary table must describe phase_handoff"
    )


def test_seed_predicates_include_phase_handoff() -> None:
    assert "phase_handoff" in SEED_PREDICATES
    assert len(SEED_PREDICATES) == 13


def test_bootstrap_fresh_db_seeds_phase_handoff(tmp_path: Path) -> None:
    db_path = tmp_path / "kg.sqlite"
    bootstrap_kg(db_path)
    assert "phase_handoff" in _predicates(db_path)


def test_bootstrap_migrates_existing_db_idempotently(tmp_path: Path) -> None:
    db_path = tmp_path / "kg.sqlite"
    with sqlite3.connect(str(db_path)) as conn:
        conn.executescript(_LEGACY_DDL)
        conn.commit()
    assert "phase_handoff" not in _predicates(db_path)

    bootstrap_kg(db_path)
    assert "phase_handoff" in _predicates(db_path)

    # Re-run is safe: no duplicates, no errors.
    bootstrap_kg(db_path)
    with sqlite3.connect(str(db_path)) as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM predicates WHERE predicate = 'phase_handoff'"
        ).fetchone()[0]
    assert count == 1


def test_emit_phase_handoff_succeeds_with_fk_on(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    kg_emit = _load_kg_emit(monkeypatch, tmp_path)
    db_path = tmp_path / "kg.sqlite"
    bootstrap_kg(db_path)
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(db_path))
    # Mirrors hive/lib/handoff/dispatch.mjs emitPhaseHandoffTriple payload.
    result = kg_emit.emit_kg_event(
        subject="story:b3-phase-handoff-declare",
        predicate="phase_handoff",
        obj="review:pass",
        source_epic="kg-repair-activation",
        source_agent="handoff-dispatch",
    )
    assert result["emitted"] is True
    with sqlite3.connect(str(db_path)) as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM triples WHERE predicate = 'phase_handoff'"
        ).fetchone()[0]
    assert count == 1


def test_emit_phase_handoff_on_migrated_legacy_db(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    kg_emit = _load_kg_emit(monkeypatch, tmp_path)
    db_path = tmp_path / "kg.sqlite"
    with sqlite3.connect(str(db_path)) as conn:
        conn.executescript(_LEGACY_DDL)
        conn.commit()
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(db_path))

    # Pre-migration: FK enforcement rejects the undeclared predicate.
    with pytest.raises(sqlite3.IntegrityError):
        kg_emit.emit_kg_event(
            subject="story:x",
            predicate="phase_handoff",
            obj="test:fail",
            source_epic="kg-repair-activation",
            source_agent="handoff-dispatch",
        )

    bootstrap_kg(db_path)
    result = kg_emit.emit_kg_event(
        subject="story:x",
        predicate="phase_handoff",
        obj="test:pass",
        source_epic="kg-repair-activation",
        source_agent="handoff-dispatch",
    )
    assert result["emitted"] is True
