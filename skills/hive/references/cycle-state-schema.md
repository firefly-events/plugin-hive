# Cycle State Schema

The cycle state document is a structured, machine-readable file that accumulates decisions as a workflow runs. Every agent receives it as context — preventing re-debating settled decisions.

## Storage Path

```
state/cycle-state/{epic-id}.yaml
```

Created at epic start, updated after each phase completes.

## Schema

```yaml
epic_id: hive-phase7
product_name: Shindig
created: "2026-03-25T09:00:00Z"
updated: "2026-03-25T14:30:00Z"

decisions:
  - phase: research
    key: rendering_engine
    value: "Compose Multiplatform + SwiftUI"
    rationale: "KMP project — shared UI layer across platforms"
    timestamp: "2026-03-25T09:15:00Z"

  - phase: architecture
    key: api_protocol
    value: "REST with JSON"
    rationale: "Existing backend uses Express.js REST endpoints"
    timestamp: "2026-03-25T10:00:00Z"

constraints:
  - "Kotlin 2.0+ required (KMP compatibility)"
  - "Minimum iOS 16, Android API 28"
  - "No new backend dependencies without architect review"

naming:
  product: Shindig
  package: com.example.shindig
  api_prefix: /api/v1

scope_boundaries:
  in_scope:
    - "Event CRUD operations"
    - "RSVP flow"
  out_of_scope:
    - "Payment processing"
    - "Push notification infrastructure"

technology:
  frontend: "Kotlin Multiplatform + Compose"
  backend: "Node.js + Express"
  database: "MongoDB"
  testing: "Maestro (E2E), JUnit (unit)"
```

## How It Works

### Creation
At epic start, the orchestrator creates a minimal cycle state with `epic_id`, `created`, and any known constraints from the story specs.

### Updates
After each phase completes, the orchestrator extracts key decisions from the agent's output and appends them. Extraction targets:
- Technology choices ("we'll use X for Y")
- Naming conventions ("the component is called X")
- Scope decisions ("X is out of scope because Y")
- Architectural constraints ("X must use Y pattern")

### Injection
Every downstream agent receives the cycle state as a system-level constraint in their prompt. It goes before the task description so it acts as a frame, not an afterthought.

```
[System context — Cycle State]
The following decisions have been made and are not up for debate:
{cycle state YAML}

[Task]
{actual step instructions}
```

### Cross-Swarm Transfer
When a planning swarm hands off to a dev swarm, the cycle state transfers as part of the handoff. The dev swarm's agents receive all planning decisions as constraints.

## Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `epic_id` | string | Epic this state belongs to |
| `created` | string | ISO 8601 creation timestamp |
| `updated` | string | ISO 8601 last update timestamp |
| `decisions` | list | Accumulated decisions with phase, key, value, rationale, timestamp |

## Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `product_name` | string | Product name if applicable |
| `constraints` | list | Hard constraints that apply to all phases |
| `naming` | object | Naming conventions (product, package, API prefix, etc.) |
| `scope_boundaries` | object | Explicit in-scope and out-of-scope items |
| `technology` | object | Technology stack decisions |
