---
name: execute-mode-team-cmux
description: Run agent-team story dispatch on cmux panes. One pane per story, DAG-aware spawning, completion polling, sidecar injection, and surface lifecycle. Inherits the caller's model.
---

# Hive Mode — Team (cmux)

Atomic skill, NOT inline `/execute` prose. Runs the team-on-cmux execution mode for a workflow. The caller (the dispatch skill plus `/execute`) selects this mode and hands off the inputs below; this skill owns the lifecycle of cmux surfaces from spawn to close.

See `references/team-execution.md` for the full cmux-variant TeamCreate prompt template — this skill does NOT duplicate it.

## Invocation contract

Call this skill once per parent workflow when `mode_decision == team-cmux` was returned by the dispatch atom AND `execution.terminal_mux` resolves to `cmux`.

**Inputs:**
- `workflow_path` — path to the resolved workflow YAML.
- `unblocked_stories[]` — ordered list of story specs whose `depends_on` is satisfied at start.
- `appends_map` — `{story_id: [sidecar_agent_name, ...]}` from the parent's escalation partition (review-phase sidecar injection target).
- `epic_handle` — the parent epic identifier (used for branch naming and episode markers).

**Outputs:**
- Episode markers written under the parent's episode write path.
- Per-story commits on `hive-{story-id}` feature branches.
- cmux surfaces tracked and closed by completion.

## Process

### Step 1: Spawn unblocked stories

For each story in `unblocked_stories[]`, invoke `skills/hive/skills/agent-spawn/SKILL.md`. Section 7.3 of that skill owns the cmux pane lifecycle and prompt delivery — do NOT reimplement it here.

Track active work in a map:

```
{story_id -> surface_id, status, depends_on}
```

### Step 2: Poll for completion

Run a poll loop every 10 seconds. For each active surface:

- Call `cmux read-screen --surface <id>` and look for `[STORY-COMPLETE:{story-id}]`.
- Call `surface.health` to confirm the pane is still live.

### Step 3: Advance the DAG

When a story completes: mark it done, then scan blocked stories and spawn any whose `depends_on` set is now fully satisfied (loop back to Step 1 for each new spawn).

When a story fails: mark `failed`, propagate failure to all transitive dependents (they cannot run), and continue working remaining independent stories. Terminate with a failure summary once no runnable stories remain.

### Step 4: Deliver respawn + sidecar injection

Use `cmux send --surface <id>` to deliver respawn prompts or sidecar injection messages to active panes.

For sidecar injection at the review phase: if `appends_map[story_id]` is non-empty, send the matched sidecar reviewer agents to that story's pane using the exact verbiage:

```
Additional reviewers: {agent-1}, {agent-2}
Each additional reviewer should run their activation protocol after the primary review.
Load their persona from hive/agents/{agent-name}.md.
```

Resolution uses `hive/references/specialist-triggers.md` `responds_with.id` (already done upstream in the parent's escalation partition).

### Step 5: Close surfaces

When all stories complete: close every tracked surface via `cmux close-surface`, then return control to the caller for the parent's summary step.

Follow `references/team-execution.md` for cmux-variant TeamCreate prompt details and the per-story commit pattern (`hive-{story-id}` branch + commit on review pass).
