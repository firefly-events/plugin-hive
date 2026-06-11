---
name: kg-stats
description: Print Hive KG health stats for /hive:kg-stats — total triple count, per-predicate and per-source breakdowns, distinct (agent, predicate) tuples, last-write timestamp, trailing-30-day density, and zombie predicates.
---

# KG Stats Skill

Report the health and write density of `~/.claude/hive/kg.sqlite`. This is the
baseline measurement tool for KG repair work: run it before and after a change
to see whether write density and predicate coverage actually moved.

`~/.claude/hive/kg.sqlite` is local-only, do not check into repos.

**Input:** `$ARGUMENTS` optionally contains `--json` for machine-readable
output and/or `--db-path <path>` to point at a non-default sqlite file.

## When to Use

- Measuring KG write density before/after a repair or activation change
- Auditing which predicates and source agents actually write triples
- Finding declared-but-never-written ("zombie") predicates

## When NOT to Use

- To query specific triples or decision provenance (use `/hive:why`)
- To write or import KG triples

## Procedure

### 1. Run the stats helper

```bash
python3 -m hive.lib.kg_stats
```

Prints a formatted table: total triples, last-write timestamp, distinct
(source_agent, predicate) tuple count, trailing-30-day density, then
per-predicate, per-source-agent, and per-source-epic breakdowns, and finally a
`DECLARED-BUT-NEVER-WRITTEN` section listing predicates present in the
`predicates` table that have zero triples.

### 2. Machine-readable output

```bash
python3 -m hive.lib.kg_stats --json
```

Emits the same data as JSON to stdout with no table formatting. Keys:
`total_triples`, `by_predicate`, `by_source_agent`, `by_source_epic`,
`last_write`, `distinct_agent_predicate_tuples`, `trailing_30d`
(`since` / `triple_count` / `per_day`), `zombie_predicates`.

### 3. Missing database

When `~/.claude/hive/kg.sqlite` does not exist, the helper exits 0 with a
one-line `no kg database found at <path>` message — silent-soft-fail, matching
the rest of the KG tooling. The `HIVE_KG_SQLITE_PATH` env var or `--db-path`
flag override the default location.
