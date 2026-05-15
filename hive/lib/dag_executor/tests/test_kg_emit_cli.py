"""Tests for hive.lib.kg_emit_cli — argparse + sanitize routing.

CLI is invoked from skill-prompt seams (tpm.md escalation-raise, plan.md
waiting-on-user gates) for S2.1 phase_blocked emission. Mirrors emit_kg_event
no-op semantics under knob==off / sqlite missing.
"""

from __future__ import annotations

import json
import sqlite3
import tempfile
from pathlib import Path
from unittest import mock

import pytest

from hive.lib import kg_emit_cli


def _make_kg_sqlite(path: Path) -> None:
    conn = sqlite3.connect(str(path))
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS triples (
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
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_triple ON triples(subject, predicate, object, source_epic)"
    )
    conn.commit()
    conn.close()


def _argv(**overrides: str) -> list[str]:
    base = {
        "--subject": "story-x",
        "--predicate": "phase_blocked",
        "--object": "raw obj VALUE",
        "--source-epic": "test-epic",
        "--source-agent": "tester",
    }
    base.update({f"--{k.replace('_', '-')}": v for k, v in overrides.items()})
    argv: list[str] = []
    for k, v in base.items():
        argv.extend([k, v])
    return argv


@pytest.fixture
def kg_sqlite(monkeypatch, tmp_path):
    db = tmp_path / "kg.sqlite"
    _make_kg_sqlite(db)
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(db))
    monkeypatch.setattr(kg_emit_cli, "emit_kg_event", _wrap_emit())
    yield db


def _wrap_emit():
    from hive.lib import kg_emit

    kg_emit.reset_kg_writes_counter_for_test()
    return kg_emit.emit_kg_event


def test_cli_emits_sanitized_object_by_default(kg_sqlite, capsys, monkeypatch):
    monkeypatch.setattr("hive.lib.kg_emit.EMIT_LIFECYCLE_AT", "phase")
    rc = kg_emit_cli.main(_argv() + ["--json"])
    assert rc == 0
    captured = capsys.readouterr().out.strip()
    payload = json.loads(captured)
    assert payload["emitted"] is True
    assert payload["metadata"]["object"] == "raw-obj-value"
    assert payload["metadata"]["predicate"] == "phase_blocked"


def test_cli_no_sanitize_passes_through(kg_sqlite, capsys, monkeypatch):
    monkeypatch.setattr("hive.lib.kg_emit.EMIT_LIFECYCLE_AT", "phase")
    rc = kg_emit_cli.main(_argv(object="already-clean-slug") + ["--no-sanitize", "--json"])
    assert rc == 0
    payload = json.loads(capsys.readouterr().out.strip())
    assert payload["metadata"]["object"] == "already-clean-slug"


def test_cli_off_knob_no_op(kg_sqlite, capsys, monkeypatch):
    monkeypatch.setattr("hive.lib.kg_emit.EMIT_LIFECYCLE_AT", "off")
    rc = kg_emit_cli.main(_argv() + ["--json"])
    assert rc == 0
    payload = json.loads(capsys.readouterr().out.strip())
    assert payload["emitted"] is False
    assert payload["metadata"] is None


def test_cli_sqlite_missing_no_op(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr("hive.lib.kg_emit.EMIT_LIFECYCLE_AT", "phase")
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(tmp_path / "does-not-exist.sqlite"))
    rc = kg_emit_cli.main(_argv() + ["--json"])
    assert rc == 0
    payload = json.loads(capsys.readouterr().out.strip())
    assert payload["emitted"] is False


def test_cli_missing_required_flag_exits_nonzero(capsys):
    with pytest.raises(SystemExit) as excinfo:
        kg_emit_cli.main(["--subject", "x"])
    assert excinfo.value.code != 0


def test_cli_supersede_mode_simulates_plan_story_overwrite(kg_sqlite, capsys, monkeypatch):
    monkeypatch.setattr("hive.lib.kg_emit.EMIT_LIFECYCLE_AT", "phase")
    with sqlite3.connect(str(kg_sqlite)) as conn:
        conn.execute(
            """
            INSERT INTO triples
              (subject, predicate, object, valid_from, source_epic, source_agent)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("story-x", "story-spec", "old-hash", "2026-05-01T00:00:00Z", "test-epic", "plan"),
        )
        conn.commit()

    rc = kg_emit_cli.main(
        _argv(predicate="story-spec", object="new hash")
        + ["--mode", "supersede", "--prior-object", "old hash", "--json"]
    )

    assert rc == 0
    payload = json.loads(capsys.readouterr().out.strip())
    assert payload["emitted"] is True
    assert payload["metadata"]["object"] == "old-hash->new-hash"
    with sqlite3.connect(str(kg_sqlite)) as conn:
        prior_valid_until = conn.execute(
            "SELECT valid_until FROM triples WHERE subject = ? AND predicate = ? AND object = ?",
            ("story-x", "story-spec", "old-hash"),
        ).fetchone()[0]
    assert prior_valid_until is not None


def test_cli_supersede_no_sanitize_passes_clean_slugs(kg_sqlite, capsys, monkeypatch):
    monkeypatch.setattr("hive.lib.kg_emit.EMIT_LIFECYCLE_AT", "phase")
    rc = kg_emit_cli.main(
        _argv(predicate="story-spec", object="new-clean")
        + ["--mode", "supersede", "--prior-object", "old-clean", "--no-sanitize", "--json"]
    )

    assert rc == 0
    payload = json.loads(capsys.readouterr().out.strip())
    assert payload["metadata"]["object"] == "old-clean->new-clean"


def test_cli_supersede_missing_prior_object_exits_nonzero(capsys):
    with pytest.raises(SystemExit) as excinfo:
        kg_emit_cli.main(_argv() + ["--mode", "supersede"])
    assert excinfo.value.code != 0
