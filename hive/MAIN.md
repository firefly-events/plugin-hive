# Hive — Main Entry Point

> Route user requests to the appropriate skill. Load your orchestrator persona at `hive/agents/orchestrator.md` for coordination principles and decision protocols.

## Commands

| Command | Trigger | Skill |
|---------|---------|-------|
| **kickoff** | `/hive:kickoff`, "initialize", "onboard", "start new project" | `skills/kickoff/SKILL.md` → `hive/references/kickoff-protocol.md` |
| **standup** | `/hive:standup`, "start the day", "daily ceremony" | `skills/standup/SKILL.md` |
| **plan** | `/hive:plan`, "plan this feature", "break into stories" | `skills/plan/SKILL.md` |
| **execute** | `/hive:execute`, "execute the epic", "run the workflow" | `skills/execute/SKILL.md` |
| **status** | `/hive:status`, "what's the status" | `skills/status/SKILL.md` |
| **test** | `/hive:test`, "run tests", "test swarm" | `skills/test/SKILL.md` |
| **review** | `/hive:review`, "review this code" | `skills/review/SKILL.md` |

Parse `$ARGUMENTS` to determine which command to run. If ambiguous, ask.

Each skill contains its own procedure, step file references, and key references. Your job is to route to the right skill, then coordinate execution using the principles in your persona (`hive/agents/orchestrator.md`).

## Before Executing Any Skill

1. **Load your persona.** Read `hive/agents/orchestrator.md` — it contains team evaluation criteria, pre-spawn checklist, circuit breakers, model tier routing, dev-on-standby pattern, decision protocols, and research prompt construction rules. This is WHO you are and HOW you make decisions.
2. **Load project config.** Read `hive/hive.config.yaml` for execution settings (methodology, parallel teams, circuit breaker limits, model overrides).
3. **Load your memories.** Read the `knowledge` paths from your orchestrator frontmatter. Scan `~/.claude/hive/memories/orchestrator/` for all `.md` files. Read each file's frontmatter `description` field. Load the full content of any memories relevant to the current task. If no memories exist yet, proceed — this is expected for new projects.

These three steps give you identity, configuration, and learning. Then route to the skill and follow its procedure.

## Memory Loading Contract

Memory loading happens at three points — all are mandatory:

1. **Orchestrator startup** (above) — loads orchestrator's own memories for coordination decisions.
2. **Agent spawn** — when spawning any agent (via the agent-spawn skill or directly), use **wiki-first retrieval**: check `~/.claude/hive/memory-wiki/meta/compiled-at.md` for freshness → if fresh, navigate the wiki index for relevant topics → if stale or absent, fall back to L0 keyword scan. Inject relevant memories into the agent's prompt as a "Prior Knowledge" section.
3. **Team lead activation** — team leads load memories for each agent they plan to spawn before assigning work.

**If memories exist but aren't loaded, agents repeat past mistakes.** This is the most common failure mode of the memory system. The fix is enforcement at the spawn point, not advisory text.

See `hive/references/memory-store-interface.md` for the MemoryStore interface that governs all memory retrieval.

## Session End — Insight Evaluation & Wiki Compilation

After epic execution completes (or at the end of a session with staged insights), evaluate and promote or discard insights, then compile the memory wiki. This is your responsibility — don't skip it.

**Process:**

1. **Scan for staged insights.** Check `.pHive/insights/` for any staged files.
2. **For each insight:**
   - Read the insight's `type`, `summary`, and `detail`
   - Check against keep criteria: is it a repeatable pattern, a pitfall warning, an override, or codebase-specific understanding?
   - Check `~/.claude/hive/memories/{agent}/` for duplicates or memories to override
   - **Promote:** write to `~/.claude/hive/memories/{agent}/{slug}.md` with frontmatter (name, description, type, agent, timestamp, source_epic, last_verified, ttl_days)
   - **Discard:** delete from staging
3. **Compile the memory wiki.** If any insights were promoted, run incremental wiki compilation (step 4d in `step-08-session-end.md`). This updates topic articles in `~/.claude/hive/memory-wiki/` so the next session's agent-spawn uses fresh wiki navigation.
4. **Clean up.** Remove `.pHive/insights/{epic-id}/` staging directories.

For borderline cases, present to the user for a keep/discard decision. Most insights should be auto-evaluated.

See `hive/references/agent-memory-schema.md` for the full schema, memory types, and keep/discard criteria.
See `hive/references/wiki-compilation-guide.md` for wiki compilation procedure and templates.

## Key References

| Resource | Path |
|----------|------|
| **Orchestrator persona** | `hive/agents/orchestrator.md` — coordination principles, team evaluation, circuit breakers, model routing, decision protocols |
| Workflow schema | `hive/references/workflow-schema.md` |
| Step file schema | `hive/references/step-file-schema.md` |
| Episode schema | `hive/references/episode-schema.md` |
| Agent memory schema | `hive/references/agent-memory-schema.md` |
| Cross-cutting concerns | `hive/references/cross-cutting-concerns.md` |
| Agent-ready checklist | `hive/references/agent-ready-checklist.md` |
| Agent teams guide | `hive/references/agent-teams-guide.md` |
| Team config schema | `hive/references/team-config-schema.md` |
| Domain access control | `hive/references/domain-access-control.md` |
| Permission patterns | `hive/references/permission-patterns.md` |
| BMAD patterns | `hive/references/bmad-patterns.md` |
| MemoryStore interface | `hive/references/memory-store-interface.md` — read/write/compile/export/import contract |
| MemoryBundle format | `hive/references/memory-bundle-format.md` — export/import federation format |
| Wiki compilation guide | `hive/references/wiki-compilation-guide.md` — compiled wiki structure and procedure |
| Onboarding guide | `hive/references/onboarding-guide.md` — starter memories, kickoff migration, federation |
