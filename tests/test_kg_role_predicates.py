"""Role verdict predicate declarations (s5-role-predicates-schema).

s6/s7/s8 will wire reviewer/tester/developer emits for ``validated``,
``tested``, and ``implemented``; with FK enforcement on
(b2-fk-enforcement-audit) each predicate must be declared in the predicates
table before any emit lands. These tests pin:

1. The schema doc declares all three in its vocabulary table and bootstrap DDL.
2. bootstrap_kg seeds all three on fresh DBs.
3. bootstrap_kg migrates existing DBs missing the role predicates (idempotent).
4. emit via kg_emit_cli with each role predicate succeeds under FK enforcement.

Run from the repo root with:

    python3 -m pytest tests/test_kg_role_predicates.py
"""

from __future__ import annotations

import importlib
import json
import sqlite3
import sys
from pathlib import Path

import pytest

from hive.lib.kg_bootstrap import SEED_PREDICATES, bootstrap_kg

REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DOC = REPO_ROOT / "hive" / "references" / "knowledge-graph-schema.md"
STEP_02C = (
    REPO_ROOT
    / "hive"
    / "workflows"
    / "steps"
    / "meta-team-cycle"
    / "step-02c-kg-signal.md"
)

ROLE_PREDICATES = ("validated", "tested", "implemented")

# Pre-s5 bootstrap DDL — an existing DB whose predicates table predates the
# role verdict predicates. Used to exercise the migration path.
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
  ('phase_started'), ('phase_complete'), ('phase_failed'), ('phase_blocked'),
  ('phase_handoff');
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_triple
  ON triples(subject, predicate, object, source_epic);
"""


def _predicates(db_path: Path) -> set[str]:
    with sqlite3.connect(str(db_path)) as conn:
        rows = conn.execute("SELECT predicate FROM predicates").fetchall()
    return {row[0] for row in rows}


def _load_kg_emit_cli(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, knob: str = "phase"):
    config_path = tmp_path / "hive.config.yaml"
    config_path.write_text(f"emit_lifecycle_at: {knob}\n", encoding="utf-8")
    monkeypatch.setenv("HIVE_CONFIG", str(config_path))
    sys.modules.pop("hive.lib.config", None)
    sys.modules.pop("hive.lib.kg_emit", None)
    sys.modules.pop("hive.lib.kg_emit_cli", None)
    return importlib.import_module("hive.lib.kg_emit_cli")


def test_schema_doc_declares_role_predicates() -> None:
    text = SCHEMA_DOC.read_text(encoding="utf-8")
    assert "('validated'), ('tested'), ('implemented')" in text, (
        "bootstrap DDL must seed validated, tested, implemented"
    )
    for predicate in ROLE_PREDICATES:
        assert f"| `{predicate}` |" in text, (
            f"predicate vocabulary table must describe {predicate}"
        )


def test_step_02c_consumer_query_includes_role_predicates() -> None:
    text = STEP_02C.read_text(encoding="utf-8")
    for predicate in ROLE_PREDICATES:
        assert f'query_decisions({{ predicate: "{predicate}"' in text, (
            f"step-02c consumer query must cover {predicate}"
        )


def test_seed_predicates_include_role_predicates() -> None:
    for predicate in ROLE_PREDICATES:
        assert predicate in SEED_PREDICATES


def test_bootstrap_fresh_db_seeds_role_predicates(tmp_path: Path) -> None:
    db_path = tmp_path / "kg.sqlite"
    bootstrap_kg(db_path)
    assert set(ROLE_PREDICATES) <= _predicates(db_path)


def test_bootstrap_migrates_existing_db_idempotently(tmp_path: Path) -> None:
    db_path = tmp_path / "kg.sqlite"
    with sqlite3.connect(str(db_path)) as conn:
        conn.executescript(_LEGACY_DDL)
        conn.commit()
    assert not set(ROLE_PREDICATES) & _predicates(db_path)

    bootstrap_kg(db_path)
    assert set(ROLE_PREDICATES) <= _predicates(db_path)

    # Re-run is safe: no duplicates, no errors.
    bootstrap_kg(db_path)
    with sqlite3.connect(str(db_path)) as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM predicates WHERE predicate IN (?, ?, ?)",
            ROLE_PREDICATES,
        ).fetchone()[0]
    assert count == 3


@pytest.mark.parametrize("predicate", ROLE_PREDICATES)
def test_emit_cli_role_predicate_succeeds_with_fk_on(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    predicate: str,
) -> None:
    kg_emit_cli = _load_kg_emit_cli(monkeypatch, tmp_path)
    db_path = tmp_path / "kg.sqlite"
    bootstrap_kg(db_path)
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(db_path))

    exit_code = kg_emit_cli.main(
        [
            "--subject",
            "story:s5-role-predicates-schema",
            "--predicate",
            predicate,
            "--object",
            "pass",
            "--source-epic",
            "kg-repair-activation",
            "--source-agent",
            "developer",
            "--json",
        ]
    )
    assert exit_code == 0
    result = json.loads(capsys.readouterr().out)
    assert result["emitted"] is True

    with sqlite3.connect(str(db_path)) as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM triples WHERE predicate = ?", (predicate,)
        ).fetchone()[0]
    assert count == 1
