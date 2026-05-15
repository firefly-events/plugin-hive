# Research Raw — KG Signal Revival

**Author:** orchestrator (self-research; codex researcher dispatched async, reconcile if output lands)
**Date:** 2026-05-13
**Source:** primary code reads via ctx_batch_execute against develop branch, plus user-supplied diagnostic snapshot.

This is raw findings (file paths, line refs, predicate names, current vs missing call sites). Technical-writer renders to `research-brief.md` next.

---

## Pre-known diagnostics (orchestrator-supplied, not re-derived)

- `~/.claude/hive/kg.sqlite`: 66 triples; only `decided` predicate firing in production. Last write 2026-05-11 (3 triples). Heaviest day 2026-04-22 (18 triples — backfill).
- `~/.claude/hive/projects.yaml`: 1 project (plugin-hive).
- `~/.claude/hive/` has NO `chromadb*` directory — sidecar never started locally.
- Zero production `/meta-optimize` cycles surfaced a `kg_signal` proposal (only `S5` fixture grep hit).
- kg-augmented-meta-signal epic SHIPPED 2026-04-28 (release 1.1.4 via PR #35). Phase 1 memory foundation SHIPPED 1.1.3. Plumbing live; pipeline cold.

---

## Section 1: Lifecycle predicate write-site gap analysis

### Canonical vocabulary (FK-enforced in `predicates` table)

Source: `hive/references/knowledge-graph-schema.md` — SQLite Bootstrap section.

| Predicate         | Semantic class | Step-02c consumer? | Production fires? |
|-------------------|----------------|--------------------|-------------------|
| `decided`         | decision       | no (it ignores)    | YES — 66 triples  |
| `superseded`      | decision       | **YES** (`KG_SUPERSESSION`) | NO            |
| `assigned_to`     | decision       | no                 | NO                |
| `blocked_by`      | decision       | no                 | NO                |
| `depends_on`      | decision       | no                 | NO                |
| `phase_started`   | lifecycle      | no                 | NO                |
| `phase_complete`  | lifecycle      | no                 | NO                |
| `phase_failed`    | lifecycle      | **YES** (`KG_FAILURE_CLUSTER`) | NO    |
| `phase_blocked`   | lifecycle      | **YES** (`KG_FAILURE_CLUSTER`) | NO    |

**Critical insight:** step-02c only consumes 3 of the 9 predicates — `phase_failed`, `phase_blocked`, `superseded` (`hive/workflows/steps/meta-team-cycle/step-02c-kg-signal.md` §3 "Query the KG"). All three are NEVER WRITTEN in production. Hence zero hit rate is a *direct* mechanical consequence of zero emission of the 3 consumer-relevant predicates, not a query-side issue.

### Canonical writer

`hive/lib/session-end.js` runs the three-op session-end window:

```js
// Phase A: Insight promotion
// Phase B: KG triple write (after Phase A — slugs must be promoted first)
if (triples.length > 0) {
  try {
    await kgWrite(triples, epicId, agentName);
  } catch (err) { kgError = err; ... }
}
// Phase C: compile() and chromadb.index() in parallel (after Phase B)
```

**Gap:** `triples[]` is passed in as a parameter. Each CALLER decides what triples to assemble. So the gap isn't `kg_write()` — that's working. The gap is in CALLER assembly:

- Search for "triples:" call-sites in caller code yielded **only insight-promotion adjacent writes** — those emit `decided` (matches the 66-triple snapshot). No caller assembles lifecycle triples.

### Expected emit sites (currently silent)

| Predicate         | Expected emitter location | Current state |
|-------------------|---------------------------|---------------|
| `phase_started`   | `skills/hive/skills/execute/` story entry; orchestrator self-emit at workflow-phase entry | NO emission |
| `phase_complete`  | story step completion in `hive/lib/dag_executor/` walker; review-step-complete hook | NO emission |
| `phase_failed`    | dag_executor failure path; reviewer.md verdict=reject path; tester.md fail path | NO emission |
| `phase_blocked`   | dag_executor when `blocked_by` upstream not produced; tpm escalation-raise path | NO emission |
| `superseded`      | `/plan` skill when overwriting prior story (rare) + meta-optimize when replacing prior proposal; insight-promotion when a memory file is replaced | NO emission (or extremely rare) |
| `assigned_to`     | TaskUpdate `owner` set; spawn-time assignment | NO emission |
| `blocked_by`      | `epic.yaml` story `depends_on` ingest + raise-blocker hook | NO emission |
| `depends_on`      | same as `blocked_by` — soft dep marker | NO emission |

`scripts/kg-import-cycle-state.js` (336 lines) is the ONE script that batch-emits triples from local `.pHive/cycle-state/`. It runs on demand (not auto). When it runs, it emits `decided` heavily — that explains the 18-triple backfill day 2026-04-22.

---

## Section 2: ChromaDB bootstrap gap

`hive/lib/chromadb-wrapper.js` is a **JSON-RPC client** to a long-lived sidecar process. From the source:

```js
// Design decision D2: ChromaDB runs as a persistent process (not spawned per-query)
// to avoid Python cold-start latency (~2s). The sidecar must be started separately
// (see kickoff-protocol.md Phase 5 for the nudge).
//
// All methods degrade gracefully — callers receive null/false/[] rather than errors
// when the sidecar is unavailable.
```

- `isAvailable()` returns false on any connection error.
- `query()` returns `[]` and warns `falling back to L1+L0`.
- `index()` returns `false`.

The wrapper does **not** start the sidecar. The wrapper only talks to it on `localhost:8000`.

**Bootstrap gap:**

- `/hive:kickoff` is supposed to nudge the user to start the sidecar (`kickoff-protocol.md` Phase 5).
- On THIS machine, sidecar never started → `~/.claude/hive/` has no `chromadb*` directory → all `chromadb.index()` calls during session-end Phase C silently fail → `chromadbWarning` collected and surfaced, but no hard error → L3 corpus is empty → semantic retrospection has nothing to surface.

**Why the nudge fails:** the kickoff nudge is text-only ("here's how to start it"). No script auto-launches the sidecar. The user would need to: install `chromadb` Python pkg, run `chroma run` in a background terminal, persist the storage path. None of this is automated.

**Fix surface area:** either auto-start the sidecar (process management; e.g., a `hive/scripts/chromadb-start.sh` that backgrounds it + records PID; SessionStart hook), or replace ChromaDB with an in-process embedding store (sqlite-vss / `node-sqlite-vec`) that doesn't need a sidecar.

---

## Section 3: Meta-optimize step-02c instrumentation gap

### Current behavior (from `step-02c-kg-signal.md`)

The step is **read-only**, queries `phase_failed`/`phase_blocked`/`superseded`, applies three-layer relevance filter (predicate ∩ 30-day recency ∩ project-tag with 0.7× cross-project rank penalty), emits findings shaped as `kg-finding-{N}` with `discovery_source: kg_signal`. Findings flow into step-03 proposal merge.

### Telemetry gaps

1. **No proposal-source counter.** When step-02c emits N findings, no `proposals_from_kg_signal++` metric is recorded. When step-03 accepts a proposal, no field captures which `discovery_source` won.
2. **No hit-rate gauge.** "Did this cycle produce ANY kg-derived proposal?" answered only by grepping the output yaml after the fact.
3. **No miss-reason log.** When the three-layer filter returns 0 findings, no log line records WHY (predicate-empty? recency-cutoff? project-tag-cutoff?). The skill says "log `kg_signal: no eligible triples — skipping`" but that's one collapsed message.
4. **kg-findings.yaml is written but not summarized.** Step 7 writes `kg-findings.yaml` per the spec; step 8 produces a kg-signal summary. Neither is rolled up into a cycle-level meta metric.
5. **Cross-cycle aggregate is absent.** Can't answer "over the last 5 cycles, what fraction routed via kg_signal vs backlog vs metrics?" without reading 5 cycle directories.

### What exists vs needed

- Exists: per-cycle `kg-findings.yaml` + summary log line.
- Needed: counters wired into `skills/hive/skills/meta-optimize/metric_registry.py`. Hit-rate gauge across N most recent cycles. Miss-reason taxonomy + per-cycle miss reason. Decision-trail link (which step-03 proposal IDs traced to kg_signal).

---

## Section 4: Predicate vocabulary canon

Source: `hive/references/knowledge-graph-schema.md`.

```sql
INSERT OR IGNORE INTO predicates VALUES
  ('decided'), ('superseded'), ('assigned_to'), ('blocked_by'), ('depends_on'),
  ('phase_started'), ('phase_complete'), ('phase_failed'), ('phase_blocked');
```

### Semantic categories

**Decision predicates** — capture deliberate choices:
- `decided`: architectural/implementation decision. **Currently the only firing predicate.**
- `superseded`: marks a prior `decided` triple as replaced. Drives `KG_SUPERSESSION` in step-02c.
- `assigned_to`: story/task assigned to agent. Should fire from `TaskUpdate owner=`.
- `blocked_by` / `depends_on`: dependency edges between work items. Should ingest from `epic.yaml`/story YAMLs.

**Lifecycle predicates** — capture workflow state transitions:
- `phase_started`: phase began.
- `phase_complete`: phase succeeded.
- `phase_failed`: phase failed. Drives `KG_FAILURE_CLUSTER`.
- `phase_blocked`: phase cannot proceed. Drives `KG_FAILURE_CLUSTER`.

### Subject conventions per schema doc

- `subject` = agent name, epic ID, story ID, or decision key.
- `object` = value/slug/identifier.
- `valid_from` = ISO 8601. Default = now.
- `valid_until` = null until superseded (then set to supersession time on the old triple).
- `source_epic` = epic providing context.
- `source_agent` = agent that produced this triple.

### `kg_write()` contract (canonical writer)

- Validates predicate against `predicates` table — unknown predicate **errors immediately**.
- Atomic: all triples in one call go inside a single `BEGIN; ... COMMIT;` block.
- Idempotent: `(subject, predicate, object, source_epic)` is uniquely indexed via `idx_unique_triple` → re-runs of the same write are no-ops via `INSERT OR IGNORE`.
- Degrades gracefully: kg.sqlite missing/locked → warns + no-op, never raises.

---

## Section 5: Multi-project registry mechanics

### Schema (from `~/.claude/hive/projects.yaml` + `scripts/kg-bootstrap-from-projects.js`)

```yaml
projects:
  - path: /Users/don/Documents/plugin-hive   # absolute path to Hive-enabled project
    name: plugin-hive                         # short name; used as source_epic namespace prefix
```

### Bootstrap script

`scripts/kg-bootstrap-from-projects.js` (~252 lines):

- Reads `HIVE_PROJECTS_REGISTRY` env var, else `~/.claude/hive/projects.yaml`.
- For each entry: walks `.pHive/cycle-state/`, invokes `scripts/kg-import-cycle-state.js` against it.
- Namespaces `source_epic` as `{project_name}/{epic_id}` to prevent `idx_unique_triple` collisions.
- Defaults to `--dry-run`; `--apply` writes.
- Idempotent (relies on `INSERT OR IGNORE`).
- Detects dup names + dup canonical paths; warns + drops.

### Gap

- Only one project registered. Cross-project rank penalty (0.7× per step-02c §4.3) has nothing to penalize.
- Adding a 2nd project requires: editing the yaml manually, then running `kg-bootstrap-from-projects.js --apply`.
- No `/hive:register-project` skill or CLI exposes this.
- Candidates for a 2nd project: Shindig Mobile (active), Signal Flayr (if Hive-enabled), or seed with the meta-team-cycle artifacts in `.pHive/meta-team/`.

---

## Section 6: KG read-path inventory + retrospection UX gap

### Read entry points (production)

- `MemoryStore.query_decisions(filter)` per `hive/references/memory-store-interface.md`. Filter shape: `{ entity, predicate, as_of, ... }`. `entity` matches both `subject` and `object` columns.
- Used by `step-02c-kg-signal.md` (one consumer).
- No CLI for ad-hoc query. No "show me decisions about X" skill.

### Retrospection UX state

- The KG IS a queryable record once populated. Today, the only way to ask "why did we decide X?" is `sqlite3 ~/.claude/hive/kg.sqlite 'SELECT ... WHERE subject LIKE ...'` — not a user-facing tool.
- ChromaDB L3 sidecar absent → semantic retrospection (vector similarity) is dark.
- No `/hive:why` or `/hive:decisions <topic>` command. The decision-audit-trail north star has read-path but no UX.

### Other adjacent stores

- `~/.claude/hive/memories/` — agent insight files (markdown). Read by compile() → wiki.
- `.pHive/episodes/` — episode JSON-ish files. Consumed by `dreaming-replay.js` (5th /meta-optimize source).
- `.pHive/meta-team/charter.md` — scope boundaries; step-02c reads for awareness.

### Dreaming replay (adjacent, not the same)

`hive/lib/dreaming-replay.js` (per S16 story) replays `.pHive/episodes/` and emits playbook deltas via `applyDelta` on a passed-in KG handle. **Capability probe currently returns `false` by default** (`defaultCapabilityProbe = async () => false`), so dreaming-replay outputs zero deltas in practice. This is a separate inactive signal source — not in scope for this epic but noteworthy as a 5th lever.

---

## Cross-reference: kg-augmented-meta-signal epic landed surface

Already-shipped artifacts that anchor this epic's starting point (per `project_kg_augmented_meta_signal.md` memory):

| Story | Artifact | Commit |
|-------|----------|--------|
| S1 | `hive/workflows/steps/meta-team-cycle/step-02c-kg-signal.md` | landed |
| S2 | `scripts/kg-bootstrap-from-projects.js` (252L) | bfd7e92 |
| S3 | step-03 KG findings merge with `discovery_source: kg_signal` | f9a7d04 |
| S4 | `meta_optimize.kg_signal` config + KG-before-backlog routing | 4b28f5c |
| S5 | fixture under `tests/fixtures/kg-augmented-meta-signal/` | 01e0a33 |
| S6 | README audit | 456f6ee |
| S7 | production emission story (state unverified) | `.pHive/epics/kg-augmented-meta-signal/stories/S7-kg-signal-production-emission.yaml` |

**S7 is the predecessor scope-overlap candidate.** Before finalizing this epic, the writer/TPM should read S7's spec and either de-scope this epic to avoid overlap, or supersede S7 with this work.

---

## Open questions (for design-discussion to resolve)

1. **Bootstrap strategy for ChromaDB:** auto-start sidecar via SessionStart hook, or replace with in-process embedding store (sqlite-vec)? Trade: ops complexity vs. dependency footprint.
2. **Predicate emission scope:** wire all 8 silent predicates, or only the 3 step-02c-consumer-relevant ones (`phase_failed`, `phase_blocked`, `superseded`)? Trade: audit-trail completeness vs. emission noise.
3. **Telemetry surface:** add metric counters to `metric_registry.py`, or stand up a new `kg-signal-hit-rate` log file under `.pHive/metrics/kg/`? Trade: integration with existing baseline vs. separation of concerns.
4. **Retrospection UX:** `/hive:why <topic>` slash command, or an `@orchestrator` query helper in the planning skill? Trade: discoverability vs. integration.
5. **Cross-project candidate:** which 2nd project to onboard first — Shindig Mobile, Signal Flayr, or stub-seed with meta-team artifacts? Trade: real signal vs. controlled test.
6. **S7 disposition:** does this epic supersede S7-kg-signal-production-emission, or does S7 land independently and this epic builds on its output? Need to read S7 spec.

---

## Caveat — codex researcher dispatch outcome unknown

A codex:codex-rescue researcher was dispatched at 23:03 with target `.pHive/epics/kg-signal-revival/docs/research-raw.md`. As of writing (23:05+), no codex output exists on disk and no cmux pane is observable. This file (orchestrator self-research) is being written under the assumption codex did not land. If a codex output appears at the same path, the writer should diff + reconcile during the research-brief render step. The two-file pattern (`research-raw.md` self + future `research-raw-codex.md` if codex returns) is acceptable; technical-writer merges both into `research-brief.md`.

**Routing log update:** `[info] planning routing: persona=researcher requested=codex path=codex-rescue → orchestrator-self-research reason=codex-dispatch-output-not-observable-within-180s`
