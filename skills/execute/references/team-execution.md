# Team Execution (Step 6)

Use the `TeamCreate` tool to spawn an agent team. Generate a natural-language team creation prompt that describes the epic and its tasks:

```
Create a team to execute the "{epic-id}" epic.

## Tasks

**Task: {story-id}** (no dependencies — can start immediately)
Read the story at state/epics/{epic-id}/stories/{story-id}.yaml
and execute the steps described. Write episode records to
state/episodes/{epic-id}/{story-id}/.

**Task: {dependent-story-id}** (depends on: {dep-1}, {dep-2})
Wait until all dependencies complete, then read and execute the story.
Write episodes to state/episodes/{epic-id}/{dependent-story-id}/.

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

## Per-Story Commits

Stories commit independently on their own feature branches (`hive-{story-id}`) as soon as review passes. Do NOT batch commits at epic end.

## Respawn Monitoring (team execution)

The orchestrator monitors active teammates for context degradation signals during execution. If a teammate shows signs of context pressure (see `skills/hive/skills/respawn/SKILL.md` for detection heuristics), the orchestrator triggers the respawn protocol:

1. `SendMessage` the respawn signal to the teammate
2. Wait for the teammate to write its respawn summary to `state/respawn-summaries/`
3. Check the respawn iteration count — if >= 3, escalate to user instead
4. Spawn a fresh teammate via agent-spawn skill with `respawn_summary_path` pointing to the summary
5. The fresh teammate picks up where the previous one left off

Ensure `state/respawn-summaries/` exists before epic execution begins (create if needed).
