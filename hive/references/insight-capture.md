# Insight Capture Protocol

During execution, if you encounter something non-obvious and reusable, write an insight to the staging area at `state/insights/{epic-id}/{story-id}/`.

Most steps produce zero insights. Only capture when you find:

- A repeatable pattern worth applying again → type: `pattern`
- A failure or mistake to avoid in the future → type: `pitfall`
- Something that contradicts prior understanding → type: `override`
- A non-obvious codebase convention or constraint → type: `codebase`
- Accumulated knowledge on a topic worth curating across sessions → type: `reference` (include `topic` and `sources` fields)

Format: see `references/agent-memory-schema.md`. Do NOT capture routine completions or expected behavior.

---

## Insight File Format

Write each insight as a separate `.md` file in the staging directory. Name the file using a
short kebab-case slug that describes the pattern or pitfall (not the epic or story).

```markdown
---
name: {short descriptive title}
description: "{one-line summary for relevance matching — what is this memory for?}"
type: pattern | pitfall | override | codebase | reference
agent: {agent-name — who this memory is FOR, not who wrote it}
last_verified: {YYYY-MM-DD}
ttl_days: {90 for pattern, 180 for pitfall, 60 for codebase, null for override/reference}
source: agent
---

{Detailed explanation. Be specific — name files, commands, patterns, behaviors.
Include WHY (root cause or rationale), not just WHAT.
Include enough context that the agent reading this in a future session understands
both what to do and why it matters without needing to re-investigate.}
```

### TTL guidelines

| Type | Default ttl_days | Rationale |
|------|-----------------|-----------|
| `pattern` | 90 | May become outdated as codebase evolves |
| `pitfall` | 180 | Causes persist longer than specific solutions |
| `codebase` | 60 | Codebases change; stale codebase insights mislead |
| `override` | null | Explicit corrections — valid until superseded |
| `reference` | null | Living documents with their own update cycle |

---

## Staging Path Convention

```
state/insights/{epic-id}/{story-id}/{slug}.md
```

- `epic-id`: the current epic's identifier (e.g., `epic-hive-phase5`)
- `story-id`: the story you're working on (e.g., `story-003`)
- `slug`: a short kebab-case name for the insight (e.g., `avoid-parallel-schema-migrations.md`)

If you're capturing an insight that applies to the whole epic rather than a specific story,
use `_epic` as the story-id: `state/insights/{epic-id}/_epic/{slug}.md`

---

## Keep / Discard Criteria

Capture the insight if ALL of these are true:
1. You would apply it differently next time because of what you just learned
2. It is not already covered by an existing memory (check your loaded memories)
3. Another agent working on a different story could benefit from it
4. It is specific enough that an agent can act on it without additional investigation

Skip it if:
- It describes expected behavior ("the test runner found no test files — as expected")
- It is too vague to act on ("always be careful with migrations")
- It duplicates an existing memory you already have loaded
- It is project-specific in a way that won't generalize beyond this codebase

---

## Complete Example

```markdown
---
name: avoid-parallel-schema-migrations
description: "running schema migrations in parallel causes deadlocks on Postgres — always run migrations sequentially even when deploying multiple services"
type: pitfall
agent: backend-developer
last_verified: 2026-04-10
ttl_days: 180
source: agent
---

When deploying multiple backend services simultaneously, their schema migrations competed
for the same Postgres table locks and deadlocked. The deploy pipeline retried, made it
worse, and required a manual rollback.

Fix: Run all schema migrations as a single sequential step before starting any service.
Use a migration coordinator (e.g., a dedicated migration job in CI) rather than per-service
migration at startup.

Affected pattern: any service that runs `db.migrate()` or equivalent at startup.
Safe pattern: one migration job → wait for completion → start all services.
---
```

---

## Session-End Evaluation

Staged insights are evaluated at session-end by the orchestrator:
- Promoted insights are written to `~/.claude/hive/memories/{agent}/`
- Discarded insights are deleted from staging
- The orchestrator makes keep/discard decisions based on the criteria above

You do not need to decide at capture time whether an insight will be promoted — capture if
in doubt and let the orchestrator evaluate. Undercapture (missing real insights) is worse
than overcapture (surfacing a few low-value ones that get discarded).
