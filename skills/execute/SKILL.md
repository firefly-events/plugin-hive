---
name: execute
description: Execute a planned epic's stories through development workflow phases.
---

# Hive Execute

Execute stories through development workflow phases.

**Input:** `$ARGUMENTS` contains epic ID and optional flags (`--methodology tdd|classic|bdd`, `--sequential`).

## Kickoff Gate

**Before doing anything else**, check whether Hive has been initialized for this project:

1. Check if `state/project-profile.yaml` exists in the project root
2. If it exists, verify it has a populated `tech_stack` field (not empty, not null)
3. As a secondary check, verify `hive.config.yaml` exists (check both `hive/hive.config.yaml` and `hive.config.yaml` in the project root — either location is valid)

If **any** of these checks fail, display this message and **stop** — do not proceed with execution:

> Hive hasn't been set up for this project yet. Run `/hive:kickoff` first — it takes a few minutes and ensures every agent has full context about your codebase, preferences, and available tools.

If all checks pass, proceed normally.

## Before Executing Any Skill

1. **Load your persona.** Read `hive/agents/orchestrator.md` — it contains team evaluation criteria, pre-spawn checklist, circuit breakers, model tier routing, dev-on-standby pattern, decision protocols, and research prompt construction rules. This is WHO you are and HOW you make decisions.
2. **Load project config.** Read `hive/hive.config.yaml` for execution settings (methodology, parallel teams, circuit breaker limits, model overrides).
3. **Load your memories.** Read the `knowledge` paths from your orchestrator frontmatter. Scan `~/.claude/hive/memories/orchestrator/` for all `.md` files. Read each file's frontmatter `description` field. Load the full content of any memories relevant to the current task. If no memories exist yet, proceed — this is expected for new projects.

## Process

1. **Load the epic.** Read `state/epics/{epic-id}/epic.yaml`.

2. **Load or create cycle state.** Check `state/cycle-state/{epic-id}.yaml`. If it doesn't exist, create a minimal one with `epic_id` and `created` timestamp. The cycle state accumulates decisions across phases — see `hive/references/cycle-state-schema.md`. Include the cycle state in all downstream agent prompts as system-level constraints.

3. **Load the workflow definition.** Based on the `--methodology` parameter (default: `classic`), load:
   ```
   hive/workflows/development.{methodology}.workflow.yaml
   ```
   If the file does not exist, report an error listing available methodologies (files matching `hive/workflows/development.*.workflow.yaml`). See `hive/references/methodology-routing.md` for how methodologies control phase ordering.

4. **Topologically sort stories** by their `depends_on` fields.

5. **Choose execution mode.** Determine whether to use sessions, agent teams, or sequential execution:

   **Session check (highest priority):**
   Is `HIVE_SESSIONS_ENABLED` set (value `1`, `true`, or `"true"`) OR does `hive.config.yaml`
   have `sessions.enabled: true`? If yes → use **session-based execution** (step 6b below).
   Skip the remaining checks.

   **Team check (when sessions not available):**
   1. Check: Is `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` set (value `1`, `true`, or `"true"`)?
   2. Check: Does `hive.config.yaml` have `parallel_teams: true`?
   3. Check: Does the topological sort reveal multiple stories at the same depth (independent stories that can run concurrently)?
   4. Check: Is `--sequential` flag NOT present in arguments?

   If all four team checks pass: use **agent team execution** (step 6a below).
   Otherwise: use **sequential execution** (step 7 below).

   **IMPORTANT — tool hierarchy:**
   - **Orchestrator → stories (session path):** Use the `/v1/sessions` Claude Agent SDK API to create one session per story. See step 6b.
   - **Orchestrator → stories (TeamCreate path):** Use `TeamCreate` to spawn story-level teammates into separate tmux panes. This is how the user monitors parallel work.
   - **Teammates → workflow steps:** Teammates use the `Agent` tool to spawn sub-workers for individual workflow steps (researcher, developer, tester, etc). Sub-workers run inline within the teammate's pane — this is correct and expected.

   The rule: sessions when `HIVE_SESSIONS_ENABLED`. `TeamCreate` for parallelizing stories across tmux panes. `Agent` for sequential workflow steps within a single story.

   See `hive/references/agent-teams-guide.md` for agent teams detection and mechanics.
   See `hive/references/configuration.md` for `sessions.*` config options.

6a. **Agent team execution** (TeamCreate path — used when sessions are not available). Use the `TeamCreate` tool to spawn an agent team. Generate a natural-language team creation prompt that describes the epic and its tasks:

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

   **Respawn monitoring (team execution):** The orchestrator monitors active teammates for context degradation signals during execution. If a teammate shows signs of context pressure (see `skills/hive/skills/respawn/SKILL.md` for detection heuristics), the orchestrator triggers the respawn protocol:

   1. `SendMessage` the respawn signal to the teammate
   2. Wait for the teammate to write its respawn summary to `state/respawn-summaries/`
   3. Check the respawn iteration count — if >= 3, escalate to user instead
   4. Spawn a fresh teammate via agent-spawn skill with `respawn_summary_path` pointing to the summary
   5. The fresh teammate picks up where the previous one left off

   Ensure `state/respawn-summaries/` exists before epic execution begins (create if needed).

6b. **Session-based execution** (used when `HIVE_SESSIONS_ENABLED` or `sessions.enabled: true`).

   **6b-1. Bootstrap session registry.** Run the session-registry bootstrap skill
   (`skills/hive/skills/session-registry/SKILL.md`) to ensure `state/sessions/index.yaml`
   exists. This is idempotent — safe to call even if already initialized.

   **6b-2. Create session entries.** For each story in dependency order:
   - Append a session record to `state/sessions/index.yaml` with `status: pending`,
     `story_id: {story-id}`, `epic_id: {epic-id}`, and `created_at: {NOW}`.
   - Use the model from `hive.config.yaml sessions.model` (or inherit from `model_tiers`
     for the story's primary agent).

   **6b-3. Invoke each session.** When a story's dependencies are complete, open its
   session using the Claude Agent SDK `/v1/sessions` API. Format the initial session
   prompt using the session prompt spec from `hive/references/session-prompt-spec.md`.
   The prompt must include: story spec, workflow step sequence, episode write path, and
   specialist trigger check (see step 6b specialist check below).
   - Update the registry record: set `status: active` and `last_active_at: {NOW}`.

   **6b-4. Specialist check.** Before invoking the review phase session, evaluate
   specialist trigger rules from `hive/references/specialist-trigger-rules.md` against
   the story's `key_files` and `tags`. Append matched specialists to the review session's
   context as `Additional reviewers: [list]`. See step 6b detail in specialist-trigger
   migration for the full procedure.

   **6b-5. Monitor and update.** As sessions run, update `sse_last_event_at` in the
   registry on each received SSE event. Watch for stuck sessions per the resilience
   procedure in `hive/references/session-resilience.md`.

   **6b-6. Close sessions.** On session completion, set `status: completed` (or `failed`)
   and update `last_active_at`. Sessions are never reopened — each story run gets a
   new session record.

   **Per-story commits (session path):** Stories commit independently on their own feature
   branches (`hive-{story-id}`) as soon as review passes, same as the TeamCreate path.

   **Resilience monitoring:** See `hive/references/session-resilience.md` for SSE stuck
   detection and session retry procedure (max 3 retries per session, replacing respawn
   for this execution path).

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

   **g. Respawn monitoring (sequential execution).** During long-running steps (implement, test, optimize), the orchestrator should watch for context degradation in the spawned sub-worker. If the sub-worker's responses show quality decline, repetitive behavior, or task drift (see `skills/hive/skills/respawn/SKILL.md` for the full signal list):

   1. Signal the sub-worker to write a respawn summary
   2. After the sub-worker writes the summary and terminates, check respawn count (max 3 per step)
   3. Spawn a fresh sub-worker via agent-spawn skill with `respawn_summary_path`
   4. The fresh sub-worker continues the step from where the previous one left off
   5. If respawn count reaches 3, escalate to the user with the summary chain

   Ensure `state/respawn-summaries/` exists at the start of execution.

8. After all stories complete, produce a summary of the epic execution.

## Key References

- `hive/references/agent-teams-guide.md` — team mechanics and limitations
- `hive/references/methodology-routing.md` — methodology selection
- `hive/references/episode-schema.md` — status marker format
- `hive/references/cycle-state-schema.md` — persistent decision tracking
- `hive/references/step-file-schema.md` — step file format
- `hive/agents/orchestrator.md` — orchestrator coordination guidance
- `skills/hive/skills/respawn/SKILL.md` — agent respawn protocol and detection heuristics
- `skills/hive/skills/agent-spawn/SKILL.md` — agent spawning with respawn continuation support
