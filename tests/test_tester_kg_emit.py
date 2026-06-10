"""Tester shutdown emit of the ``tested`` role triple (s7-tester-emit).

Pins the s7 contract:

1. A completed story test run emits exactly one ``tested`` triple at
   shutdown with object equal to the verdict (pass | fail | inconclusive),
   source_agent=tester, source_epic=<epic-id>.
2. The object is case-stable: ``"Pass"`` lands as ``"pass"``.
3. Shutdown without a completed test run emits nothing (silent).
4. Replayed shutdowns cannot double-count (unique-index absorption).
5. Objects outside the closed vocabulary are rejected without a write.
6. ``hive/agents/tester.md`` declares the shutdown-emit contract.

Run from the repo root with:

    python3 -m pytest tests/test_tester_kg_emit.py
"""

from __future__ import annotations

import importlib
import sqlite3
import sys
from pathlib import Path

import pytest

from hive.lib.kg_bootstrap import bootstrap_kg

REPO_ROOT = Path(__file__).resolve().parents[1]
TESTER_DOC = REPO_ROOT / "hive" / "agents" / "tester.md"

TESTED_OBJECTS = ("pass", "fail", "inconclusive")


def _load_shutdown_emits(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, knob: str = "phase"):
    config_path = tmp_path / "hive.config.yaml"
    config_path.write_text(f"emit_lifecycle_at: {knob}\n", encoding="utf-8")
    monkeypatch.setenv("HIVE_CONFIG", str(config_path))
    sys.modules.pop("hive.lib.config", None)
    sys.modules.pop("hive.lib.kg_emit", None)
    sys.modules.pop("hive.lib.agent_shutdown_emits", None)
    return importlib.import_module("hive.lib.agent_shutdown_emits")


def _kg(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    db_path = tmp_path / "kg.sqlite"
    bootstrap_kg(db_path)
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(db_path))
    return db_path


def _tested_rows(db_path: Path) -> list[tuple[str, str, str, str]]:
    with sqlite3.connect(str(db_path)) as conn:
        return conn.execute(
            "SELECT subject, object, source_agent, source_epic"
            " FROM triples WHERE predicate = 'tested'"
        ).fetchall()


@pytest.mark.parametrize("verdict", TESTED_OBJECTS)
def test_completed_test_run_emits_exactly_one_tested_triple(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, verdict: str
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    db_path = _kg(monkeypatch, tmp_path)

    result = emits.emit_role_triple_at_shutdown(
        subject="story:s7-tester-emit",
        source_agent="tester",
        verdict=verdict,
        source_epic="kg-repair-activation",
    )
    assert result["emitted"] is True

    rows = _tested_rows(db_path)
    assert rows == [
        ("story:s7-tester-emit", verdict, "tester", "kg-repair-activation")
    ]


def test_pass_object_is_case_stable(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    db_path = _kg(monkeypatch, tmp_path)

    for raw in ("Pass", "PASS", " pass "):
        result = emits.emit_role_triple_at_shutdown(
            subject="story:s7-tester-emit",
            source_agent="tester",
            verdict=raw,
            source_epic="kg-repair-activation",
        )
        assert result["emitted"] is True

    rows = _tested_rows(db_path)
    assert len(rows) == 1
    assert rows[0][1] == "pass"


def test_shutdown_without_completed_test_run_is_silent(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    db_path = _kg(monkeypatch, tmp_path)

    for empty in (None, "", "   "):
        result = emits.emit_role_triple_at_shutdown(
            subject="story:s7-tester-emit",
            source_agent="tester",
            verdict=empty,
            source_epic="kg-repair-activation",
        )
        assert result["emitted"] is False

    assert _tested_rows(db_path) == []


def test_object_outside_vocabulary_is_not_emitted(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    db_path = _kg(monkeypatch, tmp_path)

    for bad in ("green", "passed", "ok"):
        result = emits.emit_role_triple_at_shutdown(
            subject="story:s7-tester-emit",
            source_agent="tester",
            verdict=bad,
            source_epic="kg-repair-activation",
        )
        assert result["emitted"] is False

    assert _tested_rows(db_path) == []


def test_replayed_shutdown_does_not_double_count(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    db_path = _kg(monkeypatch, tmp_path)

    for _ in range(3):
        emits.emit_role_triple_at_shutdown(
            subject="story:s7-tester-emit",
            source_agent="tester",
            verdict="pass",
            source_epic="kg-repair-activation",
        )

    assert len(_tested_rows(db_path)) == 1


def test_default_predicate_for_tester_is_tested(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    assert emits.ROLE_PREDICATE_BY_AGENT["tester"] == "tested"


def test_audit_count_is_positive_after_emit(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    db_path = _kg(monkeypatch, tmp_path)

    emits.emit_role_triple_at_shutdown(
        subject="story:s7-tester-emit",
        source_agent="tester",
        verdict="pass",
        source_epic="kg-repair-activation",
    )

    with sqlite3.connect(str(db_path)) as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM triples WHERE predicate = 'tested'"
        ).fetchone()[0]
    assert count > 0


def test_knob_off_is_silent(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path, knob="off")
    db_path = _kg(monkeypatch, tmp_path)

    result = emits.emit_role_triple_at_shutdown(
        subject="story:s7-tester-emit",
        source_agent="tester",
        verdict="pass",
        source_epic="kg-repair-activation",
    )
    assert result["emitted"] is False
    assert _tested_rows(db_path) == []


def test_tester_doc_declares_shutdown_emit_contract() -> None:
    text = TESTER_DOC.read_text(encoding="utf-8")
    assert "hive.lib.kg_emit_cli" in text, "tester.md must reference kg_emit_cli"
    assert '--predicate "tested"' in text
    assert '--source-agent "tester"' in text
    for obj in TESTED_OBJECTS:
        assert f"`{obj}`" in text, f"tester.md must pin object vocabulary {obj}"
    assert "Silent when no story tests completed" in text, (
        "tester.md must declare the no-tests silent clause"
    )
    assert "exactly ONE" in text, "tester.md must declare exactly-one semantics"
