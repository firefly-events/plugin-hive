# Horizontal Planning Scan — KG Signal Revival

**Epic:** kg-signal-revival
**Date:** 2026-05-13
**Author:** tpm (orchestrator-fallback render this session — codex writer unavailable)
**Inputs:** design-discussion.md v3 (§6 slice carving + §10 user decisions); tpm-brief-hv.md (orphan, broadly aligned); user gate decisions.

This is the breadth-first map. Every layer this epic touches; every concrete item per layer; cross-layer dependencies. Vertical-plan.md slices it.

---

## Pre-scan verifications (TPM-checked before scan; updated 2026-05-13 23:36 with user-provided paths)

- Shindig Mobile (`shindig`): REACHABLE at `/Users/don/Documents/KMP/Shindig` with `.pHive/cycle-state/` populated.
- Signal Flayr (`signal-flayr`): REACHABLE at `/Users/don/Documents/GitHub/ffe-social-engine` with 5 cycle-state epics.
- Nail Tech Assistant (`nail-tech-assistant`): REACHABLE at `/Users/don/Documents/GitHub/Nail Tech Assitant` (FS typo "Assitant") with 5 cycle-state epics. **Path contains a space — `/hive:register-project` must accept quoted paths.**

**Implication for S4:** All 4 v1 cross-project targets confirmed (plugin-hive already registered + shindig + signal-flayr + nail-tech-assistant). ~15 epic namespaces flow into plugin-hive KG via backfill. S4.4 + S4.5 upgrade from contingent stub-seed to real-import. No follow-on epic for path discovery needed.

---

## 1. Layer Inventory

8 architectural layers touched. Each layer's role and how this epic affects it.

| Layer | Current role | Affected this epic |
|---|---|---|
| **L1 — KG SQLite** (`~/.claude/hive/kg.sqlite`) | Stores predicate triples; `kg_write()` API; `idx_predicate` for query | Schema unchanged. Write volume grows ~10-100× via new emit sites. |
| **L2 — ChromaDB sidecar** (`hive/lib/chromadb-wrapper.js`) | Wrapper exists; never bootstrapped locally | New: sidecar auto-start script + SessionStart hook + collection bootstrap. |
| **L3 — Project registry** (`~/.claude/hive/projects.yaml`) | Currently 1 entry (plugin-hive) | Schema unchanged; new `/hive:register-project` skill; **3 new project rows** (shindig, signal-flayr, nail-tech-assistant — all real-import). |
| **L4 — Workflow seam emitters** (agent personas, skills, workflow steps) | Currently only `decided` predicate emitted from select sites | New emit calls at 5-8 seams covering 3 priority predicates. |
| **L5 — dag_executor** (`hive/lib/dag-executor/`) | Walks story DAG; emits step-complete/fail events | New: emit `phase_failed` on fail path, `phase_blocked` on upstream-skip, write-rate counter. |
| **L6 — `/meta-optimize` step-02c** (`hive/skills/meta-optimize/step-02c-kg-signal.md`) | Queries `phase_failed`/`phase_blocked`/`superseded`; emits findings; routed by step-03 | Unchanged read path. Add reason-discriminator field surface (for L8 miss-reason taxonomy) if missing. |
| **L7 — `/hive:why` retrospection UX** (does not exist) | — | New: slash command at `hive/skills/why/` wrapping `MemoryStore.query_decisions()`. |
| **L8 — Telemetry** (`metric_registry.py` + `.pHive/metrics/kg/`) | `decided` count tracked sporadically | New: write-rate counter, hit-rate gauge, miss-reason taxonomy, cycle rollup, raw JSONL audit trail. |

---

## 2. Per-Layer Requirements

Exhaustive per-layer enumeration. Items concrete (named file/symbol/predicate/script).

### Layer L1 — KG SQLite (`~/.claude/hive/kg.sqlite`)

```
SCHEMA CHANGES:
  - None required. Predicate vocabulary frozen at 9 entries (3 priority + 5 secondary + decided).

WRITE-PATH CHANGES:
  - kg_write() signature unchanged.
  - Add write-rate observability hook (one-line counter inside kg_write or at every call site).

READ-PATH CHANGES:
  - None. step-02c queries unchanged.

DOCUMENTATION:
  - hive/references/kg-schema.md — document the 3 priority predicates' subject/object semantics for emit-site authors.

OPS:
  - Backup ~/.claude/hive/kg.sqlite before any backfill --apply run (script-enforced).
```

### Layer L2 — ChromaDB sidecar (`hive/lib/chromadb-wrapper.js` + new ops scripts)

```
NEW SCRIPTS:
  - hive/scripts/chromadb-start.sh — pidfile + lockfile + ephemeral port selection.
  - hive/scripts/chromadb-stop.sh — graceful shutdown.
  - hive/scripts/chromadb-status.sh — health check / port lookup.

NEW HOOKS:
  - SessionStart hook entry: invoke chromadb-start.sh iff wrapper.isAvailable() === false.

NEW STATE FILES:
  - ~/.claude/hive/chromadb.pid (lifecycle)
  - ~/.claude/hive/chromadb.port (ephemeral port record for wrapper)
  - ~/.claude/hive/chromadb.lock (single-instance enforcement)

WRAPPER UPDATES:
  - chromadb-wrapper.js: read port from ~/.claude/hive/chromadb.port instead of hardcoded :8000.
  - chromadb-wrapper.js: isAvailable() with 1s timeout for hook fast-path.

COLLECTION BOOTSTRAP:
  - On first hook invocation: create "decisions" collection if absent.
  - Schema fields: id, document (decision text), metadata { topic, decision_key, decided_at, project, agent }.
```

### Layer L3 — Project registry (`~/.claude/hive/projects.yaml`)

```
SCHEMA:
  - Existing fields preserved: path, name.
  - Optional new field: registered_at (ISO 8601 timestamp).

NEW SKILL:
  - hive/skills/register-project/SKILL.md — `/hive:register-project <path> [--name X]`.
  - Validates path exists + has .pHive/ + appends to projects.yaml.

NEW SCRIPT (DAG companion):
  - scripts/kg-bootstrap-from-projects.js — already exists; add --since flag + --dry-run flag.

POPULATED PROJECTS (v1):
  - plugin-hive (already there)
  - Shindig Mobile (verified reachable at /Users/don/Documents/KMP/Shindig)
  - Signal Flayr (CONTINGENT — stub-seed if filesystem unreachable)
  - Tech Assistant (CONTINGENT — stub-seed if filesystem unreachable)
```

### Layer L4 — Workflow seam emitters (agent personas, skills, workflow steps)

```
EMIT SITES (3 priority predicates × seam locations):

phase_failed:
  - hive/lib/dag-executor/walker.js — emit on step.fail()
  - hive/agents/reviewer.md (review step) — emit on reject verdict
  - circuit-breaker trip site (TBD location at H/V) — emit on trip

phase_blocked:
  - hive/lib/dag-executor/walker.js — emit on upstream-skip (predecessor failed)
  - hive/agents/tpm.md (escalation flag raised) — emit on escalation
  - waiting-on-user gate sites (orchestrator) — emit on gate-open

superseded:
  - hive/skills/plan/ — emit on /plan overwrite of prior story YAML
  - hive/skills/meta-optimize/ — emit on proposal replacement
  - insight-promotion script (TBD) — emit on memory replacement

GRANULARITY KNOB:
  - hive.config.yaml — new key emit_lifecycle_at ∈ {phase, story, step, off}, default "phase".
  - All seams above read this knob; emit only when current granularity >= configured value.
  - "off" disables all lifecycle emissions (kill switch); priority + decided still fire from other sites.

SECONDARY PREDICATES (5 — phase_started, phase_complete, assigned_to, blocked_by, depends_on):
  - Emit sites enumerated in L4 but CONDITIONAL — wired iff Act III S6 /hive:why surface design requires them.
  - phase_started/phase_complete: dag-executor walker (phase entry/exit)
  - assigned_to: TaskUpdate(owner=X) hook in orchestrator + spawn-time
  - blocked_by/depends_on: /plan epic.yaml ingest at planning-complete
```

### Layer L5 — dag_executor (`hive/lib/dag-executor/`)

```
NEW EMITS:
  - walker.js: phase_failed on step.fail()
  - walker.js: phase_blocked on upstream-skip
  - walker.js: phase_started / phase_complete (conditional on emit_lifecycle_at >= "phase")

WRITE-RATE COUNTER:
  - One-line counter increment alongside each kg_write() call.
  - Counter: kg_signal_revival.write_rate (cycles_metric_registry).
  - Per-call OR batched at session-end (decision: per-call, simpler).

CHANGES TO walker.js INTERFACE:
  - Add emit_kg_event(subject, predicate, object, source_epic) helper invoked from fail/block paths.
  - Helper internally enforces emit_lifecycle_at gate.
```

### Layer L6 — `/meta-optimize` step-02c

```
READ PATH (unchanged):
  - Queries: phase_failed, phase_blocked, superseded predicates.
  - Recency window: confirm in code at B2 (currently believed to be 30 days; align backfill --since default to match).

MISS-REASON DISCRIMINATOR SURFACE (potentially new):
  - step-02c must expose enough state for L8 telemetry to distinguish:
    empty_kg | empty_predicate_filter | recency_cutoff | project_tag_cutoff | dedup_eviction
  - Verify at B2 H/V whether step-02c's output already differentiates these OR a thin observability shim is needed.

HIT-RATE JOIN SITE (open):
  - hit_rate(N) = cycles_with ≥1 kg_signal_proposal merged into pool / cycles_in_window(N)
  - Requires step-02c output JOINED with step-03 merge data.
  - Resolution at H/V: either add counter at step-03 merge OR add synthesis pass at session-end joining the two.
```

### Layer L7 — `/hive:why` retrospection UX (new)

```
NEW SKILL:
  - hive/skills/why/SKILL.md — `/hive:why <topic>`.
  - Input: free-text topic.
  - Output: ranked list of decision triples + provenance (which agent, when, cycle/epic context, ChromaDB-supplied related decisions).

UNDERLYING APIS:
  - MemoryStore.query_decisions(topic) — exists or to be added (TBD at B2; existing call path likely already wired).
  - ChromaDB collection "decisions" — semantic-similarity neighborhood expansion.
  - kg.sqlite — exact-match predicate lookup for "decided" and "superseded" by decision_key.

SECONDARY-PREDICATE TRIGGER:
  - If /hive:why surface design needs phase_started/phase_complete/etc to show timeline → wire those secondaries.
  - If surface is purely decision-listing → secondaries stay deferred.

PLANNING-SKILL HELPER:
  - hive/skills/plan/step-XX-prior-decisions.md (TBD position) — inline pull of relevant prior decisions.
  - Optional; ships in S6 if scope permits.
```

### Layer L8 — Telemetry (`metric_registry.py` + `.pHive/metrics/kg/`)

```
COUNTERS (metric_registry.py extension):
  - kg_signal_revival.write_rate — total triples written per cycle (lands EARLY in S1 per TPM tightening).
  - kg_signal_revival.write_rate_by_predicate — per-predicate count.
  - kg_signal_revival.hit_rate — see L6 hit-rate join site.
  - kg_signal_revival.miss_reason_count{reason} — per-miss-reason counter, 5 reasons.

RAW AUDIT TRAIL:
  - .pHive/metrics/kg/{cycle-id}.jsonl — one line per kg_write event with subject/predicate/object/timestamp.
  - Companion to counters; raw for forensic queries.

CYCLE ROLLUP:
  - At /meta-optimize retrospect step: emit summary line "kg_signal hit rate over last 5 cycles: X%".
  - Surfaces in cycle report output.

SUCCESS-METRIC ASSERTION:
  - End-of-epic check (per locked-decision #4, §10): assert kg_signal_revival.hit_rate has been ≥1 in ANY of last 5 cycles.
```

---

## 3. Cross-Layer Dependencies

These determine where vertical slices can cut.

```
DEPENDENCIES:

L4 emit sites → L1 kg_write API
  Every emit-site requires kg_write() unchanged + predicate canon frozen.

L4 emit sites → hive.config.yaml emit_lifecycle_at knob
  All emit sites must honor the scalar knob; knob ships in S1 (foundation) before S2 (fanout).

L4 → L1 write-rate counter
  Counter must be reachable from every kg_write() call site. Lands in S1 alongside first emit-site.

L5 dag_executor → L4 emit sites
  walker.js is one of the L4 emit sites; same file.

L6 step-02c → L1 triples
  step-02c reads kg.sqlite directly; depends on L4 having emitted ≥1 triple in priority predicates for hit-rate to flip non-zero.

L6 step-02c → L3 project registry
  step-02c filters/penalty by project tag; depends on L3 schema unchanged + projects present.

L7 /hive:why → L1 + L2 + L8
  Slash command queries kg.sqlite (exact) + ChromaDB "decisions" collection (similarity) + telemetry counters (provenance).
  Depends on S3 (Chroma collection bootstrapped) + Act I (priority predicates emitting) + S5 (counters live).

L2 ChromaDB bootstrap → SessionStart hook
  Sidecar starts on session entry; requires hook registration BEFORE wrapper is invoked.
  Hook depends on chromadb-start.sh existing.

L3 registry expansion → L6 cross-project rank penalty
  Adding 2nd/3rd project activates the existing rank penalty in step-02c.
  Penalty is in code already; expansion makes it observable.

L3 + L1 backfill → kg-bootstrap-from-projects.js --since flag
  Backfill of historical decisions from a newly-registered project depends on the --since flag landing first.

L8 hit-rate counter → L6 step-02c output + step-03 merge data
  Hit-rate requires joining the two. Join site to be named at H/V (counter at step-03 merge OR synthesis pass at session-end).

L8 miss-reason taxonomy → L6 step-02c reason-discriminator surface
  Differentiating empty_kg / empty_predicate_filter / recency_cutoff requires step-02c expose enough state.
  Verified or thin-shim added in S5.

S7 (kg-augmented-meta-signal outcome metric) → L1 priority predicates emitting
  S7's SELECT COUNT(*) WHERE predicate IN ('phase_failed','phase_blocked','superseded') > 0 verifies after Act I S1+S2 ship.
  Acts as Act I exit gate, not a story (per §10 decision #7).
```

---

## 4. Layer Map Diagram

ASCII visual. Layers (rows) × items (columns within row). The vertical-plan overlays slice boundaries onto this canvas.

```
HORIZONTAL LAYER MAP — kg-signal-revival
══════════════════════════════════════════════════════════════════════════════════════

L1 KG SQLite  │ predicate canon │ kg_write() API │ idx_predicate │ schema docs  │
              │ (frozen, 9)     │ (unchanged)    │ (read perf)   │ (new ref)    │
──────────────┼─────────────────┼────────────────┼───────────────┼──────────────┤
L2 ChromaDB   │ chromadb-       │ SessionStart   │ wrapper port  │ "decisions"  │
              │  start.sh (new) │  hook (new)    │ lookup (mod)  │ collection   │
──────────────┼─────────────────┼────────────────┼───────────────┼──────────────┤
L3 Registry   │ projects.yaml   │ /hive:register-│ +Shindig      │ stub-seed    │
              │  (schema same)  │  project skill │ (S Flayr +TA  │  fallback    │
              │                 │  (new)         │  contingent)  │  policy      │
──────────────┼─────────────────┼────────────────┼───────────────┼──────────────┤
L4 Emit sites │ phase_failed    │ phase_blocked  │ superseded    │ emit_life-   │
              │  (3 sites)      │  (3 sites)     │  (3 sites)    │  cycle_at    │
              │                 │                │               │  knob (new)  │
──────────────┼─────────────────┼────────────────┼───────────────┼──────────────┤
L5 dag_       │ walker.js       │ walker.js      │ walker.js     │ write-rate   │
   executor   │  fail path      │  upstream-skip │  emit helper  │  counter hook│
──────────────┼─────────────────┼────────────────┼───────────────┼──────────────┤
L6 step-02c   │ read path       │ recency win    │ reason-       │ hit-rate     │
              │  (unchanged)    │  (confirm/align│  discrim      │  join site   │
              │                 │   --since)     │  (verify)     │  (resolve)   │
──────────────┼─────────────────┼────────────────┼───────────────┼──────────────┤
L7 /hive:why  │ skill file      │ query backend  │ Chroma similar│ planning-    │
              │  (new)          │  (MemoryStore) │  -ity expand  │  skill helper│
──────────────┼─────────────────┼────────────────┼───────────────┼──────────────┤
L8 Telemetry  │ write_rate ctr  │ hit_rate gauge │ miss_reason   │ cycle rollup │
              │  (early, S1)    │  (S5)          │  taxonomy(S5) │  + JSONL     │
══════════════════════════════════════════════════════════════════════════════════════
```

---

## 5. Scope Summary

```
HORIZONTAL SCOPE — kg-signal-revival:

  Layers affected: 8 (L1-L8)
  Total items: ~32 named (predicates × emit sites + scripts + hooks + skills + counters)
  New vs modified: ~22 new, ~10 modified
  Estimated total effort: LARGE (confirmed §8 design discussion)

  LARGEST LAYER: L4 (workflow seam emitters) — 9-12 emit sites across 3 priority predicates,
                 plus 5 secondary predicates conditional on L7 surface design.

  RISKIEST LAYER: L1 (KG SQLite) — write volume could grow 10-100×; idx_predicate hot-path
                  read performance is the R1 over-emission risk. Mitigated by
                  emit_lifecycle_at scalar knob + early write-rate counter +
                  performance:audit specialist escalation (pre-exec).

  SECOND-RISKIEST: L2 (ChromaDB) — sidecar lifecycle has pidfile/lockfile/port management
                   complexity new to the project. Mitigated by isAvailable() fast-path +
                   ephemeral port + SessionStart skip-if-already-up.

  WIDEST DEPENDENCY FAN-IN: L8 (telemetry) — depends on L1, L4, L5, L6 outputs.
                            Lands in S5 (single slice) but reads from every prior slice.

  NARROWEST DEPENDENCY: L3 (registry) — independent of L1/L2 emit/persist work;
                       parallelizable with Act I.
```

---

## 6. Layer-by-layer notes for the V-plan to lean on

- **L1 is unchanged structurally.** All risk is at write-volume, not schema. This is why R1 mitigations land in the V-plan's first emit slice (S1) and not in a foundational L1 slice — there's no L1 work to put in a foundation slice.
- **L2 is a clean subsystem.** Bootstrap can ship as a single slice with no L4 dependency; it can also be deferred behind Act I if needed (S6 /hive:why is the only consumer that needs L2 hot).
- **L3 + L4 + L5 ARE the same write-side wiring.** Splitting them across multiple slices is the natural emit-fanout sequence (S1 thin → S2 broad).
- **L6 is read-only this epic.** Don't touch step-02c logic. If the reason-discriminator field isn't exposed, add a shim in S5 — not in L6 itself.
- **L7 is the entire Act III user value.** It pulls from every other layer. It must come last.
- **L8 anchors the success metric.** Without it, we can't verify the success criteria from §10 decision #4 ("any non-zero hit in next 5 cycles"). S5 is non-negotiable in the min-viable-ship cut.

---

## 7. What this scan deliberately does NOT do

- Does not propose execution order (vertical-plan.md does).
- Does not assign stories to slices (that's structured-outline phase).
- Does not specify file-by-file diff manifests (that's per-story spec).
- Does not declare which secondary predicates wire — that's deferred to S6 design (L7).
