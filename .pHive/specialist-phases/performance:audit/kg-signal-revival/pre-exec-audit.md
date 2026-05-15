# Performance Pre-Exec Audit — kg-signal-revival

**Reviewer:** performance-reviewer (Hive specialist)
**Date:** 2026-05-13
**Scope:** R1 (over-emission) write-volume projection + idx_predicate hot-path + ChromaDB sidecar startup latency + emitKgEvent() helper overhead + S4 backfill volume / 10k guardrail.
**Pre-exec gate:** stories S1.1, S1.2, S2.1, S2.2, S3.1 not yet implemented; reviewing planning artifacts only.

---

## Review Verdict: passed

The plan's R1 mitigations (phase-default knob + write-rate counter early in S1 + `off` kill-switch) are sized appropriately for the projected write volume. No critical performance issues warrant blocking S1 sequencing. Three improvement-level recommendations follow; none block execution.

---

## Findings

### 1. Write-volume projection

- **Per-cycle emit envelope (phase-default, after S2.2 ships):**
  - `phase_failed` (1 seam in S1.2 → 3 seams in S2.1's review pass): conservatively 0–5/cycle. walker.js `step.fail()` fires only on real failures; not per-step in happy path.
  - `phase_blocked` (3 seams: upstream-skip, TPM escalation-raise, waiting-on-user gate): 0–10/cycle. Gates dominate (most cycles have at least one waiting-on-user gate at plan presentation).
  - `superseded` (3 seams: /plan overwrite, /meta-optimize proposal-replace, insight-promotion): 0–5/cycle. Rare during normal cycles; spikes during re-plan.
  - **Envelope: 5–20 priority triples/cycle.**
- **Cycle cadence:** `.pHive/cycle-state/` has 28 epics over the project's ~3-month active history → roughly **3–4 cycles/week**.
- **Projected weekly write volume (priority predicates, phase-default):** **20–80 triples/week**. Sustained-state corpus growth in plugin-hive-only mode: ~1k–4k priority triples/year.
- **Comparison to current production:** 66 triples (all `decided`) over the prior epic's lifetime. Projection is **3–12× current within one quarter**, **15–60× within one year** — well within the design envelope that informed the schema decisions ("20 triples <100ms" is per-batch, not per-week ceiling).
- **Conditional secondary predicates (S6.3, deferred unless /hive:why surface needs them):** if `phase_started`+`phase_complete` ever wire at phase granularity, add ~10–30/cycle (2–4 phases × hit-rate per cycle). At `step` granularity they'd grow to 100s/cycle — **`step` granularity is the over-emission risk** the knob exists to cap. Phase-default is the right floor.
- **Assessment:** **acceptable.** Phase-default keeps the corpus within an order of magnitude of current, and the write-rate counter ships in S1.1 so any deviation surfaces in cycle 1, not at S5.
- **Recommendation:** No write-volume change. Document the projected envelope (5–20/cycle, 20–80/week) in `B0.1-consumer-contracts.md` as the **R1 detection envelope** — if S1.2's first cycle exceeds this, that is the explicit signal to pause S2 fanout or flip the `off` knob.

### 2. idx_predicate hot-path

- **Index structure:** `idx_predicate` is a non-unique B-tree on `triples(predicate)`. Predicate vocabulary is frozen at 9 distinct values (3 priority + 5 secondary + `decided`). Selectivity per predicate-equality lookup: ≈11% of corpus (skewed — `decided` will dominate; priority predicates each ≤5%).
- **step-02c read pattern (per `hive/workflows/steps/meta-team-cycle/step-02c-kg-signal.md`):** issues `WHERE predicate IN ('phase_failed','phase_blocked','superseded')` then applies recency window **client-side**. SQLite OR-of-equality on the index = three index range scans concatenated.
- **Volume sensitivity:**
  - At **10×** current (~660 rows): index scan returns ~75 rows for the 3-predicate IN — sub-ms.
  - At **100×** (~6.6k rows): ~750 rows returned, still <10ms on standard SSD.
  - At **1000×** (~66k rows): ~7.5k rows returned. Client-side recency filter then walks each row. Total query <100ms; client-side parse + recency reject = the dominant cost above ~10k matched rows.
  - At **10,000×** (~660k rows, far beyond projection): IN-scan still serves but client-side row iteration becomes the bottleneck (~1s+).
- **Crossover where idx_predicate "stops being effective":** the bottleneck is **NOT the index** — it's that the predicate filter alone is low-selectivity (9 cardinality values). The schema doc already notes that `idx_current` (partial index on `WHERE valid_until IS NULL`) is a deferred optimization. At projected one-year volume (~5k triples), nothing is needed.
- **Assessment:** **acceptable** at projected scale. The hot-path concern is theoretical at this volume.
- **Recommendation:** Add a single perf assertion to S5.3 (cycle rollup) — measure step-02c wall-clock per cycle and emit a `kg.step02c_query_ms` gauge. If that gauge ever crosses **50ms** in cycle telemetry, the design-doc's deferred `idx_current` partial index becomes the unblock; that's a one-line DDL story for a follow-on epic, not a v1 blocker.

### 3. ChromaDB sidecar startup latency

- **Cold-start cost (from `hive/lib/chromadb-wrapper.js` header comment):** Python sidecar startup ≈ **2 seconds**.
- **S3.1 SessionStart hook semantics (per story spec):** invoke `chromadb-start.sh`; **skip if `isAvailable()` returns true**. `isAvailable()` is a 500ms HTTP `/heartbeat` probe with graceful timeout (already implemented).
- **Hook blocking analysis:**
  - **Steady state (sidecar already running):** SessionStart hook does `isAvailable()` (≤500ms probe, typically <50ms) → skip. **Cost per warm session: ~10–50ms.** Acceptable.
  - **First session of the day (sidecar not running):** `isAvailable()` 500ms timeout → start script. **If the hook blocks on `chromadb-start.sh` waiting for `/heartbeat` to flip ready, that adds ~2s to session entry.** This is the dominant cost.
  - **Failure mode (Python missing, port collision):** `chromadb-start.sh` should detect and warn within 500ms–2s without hanging. S3.1 AC requires "Failed start emits warning to user, not hard error."
- **Risk:** Spec says "warn (not error) if start fails" but does NOT explicitly bound start-script wall-clock. If `chromadb-start.sh` polls `/heartbeat` with no timeout, a slow-to-start sidecar could block SessionStart for >5s in pathological cases.
- **Async vs sync option:**
  - **Sync (block on heartbeat-ready):** session feels sluggish on first launch each day.
  - **Async (fire-and-forget start; first ChromaDB query absorbs the cold-start):** SessionStart hook returns instantly, but the first `/hive:why` invocation in S6.1 eats up to 2s extra. Since `/hive:why` is interactive and infrequent, this is the better trade-off.
- **Failure handling cost:** if start fails, `isAvailable()` keeps returning false; wrapper degrades to empty array (`[]`) on query — already implemented. Per-call cost on the degraded path: one 500ms timeout per query. S6.1 should cache the `isAvailable()` result for the session to avoid 500ms penalty per `/hive:why` invocation when sidecar is down.
- **Assessment:** **acceptable with one improvement.** The plan is sound; what's missing is an explicit start-script timeout and async behavior preference.
- **Recommendation (P1, see table below):** Add two concrete bounds to S3.1 AC:
  1. `chromadb-start.sh` must return within **5s** (start the sidecar; do not block on its readiness — `isAvailable()` on next invocation confirms).
  2. SessionStart hook **does not wait** for sidecar readiness — launches start script in background. First ChromaDB consumer (S6.1) is responsible for the wait, gated by `isAvailable()` with at most a single 500ms probe (no retry loop).

### 4. emitKgEvent() helper overhead

- **Per-call composition (per S1.1 description):**
  1. Read `emit_lifecycle_at` knob — should be cached at module load, not re-read per call. **If re-read: ~50–500µs disk hit per emit.** If cached: ~100ns dict lookup.
  2. Short-circuit on `off`: trivial.
  3. Counter increment via `metric_registry`: in-process dict update or file-append; ~10–100µs depending on implementation.
  4. Call `kg_write()`: WAL transaction. Schema doc claims **<100ms for 20 triples** → ~5ms amortized per triple, but a single-triple write is closer to **2–5ms** dominated by fsync.
- **Per-emit total (single-triple, cached knob):** ~**2–5ms**.
- **Per-cycle wall-clock impact:** 5–20 emits × 5ms = **25–100ms total per cycle**. /meta-optimize cycles run minutes; this overhead is invisible.
- **Hot-path risk:** the only way this becomes measurable is if `emitKgEvent()` is called from an inner loop (e.g., per-step rather than per-phase). The `emit_lifecycle_at` knob defaulting to `phase` is precisely the guard against this.
- **Allocation concern:** S1.1 doesn't batch — each emit opens a WAL transaction. At phase-default (5–20/cycle) this is fine. If S6.3 ever lights up secondary predicates at `step` granularity, per-call WAL overhead becomes the bottleneck before idx_predicate does.
- **Assessment:** **acceptable.**
- **Recommendation (P2):** In S1.1 implementation, ensure the config knob is read **once at module load** (or cached on first call), not re-read per emit. Spec doesn't say either way; flag for reviewer pass. Also, document in `hive/references/kg-emit.md` that the helper is **not batching** — callers emitting >5 triples in a tight loop should call `kg_write()` directly with a batch.

### 5. Backfill volume + 10k guardrail (S4.2)

- **Source-project corpus estimate:**
  - plugin-hive prior epic produced 66 triples over months of activity.
  - Shindig + Signal Flayr + NTA each have 5–14 cycle-state epics per the H-plan pre-scan (`/Users/don/Documents/KMP/Shindig`, `ffe-social-engine` with 5 epics, NTA with 5 epics). Each project's likely triple density is similar to or lower than plugin-hive's (66 over ~28 epics ≈ 2.4 triples/epic).
  - **Projected backfill per project: ~10–50 triples** if scope is the canonical `--since predicate-canon-date 2026-04-28` (~2 weeks back at audit time). At full-history `--since` (unbounded): ~50–150 triples per project.
  - **Three projects combined, predicate-canon-date scope: ~30–150 triples backfill total.**
- **Comparison to 10k guardrail:** projection is **two orders of magnitude below the 10k guardrail**. The guardrail will never trip on the documented scope.
- **Is 10k the right threshold?**
  - **Too loose for catching bugs:** if a backfill script regression emits one triple per file/commit rather than per decision, 10k could be reached but most users would still confirm interactively. The guardrail is a "you-really-meant-it" check, not a quality gate.
  - **Right for catching accidents:** a finger-slip `--since 2020-01-01` or a glob-loop bug could easily produce 10k+ triples. The guardrail catches that class.
  - **One-order-of-magnitude tighter (1k) would be more diagnostic** given the actual projected volume (30–150). A backfill producing 1k triples in v1 would be a bug worth pausing for. But 1k may false-positive on legitimate large-history imports if users later remove the `--since` floor.
- **Assessment:** **acceptable but loose.** 10k won't trip; it's not the right "you've made a mistake" tripwire either.
- **Recommendation (P3):** In S4.2, **add a SECOND, softer warning at 1k** projected triples — log-only, no confirm-required. Reserve 10k for `--apply` block. Two-tier: 1k=warn, 10k=block. Costs nothing; catches the realistic regression class earlier.

---

## Recommendations (pre-exec, before S1 ships)

| ID | Severity | Recommendation | Stories affected |
|---|---|---|---|
| P1 | Improvement | S3.1: bound `chromadb-start.sh` wall-clock at 5s; SessionStart hook fires it in background (does not block on `/heartbeat` ready). First consumer (`/hive:why`) absorbs cold-start; cache `isAvailable()` result per session to avoid repeated 500ms probes when sidecar is down. | S3.1, S6.1 |
| P2 | Improvement | S1.1: cache `emit_lifecycle_at` knob at module load (not per-call disk read). Document in `kg-emit.md` that helper is non-batching — callers emitting >5 triples in a loop should call `kg_write()` directly. | S1.1 |
| P3 | Improvement | S4.2: add a soft warning tier at **1k** projected triples (log-only, no block) alongside the 10k hard guardrail. Catches realistic regression-class accidents that don't reach 10k. | S4.2 |
| P4 | Note | Document the **R1 detection envelope** (5–20 priority triples/cycle, 20–80/week at projected cadence) in B0.1 so S1.2's first-cycle counter reading has a published threshold to compare against. | B0.1, S1.2 |
| P5 | Note | Add a `kg.step02c_query_ms` gauge to S5.3 cycle rollup. Wall-clock observability for the idx_predicate hot-path so the partial-index DDL becomes data-driven, not speculative. | S5.3 |

---

## Open questions for execution team

- **Q1 (S1.1):** Is `metric_registry`'s counter increment in-process (dict) or persisted (file append)? If file-append, each emit gets an extra fsync; the helper overhead grows from ~2–5ms to ~5–10ms. Doesn't block, but informs P2's "cache once" advice.
- **Q2 (S1.2):** Does walker.js' `step.fail()` fire once per failed story (terminal) or once per failed step within a story (per-retry)? If per-step, R1 envelope grows to 10–40/cycle. The spec says "fail path" — assumed terminal in this projection. Confirm at S1.2 research step.
- **Q3 (S2.1):** TPM escalation-raise emits **one triple per story in `escalations[].stories[]`**. The current kg-signal-revival epic.yaml has two pre-exec escalations covering 5 + 5 = 10 affected_stories. If every pre-exec escalation event emits 5–10 triples, that single event could double the cycle's emit count. Acceptable, but flag for sanity-counter inspection in S2.1 review.
- **Q4 (S3.1):** Is `chromadb-start.sh` allowed to background-spawn the sidecar with `nohup`/`disown`, or must it block until ready? The spec is silent. P1 above assumes background-spawn is permitted.
- **Q5 (S5.3):** Cycle-rollup JSONL writes are append-only — confirm no per-event fsync; batch the cycle's events in memory and write once at retrospect step. Otherwise 5–20 fsync/cycle from the audit trail.

---

## Performance Risk Summary

Hot paths identified, estimated impact, and what needs to change:

1. **emitKgEvent → kg_write (S1+S2):** projected 5–20 emits/cycle = ~25–100ms cycle overhead. **No change needed** if knob is cached (P2).
2. **idx_predicate scan at step-02c (S6 read-path):** sub-ms at projected one-year corpus volume (~5k triples). **No change needed**; instrument with gauge (P5) for data-driven follow-on.
3. **ChromaDB SessionStart hook (S3.1):** **bound start script + non-blocking hook** is the one concrete change that prevents a 2–5s session-entry stall (P1). Most important pre-exec adjustment.
4. **Backfill (S4):** projected 30–150 triples total across three projects. **No change needed**; soft 1k warning (P3) is hygiene, not necessity.

All R1 mitigations in the plan (phase-default knob, write-rate counter shipped in S1.1 not S5, `off` kill-switch, performance:audit pre-exec) are correctly sized for the projected envelope. S1 sequencing can lock as planned.
