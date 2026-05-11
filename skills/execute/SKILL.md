---
name: execute
description: Execute a planned epic's stories through development workflow phases.
---

# Hive Execute

Execute stories through development workflow phases.

**Input:** `$ARGUMENTS` contains epic ID and optional flags (`--methodology tdd|classic|bdd`, `--sequential`).

## State directory resolution

All state paths in this skill are written as `${HIVE_STATE_DIR}/...`. Resolve `HIVE_STATE_DIR` from `paths.state_dir` in the ROOT `hive.config.yaml` (the consumer override layer). The shipped baseline at `hive/hive.config.yaml` is a fall-through source — it does NOT drive runtime path decisions per the Slice 1 resolver contract. The default is `.pHive`. When the root config sets a different value, substitute that value everywhere this skill writes `${HIVE_STATE_DIR}`, so relocation after marketplace install still works.

## Skill Preamble

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — kickoff gate (initialization check) + persona / config / memory loading. The kickoff gate's `${HIVE_STATE_DIR}/project-profile.yaml` reference resolves via the section above.

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

5. **Choose execution mode.** Invoke `skills/hive/skills/execute-dispatch/SKILL.md` with env, parsed root `hive.config.yaml`, parsed consumer `.pHive/hive.config.yaml`, parsed graduation registry, `workflow_name`, and `$ARGUMENTS`; consume `mode_decision`, `mode_reason`, `runner_path`, and `runner_reason`. Switch `mode_decision`: `sessions` -> step 6c, `team-cmux` -> step 6b, `team` -> step 6, `sequential` -> step 7.
5pre. **Executor cutover routing.** Use only the returned `runner_path` and `runner_reason`; do not re-evaluate the cutover tree here. If `runner_path == hive-dag`, call `hive.lib.dag_executor.run_workflow(workflow_path, dispatcher, run_state_path=..., worktree_manager=...)`; otherwise continue on the orchestrator-narrated path. Single dispatch point: this skill call is the only `/execute` policy boundary for executor-vs-orchestrator routing.

6. **Agent team execution.** Follow **`references/team-execution.md`** for the full TeamCreate prompt template, per-story commit pattern, sidecar injection for append-placement triggers, and respawn monitoring.

6b. **Agent team execution (cmux path).** Use this path when all four step-5 conditions are true and `execution.terminal_mux` resolves to `cmux`.
   Invoke `skills/hive/skills/execute-mode-team-cmux/SKILL.md` with:
   - `workflow_path`: the workflow loaded in step 3
   - `unblocked_stories[]`: the depth-0 ready stories from the topological sort
   - `appends_map`: the review-phase sidecar map from step 2b
   - `epic_handle`: the current epic identifier
   See `references/team-execution.md` for cmux-variant TeamCreate prompt details.

6c. **Session-based execution** (used when `HIVE_SESSIONS_ENABLED` or `sessions.enabled: true`). Replaces the TeamCreate path with the Claude Agent SDK `/v1/sessions` API for story-level execution.
   Invoke `skills/hive/skills/execute-mode-session/SKILL.md` with:
   - `workflow_path`: the workflow loaded in step 3
   - `unblocked_stories[]`: the depth-0 ready stories from the topological sort
   - `appends_map`: the review-phase sidecar map from step 2b
   - `epic_handle`: the current epic identifier
   - `hive_config`: parsed root `hive.config.yaml` (for `sessions.*` and `model_tiers`)

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
- `hive/references/episode-schema.md` — Status marker format. **Story state is derived from these markers — do NOT free-write `status:` in story YAMLs.** When a workflow step completes, write the corresponding episode marker; story-level state is computed from the marker set per the schema. The free-write `status:` field in some legacy story YAMLs is deprecated (per `feedback_story_status_stale`).

### Per-step token budgets (advisory caps)

When `hive.config.yaml → circuit_breakers` defines `max_tokens_per_step`, `max_tokens_per_fix_loop`, or `max_tokens_per_story`, treat them as **advisory caps** during execution:

- Track token usage per step via the existing token-capture substrate.
- When a step's cumulative tokens approach the advisory cap (≥80%), emit a structured warning to the orchestrator. Do NOT hard-block on the cap.
- When a step crosses the cap, log it as a budget_exceeded telemetry event and continue. The cap is a tuning signal for future planning, not a runtime stop.
- **Fail-open semantics.** If token data is missing for any reason (capture not enabled, persona doesn't emit usage, etc.), proceed without warnings — never fail the step on missing telemetry. The advisory cap requires data to apply; absence is silent skip, not error.

This is intentionally softer than the existing iteration-count breakers (`max_step_retries`, `max_fix_iterations`, etc.) — those gate runtime behavior; token caps tune empirical defaults via telemetry.
- `hive/references/cycle-state-schema.md` — Persistent decision tracking
- `hive/references/step-file-schema.md` — Step file format
- `hive/references/specialist-triggers.md` — Trigger catalog (loaded in step 2b)
- `hive/agents/orchestrator.md` — Orchestrator coordination guidance
- `skills/hive/skills/respawn/SKILL.md` — Agent respawn protocol and detection heuristics
- `skills/hive/skills/agent-spawn/SKILL.md` — Agent spawning with respawn continuation support
- `hive/lib/dag_executor/__init__.py` — `executor_enabled_for(workflow_name)` and `run_workflow(...)` (consumer-side flag readers and the executor invocation surface from hde-9a)
- `hive/references/workflow-schema.md#executor-cutover-additive--registry-gated` — schema-level note that cutover is additive and registry-gated
