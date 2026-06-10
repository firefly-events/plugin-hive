"""Reviewer shutdown emit of the ``validated`` role triple (s6-reviewer-emit).

Pins the s6 contract:

1. A completed story review emits exactly one ``validated`` triple at
   shutdown with object equal to the verdict (approve | approve-with-changes
   | reject), source_agent=reviewer, source_epic=<epic-id>.
2. The object is case-stable: ``"Approve"`` lands as ``"approve"``.
3. Shutdown without a completed review emits nothing (silent).
4. Replayed shutdowns cannot double-count (unique-index absorption).
5. The rubric 3-value change_verdict projects onto the KG vocabulary via
   the canonical map.
6. ``hive/agents/reviewer.md`` declares the shutdown-emit contract.

Run from the repo root with:

    python3 -m pytest tests/test_reviewer_kg_emit.py
"""

from __future__ import annotations

import importlib
import sqlite3
import sys
from pathlib import Path

import pytest

from hive.lib.kg_bootstrap import bootstrap_kg

REPO_ROOT = Path(__file__).resolve().parents[1]
REVIEWER_DOC = REPO_ROOT / "hive" / "agents" / "reviewer.md"

VALIDATED_OBJECTS = ("approve", "approve-with-changes", "reject")


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


def _validated_rows(db_path: Path) -> list[tuple[str, str, str, str]]:
    with sqlite3.connect(str(db_path)) as conn:
        return conn.execute(
            "SELECT subject, object, source_agent, source_epic"
            " FROM triples WHERE predicate = 'validated'"
        ).fetchall()


@pytest.mark.parametrize("verdict", VALIDATED_OBJECTS)
def test_completed_review_emits_exactly_one_validated_triple(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, verdict: str
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    db_path = _kg(monkeypatch, tmp_path)

    result = emits.emit_role_triple_at_shutdown(
        subject="story:s6-reviewer-emit",
        source_agent="reviewer",
        verdict=verdict,
        source_epic="kg-repair-activation",
    )
    assert result["emitted"] is True

    rows = _validated_rows(db_path)
    assert rows == [
        ("story:s6-reviewer-emit", verdict, "reviewer", "kg-repair-activation")
    ]


def test_approve_object_is_case_stable(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    db_path = _kg(monkeypatch, tmp_path)

    for raw in ("Approve", "APPROVE", " approve "):
        result = emits.emit_role_triple_at_shutdown(
            subject="story:s6-reviewer-emit",
            source_agent="reviewer",
            verdict=raw,
            source_epic="kg-repair-activation",
        )
        assert result["emitted"] is True

    rows = _validated_rows(db_path)
    assert len(rows) == 1
    assert rows[0][1] == "approve"


def test_shutdown_without_completed_review_is_silent(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    db_path = _kg(monkeypatch, tmp_path)

    for empty in (None, "", "   "):
        result = emits.emit_role_triple_at_shutdown(
            subject="story:s6-reviewer-emit",
            source_agent="reviewer",
            verdict=empty,
            source_epic="kg-repair-activation",
        )
        assert result["emitted"] is False

    assert _validated_rows(db_path) == []


def test_object_outside_vocabulary_is_not_emitted(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    db_path = _kg(monkeypatch, tmp_path)

    result = emits.emit_role_triple_at_shutdown(
        subject="story:s6-reviewer-emit",
        source_agent="reviewer",
        verdict="lgtm",
        source_epic="kg-repair-activation",
    )
    assert result["emitted"] is False
    assert _validated_rows(db_path) == []


def test_replayed_shutdown_does_not_double_count(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    db_path = _kg(monkeypatch, tmp_path)

    for _ in range(3):
        emits.emit_role_triple_at_shutdown(
            subject="story:s6-reviewer-emit",
            source_agent="reviewer",
            verdict="approve",
            source_epic="kg-repair-activation",
        )

    assert len(_validated_rows(db_path)) == 1


@pytest.mark.parametrize(
    ("change_verdict", "expected_object"),
    [
        ("passed", "approve"),
        ("needs_optimization", "approve-with-changes"),
        ("needs_revision", "reject"),
    ],
)
def test_change_verdict_projects_onto_kg_vocabulary(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    change_verdict: str,
    expected_object: str,
) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path)
    db_path = _kg(monkeypatch, tmp_path)

    result = emits.emit_role_triple_at_shutdown(
        subject="story:s6-reviewer-emit",
        source_agent="reviewer",
        verdict=change_verdict,
        source_epic="kg-repair-activation",
    )
    assert result["emitted"] is True
    assert _validated_rows(db_path)[0][1] == expected_object


def test_knob_off_is_silent(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    emits = _load_shutdown_emits(monkeypatch, tmp_path, knob="off")
    db_path = _kg(monkeypatch, tmp_path)

    result = emits.emit_role_triple_at_shutdown(
        subject="story:s6-reviewer-emit",
        source_agent="reviewer",
        verdict="approve",
        source_epic="kg-repair-activation",
    )
    assert result["emitted"] is False
    assert _validated_rows(db_path) == []


def test_reviewer_doc_declares_shutdown_emit_contract() -> None:
    text = REVIEWER_DOC.read_text(encoding="utf-8")
    assert "hive.lib.kg_emit_cli" in text, "reviewer.md must reference kg_emit_cli"
    assert '--predicate "validated"' in text
    assert '--source-agent "reviewer"' in text
    for obj in VALIDATED_OBJECTS:
        assert f"`{obj}`" in text, f"reviewer.md must pin object vocabulary {obj}"
    assert "Silent when no review completed" in text, (
        "reviewer.md must declare the no-review silent clause"
    )
    assert "exactly ONE" in text, "reviewer.md must declare exactly-one semantics"
