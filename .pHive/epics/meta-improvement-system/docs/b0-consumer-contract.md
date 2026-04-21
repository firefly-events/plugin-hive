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

## 2. Consumer query shapes (B0.2)

This section names the three consumer queries the B-layer will ask of Epic C's data, and states — for each one — the inputs it reads, the answer it returns, the lifecycle decision it supports, and the cost expectation it places on the future metrics substrate. S2's schema freeze must make every query shape here answerable; S2 may choose storage-layout, indexes, and denormalization, but it may not add a new query without re-opening this contract.

The three queries are:

1. `baseline-vs-candidate` — the primary decision query for a single experiment.
2. `run-over-run` — the trend query across sequential experiments.
3. `delayed-regression-watch` — the post-close monitor that arms auto-revert.

These are the only three named consumer queries in the lean MVP contract. Q3's anti-over-engineering signal explicitly forbids adding analytics queries beyond what lifecycle decisions require; requests for richer analytics belong in a follow-on RFC, not in B0.

### 2.1 `baseline-vs-candidate`

- **Purpose:** answer "did this experiment's change measurably help or hurt relative to its baseline?" for one specific experiment.
- **Required inputs (from the envelope, per §1):** `baseline_ref`, `candidate_ref`, `metrics_snapshot`, `policy_ref`. Also reads `decision` to filter out experiments still in `pending` and `commit_ref` for attribution in the returned record.
- **Intended output:** a delta record with one entry per metric plus a verdict derived from the policy's threshold. Shape at the contract level: a small structure with one entry per metric containing baseline value, candidate value, delta, and an over/under-threshold flag, plus an overall `accept`/`reject` derived from `policy_ref`. S2 picks whether this is a single record, a row-per-entry table, or a nested struct.
- **Lifecycle decision supported:** the Step-06 evaluation write (accept vs reject) on the envelope's `decision` field. Also feeds the accept-path hand-off into Step-07 promotion.
- **Cost expectation: cheap.** One experiment = one baseline snapshot + one candidate snapshot + one policy lookup. S2 must make this a fixed small number of reads per experiment. Scan-over-history shapes are not acceptable for this query; they belong in `run-over-run` instead.

### 2.2 `run-over-run`

- **Purpose:** answer "across the last N experiments, is the system getting better, worse, or flat on each metric?" — the trend view a maintainer reads during standup or a meta-meta-optimize review.
- **Required inputs (from the envelope, per §1):** `baseline_ref`, `candidate_ref`, `metrics_snapshot`, and `decision` across a time-ordered or cycle-ordered sequence of envelopes. Does NOT read `policy_ref` — this is a trend query, not a decision query, and must not silently re-evaluate closed decisions.
- **Intended output:** one time-series (or delta-series) per metric over the requested window, plus count-by-decision (how many accepted vs rejected in the window). S2 picks whether this is aggregated server-side, returned as a raw series for client-side aggregation, or both.
- **Lifecycle decision supported:** the maintainer-facing review surface that feeds human judgement about meta-team health. Does not directly drive any automated write — the output is read by operators and by meta-meta-optimize's analysis step, not by the lifecycle library.
- **Cost expectation: moderate.** Bounded by the window size, not by total history. Agents must be able to cap the window (by count or by time range) and get a bounded-cost response. Full-history scans are not an intended shape; S2 should make them explicit if they are supported at all.

### 2.3 `delayed-regression-watch`

- **Purpose:** answer, continuously during each experiment's observation window, "is this experiment's post-close measurement drifting past its policy threshold, such that the auto-revert path must fire?"
- **Required inputs (from the envelope, per §1):** `metrics_snapshot` (the post-close snapshot being evaluated against the candidate baseline), `policy_ref` (the regression condition), `observation_window` (to determine whether the snapshot is still in-window), `regression_watch` (the arming-and-trip state), and `rollback_ref` (to hand to the auto-revert path on trip). Does NOT read `baseline_ref` or `candidate_ref` directly; the regression check is against the candidate's own post-close drift, not against the pre-candidate baseline.
- **Intended output:** a small status record per armed experiment: still-armed vs tripped. On trip, the record carries the snapshot reference that tripped the watch and the `rollback_ref` to pass to the auto-revert caller. S2 picks whether this is a synchronous query return or an event emission that the lifecycle library consumes.
- **Lifecycle decision supported:** the unconditional auto-revert behavior fixed by Q3. There is no human-confirm branch, no narrow-revert branch, no recommendation-only branch. Trip → lifecycle library reads `rollback_ref` → auto-revert executes → envelope's `decision` transitions to `reverted`. This query is the sole trigger of that transition.
- **Cost expectation: cheap per-arm, moderate in aggregate.** Each armed experiment contributes a bounded-cost check per observation-interval tick. Across all concurrently-armed experiments the cost grows linearly in the number of open windows, which the concurrency discipline (Q2: serial by default) already bounds. S2 must avoid shapes where a single trip check scans unrelated experiments' data; the query must be indexable on `regression_watch`-armed envelopes only.

### 2.4 Query-to-field consumer-map reconciliation

The per-query input lists in §2.1–§2.3 are the normative edition of the consumer-map table at §1.10. If a future diff introduces a mismatch between §1.10 and §2.1–§2.3, treat §2.1–§2.3 as the source of truth and correct §1.10 accordingly — the per-query sections name the fields explicitly in-context, while the table is a summary.

No field in the envelope is without a reader: `baseline_ref`, `candidate_ref`, `metrics_snapshot`, `policy_ref`, `decision`, `commit_ref` are consumed by the compare or trend queries (or by the closure validator); `observation_window`, `regression_watch`, `rollback_ref` are consumed by the watch query. Every field listed in §1 has either a query reader or a closure-validator precondition (or both). If S2 discovers it cannot answer one of the three queries from the fields enumerated here, escalate to re-open Q3 — do not silently add a field.

### 2.5 What B0.2 does NOT commit to

- **No fourth query.** The lean MVP contract has exactly three consumer queries. No aggregation-over-agents, no per-skill rollup, no cost-attribution query, no similarity-between-experiments query — each of those is follow-on work that must re-open scope.
- **No indexing or storage-layout guidance.** How S2 makes each query cheap is S2's choice. This contract only states the cost expectation, not the mechanism.
- **No concrete API surface.** Whether the query is exposed as a function call, a CLI command, a read from a materialized view, or a fold over a JSONL stream is a C1/B-L1 decision.
- **No windowing parameterization.** The trend-query window bound is stated qualitatively ("by count or by time range"). S2 picks the parameter shape and defaults.
- **No output serialization format.** Whether results are YAML, JSON, in-memory structs, or printed tables is S2's choice.
- **No concurrency-safety commitment.** The `delayed-regression-watch` query's aggregate cost assumes Q2's serial-by-default concurrency discipline; if future work enables parallel experiment execution (currently punted), that work owns re-validating this query's cost expectation.

## 3. Threshold and rollback policy-ref contract (B0.3)

This section pins the shape of the policy record that every `policy_ref` in §1.5 points at. It is still contract-level — no YAML keys, no validation rules. It defines (a) what the threshold knob is and is not, (b) the unconditional auto-revert behavior, and (c) how the compare and rollback-watch consumers read the policy to make their decisions. S2 freezes the syntax for this policy record; this section freezes the semantics S2's syntax must preserve.

### 3.1 Threshold: one lean knob

The threshold in the policy record is a **single knob**. Q3's sign-off language is verbatim: "no per-metric asymmetric-tolerance class system unless a concrete use case forces it." The lean MVP contract interprets this as the minimum shape that still answers the compare query's decision: a single scalar (or single-structure-equivalent) interpreted uniformly across all metrics.

What the knob IS at the contract level:

- **One value, applied across the MVP metric set.** The MVP metric set from Q8 (tokens per story, wall-clock per story, fix-loop iteration count, first-attempt review-pass flag, human escalation count) is the population the knob covers. S2 picks the exact numeric type (percent, ratio, absolute-delta ceiling) and whether the knob is rendered as a single field or a structurally-simple equivalent (for example, a relative-tolerance number with a sign convention).
- **Read by the compare query.** §2.1's `baseline-vs-candidate` computes a delta for each metric and applies the single-knob threshold to decide `accept`/`reject`. Uniform application is the point: one knob value governs all metrics in the snapshot.
- **Read by the rollback-watch query.** §2.3's `delayed-regression-watch` uses the same knob to decide whether a post-close snapshot has drifted far enough past the candidate's baseline to trip the watch.

What the knob is NOT:

- Not a per-metric class system. The policy record carries one knob, not a map of per-metric knob values. If a future concrete use case forces asymmetric tolerances (Q3's explicit escape hatch), that case re-opens Q3 and amends this contract; it does not quietly extend the lean shape.
- Not a branchy mode tree. The knob is a single comparable value, not a decision tree that routes different metrics to different comparators (ratio here, absolute there, percentile somewhere else). S2 picks one comparator semantics and uses it uniformly.
- Not two-sided/asymmetric at the contract level. A single lean knob implies one comparator used symmetrically; if asymmetric tolerance (e.g., "accept 5% token regression but reject any wall-clock regression") is later justified, it's a re-open, not a default.

### 3.2 Rollback: unconditional auto-revert

The rollback behavior in the policy record is **unconditional auto-revert**. Q3's sign-off language is verbatim: "If `regression_watch` flags a regression, the system reverts automatically. Do NOT build a three-class system (auto/human/narrow) — one behavior."

What the behavior IS at the contract level:

- **Single trigger condition:** the `delayed-regression-watch` query (§2.3) trips. When it trips, auto-revert fires. Nothing else triggers rollback from within the lifecycle; explicit maintainer-initiated rollbacks are a different surface (not an experiment-policy path) and are out of scope for B0.
- **Single revert target:** the envelope's `rollback_ref` (§1.7). No alternate target selection, no "revert to N-2" branch, no partial-revert.
- **Single terminal state:** the envelope's `decision` (§1.6) transitions to `reverted`. That transition is the sole write the auto-revert path performs on the envelope (S2 and S4/A2's step-07 own any other side effects — metrics, ledger, worktree-state).

What the behavior is NOT:

- Not a three-class system. No auto-revert-if-A-else-human-confirm-if-B-else-narrow-revert-if-C triage. One condition, one action.
- Not recommendation-only. When the watch trips, the revert is taken, not proposed.
- Not human-confirm-gated. No human gate between watch trip and revert execution.
- Not scope-selectable. The rollback always restores to `rollback_ref`'s target, not to a caller-chosen subset.

### 3.3 Policy-ref shape: how compare and rollback-watch consume it

The policy record pointed at by `policy_ref` is, at the contract level, a **two-field minimum**: the threshold knob (§3.1) and the rollback behavior identifier (§3.2). The rollback behavior field is singular because there is only one approved behavior; carrying it explicitly in the policy record is a forward-compatibility hook — if a future Q3 re-open adds a second rollback mode, the field already exists to carry the selector. S2 picks whether the rollback field is a string enum, a boolean, a nested struct, or omitted from the MVP record entirely (since the only legal value is auto-revert).

How each consumer reads the policy record:

- **`baseline-vs-candidate` (§2.1) reads the threshold field.** It does not read the rollback field — that field is not relevant to the accept/reject decision, only to the post-close behavior. This is load-bearing: a policy record change that affects only rollback semantics must not invalidate prior compare-query verdicts.
- **`delayed-regression-watch` (§2.3) reads the threshold field and the rollback field.** The threshold field names the regression condition (same scalar as compare uses, applied to the post-close snapshot's drift from the candidate baseline). The rollback field names the action on trip (in the MVP, always auto-revert; in the record carried for forward-compat, always `auto-revert` or its lean-record equivalent).
- **`run-over-run` (§2.2) does NOT read the policy record.** Confirmed at §2.2 and restated here for the policy-side view: the trend query must not silently re-evaluate closed decisions through a different policy. Historical envelopes carry the policy they were decided under; trend reads report those decisions as-written.
- **The closure validator (S4/A2.5) does NOT read the policy record.** Closure is a structural check (`commit_ref` + `metrics_snapshot` + `rollback_ref` + `decision` all present). Policy correctness is checked at decision time by the compare query, not at close time.

Policy-record versioning is S2's concern. If a policy record is edited in place between an experiment's decision and its observation-window close, the contract expectation is that each envelope carries a reference to the policy record *as it was at decision time* (typically via a version or hash). This contract does not pin the mechanism; it names the invariant: **the rollback-watch query evaluates against the same policy that drove the accept decision, not the current tip of the policy record.** S2 may satisfy this via immutable policy records, versioned records with immutable versions, content-addressed references, or equivalent.

### 3.4 Composition with §1 and §2

- `policy_ref` (§1.5) is the envelope field that binds an experiment to a policy record of the shape defined here. Every envelope field enumerated in §1.5 (including "lives external to the envelope to prevent per-experiment drift") is load-bearing for this section.
- `decision` (§1.6) enumerates `accept`, `reject`, `pending`, `reverted`. The `reverted` terminal state is written only by the auto-revert path defined here, confirming §1.6's "no mode tree" claim.
- `baseline-vs-candidate` (§2.1) and `delayed-regression-watch` (§2.3) are this section's only policy-consuming consumers. §2.4's reconciliation rule applies: if §3 and §2 diverge on what a consumer reads, §3 and §2 must be updated together — neither wins by default over the other, because the per-query field list in §2 and the per-policy consumption note in §3 are two views of the same contract.

### 3.5 What B0.3 does NOT commit to

- **No policy-record schema.** Field names, ordering, required-vs-optional, default values, validation rules are all S2.
- **No comparator algebra.** Whether the threshold is applied as `abs(delta) <= knob`, `delta / baseline <= knob`, normalized scores, or any other math is S2's choice, as long as the single-knob-uniformly-applied shape is preserved.
- **No auto-revert implementation details.** Whether the revert is `git revert`, `git reset --hard`, a worktree-discard, or a different mechanism is S4/A2 (step-07 promotion) and B-L1 (shared lifecycle library) territory, not B0.
- **No policy authorship UX.** How operators write a policy record (hand-edit, CLI, template fill-in) is kickoff / operator-surface territory, not B0.
- **No policy-change audit trail.** Whether policy-record edits emit events, are versioned, or carry a changelog is S2.
- **No recommendation-only mode, no human-confirm mode, no narrow-revert mode.** Restating §3.2's fence in the scope list for symmetry with §1.11 and §2.5: these modes are punted until a concrete use case forces them, and "forced" means a Q3 re-open, not an interpretation.

---

## References

- `.pHive/epics/meta-improvement-system/docs/user-decisions-dd.md` — Q3 (envelope fields, threshold policy, delayed-regression handling, closure invariant, anti-over-engineering signal); Q-new-C (execution split).
- `.pHive/epics/meta-improvement-system/docs/structured-outline.md` — Part 4 Phase S1 (slice goal, story list, file manifest, acceptance criteria).
- `.pHive/epics/meta-improvement-system/docs/vertical-plan.md` — Slice 1 (B0 consumer contract sliver, stories, layers touched, verified-by).
- `.pHive/epics/meta-improvement-system/docs/design-discussion.md` — approach summary and B0 rationale (referenced, not cited inline).
