---
name: execute
description: Execute a planned epic's stories through development workflow phases.
---

# Hive Execute

Execute stories through development workflow phases.

**Input:** `$ARGUMENTS` contains epic ID and optional flags (`--methodology tdd|classic|bdd`, `--sequential`).

## State directory resolution

All state paths in this skill are written as `${HIVE_STATE_DIR}/...`. Resolve `HIVE_STATE_DIR` from `paths.state_dir` in the ROOT `hive.config.yaml` (the consumer override layer). The shipped baseline at `hive/hive.config.yaml` is a fall-through source — it does NOT drive runtime path decisions per the Slice 1 resolver contract. The default is `.pHive`. When the root config sets a different value, substitute that value everywhere this skill writes `${HIVE_STATE_DIR}`, so relocation after marketplace install still works.

## Kickoff Gate

**Before doing anything else**, check whether Hive has been initialized for this project:

1. Check if `${HIVE_STATE_DIR}/project-profile.yaml` exists (resolved from `paths.state_dir`; see the resolution note above)
2. If it exists, verify it has a populated `tech_stack` field (not empty, not null)
3. As a secondary check, verify `hive.config.yaml` exists (check both `hive/hive.config.yaml` and `hive.config.yaml` in the project root — either location is valid)

If **any** of these checks fail, display this message and **stop** — do not proceed with execution:

> Hive hasn't been set up for this project yet. Run `/hive:kickoff` first — it takes a few minutes and ensures every agent has full context about your codebase, preferences, and available tools.

If all checks pass, proceed silently — do not announce that the kickoff gate passed. Only surface this section when a check fails.

## Before Executing Any Skill

1. **Load your persona.** Read `hive/agents/orchestrator.md` — it contains team evaluation criteria, pre-spawn checklist, circuit breakers, model tier routing, dev-on-standby pattern, decision protocols, and research prompt construction rules. This is WHO you are and HOW you make decisions.
2. **Load project config.** Read `hive/hive.config.yaml` for execution settings (methodology, parallel teams, circuit breaker limits, model overrides).
3. **Load your memories.** Read the `knowledge` paths from your orchestrator frontmatter. Scan `~/.claude/hive/memories/orchestrator/` for all `.md` files. Read each file's frontmatter `description` field. Load the full content of any memories relevant to the current task. If no memories exist yet, proceed — this is expected for new projects.

## Delegation Rules (MANDATORY)

**The orchestrator is a coordinator, not an implementor.** The orchestrator MUST NOT:
- Write application code, tests, or configuration files directly
- Read source files to analyze or fix them
- Run tests, linters, or build commands
- Perform any work that belongs to a roster agent (developer, reviewer, tester, etc.)

**The orchestrator MUST delegate all implementation work using the correct tool:**

| Scope | Tool | Why |
|---|---|---|
| **Parallelizing stories across the epic** | `TeamCreate` or cmux panes | Stories run in separate tmux panes via `TeamCreate`, or separate cmux panes when `execution.terminal_mux: cmux` |
| **Sequential workflow steps within a single story** | `Agent` | Steps within a teammate's pane run inline — this is correct |
| **Specialist phase teams (pre-exec, post-exec)** | `TeamCreate` | Specialist teams are independent coordination units |

**Using `Agent` to execute stories is a protocol violation.** `Agent` is only correct for workflow steps *within* an already-spawned teammate. If the orchestrator finds itself about to call `Agent` with a story's worth of work, it MUST use `TeamCreate` instead.

## Process

1. **Load the epic.** Read `${HIVE_STATE_DIR}/epics/{epic-id}/epic.yaml`.

2. **Load or create cycle state.** Check `${HIVE_STATE_DIR}/cycle-state/{epic-id}.yaml`. If it doesn't exist, create a minimal one with `epic_id` and `created` timestamp. The cycle state accumulates decisions across phases — see `hive/references/cycle-state-schema.md`. Include the cycle state in all downstream agent prompts as system-level constraints.

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
   - For `appends[]`: build a story→sidecar_agents map: `{story_id: [agent_name, ...]}` from each record's `stories` list and the target agent(s) from the trigger's catalog `responds_with.id`. Only use `stories` entries that match a canonical story ID in the current epic (i.e., a corresponding story YAML exists at `${HIVE_STATE_DIR}/epics/{epic-id}/stories/{id}.yaml`). Log a warning for any non-canonical entry: `[warn] step 2b: stories[] entry "{entry}" is not a canonical story ID — skipping for sidecar map`.
   - For any trigger whose catalog entry has both `workflow:` empty and `skill:` empty: emit a trace `[debug] step 2b: trigger {trigger_id} — specialist phase not yet implemented, skipping`. This is a graceful no-op — do not halt execution.
   - Emit a single summary trace:
     ```
     [info] step 2b: escalation partition: {N} pre-exec, {M} post-exec, {P} appends
     ```

   **Critical constraints for this step:**
   - Pure read — must not modify cycle state, must not create directories, must not write files.
   - `pre_exec[]`, `post_exec[]`, and `appends[]` are built in memory but not yet consumed. Downstream stories add consumption logic.
   - If a trigger's `responds_with.id` does not resolve to an existing agent file (`hive/agents/{id}.md`) or team config (`${HIVE_STATE_DIR}/teams/{id}.yaml`): log `[warn] step 2b: responds_with.id "{id}" — referenced agent/team file not found on disk — continuing` and continue.

3. **Load the workflow definition.** Based on the `--methodology` parameter (default: `classic`), load:
   ```
   hive/workflows/development.{methodology}.workflow.yaml
   ```
   If the file does not exist, report an error listing available methodologies (files matching `hive/workflows/development.*.workflow.yaml`). See `hive/references/methodology-routing.md` for how methodologies control phase ordering.

4. **Topologically sort stories** by their `depends_on` fields.

4a. **Pre-exec phase loop.** If `pre_exec[]` is empty, skip this step entirely — zero behavior change for escalation-free epics.

   For each trigger in `pre_exec[]`, ordered by `raised_at` ASC (severity DESC as tiebreak), look up the trigger's catalog entry in `hive/references/specialist-triggers.md` (loaded in step 2b) to resolve `responds_with.id` and `workflow` fields. Then apply the three-condition branch:

   **Prerequisite — team_memory_path validation:** Before spawning, verify the team config's `team_memory_path` directory exists on disk. If it does not, emit an actionable error — e.g., `[error] pre-exec: team_memory_path "${HIVE_STATE_DIR}/team-memories/security-team/" does not exist — create it before running specialist phases` — skip the trigger, and continue. Do not crash execute.

   **(i) workflow field set AND workflow file exists on disk:**
   Invoke `TeamCreate(team_config=team_yaml, workflow=entry.workflow)`. Write phase output to `${HIVE_STATE_DIR}/specialist-phases/{trigger}/{epic-id}/` (where `{trigger}` is the trigger ID string, e.g., `security:plan-audit`). If `TeamCreate` errors: log the failure (e.g., `[error] pre-exec: TeamCreate failed for {trigger-id} — {error}`), write a failure marker to `${HIVE_STATE_DIR}/specialist-phases/{trigger}/{epic-id}/failure.md`, and continue to the next trigger. Do not crash execute.

   **(ii) workflow field set AND workflow file MISSING from disk:**
   Log `[info] pre-exec: specialist workflow not yet built — skipping {trigger-id}` → no-op. Continue to next trigger.

   **(iii) workflow field empty:**
   Log `[info] pre-exec: specialist phase {trigger-id} not yet implemented — skipping` → no-op. Continue to next trigger.

   Cases (ii) and (iii) use DISTINCT log messages — do NOT collapse them. Both are valid no-ops; distinct messages are the operational basis for case triage.

   > **v1 note:** v1 routing handles `workflow`-based catalog entries only. A catalog entry with `skill: <path>` (allowed by catalog schema but unused in v1) is not reached by condition (i) and falls to condition (ii) or (iii). Skill-based routing is a Phase 6 extension point.

5. **Choose execution mode.** Determine whether to use sessions, agent teams, or sequential execution:

   **Session check (highest priority).** Is `HIVE_SESSIONS_ENABLED` set (value `1`, `true`, or `"true"`) OR does `hive.config.yaml` have `sessions.enabled: true`? If yes → use **session-based execution** (step 6c below). Skip the remaining checks.

   **Team check (when sessions not available):**

   1. Check: Is `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` set (value `1`, `true`, or `"true"`)?
   2. Check: Does `hive.config.yaml` have `parallel_teams: true`?
   3. Check: Does the topological sort reveal multiple stories at the same depth (independent stories that can run concurrently)?
   4. Check: Is `--sequential` flag NOT present in arguments?

   If all four team checks pass: use **agent team execution**. If `execution.terminal_mux` resolves to `cmux`, use step 6b. Otherwise use step 6.
   Otherwise: use **sequential execution** (step 7).

5pre. **Executor cutover routing (hde-9a + hde-9b).** Before dispatching the chosen execution mode for a single workflow, decide whether to invoke the deterministic DAG executor (`hive.lib.dag_executor`) or stay on the orchestrator-narrated path. This check applies per-workflow at the point where this skill would otherwise hand off a workflow YAML to the orchestrator-narrated runner.

   **Decision tree (default OFF — fail-closed orchestrator path on any miss):**

   1. **Read consumer config.** Look for `.pHive/hive.config.yaml` (consumer-side, NOT the shipped `hive/hive.config.yaml`). If the file is missing → orchestrator path. Done.
   2. **Check the flag.** Parse the file. If `executor` is anything other than `hive-dag` (`hive-dag` is the only valid value today) → orchestrator path with a warning. If `executor_default` is not truthy (`on`, `true`, `yes`, or YAML bool `True`; `off`/`false`/`no`/missing → false) → orchestrator path.
   3. **Read graduation registry.** Look for `.pHive/runtime/executor-graduated-workflows.yaml` (created by hde-9b — may not exist yet; treat missing as empty, no workflows graduated). Parse the top-level `workflows:` list.
   4. **Per-workflow gate.** If the workflow being dispatched is NOT in the registry → orchestrator path.
   5. **Both gates pass.** Invoke `hive.lib.dag_executor.run_workflow(workflow_path, dispatcher, run_state_path=..., worktree_manager=...)`. Pass a populated `run_state_path` and `worktree_manager` so the L3 functionality (run-state persistence + worktree-per-run isolation) is available; the wrapper honours `worktree_manager=None` (no isolation, hde-2 spine path) when caller-decided context says so (e.g., already inside an outer worktree per hde-6 nesting policy).

   **Why this gating exists (Q4 lock):** the consumer-side flag layer keeps maintainer-only execution choices out of the shipped `hive/hive.config.yaml` (the eefbff3 / `project_config_shipping_deferred` pattern). The per-workflow registry layer lets graduation events ship without consumer config edits. Default OFF preserves zero-behaviour-change for non-opt-in consumers. Both gates must be true; either gate empty falls through to the orchestrator path.

   **Single dispatch point:** this is the ONLY place where `/execute` chooses between executor and orchestrator. No other skill or step file should re-implement this decision tree — they should call back into this skill or the `executor_enabled_for(workflow_name)` reader exposed by `hive.lib.dag_executor`.

6. **Agent team execution.** Follow **`references/team-execution.md`** for the full TeamCreate prompt template, per-story commit pattern, sidecar injection for append-placement triggers, and respawn monitoring.

6b. **Agent team execution (cmux path).** Use this path when all four step-5 conditions are true and `execution.terminal_mux` resolves to `cmux`.

   - Spawn each unblocked story via the agent-spawn skill. Section 7.3 of that skill handles the cmux pane lifecycle and prompt delivery.
   - Track active work in a map:
     ```
     {story_id -> surface_id, status, depends_on}
     ```
   - Run a poll loop every 10 seconds. For each active surface:
     - Call `cmux read-screen --surface <id>` and look for `[STORY-COMPLETE:{story-id}]`
     - Call `surface.health` to confirm the pane is still live
   - When a story completes: mark it done, then scan blocked stories and spawn any whose `depends_on` set is now fully satisfied.
   - When a story fails: mark `failed`, propagate failure to all transitive dependents (they cannot run), and continue executing remaining independent stories. Terminate the epic with a failure summary once no runnable stories remain.
   - Use `cmux send --surface <id>` to deliver respawn prompts or sidecar injection messages to active panes.
   - When all stories complete: close every tracked surface via `cmux close-surface`, then produce the epic summary.
   - Follow **`references/team-execution.md`** for the cmux variant details.

6c. **Session-based execution** (used when `HIVE_SESSIONS_ENABLED` or `sessions.enabled: true`). Replaces the TeamCreate path with the Claude Agent SDK `/v1/sessions` API for story-level execution. One session per story, isolated context, structured retry on stuck SSE.

   **6c-1. Bootstrap session registry.** Run the session-registry bootstrap skill (`skills/hive/skills/session-registry/SKILL.md`) to ensure `${HIVE_STATE_DIR}/sessions/index.yaml` exists. Idempotent — safe to call even if already initialized. See `hive/references/session-registry-schema.md` for the registry record shape.

   **6c-2. Create session entries.** For each story in dependency order:
   - Append a session record to `${HIVE_STATE_DIR}/sessions/index.yaml` with `status: pending`, `story_id: {story-id}`, `epic_id: {epic-id}`, and `created_at: {NOW}`.
   - Use the model from `hive.config.yaml sessions.model` (or inherit from `model_tiers` for the story's primary agent).

   **6c-3. Invoke each session.** When a story's dependencies are complete, open its session using the `/v1/sessions` API via `hive/scripts/session-invoke.mjs`. Format the initial session prompt using the session prompt spec from `hive/references/session-system-prompt-spec.md`. The prompt must include: story spec, workflow step sequence, episode write path, and any escalation context from step 2b's `appends[]` map (sidecar reviewers).
   - Update the registry record: set `status: active` and `last_active_at: {NOW}`.

   **6c-4. Sidecar injection (session path).** When step 2b populated `appends[]` for this story, append the matched sidecar reviewer agents to the review-phase session context as:
   ```
   Additional reviewers: {agent-1}, {agent-2}
   Each additional reviewer should run their activation protocol after the primary review.
   Load their persona from hive/agents/{agent-name}.md.
   ```
   Use the canonical specialist catalog at `hive/references/specialist-triggers.md` to resolve `responds_with.id` for each escalation (already done in step 2b). If `appends[]` is empty for the story, proceed with the standard reviewer only.

   **6c-5. Monitor and update.** As sessions run, update `sse_last_event_at` in the registry on each received SSE event. Watch for stuck sessions per the resilience procedure in `hive/references/session-resilience.md`.

   **6c-6. Close sessions.** On session completion, set `status: completed` (or `failed`) and update `last_active_at`. Sessions are never reopened — each story run gets a new session record.

   **Per-story commits (session path):** Stories commit independently on their own feature branches (`hive-{story-id}`) as soon as review passes, same as the TeamCreate path.

   **Resilience monitoring:** While sessions are active, poll `sse_last_event_at` in `${HIVE_STATE_DIR}/sessions/index.yaml`. If any active session has not updated `sse_last_event_at` within `sessions.stuck_timeout_ms` (default 90s), trigger the session retry procedure from `hive/references/session-resilience.md`. Max `sessions.max_retries` retries per story (default 3) before escalating to the user. This **replaces** the respawn skill for session-based execution — do NOT use the respawn protocol for step 6c stories.

7. **Sequential execution.** Follow **`references/sequential-execution.md`** for the step-by-step workflow within each story, sidecar injection at the review step, episode records, gate checks, and respawn monitoring.

7a. **Post-exec phase loop.** If `post_exec[]` is empty, skip this step entirely — zero behavior change for escalation-free epics.

   For each trigger in `post_exec[]`, ordered by `raised_at` ASC (severity DESC as tiebreak), apply the three-condition branch:

   **Prerequisite — team_memory_path validation:** Before spawning, verify the team config's `team_memory_path` directory exists on disk. If it does not, emit an actionable error — e.g., `[error] post-exec: team_memory_path "${HIVE_STATE_DIR}/team-memories/security-team/" does not exist — create it before running specialist phases` — skip the trigger, and continue. Do not crash execute.

   **(i) workflow field set AND workflow file exists on disk:**
   Invoke `TeamCreate(team_config=team_yaml, workflow=entry.workflow)`. Write phase output to `${HIVE_STATE_DIR}/specialist-phases/{trigger}/{epic-id}/`. If `TeamCreate` errors: log the failure (e.g., `[error] post-exec: TeamCreate failed for {trigger-id} — {error}`), write a failure marker to `${HIVE_STATE_DIR}/specialist-phases/{trigger}/{epic-id}/failure.md`, and continue to the next trigger. Do not crash execute.

   **(ii) workflow field set AND workflow file MISSING from disk:**
   Log `[info] post-exec: specialist workflow not yet built — skipping {trigger-id}` → no-op. Continue to next trigger.

   **(iii) workflow field empty:**
   Log `[info] post-exec: specialist phase {trigger-id} not yet implemented — skipping` → no-op. Continue to next trigger.

   Cases (ii) and (iii) use DISTINCT log messages — do NOT collapse them. Both are valid no-ops; distinct messages are the operational basis for case triage.

   > **v1 note:** v1 routing handles `workflow`-based catalog entries only. A catalog entry with `skill: <path>` (allowed by catalog schema but unused in v1) is not reached by condition (i) and falls to condition (ii) or (iii). Skill-based routing is a Phase 6 extension point.

8. After all stories complete, produce a summary of the epic execution.

## Key References

- **`references/team-execution.md`** — TeamCreate prompt template, sidecar injection, per-story commits, respawn monitoring
- **`references/sequential-execution.md`** — Per-story workflow steps, sidecar injection at review, episode records, gate checks
- `hive/references/agent-teams-guide.md` — Team mechanics and limitations
- `hive/references/methodology-routing.md` — Methodology selection
- `hive/references/episode-schema.md` — Status marker format
- `hive/references/cycle-state-schema.md` — Persistent decision tracking
- `hive/references/step-file-schema.md` — Step file format
- `hive/references/specialist-triggers.md` — Trigger catalog (loaded in step 2b)
- `hive/agents/orchestrator.md` — Orchestrator coordination guidance
- `skills/hive/skills/respawn/SKILL.md` — Agent respawn protocol and detection heuristics
- `skills/hive/skills/agent-spawn/SKILL.md` — Agent spawning with respawn continuation support
- `hive/lib/dag_executor/__init__.py` — `executor_enabled_for(workflow_name)` and `run_workflow(...)` (consumer-side flag readers and the executor invocation surface from hde-9a)
- `hive/references/workflow-schema.md#executor-cutover-additive--registry-gated` — schema-level note that cutover is additive and registry-gated
