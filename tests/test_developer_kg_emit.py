"""Developer shutdown emit of the ``implemented`` role triple (s8-developer-emit).

Pins the s8 contract:

1. A completed story implementation emits exactly one ``implemented`` triple
   at shutdown with object equal to the short commit SHA of the pushed
   commit, or the literal ``wip`` when no commit was pushed,
   source_agent=developer, source_epic=<epic-id>.
2. The object is case-stable and shape-pinned: ``"WIP"`` lands as ``"wip"``,
   uppercase SHAs land lowercase, and anything that is neither ``wip`` nor a
   7-40 char hex SHA is rejected without a write.
3. Shutdown without a completed implementation emits nothing (silent).
4. Replayed shutdowns cannot double-count (unique-index absorption).
5. A 30-day post-merge audit ``SELECT COUNT(*) WHERE predicate='implemented'``
   returns a positive count after the emit.
6. ``hive/agents/developer.md`` declares the shutdown-emit contract.

Run from the repo root with:

    python3 -m pytest tests/test_developer_kg_emit.py
"""

from __future__ import annotations

import importlib
import sqlite3
import sys
from pathlib import Path

import pytest

from hive.lib.kg_bootstrap import bootstrap_kg

REPO_ROOT = Path(__file__).resolve().parents[1]
DEVELOPER_DOC = REPO_ROOT / "hive" / "agents" / "developer.md"

SHORT_SHA = "d933a5b"
FULL_SHA = "d933a5baf358664e3390558ce03a6f82e1497048"


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


def _implemented_rows(db_path: Path) -> list[tuple[str, str, str, str]]:
    with sqlite3.connect(str(db_path)) as conn:
        return conn.execute(
            "SELECT subject, object, source_agent, source_epic"
            " FROM triples WHERE predicate = 'implemented'"
        ).fetchall()


@pytest.mark.parametrize("verdict", [SHORT_SHA, FULL_SHA, "wip"])
def test_completed_implementation_emits_exactly_one_implemented_triple(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, verdict: str
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    db_path = _kg(monkeypatch, tmp_path)

    result = emits.emit_role_triple_at_shutdown(
        subject="story:s8-developer-emit",
        source_agent="developer",
        verdict=verdict,
        source_epic="kg-repair-activation",
    )
    assert result["emitted"] is True

    rows = _implemented_rows(db_path)
    assert rows == [
        ("story:s8-developer-emit", verdict, "developer", "kg-repair-activation")
    ]


def test_pushed_commit_object_is_the_short_sha(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    db_path = _kg(monkeypatch, tmp_path)

    result = emits.emit_role_triple_at_shutdown(
        subject="story:s8-developer-emit",
        source_agent="developer",
        verdict=SHORT_SHA,
        source_epic="kg-repair-activation",
    )
    assert result["emitted"] is True

    rows = _implemented_rows(db_path)
    assert len(rows) == 1
    assert rows[0][1] == SHORT_SHA


def test_object_is_case_stable(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    db_path = _kg(monkeypatch, tmp_path)

    for raw in ("WIP", "Wip", " wip "):
        result = emits.emit_role_triple_at_shutdown(
            subject="story:s8-developer-emit",
            source_agent="developer",
            verdict=raw,
            source_epic="kg-repair-activation",
        )
        assert result["emitted"] is True

    rows = _implemented_rows(db_path)
    assert len(rows) == 1
    assert rows[0][1] == "wip"


def test_uppercase_sha_lands_lowercase(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    db_path = _kg(monkeypatch, tmp_path)

    result = emits.emit_role_triple_at_shutdown(
        subject="story:s8-developer-emit",
        source_agent="developer",
        verdict=SHORT_SHA.upper(),
        source_epic="kg-repair-activation",
    )
    assert result["emitted"] is True

    rows = _implemented_rows(db_path)
    assert rows[0][1] == SHORT_SHA


def test_shutdown_without_completed_implementation_is_silent(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    db_path = _kg(monkeypatch, tmp_path)

    for empty in (None, "", "   "):
        result = emits.emit_role_triple_at_shutdown(
            subject="story:s8-developer-emit",
            source_agent="developer",
            verdict=empty,
            source_epic="kg-repair-activation",
        )
        assert result["emitted"] is False

    assert _implemented_rows(db_path) == []


def test_object_outside_shape_is_not_emitted(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    db_path = _kg(monkeypatch, tmp_path)

    for bad in ("done", "feat/kg-repair-activation", "zzz9999", "abc12", "g933a5b"):
        result = emits.emit_role_triple_at_shutdown(
            subject="story:s8-developer-emit",
            source_agent="developer",
            verdict=bad,
            source_epic="kg-repair-activation",
        )
        assert result["emitted"] is False, f"{bad!r} must be rejected"

    assert _implemented_rows(db_path) == []


def test_replayed_shutdown_does_not_double_count(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    db_path = _kg(monkeypatch, tmp_path)

    for _ in range(3):
        emits.emit_role_triple_at_shutdown(
            subject="story:s8-developer-emit",
            source_agent="developer",
            verdict=SHORT_SHA,
            source_epic="kg-repair-activation",
        )

    assert len(_implemented_rows(db_path)) == 1


def test_default_predicate_for_developer_is_implemented(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    assert emits.ROLE_PREDICATE_BY_AGENT["developer"] == "implemented"


def test_audit_count_is_positive_after_emit(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    db_path = _kg(monkeypatch, tmp_path)

    emits.emit_role_triple_at_shutdown(
        subject="story:s8-developer-emit",
        source_agent="developer",
        verdict=SHORT_SHA,
        source_epic="kg-repair-activation",
    )

    with sqlite3.connect(str(db_path)) as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM triples WHERE predicate = 'implemented'"
        ).fetchone()[0]
    assert count > 0


def test_knob_off_is_silent(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path, knob="off")
    db_path = _kg(monkeypatch, tmp_path)

    result = emits.emit_role_triple_at_shutdown(
        subject="story:s8-developer-emit",
        source_agent="developer",
        verdict=SHORT_SHA,
        source_epic="kg-repair-activation",
    )
    assert result["emitted"] is False
    assert _implemented_rows(db_path) == []


def test_developer_doc_declares_shutdown_emit_contract() -> None:
    text = DEVELOPER_DOC.read_text(encoding="utf-8")
    assert "hive.lib.kg_emit_cli" in text, "developer.md must reference kg_emit_cli"
    assert '--predicate "implemented"' in text
    assert '--source-agent "developer"' in text
    assert "`wip`" in text, "developer.md must pin the wip fallback object"
    assert "short commit SHA" in text, "developer.md must pin the commit-SHA object"
    assert "Silent when no story implementation completed" in text, (
        "developer.md must declare the no-implementation silent clause"
    )
    assert "exactly ONE" in text, "developer.md must declare exactly-one semantics"
