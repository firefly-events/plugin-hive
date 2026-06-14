"""Archival sweep: terminal-only guard, age threshold, dry-run, idempotency.

Run from repo root: python3 -m pytest hive/lib/dag_executor/run_state/tests/test_archive.py
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml

from hive.lib.dag_executor.run_state import (
    DEFAULT_THRESHOLD,
    TERMINAL_STATUSES,
    archive_terminal_runs,
)
from hive.lib.dag_executor.run_state.archive import main

NOW = datetime(2026, 6, 10, 12, 0, 0, tzinfo=timezone.utc)
OLD = (NOW - timedelta(days=30)).isoformat()
FRESH = (NOW - timedelta(days=1)).isoformat()


@pytest.fixture
def state_dir(tmp_path: Path) -> Path:
    (tmp_path / "state" / "runs").mkdir(parents=True)
    return tmp_path / "state"


@pytest.fixture
def archive_dest(tmp_path: Path) -> Path:
    return tmp_path / "archive"


def _make_run(state_dir: Path, run_id: str, status: str, last_updated_at: str) -> Path:
    run_dir = state_dir / "runs" / run_id
    run_dir.mkdir(parents=True)
    payload = {
        "run_id": run_id,
        "workflow_slug": "code-review",
        "started_at": last_updated_at,
        "last_updated_at": last_updated_at,
        "status": status,
        "schema_version": 0,
    }
    with (run_dir / "run_state.yaml").open("w", encoding="utf-8") as handle:
        yaml.safe_dump(payload, handle)
    return run_dir


def _sweep(state_dir: Path, archive_dest: Path, **kwargs):
    return archive_terminal_runs(
        state_dir, archive_dest=archive_dest, now=NOW, **kwargs
    )


def test_aged_terminal_runs_are_moved(state_dir: Path, archive_dest: Path):
    for status in sorted(TERMINAL_STATUSES):
        _make_run(state_dir, f"run-{status}", status, OLD)

    report = _sweep(state_dir, archive_dest)

    assert sorted(report.archived) == ["run-cancelled", "run-completed", "run-failed"]
    for status in TERMINAL_STATUSES:
        assert not (state_dir / "runs" / f"run-{status}").exists()
        assert (archive_dest / f"run-{status}" / "run_state.yaml").is_file()


def test_active_and_suspended_never_archived_regardless_of_age(
    state_dir: Path, archive_dest: Path
):
    _make_run(state_dir, "run-running", "running", OLD)
    _make_run(state_dir, "run-suspended", "suspended", OLD)
    _make_run(state_dir, "run-unknown", "mystery", OLD)

    report = _sweep(state_dir, archive_dest)

    assert report.archived == []
    for run_id in ("run-running", "run-suspended", "run-unknown"):
        assert (state_dir / "runs" / run_id / "run_state.yaml").is_file()
    assert not archive_dest.exists()


def test_terminal_run_newer_than_threshold_not_archived(
    state_dir: Path, archive_dest: Path
):
    _make_run(state_dir, "run-fresh", "completed", FRESH)
    _make_run(state_dir, "run-old", "completed", OLD)

    report = _sweep(state_dir, archive_dest)

    assert report.archived == ["run-old"]
    assert (state_dir / "runs" / "run-fresh").is_dir()
    assert not (state_dir / "runs" / "run-old").exists()


def test_threshold_is_configurable(state_dir: Path, archive_dest: Path):
    _make_run(state_dir, "run-fresh", "completed", FRESH)

    report = _sweep(state_dir, archive_dest, threshold=timedelta(hours=1))

    assert report.archived == ["run-fresh"]


def test_dry_run_reports_without_moving(state_dir: Path, archive_dest: Path):
    _make_run(state_dir, "run-old", "failed", OLD)

    report = _sweep(state_dir, archive_dest, dry_run=True)

    assert report.archived == ["run-old"]
    assert report.dry_run is True
    assert (state_dir / "runs" / "run-old" / "run_state.yaml").is_file()
    assert not archive_dest.exists()


def test_second_sweep_is_idempotent(state_dir: Path, archive_dest: Path):
    _make_run(state_dir, "run-old", "completed", OLD)

    first = _sweep(state_dir, archive_dest)
    second = _sweep(state_dir, archive_dest)

    assert first.archived == ["run-old"]
    assert second.archived == []
    assert (archive_dest / "run-old" / "run_state.yaml").is_file()


def test_dest_collision_skipped_not_duplicated(state_dir: Path, archive_dest: Path):
    _make_run(state_dir, "run-old", "completed", OLD)
    (archive_dest / "run-old").mkdir(parents=True)

    report = _sweep(state_dir, archive_dest)

    assert report.archived == []
    assert ("run-old", "already present in archive dest") in report.skipped
    assert (state_dir / "runs" / "run-old" / "run_state.yaml").is_file()


def test_run_without_state_yaml_left_alone(state_dir: Path, archive_dest: Path):
    (state_dir / "runs" / "run-bare").mkdir()

    report = _sweep(state_dir, archive_dest)

    assert report.archived == []
    assert (state_dir / "runs" / "run-bare").is_dir()


def test_missing_runs_root_is_a_noop(tmp_path: Path, archive_dest: Path):
    report = archive_terminal_runs(
        tmp_path / "nowhere", archive_dest=archive_dest, now=NOW
    )
    assert report.archived == []
    assert report.skipped == []


def test_default_state_dir_resolves_via_sdr1_resolver(
    tmp_path: Path, archive_dest: Path, monkeypatch: pytest.MonkeyPatch
):
    """Unset config → default `.pHive/runs` under cwd; env override honored."""

    project = tmp_path / "project"
    (project / ".pHive" / "runs").mkdir(parents=True)
    _make_run(project / ".pHive", "run-old", "completed", OLD)
    monkeypatch.chdir(project)
    monkeypatch.delenv("HIVE_STATE_DIR", raising=False)

    report = archive_terminal_runs(archive_dest=archive_dest, now=NOW)

    assert report.archived == ["run-old"]
    assert not (project / ".pHive" / "runs" / "run-old").exists()

    relocated = tmp_path / "relocated"
    (relocated / "runs").mkdir(parents=True)
    _make_run(relocated, "run-env", "completed", OLD)
    monkeypatch.setenv("HIVE_STATE_DIR", str(relocated))

    report = archive_terminal_runs(archive_dest=archive_dest, now=NOW)

    assert report.archived == ["run-env"]


def test_cli_dry_run_prints_moves_without_touching_fs(
    state_dir: Path, archive_dest: Path, capsys: pytest.CaptureFixture
):
    _make_run(state_dir, "run-old", "completed", OLD)
    # CLI uses wall-clock now; OLD is 2026-06-10-relative, so widen via mtime
    # independence: last_updated_at is authoritative and far in the past only
    # relative to NOW — use a large threshold-bypassing age instead.
    ancient = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()
    _make_run(state_dir, "run-ancient", "completed", ancient)

    rc = main(
        [
            "--state-dir",
            str(state_dir),
            "--archive-dest",
            str(archive_dest),
            "--dry-run",
        ]
    )

    out = capsys.readouterr().out
    assert rc == 0
    assert "would archive" in out
    assert "run-ancient" in out
    assert (state_dir / "runs" / "run-ancient").is_dir()
    assert not archive_dest.exists()


def test_weekly_autopilot_trigger_declared():
    """Repo scheduler convention: .pHive/multica/autopilots.yaml entry."""

    repo_root = Path(__file__).resolve().parents[5]
    autopilots_path = repo_root / ".pHive" / "multica" / "autopilots.yaml"
    assert autopilots_path.is_file(), "weekly archival autopilot declaration missing"

    with autopilots_path.open("r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle)

    entries = [
        a for a in payload["autopilots"] if a["name"] == "run-state-archival-weekly"
    ]
    assert len(entries) == 1
    triggers = entries[0]["triggers"]
    schedule = [t for t in triggers if t.get("kind") == "schedule"]
    assert schedule, "archival autopilot must have a schedule trigger"
    cron = schedule[0]["cron"]
    assert re.fullmatch(r"\S+ \S+ \S+ \S+ \S+", cron), "cron must be 5-field"
    # weekly: day-of-week field pinned (not '*')
    assert cron.split()[4] != "*", "cron must pin a day-of-week (weekly cadence)"
