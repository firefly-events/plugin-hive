from __future__ import annotations

import argparse
import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence


DEFAULT_LIMIT = 20
DEFAULT_DB_PATH = Path.home() / ".claude" / "hive" / "kg.sqlite"
TRIPLE_COLUMNS = (
    "subject",
    "predicate",
    "object",
    "valid_from",
    "valid_until",
    "source_epic",
    "source_agent",
)
STRICT_SQL_TEMPLATE = (
    "SELECT subject, predicate, object, valid_from, valid_until, source_epic, source_agent "
    "FROM triples WHERE predicate = ? AND (subject = ? OR object = ?) "
    "ORDER BY valid_from DESC"
)
FREEFORM_SQL_TEMPLATE = (
    "SELECT subject, predicate, object, valid_from, valid_until, source_epic, source_agent "
    "FROM triples WHERE subject LIKE ? OR predicate LIKE ? OR object LIKE ? "
    "ORDER BY valid_from DESC"
)
RECENT_SQL_TEMPLATE = (
    "SELECT subject, predicate, object, valid_from, valid_until, source_epic, source_agent "
    "FROM triples ORDER BY valid_from DESC LIMIT 5"
)

ChromaQueryFn = Callable[[str, int], Any]


@dataclass(frozen=True)
class WhyTriple:
    subject: str
    predicate: str
    object: str
    valid_from: str
    valid_until: str | None = None
    source_epic: str | None = None
    source_agent: str | None = None
    via: str = "kg"

    @property
    def key(self) -> tuple[str, str, str]:
        return (self.subject, self.predicate, self.object)


def default_db_path() -> Path:
    return Path(os.environ.get("HIVE_KG_SQLITE_PATH", DEFAULT_DB_PATH)).expanduser()


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    return max(1, int(limit))


def strict_debug_sql(predicate: str, entity: str) -> str:
    return (
        "SELECT subject, predicate, object, valid_from, valid_until, source_epic, source_agent "
        f"FROM triples WHERE predicate = {predicate!r} AND "
        f"(subject = {entity!r} OR object = {entity!r}) ORDER BY valid_from DESC"
    )


def query_kg(
    *,
    db_path: str | Path | None = None,
    strict: bool = False,
    predicate: str | None = None,
    entity: str | None = None,
    topic: str | None = None,
) -> list[WhyTriple]:
    path = Path(db_path).expanduser() if db_path is not None else default_db_path()
    if not path.exists():
        return []

    with sqlite3.connect(str(path)) as conn:
        if strict:
            if not predicate or not entity:
                raise ValueError("--strict requires --predicate and --entity")
            rows = conn.execute(STRICT_SQL_TEMPLATE, (predicate, entity, entity)).fetchall()
        else:
            if not topic:
                return []
            pattern = f"%{topic}%"
            rows = conn.execute(FREEFORM_SQL_TEMPLATE, (pattern, pattern, pattern)).fetchall()

    return [_row_to_triple(row, "kg") for row in rows]


def query_recent_triples(db_path: str | Path | None = None) -> list[WhyTriple]:
    path = Path(db_path).expanduser() if db_path is not None else default_db_path()
    if not path.exists():
        return []
    with sqlite3.connect(str(path)) as conn:
        rows = conn.execute(RECENT_SQL_TEMPLATE).fetchall()
    return [_row_to_triple(row, "kg") for row in rows]


def explain_why(
    *,
    db_path: str | Path | None = None,
    strict: bool = False,
    predicate: str | None = None,
    entity: str | None = None,
    topic: str | None = None,
    limit: int | None = None,
    chromadb_query_fn: ChromaQueryFn | None = None,
) -> str:
    capped_limit = clamp_limit(limit)
    if strict and (not predicate or not entity):
        raise ValueError("--strict requires --predicate and --entity")

    kg_rows = query_kg(
        db_path=db_path,
        strict=strict,
        predicate=predicate,
        entity=entity,
        topic=topic,
    )
    chroma_rows: list[WhyTriple] = []
    if not strict and topic and chromadb_query_fn is not None:
        chroma_rows = query_chromadb(topic, capped_limit, chromadb_query_fn, db_path=db_path)

    merged = merge_triples(kg_rows, chroma_rows)
    if merged:
        return render_triples(merged[:capped_limit])

    if strict:
        return "\n".join(
            [
                f"No triples found for predicate={predicate} entity={entity}.",
                f"SQL: {strict_debug_sql(predicate or '', entity or '')}",
            ]
        )

    recent = query_recent_triples(db_path)
    lines = [f"No decisions found matching {topic}."]
    if recent:
        lines.append("Recent triples:")
        lines.append(render_triples(recent))
    return "\n".join(lines)


def query_chromadb(
    topic: str,
    limit: int,
    chromadb_query_fn: ChromaQueryFn,
    *,
    db_path: str | Path | None = None,
) -> list[WhyTriple]:
    response = chromadb_query_fn(topic, limit)
    available, records = _extract_chroma_response(response)
    if not available:
        return []

    triples: list[WhyTriple] = []
    for record in records:
        metadata = _metadata(record)
        triple = _triple_from_mapping(metadata, via="chromadb")
        if triple is not None:
            triples.append(triple)
            continue

        decision_key = _decision_key(metadata)
        if decision_key:
            triples.extend(_triples_for_decision_key(decision_key, db_path=db_path))

    return triples


def merge_triples(
    kg_rows: Iterable[WhyTriple],
    chroma_rows: Iterable[WhyTriple],
) -> list[WhyTriple]:
    by_key: dict[tuple[str, str, str], WhyTriple] = {}
    for row in list(kg_rows) + list(chroma_rows):
        existing = by_key.get(row.key)
        if existing is None:
            by_key[row.key] = row
            continue
        by_key[row.key] = _merge_row(existing, row)

    return sorted(by_key.values(), key=lambda row: row.valid_from or "", reverse=True)


def render_triples(rows: Sequence[WhyTriple]) -> str:
    return "\n".join(_render_row(row) for row in rows)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render Hive KG why provenance.")
    parser.add_argument("topic", nargs="*", help="Free-form topic query.")
    parser.add_argument("--strict", action="store_true", help="Use exact predicate/entity KG lookup.")
    parser.add_argument("--predicate", help="Predicate for --strict mode.")
    parser.add_argument("--entity", help="Subject or object entity for --strict mode.")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="Maximum rows to render.")
    parser.add_argument("--db-path", default=None, help="Override KG sqlite path.")
    args = parser.parse_args(argv)

    topic = " ".join(args.topic).strip() or None
    try:
        print(
            explain_why(
                db_path=args.db_path,
                strict=args.strict,
                predicate=args.predicate,
                entity=args.entity,
                topic=topic,
                limit=args.limit,
            )
        )
    except ValueError as exc:
        parser.error(str(exc))
    return 0


def _row_to_triple(row: Sequence[Any], via: str) -> WhyTriple:
    return WhyTriple(
        subject=str(row[0]),
        predicate=str(row[1]),
        object=str(row[2]),
        valid_from=str(row[3]),
        valid_until=row[4],
        source_epic=row[5],
        source_agent=row[6],
        via=via,
    )


def _extract_chroma_response(response: Any) -> tuple[bool, list[Mapping[str, Any]]]:
    if response is None or response is False:
        return False, []
    if isinstance(response, Mapping):
        available = bool(response.get("available", True))
        records = response.get("results", response.get("records", []))
        return available, list(records or [])
    if isinstance(response, list):
        return True, response
    return False, []


def _metadata(record: Mapping[str, Any]) -> Mapping[str, Any]:
    metadata = record.get("metadata")
    if isinstance(metadata, Mapping):
        return metadata
    return record


def _triple_from_mapping(mapping: Mapping[str, Any], *, via: str) -> WhyTriple | None:
    if not all(mapping.get(column) for column in ("subject", "predicate", "object")):
        return None
    return WhyTriple(
        subject=str(mapping["subject"]),
        predicate=str(mapping["predicate"]),
        object=str(mapping["object"]),
        valid_from=str(mapping.get("valid_from") or ""),
        valid_until=_optional_str(mapping.get("valid_until")),
        source_epic=_optional_str(mapping.get("source_epic")),
        source_agent=_optional_str(mapping.get("source_agent")),
        via=via,
    )


def _decision_key(mapping: Mapping[str, Any]) -> str | None:
    value = mapping.get("decision-key", mapping.get("decision_key"))
    return str(value) if value else None


def _triples_for_decision_key(
    decision_key: str,
    *,
    db_path: str | Path | None = None,
) -> list[WhyTriple]:
    path = Path(db_path).expanduser() if db_path is not None else default_db_path()
    if not path.exists():
        return []
    with sqlite3.connect(str(path)) as conn:
        rows = conn.execute(
            """
            SELECT subject, predicate, object, valid_from, valid_until, source_epic, source_agent
            FROM triples
            WHERE subject = ? OR object = ?
            ORDER BY valid_from DESC
            """,
            (decision_key, decision_key),
        ).fetchall()
    return [_row_to_triple(row, "chromadb") for row in rows]


def _merge_row(left: WhyTriple, right: WhyTriple) -> WhyTriple:
    via = "both" if left.via != right.via else left.via
    preferred = left if (left.valid_from or "") >= (right.valid_from or "") else right
    return WhyTriple(
        subject=preferred.subject,
        predicate=preferred.predicate,
        object=preferred.object,
        valid_from=preferred.valid_from,
        valid_until=preferred.valid_until,
        source_epic=preferred.source_epic,
        source_agent=preferred.source_agent,
        via=via,
    )


def _render_row(row: WhyTriple) -> str:
    return "\n".join(
        [
            f"{row.subject} {row.predicate} {row.object}",
            f"  valid_from:   {row.valid_from}",
            f"  source_epic:  {row.source_epic or ''}",
            f"  source_agent: {row.source_agent or ''}",
            f"  [via: {row.via}]",
        ]
    )


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


if __name__ == "__main__":
    raise SystemExit(main())
