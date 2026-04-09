---
name: status
description: Check the status of active Hive workflow epics and stories.
---

# Hive Status

Report the status of active workflow epics.

**Input:** `$ARGUMENTS` optionally contains an epic ID to filter to a single epic.

This command is **read-only** — it never modifies state files. It is safe to run while a workflow is executing in another session.

## Kickoff Gate

**Before doing anything else**, check whether Hive has been initialized for this project:

1. Check if `state/project-profile.yaml` exists in the project root
2. If it exists, verify it has a populated `tech_stack` field (not empty, not null)
3. As a secondary check, verify `hive.config.yaml` exists (check both `hive/hive.config.yaml` and `hive.config.yaml` in the project root — either location is valid)

If **any** of these checks fail, display this message and **stop** — do not proceed with status check:

> Hive hasn't been set up for this project yet. Run `/hive:kickoff` first — it takes a few minutes and ensures every agent has full context about your codebase, preferences, and available tools.

If all checks pass, proceed normally.

## Process

### 1. Find Active Epics

Scan `state/epics/` for subdirectories. Each subdirectory containing an `epic.yaml` is an active epic. If `state/epics/` does not exist or is empty, output:

```
No active workflows. Run /hive:plan to create an epic.
```

### 2. Load Epic Metadata

For each epic, read `state/epics/{epic-id}/epic.yaml` to get:
- `title` — epic display name
- `stories` — list of story entries with `id`, `title`, `depends_on`

### 3. Determine Story Status

For each story in the epic, check `state/episodes/{epic-id}/{story-id}/` for episode YAML files. Load the workflow definition (`hive/workflows/development.{methodology}.workflow.yaml`, default `classic`) to know the ordered list of steps.

| Condition | Status | Symbol |
|-----------|--------|--------|
| No episode files exist for the story | **pending** | `·` |
| Episodes exist but the last workflow step has no episode | **in-progress** | `⧖` |
| The final workflow step has an episode with `status: completed` | **completed** | `✓` |
| Any episode has `status: failed` or `status: escalated` | **failed** | `✗` |
| All dependencies not yet completed | **blocked** (subset of pending) | `·` |

For **in-progress** stories, identify the current phase from the last episode.
For **blocked** stories, list which `depends_on` stories are not yet completed.

### 4. Format Output

```
## Epic: {epic-id} — {title}
Progress: {completed}/{total} stories completed

Stories:
  ✓ {story-id} — {title} [completed]
  ⧖ {story-id} — {title} [{current-step} → {step-status}]
  · {story-id} — {title} [pending]
  · {story-id} — {title} [blocked: {dep-1}, {dep-2}]
  ✗ {story-id} — {title} [failed: {step} — {conclusion-summary}]
```

### 5. Dependency Graph

After the story list, render a text-based dependency graph:

```
Dependency Graph:
  {story-a} ──┐
  {story-b} ──┼──→ {story-d}
  {story-c} ──┘        │
  {story-e}             └──→ {story-f}
  {story-g}  (no dependencies)
```

For large epics (10+ stories), skip the graph and show blocked/unblocked status inline.

### 6. In-Progress Story Detail

For each in-progress story, show a one-line summary from the most recent episode's `context_for_next_phase` field (first 120 characters):

```
  ⧖ cache-strategy — Design Redis Caching [research → completed]
    ↳ "Redis cluster topology evaluated. Single-node sufficient for…"
```

### 7. Multi-Epic Display

If multiple epics are active, display each as a separate block. Order by most recently modified (check episode timestamps).
