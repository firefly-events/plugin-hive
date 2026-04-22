# Experiment Envelope Schema

**Epic:** meta-improvement-system
**Slice:** S2 (`C1.3`)
**Status:** draft
**Purpose:** Canonical schema reference for `.pHive/metrics/experiments/*.yaml`.

## 1. Authority & scope

- **Binding authority:** [`.pHive/epics/meta-improvement-system/docs/b0-consumer-contract.md`](../epics/meta-improvement-system/docs/b0-consumer-contract.md) §1 is the source of truth for lifecycle-facing envelope fields. This schema concretizes that contract into storage-facing rules and does not widen the contract field set.
- **Decision authority:** [`.pHive/epics/meta-improvement-system/docs/user-decisions-dd.md`](../epics/meta-improvement-system/docs/user-decisions-dd.md) Q3 fixes the lean envelope constraint, forbids per-metric threshold expansion, and fixes delayed-regression handling to unconditional auto-revert.
- **Slice authority:** [`.pHive/epics/meta-improvement-system/docs/structured-outline.md`](../epics/meta-improvement-system/docs/structured-outline.md) Part 4 Phase S2 requires a lean experiment-envelope schema with approved fields only, narrow update-in-place rules, and explicit closure handling.
- **Historical input:** [`.pHive/epics/meta-improvement-system/docs/horizontal-plan.md`](../epics/meta-improvement-system/docs/horizontal-plan.md) is historical planning input only. Where it drifts from B0, B0 wins for contract fields.
- **Storage scope:** this schema governs per-experiment YAML envelopes stored under `.pHive/metrics/experiments/*.yaml`.
- **Out of scope for this file:** append-only event rows belong to [`metrics-event.schema.md`](./metrics-event.schema.md); writer implementation, reader implementation, and query execution plans belong to later slices.

This file defines the storage-facing shape of one experiment envelope. It does not redefine the B0 lifecycle contract. B0 defines the lifecycle fields; this schema fixes how those fields are recorded under the metrics carrier.

## 2. Record identity & storage

One YAML file represents one experiment envelope:

- file location: `.pHive/metrics/experiments/{experiment_id}.yaml`
- file cardinality: exactly one envelope file per `experiment_id`
- storage rule: the file is updated in place only where this schema explicitly allows it
- default state: metrics storage remains OFF unless explicitly enabled at kickoff per `user-decisions-dd.md` Q-new-B

The envelope is split into two classes of fields:

1. **Record-identity and storage context fields**
2. **Contract fields**

This separation is intentional. `b0-consumer-contract.md` §1 is authoritative for lifecycle fields only. Three additional fields are required by the storage layer so that a file can be named, attributed, and scoped without changing the lifecycle contract:

### 2.1 Record-identity fields

#### 2.1.1 `experiment_id`

- **Purpose:** stable record identity for the envelope file.
- **Why it is not a contract field:** lifecycle readers reason about the experiment named by the envelope contents; the storage layer needs a stable id so the envelope can exist as a distinct YAML file.
- **Data shape:** string.
- **Cardinality:** required at create; immutable after create.
- **Storage note:** the filename stem must equal `experiment_id`.

#### 2.1.2 `swarm_id`

- **Purpose:** identifies which swarm owns the experiment record.
- **Why it is not a contract field:** it is orthogonal record-keeping context, not part of the B0 lifecycle decision surface.
- **Data shape:** string.
- **Cardinality:** required at create; immutable after create.
- **Storage note:** examples include `meta-meta-optimize` and `meta-optimize`.

#### 2.1.3 `target_ref`

- **Purpose:** identifies the repo, worktree, or target state the experiment is acting on.
- **Why it is not a contract field:** the lifecycle contract reasons about baseline, candidate, policy, close, and revert state; the storage layer still needs the experiment target recorded for attribution and file-local context.
- **Data shape:** reference string.
- **Cardinality:** required at create; immutable after create.
- **Storage note:** `target_ref` records the experiment target, not the revert target. Revert semantics are carried only by `rollback_ref`.

### 2.2 Record layout

The canonical envelope layout is a flat YAML mapping. No nested record sections are required. The separation between record-identity fields and contract fields is semantic, not structural:

```yaml
experiment_id: exp_2026-04-20_001
swarm_id: meta-meta-optimize
target_ref: repo:plugin-hive@worktree/meta-cycle-001
baseline_ref: snapshot:baseline/2026-04-20T13:55:00Z
candidate_ref: snapshot:candidate/2026-04-20T14:25:00Z
...
```

Writers may order keys differently, but review and later automation should treat the identity fields above as orthogonal record metadata rather than as extensions to the B0 contract field set.

## 3. Contract fields

The nine fields in this section are the complete contract field set from `b0-consumer-contract.md` §1. No additional contract fields are permitted in this schema.

Create-vs-after-create terminology:

- **required at create:** must be present when the envelope file is first written
- **may be absent at create:** allowed to appear later through the narrow transitions defined in §4
- **immutable:** once written, may not change
- **narrow-mutable:** may change only through the explicit transition rules in §4

### 3.1 `baseline_ref`

- **Purpose:** baseline anchor for comparison per `b0-consumer-contract.md` §1.1.
- **Data shape:** reference string.
- **Cardinality at create:** required.
- **Cardinality after create:** required and immutable.
- **Storage rule:** must point to the baseline measurement reference chosen when the experiment is created. It is never rewritten to point at a different baseline.

### 3.2 `candidate_ref`

- **Purpose:** candidate measurement reference per `b0-consumer-contract.md` §1.2.
- **Data shape:** reference string.
- **Cardinality at create:** required.
- **Cardinality after create:** required and immutable.
- **Storage rule:** identifies the candidate state being evaluated. Terminal bookkeeping does not rewrite this field.

### 3.3 `commit_ref`

- **Purpose:** closure-proof commit coordinate per `b0-consumer-contract.md` §1.3.
- **Data shape:** git commit SHA or equivalent repo-coordinate string.
- **Cardinality at create:** may be absent.
- **Cardinality after create:** required by closure; narrow-mutable until first set, then immutable.
- **Storage rule:** set when the experiment reaches a real decision-ready commit state. After first write, it is frozen.

### 3.4 `metrics_snapshot`

- **Purpose:** measurement evidence snapshot per `b0-consumer-contract.md` §1.4.
- **Data shape:** YAML mapping carrying the MVP metric set in a storage-facing container chosen by S2 writers. A minimal shape is a metric-name map with scalar values or small metric records.
- **Cardinality at create:** may be absent.
- **Cardinality after create:** required by closure; narrow-mutable until final close evidence is written, then immutable.
- **Storage rule:** this schema follows B0's single consolidated snapshot field for candidate-time evidence. The envelope does not split the evidence into additional contract fields.
- **Example shape:**

```yaml
metrics_snapshot:
  captured_at: 2026-04-20T14:25:00Z
  metrics:
    tokens_per_story: 4120
    wall_clock_ms: 284000
    fix_loop_iterations: 1
    first_attempt_pass: true
    human_escalation_count: 0
```

### 3.5 `policy_ref`

- **Purpose:** binds the envelope to the compare and rollback policy per `b0-consumer-contract.md` §1.5 and §3.
- **Data shape:** reference string.
- **Cardinality at create:** required.
- **Cardinality after create:** required and immutable.
- **Storage rule:** must refer to the policy version the experiment is decided under. This field is never rewritten in place to silently change the policy governing an existing experiment.

### 3.6 `decision`

- **Purpose:** lifecycle outcome per `b0-consumer-contract.md` §1.6.
- **Data shape:** small enum. Canonical values for this schema are `pending`, `accept`, `reject`, `reverted`.
- **Cardinality at create:** required.
- **Cardinality after create:** required; narrow-mutable.
- **Storage rule:** allowed transitions are limited to the decision graph in §4. No other decision values or branches are in scope.

### 3.7 `rollback_ref`

- **Purpose:** concrete revert target per `b0-consumer-contract.md` §1.7.
- **Data shape:** reference string.
- **Cardinality at create:** may be absent.
- **Cardinality after create:** required by closure; narrow-mutable until first set, then immutable.
- **Storage rule:** may be written at create if the revert target is already known, or written before closure when the revert target becomes concrete. After first write, it is frozen.

### 3.8 `observation_window`

- **Purpose:** bounds the delayed-regression watch interval per `b0-consumer-contract.md` §1.8.
- **Data shape:** YAML mapping describing a start time plus either duration or explicit end time.
- **Cardinality at create:** required.
- **Cardinality after create:** required and immutable.
- **Storage rule:** once the watch interval is defined for the experiment, it is not widened, narrowed, or replaced in place.
- **Example shape:**

```yaml
observation_window:
  start: 2026-04-20T14:30:00Z
  end: 2026-04-20T18:30:00Z
```

### 3.9 `regression_watch`

- **Purpose:** arming and trip state for delayed-regression handling per `b0-consumer-contract.md` §1.9.
- **Data shape:** boolean or small-state marker with optional trip evidence. This schema chooses a small YAML mapping to keep the armed/tripped state explicit without adding contract fields.
- **Cardinality at create:** required.
- **Cardinality after create:** required; narrow-mutable.
- **Storage rule:** starts armed for accepted experiments that are still in-window; may trip once and then remains in its terminal state.
- **Example shape:**

```yaml
regression_watch:
  state: armed
  tripped_by: null
  tripped_at: null
```

## 4. Mutation rules

This schema permits update-in-place only for the fields and transitions listed here. Any write outside these rules is out of contract for `.pHive/metrics/experiments/*.yaml`.

### 4.1 Immutable after create

The following fields are immutable once the envelope file is first written:

- `experiment_id`
- `swarm_id`
- `target_ref`
- `baseline_ref`
- `candidate_ref`
- `policy_ref`
- `observation_window`

These fields define record identity, experiment scope, baseline/candidate pairing, or policy binding. Rewriting them in place would change what experiment the file means rather than advance that experiment through a lifecycle.

### 4.2 Narrow-mutable fields

Only these fields may change after create, and only under the documented transitions:

- `decision`
- `regression_watch`
- `metrics_snapshot`
- `commit_ref`
- `rollback_ref`

#### 4.2.1 `decision` transition set

Allowed transitions:

- `pending -> accept`
- `pending -> reject`
- `accept -> reverted`

Forbidden transitions include:

- `reject -> accept`
- `reject -> reverted`
- `pending -> reverted`
- `accept -> reject`
- any transition from `reverted`
- any enum value outside `pending`, `accept`, `reject`, `reverted`

This follows `b0-consumer-contract.md` §1.6 and §3.2: the auto-revert path is the only path that writes `reverted`.

#### 4.2.2 `regression_watch` transition set

The canonical state flow is:

- initial create state: `state: armed`
- accepted and still in-window: remains `armed`
- trip event: transitions once to `state: tripped`
- reject path: may be recorded as `state: inactive` if the implementation writes a non-armed terminal state instead of leaving the initial value unchanged
- reverted path: remains terminal after trip

Constraints:

- once `tripped_by` or `tripped_at` is populated, those fields are append-only and may not be cleared
- a tripped watch does not return to `armed`
- the watch is not a branch point for human-confirmed or recommendation-only behavior

#### 4.2.3 `metrics_snapshot` write rule

`metrics_snapshot` is narrow-mutable only until close evidence is finalized:

- it may be absent at create
- it may be written later as the candidate-time measurement snapshot
- once closure conditions are satisfied, it is frozen

This schema treats `metrics_snapshot` as final-at-close rather than as an append-log. Append-only metric history belongs to event rows under `metrics-event.schema.md`, not to envelope mutation.

#### 4.2.4 `commit_ref` write rule

`commit_ref` is narrow-mutable only as a set-once field:

- it may be absent at create
- it may be written later when the experiment reaches a real commit-backed decision point
- after first write, it is immutable

This supports the closure invariant without permitting commit churn inside a single envelope.

#### 4.2.5 `rollback_ref` write rule

`rollback_ref` is narrow-mutable only as a set-once field:

- it may be present at create if the revert target is already known
- it may be written later before closure if the revert target is resolved after create
- after first write, it is immutable

This matches `b0-consumer-contract.md` §1.7: the envelope must close with a real revert target, but B0 does not force that target to be known at initial file creation.

### 4.3 Explicitly forbidden writes

The following are out of contract:

- ad hoc edits to any field not listed as narrow-mutable
- changing the meaning of an experiment by rewriting baseline, candidate, target, or policy references
- mutating `observation_window` after create
- clearing required closure evidence after the envelope has closed
- adding extra contract fields to compensate for missing evidence elsewhere
- using the envelope as an append-log for event history

## 5. Closure invariant

The closure invariant is non-optional. Per `b0-consumer-contract.md` §1.11, `b0-consumer-contract.md` §3.3, and `user-decisions-dd.md` Q3, closure requires structural evidence, not recommendation-only semantics.

Closure requires all of the following:

- `decision` present
- `commit_ref` present
- `metrics_snapshot` present
- `rollback_ref` present

This schema interprets the closure gate as a file-level invariant:

- an envelope is **open** if any one of the four closure requirements is absent
- an envelope is **closed** only when all four are present
- a closed envelope may still be in its observation window; closure does not disable delayed-regression watch behavior
- if delayed-regression watch trips after an accepted close, `decision` may transition from `accept` to `reverted`, but the closure evidence remains populated

No extra closure evidence is required by this schema. No human-confirmed close mode exists. No recommendation-only close mode exists. The closure gate is structural and non-bypassable.

## 6. Examples

### 6.1 Closed envelope at `accept`

This example shows a valid closed envelope with all record-identity fields, all B0 contract fields, a visible `policy_ref`, a bounded `observation_window`, and an armed `regression_watch`.

```yaml
experiment_id: exp_2026-04-20_001
swarm_id: meta-meta-optimize
target_ref: repo:plugin-hive@worktree/meta-cycle-001
baseline_ref: snapshot:baseline/2026-04-20T13:55:00Z
candidate_ref: snapshot:candidate/2026-04-20T14:25:00Z
commit_ref: 9e4f7d1ab6b8f8a7a8c4db2e4f7cd1a93de2c001
metrics_snapshot:
  captured_at: 2026-04-20T14:25:00Z
  metrics:
    tokens_per_story: 4120
    wall_clock_ms: 284000
    fix_loop_iterations: 1
    first_attempt_pass: true
    human_escalation_count: 0
policy_ref: policy:meta-improvement/default@2026-04-20
decision: accept
rollback_ref: git:commit/4c3a8fd7d9af2f4b1dce4b2f1e9aa7e8fb320100
observation_window:
  start: 2026-04-20T14:30:00Z
  end: 2026-04-20T18:30:00Z
regression_watch:
  state: armed
  tripped_by: null
  tripped_at: null
```

Read-path notes:

- compare-query entry points are `baseline_ref`, `candidate_ref`, `metrics_snapshot`, `policy_ref`, and `decision`
- rollback-watch entry points are `metrics_snapshot`, `policy_ref`, `observation_window`, `regression_watch`, and `rollback_ref`

### 6.2 Closed envelope at `reverted`

This example shows the same experiment after delayed-regression watch has tripped and the auto-revert path has written the terminal decision.

```yaml
experiment_id: exp_2026-04-20_001
swarm_id: meta-meta-optimize
target_ref: repo:plugin-hive@worktree/meta-cycle-001
baseline_ref: snapshot:baseline/2026-04-20T13:55:00Z
candidate_ref: snapshot:candidate/2026-04-20T14:25:00Z
commit_ref: 9e4f7d1ab6b8f8a7a8c4db2e4f7cd1a93de2c001
metrics_snapshot:
  captured_at: 2026-04-20T14:25:00Z
  metrics:
    tokens_per_story: 4120
    wall_clock_ms: 284000
    fix_loop_iterations: 1
    first_attempt_pass: true
    human_escalation_count: 0
policy_ref: policy:meta-improvement/default@2026-04-20
decision: reverted
rollback_ref: git:commit/4c3a8fd7d9af2f4b1dce4b2f1e9aa7e8fb320100
observation_window:
  start: 2026-04-20T14:30:00Z
  end: 2026-04-20T18:30:00Z
regression_watch:
  state: tripped
  tripped_by: snapshot:watch/2026-04-20T16:40:00Z
  tripped_at: 2026-04-20T16:40:00Z
```

This second example keeps the closure evidence intact while showing the only approved post-close terminal mutation: `decision: reverted` driven by the watch trip.

## 7. What this schema does NOT commit to

This schema does not commit to:

- a per-metric threshold class system
- alternative delayed-regression modes beyond unconditional auto-revert
- human-confirmed close semantics
- recommendation-only close semantics
- extra closure evidence beyond `decision`, `commit_ref`, `metrics_snapshot`, and `rollback_ref`
- storage layout beyond one YAML file per envelope under `.pHive/metrics/experiments/`
- live writer implementation or runtime hook sites
- query execution plans
- policy-record syntax beyond the fact that `policy_ref` points to it

The anti-drift fence is deliberate. If a future slice needs more than the identity fields plus the nine B0 contract fields, that change must re-open the signed decision surface rather than silently expanding this schema.
