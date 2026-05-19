# Metrics-event schema (consumer entry point)

This is the discoverable `hive/references/` entry point for the metrics
event row schema. The authoritative field-by-field definition lives at
[`.pHive/metrics/metrics-event.schema.md`](../../.pHive/metrics/metrics-event.schema.md)
(epic `meta-improvement-system`, slice S2) — that file is binding for
row shape, partitioning, and validator behavior.

This page only documents fields that landed in `hive/lib/metrics/core.py`
later than the authoritative schema's slice authority and are not yet
back-ported into it. Cross-link rather than duplicate.

## `scope_drift_score`

Source story: [`ed-3-drift-metric-emit`](../../.pHive/epics/exec-discipline-may2026/stories/ed-3-drift-metric-emit.yaml).

| Aspect | Definition |
|--------|------------|
| `metric_type` | `scope_drift_score` |
| `unit` | `bucket` |
| `value` kind | `number` (ordinal 0..3 — see `hive/lib/scope_drift.BUCKETS`) |
| `value` mapping | `0=none, 1=minor, 2=major, 3=divergent` |
| `dimensions.bucket` | The human-readable label (same set: `none|minor|major|divergent`). Filter on this rather than re-deriving from the ordinal. |
| `dimensions.phase_label` | Phase boundary identifier — e.g. `plan:phase-a`, `execute:story-research`, `review:complete`, `standup:complete`. |
| `dimensions.skill` | Originating skill: `plan` / `execute` / `review` / `standup`. |
| `dimensions.delta_reasons` | Echo of the input `delta_reasons[]` enum (per `cycle-state-schema.md`). |
| Required scope key | One of `story_id` or `proposal_id` (XOR — the metrics core validator enforces this). `emit_scope_drift` defaults `proposal_id` to `"runtime:" + phase_label` when neither is passed. |

### Bucketing rules

Implemented in `hive.lib.scope_drift.compute_scope_drift`:

- `none` — `expected_scope` == `delivered_scope` (set equality).
- `minor` — small symmetric difference; overlap covers ≥ half of expected.
- `major` — scope-creep (`delivered ≥ 2× expected`) OR ≥ half of expected
  dropped without compensating reasons.
- `divergent` — empty overlap between two non-empty scope sets.

A `delta_reasons` entry of `"blocked"` caps the bucket at `minor` —
blocked is acknowledged work, not divergence
(story `ed-3-drift-metric-emit` AC5).

### Maturity gate

`scope_drift_score` is gated on the project's `project_maturity`
(`hive.lib.project_maturity.resolve_maturity` — story
`ed-1-maturity-helper`). Emit is skipped entirely for `greenfield` and
`early` projects; a skip-with-reason log line is printed at most once
per run id via `logging.getLogger("hive.lib.scope_drift")`.

The skip choice is intentional: greenfield projects produce zero rows
rather than `null` rows, keeping aggregations clean.

### Emit sites

| Skill | Boundary | `phase_label` |
|-------|----------|---------------|
| `/plan` | Phase C complete (story decomposition) | `plan:phase-c` |
| `/execute` | Story close (final phase boundary) | `execute:story` |
| `/review` | Review verdict displayed | `review:complete` |

See the **Scope-drift emit** section in each skill's `SKILL.md` for the
exact invocation pattern.

**Why so few?** Earlier drafts of `ed-3` wired emits at every named
phase boundary (`plan:phase-{a,b,b2,b3,c}`, `execute:{research,
implement, methodology}`, `standup:complete`) — ~46 events per epic.
Most were structurally `none` or `minor`: planning phases A/B/B2/B3
churn their artifacts as a *feature* of the methodology, and per-phase
execution drift is dominated by single-story-level signal anyway. The
retained sites are the three places where a divergence would change
what a human or aggregator does next: decomposition fidelity (`/plan`
Phase C), story delivery (`/execute` close), and review coverage
(`/review` complete).

### Programmatic surface

```python
from hive.lib.scope_drift import compute_scope_drift, emit_scope_drift

# Score only (no I/O, no gate, no event row):
result = compute_scope_drift(expected_scope, delivered_scope, delta_reasons)
# -> {"bucket": "minor", "ordinal": 1, "n_expected": 3, ...}

# Score + maturity-gated emit:
event = emit_scope_drift(
    run_id="run-123",
    phase_label="plan:phase-c",
    expected_scope=[...],
    delivered_scope=[...],
    delta_reasons=[...],
    skill="plan",
    proposal_id="my-epic",
)
# event is the appended dict, or None when the maturity gate skipped emit.
```

## See also

- [`hive/references/cycle-state-schema.md`](cycle-state-schema.md) —
  `phase_records[]` fields that feed `expected_scope`,
  `delivered_scope`, and `delta_reasons` (story `ed-2-handoff-schema`).
- [`hive/references/cross-swarm-handoff.md`](cross-swarm-handoff.md) —
  the same three fields at swarm boundaries, plus the shared
  `delta_reasons` enum.
- [`hive/references/project-profile.md`](project-profile.md) —
  `project_maturity` classification consumed by the gate
  (story `ed-1-maturity-helper`).
