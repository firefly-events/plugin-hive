---
name: standup
description: Run the daily ceremony — standup, planning, execution.
---

# Hive Standup

Run the daily ceremony workflow: standup → planning → execution.

**Input:** `$ARGUMENTS` optionally contains an epic ID to focus on.

## Kickoff Gate

**Before doing anything else**, check whether Hive has been initialized for this project:

1. Check if `.pHive/project-profile.yaml` exists in the project root
2. If it exists, verify it has a populated `tech_stack` field (not empty, not null)
3. As a secondary check, verify `hive.config.yaml` exists (check both `hive/hive.config.yaml` and `hive.config.yaml` in the project root — either location is valid)

If **any** of these checks fail, display this message and **stop** — do not proceed with the standup:

> Hive hasn't been set up for this project yet. Run `/hive:kickoff` first — it takes a few minutes and ensures every agent has full context about your codebase, preferences, and available tools.

If all checks pass, proceed silently — do not announce that the kickoff gate passed. Only surface this section when a check fails.

## Before Executing Any Skill

1. **Load your persona.** Read `hive/agents/orchestrator.md` — it contains team evaluation criteria, pre-spawn checklist, circuit breakers, model tier routing, dev-on-standby pattern, decision protocols, and research prompt construction rules. This is WHO you are and HOW you make decisions.
2. **Load project config.** Read `hive/hive.config.yaml` for execution settings (methodology, parallel teams, circuit breaker limits, model overrides).
3. **Load your memories.** Read the `knowledge` paths from your orchestrator frontmatter. Scan `~/.claude/hive/memories/orchestrator/` for all `.md` files. Read each file's frontmatter `description` field. Load the full content of any memories relevant to the current task. If no memories exist yet, proceed — this is expected for new projects.

## Process

Load `hive/workflows/daily-ceremony.workflow.yaml` and execute its three phases. Each phase has step files at `hive/workflows/steps/daily-ceremony/`.

**Phase 1 — Standup:** Reconstruct state from previous sessions. Read status markers (`.pHive/episodes/`), cycle state (`.pHive/cycle-state/`), task tracker (pending human items), and agent memories. Present structured report to user.

**Phase 2 — Planning:** User short-lists today's work. Evaluate whether items need new planning or are already storied. If new work, run a compressed planning swarm. Present plan with agent-ready checklist results. User approves.

**Phase 3 — Execution:** Kick off dev team(s) for approved work. After completion, run session-end evaluation for insight promotion/discard.

**Daily restart model:** The orchestrator starts fresh each day with a 1M context window. The standup phase compresses prior state into the new session via status markers, cycle state, and task tracker — not by resuming a prior conversation.

## Step Files

| Step | File | Phase |
|------|------|-------|
| Load state | `hive/workflows/steps/daily-ceremony/step-01-load-state.md` | Standup |
| Load memories | `hive/workflows/steps/daily-ceremony/step-02-load-memories.md` | Standup |
| Present standup | `hive/workflows/steps/daily-ceremony/step-03-present-standup.md` | Standup |
| Select work | `hive/workflows/steps/daily-ceremony/step-04-select-work.md` | Planning |
| Validate stories | `hive/workflows/steps/daily-ceremony/step-05-validate-stories.md` | Planning |
| Approve plan | `hive/workflows/steps/daily-ceremony/step-06-approve-plan.md` | Planning |
| Kick off | `hive/workflows/steps/daily-ceremony/step-07-kick-off.md` | Execution |
| Session end | `hive/workflows/steps/daily-ceremony/step-08-session-end.md` | Execution |

## Key References

- `hive/workflows/daily-ceremony.workflow.yaml` — workflow definition
- `hive/references/agent-memory-schema.md` — insight evaluation at session end
- `hive/references/episode-schema.md` — status marker format
- `hive/agents/orchestrator.md` — orchestrator coordination guidance
