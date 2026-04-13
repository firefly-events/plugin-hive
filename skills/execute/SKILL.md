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

## Delegation Rules (MANDATORY)

**The orchestrator is a coordinator, not an implementor.** The orchestrator MUST NOT:
- Write application code, tests, or configuration files directly
- Read source files to analyze or fix them
- Run tests, linters, or build commands
- Perform any work that belongs to a roster agent (developer, reviewer, tester, etc.)

**The orchestrator MUST delegate all implementation work using the correct tool:**

| Scope | Tool | Why |
|---|---|---|
| **Parallelizing stories across the epic** | `TeamCreate` | Stories run in separate tmux panes for visibility and independence |
| **Sequential workflow steps within a single story** | `Agent` | Steps within a teammate's pane run inline — this is correct |
| **Specialist phase teams (pre-exec, post-exec)** | `TeamCreate` | Specialist teams are independent coordination units |

**Using `Agent` to execute stories is a protocol violation.** `Agent` is only correct for workflow steps *within* an already-spawned teammate. If the orchestrator finds itself about to call `Agent` with a story's worth of work, it MUST use `TeamCreate` instead.

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

   If all four: use **agent team execution** (step 6).
   Otherwise: use **sequential execution** (step 7).

6. **Agent team execution.** Follow **`references/team-execution.md`** for the full TeamCreate prompt template, per-story commit pattern, and respawn monitoring.

7. **Sequential execution.** Follow **`references/sequential-execution.md`** for the step-by-step workflow within each story, episode records, gate checks, and respawn monitoring.

8. After all stories complete, produce a summary of the epic execution.

## Key References

- **`references/team-execution.md`** — TeamCreate prompt template, respawn monitoring
- **`references/sequential-execution.md`** — Per-story workflow steps, episode records, gate checks
- `hive/references/agent-teams-guide.md` — Team mechanics and limitations
- `hive/references/methodology-routing.md` — Methodology selection
- `hive/references/episode-schema.md` — Status marker format
- `hive/references/cycle-state-schema.md` — Persistent decision tracking
- `hive/references/step-file-schema.md` — Step file format
- `hive/agents/orchestrator.md` — Orchestrator coordination guidance
- `skills/hive/skills/respawn/SKILL.md` — Agent respawn protocol and detection heuristics
- `skills/hive/skills/agent-spawn/SKILL.md` — Agent spawning with respawn continuation support
