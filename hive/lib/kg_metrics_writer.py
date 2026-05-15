from __future__ import annotations

import argparse
import json
import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_KG_METRICS_DIR = Path(".pHive") / "metrics" / "kg"

_buffered_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)


def buffer_kg_write_event(
    *,
    cycle_id: str | None,
    subject: str,
    predicate: str,
    obj: str,
    source_epic: str,
    source_agent: str,
    timestamp: str | None = None,
) -> None:
    """Buffer one successful kg_write event for the current cycle."""
    resolved_cycle_id = _resolve_cycle_id(cycle_id)
    if not resolved_cycle_id:
        return
    row_timestamp = timestamp or _utc_now()
    row = {
        "timestamp": row_timestamp,
        "ts": row_timestamp,
        "cycle_id": resolved_cycle_id,
        "event": "kg_write",
        "metric_name": "kg_writes_total",
        "value": 1,
        "labels": {"predicate": predicate},
        "subject": subject,
        "predicate": predicate,
        "object": obj,
        "source_epic": source_epic,
        "source_agent": source_agent,
    }
    _buffered_rows[resolved_cycle_id].append(row)


def flush_cycle(
    *,
    cycle_id: str,
    findings: int,
    proposals: int,
    hit_rate_5cycle: float,
    miss_reason: str | None = None,
    metrics_dir: str | os.PathLike[str] = DEFAULT_KG_METRICS_DIR,
    timestamp: str | None = None,
) -> Path:
    """Flush buffered kg_write rows plus one cycle summary row.

    The write is append-only and idempotent by row identity: existing rows are
    preserved, and a repeated close for the same cycle skips rows already in
    the JSONL file instead of overwriting or duplicating them.
    """
    if not cycle_id:
        raise ValueError("cycle_id is required")
    findings_count = int(findings)
    proposals_count = int(proposals)
    resolved_miss_reason = None if findings_count > 0 else miss_reason
    summary_timestamp = timestamp or _utc_now()
    summary_row = {
        "timestamp": summary_timestamp,
        "ts": summary_timestamp,
        "cycle_id": cycle_id,
        "event": "cycle_summary",
        "metric_name": "cycle_summary",
        "value": {
            "findings": findings_count,
            "proposals": proposals_count,
            "hit_rate_5cycle": float(hit_rate_5cycle),
        },
        "labels": {},
        "findings": findings_count,
        "proposals": proposals_count,
        "hit_rate_5cycle": float(hit_rate_5cycle),
        "miss_reason": resolved_miss_reason,
    }

    output_dir = Path(metrics_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{cycle_id}.jsonl"

    rows = [*_buffered_rows.get(cycle_id, []), summary_row]
    existing_keys = _existing_row_keys(output_path)
    rows_to_append = [row for row in rows if _row_key(row) not in existing_keys]
    if rows_to_append:
        with output_path.open("a", encoding="utf-8") as fh:
            for row in rows_to_append:
                fh.write(json.dumps(row, sort_keys=True, separators=(",", ":")))
                fh.write("\n")
    _buffered_rows.pop(cycle_id, None)
    return output_path


def format_cycle_rollup_line(
    *,
    findings: int,
    proposals: int,
    hit_rate_5cycle: float,
    miss_reason: str | None = None,
) -> str:
    findings_count = int(findings)
    rendered_reason = "" if findings_count > 0 else (miss_reason or "")
    return (
        f"kg-signal: findings={findings_count} proposals={int(proposals)} "
        f"hit_rate_5cycle={float(hit_rate_5cycle):.2f} miss_reason={rendered_reason}"
    )


def append_cycle_rollup_line(
    report_path: str | os.PathLike[str],
    *,
    findings: int,
    proposals: int,
    hit_rate_5cycle: float,
    miss_reason: str | None = None,
) -> str:
    line = format_cycle_rollup_line(
        findings=findings,
        proposals=proposals,
        hit_rate_5cycle=hit_rate_5cycle,
        miss_reason=miss_reason,
    )
    path = Path(report_path)
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    lines = existing.splitlines()
    if any(old_line.startswith("kg-signal:") for old_line in lines):
        return line
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        if existing and not existing.endswith("\n"):
            fh.write("\n")
        fh.write(line)
        fh.write("\n")
    return line


def reset_buffer_for_test() -> None:
    _buffered_rows.clear()


def _resolve_cycle_id(cycle_id: str | None) -> str | None:
    if cycle_id:
        return cycle_id
    return os.environ.get("HIVE_CYCLE_ID") or os.environ.get("HIVE_META_CYCLE_ID")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _existing_row_keys(path: Path) -> set[tuple[Any, ...]]:
    if not path.exists():
        return set()
    keys: set[tuple[Any, ...]] = set()
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            stripped = line.strip()
            if not stripped:
                continue
            try:
                keys.add(_row_key(json.loads(stripped)))
            except json.JSONDecodeError:
                continue
    return keys


def _row_key(row: dict[str, Any]) -> tuple[Any, ...]:
    event = row.get("event")
    if event == "kg_write":
        return (
            row.get("cycle_id"),
            event,
            row.get("subject"),
            row.get("predicate"),
            row.get("object"),
            row.get("source_epic"),
            row.get("source_agent"),
        )
    if event == "cycle_summary":
        return (row.get("cycle_id"), event)
    return (row.get("cycle_id"), event, row.get("metric_name"), json.dumps(row, sort_keys=True))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kg_metrics_writer")
    parser.add_argument("--cycle-id", required=True)
    parser.add_argument("--findings", type=int, required=True)
    parser.add_argument("--proposals", type=int, required=True)
    parser.add_argument("--hit-rate-5cycle", type=float, required=True)
    parser.add_argument("--miss-reason")
    parser.add_argument("--metrics-dir", default=str(DEFAULT_KG_METRICS_DIR))
    parser.add_argument("--report-path")
    args = parser.parse_args(argv)

    flush_cycle(
        cycle_id=args.cycle_id,
        findings=args.findings,
        proposals=args.proposals,
        hit_rate_5cycle=args.hit_rate_5cycle,
        miss_reason=args.miss_reason,
        metrics_dir=args.metrics_dir,
    )
    line = format_cycle_rollup_line(
        findings=args.findings,
        proposals=args.proposals,
        hit_rate_5cycle=args.hit_rate_5cycle,
        miss_reason=args.miss_reason,
    )
    if args.report_path:
        line = append_cycle_rollup_line(
            args.report_path,
            findings=args.findings,
            proposals=args.proposals,
            hit_rate_5cycle=args.hit_rate_5cycle,
            miss_reason=args.miss_reason,
        )
    print(line)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
