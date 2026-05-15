# Design Discussion — KG Signal Revival

**Epic:** kg-signal-revival
**Date:** 2026-05-13
**Author:** orchestrator (writer fallback)
**Inputs:** `research-brief.md`, user north-star answers, kg-augmented-meta-signal landed surface, prior `tpm-brief-hv.md` (orphaned).

---

## 1. Goal

Make the Hive knowledge graph **mechanically useful** by closing three coupled gaps:

1. **Signal:** Fire the predicates that `/meta-optimize` step-02c queries, so kg_signal proposals stop being a dead branch.
2. **Audit trail:** Enrich the `decided`/`superseded` corpus + add a read-path UX so "why did we choose X?" returns triples on demand.
3. **Cross-project learning:** Onboard a 2nd Hive-enabled project to the system registry so the cross-project rank penalty (already in code) has something real to penalize.

The KG already exists. The kg-augmented-meta-signal epic already merged routing + filtering + step-02c plumbing. **This epic wires the firing pins.** Nothing in this scope is "redesign the KG."

### Definition of success

| North star | Metric | Target |
|---|---|---|
| Drive planning signal | `/meta-optimize` cycles surfacing ≥1 `kg_signal`-sourced proposal | ≥30% over 3 consecutive cycles |
| Decision audit trail | `/hive:why <topic>` returns triples for any decision recorded in last 90 days | 100% (any topic in KG returns ≥1 triple) |
| Cross-project learning | 2nd project's failures surface as cross-project signal in plugin-hive's step-02c | ≥1 cross-project-tagged finding in next 5 cycles |

Stretch (not in scope): in-product visualization, semantic search UX over ChromaDB L3, predicate vocabulary expansion.

---

## 2. Proposed approach

### Subsystem map (4 layers)

| Layer | Subsystem | Touched by this epic |
|---|---|---|
| Emit | Caller-side triple assembly at workflow seams (story start, step complete, fail, block, supersession events) | YES — new |
| Persist | `kg_write()` writer + ChromaDB sidecar bootstrap | Partial — ChromaDB bootstrap new; KG write path unchanged |
| Reference | Multi-project registry expansion + cross-project tagging in step-02c | YES — registry expansion new; step-02c logic unchanged |
| Consume | step-02c read path, telemetry counters, `/hive:why` retrospection UX | Partial — step-02c untouched; counters + UX new |

### Three-act sequence

The work splits naturally into three acts. They share dependencies but each delivers a working state.

**Act I — Emit (instrumentation):**

- Define the **consumer-contract first** (per orphan tpm-brief-hv.md insight — B0 sliver). For each silent predicate, name the consumer that needs it. If no consumer queries it, defer.
- Wire 3 priority predicates: `phase_failed`, `phase_blocked`, `superseded` (the three step-02c consumes). These deliver planning-signal value immediately.
- Wire 5 secondary predicates: `phase_started`, `phase_complete`, `assigned_to`, `blocked_by`, `depends_on` only if Act III retrospection UX uses them. Defer otherwise.

**Act II — Persist + reference:**

- ChromaDB bootstrap: pick one of (A) sidecar auto-start, (B) sqlite-vec in-process replacement. Decision-point in §8.
- Multi-project registry: ship a `/hive:register-project` skill + populate with a real 2nd project (Shindig Mobile).
- One-time backfill via `kg-bootstrap-from-projects.js --apply` after registry expansion. Scope: last 90 days only (avoid pollution from pre-canon-vocabulary triples).

**Act III — Consume:**

- Telemetry: add counters to `metric_registry.py`. Hit-rate gauge + miss-reason taxonomy. Cycle-level rollup.
- Retrospection UX: `/hive:why <topic>` slash command. Wraps `MemoryStore.query_decisions()`. Surfaces triples with provenance.
- Cross-cycle aggregate: `/meta-optimize` retrospect step pulls counters; surfaces "kg_signal hit rate over last 5 cycles" in cycle reports.

### Where each predicate fires (proposed)

| Predicate | Emit site | Subject | Object |
|---|---|---|---|
| `phase_started` | story-execute step entry; orchestrator workflow-phase entry | story-id or phase-key | "execute" / "planning" / "review" |
| `phase_complete` | step-complete on success in dag_executor walker; review-approve | story-id or phase-key | "execute" / "planning" / "review" |
| `phase_failed` | dag_executor fail path; reviewer reject verdict; circuit-breaker trip | story-id | failure-reason slug |
| `phase_blocked` | dag_executor upstream-skip; tpm escalation-raise; waiting-on-user gate | story-id | blocker-reason slug |
| `superseded` | `/plan` overwrite of prior story; insight-promotion replacing memory; `/meta-optimize` replacing a prior proposal | old-decision-key | new-decision-key |
| `decided` | already firing — broaden to: meta-optimize proposal acceptance + workflow design choices | decision-key | choice slug |
| `assigned_to` | `TaskUpdate(owner=X)` hook; spawn-time | task-id | agent-name |
| `blocked_by` / `depends_on` | epic.yaml ingest at `/plan` completion; story YAML `depends_on` ingest | story-id-a | story-id-b |

Emit happens via existing `kg_write()` either inline at the seam or queued through session-end Phase B. Session-end is preferred when batching reduces transaction count; inline is acceptable when the seam already runs a write (e.g., DAG executor fail path).

### Hit-rate definition (telemetry)

`hit_rate(N) = cycles_with_≥1_kg_signal_proposal / cycles_in_window(N)`

Cycle counts as a hit if step-02c emits ≥1 finding **AND** step-03 merges that finding into the proposal pool (even if the proposal isn't ranked first). Reject-due-to-ranking is not a miss — it's a downstream choice.

Miss reasons (orthogonal taxonomy):

1. `empty_kg` — no triples at all in window.
2. `empty_predicate_filter` — triples exist but none in `phase_failed`/`phase_blocked`/`superseded`.
3. `recency_cutoff` — relevant triples exist but older than window_days.
4. `project_tag_cutoff` — all triples cross-project; rank penalty pushes below threshold.
5. `dedup_eviction` — kg-findings duplicated step-02 findings; merged out by dedup logic.

---

## 3. Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Predicate over-emission** floods kg.sqlite (every step-start writes phase_started → 1000s of triples/week → idx_predicate index hot path slows reads). | Major | Emit at story granularity by default, not step granularity. Fire phase_started/complete at workflow-phase entry, not per-step. Add an `emit_lifecycle_at: story|step|phase` config knob defaulting to `phase`. |
| R2 | **ChromaDB sidecar lifecycle** is fragile — port conflicts on port 8000, no crash recovery, sessions race when two `claude` instances run. | Moderate | If choosing (A) auto-start: write a `chromadb-start.sh` with pidfile + lockfile; SessionStart hook checks `isAvailable()` first and skips start if already up. Use ephemeral port + record in `~/.claude/hive/chromadb.port`. If choosing (B) in-process: skip this risk entirely. |
| R3 | **Cross-project signal contamination** — Shindig's "phase_failed: ios_build_error" surfaces as a plugin-hive planning proposal. | Moderate | Existing 0.7× rank penalty + project tagging already handles this at the routing layer. **Add** a hard tag in the proposal description (`[cross-project: shindig]`) so humans can filter quickly. Don't auto-suppress; surface but mark. |
| R4 | **Backfill pollution** — `kg-bootstrap-from-projects.js --apply` against full Shindig history imports decisions from before the predicate-canon was finalized, biasing the recency window. | Moderate | Scope backfill to `valid_from >= now - 90 days` on first run. Add `--since YYYY-MM-DD` flag to bootstrap script. |
| R5 | **S7 scope collision** — kg-augmented-meta-signal S7-kg-signal-production-emission story may overlap this epic's Act I. | Moderate | TPM/architect reads S7 spec in B2. Three dispositions: supersede (this epic absorbs), decouple (S7 lands first, this epic builds on), merge. Decision-point in §8. |
| R6 | **Telemetry surface drift** — counters added ad hoc without `metric_registry.py` discipline. | Minor | All counters go through `metric_registry.register()`. Add a CI check that grep'd `kg_signal_*` counter names match registry entries. |
| R7 | **Idempotency** — re-running a workflow phase fires `phase_started` twice for the same subject + same source_epic; `idx_unique_triple` rejects via `INSERT OR IGNORE` so it's silent. Means re-runs LOSE the retry signal. | Minor | Either add a retry counter (`object: "retry-{N}"`), or accept re-run silence (retries are not failures). Default: accept silence; revisit if telemetry shows retry-blindness as a problem. |

---

## 4. Dependencies

- **Upstream:** kg-augmented-meta-signal epic SHIPPED (provides step-02c + routing). No remaining upstream blockers in code.
- **Schema-stable:** predicate vocabulary frozen at 9 entries. This epic does not propose new predicates.
- **Across-project read:** assumes `~/.claude/hive/projects.yaml` schema unchanged (path + name).
- **Tooling:** sqlite3 + node 18+ (existing baseline). ChromaDB option (A) requires `pip install chromadb` on consumer machines; option (B) requires `sqlite-vec` extension or pure-JS embedding store.
- **Memory:** `~/.claude/hive/kg.sqlite` already exists. No DDL changes required.
- **Methodology:** classic (per root `hive.config.yaml`).
- **Routing policy:** preserve current `agent_backends` — researcher/writer/architect on codex; tpm/reviewer/tester/specialists on Claude (per `feedback_codex_general_backend`).

---

## 5. Out of scope

- Predicate vocabulary expansion (e.g., `discussed`, `escalated`). Separate epic if needed.
- ChromaDB advanced search UX (semantic similarity over memories) — beyond bootstrap.
- In-product visualization of triples (graph view, timeline view).
- Dreaming-replay activation (separate inactive signal source; not this epic).
- Predicate emission from external systems (Linear, GitHub) — local Hive only.
- KG export to external graph DB (Neo4j, etc.).

---

## 6. Approach decisions taken in this doc (carry into outline)

- **Predicate scope:** 3 priority (`phase_failed`, `phase_blocked`, `superseded`) wired first; 5 secondary deferred until retrospection UX needs them. (Reduces R1 over-emission risk; aligns with consumer-contract-first principle from orphan tpm-brief-hv.md.)
- **Emission granularity knob:** SCALAR not boolean — `emit_lifecycle_at ∈ {phase, story, step, off}`. Default `phase`. The `off` value is the production kill-switch if R1 manifests. (TPM tightening.)
- **Write-rate observability lands EARLY:** counter increment alongside each `kg_write()` call ships in S1 (emit foundation), not S5 (telemetry). Without it, we can't detect R1 manifesting before S5. (TPM tightening.)
- **Backfill scope:** confirm `step-02c` lookback window in B2 H/V; align `--since` default to that value (90 days is current placeholder). Add `--dry-run` companion with diff-preview before `--apply`. (TPM tightening.)
- **Project to onboard:** Shindig Mobile (real signal); stub-seed fallback if Shindig isn't ready.
- **Methodology:** classic.
- **Order of operations:** Act I → Act II → Act III, but Act II's registry expansion can parallel Act I's emit-site wiring (independent subsystems).
- **Slice carving (TPM-proposed; writer to ratify in V-plan):**
  - B0: consumer-contract sliver (docs-only) — 1-2 stories
  - S1: KG schema confirmation + `phase_failed` emit at dag_executor fail path (one seam, one predicate) + write-rate counter
  - S2: `phase_blocked` + `superseded` emit (remaining 2 priority predicates)
  - S3: ChromaDB bootstrap (Decision 1 choice)         ┐ Act II
  - S4: registry expansion + `/hive:register-project` + backfill   ┘ parallel
  - S5: telemetry counters + miss-reason taxonomy + cycle rollup
  - S6: `/hive:why` retrospection UX (secondary predicates here iff UX needs them)
- **Min-viable-ship cut:** B0 + S1 + S2 + S5. Drops S3 (Chroma), S4 (registry), S6 (UX). Cross-project north-star then slips to follow-on; audit-trail north-star then slips to follow-on. Planning-signal north-star alone preserved.

---

## 7. Decisions deferred to user (open questions)

1. **ChromaDB bootstrap strategy.** (A) sidecar auto-start vs. (B) sqlite-vec in-process replacement. Trade: ops complexity vs. dependency footprint. **Recommendation:** (A) — lower risk; wrapper unchanged; sidecar code already designed for it. Pick (B) only if installing/running a Python sidecar on every consumer machine is a hard blocker.
2. **Predicate emission scope.** 3 priority only, or all 8? **Recommendation:** 3 priority for Act I; secondary predicates land in Act III ONLY if `/hive:why` retrospection UX needs them. Defer if no consumer.
3. **Retrospection UX surface.** `/hive:why <topic>` slash command + planning-skill helper + agent hook? **Recommendation:** slash command primary; planning-skill helper for `/plan` to pull "prior decisions on similar topics" inline; agent hook out of scope.
4. **Cross-project candidate.** Shindig Mobile real-import vs. stub-seed. **Recommendation:** Shindig Mobile if reachable + has `.pHive/cycle-state/`; stub-seed otherwise.
5. **S7-kg-signal-production-emission disposition.** **RECONCEPTUALIZE — not supersede/decouple/merge.** TPM read S7 in full: status is `completed: true, backfilled: true`. Its implement step explicitly says "No new code — this story is the epic's outcome claim". S7 was synthesized at retro as the prior epic's load-bearing outcome that never materialized in production (66 triples, zero in priority predicates). **S7 is the canary that triggered THIS epic.** This epic IS the implementation S7 implicitly demanded but didn't itself perform. Treat S7 as **Act I exit criterion**, not a story. Verification at Act I close: `SELECT COUNT(*) FROM triples WHERE predicate IN ('phase_failed','phase_blocked','superseded')` must return > 0. Saves a story; sharpens the loop-closure.
6. **Hit-rate success threshold.** Suggested 30% over 3 cycles. User to confirm or pick alternative.
7. **Telemetry placement.** `metric_registry.py` extension OR separate `.pHive/metrics/kg/` JSONL stream. **Recommendation:** `metric_registry.py` for counters + cycle-level rollups; `.pHive/metrics/kg/` for raw per-cycle audit trail (both, not one or the other).

---

## 8. Scale assessment

**Recommended scale:** **LARGE**

**Rationale:**

- Multi-system: writers in 4+ surface areas (dag_executor, execute skill, /plan, session-end), ChromaDB bootstrap, new slash command, registry expansion, telemetry instrumentation.
- 10-15 stories across 6-8 vertical slices.
- Long-horizon: Act III retrospection UX is its own slice. Cross-project onboarding is its own slice. Each can be released independently.
- Real risk surface (over-emission, contamination, backfill pollution) needs explicit story-level mitigation.

**Routing:**

- `--gate-hv`: not required (large scope auto-gates on H/V).
- `--fast`: would skip H/V — wrong call here; H/V is where the act sequencing gets locked.
- `--validate`: not required (no library/SDK churn).

**Scope-tightener note (TPM-flagged):** S6 (`/hive:why` retrospection UX) is the slice most likely to slip if the epic compresses. It's downstream of S5 telemetry and is the **audit-trail north-star's primary delivery surface**. If audit-trail is required in v1, S6 must stay in cut. If audit-trail is acceptable as "later", S6 drops without affecting the planning-signal north-star.

**Pre-exec escalations raised by TPM (cycle-state recorded):**
- `performance:audit` (moderate) — R1 over-emission write-volume projection + idx_predicate hot-path + ChromaDB sidecar startup latency. Specialist input before S1/S2 sequencing locks.
- `security:plan-audit` (minor) — cross-project boundary semantics for registry expansion. Specifically: does a Shindig `decided` triple naming an agent or file path leak meaningful information into plugin-hive proposals?

**Next phase:** B2 H/V planning. TPM owns; existing `tpm-brief-hv.md` is broadly aligned with this design discussion (TPM confirmed) — writer's V-plan builds on it without re-deriving.

---

## 8b. Dependency gaps for B2 H/V to resolve (TPM-flagged)

Two open dependency points the H/V plan must name explicitly:

1. **Hit-rate counter location.** Hit-rate (§2.4) requires step-03 merge data, not just step-02c emission. Either add a counter at step-03 merge OR synthesize by joining step-02c output + step-03 proposal pool. H/V plan must name the join site.
2. **Miss-reason discriminator surface.** Differentiating `empty_kg` from `empty_predicate_filter` from `recency_cutoff` requires the consumer to introspect the query it ran. step-02c may not expose enough state today. H/V must verify step-02c surfaces reason-discriminating fields OR add a thin observability layer.

## 9. Process note — caveats

- Phase A research was orchestrator self-research (codex dispatch did not land within polling window). Findings cross-checked against primary code reads (KG schema doc, session-end.js, step-02c file, chromadb-wrapper.js, projects.yaml, bootstrap script).
- Phase B writing is also orchestrator-fallback for same reason.
- This violates the codex backend routing in `hive.config.yaml`. Routing log entry recorded in research-raw.md §codex caveat.
- Recommended remediation BEFORE Phase B2: re-attempt codex dispatch for TPM brief revision (or accept Claude TPM and document deviation in cycle-state).
- Pre-existing `tpm-brief-hv.md` was written ahead-of-protocol in a prior session (without A/B inputs). TPM confirmed it is broadly aligned with this design discussion; reconcile in B2 by treating tpm-brief-hv.md's B0 + sub-layer analysis as already-validated input.

### Revision history

- **v1** 2026-05-13 23:08 — initial orchestrator-fallback draft.
- **v2** 2026-05-13 23:13 — incorporated TPM collab review feedback inline: (a) §6 slice carving + min-viable-ship cut + scalar granularity knob + early write-rate counter; (b) §7 S7 reconceptualization (Act I exit criterion, not story); (c) §8 scope-tightener for S6 (audit-trail surface); (d) §8b new dependency gaps for B2; (e) escalation flags raised + recorded in cycle-state.
- **v3** 2026-05-13 23:18 — user gate decisions locked (see §10).

## 10. User decisions locked (post-presentation gate)

Decisions ratified at the user gate. These are now closed; H/V planning builds on them.

| Decision | Locked choice |
|---|---|
| 1. ChromaDB bootstrap | **(A) Sidecar auto-start.** `hive/scripts/chromadb-start.sh` + SessionStart hook + pidfile/lockfile. Wrapper unchanged. |
| 2. S6 `/hive:why` retrospection UX | **Keep in v1.** Audit-trail north-star ships in this epic. Not deferred. |
| 3. Cross-project candidates | **Three projects:** Shindig Mobile + Signal Flayr + Tech Assistant. **Scope expansion:** Act II S4 onboards 3 projects, not 1. Backfill runs 3× independently. Cross-project signal corpus richer; rank-penalty more meaningful. |
| 4. Hit-rate success threshold | **Lowered to "any non-zero hit in next 5 cycles."** v1 success = pipeline produced ≥1 `kg_signal`-sourced proposal in ANY of next 5 cycles. Less aggressive than the 30%/3-cycle placeholder. |
| 5. Predicate scope | (no change from §6) 3 priority first; 5 secondary in S6 only if `/hive:why` surface needs them. |
| 6. Methodology | classic (per root `hive.config.yaml`). |
| 7. S7 disposition | Reconceptualized as Act I exit criterion (per v2 §7). |

### Scope impact

- **Story count revision:** was 8-12 stories realistic. Now ~10-14 with S4 expansion (3-project onboarding) + S6 retained + secondary-predicate conditional emission.
- **Slice S4 sub-stories:** likely 3-4 stories — (a) `/hive:register-project` skill, (b) Shindig onboarding + backfill, (c) Signal Flayr onboarding + backfill, (d) Tech Assistant onboarding + backfill. Or collapse (b)-(d) into one parameterized "onboard-and-backfill" story repeated 3×.
- **Cross-project security audit (escalation `security:plan-audit`):** scope expanded — boundary semantics now apply to 3 source projects, not 1. Specialist input becomes more important (still minor severity but broader surface).
- **Hit-rate-target lowering:** reduces telemetry pressure in S5. Per-cycle counters still needed, but threshold validation is "any cycle had ≥1 kg_signal proposal" — simpler to assert.
- **Min-viable-ship cut adjusts:** still B0+S1+S2+S5. S6 (audit-trail UX) is NOT in cut by definition but the user has elected to keep it in the full epic. If the epic compresses mid-execution, S6 is now the LAST drop (was second-to-last); S4 (cross-project) is the user-priority slice and stays.

### Open follow-on questions for B2 H/V

- Tech Assistant project path: where is it? Is it `.pHive/`-enabled? If not, onboarding may require kickoff for that project first. TPM should verify reachability of all three target projects before locking S4 sub-story count.
- Backfill `--since` per project: Signal Flayr + Tech Assistant may have different canon timelines than plugin-hive. Align with the EARLIEST project's predicate-canon date, not just step-02c's lookback window.
