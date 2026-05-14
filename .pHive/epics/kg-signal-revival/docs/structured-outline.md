# Structured Outline — KG Signal Revival

**Epic:** kg-signal-revival
**Date:** 2026-05-13
**Author:** orchestrator (writer-fallback render this session; codex unreliable)
**Inputs:** research-brief.md, design-discussion.md v3, horizontal-plan.md, vertical-plan.md, tpm-brief-hv.md (orphan reconciled). User decisions locked at §10 of design-discussion.

This is the long-form planning document. Phases map 1:1 to the vertical slices (B0/S1–S6). Each phase has: scope, file manifest, risk registry sub-section, sequencing notes, exit criteria. Part 7 is the team's stress-test of the plan (elicitation). Part 8 is numbered decision points for user sign-off.

---

## Part 1 — Epic Context Recap

### One-line promise

> "Hive's KG and ChromaDB pipelines emit, persist, and surface enough signal that `/meta-optimize` consumes KG-derived planning proposals, decisions have an audit trail via `/hive:why`, and cross-project learnings reach plugin-hive's planning gates."

### Three north-stars (must all ship in v1 per user decisions §10)

1. **Drive planning signal** — `/meta-optimize` cycles produce ≥1 `kg_signal`-sourced proposal in ANY of the next 5 cycles (lowered threshold per user §10.4).
2. **Decision audit trail** — `/hive:why <topic>` returns triples for any decision recorded in last 90 days.
3. **Cross-project learning** — Shindig Mobile's failures surface as cross-project-tagged signal in plugin-hive's step-02c (+ Signal Flayr + Tech Assistant per user §10.3, paths pending).

### Why this epic exists (the cold-pipeline diagnosis)

- KG plumbing shipped in `1.1.3` + `1.1.4`. Pipeline is cold because:
  - Only `decided` predicate fires in production (66 triples).
  - `phase_failed`, `phase_blocked`, `superseded` — the three step-02c queries — NEVER emit.
  - ChromaDB sidecar never bootstrapped on this machine.
  - `~/.claude/hive/projects.yaml` has 1 entry → cross-project rank penalty has nothing to penalize.
  - No telemetry → invisible hit-rate.
- S7-kg-signal-production-emission (prior epic) was retro-synthesized as the load-bearing outcome claim that never materialized. THIS epic IS S7's implementation.

### Scope boundary anchors (carry from design-discussion §5 + §10)

- **In scope:** wire firing pins on 3 priority predicates; ChromaDB auto-start; multi-project registry + `/hive:register-project`; telemetry counters + miss-reason taxonomy; `/hive:why` retrospection UX.
- **Explicitly out of scope:** predicate vocabulary expansion; ChromaDB advanced semantic search UX; in-product visualization; dreaming-replay activation; external-system emission (Linear/GitHub); KG export to external graph DB.

---

## Part 2 — Phase Map (1:1 with Vertical Slices)

The outline lays out phases in execution order. B0 first; S3 ∥ S4 parallel-eligible.

### Phase B0 — Consumer-contract sliver (docs-only)

**Scope:** produce 2 contract documents that name every silent predicate's consumer (B0.1) and every new persistence/reference/telemetry contract (B0.2). Gates S1-S5 schema work.

**Stories proposed (1-2):**

- **B0.1** — `consumer-contracts.md`: For each of the 8 silent predicates, name the consumer that needs it (or explicitly defer). Output: a markdown table + per-predicate paragraph.
- **B0.2** — `registry-chroma-telemetry-contract.md`: Registry row shape; ChromaDB "decisions" collection schema + metadata fields; telemetry envelope (hit-rate gauge shape, miss-reason taxonomy buckets, per-predicate write counter names).

**Acceptance:** docs exist; reviewer can validate S1+S2 predicate semantics, S3 collection schema, S4 registry shape, S5 telemetry envelope against the contracts before each slice ships.

**Risk:** Low. Risk = missed predicate consumer caught at S1/S2 review.

**Dependencies:** none upstream.

**Skipped on min-viable cut:** no — B0 always lands first.

---

### Phase S1 — Emit foundation (`phase_failed` at one seam)

**Scope:** ship the thinnest emit-site instrumentation foundation. One predicate at one seam. Two structural artifacts: scalar config knob + write-rate counter helper.

**Stories proposed (~2):**

- **S1.1** — `emit-foundation-knob-counter`:
  - Add `emit_lifecycle_at` to `hive.config.yaml` and `hive/hive.config.yaml` (default `phase`, options `{phase, story, step, off}`).
  - Write `hive/lib/kg-emit.js` (or extend an existing module) with `emitKgEvent({subject, predicate, object, sourceEpic, sourceAgent})` helper that:
    - reads `emit_lifecycle_at` and short-circuits if `off`,
    - increments a write-rate counter (one line per emit),
    - calls existing `kg_write()`,
    - degrades silently if `kg.sqlite` unavailable.
  - Unit tests: knob respected; counter increments; no-op when `off`.
- **S1.2** — `phase-failed-walker-emit`:
  - In `hive/lib/dag-executor/walker.js`, find the `step.fail()` handler.
  - Call `emitKgEvent({predicate: 'phase_failed', subject: storyId, object: failureReasonSlug, sourceEpic: currentEpicId, sourceAgent: 'dag-executor'})` on fail.
  - Integration test: synthetic DAG with a forced failure produces a `phase_failed` triple.
  - Production verification: after one normal cycle on plugin-hive with at least one failing step, `SELECT * FROM triples WHERE predicate='phase_failed'` returns the triple.

**Acceptance:** `phase_failed` emits from one seam. `emit_lifecycle_at: off` kills emission. write-rate counter increments per call (and per cycle aggregated).

**Risk:** **Medium.** R1 over-emission may manifest at this slice if `walker.js` step.fail() fires more often than expected. Mitigation: phase-default + write-rate counter detects within S1 itself (no need to wait for S5). Performance:audit specialist input pre-exec.

**Dependencies:** B0.1, B0.2.

**Skipped on min-viable cut:** no — foundational.

---

### Phase S2 — Priority predicate fanout (`phase_blocked`, `superseded`) + S7 exit gate

**Scope:** replicate the S1 pattern across the remaining 2 priority predicates' emit seams. Closes Act I — the prior epic's outcome metric flips.

**Stories proposed (~2-3):**

- **S2.1** — `phase-blocked-emit-sites`: emit at 3 sites:
  - `hive/lib/dag-executor/walker.js` upstream-skip path.
  - `hive/agents/tpm.md` escalation-raise site (when TPM raises a `pre-exec` escalation, write `phase_blocked` for the stories listed).
  - Orchestrator waiting-on-user gate site (user-input-pending = blocked).
- **S2.2** — `superseded-emit-sites`: emit at 3 sites:
  - `/plan` skill story overwrite (when a story YAML is replaced).
  - `/meta-optimize` proposal replacement (when a new proposal supersedes a prior one).
  - Insight promotion replacing a prior memory file.
- **S2.3** (optional) — `act-i-exit-gate-verification`: automation that runs after every `/meta-optimize` cycle:
  ```sql
  SELECT COUNT(*) FROM triples WHERE predicate IN ('phase_failed','phase_blocked','superseded');
  ```
  Emits a `[kg-signal-revival] act-i-exit-gate: count=N` log line. Closes S7. (TPM noted in their review: this could collapse into S2.2 if 2-story S2 is preferred. Outline retains as separate for traceability.)

**Acceptance:** All 3 priority predicates emit from named seams. Production query returns > 0 after one normal cycle.

**Risk:** Medium-low. Mechanical replication. R1 manifestation detectable via S1's write-rate counter.

**Dependencies:** S1 (helper + knob + counter pattern).

**Skipped on min-viable cut:** no.

---

### Phase S3 — ChromaDB sidecar bootstrap (parallel with S4)

**Scope:** stand up the long-lived ChromaDB sidecar via auto-start scripts + SessionStart hook + pidfile/lockfile. Bootstrap the "decisions" collection per B0.2 schema.

**Stories proposed (~2):**

- **S3.1** — `sidecar-lifecycle-scripts`:
  - `hive/scripts/chromadb-start.sh`: launch ChromaDB sidecar on ephemeral port; write `~/.claude/hive/chromadb.{port,pid,lock}`.
  - `hive/scripts/chromadb-stop.sh`: send SIGTERM; clean up state files.
  - `hive/scripts/chromadb-status.sh`: report running state from pid/lock files.
  - Add a SessionStart hook entry in `settings.json` (or wherever Hive's hooks live) that runs `chromadb-start.sh` and skips if `isAvailable()` returns true.
- **S3.2** — `wrapper-port-lookup-and-collection-bootstrap`:
  - `hive/lib/chromadb-wrapper.js`: read port from `~/.claude/hive/chromadb.port` instead of hardcoded `8000`.
  - On first invocation, ensure the "decisions" collection exists (idempotent `getOrCreate` against ChromaDB API).
  - Schema per B0.2: `id` = decision-key, `document` = decision summary text, `metadata` = `{predicate, source_epic, source_agent, valid_from}`.

**Acceptance:** SessionStart hook starts sidecar; subsequent sessions skip start; wrapper.isAvailable() returns true; sample document write + similarity query roundtrips.

**Risk:** **Medium.** Sidecar lifecycle (R2): port collisions, crash recovery, multi-session races. Mitigated via ephemeral port + isAvailable() fast-path + lockfile single-instance + dedicated negative tests.

**Dependencies:** S1 (metric_registry counter pattern reused for chroma availability metric).

**Skipped on min-viable cut:** YES — drops S3. ChromaDB stays cold. L3 vector signal absent. S6 `/hive:why` then runs SQLite-only (still functional but no semantic search).

---

### Phase S4 — Multi-project registry expansion (parallel with S3)

**Scope:** ship `/hive:register-project` skill + backfill flags + onboard real projects.

**Stories proposed (~3-4):**

- **S4.1** — `register-project-skill`:
  - New skill at `skills/hive/skills/register-project/SKILL.md`.
  - Input: target path. Validation: path exists + `.pHive/` directory present (warn if `.pHive/cycle-state/` empty).
  - **Path-quirk handling (REQUIRED per cycle-state cross_project_targets):** skill must accept both quoted and shell-escaped paths. Nail Tech Assistant's path contains a space (`/Users/don/Documents/GitHub/Nail Tech Assitant`). Test fixture: register a project at a path containing a space.
  - Skill docstring includes: "Quote paths containing spaces, e.g. `/hive:register-project \"/path/with space\"`."
  - Append entry to `~/.claude/hive/projects.yaml` with dedupe-on-write (name + canonical path).
  - Output: registry entry preview + invocation to `kg-bootstrap-from-projects.js --dry-run` for that project.
- **S4.2** — `bootstrap-since-and-dry-run`:
  - Extend `scripts/kg-bootstrap-from-projects.js`:
    - Add `--since YYYY-MM-DD` flag (default = predicate-canon-date 2026-04-28 per DP #5).
    - Confirm `--dry-run` is default + emits diff-preview.
    - `--apply` required for actual writes.
  - **Large-import guardrail (per TPM supplement, R4 mitigation):** dry-run output reports projected triple count BEFORE `--apply`. If projected count > 10,000 triples, `--apply` refuses unless `--yes-large-import` flag is also passed OR interactive confirmation is given. Prevents accidental flood from all-history backfill across 3 source projects with 14+ epic namespaces.
  - Backfill output namespaced as `{project_name}/{epic_id}` (existing pattern).
- **S4.3** — `shindig-onboarding-and-backfill`:
  - Run `/hive:register-project /Users/don/Documents/KMP/Shindig`.
  - Run `kg-bootstrap-from-projects.js --apply --since <step-02c-window>`.
  - Verify: at least 5 Shindig triples land in plugin-hive's KG under `shindig/{epic_id}` namespace.
  - First step-02c cycle after backfill: confirm cross-project rank penalty observable (0.7× applied to Shindig findings).
- **S4.4** — `signal-flayr-onboarding-and-backfill`: same as S4.3 but for Signal Flayr. **Path: `/Users/don/Documents/GitHub/ffe-social-engine`** (verified reachable; `.pHive/cycle-state/` populated with 5 epic entries: landing-page-rethink, security-audit-2026-05-07, security-hotfix-p0, settings-redesign-v2, signal-flayr-reskin-p2). Registry name: `signal-flayr`.
- **S4.5** — `nail-tech-assistant-onboarding-and-backfill`: same as S4.3 but for NTA. **Path: `/Users/don/Documents/GitHub/Nail Tech Assitant`** (NB: filesystem name has typo "Assitant"; verified reachable; `.pHive/cycle-state/` populated with 5 epic entries: epic-a-foundation-auth, epic-b-pinterest-integration, epic-c-reference-and-generation, epic-d-visualizer-library, epic-e-chat-refinement). Registry name: `nail-tech-assistant`. **Note:** spaces in path require shell escaping in backfill invocation; `kg-bootstrap-from-projects.js` `path.resolve()` handles them, but `/hive:register-project` skill must accept quoted paths.

**Acceptance:** `/hive:register-project` works; backfill flags work; at least Shindig is real-imported; first cross-project-tagged step-02c finding observable in next cycle.

**Risk:** **Medium-High.** Cross-project contamination (R3) + backfill pollution (R4). Mitigated via `[cross-project: <name>]` hard tag in proposal descriptions; `--since` default to predicate-canon-date; `--dry-run` + diff-preview. Security:plan-audit pre-exec input.

**Dependencies:** S1 (registry entries reference KG patterns established in S1).

**Skipped on min-viable cut:** YES — drops S4. Cross-project north-star slips to follow-on.

---

### Phase S5 — Telemetry + miss-reason taxonomy + cycle rollup

**Scope:** ship the named counters + hit-rate gauge + miss-reason taxonomy. Observable proof the loop works.

**Stories proposed (~2-3):**

- **S5.1** — `metric-registry-counters`:
  - Extend `skills/hive/skills/meta-optimize/metric_registry.py`:
    - `kg_writes_total{predicate}` — counter per predicate (driven by S1 helper).
    - `kg_signal_findings_total{cycle_id}` — counter at step-02c output.
    - `kg_signal_proposals_total{cycle_id}` — counter at step-03 merge (this is the **hit-rate join site** — see open question §8b of design-discussion).
    - `hit_rate_5cycle` gauge — rolling 5-cycle average computed at cycle close.
- **S5.2** — `miss-reason-taxonomy`:
  - At step-02c, when findings are empty, emit a `miss_reason` field with one of:
    - `empty_kg` (no triples at all in window)
    - `empty_predicate_filter` (triples exist but none in the 3 priority predicates)
    - `recency_cutoff` (relevant predicates exist but all older than window)
    - `project_tag_cutoff` (all triples cross-project; rank penalty too low)
    - `dedup_eviction` (kg-findings duplicated step-02 findings; merged out)
  - Requires step-02c to introspect its query state. Verify at implementation: either step-02c surfaces enough state today OR add a thin observability layer in S5.2.
- **S5.3** — `cycle-rollup-and-jsonl-audit`:
  - Append per-cycle counters to `.pHive/metrics/kg/{cycle_id}.jsonl`.
  - `/meta-optimize` retrospect step pulls cycle-rollup numbers and surfaces "kg_signal hit rate over last 5 cycles" in cycle reports.

**Acceptance:** counters increment correctly across S1/S2/S4 outputs. hit_rate_5cycle gauge observable after 5 cycles. miss_reason field present on every empty-findings cycle.

**Risk:** Medium. Hit-rate join site placement is the largest open question (Part 8 decision point). Miss-reason discriminator may require step-02c shim.

**Dependencies:** S1 + S2 (writes happen), S3 (Chroma optional but lands first), S4 (registry produces cross-project data points).

**Skipped on min-viable cut:** **NO — required for any cut.** Without S5 we can't measure the success metric.

**This is the only STRICT working-state slice** — it observably changes `/meta-optimize` output (cycle reports gain a new section).

---

### Phase S6 — `/hive:why` retrospection UX + secondary predicates (conditional)

**Scope:** ship the audit-trail north-star delivery surface. Wraps `MemoryStore.query_decisions()` + optionally ChromaDB semantic search.

**Stories proposed (~2-3):**

- **S6.1** — `hive-why-slash-command`:
  - New skill at `skills/hive/skills/why/SKILL.md`.
  - Input: free-form topic string OR a structured `--predicate X --entity Y` form.
  - Implementation:
    - Phase A — predicate+entity match: call `MemoryStore.query_decisions({entity: topic, as_of: now})`.
    - Phase B — semantic similarity (only if S3 shipped + ChromaDB available): query "decisions" collection for top-5 similar documents.
    - Phase C — merge + dedupe + render with provenance (`{subject} {predicate} {object} (valid_from: ..., source_epic: ..., source_agent: ...)`).
- **S6.2** — `planning-skill-why-helper`:
  - Add a planning-skill helper that calls `/hive:why` during `/plan` for "prior decisions on similar topics" inline. Surfaces as a §0 pre-flight section in the design discussion.
- **S6.3** (conditional) — `secondary-predicate-wiring`:
  - If `/hive:why` UX surface (S6.1) needs `assigned_to`/`blocked_by`/`depends_on`/`phase_started`/`phase_complete` triples, wire the secondary predicate emit sites. Otherwise omit; revisit in follow-on epic.

**Acceptance:** `/hive:why "<topic>"` returns triples for any in-window decision; planning skill surfaces relevant prior decisions in design discussions.

**Risk:** Low-medium. Story count depends on S6.3 wiring (UX-design-dependent).

**Dependencies:** S1 + S2 (`decided`/`superseded` triples exist), S3 (optional, for semantic search), S5 (telemetry not needed but counter pattern reused).

**Skipped on min-viable cut:** YES — drops S6. Audit-trail north-star slips. User §10.2 elected to KEEP S6 in v1 — so it stays in full epic.

---

## Part 3 — File Manifest (Cumulative)

### New files

```
hive/scripts/chromadb-start.sh                         (S3.1)
hive/scripts/chromadb-stop.sh                          (S3.1)
hive/scripts/chromadb-status.sh                        (S3.1)
hive/lib/kg-emit.js                                    (S1.1) [or extend hive/lib/session-end.js]
skills/hive/skills/register-project/SKILL.md           (S4.1)
skills/hive/skills/why/SKILL.md                        (S6.1)
.pHive/epics/kg-signal-revival/docs/consumer-contracts.md          (B0.1)
.pHive/epics/kg-signal-revival/docs/registry-chroma-telemetry-contract.md  (B0.2)
.pHive/metrics/kg/                                     (S5.3, directory)
```

### Modified files

```
hive.config.yaml                                       (S1.1 — emit_lifecycle_at)
hive/hive.config.yaml                                  (S1.1 — emit_lifecycle_at default)
hive/lib/dag-executor/walker.js                        (S1.2, S2.1)
hive/lib/chromadb-wrapper.js                           (S3.2 — port lookup)
hive/agents/tpm.md                                     (S2.1 — escalation-raise emit)
hive/agents/reviewer.md                                (S2.2 — superseded on reject?)
hive/workflows/steps/meta-team-cycle/step-02c-kg-signal.md  (S5.2 — miss-reason taxonomy surface)
hive/workflows/steps/meta-team-cycle/step-03-proposal.md    (S5.1 — proposals counter at merge)
scripts/kg-bootstrap-from-projects.js                  (S4.2 — --since, --dry-run hardening)
skills/hive/skills/meta-optimize/metric_registry.py    (S5.1 — counters)
skills/hive/skills/plan/SKILL.md                       (S6.2 — /hive:why helper)
~/.claude/hive/projects.yaml                           (S4.3, S4.4, S4.5 — entries)
settings.json or hive hooks config                     (S3.1 — SessionStart hook)
```

### Read-only references

```
hive/references/knowledge-graph-schema.md
hive/references/memory-store-interface.md
hive/lib/session-end.js
hive/workflows/steps/meta-team-cycle/step-02c-kg-signal.md (read-only by S6)
```

---

## Part 4 — Risk Registry (Slice-Mapped)

| ID | Risk | Slice manifestation | Severity | Mitigation |
|---|---|---|---|---|
| R1 | Predicate over-emission floods kg.sqlite | S1 (first wave), S2 (fanout amplifies) | Major | Phase-default; `emit_lifecycle_at: off` kill-switch; write-rate counter in S1; performance:audit pre-exec |
| R2 | ChromaDB sidecar lifecycle (port, crash, race) | S3 | Moderate | Ephemeral port; isAvailable() fast-path; lockfile single-instance; negative tests |
| R3 | Cross-project signal contamination | S4 | Moderate | `[cross-project: <name>]` hard tag; existing 0.7× rank penalty; security:plan-audit pre-exec |
| R4 | Backfill pollution from pre-canon decisions | S4.2/S4.3 | Moderate | `--since` default to predicate-canon-date; `--dry-run` diff-preview; `--apply` required for writes |
| R5 | S7 scope collision | resolved at design-discussion | — | S7 reconceptualized as Act I exit criterion (S2.3); no story |
| R6 | Telemetry surface drift (orphan counters) | S5 | Minor | All counters via `metric_registry.register()`; CI grep check |
| R7 | Re-run silence (re-emit blocked by idempotency) | S1, S2 (any retry path) | Minor | Accept silence by default; retry counter as follow-on if telemetry shows blindness |
| R8 | Hit-rate join site ambiguity (open question) | S5.1 | Minor | Decision point in Part 8; default = step-03 merge site |
| R9 | Miss-reason discriminator state may not exist in step-02c | S5.2 | Minor | Verify at implementation; add shim if needed |

---

## Part 5 — Sequencing + Dependencies

### Critical path

```
B0 → S1 → S2 → S5 → S6
       │
       └─ ∥ S3 ∥ S4 → S5
```

- B0 gates schema choices in S1, S3, S4, S5.
- S1 must precede S2 (S2 reuses S1's helper + knob + counter).
- S3 ∥ S4 can run concurrently (no shared files).
- S5 depends on writes happening (S1 + S2) + cross-project data (S4) + chroma availability metric (S3 partial).
- S6 depends on triples existing (S1 + S2 + decided) + optional ChromaDB (S3).

### Parallel-eligible work-pair

- **S3 ∥ S4** — different subsystems, different files. Different agents can pick up concurrently.
- B0.1 ∥ B0.2 — different consumers; can fan-out within Phase B0 if multiple agents available.

### Drop order (compress-mid-execution)

If the epic must compress mid-flight:

1. **First drop:** S4.4 (Signal Flayr) + S4.5 (NTA) — reduces cross-project scope to Shindig only. Note: since user paths landed (§v1.1), these stories are no longer contingent stub-seed but real-import; dropping defers them to follow-on.
2. **Second drop:** S6.3 (secondary predicate wiring) — only relevant if /hive:why UX needs them.
3. **Third drop:** S3 (Chroma) — `/hive:why` falls back to SQLite-only mode; semantic search absent.
4. **Fourth drop:** S6 (`/hive:why` entirely) — audit-trail north-star slips. Only drop if user re-prioritizes.
5. **Fifth drop:** S4 entirely — cross-project slips.
6. **Min-viable-ship cut:** B0 + S1 + S2 + S5 (planning-signal only).

**Coupling note:** Drop #3 (S3) and Drop #4 (S6) are coupled. If S3 drops, S6 still ships in SQLite-only mode (Phase A predicate+entity match works; Phase B semantic similarity absent). If S6 drops first, S3 becomes drop-eligible immediately since no consumer remains for the ChromaDB collection — keeping S3 alone would ship a populated collection nobody reads.

---

## Part 6 — Acceptance Criteria (Epic-Level)

The epic is "done" when ALL of:

1. **Planning signal (north-star 1):** Next 5 `/meta-optimize` cycles include ≥1 cycle where `kg_signal_findings_total > 0` AND that finding flows into step-03's proposal pool (regardless of whether ranked first).
2. **Audit trail (north-star 2):** `/hive:why "<arbitrary in-window topic>"` returns ≥1 triple with provenance for any in-window decision recorded in the KG.
3. **Cross-project (north-star 3):** ≥1 step-02c finding tagged `cross_project_signal` (originating from Shindig) appears in plugin-hive's `kg-findings.yaml` within next 5 cycles.
4. **S7 closure (prior epic outcome metric):** `SELECT COUNT(*) FROM triples WHERE predicate IN ('phase_failed','phase_blocked','superseded')` returns > 0 against production `~/.claude/hive/kg.sqlite`.
5. **Predicate vocabulary stable:** 9 predicates only; no schema migration needed; no new predicate added.
6. **Performance bounds:** kg_write() latency stays under 100ms for 20-triple batches; `idx_predicate` hot-path query under 50ms (measured by perf-audit specialist input).
7. **Specialist escalations resolved:** performance:audit + security:plan-audit pre-exec findings landed and addressed.
8. **Min-viable cut alternative:** if compressed, the cut delivers north-star 1 alone; north-stars 2 + 3 slip to follow-on but are documented in the partial-ship summary.

---

## Part 7 — Elicitation (Team Stress-Test)

This is the team's own pre-mortem of the plan. Each elicitation is the team answering "what could go wrong / what's weakest about this slice?" — the user reads the team's answers to judge whether the thinking is sound.

### E1 — Is the B0 sliver doing real work or is it cargo-cult?

**Team answer:** Real. B0.1 forces the question "does any consumer want X predicate?" which, applied to the 5 secondary predicates, surfaces the deferral decision before emission. B0.2 forces ChromaDB collection schema decision before S3 writes; without it, S3 invents a schema and S5 telemetry counters can't reference fixed field names. Eliminating B0 = high re-emission probability mid-epic.

**Weakness:** B0 is markdown-only and easy to skip. Mitigation: B0 acceptance is a reviewer check during S1, not a free-standing gate. If S1's emit helper landed without B0.1 docs, S1 review blocks until B0.1 lands.

### E2 — Why is S1 only one emit site instead of three?

**Team answer:** Two reasons. (1) **Risk isolation / measurement window** — R1 (over-emission) manifests at write volume. We don't know `walker.js` step.fail() call frequency until we measure. S1 = one seam + write-rate counter ships → measure one cycle → decide if granularity-default is correct → S2 fans out with confidence. Wiring 3 seams in S1 would conflate signal: which seam over-emits? (2) **API contract lock-in** — S1 locks the `emitKgEvent()` helper signature before S2 fans out. If S2 wired three seams in one slice, any helper-API change discovered mid-S2 would require revisiting multiple seams. One-seam pattern guarantees the contract is settled before the fanout.

**Weakness:** Adds a slice (S1 vs combining into S2). Two-slice cost = one extra commit. Worth it for the measurement window AND the contract lock-in. TPM's preference: keep S1 lean.

### E3 — Why is S3 (ChromaDB) parallel with S4 (registry) and not sequenced?

**Team answer:** Different subsystems, different files, different risk profiles. R2 (Chroma) is operational; R3 (registry) is semantic. Sequencing would force one to wait without dependency benefit. Parallelism enables shorter wall-clock; sequential ordering enables clearer review (one risk at a time). On a single-developer execution, ordering is fine; on parallel execution (two agents), parallel is right.

**Weakness:** if both run by same agent, parallel-eligibility is moot. The slice plan documents the OPTION; execution can sequence in practice. Pragmatic.

### E4 — Is the cross-project rank penalty (0.7×) the right number?

**Team answer:** Unknown — inherited from kg-augmented-meta-signal epic. Not under question in this epic. If the cross-project signal fires meaningfully in next 5 cycles, the 0.7× was approximately right; if cross-project drowns local signal, retune in follow-on. Don't open it now.

**Weakness:** No A/B comparison data exists at planning time. **Sharpening per user §10.4 lowered threshold:** at "any non-zero hit in 5 cycles" success bar, the 0.7× becomes MORE risky — any single cross-project finding could be the one that flips the gauge non-zero, masking whether plugin-hive's OWN signal is working. **Caveat:** If first 5 cycles show hit-rate flipping ONLY via cross-project signal (no same-project hits), flag for 0.7× retune as a follow-on retrospect question. Defer the retune itself; record the trigger condition.

### E5 — Why is the success threshold "any non-zero hit in 5 cycles" instead of N%?

**Team answer:** User §10.4 decision. Lowered from 30%/3 cycles. Rationale: pipeline is currently 0%. Going from 0% → any-non-zero is a meaningful unlock; demanding 30% at v1 may set false-failure on a working pipeline that just hasn't had a high-failure cycle yet. The success bar is "loop works" not "loop dominates."

**Weakness:** Easy threshold makes "is the loop actually useful?" deferred to a follow-on retrospect. Acceptable for v1 since this IS the first cycle.

### E6 — Why isn't the secondary-predicate wiring its own slice?

**Team answer:** Consumer-contract first. Without `/hive:why`'s UX design (in S6.1), we don't know which secondary predicates surface. Wiring all 5 now = anti-b0-sliver-pattern (emit without consumer). Wiring zero now = audit-trail-via-secondary may be thin. Conditional wiring in S6.3 lets UX design drive emission scope.

**Weakness:** S6.3 may add 2-5 more emit sites discovered late in execution. Risk: S6.3 slips wall-clock. Mitigated by S6.3 being explicitly conditional + already in scope.

### E7 — Is the perf-audit escalation pre-exec or post-exec?

**Team answer:** Pre-exec — recorded by TPM. Perf-audit input must land BEFORE S1/S2 sequencing locks because R1 mitigation strategy (granularity default + counter early) depends on perf specialist confirming the write-volume projection is realistic. If specialist says "even phase-level emits 10k+/week," the design changes (e.g., sampling, batching). Post-exec audit cost = mid-epic rewrite.

**Weakness:** Adds a wait-state at the start. Acceptable; specialist input is fast (~1 cycle).

### E8 — What if the ChromaDB sidecar refuses to start (Python missing, port collision, etc.)?

**Team answer:** Wrapper degrades silently (per existing code). S3 ships a status script + the failure surfaces as "sidecar not running" in `/hive:status` (existing surface). S6.1 then runs SQLite-only mode + warns user. Worst case = S3 is a no-op on consumer machines; KG-only retrospection still works. **Not a blocker.**

**Weakness:** Silent degradation may hide a fixable problem. Mitigation: chromadb-status.sh + a SessionStart-hook warning when sidecar start fails (not a hard error).

### E9 — Is 7 slices too many for a "wire firing pins" epic?

**Team answer:** No. 7 slices = 4 subsystems + B0 + emit-split + retro UX. Each slice is commit-worthy and parallel-eligible where appropriate. Compressing would conflate subsystem risks (R1+R2+R3 all in one slice = harder review).

**Weakness:** 7 slices = 13-17 stories. Wall-clock = ~3 weeks per user §10 appetite. If the user's 3-week appetite was generous, this fits; if tight, drop S6.3 + S4.4 + S4.5 first (already conditional/contingent).

### E10 — Does the plan account for codex-routing degraded state this session?

**Team answer:** Documented in design-discussion §9 and research-raw §codex caveat. Phase A + B were orchestrator-fallback. Phase C should re-attempt codex for story-rendering. If codex remains unreliable, orchestrator-fallback acceptable for stories with TPM review. Not a planning quality issue, but a per-session execution caveat.

**Weakness:** Cross-session reproducibility of the plan depends on whether codex backend stabilizes. Outline-as-written is backend-agnostic.

---

## Part 8 — Decision Points (Numbered, for User Sign-Off)

Each decision below has a default. User can affirm (`✓`) or change (`✗ + new choice`).

1. **Hit-rate counter join site:** counter at step-03 merge (recommended) vs synthesis at session-end. **Default: step-03 merge.** Reasoning: step-03 is where the kg_signal proposal ENTERS the candidate pool — counting there is the canonical event.

2. **Miss-reason discriminator:** verify step-02c exposes enough state OR add a thin observability layer at S5.2. **Default: verify-first; shim if needed.** Reasoning: cheaper to confirm-as-is than to refactor preemptively.

3. **S4.4 + S4.5 (Signal Flayr + Nail Tech Assistant) disposition:** ~~stub-seed~~ — **RESOLVED to real-import**. Paths confirmed by user 2026-05-13 23:35; both reachable + `.pHive/cycle-state/` populated. Paths: `/Users/don/Documents/GitHub/ffe-social-engine` (signal-flayr) + `/Users/don/Documents/GitHub/Nail Tech Assitant` (nail-tech-assistant). S4 now ships 3 real-imports (Shindig + Signal Flayr + NTA) in v1.

4. **S2.3 (Act I exit gate verification automation):** keep as separate story / collapse into S2.2. **Default: keep separate** for traceability. TPM noted this could collapse if 2-story S2 preferred.

5. **Backfill `--since` default:** 90 days (placeholder) vs predicate-canon-date (2026-04-28) vs step-02c lookback window. **Default: predicate-canon-date** (2026-04-28). Reasoning: anything older predates canon and biases recency.

6. **S6.3 (secondary predicate wiring):** wire all 5 / wire UX-driven subset / wire none. **Default: UX-driven subset** (conditional in S6.3). Reasoning: emit-without-consumer is anti-pattern; let `/hive:why` design dictate.

7. **Performance:audit specialist dispatch:** dispatch immediately (pre-S1) vs at S1 kick-off. **Default: immediately** so input lands while B0 is in progress.

8. **Security:plan-audit specialist dispatch:** dispatch at S4 kick-off vs pre-S4. **Default: pre-S4** (during S3 ∥ S4 launch window). Reasoning: registry expansion's boundary semantics surface as soon as `/hive:register-project` design starts.

9. **`/hive:why` surface design:** free-form topic OR structured predicate+entity OR both. **Default: both** — Phase A predicate+entity match (precise), Phase B semantic similarity (broad). Surface flag `--strict` to use only Phase A. **Doc-surface priority:** primary documented usage is `--strict` with structured input (highest precision); free-form via semantic similarity is documented as the broader fallback. Avoids confusing new users with low-precision results by default.

10. **Pre-shutdown emit safety:** emit kg-triples in session-end Phase B as today vs inline at the seam vs both. **Default: both, with seam-inline being lossless and session-end batched-fallback.** Reasoning: inline emit = no loss on hard shutdown; session-end batch = amortized write cost.

---

## Part 9 — Mapping to S7 (Prior Epic Outcome Metric)

S7-kg-signal-production-emission's status is `completed: true, backfilled: true` with implement note "No new code — this story is the epic's outcome claim." S7 is the canary that triggered this epic.

**Disposition:** S7 is treated as **Act I exit criterion**, NOT as a story candidate.

**Verification SQL** (run after S2 ships):

```sql
SELECT COUNT(*) FROM triples
 WHERE predicate IN ('phase_failed','phase_blocked','superseded');
```

Confirming COUNT > 0 closes the loop on S7's outcome metric. Recorded as Act I exit gate in V-plan §9 (and §S2.3 above as optional automation).

**Why this matters:** S7 was retro-synthesized to record an unmet expectation. Marking S7 "verified" via this epic's Act I closes the prior epic's loop cleanly. No back-port to kg-augmented-meta-signal needed.

---

## Part 10 — Process Caveats + Routing Log

- Phase A research + Phase B writing were orchestrator-fallback this session (codex dispatch did not land). Cross-checked against primary code reads. Documented in research-raw.md §codex-caveat + design-discussion §9.
- Phase B2 H/V planning was TPM-direct (Claude, in-team). Documented as orchestrator-fallback render in plan headers. Validated against tpm-brief-hv.md.
- Phase B3 (this document) is orchestrator-fallback render.
- Phase C (story decomp) should re-attempt codex for per-story rendering. Orchestrator-fallback acceptable if codex remains unreliable. Per-story TPM review compensates.

**Routing log entries this session:**

```
[info] planning routing: persona=researcher requested=codex path=codex-rescue→orch-fallback reason=codex-dispatch-output-not-observable
[info] planning routing: persona=technical-writer requested=codex path=codex-rescue→orch-fallback reason=codex-dispatch-output-not-observable
[info] planning routing: persona=architect requested=codex path=NOT-DISPATCHED reason=design-discussion-orch-fallback-sufficient
[info] planning routing: persona=tpm requested=unset path=TeamCreate reason=agent_backends-unset
```

---

## Revision history

- **v1** 2026-05-13 23:32 — initial orchestrator-fallback render.
- **v1.1** 2026-05-13 23:36 — user-provided paths landed mid-TPM-review. S4.4 (Signal Flayr) + S4.5 (NTA) upgraded from contingent stub-seed to real-import. Part 8 decision #3 marked RESOLVED. R3 (cross-project contamination) surface expanded from 1 to 3 source projects — security:plan-audit escalation severity warrants TPM review for upgrade to moderate.
- **v1.2** 2026-05-13 23:42 — TPM second review feedback incorporated: (a) Part 5 drop-order coupling note (S3↔S6); (b) Part 7 E2 API-contract-lock-in reason added; (c) Part 7 E4 0.7× retune-trigger caveat added; (d) Part 8 DP #9 doc-surface priority for `--strict`; (e) S4.1 path-quirk acceptance criterion (handle quoted/spaced paths); (f) S4.2 large-import guardrail (`--yes-large-import` flag if >10k triples projected). TPM verdict on outline = approve-with-escalation (no NEW escalations; B2 escalations unchanged).
