# Team Execution (Step 6)

Use the `TeamCreate` tool to spawn an agent team. Generate a natural-language team creation prompt that describes the epic and its tasks:

```
Create a team to execute the "{epic-id}" epic.

## Tasks

**Task: {story-id}** (no dependencies — can start immediately)
Read the story at .pHive/epics/{epic-id}/stories/{story-id}.yaml
and execute the steps described. Write episode records to
.pHive/episodes/{epic-id}/{story-id}/.

**Task: {dependent-story-id}** (depends on: {dep-1}, {dep-2})
Wait until all dependencies complete, then read and execute the story.
Write episodes to .pHive/episodes/{epic-id}/{dependent-story-id}/.

## Workflow per task
Each task follows the development workflow phases from the loaded
methodology (e.g., research -> implement -> test -> review -> integrate).

## Coordination
Write episode records after each step. When all tasks complete, report back.
```

Rules for generating the prompt:
- Each story becomes one task. Use the story ID as the task name.
- Stories with no `depends_on` are listed as "can start immediately."
- Stories with dependencies list them explicitly so the team blocks correctly.
- Do NOT inline the full story content — each teammate reads their story YAML file directly.
- For large epics (10+ stories), keep task descriptions minimal (ID + title + deps only).

## Sidecar injection (append-placement triggers)

After building each story's task block, check if that story's ID is present in the story→sidecar_agents map (populated in step 2b from `appends[]` records).

- If the story ID is **not** in the map: the task block is emitted byte-for-byte as described above — no changes.
- If the story ID **is** in the map: append the following to that story's task block (one line-pair per agent in the list):

  ```
  Also spawn {agent-name} as a sidecar for the review step.
  {agent-name} reads hive/agents/{agent-name}.md and participates in code review.
  ```

- Epics with no `appends[]` entries produce a TeamCreate prompt that is byte-for-byte identical to pre-sidecar behavior — this is the primary constraint.

> **Pattern note:** This is the Agent-within-TeamCreate pattern — sidecar runs within the dev team pane, not as a separate team.

## Per-Story Commits

Stories commit independently on their own feature branches (`hive-{story-id}`) as soon as review passes. Do NOT batch commits at epic end.

## Respawn Monitoring (team execution)

The orchestrator monitors active teammates for context degradation signals during execution. If a teammate shows signs of context pressure (see `skills/hive/skills/respawn/SKILL.md` for detection heuristics), the orchestrator triggers the respawn protocol:

1. `SendMessage` the respawn signal to the teammate
2. Wait for the teammate to write its respawn summary to `.pHive/respawn-summaries/`
3. Check the respawn iteration count — if >= 3, escalate to user instead
4. Spawn a fresh teammate via agent-spawn skill with `respawn_summary_path` pointing to the summary
5. The fresh teammate picks up where the previous one left off

Ensure `.pHive/respawn-summaries/` exists before epic execution begins (create if needed).

## cmux Team Execution Variant

When active: `execution.terminal_mux` resolves to `cmux` (explicit setting, or `auto` with cmux detected).

Dispatch: instead of a single `TeamCreate` call, the orchestrator loops through stories.

- Topologically sorted stories with no unmet dependencies are spawned immediately.
- Each spawn goes through the agent-spawn skill (section 7.3), which opens a cmux pane, launches `claude` in interactive mode, and delivers the prompt.
- Agent-spawn returns a `surface_id`; the orchestrator records it in the tracking map.

Tracking map:

```
{story_id: {surface_id, status: pending|active|complete|failed, depends_on: [...]}}
```

Poll loop (replaces TeamCreate's internal monitoring):

```
Every 10 seconds:
  for each active surface:
    cmux read-screen --surface <id> --scrollback
    - Search output for [STORY-COMPLETE:{story-id}]
    - Persist last-read line count per surface to avoid reprocessing
    - If marker found: mark complete, check dependents
    - If surface.health fails: mark failed, capture scrollback, log error
```

Dependency unblocking: when `story-a` completes, scan the tracking map for stories whose `depends_on` lists are now fully satisfied, then spawn those stories.

Messaging: the orchestrator can send messages to any active pane.

- Respawn signal: `cmux send --surface <id> "Your context is degrading. Write a respawn summary to .pHive/respawn-summaries/{story-id}.md and exit."`
- Sidecar injection: `cmux send --surface <id> "Also spawn {agent-name} as a sidecar for the review step. Read hive/agents/{agent-name}.md."`

Completion marker convention: agents must emit `[STORY-COMPLETE:{story-id}]` as the last line of their workflow output. Add this to the per-story prompt template.

Cleanup: after all stories complete, close all surfaces: `cmux close-surface --surface <id>` for each tracked surface.

Sidecar injection: same logic as the TeamCreate variant. Check the story→sidecar_agents map and append sidecar instructions to the story prompt before spawn.

Per-story commits: same as the TeamCreate variant. Stories commit independently on feature branches.

Respawn monitoring: same detection heuristics, but use `surface.send_text` for the respawn signal and `surface.read_text` plus `surface.health` for monitoring and liveness.
