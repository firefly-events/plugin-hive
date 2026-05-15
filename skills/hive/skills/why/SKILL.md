---
name: why
description: Query Hive KG decision provenance for /hive:why using strict predicate/entity lookups first, with free-form topic search as fallback.
---

# Why Skill

Render the audit trail behind Hive decisions from `~/.claude/hive/kg.sqlite`.
Use `--strict` as the primary mode when the predicate and entity are known.
Use a free-form topic string only when the exact KG shape is unknown.

`~/.claude/hive/{kg.sqlite, chromadb.port}` are local-only, do not check into
repos.

**Input:** `$ARGUMENTS` contains either `--strict --predicate <name> --entity
<id>` or a free-form topic string. Optionally pass `--limit <N>` to cap rendered
rows.

## When to Use

- Explaining why a decision, dependency, assignment, or lifecycle event exists
- Auditing KG provenance by predicate and subject/object entity
- Discovering likely decision triples when only a topic phrase is known

## When NOT to Use

- To write new KG triples
- To inspect repo-local source code history
- To query non-Hive data stores directly

## Procedure

### 1. Prefer strict KG lookup

When the predicate and entity are known, invoke strict mode:

```bash
python3 -m hive.lib.kg_why --strict --predicate decided --entity architect
```

Strict mode runs an exact KG query only. It does not query ChromaDB.

Use `--limit` when the entity is broad:

```bash
python3 -m hive.lib.kg_why --strict --predicate phase_blocked --entity join-phase --limit 5
```

### 2. Use free-form search as fallback

When the exact predicate or entity is unknown, pass a topic string:

```bash
python3 -m hive.lib.kg_why sqlite kg decision
```

Free-form mode searches KG triples with `LIKE` across subject, predicate, and
object. Semantic ChromaDB fallback is used only when an available query provider
can return decision metadata suitable for provenance rendering.

### 3. Read the provenance block

Each result renders as:

```text
{subject} {predicate} {object}
  valid_from:   {ts}
  source_epic:  {id}
  source_agent: {name}
  [via: kg | chromadb | both]
```

Results are sorted by `valid_from` descending and deduped by `(subject,
predicate, object)`.

### 4. Handle empty results

Strict mode prints the exact SQL shape for debugging:

```bash
python3 -m hive.lib.kg_why --strict --predicate depends_on --entity unknown-story
```

Free-form mode prints the five most recent triples as discovery hints:

```bash
python3 -m hive.lib.kg_why unknown topic
```
