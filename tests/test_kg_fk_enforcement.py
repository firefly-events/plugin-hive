"""FK enforcement on kg.sqlite connections (b2-fk-enforcement-audit).

The schema declares ``predicate TEXT NOT NULL REFERENCES predicates(predicate)``
but SQLite only enforces foreign keys when ``PRAGMA foreign_keys = ON`` runs on
each connection. These tests pin two things:

1. Regression: with the PRAGMA set, an INSERT with an undeclared predicate
   raises sqlite3.IntegrityError (ON CONFLICT / OR IGNORE does not apply to
   FK constraints).
2. Lint: every kg.sqlite connect callsite in the audited surfaces sets the
   PRAGMA within 10 lines of opening the connection.

Run from the repo root with:

    python3 -m pytest tests/test_kg_fk_enforcement.py
"""

from __future__ import annotations

import importlib
import re
import sqlite3
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]

# Canonical bootstrap DDL — mirrors
# hive/references/knowledge-graph-schema.md#sqlite-bootstrap.
_BOOTSTRAP_DDL = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS triples (
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL REFERENCES predicates(predicate),
  object TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  source_epic TEXT,
  source_agent TEXT
);
CREATE TABLE IF NOT EXISTS predicates (predicate TEXT PRIMARY KEY);
INSERT OR IGNORE INTO predicates VALUES
  ('decided'), ('superseded'), ('assigned_to'), ('blocked_by'), ('depends_on'),
  ('phase_started'), ('phase_complete'), ('phase_failed'), ('phase_blocked');
CREATE INDEX IF NOT EXISTS idx_subject ON triples(subject);
CREATE INDEX IF NOT EXISTS idx_object ON triples(object);
CREATE INDEX IF NOT EXISTS idx_predicate ON triples(predicate);
CREATE INDEX IF NOT EXISTS idx_valid ON triples(valid_from, valid_until);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_triple
  ON triples(subject, predicate, object, source_epic);
"""


def _bootstrap_kg(db_path: Path) -> None:
    with sqlite3.connect(str(db_path)) as conn:
        conn.executescript(_BOOTSTRAP_DDL)
        conn.commit()


def _load_kg_emit(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, knob: str = "phase"):
    config_path = tmp_path / "hive.config.yaml"
    config_path.write_text(f"emit_lifecycle_at: {knob}\n", encoding="utf-8")
    monkeypatch.setenv("HIVE_CONFIG", str(config_path))
    sys.modules.pop("hive.lib.config", None)
    sys.modules.pop("hive.lib.kg_emit", None)
    return importlib.import_module("hive.lib.kg_emit")


def test_undeclared_predicate_raises_integrity_error(tmp_path: Path) -> None:
    db_path = tmp_path / "kg.sqlite"
    _bootstrap_kg(db_path)
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                """
                INSERT OR IGNORE INTO triples
                  (subject, predicate, object, valid_from, source_epic, source_agent)
                VALUES ('s', 'bogus_undeclared', 'o', '2026-01-01T00:00:00Z', 'e', 'a')
                """
            )


def test_undeclared_predicate_silently_succeeds_without_pragma(tmp_path: Path) -> None:
    # Documents the failure mode this story closes: FK off → bad emit succeeds.
    db_path = tmp_path / "kg.sqlite"
    _bootstrap_kg(db_path)
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO triples
              (subject, predicate, object, valid_from, source_epic, source_agent)
            VALUES ('s', 'bogus_undeclared', 'o', '2026-01-01T00:00:00Z', 'e', 'a')
            """
        )
        count = conn.execute(
            "SELECT COUNT(*) FROM triples WHERE predicate = 'bogus_undeclared'"
        ).fetchone()[0]
    assert count == 1


def test_emit_kg_event_raises_on_undeclared_predicate(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    kg_emit = _load_kg_emit(monkeypatch, tmp_path)
    db_path = tmp_path / "kg.sqlite"
    _bootstrap_kg(db_path)
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(db_path))
    with pytest.raises(sqlite3.IntegrityError):
        kg_emit.emit_kg_event(
            subject="story:x",
            predicate="bogus_undeclared",
            obj="whatever",
            source_epic="kg-repair-activation",
            source_agent="developer",
        )


def test_emit_kg_event_declared_predicate_still_writes(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    kg_emit = _load_kg_emit(monkeypatch, tmp_path)
    db_path = tmp_path / "kg.sqlite"
    _bootstrap_kg(db_path)
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(db_path))
    result = kg_emit.emit_kg_event(
        subject="story:x",
        predicate="decided",
        obj="ship-it",
        source_epic="kg-repair-activation",
        source_agent="developer",
    )
    assert result["emitted"] is True
    with sqlite3.connect(str(db_path)) as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM triples WHERE predicate = 'decided'"
        ).fetchone()[0]
    assert count == 1


# --- Lint: connect callsites must enable FK enforcement -----------------

_PRAGMA_WINDOW = 10

# Audited surfaces per the story: hive/lib/kg_*, hive/lib/dag_executor (non-test),
# scripts/kg-*, plus the session-end.js KG writer.
_PY_GLOBS = (
    "hive/lib/kg_*.py",
    "hive/lib/kg_signal/**/*.py",
    "hive/lib/dag_executor/executor/**/*.py",
)
_JS_GLOBS = (
    "scripts/kg-*.js",
    "hive/lib/session-end.js",
)

_PY_CONNECT = re.compile(r"sqlite3\.connect\(")
_JS_CONNECT = re.compile(r"new Database\(|=\s*sqlite3\(")
_PY_PRAGMA = "PRAGMA foreign_keys"
_JS_PRAGMA = "foreign_keys = ON"


def _violations(path: Path, connect_re: re.Pattern[str], pragma_marker: str) -> list[str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    bad: list[str] = []
    for i, line in enumerate(lines):
        if not connect_re.search(line):
            continue
        window = "\n".join(lines[i : i + _PRAGMA_WINDOW + 1])
        if pragma_marker not in window:
            bad.append(f"{path.relative_to(REPO_ROOT)}:{i + 1}")
    return bad


def test_lint_kg_connect_sites_enable_foreign_keys() -> None:
    violations: list[str] = []
    for pattern in _PY_GLOBS:
        for path in sorted(REPO_ROOT.glob(pattern)):
            if "tests" in path.parts:
                continue
            violations.extend(_violations(path, _PY_CONNECT, _PY_PRAGMA))
    for pattern in _JS_GLOBS:
        for path in sorted(REPO_ROOT.glob(pattern)):
            violations.extend(_violations(path, _JS_CONNECT, _JS_PRAGMA))
    assert not violations, (
        "kg.sqlite connection(s) missing 'PRAGMA foreign_keys = ON' within "
        f"{_PRAGMA_WINDOW} lines of connect: {violations}"
    )
