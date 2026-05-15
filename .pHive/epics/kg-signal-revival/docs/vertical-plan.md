# Vertical Slice Plan — KG Signal Revival

**Epic:** kg-signal-revival
**Date:** 2026-05-13
**Author:** tpm (orchestrator-fallback render this session)
**Inputs:** horizontal-plan.md, design-discussion.md v3 (§6 + §10), tpm-brief-hv.md (orphan, broadly aligned).

This document slices the horizontal layer map into incremental, working-state increments. Each slice leaves the product in a verifiable working state; the slice that introduces a bug is the slice the bug came from.

---

## 1. Slicing Strategy

```
STRATEGY:
  Total horizontal items: ~32 named
  Planned slices: 7 (B0 + S1..S6)
  First slice goal: Consumer contract (B0) — emit-side schema work has a target.
  Final slice goal: /hive:why retrospection UX live, all three north-stars deliverable.

  Slicing rationale:
    The epic spans 4 architectural subsystems (Emit / Persist / Reference / Consume).
    Subsystem seams drive slice boundaries. B0 sliver is mandatory because consumer
    (meta-optimize + retrospection UX) shapes which predicates carry; without B0 we
    risk re-emitting later. After B0, S1 ships the thinnest emit foundation (one
    seam, one predicate, plus the kill-switch knob and write-rate counter). S2 fans
    out the remaining priority predicates. S3 + S4 run in parallel — different
    subsystems, no shared files. S5 lands telemetry and closes the success-metric
    loop. S6 lights up the retrospection UX last.
```

**Epic classification:** Config / routing / instrumentation epic with one secondary runtime-behavior layer (S5 hit-rate counter observably changes /meta-optimize output).

**Working-state reading:** **Pragmatic** at all slice boundaries except S5 (strict for the meta-optimize observable change). Each slice ships a coherent inspectable increment; nothing leaves half-wiring dangling.

**Slice count vs subsystem cardinality:** 4 subsystems × the natural emit-foundation/emit-fanout split = 5 functional slices (S1 + S2 + S3 + S4 + S5) plus B0 (consumer contract) and S6 (retro UX). 7 total matches §6 design-discussion proposal exactly.

---

## 2. Vertical Slice Plan

### Slice B0 — Consumer-contract sliver (docs-only)

```
WHAT WORKS AFTER THIS STEP:
  Two consumer-contract documents exist on disk. For every silent predicate, a
  named consumer is recorded (or it's explicitly deferred). For the Persist /
  Reference / Telemetry subsystems, their data contracts are documented before
  emit-side work begins. Reviewers reading the contracts can validate that S1's
  predicate semantics, S3's ChromaDB collection schema, S4's registry row shape,
  and S5's telemetry envelope all answer the consumer queries named here.

LAYERS TOUCHED:
  - .pHive/epics/kg-signal-revival/docs/ (B0.1 and B0.2 docs only)

NOT YET:
  - Any code, config, or runtime change.

VERIFIED BY:
  - Review: TPM + architect confirm the two contract docs are complete (every
    priority predicate has a consumer; every L8 counter field is named).
  - Spot check: each subsequent slice references B0 by section number when
    introducing its data shape.

COMMIT REPRESENTS: docs(kg-signal-revival): B0 consumer-contract sliver
```

Stories in this slice: ~1-2
- B0.1: `consumer-contracts-predicates.md` — for each predicate (priority 3 + secondary 5), name the consumer query that needs it, or mark as deferred.
- B0.2: `consumer-contracts-storage-telemetry.md` — registry row shape, ChromaDB "decisions" collection metadata, hit-rate counter envelope, miss-reason taxonomy fields.

OR collapse into a single B0 story if it stays under ~100 lines.

---

### Slice S1 — Emit foundation + thin proof (`phase_failed` at one seam)

```
BUILDS ON: B0

WHAT WORKS AFTER THIS STEP:
  The system emits one priority predicate (phase_failed) from one seam
  (dag_executor walker fail path). hive.config.yaml ships the
  emit_lifecycle_at scalar knob ({phase, story, step, off}, default "phase").
  Every kg_write() call also increments a write-rate counter. When a story
  step fails in a real cycle, ~/.claude/hive/kg.sqlite gains a triple. The
  S7 Act I exit gate query starts returning > 0 in a controlled test.

LAYERS TOUCHED:
  - L1 KG SQLite: documentation update (hive/references/kg-schema.md priority
    predicates section).
  - L4 emit sites: emit_kg_event() helper in dag-executor; phase_failed wired
    at walker.js fail path only.
  - L5 dag_executor: walker.js fail path emits phase_failed.
  - hive.config.yaml: new emit_lifecycle_at scalar key, default "phase".
  - L8 telemetry: write_rate counter alongside every kg_write() call site
    (NOT the named hit-rate counter — that's S5).

NOT YET:
  - phase_blocked, superseded (S2).
  - reviewer reject / circuit-breaker / TPM-escalation emit sites (S2).
  - ChromaDB (S3), registry expansion (S4), full telemetry (S5),
    /hive:why UX (S6).

VERIFIED BY:
  - Unit test: walker.js fail path calls emit_kg_event() with phase_failed.
  - Integration: trigger a deliberate story-step failure in a fixture cycle;
    confirm phase_failed triple lands in kg.sqlite.
  - Integration: set emit_lifecycle_at = "off" in hive.config.yaml; confirm
    emit suppressed and write_rate counter does not increment.
  - Manual: write_rate counter visible in metric registry output after one
    cycle.

COMMIT REPRESENTS: feat(kg-signal): emit_kg_event helper + phase_failed at fail path + lifecycle knob + write-rate counter
```

Stories in this slice: ~2
- S1.1: `emit-helper-and-lifecycle-knob` — helper + hive.config.yaml knob + write-rate counter.
- S1.2: `phase-failed-at-fail-path` — walker.js fail-path emit.

---

### Slice S2 — Priority predicate fanout (`phase_blocked`, `superseded`)

```
BUILDS ON: S1

WHAT WORKS AFTER THIS STEP:
  All three priority predicates emit from all named seams. phase_blocked fires
  on upstream-skip in dag_executor + on TPM escalation flag-raise + at
  waiting-on-user gates. superseded fires on /plan story overwrite + on
  meta-optimize proposal replacement + on insight promotion replacing memory.
  The S7 Act I exit gate query against production kg.sqlite returns > 0
  after a normal cycle (closes loop on the prior epic's outcome metric).

LAYERS TOUCHED:
  - L4 emit sites:
    - phase_blocked: walker.js upstream-skip; tpm.md escalation site;
      orchestrator waiting-on-user gate site.
    - superseded: /plan overwrite site; /meta-optimize replacement site;
      insight-promotion site.
  - L5 dag_executor: walker.js upstream-skip emit.

NOT YET:
  - Secondary predicates (S6, conditional).
  - ChromaDB bootstrap (S3).
  - Registry expansion (S4).
  - Telemetry counters beyond write-rate (S5).
  - /hive:why UX (S6).

VERIFIED BY:
  - Unit: each new emit site has a test confirming the helper is called with
    the correct subject/predicate/object.
  - Integration: trigger an upstream-skip in a fixture DAG; confirm
    phase_blocked lands. Trigger a /plan overwrite of a prior story; confirm
    superseded lands.
  - Production verification (S7 Act I exit gate):
      SELECT COUNT(*) FROM triples
       WHERE predicate IN ('phase_failed','phase_blocked','superseded');
    must return > 0 after one normal /meta-optimize cycle on plugin-hive
    (records that the prior epic's outcome metric has flipped).
  - Write-rate counter sanity: confirm cycle-level write_rate counter is
    within the projected envelope (R1 detection window).

COMMIT REPRESENTS: feat(kg-signal): wire phase_blocked + superseded at all priority emit seams
```

Stories in this slice: ~2-3
- S2.1: `phase-blocked-emit-sites` — three sites.
- S2.2: `superseded-emit-sites` — three sites.
- S2.3 (optional): `act-i-exit-gate-verification` — automation around the S7 SELECT query as a check.

---

### Slice S3 — ChromaDB sidecar bootstrap (parallel with S4)

```
BUILDS ON: S1 (only for the metric registry pattern; otherwise independent).
PARALLEL WITH: S4

WHAT WORKS AFTER THIS STEP:
  chromadb-start.sh starts the sidecar on session entry via SessionStart hook.
  Wrapper reads ephemeral port from ~/.claude/hive/chromadb.port. isAvailable()
  fast-paths the hook to skip start if already running. The "decisions"
  collection is bootstrapped with the schema from B0.2. A test harness can
  write a sample decision document and retrieve it by similarity.

LAYERS TOUCHED:
  - L2 ChromaDB: chromadb-start.sh, chromadb-stop.sh, chromadb-status.sh; new
    SessionStart hook entry; ~/.claude/hive/chromadb.{pid,port,lock} state
    files; wrapper port-lookup update; collection bootstrap on first
    invocation.

NOT YET:
  - Population of the "decisions" collection (S5 + S6 add producers).
  - /hive:why reads from the collection (S6).

VERIFIED BY:
  - Integration: launch a fresh shell; SessionStart hook starts sidecar;
    wrapper.isAvailable() returns true; subsequent shells skip start.
  - Integration: kill the sidecar; SessionStart hook on next session
    restarts it; pidfile + port are coherent after restart.
  - Functional: test harness writes one document to "decisions"; queries by
    similarity; retrieves it.
  - Negative: launch two shells in rapid succession; lockfile prevents
    double-start; second shell observes the existing sidecar.

COMMIT REPRESENTS: feat(chromadb): sidecar bootstrap + SessionStart hook + decisions collection
```

Stories in this slice: ~2
- S3.1: `sidecar-lifecycle-scripts` — start/stop/status + state files + lockfile.
- S3.2: `wrapper-port-lookup-and-collection-bootstrap` — wrapper update + decisions-collection init on first use.

---

### Slice S4 — Multi-project registry expansion (parallel with S3)

```
BUILDS ON: S1
PARALLEL WITH: S3

WHAT WORKS AFTER THIS STEP:
  /hive:register-project skill exists and registers a new project into
  ~/.claude/hive/projects.yaml after validating the path has a .pHive/
  directory + handling quoted/spaced paths. kg-bootstrap-from-projects.js
  has --since and --dry-run flags. THREE projects registered as real-imports
  (shindig + signal-flayr + nail-tech-assistant). Backfill runs import each
  project's last-90-days (or predicate-canon-date) decision history into
  kg.sqlite (after dry-run preview). The cross-project rank penalty in
  step-02c starts firing with a real ~15-epic-namespace cross-project corpus
  to penalize.

LAYERS TOUCHED:
  - L3 registry: /hive:register-project skill (handles quoted/spaced paths);
    3 projects.yaml entries.
  - L1 KG SQLite: backfill via kg-bootstrap-from-projects.js (write-only,
    no schema change). ~15 epic namespaces.
  - L6 step-02c (read-only): cross-project rank penalty observable for first
    time.

PRE-SCAN UPDATE (2026-05-13 23:36):
  All three real-import targets confirmed by user-provided paths:
  - shindig             → /Users/don/Documents/KMP/Shindig
  - signal-flayr        → /Users/don/Documents/GitHub/ffe-social-engine
  - nail-tech-assistant → /Users/don/Documents/GitHub/Nail Tech Assitant (FS typo "Assitant" — has SPACE)
  No stub-seed fallback needed; no follow-on epic for path discovery.

NOT YET:
  - Telemetry on cross-project hit-rate (S5).
  - /hive:why surfacing cross-project decisions (S6 — depends on S3 also).

VERIFIED BY:
  - Functional: /hive:register-project <path> appends a new row to
    projects.yaml; rejects non-existent paths; rejects paths missing .pHive/.
  - Functional: kg-bootstrap-from-projects.js --since 2026-02-14 --dry-run
    prints a diff preview; --apply commits the import.
  - Integration: after Shindig registration + backfill, run a /meta-optimize
    cycle on plugin-hive; confirm step-02c emits ≥1 finding whose proposal
    description includes [cross-project: shindig] hard tag.
  - Negative: backfill with invalid --since date errors with clear message;
    no partial writes.

COMMIT REPRESENTS: feat(registry): /hive:register-project skill + bootstrap --since/--dry-run + 3 real-import onboardings
```

Stories in this slice: ~4-5
- S4.1: `register-project-skill` — new skill file + projects.yaml validation + quoted-path/space handling.
- S4.2: `bootstrap-since-and-dry-run` — script flags.
- S4.3: `shindig-onboarding-and-backfill` — real-import for Shindig.
- S4.4: `signal-flayr-onboarding-and-backfill` — real-import for Signal Flayr (`/Users/don/Documents/GitHub/ffe-social-engine`).
- S4.5: `nail-tech-assistant-onboarding-and-backfill` — real-import for NTA (`/Users/don/Documents/GitHub/Nail Tech Assitant` — path has space). Could collapse with S4.3/S4.4 into a parameterized "onboard-and-backfill" story repeated 3× if writer prefers compaction at Phase C.

---

### Slice S5 — Telemetry + miss-reason taxonomy + cycle rollup

```
BUILDS ON: S1, S2 (needs writes happening), S3 (Chroma optional but lands first),
           S4 (registry produces cross-project data points)

WHAT WORKS AFTER THIS STEP:
  metric_registry.py exposes named counters (hit_rate gauge, miss_reason
  counters by taxonomy bucket, per-predicate write counters). /meta-optimize
  retrospect step pulls cycle-rollup numbers. .pHive/metrics/kg/{cycle-id}.jsonl
  raw audit trail records every kg_write event. The user-locked success
  metric ("any non-zero hit in next 5 cycles") is assertable from registry
  data without manual SQL.

LAYERS TOUCHED:
  - L8 telemetry: metric_registry.py extensions; .pHive/metrics/kg/ JSONL writer.
  - L6 step-02c (verified or shim'd): reason-discriminator surface exposed
    to L8 callers.
  - hive/skills/meta-optimize/step-XX-cycle-rollup.md: emit cycle-rollup
    summary line in cycle report.

CLASSIFICATION:
  - STRICT working-state slice. Observable runtime change in /meta-optimize
    output (cycle report now includes hit-rate line).

NOT YET:
  - /hive:why retrospection UX (S6).
  - Dashboard or visualization beyond cycle-report line.

VERIFIED BY:
  - Unit: hit_rate gauge computation given (step-02c output, step-03 merge
    output) joins to correct value.
  - Unit: each of 5 miss-reason buckets is reachable by some fixture
    cycle-state.
  - Integration: run a fixture cycle that hits each miss-reason; confirm
    counters increment.
  - Integration: run a cycle that produces ≥1 kg_signal proposal merged
    into step-03 pool; confirm hit_rate increments.
  - Functional: cycle report includes "kg_signal hit rate over last 5 cycles"
    line.
  - Success-metric check: scripted assertion that hit_rate ≥1 in any of
    the last 5 cycles passes after a deliberate trigger cycle.

OPEN QUESTIONS RESOLVED HERE:
  - Hit-rate join site: counter at step-03 merge (current proposal) OR
    session-end synthesis pass joining step-02c output with step-03 proposal
    pool. Decision to be made at S5 implementation — recommendation:
    counter at step-03 merge if the merge step exposes the necessary
    discrimination; else session-end synthesis.
  - Miss-reason discriminator: verify step-02c exposes enough state at S5
    inspection; if not, add thin observability shim in step-02c output
    (not in step-02c logic).

COMMIT REPRESENTS: feat(telemetry): hit-rate + miss-reason + cycle rollup + raw JSONL audit trail
```

Stories in this slice: ~2-3
- S5.1: `metric-registry-counters-and-gauges` — counter/gauge definitions.
- S5.2: `miss-reason-discriminator-and-shim` — exposure work at step-02c output if needed.
- S5.3: `cycle-rollup-line-in-meta-optimize-report` — report line + JSONL audit trail.

---

### Slice S6 — `/hive:why` retrospection UX + secondary predicates (conditional)

```
BUILDS ON: S3 (Chroma "decisions" populated), S5 (telemetry counters live),
           and Act I (priority predicates emitting).

WHAT WORKS AFTER THIS STEP:
  /hive:why <topic> returns ranked decision triples with provenance. Triples
  are joined from kg.sqlite (exact match on decided/superseded) + ChromaDB
  similarity expansion + telemetry counters (cycle-context provenance).
  Audit-trail north-star is shippable.

  Secondary predicates are wired iff /hive:why's surface design requires
  them (e.g., showing timeline needs phase_started/phase_complete; showing
  agent attribution needs assigned_to).

LAYERS TOUCHED:
  - L7 /hive:why: new skill file at hive/skills/why/SKILL.md.
  - L1 kg.sqlite: read-only.
  - L2 ChromaDB: read-only against "decisions" collection.
  - L8 telemetry: read provenance.
  - L4 emit sites (CONDITIONAL): secondary predicates wired if UX surface
    needs them.

NOT YET:
  - Visualization (graph view / timeline view) — out of scope per §5.
  - Semantic search beyond bootstrap — out of scope per §5.
  - Predicate vocabulary expansion — out of scope per §5.

VERIFIED BY:
  - Functional: /hive:why "specialist triggers" returns ≥1 decision triple
    from prior planning cycles related to that topic, with provenance.
  - Functional: /hive:why returns "no decisions recorded" gracefully when
    topic has no matches.
  - Integration: query that hits both kg.sqlite (exact) and ChromaDB
    (similarity) merges results without duplicate fragments.
  - Acceptance: user confirms output format meets audit-trail north-star
    target (100% of in-window decisions return ≥1 triple).

OPEN AT START OF S6:
  - Surface design decides whether secondary predicates wire here. The 5
    secondary candidates: phase_started, phase_complete, assigned_to,
    blocked_by, depends_on.
  - If UX shows decision timeline → wire phase_started/phase_complete.
  - If UX shows attribution → wire assigned_to.
  - If UX cross-links story dependencies → wire blocked_by/depends_on.
  - Anti-pattern: wire all 5 without consumer.

COMMIT REPRESENTS: feat(why): /hive:why retrospection UX + conditional secondary predicates
```

Stories in this slice: ~2-3
- S6.1: `hive-why-skill-and-query-backend` — slash command + MemoryStore query path + result merging.
- S6.2: `secondary-predicates-conditional-wiring` — emit sites for the secondaries the UX needs.
- S6.3 (optional): `planning-skill-prior-decisions-helper` — inline pull during /plan.

---

## 3. Overlay Diagram

```
VERTICAL SLICE OVERLAY — kg-signal-revival
══════════════════════════════════════════════════════════════════════════════════════════════

                 │  B0      │  S1       │  S2       │  S3        │  S4        │  S5       │  S6       │
                 │ docs     │ emit-base │ emit-fan  │ chroma     │ registry   │ telemetry │ retro UX  │
                 │          │           │           │ (∥ S4)     │ (∥ S3)     │           │           │
─────────────────┼──────────┼───────────┼───────────┼────────────┼────────────┼───────────┼───────────┤
L1 KG SQLite     │ contracts│ schema doc│           │            │ backfill   │           │ read only │
                 │          │           │           │            │            │           │           │
─────────────────┼──────────┼───────────┼───────────┼────────────┼────────────┼───────────┼───────────┤
L2 ChromaDB     │ collection│           │           │ bootstrap  │            │           │ read only │
                 │ schema   │           │           │ hook+wrap  │            │           │           │
─────────────────┼──────────┼───────────┼───────────┼────────────┼────────────┼───────────┼───────────┤
L3 Registry      │ row shape│           │           │            │ skill+pop  │           │           │
                 │          │           │           │            │ (Shindig)  │           │           │
─────────────────┼──────────┼───────────┼───────────┼────────────┼────────────┼───────────┼───────────┤
L4 Emit sites   │ predicate│ phase_     │ phase_    │            │            │           │ secondary │
                 │ contracts│ failed×1  │ blocked×3 │            │            │           │ ×0..5     │
                 │          │ +knob     │ supersd×3 │            │            │           │ (cond.)   │
─────────────────┼──────────┼───────────┼───────────┼────────────┼────────────┼───────────┼───────────┤
L5 dag_executor  │          │ emit_kg_  │ upstream  │            │            │           │           │
                 │          │ event hlp │ skip emit │            │            │           │           │
                 │          │ fail path │           │            │            │           │           │
─────────────────┼──────────┼───────────┼───────────┼────────────┼────────────┼───────────┼───────────┤
L6 step-02c      │ recency  │           │ exit-gate │            │ cross-proj │ reason-   │           │
                 │ window   │           │ verify    │            │ penalty    │ discrim   │           │
                 │ confirm  │           │           │            │ observable │ verify    │           │
─────────────────┼──────────┼───────────┼───────────┼────────────┼────────────┼───────────┼───────────┤
L7 /hive:why     │ surface  │           │           │            │            │           │ skill +   │
                 │ contract │           │           │            │            │           │ backend   │
─────────────────┼──────────┼───────────┼───────────┼────────────┼────────────┼───────────┼───────────┤
L8 telemetry     │ counter  │ write-    │           │            │            │ counters  │ provenance│
                 │ envelope │ rate ctr  │           │            │            │ +rollup   │ read      │
                 │          │ (EARLY)   │           │            │            │ +JSONL    │           │
══════════════════════════════════════════════════════════════════════════════════════════════════════

Each column is a commit-worthy, working state.
∥ S3 and S4 are concurrent (different subsystems, no shared files).
```

---

## 4. Deferred Items

```
DEFERRED (not in current slice plan):

  - Predicate vocabulary expansion (e.g., discussed, escalated). Out of scope §5.
  - ChromaDB advanced search UX. Out of scope §5.
  - In-product visualization (graph view, timeline view). Out of scope §5.
  - Dreaming-replay activation. Out of scope §5.
  - Predicate emission from external systems (Linear, GitHub). Out of scope §5.
  - KG export to external graph DB. Out of scope §5.

CONTINGENT (in scope if pre-conditions hold):

  - Signal Flayr onboarding + backfill. Pre-condition: filesystem path
    confirmed reachable + .pHive/ initialized. If absent at S4 implementation,
    falls back to stub-seed OR follow-on epic.
  - Tech Assistant onboarding + backfill. Same pre-condition as Signal Flayr.
  - Secondary predicates (phase_started, phase_complete, assigned_to,
    blocked_by, depends_on). Pre-condition: /hive:why surface design at
    S6 requires them.

RATIONALE: These items either fall outside the three north-stars (out-of-
scope §5) OR depend on facts not yet confirmed (project paths, UX design).
Confirming or deferring at the relevant slice is cheaper than pre-deciding.
```

---

## 5. Risk by Slice

```
RISK PER SLICE:

  B0: Low. Docs only. Risk is "missed predicate consumer" — caught at S1/S2
      review when the emit site lacks a documented contract target.

  S1: Medium. First emit-site instrumentation. R1 (over-emission) risk
      materializes here as wrong granularity-knob default OR walker.js fail
      path called more often than expected. Mitigated by: emit_lifecycle_at
      defaults to "phase" not "step"; write-rate counter ships in S1 so we
      can detect early; performance:audit specialist input pre-exec.

  S2: Medium-Low. Mechanical replication of the S1 pattern. R1 manifestation
      detectable from S1's write-rate counter — if S1 cycle counts are
      benign, S2 fanout is safe. Risk: missed emit site for a predicate
      (caught by integration tests fixturing each emit case).

  S3: Medium. ChromaDB sidecar lifecycle (R2). Pidfile/lockfile/port race
      conditions are subtle. Mitigated by: ephemeral port + isAvailable()
      fast-path + lockfile single-instance + dedicated negative tests.
      Decoupled from Act I (∥ S4); S3 can land late if Chroma proves harder
      than expected without blocking S2 → S5.

  S4: Medium-High. Cross-project contamination (R3) + backfill pollution
      (R4). Mitigated by: hard [cross-project: <name>] tag in proposal
      descriptions; --since 90 days default backfill; --dry-run flag.
      security:plan-audit specialist input pre-exec adds boundary-semantics
      review. Path-reachability finding (Shindig only confirmed) reduces
      v1 surface from 3 projects to 1-2.

  S5: Medium. Hit-rate join site + miss-reason discriminator surface are
      open questions resolved at implementation. Mitigated by: scoped
      open-question doc surfaced in §2 S5; lands strict-reading slice so
      bug = bug here.

  S6: Medium. Cross-layer reads (L1+L2+L8) + secondary-predicate
      conditional wiring. Mitigated by: secondary predicates wired only if
      surface design requires; UX acceptance gate before launch.

CRITICAL PATH RISK FACTORS:
  - R1 (over-emission) is detected in S1 by write-rate counter. If S1
    cycle counts exceed envelope (~100-1000× growth from current 66
    triples in N cycles), pause S2 fanout and revisit granularity defaults
    OR call the "off" kill-switch.
  - R2 (Chroma lifecycle) is isolated to S3. If S3 proves intractable,
    S5+S6 do not block — telemetry and /hive:why can ship querying only
    kg.sqlite, with ChromaDB similarity expansion as a S6 stretch goal
    rather than a hard dependency.
  - S7 Act I exit gate is non-negotiable. If S1+S2 land and the gate query
    still returns 0, the epic has not delivered Act I value — investigate
    before proceeding to S3-S6.
```

---

## 6. Moldability Notes

**Min-viable-ship cut (named per `min-viable-ship-identification` memory):**

> **Cut = B0 + S1 + S2 + S5.** Delivers the planning-signal north-star
> independent of the other two. S3 (ChromaDB) and S6 (/hive:why) defer
> together — without S3 there's no similarity expansion for S6. S4
> (registry) defers without affecting the planning-signal north-star.

Per §10 user lock, the user has elected to keep S6 in the full epic to
deliver the audit-trail north-star. The min-ship cut remains B0+S1+S2+S5;
S6 stays in cut for the **audit-trail-included** epic version. If the epic
compresses mid-execution, drop order is:

1. Drop S4.4 (Signal Flayr / Tech Assistant stub-seed) — already contingent.
2. Drop S6 (audit-trail UX) — was second-to-last in pre-§10 cut; user
   elected to keep it but it's the heaviest drop-eligible slice if scope
   compresses.
3. Drop S3 (ChromaDB) — if dropped, S6 cannot ship and audit-trail north-star
   slips. Pairs with #2.
4. Drop S4.3 (Shindig real-import) — cross-project north-star slips to
   follow-on; epic still ships planning-signal and audit-trail.

**Slice reorderability:**

- B0 → S1 → S2 sequence is rigid (S1 ships emit-foundation; S2 fans out
  from it). Cannot swap.
- S3 and S4 are interchangeable order; both gate at Act II completion before
  S5 starts. Could be parallel-developed.
- S5 must come after S1+S2 (writes must exist for hit-rate to be non-zero).
  S5 could come before S3+S4 if hit-rate is bootstrapped against
  same-project signal only — but that lowers v1 value of the cross-project
  north-star.
- S6 must come last (depends on every prior slice).

**What might force re-plan:**

- R1 manifests at S1 in a way the granularity knob doesn't fix → re-plan
  S2 with a tighter emit pattern (e.g., sample-rate flag, not just
  granularity).
- S3 ChromaDB proves harder than expected → defer S3, replan S6 to be
  kg.sqlite-only.
- Hit-rate threshold of "any non-zero in 5 cycles" (§10 decision #4) turns
  out to be too aggressive for v1 timeline → discuss with user at S5;
  threshold is itself moldable, the epic is not.
- Tech Assistant + Signal Flayr remain unreachable at S4 → fall back to
  stub-seed OR move 3rd-project onboarding to follow-on epic; cross-project
  signal in v1 ships with 2 projects (plugin-hive + Shindig).

**What might add a slice:**

- If R1 specialist (performance:audit) recommends per-call batching or
  session-end queuing change, that becomes its own pre-S1 slice OR a story
  inside S1.
- If S5 implementation discovers step-02c does NOT expose enough state for
  miss-reason discrimination AND the shim approach is too invasive, an
  S5a "step-02c output observability" slice may emerge.

---

## 7. Cross-Cutting Concerns Per Slice

(Surface here so structured-outline doesn't miss them in story decomposition.)

```
PER-SLICE OBSERVABILITY:
  - Every slice that writes to kg.sqlite must increment write-rate counter (S1
    helper is the seam; every later emit site uses the helper).
  - Every slice that reads from kg.sqlite or ChromaDB should log a basic
    query envelope at debug level for forensics.

PER-SLICE FAILURE-MODE:
  - S1, S2: kg_write() failure must not break the workflow — log + continue.
  - S3: chromadb-start.sh failure must not block session launch — log + degrade.
  - S5: counter writes must not block /meta-optimize — async/best-effort.
  - S6: ChromaDB query timeout falls back to kg.sqlite-only results.

PER-SLICE ROLLBACK:
  - S1 + S2: emit_lifecycle_at = "off" is the soft rollback.
  - S3: stop sidecar + disable hook entry is the rollback.
  - S4: registry rows append-only; rollback = remove project row + revert
    backfill triples by import_run_id (added at bootstrap as audit field).
  - S5 + S6: counter / skill removable without state implications.

PER-SLICE BACKWARD COMPAT:
  - hive.config.yaml emit_lifecycle_at: missing → defaults to "phase" (this
    slice's default), not the prior absence-of-knob behavior.
  - kg-bootstrap-from-projects.js: pre-existing callers (CI?) — verify at
    S4 implementation; add --since flag default = unrestricted to preserve
    behavior.
```

---

## 8. Open Questions for Structured Outline Phase

Items the V-plan deferred to B3 because they require story-decomposition-level
detail:

1. **Hit-rate join site exact placement.** Per §2 S5 open question:
   counter at step-03 merge OR session-end synthesis. B3 spec decides; B2
   names the choice as a known open.
2. **Miss-reason discriminator surface.** Per §2 S5 open question: verify
   step-02c output exposes enough state at S5 implementation; if not, add
   shim. B3 spec writes the verify-or-shim story.
3. **S4 contingency resolution.** Path-reachability for Signal Flayr + Tech
   Assistant: stub-seed in v1 or defer entirely? B3 phase makes the call,
   probably with user input.
4. **Secondary predicate wiring count.** Determined by S6 UX surface design.
   B3 may need to leave S6 sub-stories provisional or defer their
   decomposition to S6 implementation.
5. **Backfill --since default value.** §6 placeholder is 90 days; B3
   confirms step-02c lookback in code and aligns. If step-02c lookback >
   90 days, raise the default.

---

## 9. Mapping to S7 (prior epic outcome metric)

Per §10 decision #7 and TPM review § "S7 disposition":

> S7 is NOT a story in this epic. S7 is reconceptualized as the **Act I
> exit gate** — the verification that the prior epic's outcome metric has
> flipped non-zero.

The Act I exit gate verification is enacted at S2 close:

```sql
SELECT COUNT(*) FROM triples
 WHERE predicate IN ('phase_failed','phase_blocked','superseded');
```

Must return > 0 after one normal /meta-optimize cycle on plugin-hive
following S2 ship. Recorded as story S2.3 (optional automation around the
check) OR as a manual sign-off at S2 close.

No new code, no new story specifically for S7. Loop closed.
