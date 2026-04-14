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

2b. **Read and partition escalations.** Inspect the `escalations:` field of the loaded cycle state.

   **If `escalations:` is absent or empty:** emit a single debug trace:
   ```
   [debug] step 2b: no escalations in cycle state
   ```
   Proceed directly to step 3. Make no other changes — do not create directories, do not write files, do not modify cycle state.

   **If `escalations:` is present and non-empty:**

   First, load the specialist-triggers catalog by reading `hive/references/specialist-triggers.md`. This catalog is needed for trigger lookups (responds_with, workflow fields) in the steps below.

   - For each record, validate the `trigger` ID against the catalog loaded above. The catalog is the authoritative set of valid trigger IDs.
     - If the record's `trigger` ID does not match any entry in the catalog: log a warning `[warn] step 2b: unknown trigger "{trigger}" — skipping record` and skip that record. Do not crash, do not fall through to catalog-derived lookups (`responds_with.id`, `workflow`, `skill`) — an unknown trigger has no catalog entry to read.
   - For each record, validate the `placement` field against the enum `{pre-exec, post-exec, append}`.
     - If `placement` has an unknown value: log a warning `[warn] step 2b: unknown placement value "{value}" — skipping record` and skip that record. Do not crash.
     - If any other required field (`trigger`, `severity`, `stories`, `reason`, `raised_by`, `raised_at`) is missing or null: log a warning `[warn] step 2b: escalation record missing required field "{field}" — skipping record` and skip that record.
   - Partition valid records into three in-memory lists:
     - `pre_exec[]` — records with `placement: pre-exec`
     - `post_exec[]` — records with `placement: post-exec`
     - `appends[]` — records with `placement: append`
   - For `appends[]`: build a story→sidecar_agents map: `{story_id: [agent_name, ...]}` from each record's `stories` list and the target agent(s) from the trigger's catalog `responds_with.id`. Only use `stories` entries that match a canonical story ID in the current epic (i.e., a corresponding story YAML exists at `state/epics/{epic-id}/stories/{id}.yaml`). Log a warning for any non-canonical entry: `[warn] step 2b: stories[] entry "{entry}" is not a canonical story ID — skipping for sidecar map`.
   - For any trigger whose catalog entry has both `workflow:` empty and `skill:` empty: emit a trace `[debug] step 2b: trigger {trigger_id} — specialist phase not yet implemented, skipping`. This is a graceful no-op — do not halt execution.
   - Emit a single summary trace:
     ```
     [info] step 2b: escalation partition: {N} pre-exec, {M} post-exec, {P} appends
     ```

   **Critical constraints for this step:**
   - Pure read — must not modify cycle state, must not create directories, must not write files.
   - `pre_exec[]`, `post_exec[]`, and `appends[]` are built in memory but not yet consumed. Downstream stories add consumption logic.
   - If a trigger's `responds_with.id` does not resolve to an existing agent file (`hive/agents/{id}.md`) or team config (`state/teams/{id}.yaml`): log `[warn] step 2b: responds_with.id "{id}" — referenced agent/team file not found on disk — continuing` and continue.

3. **Load the workflow definition.** Based on the `--methodology` parameter (default: `classic`), load:
   ```
   hive/workflows/development.{methodology}.workflow.yaml
   ```
   If the file does not exist, report an error listing available methodologies (files matching `hive/workflows/development.*.workflow.yaml`). See `hive/references/methodology-routing.md` for how methodologies control phase ordering.

4. **Topologically sort stories** by their `depends_on` fields.

4a. **Pre-exec phase loop.** If `pre_exec[]` is empty, skip this step entirely — zero behavior change for escalation-free epics.

   For each trigger in `pre_exec[]`, ordered by `raised_at` ASC (severity DESC as tiebreak), look up the trigger's catalog entry in `hive/references/specialist-triggers.md` (loaded in step 2b) to resolve `responds_with.id` and `workflow` fields. Then apply the three-condition branch:

   **Prerequisite — team_memory_path validation:** Before spawning, verify the team config's `team_memory_path` directory exists on disk. If it does not, emit an actionable error — e.g., `[error] pre-exec: team_memory_path "state/team-memories/security-team/" does not exist — create it before running specialist phases` — skip the trigger, and continue. Do not crash execute.

   **(i) workflow field set AND workflow file exists on disk:**
   Invoke `TeamCreate(team_config=team_yaml, workflow=entry.workflow)`. Write phase output to `state/specialist-phases/{trigger}/{epic-id}/` (where `{trigger}` is the trigger ID string, e.g., `security:plan-audit`). If `TeamCreate` errors: log the failure (e.g., `[error] pre-exec: TeamCreate failed for {trigger-id} — {error}`), write a failure marker to `state/specialist-phases/{trigger}/{epic-id}/failure.md`, and continue to the next trigger. Do not crash execute.

   **(ii) workflow field set AND workflow file MISSING from disk:**
   Log `[info] pre-exec: specialist workflow not yet built — skipping {trigger-id}` → no-op. Continue to next trigger.

   **(iii) workflow field empty:**
   Log `[info] pre-exec: specialist phase {trigger-id} not yet implemented — skipping` → no-op. Continue to next trigger.

   Cases (ii) and (iii) use DISTINCT log messages — do NOT collapse them. Both are valid no-ops; distinct messages are the operational basis for case triage.

   > **v1 note:** v1 routing handles `workflow`-based catalog entries only. A catalog entry with `skill: <path>` (allowed by catalog schema but unused in v1) is not reached by condition (i) and falls to condition (ii) or (iii). Skill-based routing is a Phase 6 extension point.

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

   **Sidecar injection (append-placement triggers):** After building each story's task block, check if that story's ID is present in the story→sidecar_agents map (populated in step 2b from `appends[]` records).
   - If the story ID is **not** in the map: the task block is emitted byte-for-byte as described above — no changes.
   - If the story ID **is** in the map: append the following to that story's task block (one line-pair per agent in the list):
     ```
     Also spawn {agent-name} as a sidecar for the review step.
     {agent-name} reads hive/agents/{agent-name}.md and participates in code review.
     ```
   - Epics with no `appends[]` entries produce a TeamCreate prompt that is byte-for-byte identical to pre-sidecar behavior — this is the primary constraint.

   > **Pattern note:** This is the Agent-within-TeamCreate pattern — sidecar runs within the dev team pane, not as a separate team.

   **Per-story commits:** Stories commit independently on their own feature branches (`hive-{story-id}`) as soon as review passes. Do NOT batch commits at epic end.

   **Respawn monitoring (team execution):** The orchestrator monitors active teammates for context degradation signals during execution. If a teammate shows signs of context pressure (see `skills/hive/skills/respawn/SKILL.md` for detection heuristics), the orchestrator triggers the respawn protocol:

   1. `SendMessage` the respawn signal to the teammate
   2. Wait for the teammate to write its respawn summary to `state/respawn-summaries/`
   3. Check the respawn iteration count — if >= 3, escalate to user instead
   4. Spawn a fresh teammate via agent-spawn skill with `respawn_summary_path` pointing to the summary
   5. The fresh teammate picks up where the previous one left off

   Ensure `state/respawn-summaries/` exists before epic execution begins (create if needed).

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

   **b-i. Sidecar injection (append-placement triggers):** For the current story, check if its ID is present in the story→sidecar_agents map (populated in step 2b from `appends[]` records).
   - If the story ID is **not** in the map: all steps execute exactly as described in **b** — zero diff from pre-story behavior (hard constraint).
   - If the story ID **is** in the map:
     - Scan the story's workflow step list for a step with `id: review`. (All three development workflows — classic, tdd, bdd — include this step.)
     - **If a "review" step is found:** when step execution reaches that step, inject each sidecar agent as a participating agent in the subagent spawn. Include each agent's persona (`hive/agents/{agent-name}.md`) alongside the primary reviewer persona and instruct each sidecar to participate in code review. This is injection INTO the step — not a new step.
     - **If no "review" step exists in the workflow:** after the final workflow step completes, inject sidecar agents as an additional post-step execution. Before injecting, emit:
       ```
       [warn] sidecar inject-after fallback: review step not found in {workflow-file}; scanned steps: {step-name-list}; sidecar agent(s) appended after final step
       ```
       The warning must include the workflow filename and the full list of scanned step IDs. This fallback path is the primary mitigation for deep-coupling risk — implement it with the same care as the happy path.
   - For all steps other than the injection target: proceed with step execution unchanged.

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

7a. **Post-exec phase loop.** If `post_exec[]` is empty, skip this step entirely — zero behavior change for escalation-free epics.

   For each trigger in `post_exec[]`, ordered by `raised_at` ASC (severity DESC as tiebreak), apply the three-condition branch:

   **Prerequisite — team_memory_path validation:** Before spawning, verify the team config's `team_memory_path` directory exists on disk. If it does not, emit an actionable error — e.g., `[error] post-exec: team_memory_path "state/team-memories/security-team/" does not exist — create it before running specialist phases` — skip the trigger, and continue. Do not crash execute.

   **(i) workflow field set AND workflow file exists on disk:**
   Invoke `TeamCreate(team_config=team_yaml, workflow=entry.workflow)`. Write phase output to `state/specialist-phases/{trigger}/{epic-id}/`. If `TeamCreate` errors: log the failure (e.g., `[error] post-exec: TeamCreate failed for {trigger-id} — {error}`), write a failure marker to `state/specialist-phases/{trigger}/{epic-id}/failure.md`, and continue to the next trigger. Do not crash execute.

   **(ii) workflow field set AND workflow file MISSING from disk:**
   Log `[info] post-exec: specialist workflow not yet built — skipping {trigger-id}` → no-op. Continue to next trigger.

   **(iii) workflow field empty:**
   Log `[info] post-exec: specialist phase {trigger-id} not yet implemented — skipping` → no-op. Continue to next trigger.

   Cases (ii) and (iii) use DISTINCT log messages — do NOT collapse them. Both are valid no-ops; distinct messages are the operational basis for case triage.

   > **v1 note:** v1 routing handles `workflow`-based catalog entries only. A catalog entry with `skill: <path>` (allowed by catalog schema but unused in v1) is not reached by condition (i) and falls to condition (ii) or (iii). Skill-based routing is a Phase 6 extension point.

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
