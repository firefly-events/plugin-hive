"""Suspend-aware archival sweep for aged terminal run-state (sdr-8).

Moves run directories whose run_state.yaml status is terminal
(``completed | failed | cancelled``) AND whose age exceeds the threshold
from ``<state_dir>/runs/<run-id>`` to an archive destination (``$TMPDIR``
based by default, so OS purge reclaims them). Active and suspended runs
are NEVER archived regardless of age — suspend/resume durability is the
hard guard, not a heuristic.

Status is read from the raw YAML rather than ``store.load()`` because the
terminal set includes ``cancelled``, which is not a ``RunStatus`` member;
the sweep must also tolerate runs written by other schema versions
without refusing to leave them alone.

Manual CLI:
    python3 -m hive.lib.dag_executor.run_state.archive [--dry-run] \
        [--state-dir PATH] [--threshold-days N] [--archive-dest PATH]

Weekly automation: see the ``run-state-archival-weekly`` autopilot in
``.pHive/multica/autopilots.yaml`` (repo scheduler convention per
``hive/references/multica-autopilots-schema.md``).
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml

from .store import default_runs_root

#: Statuses eligible for archival. Anything else — including ``running``,
#: ``suspended``, unknown strings, or a missing status — is never moved.
TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled"})

#: Default age threshold (vertical-plan open knob, settled here).
DEFAULT_THRESHOLD = timedelta(days=7)


def default_archive_dest() -> Path:
    """Temp-rooted destination so the OS purge self-bounds the footprint."""

    return Path(tempfile.gettempdir()) / "hive-run-archive"


@dataclass
class ArchiveReport:
    """Outcome of one sweep invocation."""

    dry_run: bool
    archived: list[str] = field(default_factory=list)
    skipped: list[tuple[str, str]] = field(default_factory=list)

    def summary(self) -> str:
        verb = "would archive" if self.dry_run else "archived"
        lines = [f"{verb} {len(self.archived)} run(s)"]
        lines.extend(f"  {verb}: {run_id}" for run_id in self.archived)
        lines.extend(f"  skipped: {run_id} ({reason})" for run_id, reason in self.skipped)
        return "\n".join(lines)


def _run_age_reference(run_dir: Path, payload: dict) -> datetime | None:
    """Timestamp the age check is measured against.

    Prefers ``last_updated_at`` from run_state.yaml; falls back to the
    file's mtime when the field is missing or unparseable.
    """

    raw = payload.get("last_updated_at")
    if isinstance(raw, str):
        try:
            stamp = datetime.fromisoformat(raw)
        except ValueError:
            stamp = None
        if stamp is not None:
            if stamp.tzinfo is None:
                stamp = stamp.replace(tzinfo=timezone.utc)
            return stamp
    state_path = run_dir / "run_state.yaml"
    try:
        return datetime.fromtimestamp(state_path.stat().st_mtime, tz=timezone.utc)
    except OSError:
        return None


def archive_terminal_runs(
    state_dir: Path | str | None = None,
    *,
    threshold: timedelta = DEFAULT_THRESHOLD,
    archive_dest: Path | str | None = None,
    dry_run: bool = False,
    now: datetime | None = None,
) -> ArchiveReport:
    """Move aged terminal runs out of ``<state_dir>/runs``.

    ``state_dir=None`` resolves via the sdr-1 resolver (``HIVE_STATE_DIR``
    env > ``hive.config.yaml`` ``paths.state_dir`` > ``.pHive``), so unset
    configuration keeps the default ``.pHive/runs`` behavior. Idempotent:
    archived runs are gone from the runs root, so a second sweep is a
    no-op; a destination collision is skipped, never duplicated.
    """

    if threshold.total_seconds() <= 0:
        raise ValueError("threshold must be > 0")

    runs_root = (
        default_runs_root() if state_dir is None else Path(state_dir) / "runs"
    )
    dest_root = (
        default_archive_dest() if archive_dest is None else Path(archive_dest)
    )
    moment = now if now is not None else datetime.now(timezone.utc)
    report = ArchiveReport(dry_run=dry_run)

    if not runs_root.is_dir():
        return report

    for run_dir in sorted(runs_root.iterdir()):
        if not run_dir.is_dir():
            continue
        run_id = run_dir.name
        state_path = run_dir / "run_state.yaml"
        if not state_path.is_file():
            report.skipped.append((run_id, "no run_state.yaml"))
            continue
        try:
            with state_path.open("r", encoding="utf-8") as handle:
                payload = yaml.safe_load(handle) or {}
        except (yaml.YAMLError, OSError):
            report.skipped.append((run_id, "unreadable run_state.yaml"))
            continue
        if not isinstance(payload, dict):
            report.skipped.append((run_id, "malformed run_state.yaml"))
            continue

        status = payload.get("status")
        if status not in TERMINAL_STATUSES:
            report.skipped.append((run_id, f"non-terminal status {status!r}"))
            continue

        reference = _run_age_reference(run_dir, payload)
        if reference is None or (moment - reference) < threshold:
            report.skipped.append((run_id, "newer than threshold"))
            continue

        target = dest_root / run_id
        if target.exists():
            report.skipped.append((run_id, "already present in archive dest"))
            continue

        if not dry_run:
            dest_root.mkdir(parents=True, exist_ok=True)
            shutil.move(str(run_dir), str(target))
        report.archived.append(run_id)

    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python3 -m hive.lib.dag_executor.run_state.archive",
        description=(
            "Archive aged terminal DAG runs (completed/failed/cancelled) from "
            "<state_dir>/runs to a temp archive. Active and suspended runs are "
            "never touched."
        ),
    )
    parser.add_argument(
        "--state-dir",
        default=None,
        help="State dir holding runs/ (default: sdr-1 resolver, i.e. .pHive)",
    )
    parser.add_argument(
        "--threshold-days",
        type=float,
        default=DEFAULT_THRESHOLD.days,
        help=f"Minimum age in days before a terminal run is archived (default: {DEFAULT_THRESHOLD.days})",
    )
    parser.add_argument(
        "--archive-dest",
        default=None,
        help="Archive destination directory (default: $TMPDIR/hive-run-archive)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report intended moves without modifying the filesystem",
    )
    args = parser.parse_args(argv)
    if args.threshold_days <= 0:
        parser.error("--threshold-days must be > 0")

    report = archive_terminal_runs(
        args.state_dir,
        threshold=timedelta(days=args.threshold_days),
        archive_dest=args.archive_dest,
        dry_run=args.dry_run,
    )
    print(report.summary())
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
