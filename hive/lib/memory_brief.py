"""Build the bounded "## Prior Experience" brief section for a dispatched persona.

Read side of the multica agent learning loop (s1-brief-memory-injection). Pulls
from three sources — committed team-memories, system-level classic memories,
and the kg.sqlite decision graph — ranks most-relevant-first, and truncates to
a token budget. Stdlib-only; the Node dispatch bridge
(hive/lib/multica-story-dispatch/index.mjs) shells to this module and
concatenates stdout verbatim. No selection/formatting logic belongs there.
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

DEFAULT_TOKEN_BUDGET = 1500
DEFAULT_CLASSIC_TOP_N = 5
DEFAULT_KG_DB_PATH = Path.home() / ".claude" / "hive" / "kg.sqlite"
DECISION_PREDICATES = ("phase_failed", "phase_blocked", "decided", "insight")
SECTION_HEADER = "## Prior Experience"

# Rough chars-per-token heuristic (no tokenizer dependency, stdlib-only policy).
CHARS_PER_TOKEN = 4


def estimate_tokens(text: str) -> int:
    return max(1, (len(text) + CHARS_PER_TOKEN - 1) // CHARS_PER_TOKEN)


@dataclass(frozen=True)
class MemoryEntry:
    name: str
    description: str
    source_label: str
    source_epic: str | None
    mtime: float


@dataclass(frozen=True)
class DecisionTriple:
    subject: str
    predicate: str
    object: str
    valid_from: str
    source_epic: str | None


def default_kg_db_path() -> Path:
    return Path(os.environ.get("HIVE_KG_SQLITE_PATH", DEFAULT_KG_DB_PATH)).expanduser()


def default_team_memories_root() -> Path:
    return Path.cwd() / ".pHive" / "team-memories"


def default_classic_memories_root() -> Path:
    return Path.home() / ".claude" / "hive" / "memories"


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---"):
        return {}, text
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text
    end = None
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            end = idx
            break
    if end is None:
        return {}, text

    meta: dict[str, str] = {}
    for line in lines[1:end]:
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        meta[key.strip()] = value.strip().strip('"').strip("'")

    body = "\n".join(lines[end + 1 :]).strip()
    return meta, body


def _read_memory_files(directory: Path, source_label: str) -> list[MemoryEntry]:
    if not directory.is_dir():
        return []
    entries: list[MemoryEntry] = []
    for path in sorted(directory.glob("*.md")):
        if path.name == ".gitkeep":
            continue
        try:
            text = path.read_text(encoding="utf-8")
            mtime = path.stat().st_mtime
        except OSError:
            continue
        meta, _body = parse_frontmatter(text)
        entries.append(
            MemoryEntry(
                name=meta.get("name") or path.stem,
                description=meta.get("description", ""),
                source_label=source_label,
                source_epic=meta.get("source_epic") or None,
                mtime=mtime,
            )
        )
    return entries


def gather_team_memories(persona: str, *, root: Path | None = None) -> list[MemoryEntry]:
    base = root if root is not None else default_team_memories_root()
    return _read_memory_files(base / persona, "team-memory")


def gather_classic_memories(
    persona: str,
    *,
    root: Path | None = None,
    top_n: int = DEFAULT_CLASSIC_TOP_N,
) -> list[MemoryEntry]:
    base = root if root is not None else default_classic_memories_root()
    entries = _read_memory_files(base / persona, "agent-memory")
    entries.sort(key=lambda e: e.mtime, reverse=True)
    return entries[:top_n]


def gather_kg_decisions(epic: str | None, *, db_path: Path | None = None) -> list[DecisionTriple]:
    if not epic:
        return []
    path = db_path if db_path is not None else default_kg_db_path()
    if not path.exists():
        return []

    # Match the write side (insight_distill.emit_kg_event, walker._emit_phase_*):
    # every triple carries source_epic — insight triples key subject as
    # "<epic>:<story>" and phase_failed/phase_blocked triples key subject as a
    # bare node_id, so neither is reachable via `subject = ?`/`object = ?`
    # bound to the bare epic value. source_epic is the one field both writers
    # populate consistently, so filter on that instead.
    placeholders = ",".join("?" for _ in DECISION_PREDICATES)
    sql = (
        "SELECT subject, predicate, object, valid_from, source_epic "
        "FROM triples "
        f"WHERE source_epic = ? AND predicate IN ({placeholders}) "
        "AND valid_until IS NULL "
        "ORDER BY valid_from DESC"
    )
    try:
        with sqlite3.connect(str(path)) as conn:
            rows = conn.execute(sql, (epic, *DECISION_PREDICATES)).fetchall()
    except sqlite3.Error:
        return []

    return [
        DecisionTriple(
            subject=str(row[0]),
            predicate=str(row[1]),
            object=str(row[2]),
            valid_from=str(row[3]),
            source_epic=row[4],
        )
        for row in rows
    ]


def _relevance_key(entry: MemoryEntry, epic: str | None, story: str | None) -> tuple[int, int, float]:
    epic_match = 0 if (epic and entry.source_epic == epic) else 1
    story_match = 0 if (story and entry.name == story) else 1
    return (epic_match, story_match, -entry.mtime)


def _format_memory_entry(entry: MemoryEntry) -> str:
    desc = f": {entry.description}" if entry.description else ""
    return f"- **{entry.name}** ({entry.source_label}){desc}"


def _format_decision_triple(triple: DecisionTriple) -> str:
    epic_note = f", via {triple.source_epic}" if triple.source_epic else ""
    return f"- {triple.subject} {triple.predicate} {triple.object} (since {triple.valid_from}{epic_note}) (kg)"


def build_prior_experience(
    persona: str,
    epic: str | None,
    story: str | None,
    token_budget: int = DEFAULT_TOKEN_BUDGET,
    *,
    team_memories_root: Path | None = None,
    classic_memories_root: Path | None = None,
    kg_db_path: Path | None = None,
    classic_top_n: int = DEFAULT_CLASSIC_TOP_N,
) -> str:
    """Return the bounded '## Prior Experience' markdown section, or '' if empty.

    Ordering is most-relevant-first: entries whose source_epic matches `epic`
    sort ahead of unrelated ones, ties broken by recency. Iteration stops (does
    not skip ahead) at the first line that would exceed the remaining budget,
    so the result is always a relevance-ordered prefix, never exceeding the cap.
    """
    if not persona:
        return ""

    memory_entries = [
        *gather_team_memories(persona, root=team_memories_root),
        *gather_classic_memories(persona, root=classic_memories_root, top_n=classic_top_n),
    ]
    memory_entries.sort(key=lambda e: _relevance_key(e, epic, story))

    kg_triples = gather_kg_decisions(epic, db_path=kg_db_path)

    lines: list[str] = []
    budget_left = token_budget - estimate_tokens(SECTION_HEADER)

    for entry in memory_entries:
        line = _format_memory_entry(entry)
        cost = estimate_tokens(line)
        if cost > budget_left:
            break
        lines.append(line)
        budget_left -= cost

    if kg_triples and budget_left > 0:
        heading = "### Decision Context (from knowledge graph)"
        heading_cost = estimate_tokens(heading)
        if heading_cost <= budget_left:
            kg_lines = [heading]
            remaining = budget_left - heading_cost
            for triple in kg_triples:
                line = _format_decision_triple(triple)
                cost = estimate_tokens(line)
                if cost > remaining:
                    break
                kg_lines.append(line)
                remaining -= cost
            if len(kg_lines) > 1:
                lines.extend(kg_lines)
                budget_left = remaining

    if not lines:
        return ""

    return f"{SECTION_HEADER}\n\n" + "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Emit the Prior Experience brief section.")
    parser.add_argument("--persona", required=True)
    parser.add_argument("--epic", default=None)
    parser.add_argument("--story", default=None)
    parser.add_argument("--token-budget", type=int, default=DEFAULT_TOKEN_BUDGET)
    parser.add_argument("--team-memories-root", default=None)
    parser.add_argument("--classic-memories-root", default=None)
    parser.add_argument("--kg-db-path", default=None)
    args = parser.parse_args(argv)

    section = build_prior_experience(
        args.persona,
        args.epic,
        args.story,
        args.token_budget,
        team_memories_root=Path(args.team_memories_root) if args.team_memories_root else None,
        classic_memories_root=Path(args.classic_memories_root) if args.classic_memories_root else None,
        kg_db_path=Path(args.kg_db_path) if args.kg_db_path else None,
    )
    if section:
        sys.stdout.write(section)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
