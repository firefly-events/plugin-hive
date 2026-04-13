# Sequential Execution (Step 7)

For each story (in dependency order):

## a. Read the workflow steps

Each step has an `agent` field referencing a persona in `hive/agents/`. Read that agent's markdown file to understand their role and output format.

## b. Execute each step sequentially

Spawn a subagent with:
- The agent persona (from `hive/agents/{agent}.md`) as system context
- **If `step_file` exists on the workflow step:** read the step file and include it as the primary task instructions. The agent receives three layers of context:
  1. Agent persona (WHO — identity, capabilities, quality standards)
  2. Step file (HOW — exact procedure, execution rules, command templates, gating)
  3. Story spec (WHAT — the specific feature to implement)
- **If `step_file` does not exist:** use the step's `task` description (existing behavior)
- Any `inputs` from previous steps (resolved from step outputs or episode records)
- The story's specification (description + acceptance criteria)

## c. Capture the output

Capture the output of each step. Pass outputs to downstream steps as specified in the workflow's `inputs` configuration.

## d. Write an episode record

After each step completes, per the schema in `hive/references/episode-schema.md`. Write to:
```
state/episodes/{epic-id}/{story-id}/{step-id}.yaml
```

## e. Check review verdict

After the review step:
- `passed` -> skip `optimize`, proceed directly to `integrate`
- `needs_optimization` -> execute `optimize` step, then `integrate`
- `needs_revision` -> route to fix loop or replanning

## f. Check other gate criteria

Before advancing. For test steps, verify tests pass. For failed gates, write a `failed` episode and halt the story.

## g. Respawn Monitoring (sequential execution)

During long-running steps (implement, test, optimize), the orchestrator should watch for context degradation in the spawned sub-worker. If the sub-worker's responses show quality decline, repetitive behavior, or task drift (see `skills/hive/skills/respawn/SKILL.md` for the full signal list):

1. Signal the sub-worker to write a respawn summary
2. After the sub-worker writes the summary and terminates, check respawn count (max 3 per step)
3. Spawn a fresh sub-worker via agent-spawn skill with `respawn_summary_path`
4. The fresh sub-worker continues the step from where the previous one left off
5. If respawn count reaches 3, escalate to the user with the summary chain

Ensure `state/respawn-summaries/` exists at the start of execution.
