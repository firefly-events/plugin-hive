"""Tests for hive/scripts/act-i-exit-gate-check.sh (S2.3).

Verifies count emission, PASSED-once latch, missing-sqlite no-op, and
idempotency across re-runs.
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
from pathlib import Path

import pytest

SCRIPT = (Path(__file__).resolve().parents[3] / "scripts" / "act-i-exit-gate-check.sh")


def _make_kg(path: Path, *triples: tuple[str, str, str]) -> None:
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
    conn.executemany(
        "INSERT INTO triples (subject, predicate, object, valid_from, source_epic, source_agent) "
        "VALUES (?, ?, ?, '2026-05-15T00:00:00Z', 'test-epic', 'tester')",
        triples,
    )
    conn.commit()
    conn.close()


def _run(env_overrides: dict[str, str]) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env.update(env_overrides)
    return subprocess.run(
        ["bash", str(SCRIPT)],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_missing_sqlite_emits_count_zero_no_passed(tmp_path):
    result = _run({
        "HIVE_KG_SQLITE_PATH": str(tmp_path / "absent.sqlite"),
        "ACT_I_GATE_STAMP_PATH": str(tmp_path / "stamp"),
    })
    assert result.returncode == 0
    assert "count=0" in result.stdout
    assert "PASSED" not in result.stdout
    assert not (tmp_path / "stamp").exists()


def test_zero_triples_emits_count_zero_no_passed(tmp_path):
    db = tmp_path / "kg.sqlite"
    _make_kg(db)  # empty
    result = _run({
        "HIVE_KG_SQLITE_PATH": str(db),
        "ACT_I_GATE_STAMP_PATH": str(tmp_path / "stamp"),
    })
    assert result.returncode == 0
    assert "count=0" in result.stdout
    assert "PASSED" not in result.stdout


def test_non_zero_emits_passed_once_and_writes_stamp(tmp_path):
    db = tmp_path / "kg.sqlite"
    _make_kg(db, ("story-a", "phase_failed", "kaboom"))
    stamp = tmp_path / "stamp"
    result = _run({
        "HIVE_KG_SQLITE_PATH": str(db),
        "ACT_I_GATE_STAMP_PATH": str(stamp),
    })
    assert result.returncode == 0
    assert "count=1" in result.stdout
    assert "PASSED (closes S7 outcome metric)" in result.stdout
    assert stamp.exists()


def test_passed_is_idempotent_after_first_fire(tmp_path):
    db = tmp_path / "kg.sqlite"
    _make_kg(db, ("a", "phase_failed", "x"), ("b", "superseded", "y"))
    stamp = tmp_path / "stamp"
    env = {
        "HIVE_KG_SQLITE_PATH": str(db),
        "ACT_I_GATE_STAMP_PATH": str(stamp),
    }
    first = _run(env)
    assert "PASSED" in first.stdout
    second = _run(env)
    assert "count=2" in second.stdout
    assert "PASSED" not in second.stdout  # latched — no re-emission


def test_predicate_filter_only_counts_priority_three(tmp_path):
    db = tmp_path / "kg.sqlite"
    _make_kg(
        db,
        ("a", "phase_failed", "x"),
        ("b", "phase_blocked", "y"),
        ("c", "superseded", "z"),
        ("d", "decided", "noise"),   # not a priority predicate
        ("e", "proposal", "noise"),  # not a priority predicate
    )
    result = _run({
        "HIVE_KG_SQLITE_PATH": str(db),
        "ACT_I_GATE_STAMP_PATH": str(tmp_path / "stamp"),
    })
    assert "count=3" in result.stdout  # 'decided' + 'proposal' filtered out
