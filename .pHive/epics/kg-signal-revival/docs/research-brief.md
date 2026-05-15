# Research Brief — KG Signal Revival

**Epic:** kg-signal-revival
**Date:** 2026-05-13
**Author:** orchestrator (writer fallback; codex writer dispatch not observed within window)
**Inputs:** `research-raw.md`, user diagnostic snapshot, primary code reads on develop.

---

## TL;DR

KG plumbing shipped over Phase 1 (`1.1.3`) and kg-augmented-meta-signal (`1.1.4`). Pipeline is cold for three independent reasons that all compound:

1. **Write side is silent on the predicates `/meta-optimize` actually queries.** step-02c reads `phase_failed`, `phase_blocked`, `superseded` — none are emitted in production. Only `decided` fires (66 triples, mostly architectural).
2. **L3 vector layer is unbootstrapped.** ChromaDB wrapper exists but its sidecar process is never started on this machine. All `chromadb.index()` calls during session-end silently no-op.
3. **No telemetry.** Zero counters on `discovery_source: kg_signal` proposals. Hit-rate is invisible. Miss-reason is uncatalogued.

Two adjacent gaps amplify the cold state:

- **Single-project registry.** Cross-project rank penalty (0.7×) has nothing to penalize.
- **No read-path UX.** Retrospection is `sqlite3` CLI gymnastics; no `/hive:why` or `/hive:decisions` exists.

---

## What's already built (don't rebuild)

| Surface | Path | Status |
|---|---|---|
| Predicate vocabulary + `predicates` FK table | `hive/references/knowledge-graph-schema.md` SQLite Bootstrap | Live, 9 predicates |
| `kg_write()` writer contract | `hive/references/knowledge-graph-schema.md` §kg_write Behavioral Contract; called from `hive/lib/session-end.js` | Live, idempotent, atomic |
| Session-end three-op (insight → kg → compile‖chroma) | `hive/lib/session-end.js` | Live; takes triples[] as caller param |
| Step-02c KG signal query + filter | `hive/workflows/steps/meta-team-cycle/step-02c-kg-signal.md` | Live, read-only |
| `kg-import-cycle-state.js` (cycle-state → triples) | `scripts/kg-import-cycle-state.js` (336L) | Live; on-demand |
| Multi-project bootstrap | `scripts/kg-bootstrap-from-projects.js` (252L) | Live; on-demand; idempotent |
| ChromaDB JSON-RPC wrapper | `hive/lib/chromadb-wrapper.js` (133L) | Live; sidecar must run on `localhost:8000` |
| step-03 merge accepting `discovery_source: kg_signal` | `hive/workflows/steps/meta-team-cycle/step-03-proposal.md` | Live |
| `meta_optimize.kg_signal` config + routing | `skills/hive/skills/meta-optimize/SKILL.md` | Live; `enabled: true` by default |

This epic is **NOT** "build the KG." It is **"connect the firing pins so the existing KG actually produces planning signal + decision audit trail + cross-project learnings."**

---

## What's missing (this epic's surface)

### 1. Lifecycle predicate write-sites are unhooked

| Predicate | Where it SHOULD fire | Where it fires today |
|---|---|---|
| `phase_started` | Story/step entry in execute workflow + DAG executor walker | nowhere |
| `phase_complete` | Story/step completion in execute + DAG completion + review-approve | nowhere |
| `phase_failed` | DAG fail path + tester fail verdict + reviewer reject + circuit-breaker trip | nowhere |
| `phase_blocked` | DAG upstream-skip + tpm escalation-raise + waiting-on-user gate | nowhere |
| `superseded` | `/plan` overwriting prior story + meta-optimize replacing proposal + insight-promotion replacing memory | nowhere |
| `assigned_to` | `TaskUpdate(owner=...)` hook | nowhere |
| `blocked_by` | `epic.yaml` story `depends_on`/`blocked_by` ingest | nowhere |
| `depends_on` | same ingest | nowhere |

Mechanism gap is at the CALLER side. `kg_write()` itself is correct.

### 2. ChromaDB sidecar bootstrap missing

`chromadb-wrapper.js` documents: *"The sidecar must be started separately (see kickoff-protocol.md Phase 5 for the nudge)."* The nudge is text-only. No `hive/scripts/chromadb-start.sh`, no SessionStart hook starts the sidecar, no health-check loop.

**Two viable bootstrap strategies — to be selected in design-discussion:**

- (A) Auto-start sidecar via a `chromadb-start.sh` invoked from SessionStart hook (or `/hive:kickoff` Phase 5). Pros: keeps existing wrapper unchanged. Cons: ops complexity (process lifetime, port collisions, restart on crash).
- (B) Replace ChromaDB with an in-process embedding store (sqlite-vec or sqlite-vss). Pros: no sidecar; one fewer moving part. Cons: rewrite `chromadb-wrapper.js` interior; lose batch ingest perf; embedding model selection now in-process.

### 3. Telemetry is dark

Step-02c writes `kg-findings.yaml` per cycle and logs a summary line. There is no:
- Cross-cycle counter (`proposals_from_kg_signal_total`, `proposals_accepted_from_kg_signal_total`)
- Hit-rate gauge
- Miss-reason taxonomy (`empty_predicate`, `recency_cutoff`, `project_tag_cutoff`)
- Decision trail (which step-03 proposal IDs traced to which kg-finding-{N})

Surface to add: counters in `skills/hive/skills/meta-optimize/metric_registry.py`, or a separate `.pHive/metrics/kg/` JSONL stream consumed by `/meta-optimize` retrospect.

### 4. Cross-project registry is a stub

`~/.claude/hive/projects.yaml` has one entry (plugin-hive). The 0.7× cross-project rank penalty in step-02c §4.3 has nothing to penalize. A 2nd project unlocks the cross-project signal pattern as designed.

Candidates: Shindig Mobile (active, Hive-enabled), Signal Flayr (if/when enabled), or a stub-seed populated from `.pHive/meta-team/` artifacts (controlled but synthetic).

### 5. No retrospection UX

`MemoryStore.query_decisions()` exists (one consumer: step-02c). No CLI, no slash command, no agent hook to ask "why did we decide X?" or "what supersedes Y?" The decision-audit-trail north star has a read-path but no surface.

---

## North-star mapping (per user input)

User selected **all three**:

- **Drive planning signal** → fixes (1) + (3) + (4). Lifecycle predicates fire → step-02c finds clusters → kg_signal proposals surface in `/meta-optimize`. Counters confirm hit rate >0.
- **Decision audit trail** → fixes (1) `decided`/`superseded` enrichment + (5) retrospection UX. `/hive:why <topic>` returns triples + provenance.
- **Cross-project learning** → fixes (4) registry expansion + the existing 0.7× rank penalty (no code change). Adds value once (1) is wired (cross-project failures cluster meaningfully).

All three share the (1)+(3) base — instrumentation + telemetry. Audit trail layers in retrospection UX. Cross-project layers in a 2nd registered project.

---

## Predecessor: S7-kg-signal-production-emission

`.pHive/epics/kg-augmented-meta-signal/stories/S7-kg-signal-production-emission.yaml` exists. The kg-augmented-meta-signal memory describes it as "added later — verify on-develop status during next meta-optimize cycle." Before this epic's design solidifies, the writer/TPM must read S7 and either:

- (a) Supersede S7: declare this epic absorbs it; mark S7 superseded.
- (b) Decouple: S7 lands independently first (narrower scope), this epic builds on its output.
- (c) Merge: pull S7's spec into this epic's S1 if scope overlaps cleanly.

Open question for design-discussion.

---

## Constraints + invariants to preserve

- `kg_write()` is idempotent via `idx_unique_triple(subject, predicate, object, source_epic)`. New emission paths MUST set `source_epic` to enable idempotent re-runs.
- `kg_write()` degrades silently when `kg.sqlite` unavailable. Callers must NOT depend on KG writes for correctness.
- Predicate vocabulary is FK-enforced. **No new predicates** without a schema migration + canonical-vocabulary update. Stretch goal "expand vocabulary" is a separate epic.
- Session-end Phase B is bounded by pre-shutdown 2-turn timeout. New caller-side triple assembly must complete in <100ms for 20 triples (per kg_write contract).
- step-02c is read-only. This epic's writes happen UPSTREAM of step-02c, never inside it.

---

## Risks (preview — design-discussion expands)

| Risk | Severity |
|---|---|
| Predicate over-emission floods kg.sqlite (e.g., every step-start fires `phase_started`, multiplied across stories × cycles → 10k+ triples/week) | Major |
| Cross-project signal contamination (Shindig "failures" surface as plugin-hive proposals) | Moderate |
| ChromaDB sidecar lifecycle (port conflicts, crash recovery, multiple sessions racing) | Moderate |
| Telemetry surface drift (counters added without `metric_registry.py` discipline → orphan metrics) | Minor |
| S7-kg-signal-production-emission scope collision (this epic re-implements S7 if not reconciled first) | Moderate |
| Backfill pollution (running `kg-bootstrap-from-projects.js` against historical Shindig epics imports decisions made under different conventions, biasing the recency window) | Moderate |

---

## Scale assessment

**Recommended: LARGE.**

User confirmed `Full vision incl. retrospection (~3 weeks)` with scope spanning instrumentation + bootstrap + telemetry + cross-project + retrospection UX.

- Multi-system: KG writers, ChromaDB sidecar, session-end, dag_executor, meta-optimize, multi-project registry, new slash-command surface.
- 10-15 stories likely across 6-8 vertical slices.
- Long-horizon: retrospection UX is its own thin slice; cross-project onboarding is its own slice.
- H/V planning + structured outline both required.

---

## Open questions (carry into design-discussion)

1. ChromaDB bootstrap: sidecar auto-start vs. in-process replacement?
2. Predicate emission scope: 3 step-02c-relevant only, or all 8?
3. Telemetry placement: `metric_registry.py` extension or `.pHive/metrics/kg/` separate stream?
4. Retrospection UX: `/hive:why` slash command, planning-skill helper, or both?
5. Cross-project candidate: Shindig Mobile real-import, Signal Flayr, or stub-seed?
6. S7-kg-signal-production-emission disposition: supersede, decouple, or merge?
7. Backfill scope on registry expansion: import full history or only last 90 days?
8. Hit-rate target threshold: what hit rate signals success? (current 0%; team-suggested 30%+ over 3 cycles?)
