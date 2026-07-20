# Reconciliation artifact template

Written by story `wr-6-plan-drift-instrument`, consumed by the `/execute`
auto-firing reconciliation gate (see `skills/execute/SKILL.md`) and
`hive/lib/plan_drift.py`. When an epic declares `depends_on_epic` +
`planned_base_ref` (`hive/references/story-yaml-schema.md` § 6.5) and its
dependency's base has moved since planning, `/execute` requires one of
these before story 1 starts.

## Location

`${HIVE_STATE_DIR}/epics/{epic-id}/reconciliation.md`

## Shape

```markdown
# Reconciliation — Epic: {epic-id}

Depends on: {depends_on_epic}
Planned base ref: {planned_base_ref}
Current base ref: {current merge-base at reconciliation time}
Reconciled by: {persona/operator}
Reconciled at: {ISO 8601 timestamp}

## Deltas

- planned: {what /plan assumed the dependency epic would have delivered by
  planned_base_ref}
  actual: {what the dependency epic actually delivered by the current
  merge-base — read its epic.yaml / completion record}
  stories_touched: [{this epic's story-ids affected by the delta}]

- planned: {...}
  actual: {...}
  stories_touched: [{...}]
```

Zero deltas is a valid, expected outcome (the dependency landed exactly
what was planned) — the artifact is still written so the gate has
evidence reconciliation happened; it just has an empty `## Deltas` list.

## Field semantics

| Field | Meaning |
|---|---|
| `planned` | The assumption `/plan` made about the dependency epic at plan time — read from the design discussion, the dependency's planned story list, or the requirement text. |
| `actual` | What the dependency epic actually shipped, as of the current merge-base — read its own `epic.yaml` stories list, its completion records, or its shipped changelog entry. |
| `stories_touched` | The story-ids in THIS epic whose scope, sequencing, or acceptance criteria are affected by the delta. Empty list is valid (a delta noticed but with no story-level consequence). |

## Delta count -> metric

The number of entries under `## Deltas` is the `delta_count` passed to
`hive.lib.plan_drift.emit_plan_drift(run_id, epic_id, delta_count)`, which
emits one `plan_drift_delta_count` metric event (see
`hive/references/metrics-event.schema.md`) readable by `/metrics`. Zero
deltas still emits a `delta_count: 0` row — that is a real, informative
data point ("reconciled, nothing drifted"), not a skip.

## Evidence

Story `e9-reconciliation.md` (What's-For-Dinner E1-E10 campaign) recorded
4 deltas; 3 of the epic's 6 stories would have stalled on delta 3 alone had
reconciliation not happened before execution started. This template is the
generalized, framework-level version of that campaign artifact.
