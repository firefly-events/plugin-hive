# Agent Teams Guide

Agent teams are Claude Code's experimental multi-agent system for parallel task execution. When available, Hive uses agent teams to run independent stories from an epic concurrently — each story becomes a task assigned to a separate teammate with its own context window. When agent teams are unavailable, Hive falls back to sequential story execution.

Reference: https://code.claude.com/docs/en/agent-teams

## Detection

Check whether agent teams are enabled by reading the environment variable:

```
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1    # or "true"
```

If this env var is not set (or is `0`/`false`), agent teams are unavailable. The execute command must always fall back to sequential execution gracefully — no error messages, no warnings. Agent teams are an optimization, not a requirement.

Also check `hive.config.yaml` → `execution.parallel_teams: true`. Both the env var AND the config must be enabled.

## Mapping Epics to Teams

Each story in an epic maps to one task in the agent team. Story-level `depends_on` fields become task dependencies.

```yaml
# Epic stories:
#   story-a (no deps)     → task-a (unblocked, runs immediately)
#   story-b (no deps)     → task-b (unblocked, runs in parallel with a)
#   story-c (deps: a, b)  → task-c (blocked until a AND b complete)
```

Rules:

- Each story = one task
- `depends_on` in the story YAML maps directly to task dependencies
- Stories with no dependencies are unblocked and can run immediately as separate teammates
- Stories with dependencies wait until all predecessors complete before becoming available
- Within a story, phases (research, implement, test, review) still execute sequentially — parallelism is between stories, not within them

## Team Prompt Generation

Agent teams are created via the `TeamCreate` tool with natural language prompts, not by writing JSON config files.

**Tool hierarchy:**
- **Orchestrator → stories:** `TeamCreate` spawns each story-level teammate in a separate tmux pane.
- **Teammates → workflow steps:** Each teammate uses the `Agent` tool internally to spawn sub-workers (researcher, developer, tester) for individual workflow steps. These run inline within the teammate's pane — this is correct.

The execute command describes the team structure and dependencies in prose:

```
Create a team to work on epic hive-phase3.
Task 1: agent-teams-guide — no dependencies
Task 2: code-review-workflow — no dependencies
Task 3: review-command — no dependencies
Task 4: parallel-execution — depends on task 1
Tasks 1-3 can run in parallel.
```

Each task prompt includes:
- The story YAML content (acceptance criteria, steps, context)
- Any relevant reference docs the story needs
- The agent persona to use for each phase
- Episode write instructions so downstream tasks receive handoff context

## Execution Flow

1. **Lead reads the epic** — loads all story YAMLs, builds the dependency graph
2. **Lead checks detection** — if `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is not `1`, falls back to sequential
3. **Lead spawns the team** — describes tasks and dependencies in natural language
4. **Teammates self-claim work** — each teammate picks the next available unblocked task
5. **Dependencies auto-unblock** — when a task completes, tasks that depended on it become available
6. **Communication via mailbox** — teammates can message the lead or broadcast to the team
7. **Lead monitors completion** — tracks task status (pending, in-progress, completed) until all tasks finish

Each teammate operates in its own context window. The shared task list with dependency tracking is the coordination mechanism — teammates do not need to read each other's context directly.

## Fallback: Sequential Execution

When agent teams are unavailable (the default), the execute command processes stories one at a time:

1. Topologically sort stories by `depends_on`
2. Execute each story in order, running its workflow phases sequentially
3. Write episode files after each phase so downstream stories have context

This is the existing behavior from Phase 1 and requires no additional configuration. The execute command should silently use this path whenever agent teams are not detected.

## Limitations

| Limitation | Impact |
|------------|--------|
| No nested teams | A teammate cannot spawn its own team. Within a story, phases execute sequentially via subagent spawning, not agent teams. Only story-level parallelism uses teams. |
| One team per session | If the user starts a new epic execution, the previous team must be cleaned up first. |
| No session resumption | If a team session is interrupted, it cannot be resumed — the team must be recreated. |
| Task status can lag | The shared task list updates asynchronously. A teammate may briefly see stale status for other tasks. |
| Experimental feature | Disabled by default. Behavior and API may change in future Claude Code releases. |
