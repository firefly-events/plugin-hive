# Cycle State Schema

The cycle state document is a structured, machine-readable file that accumulates decisions as a workflow runs. Every agent receives it as context — preventing re-debating settled decisions.

## Storage Path

```
.pHive/cycle-state/{epic-id}.yaml
```

Created at epic start, updated after each phase completes.

## Schema

```yaml
epic_id: my-epic
product_name: my-app
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

escalations:
  - trigger: security:plan-audit     # catalog entry ID — namespace:action
    placement: pre-exec              # pre-exec | post-exec | append
    severity: major                  # minor | moderate | major
    stories: [story-id-1, ...]       # topic areas at raise; backfilled to real IDs at plan step 11
    reason: "human-readable explanation"
    raised_by: architect             # agent persona name
    raised_at: "2026-04-11T09:15:00Z"  # ISO 8601; populated by orchestrator at extraction

naming:
  product: my-app
  package: com.example.myapp
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

`stories` field — required for `append` placement (empty list is invalid); informational for `pre-exec`/`post-exec` (empty list is valid — phase spawns regardless of story scope).

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
| `decisions` | list | Accumulated decisions — canonical format: `{phase, key, value, rationale, timestamp}`. Legacy files using `{decision, rationale}` shorthand update to canonical format on next orchestrator write — no bulk migration required. |

## Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `product_name` | string | Product name if applicable |
| `constraints` | list | Hard constraints that apply to all phases |
| `naming` | object | Naming conventions (product, package, API prefix, etc.) |
| `scope_boundaries` | object | Explicit in-scope and out-of-scope items |
| `technology` | object | Technology stack decisions |
| `linear` | object | Linear ticket ID mapping (see below) |
| `escalations` | list | Specialist team escalation flags raised during planning. See specialist-triggers.md catalog for valid trigger IDs. |

## Linear Ticket Tracking

The `linear` section maps Hive artifacts to Linear issue IDs. This is the source of truth — the orchestrator reads this instead of querying Linear for ID lookups.

```yaml
linear:
  epic_issue_id: "ACME-1"           # Linear parent issue for this epic
  user_id: "your-user-uuid-here"    # Cached user ID for assignment locking
  stories:
    task-tracking-integration:
      issue_id: "ACME-2"
      status: "In Progress"
      assignee: "your-user-uuid-here"  # null when unlocked
      branch: "acme-2-task-tracking-integration"
    daily-ceremony-workflow:
      issue_id: "ACME-3"
      status: "Todo"
      assignee: null
  bugs:
    - issue_id: "ACME-4"
      parent_story: "task-tracking-integration"
      status: "Done"
      title: "null check missing in payment validator"
```

### When Fields Are Written

| Field | Written During | By |
|-------|---------------|-----|
| `epic_issue_id` | Planning (epic parent created) | Orchestrator |
| `stories.{id}.issue_id` | Planning (story sub-issues created) | Orchestrator |
| `stories.{id}.status` | Each phase transition | Orchestrator/Team Lead |
| `stories.{id}.assignee` | Execution claim / session-end release | Orchestrator/Team Lead |
| `stories.{id}.branch` | Execution (branch created) | Team Lead |
| `bugs[]` | Fix loop (bug sub-issues created) | Test Sentinel / Orchestrator |
| `user_id` | Session start (resolved from config or linearis) | Orchestrator |

## Coexistence with `run_state.yaml`

The DAG executor (epic `hive-dag-executor`, story `hde-5`) introduces a **second** state file with a deliberately separate scope. The two files coexist; they do **not** mirror each other.

| File | Path | Scope | Owner | Lifetime |
|------|------|-------|-------|----------|
| `cycle-state.yaml` | `.pHive/cycle-state/{epic_id}.yaml` | Epic-level decision log accumulated across phases | Orchestrator (read by every agent prompt) | Persists with the epic |
| `run_state.yaml` | `.pHive/runs/{run_id}/run_state.yaml` | Per-workflow-execution durable state — node statuses, output graph, last successful node, failure info | DAG executor walker | Per executor invocation; may be cleaned up after completion |

### What lives where

| Concern | Cycle state | Run state |
|---------|-------------|-----------|
| User-gate decisions, sign-offs, escalations | yes | no |
| Per-story status (`pending` / `in_progress` / `done`) | yes | no |
| Per-node status within a single executor run (`running` / `completed` / `failed`) | no | yes |
| Materialized output graph for resume | no | yes |
| `last_successful_node_id` for `--resume` checkpoints | no | yes |
| Failure info captured at executor halt | no | yes |
| `schema_version` (pinned at 0 from day one) | no | yes |

### Why the split

`cycle-state.yaml` exists to keep agent prompts coherent across the lifetime of an epic — settled decisions stay settled. `run_state.yaml` exists to make a single executor invocation resumable without conflating that with the epic's decision log. Mixing them blurs ownership and bloats both files (Risk #4 in `hive-dag-executor` epic registry).

### The two files do not mirror each other

A node completing inside a single executor run writes to `run_state.yaml.node_statuses` and `run_state.yaml.output_graph` — the cycle state is unaffected. Conversely, a user-gate decision or escalation banked at planning time writes to `cycle-state.yaml` and never appears in any run_state. Code that needs to update both for the same data point is a sign of blurred ownership; route through the `hive.lib.dag_executor.run_state.store` narrow-mutation API for run-state writes and through the orchestrator's cycle-state writers for epic-level writes.
