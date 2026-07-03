# Cross-Swarm Handoff Protocol

> **State Directory Note:** Paths shown as `.pHive/...` assume the default
> state directory. If you have relocated state via `paths.state_dir`,
> substitute your configured location. See
> [state-relocation.md](state-relocation.md) (or
> `hive/references/state-relocation.md` from repo root).

Defines how artifacts transfer between swarms (planning → dev → testing → security). Each swarm produces outputs that the next swarm consumes. The handoff carries structured context, not just document blobs.

## Trust Boundary: SendMessage vs Filesystem Handoff

A team is an ephemeral, session-bound intra-session coordination unit. A swarm
is the wider phase-level unit that spans planning → development → testing →
security. A team is a strict subset of a swarm: team ⊂ swarm.

Use `SendMessage` for same-session teammates. It is the intra-team mailbox:
ephemeral, session-bound, and not auditable after the session ends. Use it for
coordination that only matters while the current team is alive, such as a lead
routing a bug report to an idle developer teammate.

Use filesystem handoffs for phase-to-phase or swarm-to-swarm transfer. A
handoff is cross-swarm, durable, and auditable: it is persisted to disk, survives
session boundaries, and can be reviewed through normal git history. That is why
cross-swarm coordination uses `.pHive/handoffs/{handoff-id}.yaml` instead of
`SendMessage`; the receiving swarm needs durable context, not a transient
mailbox message.

## Handoff Schema

```yaml
handoff_id: "planning-to-dev-hive-phase7"
source_swarm: planning
target_swarm: development
epic_id: hive-phase7
status: pending              # pending, consumed, expired
created: "2026-03-25T14:00:00Z"
consumed_at: null
expires_at: "2026-04-01T14:00:00Z"   # 7 days default

artifacts:
  - type: epic
    path: .pHive/epics/hive-phase7/epic.yaml
  - type: stories
    paths:
      - .pHive/epics/hive-phase7/stories/story-1.yaml
      - .pHive/epics/hive-phase7/stories/story-2.yaml
  - type: cycle_state
    path: .pHive/cycle-state/hive-phase7.yaml
  - type: wireframes
    paths:
      - .pHive/wireframes/hive-phase7/event-detail/approved.png

decisions:
  - key: api_protocol
    value: REST
    source_phase: architecture
  - key: test_framework
    value: Maestro
    source_phase: architecture

constraints:
  - "Kotlin 2.0+ required"
  - "No new backend dependencies"

expected_scope:
  - "Event CRUD endpoints (create, read, update, delete)"
  - "RSVP attach/detach flow"
  - "Event-list pagination"

delivered_scope:
  - "Event CRUD endpoints (create, read, update, delete)"
  - "RSVP attach/detach flow"

delta_reasons:
  - deferred                  # pagination pushed to next phase

naming:
  product: my-app
  package: com.example.myapp
```

### Scope-drift fields

`expected_scope`, `delivered_scope`, and `delta_reasons` quantify how
phase output compares to phase input. They are the data shape consumed by
the `scope_drift_score` metric (story `ed-3-drift-metric-emit`).

| Field | Type | Required when | Description |
|-------|------|---------------|-------------|
| `expected_scope` | `list[str]` | Before status flips to `consumed` | Items the source swarm declared they expected to deliver. Free-text bullets — one item per logical unit (endpoint, feature slice, decision, etc.). |
| `delivered_scope` | `list[str]` | Before status flips to `consumed` | Items the target swarm acknowledges were actually delivered. Free-text bullets matching the `expected_scope` granularity. |
| `delta_reasons` | `list[enum]` | Before status flips to `consumed` whenever the two scope lists diverge | One or more enum values explaining *why* delivered differs from expected. Empty list when the two scopes match exactly. |

All three fields are **optional on initial write** (source swarm may
create the handoff with `expected_scope` only and leave the other two
empty) and **required before the handoff transitions to `consumed`** —
the target swarm fills `delivered_scope` and any `delta_reasons` as part
of consuming.

### `delta_reasons` enum

Values are identical in [cycle-state-schema.md](cycle-state-schema.md).
The enum is **additive** — new values may be introduced in a follow-up
patch story without bumping any major schema version. Consumers MUST
ignore unknown values gracefully rather than rejecting the document.

| Value | Meaning |
|-------|---------|
| `rescope` | Phase was explicitly rescoped mid-flight by planner direction; expected_scope shifted before delivery. |
| `scope-creep` | Phase delivered MORE than expected without an explicit rescope. |
| `deferred` | Expected item was intentionally moved to a later phase or story. |
| `blocked` | Expected item could not be delivered due to an external block (dependency unmet, infra unavailable); acknowledged drift, not silent loss. |
| `misunderstood-ac` | Acceptance criterion was interpreted differently than authored; delivered work does not match author intent. |
| `out-of-band-work` | Work landed that was not in any `expected_scope` (e.g., emergency fix during research). |

## Status Lifecycle

```
pending → consumed → (done)
pending → expired  → (cleanup)
```

| Status | Meaning |
|--------|---------|
| `pending` | Handoff created, waiting for target swarm to pick up |
| `consumed` | Target swarm acknowledged receipt, loaded context, and populated `delivered_scope` + any `delta_reasons` |
| `expired` | Not consumed within expiration window |

## Storage

```
.pHive/handoffs/{handoff-id}.yaml
```

## How It Works

### Creating a Handoff (source swarm)

After a swarm completes (e.g., planning finishes all stories):

1. Orchestrator packages: epic, stories, cycle state, wireframes, and any other artifacts
2. Extracts key decisions and constraints from cycle state
3. Declares `expected_scope` — what the source swarm believes it is handing over
4. Writes handoff YAML to `.pHive/handoffs/`
5. Status: `pending`

### Consuming a Handoff (target swarm)

When the next swarm starts (e.g., dev swarm kicks off):

1. Orchestrator checks `.pHive/handoffs/` for pending handoffs targeting this swarm
2. Loads all artifacts and injects cycle state as constraints
3. Populates `delivered_scope` (what the target swarm acknowledges receiving) and, when it diverges from `expected_scope`, one or more `delta_reasons`
4. Updates handoff status to `consumed` with timestamp
5. Proceeds with execution using the handed-off context

### Chained Workflows

```
Planning Swarm → [handoff] → Dev Swarm → [handoff] → Test Swarm
                                                    → [handoff] → Security Swarm
```

Each handoff carries forward the accumulated cycle state, so downstream swarms have the full decision history.

## Handoff vs Cycle State

- **Cycle state** = accumulated decisions within a single swarm's execution
- **Handoff** = packaging of cycle state + artifacts for transfer to another swarm

The handoff includes the cycle state but also adds: artifact paths, explicit constraints, and naming conventions that the target swarm needs.
