# Task Tracking Adapter

Interface for external task tracking tools (Linear, Jira, GitHub Issues). Items requiring human intervention are pushed to the tracker. The orchestrator surfaces pending items during standup as blockers.

## Adapter Interface

| Operation | Description |
|-----------|-------------|
| `createItem(item)` | Push a new item to the tracker |
| `updateStatus(id, status)` | Update an item's status |
| `listPending()` | List all items in the human-intervention queue |
| `markResolved(id, resolution)` | Mark an item as resolved with resolution notes |

## Item Schema

```yaml
id: auto-generated
title: "Review wireframe for event detail screen"
description: |
  The UI designer produced a wireframe that needs human approval.
  See: state/wireframes/hive-phase7/event-detail/v1.png
severity: medium          # critical, high, medium, low
source:
  epic: hive-phase7
  story: event-detail
  step: ui-design
  agent: ui-designer
assignee: null            # null = unassigned, or user ID
status: pending           # pending, in-progress, resolved, expired
created: "2026-03-25T10:00:00Z"
resolved: null
resolution: null          # free-text when resolved
```

## Queue Concept

Items go into a designated queue or swimlane in the tracker:
- **Queue name:** "Hive — Human Intervention" (configurable)
- **Swimlanes by severity:** Critical, High, Medium, Low
- Items auto-expire after a configurable period (default: 7 days) if unresolved

## When Items Are Created

Agents don't push items directly — the orchestrator or team lead creates them when:

- A quality gate escalates to human (low-confidence output)
- A touchpoint requires user approval (wireframes, plan confirmation)
- An agent identifies a blocker it can't resolve autonomously
- A story fails after retry exhaustion

## Standup Integration

During the daily standup ceremony, the orchestrator calls `listPending()` to surface:
- Items waiting for human input (blockers)
- Items recently resolved (unblocked work)
- Items approaching expiration (urgency)

## Implementations

### Linear (primary)

Uses the Linear CLI or API:
- Create issue: `linear issue create --title "..." --description "..." --team "Hive" --label "human-intervention"`
- List pending: `linear issue list --filter "label:human-intervention status:Todo,InProgress"`
- Update status: `linear issue update --id "..." --status "Done"`

### GitHub Issues (fallback)

Uses `gh` CLI:
- Create: `gh issue create --title "..." --body "..." --label "hive-intervention"`
- List: `gh issue list --label "hive-intervention" --state open`
- Close: `gh issue close ID --comment "..."`

### Configuration

In `hive.config.yaml` (future):
```yaml
task_tracking:
  adapter: linear          # linear, github, jira
  queue_name: "Hive — Human Intervention"
  auto_expire_days: 7
  # Linear-specific
  linear_team: "Hive"
  linear_label: "human-intervention"
```
