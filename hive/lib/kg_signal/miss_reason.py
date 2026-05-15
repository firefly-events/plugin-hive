from __future__ import annotations

import argparse
import json
import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Literal

from hive.lib.config import DEFAULT_BASELINE_CONFIG_PATH, DEFAULT_PROJECT_CONFIG_PATH, read_config_file


MissReason = Literal[
    "empty_kg",
    "empty_predicate_filter",
    "recency_cutoff",
    "project_tag_cutoff",
    "dedup_eviction",
]

PRIORITY_PREDICATES = frozenset({"phase_failed", "phase_blocked", "superseded"})
DEFAULT_WINDOW_DAYS = 30
DEFAULT_CROSS_PROJECT_PENALTY = 0.7
DEFAULT_SURFACE_THRESHOLD = 1.0
DEFAULT_KG_SQLITE_PATH = Path.home() / ".claude" / "hive" / "kg.sqlite"


@dataclass(frozen=True)
class Triple:
    subject: str
    predicate: str
    object: str
    valid_from: str
    source_epic: str | None = None
    source_agent: str | None = None


@dataclass(frozen=True)
class Candidate:
    predicate: str
    source_epic: str | None
    cluster_size: int
    tag: str
    rank_score: float


@dataclass(frozen=True)
class KgSignalState:
    total_current_triples: int
    total_triples_in_window: int
    priority_predicate_triples: int
    priority_predicate_triples_in_window: int
    candidates: tuple[Candidate, ...]


def miss_reason_for_kg(
    *,
    db_path: str | os.PathLike[str] | None = None,
    now: datetime | None = None,
    window_days: int | None = None,
    local_epics: Iterable[str] = (),
    cross_project_penalty: float | None = None,
    surface_threshold: float = DEFAULT_SURFACE_THRESHOLD,
) -> MissReason | None:
    """Return the empty-cycle miss reason from KG query-time state.

    The helper intentionally looks at current triples and their timestamps before
    deciding the bucket, so recency cutoff can be separated from a genuinely
    empty KG instead of guessed after an empty findings file is observed.
    """

    state = query_kg_signal_state(
        db_path=db_path,
        now=now,
        window_days=window_days,
        local_epics=local_epics,
        cross_project_penalty=cross_project_penalty,
        surface_threshold=surface_threshold,
    )
    return discriminate_miss_reason(state, surface_threshold=surface_threshold)


def query_kg_signal_state(
    *,
    db_path: str | os.PathLike[str] | None = None,
    now: datetime | None = None,
    window_days: int | None = None,
    local_epics: Iterable[str] = (),
    cross_project_penalty: float | None = None,
    surface_threshold: float = DEFAULT_SURFACE_THRESHOLD,
) -> KgSignalState:
    resolved_now = _as_utc(now or datetime.now(timezone.utc))
    resolved_window_days = window_days if window_days is not None else read_window_days()
    cutoff = resolved_now - timedelta(days=resolved_window_days)
    penalty = (
        DEFAULT_CROSS_PROJECT_PENALTY
        if cross_project_penalty is None
        else float(cross_project_penalty)
    )
    rows = _read_current_triples(Path(db_path) if db_path else _default_db_path())
    local = set(local_epics)

    triples_in_window = tuple(row for row in rows if _is_recent(row.valid_from, cutoff))
    priority_rows = tuple(row for row in rows if row.predicate in PRIORITY_PREDICATES)
    priority_recent = tuple(row for row in priority_rows if _is_recent(row.valid_from, cutoff))
    candidates = _build_candidates(
        priority_recent,
        local_epics=local,
        cross_project_penalty=penalty,
    )

    return KgSignalState(
        total_current_triples=len(rows),
        total_triples_in_window=len(triples_in_window),
        priority_predicate_triples=len(priority_rows),
        priority_predicate_triples_in_window=len(priority_recent),
        candidates=candidates,
    )


def discriminate_miss_reason(
    state: KgSignalState,
    *,
    surface_threshold: float = DEFAULT_SURFACE_THRESHOLD,
) -> MissReason | None:
    if state.total_current_triples == 0:
        return "empty_kg"
    if state.priority_predicate_triples == 0:
        return "empty_predicate_filter"
    if state.priority_predicate_triples_in_window == 0:
        return "recency_cutoff"
    if state.candidates and all(
        candidate.tag == "cross_project_signal" and candidate.rank_score < surface_threshold
        for candidate in state.candidates
    ):
        return "project_tag_cutoff"
    return None


def step03_dedup_miss_reason(
    *,
    kg_findings_input_count: int,
    kg_findings_post_dedup_count: int,
) -> MissReason | None:
    if kg_findings_input_count > 0 and kg_findings_post_dedup_count == 0:
        return "dedup_eviction"
    return None


def render_step02c_payload(
    kg_findings: list[dict[str, Any]],
    *,
    miss_reason: MissReason | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"phase": "kg-signal", "kg_findings": kg_findings}
    if not kg_findings and miss_reason is not None:
        payload["miss_reason"] = miss_reason
    return payload


def format_step02c_summary_line(
    *,
    findings_count: int,
    miss_reason: MissReason | None,
) -> str:
    if findings_count == 0 and miss_reason is not None:
        return f"[meta-optimize] kg-signal: findings=0 miss_reason={miss_reason}"
    return f"[meta-optimize] kg-signal: findings={findings_count}"


def read_window_days(
    *,
    project_config_path: str | os.PathLike[str] | None = None,
    baseline_config_path: str | os.PathLike[str] | None = None,
) -> int:
    value = _nested_config_value(
        read_config_file(project_config_path or os.environ.get("HIVE_CONFIG") or DEFAULT_PROJECT_CONFIG_PATH),
        ("meta_optimize", "kg_signal", "window_days"),
    )
    if value is None:
        value = _nested_config_value(
            read_config_file(baseline_config_path or DEFAULT_BASELINE_CONFIG_PATH),
            ("meta_optimize", "kg_signal", "window_days"),
        )
    try:
        days = int(value)
    except (TypeError, ValueError):
        return DEFAULT_WINDOW_DAYS
    return days if days >= 0 else DEFAULT_WINDOW_DAYS


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kg_signal_miss_reason")
    parser.add_argument("--db", default=str(_default_db_path()))
    parser.add_argument("--window-days", type=int, default=None)
    parser.add_argument("--local-epic", action="append", default=[])
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    reason = miss_reason_for_kg(
        db_path=args.db,
        window_days=args.window_days,
        local_epics=args.local_epic,
    )
    if args.json:
        print(json.dumps({"miss_reason": reason}))
    elif reason:
        print(reason)
    return 0


def _read_current_triples(db_path: Path) -> tuple[Triple, ...]:
    if not db_path.exists():
        return ()
    try:
        with sqlite3.connect(str(db_path)) as conn:
            columns = {row[1] for row in conn.execute("PRAGMA table_info(triples)")}
            valid_until_predicate = "AND valid_until IS NULL" if "valid_until" in columns else ""
            rows = conn.execute(
                f"""
                SELECT subject, predicate, object, valid_from, source_epic, source_agent
                  FROM triples
                 WHERE 1 = 1
                   {valid_until_predicate}
                """
            ).fetchall()
    except sqlite3.Error:
        return ()
    return tuple(Triple(*row) for row in rows)


def _build_candidates(
    triples: Iterable[Triple],
    *,
    local_epics: set[str],
    cross_project_penalty: float,
) -> tuple[Candidate, ...]:
    groups: dict[tuple[str, str | None], int] = {}
    for triple in triples:
        key = (triple.predicate, triple.source_epic)
        groups[key] = groups.get(key, 0) + 1

    candidates = []
    for (predicate, source_epic), cluster_size in groups.items():
        tag = "local_signal" if source_epic in local_epics else "cross_project_signal"
        multiplier = 1.0 if tag == "local_signal" else cross_project_penalty
        rank_score = cluster_size * multiplier
        candidates.append(Candidate(predicate, source_epic, cluster_size, tag, rank_score))
    return tuple(candidates)


def _is_recent(value: str, cutoff: datetime) -> bool:
    parsed = _parse_iso_datetime(value)
    return parsed is not None and parsed >= cutoff


def _parse_iso_datetime(value: str) -> datetime | None:
    if not value:
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    return _as_utc(parsed)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _nested_config_value(config: dict[str, Any], path: tuple[str, ...]) -> Any:
    cursor: Any = config
    for part in path:
        if not isinstance(cursor, dict):
            return None
        cursor = cursor.get(part)
    return cursor


def _default_db_path() -> Path:
    return Path(os.environ.get("HIVE_KG_SQLITE_PATH", DEFAULT_KG_SQLITE_PATH))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
