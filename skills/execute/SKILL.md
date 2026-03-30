---
name: execute
description: Execute a planned epic's stories through development workflow phases.
---

# Hive Execute

Execute stories through development workflow phases.

**Input:** `$ARGUMENTS` contains epic ID and optional flags (`--methodology tdd|classic|bdd`, `--sequential`).

## Process

1. **Load the epic.** Read `state/epics/{epic-id}/epic.yaml`.

2. **Load or create cycle state.** Check `state/cycle-state/{epic-id}.yaml`. If it doesn't exist, create a minimal one with `epic_id` and `created` timestamp. The cycle state accumulates decisions across phases — see `hive/references/cycle-state-schema.md`. Include the cycle state in all downstream agent prompts as system-level constraints.

3. **Load the workflow definition.** Based on the `--methodology` parameter (default: `classic`), load:
   ```
   hive/workflows/development.{methodology}.workflow.yaml
   ```
   If the file does not exist, report an error listing available methodologies (files matching `hive/workflows/development.*.workflow.yaml`). See `hive/references/methodology-routing.md` for how methodologies control phase ordering.

4. **Topologically sort stories** by their `depends_on` fields.

5. **Choose execution mode.** Determine whether to use agent teams or sequential execution:

   1. Check: Is `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` set (value `1`, `true`, or `"true"`)?
   2. Check: Does `hive.config.yaml` have `parallel_teams: true`?
   3. Check: Does the topological sort reveal multiple stories at the same depth (independent stories that can run concurrently)?
   4. Check: Is `--sequential` flag NOT present in arguments?

   If all four: use **agent team execution** (step 6 below).
   Otherwise: use **sequential execution** (step 7 below).

   **IMPORTANT — tool hierarchy:**
   - **Orchestrator → stories:** Use `TeamCreate` to spawn story-level teammates into separate tmux panes. This is how the user monitors parallel work.
   - **Teammates → workflow steps:** Teammates use the `Agent` tool to spawn sub-workers for individual workflow steps (researcher, developer, tester, etc). Sub-workers run inline within the teammate's pane — this is correct and expected.

   The rule: `TeamCreate` for parallelizing stories across tmux panes. `Agent` for sequential workflow steps within a single story.

   See `hive/references/agent-teams-guide.md` for agent teams detection and mechanics.

6. **Agent team execution.** Use the `TeamCreate` tool to spawn an agent team. Generate a natural-language team creation prompt that describes the epic and its tasks:

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
   methodology (e.g., research → implement → test → review → integrate).

   ## Coordination
   Write episode records after each step. When all tasks complete, report back.
   ```

   Rules for generating the prompt:
   - Each story becomes one task. Use the story ID as the task name.
   - Stories with no `depends_on` are listed as "can start immediately."
   - Stories with dependencies list them explicitly so the team blocks correctly.
   - Do NOT inline the full story content — each teammate reads their story YAML file directly.
   - For large epics (10+ stories), keep task descriptions minimal (ID + title + deps only).

   **Per-story commits:** Stories commit independently on their own feature branches (`hive-{story-id}`) as soon as review passes. Do NOT batch commits at epic end.

7. **Sequential execution.** For each story (in dependency order):

   **a. Read the workflow steps.** Each step has an `agent` field referencing a persona in `hive/agents/`. Read that agent's markdown file to understand their role and output format.

   **b. Execute each step sequentially** by spawning a subagent with:
   - The agent persona (from `hive/agents/{agent}.md`) as system context
   - **If `step_file` exists on the workflow step:** read the step file and include it as the primary task instructions. The agent receives three layers of context:
     1. Agent persona (WHO — identity, capabilities, quality standards)
     2. Step file (HOW — exact procedure, execution rules, command templates, gating)
     3. Story spec (WHAT — the specific feature to implement)
   - **If `step_file` does not exist:** use the step's `task` description (existing behavior)
   - Any `inputs` from previous steps (resolved from step outputs or episode records)
   - The story's specification (description + acceptance criteria)

   **c. Capture the output** of each step. Pass outputs to downstream steps as specified in the workflow's `inputs` configuration.

   **d. Write an episode record** after each step completes, per the schema in `hive/references/episode-schema.md`. Write to:
   ```
   state/episodes/{epic-id}/{story-id}/{step-id}.yaml
   ```

   **e. Check review verdict.** After the review step:
   - `passed` → skip `optimize`, proceed directly to `integrate`
   - `needs_optimization` → execute `optimize` step, then `integrate`
   - `needs_revision` → route to fix loop or replanning

   **f. Check other gate criteria** before advancing. For test steps, verify tests pass. For failed gates, write a `failed` episode and halt the story.

8. After all stories complete, produce a summary of the epic execution.

## Key References

- `hive/references/agent-teams-guide.md` — team mechanics and limitations
- `hive/references/methodology-routing.md` — methodology selection
- `hive/references/episode-schema.md` — status marker format
- `hive/references/cycle-state-schema.md` — persistent decision tracking
- `hive/references/step-file-schema.md` — step file format
- `hive/agents/orchestrator.md` — orchestrator coordination guidance
