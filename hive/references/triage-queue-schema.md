# Triage Queue Schema

Schema specification for `.pHive/triage/queue.yaml` — the persistence surface for the brownfield bug + feature intake skill (`skills/triage/SKILL.md`, story a-27-triage-skill-md).

This file is a **planning-state data** artifact, not a runtime workflow config. It records intake state for hand-off to `/plan` and surfacing in standup Phase 1. It does NOT carry execution metadata, agent state, or workflow-step results.

## Target path

`.pHive/triage/queue.yaml`

The triage skill creates the directory and file on first use (warn-and-proceed posture from the skill's kickoff-gate override). Pre-existing repos may not have this file; consumers MUST handle absence gracefully (treat as empty queue).

## Top-level structure

```yaml
# .pHive/triage/queue.yaml
version: 1
items:
  - id: t-001
    state: inbox
    kind: bug
    title: "Login flow drops session on Safari refresh"
    description: |
      Multi-line free-form description from the reporter. Reproduction
      steps, environment context, links to related issues.
    reporter: "alice@example.com"
    reported_at: 2026-05-10T15:00:00Z
    priority: null          # populated at clarified -> prioritized transition
    severity: null          # populated at clarified -> prioritized transition
    assignee: null          # optional; populated when an operator picks up the entry
    linked_epic: null       # populated at prioritized -> plan-ready transition
    linked_story: null      # populated at prioritized -> plan-ready transition
    closed_reason: null     # populated at any -> closed transition
    closed_at: null         # populated at any -> closed transition
    state_history:
      - { state: inbox, at: 2026-05-10T15:00:00Z }
```

## Required per-item fields

Every item carries these fields (per planning brief). Other fields are NOT permitted unless optional adapter write-back work is separately activated (out of scope here).

| Field | Type | Populated when | Notes |
|---|---|---|---|
| `id` | string | item created | Short stable ID, e.g., `t-001`. Operator- or skill-generated, monotonic. |
| `state` | enum | item created | One of the canonical five triage states (see below). |
| `kind` | enum | item created | `bug` \| `feature` \| `unknown`. May be refined at `inbox -> clarified`. |
| `title` | string | item created | One-line summary. |
| `description` | string | item created | Free-form, multi-line allowed. |
| `reporter` | string | item created | Identifier of who filed the report (email, handle, or `system` for automated intake). |
| `reported_at` | ISO 8601 timestamp | item created | When the report entered the queue. |
| `priority` | enum or null | `clarified -> prioritized` | `p0` \| `p1` \| `p2` \| `p3`. Null until prioritization. |
| `severity` | enum or null | `clarified -> prioritized` | `critical` \| `high` \| `moderate` \| `low`. Null until prioritization. |
| `assignee` | string or null | optional | Operator who owns the entry's progression through the queue. Optional. |
| `linked_epic` | string or null | `prioritized -> plan-ready` | Epic ID produced by `/plan --from-triage`. Null until hand-off. |
| `linked_story` | string or null | `prioritized -> plan-ready` | Story ID(s) produced by `/plan --from-triage`. Null or array. |
| `closed_reason` | string or null | `any -> closed` | Free-form reason ("shipped in PR #N", "duplicate of t-007", "won't fix: out of scope"). |
| `closed_at` | ISO 8601 timestamp or null | `any -> closed` | When the entry reached `closed`. |
| `state_history` | array of `{state, at}` | item created; appended on every transition | Append-only audit trail. Last entry's `state` MUST match top-level `state`. |

**Timestamps.** `reported_at`, `closed_at`, and every `state_history.at` are ISO 8601 UTC. The skill stamps them at write time.

## Canonical state values

The `state` field's enum is bound to the five triage states defined in [`skills/triage/SKILL.md`](../../skills/triage/SKILL.md):

```
inbox | clarified | prioritized | plan-ready | closed
```

Adding states or aliasing names is OUT OF SCOPE — would require a catalog-level change to the skill itself. Queue integrity depends on matching the Borrow 3 state machine exactly.

## Warning-only gate behavior at the persistence layer

The triage skill's kickoff-gate override (warn, don't block) cascades into queue persistence:

- **Missing `.pHive/` entirely:** create `.pHive/triage/` and write `queue.yaml` with `version: 1` and `items: []`. Emit the standard kickoff warning ("Hive not initialized..."). Do NOT block.
- **`.pHive/` exists but `triage/` does not:** create `triage/` and write `queue.yaml`. No warning needed (Hive is initialized; the dir just hasn't been used yet).
- **`queue.yaml` exists but is malformed:** emit a warning naming the parse error and the path; proceed with an in-memory empty queue for the current invocation; do NOT auto-overwrite the malformed file. Operator fixes manually.
- **`queue.yaml` exists with `version` mismatch:** treat as malformed (above). Schema migrations are explicit, not silent.

This is fail-open semantics — partial / missing state degrades gracefully into a usable queue rather than blocking the operator.

## Single writer

The triage skill is the **single writer** of this file. Other skills (`/plan --from-triage`, standup Phase 1, optional adapter write-back) read it; only triage updates it. Hand-off stories propagate state changes by calling triage rather than touching the file directly:

- `/plan --from-triage` produces an epic + stories, then calls triage with the resulting IDs to advance the entry.
- Standup Phase 1 reads the queue and renders open entries — it never writes.

This invariant keeps the state machine coherent (every transition writes a `state_history` entry) and makes the schema's evolution tractable (one writer to update if the schema changes).

## Out of scope

- Adapter sync fields (Linear / GitHub / atoshell IDs) — deferred to optional write-back follow-on, post-2.0 if reopened
- Multi-queue or per-team queues — single file, single source per atomic-skill posture
- Tags / labels / arbitrary user-defined fields — schema is intentionally narrow
- Time-based auto-advance / SLA tracking — operator-driven by design

## See also

- [`skills/triage/SKILL.md`](../../skills/triage/SKILL.md) — authoritative skill contract; defines the five-state machine and operator flow this schema persists
- `.pHive/CONTEXT.md` — domain glossary (Triage entry)
- `.pHive/epics/hive-composability-audit/docs/recommendation.md` §2.3 row 27 — Borrow 3 specification
- Sibling W3 stories (a-27-triage-plan-handoff, a-27-triage-standup-handoff) — consumers of this schema
