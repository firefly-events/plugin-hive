# B0 Consumer Contract

**Epic:** meta-improvement-system
**Slice:** S1 (B0 — Consumer Contract Sliver)
**Status:** draft (B0.1 complete — B0.2 and B0.3 append below when authored)
**Purpose:** Freeze the reader/consumer expectations that Epic C's metrics substrate (S2) must satisfy. This doc is a contract, not a schema. S2 authors the syntax; this doc constrains what S2 must cover.

This contract is documentation-only. No code, hooks, config, or schema files land in S1.

## Authority and scope

- **Binding source:** `user-decisions-dd.md` Q3 (experiment envelope contract, signed 2026-04-19) and Q-new-C (execution split, signed 2026-04-20).
- **Slice authority:** `vertical-plan.md` Slice 1 and `structured-outline.md` Phase S1.
- **Anti-over-engineering invariant (Q3):** the envelope field set is minimal, the threshold knob is singular, and rollback behavior is unconditional. Any proposal that adds per-metric threshold classes, alternate rollback modes, or envelope fields not enumerated here is out of scope for B0 and must be escalated rather than quietly added.
- **Out of scope for S1:** YAML syntax, JSON Schema, storage-layout choices, writer/reader primitives, emission hooks, config keys — all of those belong to S2 and later slices.

## 1. Experiment envelope — field outline (B0.1)

The experiment envelope is the per-experiment record that the meta-experiment lifecycle library (Epic B-L1) reads and writes as a cycle progresses from proposal through closure. Every field listed here was explicitly approved in Q3. No other fields appear in the lean MVP contract.

For each field, this section states: **name**, **data shape** (at the contract level — strings are strings, references are references, timestamps are ISO-8601; S2 picks exact types), **purpose** (why the lifecycle needs it), and **consumer usage** (which of the three named consumer queries reads it; the query names come from B0.2 below when that section lands).

### 1.1 `baseline_ref`

- **Shape:** reference string (points to a prior measurement snapshot; the exact reference format — path, hash, composite key — is S2's decision).
- **Purpose:** identifies the measurement baseline against which this experiment's candidate state is compared. Without it, there is no anchor for the "did this change help" question.
- **Consumer usage:** read by `baseline-vs-candidate` and `run-over-run`. Not read by `delayed-regression-watch` (which operates on the post-close observation interval, not the pre-candidate baseline).

### 1.2 `candidate_ref`

- **Shape:** reference string (points to the experiment's post-change measurement snapshot; same format class as `baseline_ref`).
- **Purpose:** identifies the candidate state produced by the experiment's change. Paired with `baseline_ref`, it is the raw input for every baseline-vs-candidate comparison.
- **Consumer usage:** read by `baseline-vs-candidate` and `run-over-run`.

### 1.3 `commit_ref`

- **Shape:** git commit SHA or equivalent repo-coordinate reference.
- **Purpose:** proves the experiment was exercised against a real commit, not a synthetic or simulated state. Codex audit §3.6 flagged `commit: TBD` as an integrity break in historical cycles; the closure invariant (Q3) requires this field be populated before a cycle may close.
- **Consumer usage:** read by `baseline-vs-candidate` (for "what commit did we test?" attribution) and by the closure validator (S4/A2.5) as a precondition for ledger append. Not read by the three query shapes directly.

### 1.4 `metrics_snapshot`

- **Shape:** structured snapshot of the MVP metric set captured at candidate time. The five MVP metrics (per Q8 provisional set, deferred to orchestrator) are tokens per story, wall-clock per story, fix-loop iteration count, first-attempt review-pass flag, and human escalation count. The snapshot carries values; S2 picks the exact container shape.
- **Purpose:** the evidence layer for every consumer query. Without the snapshot, the envelope has references but no measurements, and comparison is impossible.
- **Consumer usage:** read by all three named queries — `baseline-vs-candidate` (direct compare), `run-over-run` (multi-snapshot sequencing), `delayed-regression-watch` (regression detection against post-close snapshots).

### 1.5 `policy_ref`

- **Shape:** reference string pointing to the policy record that governs this experiment's accept/reject semantics. B0.3 (below, when authored) pins the shape: one lean threshold knob plus unconditional auto-revert. This field is how an envelope binds to that policy.
- **Purpose:** tells the compare consumer how to interpret the snapshot delta (does a 3% token regression matter?) and tells the rollback-watch consumer what regression condition triggers auto-revert. Keeping policy external — not inlined per-envelope — prevents per-experiment policy drift.
- **Consumer usage:** read by `baseline-vs-candidate` (to evaluate delta against the policy's threshold) and by `delayed-regression-watch` (to evaluate post-close regressions against the same policy). `run-over-run` does not consume `policy_ref` directly; it is a trend query, not a decision query.

### 1.6 `decision`

- **Shape:** enumerated value from a small fixed set: `accept`, `reject`, `pending`, `reverted`. (S2 may refine names, but the cardinality is this small — anti-over-engineering invariant forbids a mode tree.)
- **Purpose:** records the lifecycle outcome of the experiment. `pending` covers the window between candidate measurement and the policy-driven decision. `reverted` is written only by the auto-revert path (Q3 delayed-regression handling).
- **Consumer usage:** read by `baseline-vs-candidate` (to filter closed experiments from pending ones) and by `run-over-run` (to distinguish accepted candidates from rejected ones when sequencing). The closure validator (S4/A2.5) also reads `decision` as part of the non-bypassable closure gate.

### 1.7 `rollback_ref`

- **Shape:** reference string pointing to the state that a revert would restore. For worktree-native isolation (Q4), this is typically the pre-candidate commit; S2 picks the exact representation.
- **Purpose:** proves a real revert target exists. The closure invariant (Q3) requires `rollback_ref` be populated before a cycle may close — a cycle without a revert target is not closable, because the delayed-regression-watch path has nothing to revert to if it later triggers.
- **Consumer usage:** read by `delayed-regression-watch` (this is the target the auto-revert path restores to). Not read by `baseline-vs-candidate` or `run-over-run`. Also read by the closure validator as a precondition.

### 1.8 `observation_window`

- **Shape:** time-bounded window descriptor (start timestamp + duration, or start + end timestamps; S2 picks). Closed by the meta-experiment lifecycle library at the end of the post-close watch interval.
- **Purpose:** bounds the interval during which `delayed-regression-watch` is armed for this experiment. Without a bounded window, the watch cannot terminate and cycles cannot fully close.
- **Consumer usage:** read by `delayed-regression-watch` (to determine whether a new snapshot is in-window for regression detection). Not read by `baseline-vs-candidate` or `run-over-run`.

### 1.9 `regression_watch`

- **Shape:** boolean or small-state marker indicating whether this experiment is currently armed for delayed-regression detection, plus (on trip) the snapshot reference that tripped the watch. S2 picks whether this is a composite field or two sub-fields — both satisfy the contract.
- **Purpose:** the hand-off between the watch phase and the auto-revert path. When tripped, the lifecycle library reads `rollback_ref` and executes the unconditional auto-revert (Q3 delayed-regression handling). There is no human-confirm branch and no narrow-revert branch; the single behavior is auto-revert.
- **Consumer usage:** read and written by `delayed-regression-watch`. Not read by `baseline-vs-candidate` or `run-over-run`.

## 1.10 Field-to-query consumer map (summary)

The nine fields above map into the three named consumer queries as follows. This table exists so an S2 schema author can check, at a glance, that every field in the envelope is justified by at least one reader. Query definitions themselves are authored in B0.2 (§2 below, when that section lands).

| Field                | baseline-vs-candidate | run-over-run | delayed-regression-watch | Closure validator |
|----------------------|:---------------------:|:------------:|:------------------------:|:-----------------:|
| `baseline_ref`       | read                  | read         | —                        | —                 |
| `candidate_ref`      | read                  | read         | —                        | —                 |
| `commit_ref`         | read (attribution)    | —            | —                        | required          |
| `metrics_snapshot`   | read                  | read         | read                     | required          |
| `policy_ref`         | read (threshold)      | —            | read (trigger)           | —                 |
| `decision`           | read (filter)         | read         | —                        | required          |
| `rollback_ref`       | —                     | —            | read (target)            | required          |
| `observation_window` | —                     | —            | read                     | —                 |
| `regression_watch`   | —                     | —            | read/write               | —                 |

Every field is consumed by at least one query or by the closure validator. No field is defined here that lacks a reader. If S2 proposes adding a field not in this list, the escalation path is back to Q3, not forward into the schema freeze.

## 1.11 What B0.1 does NOT commit to

For the avoidance of doubt (and to preserve the anti-over-engineering invariant):

- **No per-metric threshold classes.** The policy-ref shape in §3 (B0.3) pins a single lean knob. Per-metric asymmetric-tolerance classes are explicitly punted by Q3 until a concrete use case forces them.
- **No alternate rollback modes.** The only delayed-regression behavior is auto-revert. No human-confirm, no narrow-revert, no recommendation-only.
- **No extra envelope fields.** The nine fields above are the complete lean MVP envelope. Any addition is a Q3 re-open, not a B0 drafting decision.
- **No syntax commitment.** This doc does not specify YAML keys, JSON property names, required-vs-optional at the schema level, default values, or validation rules. Those are S2's decisions (`.pHive/metrics/experiment-envelope.schema.md`), constrained by what this contract enumerates.
- **No storage-layout commitment.** Whether envelopes live as one file per experiment, one file per cycle, or in a single append-only ledger is an S2 choice, not a B0 choice.

---

## 2. Consumer query shapes (B0.2 — pending)

_To be authored by B0.2. Will define `baseline-vs-candidate`, `run-over-run`, and `delayed-regression-watch` with inputs, outputs, and cost classification._

## 3. Threshold and rollback policy-ref contract (B0.3 — pending)

_To be authored by B0.3. Will pin the single-knob threshold shape and unconditional auto-revert semantics, with consumption points in compare and rollback-watch._

---

## References

- `.pHive/epics/meta-improvement-system/docs/user-decisions-dd.md` — Q3 (envelope fields, threshold policy, delayed-regression handling, closure invariant, anti-over-engineering signal); Q-new-C (execution split).
- `.pHive/epics/meta-improvement-system/docs/structured-outline.md` — Part 4 Phase S1 (slice goal, story list, file manifest, acceptance criteria).
- `.pHive/epics/meta-improvement-system/docs/vertical-plan.md` — Slice 1 (B0 consumer contract sliver, stories, layers touched, verified-by).
- `.pHive/epics/meta-improvement-system/docs/design-discussion.md` — approach summary and B0 rationale (referenced, not cited inline).
