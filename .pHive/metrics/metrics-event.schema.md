# Metrics Event Schema

**Epic:** meta-improvement-system
**Slice:** S2 (`C1.2`)
**Status:** draft
**Purpose:** Canonical schema reference for `.pHive/metrics/events/*.jsonl`.

## 1. Authority & scope

- **Binding authority:** [`.pHive/epics/meta-improvement-system/docs/horizontal-plan.md`](../epics/meta-improvement-system/docs/horizontal-plan.md) L3 field list (`event_id` through `source`) at line 77, plus the MVP metric set at lines 84-89.
- **Decision authority:** [`.pHive/epics/meta-improvement-system/docs/user-decisions-dd.md`](../epics/meta-improvement-system/docs/user-decisions-dd.md) Q1 at lines 12-13 affirms the dual-schema carrier; Q8 at lines 44-50 affirms the MVP metric set this schema must represent.
- **Consumer authority:** [`.pHive/epics/meta-improvement-system/docs/b0-consumer-contract.md`](../epics/meta-improvement-system/docs/b0-consumer-contract.md) §2 at lines 107-156 defines the three named query shapes that may read event-derived evidence: `baseline-vs-candidate`, `run-over-run`, and `delayed-regression-watch`.
- **Slice authority:** [`.pHive/epics/meta-improvement-system/docs/structured-outline.md`](../epics/meta-improvement-system/docs/structured-outline.md) Phase S2 at lines 224-257 requires an event schema doc with example-validation coverage.
- **Storage scope:** this schema governs only append-only event rows stored under `.pHive/metrics/events/*.jsonl`.
- **Out of scope for this file:** envelope-only concerns such as mutation rules, closure invariants, and `policy_ref` belong to `C1.3` and the experiment-envelope schema, not to event rows.

## 2. Record shape

Event storage is append-only JSONL:

- exactly one JSON object per line
- each line stands alone and must parse without reading any other line
- rows are appended; prior rows are not rewritten or edited in place
- rows do not carry cross-record references to other event rows

This file defines row shape only. File partitioning, retention, and runtime writer behavior are deferred.

## 3. Field definitions

### 3.1 `event_id`

- **Purpose:** stable identifier for a single event row.
- **Data shape:** string.
- **Cardinality:** required.
- **Example snippet:** `"event_id": "evt_2026-04-20T14:03:11Z_0001"`
- **B0 query readers:** may be read by `baseline-vs-candidate`, `run-over-run`, or `delayed-regression-watch` as row identity during evidence assembly; no row may use it as an in-row foreign key.

### 3.2 `timestamp`

- **Purpose:** event occurrence time for ordering and time-bounded reads.
- **Data shape:** ISO-8601 timestamp string.
- **Cardinality:** required.
- **Example snippet:** `"timestamp": "2026-04-20T14:03:11Z"`
- **B0 query readers:** may be read by all three B0 queries when ordering evidence or limiting reads to a run or observation window.

### 3.3 `run_id`

- **Purpose:** groups rows emitted during the same run.
- **Data shape:** string.
- **Cardinality:** required.
- **Example snippet:** `"run_id": "run_meta-meta-optimize_2026-04-20_001"`
- **B0 query readers:** may be read by `baseline-vs-candidate`, `run-over-run`, and `delayed-regression-watch` when reconstructing run-scoped evidence.

### 3.4 `swarm_id`

- **Purpose:** identifies which swarm produced the row.
- **Data shape:** string.
- **Cardinality:** optional.
- **Example snippet:** `"swarm_id": "meta-meta-optimize"`
- **B0 query readers:** may be read by `run-over-run` for cross-run grouping and by `baseline-vs-candidate` for attribution.

### 3.5 `story_id`

- **Purpose:** identifies the story context for story-scoped metrics.
- **Data shape:** string.
- **Cardinality:** one-of required with `proposal_id`.
- **Example snippet:** `"story_id": "C1.2"`
- **B0 query readers:** may be read by `baseline-vs-candidate` and `run-over-run` when reconstructing story-scoped measurements.

### 3.6 `proposal_id`

- **Purpose:** identifies the proposal or backlog item context when no story id applies.
- **Data shape:** string.
- **Cardinality:** one-of required with `story_id`.
- **Example snippet:** `"proposal_id": "backlog-017"`
- **B0 query readers:** may be read by `baseline-vs-candidate` and `run-over-run` when reconstructing proposal-scoped measurements.

### 3.7 `phase`

- **Purpose:** names the lifecycle phase that emitted the row.
- **Data shape:** string.
- **Cardinality:** optional.
- **Example snippet:** `"phase": "review"`
- **B0 query readers:** may be read by `baseline-vs-candidate` for source narrowing and by `run-over-run` for phase-level comparison.

### 3.8 `agent`

- **Purpose:** identifies the emitting actor or role.
- **Data shape:** string.
- **Cardinality:** optional.
- **Example snippet:** `"agent": "reviewer"`
- **B0 query readers:** may be read by `baseline-vs-candidate` and `run-over-run` for attribution when multiple actors contribute evidence.

### 3.9 `metric_type`

- **Purpose:** names the metric carried by the row.
- **Data shape:** string from the registry in §4.
- **Cardinality:** required.
- **Example snippet:** `"metric_type": "tokens"`
- **B0 query readers:** may be read by all three B0 queries to select the relevant event subset for metric reconstruction.

### 3.10 `value`

- **Purpose:** carries the metric measurement.
- **Data shape:** JSON number or JSON boolean, depending on `metric_type`.
- **Cardinality:** required.
- **Example snippet:** `"value": 4182`
- **B0 query readers:** may be read by all three B0 queries as the measurement payload.

### 3.11 `unit`

- **Purpose:** states the measurement unit paired with `value`.
- **Data shape:** string.
- **Cardinality:** required.
- **Example snippet:** `"unit": "tokens"`
- **B0 query readers:** may be read by all three B0 queries to interpret `value` correctly.

### 3.12 `dimensions`

- **Purpose:** carries low-cardinality context that refines the metric without adding new top-level fields.
- **Data shape:** JSON object with string keys and JSON scalar values.
- **Cardinality:** required; empty object allowed.
- **Example snippet:** `"dimensions": {"methodology": "classic", "direction": "combined"}`
- **B0 query readers:** may be read by `baseline-vs-candidate` and `run-over-run` for grouped comparison; `delayed-regression-watch` may read it when a watch is limited to a specific low-cardinality slice.

### 3.13 `source`

- **Purpose:** records the emitting source surface or artifact.
- **Data shape:** string.
- **Cardinality:** required.
- **Example snippet:** `"source": "agent-spawn-report"`
- **B0 query readers:** may be read by all three B0 queries for provenance and source filtering.

## 4. `metric_type` registry

The MVP event schema must represent these metric types and no extra registry shape is required for that coverage:

- `tokens`
  - Expected `value` type: number
  - Expected `unit`: `tokens`
  - Source note: emitted from token-usage evidence associated with a story or proposal run.
- `wall_clock_ms`
  - Expected `value` type: number
  - Expected `unit`: `ms`
  - Source note: emitted from elapsed wall-clock timing captured for a run or story boundary.
- `fix_loop_iterations`
  - Expected `value` type: number
  - Expected `unit`: `iterations`
  - Source note: emitted from execution or review loops that count corrective passes.
- `first_attempt_pass`
  - Expected `value` type: boolean
  - Expected `unit`: `bool`
  - Source note: emitted from the first review outcome for a story or proposal attempt.
- `human_escalation`
  - Expected `value` type: boolean
  - Expected `unit`: `bool`
  - Source note: emitted when a run records escalation to a human path.

## 5. Dimensions

`dimensions` is an open-key object for low-cardinality context such as `{"methodology": "tdd"}` or `{"direction": "combined"}`.

Anti-bloat rule:

- use `dimensions` for small grouping labels that remain stable across many rows
- do not place high-cardinality identifiers in `dimensions`
- if context needs stable identity, use a dedicated top-level field from the approved field list instead

## 6. Examples

Valid JSONL examples follow. Each line is a complete JSON object and is intended to be parseable as-is.

```json
{"event_id":"evt_2026-04-20T14:03:11Z_0001","timestamp":"2026-04-20T14:03:11Z","run_id":"run_meta-meta-optimize_2026-04-20_001","swarm_id":"meta-meta-optimize","story_id":"C1.2","phase":"implementation","agent":"developer","metric_type":"tokens","value":4182,"unit":"tokens","dimensions":{"methodology":"classic","direction":"combined"},"source":"agent-spawn-report"}
{"event_id":"evt_2026-04-20T14:11:42Z_0002","timestamp":"2026-04-20T14:11:42Z","run_id":"run_meta-meta-optimize_2026-04-20_001","swarm_id":"meta-meta-optimize","story_id":"C1.2","phase":"execute","agent":"tester","metric_type":"fix_loop_iterations","value":2,"unit":"iterations","dimensions":{"stage":"verification"},"source":"execute-phase-boundary"}
{"event_id":"evt_2026-04-20T14:18:09Z_0003","timestamp":"2026-04-20T14:18:09Z","run_id":"run_meta-meta-optimize_2026-04-20_001","swarm_id":"meta-meta-optimize","proposal_id":"backlog-017","phase":"orchestration","agent":"orchestrator","metric_type":"human_escalation","value":true,"unit":"bool","dimensions":{"reason":"scope-ambiguity"},"source":"orchestrator-escalation-path"}
```

## 7. Validation expectations for later emitters (S5)

Later emitters that write `.pHive/metrics/events/*.jsonl` must satisfy these invariants:

- every row is parseable JSON
- every row contains `event_id`, `timestamp`, `run_id`, `metric_type`, `value`, `unit`, `dimensions`, and `source`
- every row contains exactly one of `story_id` or `proposal_id`
- `event_id` is unique within a file
- no row references another row by `event_id`

These are schema-level invariants only. Deduplication primitives, if later introduced, belong to later slices rather than this document.

## 8. What this schema does NOT commit to

This schema does not commit to:

- retention or rotation policy
- storage file-partitioning rule such as per-run files or rolling daily files
- live emitter behavior
- hook sites
- index structure
- query execution plan
- envelope-only concerns such as mutation rules, closure handling, or `policy_ref`
