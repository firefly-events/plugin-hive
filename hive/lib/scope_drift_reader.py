"""Read-side trend surfacer for ``scope_drift_score`` events.

Companion to ``hive/lib/scope_drift.py`` (story
``ed-3-drift-metric-emit``, which owns the emit side). This module is
read-only — it never appends, mutates, or removes event rows.

Story: ``ed-4-drift-status-surface``. The ``/hive:status`` skill calls
``format_drift_trend()`` (or ``recent_drift_trend()`` for structured
output) to render a "Drift trend (last 5 runs)" section. When zero
runs carry ``scope_drift_score`` events the formatter returns an empty
string so the section is omitted from status output (acceptance
criterion 2: silent-on-absence).

Malformed JSONL rows are skipped with a one-line warning via
``logging.getLogger("hive.lib.scope_drift_reader")`` (acceptance
criterion 3: no crash).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Iterable

from .metrics.paths import get_metrics_root
from .scope_drift import BUCKETS

_log = logging.getLogger(__name__)

DEFAULT_RUN_LIMIT = 5


def recent_drift_trend(limit: int = DEFAULT_RUN_LIMIT) -> list[dict[str, Any]]:
    """Return up to ``limit`` recent runs with ``scope_drift_score`` counts.

    Scans ``.pHive/metrics/events/*.jsonl`` (via the
    ``METRICS_ROOT``-aware resolver), groups rows by ``run_id``, and
    keeps the ``limit`` most recently-modified run files. Files with no
    ``scope_drift_score`` rows are dropped entirely (silent-on-absence
    at the run level).

    Each row in the returned list has shape::

        {
            "run_id": str,
            "timestamp": str,          # latest event timestamp in the run
            "counts": {
                "none": int,
                "minor": int,
                "major": int,
                "divergent": int,
            },
            "total": int,
        }

    Ordering: most recent run first (by file mtime). Counts cover the
    four canonical bucket labels in ``hive.lib.scope_drift.BUCKETS``;
    any unknown bucket value is logged-and-skipped, not crashed on.
    """
    events_dir = get_metrics_root() / "events"
    if not events_dir.exists():
        return []

    jsonl_files = sorted(
        (p for p in events_dir.glob("*.jsonl") if p.is_file()),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )

    rows: list[dict[str, Any]] = []
    for path in jsonl_files:
        run_summary = _summarize_run(path)
        if run_summary is None:
            continue
        rows.append(run_summary)
        if len(rows) >= limit:
            break
    return rows


def format_drift_trend(limit: int = DEFAULT_RUN_LIMIT) -> str:
    """Render the trend rows as the status-skill section, or "".

    Returns an empty string when no run carries ``scope_drift_score``
    events — the status skill omits the section silently in that case
    (acceptance criterion 2).
    """
    rows = recent_drift_trend(limit=limit)
    if not rows:
        return ""

    lines = [f"Drift trend (last {len(rows)} run{'s' if len(rows) != 1 else ''}):"]
    for row in rows:
        counts = row["counts"]
        bucket_parts = [f"{label}={counts[label]}" for label in BUCKETS]
        lines.append(
            f"  {row['run_id']} {row['timestamp']} "
            f"[{', '.join(bucket_parts)}]"
        )
    return "\n".join(lines)


def _summarize_run(path: Path) -> dict[str, Any] | None:
    counts = {bucket: 0 for bucket in BUCKETS}
    run_id: str | None = None
    latest_timestamp: str | None = None
    total = 0

    try:
        handle = path.open("r", encoding="utf-8")
    except OSError as exc:
        _log.warning(
            "scope_drift_reader: cannot open %s — %s; skipping file",
            path,
            exc,
        )
        return None

    with handle:
        for line_no, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                event = json.loads(stripped)
            except json.JSONDecodeError as exc:
                _log.warning(
                    "scope_drift_reader: malformed JSON at %s:%d — %s; "
                    "skipping row",
                    path.name,
                    line_no,
                    exc,
                )
                continue
            if not isinstance(event, dict):
                _log.warning(
                    "scope_drift_reader: non-object row at %s:%d; "
                    "skipping row",
                    path.name,
                    line_no,
                )
                continue
            if event.get("metric_type") != "scope_drift_score":
                continue

            bucket = _extract_bucket(event)
            if bucket is None:
                _log.warning(
                    "scope_drift_reader: row at %s:%d missing/unknown "
                    "bucket; skipping row",
                    path.name,
                    line_no,
                )
                continue

            event_run_id = event.get("run_id")
            if not isinstance(event_run_id, str) or not event_run_id:
                _log.warning(
                    "scope_drift_reader: row at %s:%d missing run_id; "
                    "skipping row",
                    path.name,
                    line_no,
                )
                continue

            if run_id is None:
                run_id = event_run_id
            event_timestamp = event.get("timestamp")
            if isinstance(event_timestamp, str) and (
                latest_timestamp is None or event_timestamp > latest_timestamp
            ):
                latest_timestamp = event_timestamp

            counts[bucket] += 1
            total += 1

    if total == 0 or run_id is None:
        return None

    return {
        "run_id": run_id,
        "timestamp": latest_timestamp or "",
        "counts": counts,
        "total": total,
    }


def _extract_bucket(event: dict[str, Any]) -> str | None:
    dimensions = event.get("dimensions")
    if not isinstance(dimensions, dict):
        return None
    bucket = dimensions.get("bucket")
    if isinstance(bucket, str) and bucket in BUCKETS:
        return bucket
    return None


def _cli(argv: Iterable[str] | None = None) -> int:
    """Module entry point used by ``python -m hive.lib.scope_drift_reader``.

    Prints ``format_drift_trend()`` to stdout. Empty output means
    "no events to surface" — the status skill suppresses the section
    silently in that case.
    """
    output = format_drift_trend()
    if output:
        print(output)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(_cli())
