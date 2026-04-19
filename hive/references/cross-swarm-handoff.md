# Cross-Swarm Handoff Protocol

Defines how artifacts transfer between swarms (planning → dev → testing → security). Each swarm produces outputs that the next swarm consumes. The handoff carries structured context, not just document blobs.

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

naming:
  product: my-app
  package: com.example.myapp
```

## Status Lifecycle

```
pending → consumed → (done)
pending → expired  → (cleanup)
```

| Status | Meaning |
|--------|---------|
| `pending` | Handoff created, waiting for target swarm to pick up |
| `consumed` | Target swarm acknowledged receipt and loaded context |
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
3. Writes handoff YAML to `.pHive/handoffs/`
4. Status: `pending`

### Consuming a Handoff (target swarm)

When the next swarm starts (e.g., dev swarm kicks off):

1. Orchestrator checks `.pHive/handoffs/` for pending handoffs targeting this swarm
2. Loads all artifacts and injects cycle state as constraints
3. Updates handoff status to `consumed` with timestamp
4. Proceeds with execution using the handed-off context

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
