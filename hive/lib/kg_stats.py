from __future__ import annotations

import argparse
import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Sequence

DEFAULT_DB_PATH = Path.home() / ".claude" / "hive" / "kg.sqlite"
DENSITY_WINDOW_DAYS = 30


def default_db_path() -> Path:
    return Path(os.environ.get("HIVE_KG_SQLITE_PATH", DEFAULT_DB_PATH)).expanduser()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _window_cutoff(now: datetime | None = None) -> str:
    moment = now or _utc_now()
    cutoff = moment - timedelta(days=DENSITY_WINDOW_DAYS)
    return cutoff.isoformat().replace("+00:00", "Z")


def _breakdown(conn: sqlite3.Connection, column: str) -> dict[str, int]:
    rows = conn.execute(
        f"SELECT COALESCE({column}, '(none)') AS k, COUNT(*) AS n "
        f"FROM triples GROUP BY k ORDER BY n DESC, k ASC"
    ).fetchall()
    return {str(key): int(count) for key, count in rows}


def _zombie_predicates(conn: sqlite3.Connection) -> list[str]:
    has_predicates_table = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'predicates'"
    ).fetchone()
    if not has_predicates_table:
        return []
    rows = conn.execute(
        "SELECT predicate FROM predicates "
        "WHERE predicate NOT IN (SELECT DISTINCT predicate FROM triples) "
        "ORDER BY predicate"
    ).fetchall()
    return [str(row[0]) for row in rows]


def collect_stats(
    db_path: str | Path | None = None,
    *,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    """Gather KG stats, or None when the database file is absent."""
    path = Path(db_path).expanduser() if db_path is not None else default_db_path()
    if not path.exists():
        return None

    cutoff = _window_cutoff(now)
    with sqlite3.connect(str(path)) as conn:
        total = int(conn.execute("SELECT COUNT(*) FROM triples").fetchone()[0])
        last_write = conn.execute("SELECT MAX(valid_from) FROM triples").fetchone()[0]
        distinct_tuples = int(
            conn.execute(
                "SELECT COUNT(*) FROM "
                "(SELECT DISTINCT source_agent, predicate FROM triples)"
            ).fetchone()[0]
        )
        window_count = int(
            conn.execute(
                "SELECT COUNT(*) FROM triples WHERE valid_from >= ?", (cutoff,)
            ).fetchone()[0]
        )
        stats: dict[str, Any] = {
            "db_path": str(path),
            "total_triples": total,
            "by_predicate": _breakdown(conn, "predicate"),
            "by_source_agent": _breakdown(conn, "source_agent"),
            "by_source_epic": _breakdown(conn, "source_epic"),
            "last_write": last_write,
            "distinct_agent_predicate_tuples": distinct_tuples,
            "trailing_30d": {
                "since": cutoff,
                "triple_count": window_count,
                "per_day": round(window_count / DENSITY_WINDOW_DAYS, 2),
            },
            "zombie_predicates": _zombie_predicates(conn),
        }
    return stats


def _render_section(title: str, counts: dict[str, int]) -> list[str]:
    lines = [title, "-" * len(title)]
    if not counts:
        lines.append("  (no rows)")
        return lines
    width = max(len(key) for key in counts)
    for key, count in counts.items():
        lines.append(f"  {key.ljust(width)}  {count}")
    return lines


def render_table(stats: dict[str, Any]) -> str:
    window = stats["trailing_30d"]
    lines = [
        f"KG STATS — {stats['db_path']}",
        "",
        f"Total triples:        {stats['total_triples']}",
        f"Last write:           {stats['last_write'] or '(never)'}",
        f"Distinct (agent, predicate) tuples: {stats['distinct_agent_predicate_tuples']}",
        (
            f"Trailing {DENSITY_WINDOW_DAYS}-day density: "
            f"{window['triple_count']} triples since {window['since']} "
            f"({window['per_day']}/day)"
        ),
        "",
    ]
    lines.extend(_render_section("BY PREDICATE", stats["by_predicate"]))
    lines.append("")
    lines.extend(_render_section("BY SOURCE AGENT", stats["by_source_agent"]))
    lines.append("")
    lines.extend(_render_section("BY SOURCE EPIC", stats["by_source_epic"]))
    lines.append("")
    zombies = stats["zombie_predicates"]
    lines.append("DECLARED-BUT-NEVER-WRITTEN")
    lines.append("-" * len("DECLARED-BUT-NEVER-WRITTEN"))
    if zombies:
        lines.extend(f"  {predicate}" for predicate in zombies)
    else:
        lines.append("  (none)")
    return "\n".join(lines)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Print Hive KG density and breakdown stats.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    parser.add_argument("--db-path", default=None, help="Override KG sqlite path.")
    args = parser.parse_args(argv)

    path = Path(args.db_path).expanduser() if args.db_path else default_db_path()
    stats = collect_stats(path)
    if stats is None:
        # Silent-soft-fail per other KG tooling: missing DB is not an error.
        print(f"no kg database found at {path}")
        return 0

    if args.json:
        print(json.dumps(stats, indent=2))
    else:
        print(render_table(stats))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
