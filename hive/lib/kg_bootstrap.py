"""Bootstrap and migrate the L2 knowledge-graph SQLite schema.

Canonical DDL mirrors hive/references/knowledge-graph-schema.md#sqlite-bootstrap.
Every statement is idempotent (IF NOT EXISTS / INSERT OR IGNORE), so running
this against an existing kg.sqlite doubles as the migration that seeds newly
declared predicates — e.g. ``phase_handoff`` (b3-phase-handoff-declare) — into
the predicates table before FK enforcement rejects their emits.

Usage:
    python3 -m hive.lib.kg_bootstrap [db_path]

db_path falls back to $HIVE_KG_SQLITE_PATH, then ~/.claude/hive/kg.sqlite.
"""

from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path

DEFAULT_KG_SQLITE_PATH = Path.home() / ".claude" / "hive" / "kg.sqlite"

# Controlled predicate vocabulary — keep in sync with
# hive/references/knowledge-graph-schema.md#controlled-predicate-vocabulary.
SEED_PREDICATES: tuple[str, ...] = (
    "decided",
    "superseded",
    "assigned_to",
    "blocked_by",
    "depends_on",
    "phase_started",
    "phase_complete",
    "phase_failed",
    "phase_blocked",
    "phase_handoff",
    "validated",
    "tested",
    "implemented",
)

_BOOTSTRAP_DDL = """
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
CREATE INDEX IF NOT EXISTS idx_subject ON triples(subject);
CREATE INDEX IF NOT EXISTS idx_object ON triples(object);
CREATE INDEX IF NOT EXISTS idx_predicate ON triples(predicate);
CREATE INDEX IF NOT EXISTS idx_valid ON triples(valid_from, valid_until);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_triple
  ON triples(subject, predicate, object, source_epic);
"""


def resolve_db_path(db_path: str | Path | None = None) -> Path:
    if db_path is not None:
        return Path(db_path)
    return Path(os.environ.get("HIVE_KG_SQLITE_PATH", DEFAULT_KG_SQLITE_PATH))


def bootstrap_kg(db_path: str | Path | None = None) -> Path:
    """Create or migrate kg.sqlite. Safe to re-run (idempotent)."""
    path = resolve_db_path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(path)) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(_BOOTSTRAP_DDL)
        conn.executemany(
            "INSERT OR IGNORE INTO predicates VALUES (?)",
            [(p,) for p in SEED_PREDICATES],
        )
        conn.commit()
    return path


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    path = bootstrap_kg(args[0] if args else None)
    print(f"kg bootstrap OK: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
