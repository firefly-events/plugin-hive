# Agent Teams Guide

Claude Code now models every session as having **one implicit team**. There is no
separate "create a team" step and no `TeamCreate`/`TeamDelete` tool — those were
removed. Instead, a teammate is spawned by calling the **`Agent` tool with a `name`**.
Each named `Agent` call adds a teammate to the session's implicit team, gives it its own
context window, and makes it addressable via `SendMessage`. A `team_name` argument is
accepted but ignored.

Hive uses this mechanism to run independent stories from an epic concurrently — each
story becomes a teammate spawned by name. **Concurrency is gated:** parallel teammates
require the research-preview flag `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (NOT GA). When
that flag is unset, Hive falls back to **sequential story execution**, which is the
guaranteed floor — always available, no flag required.

> **Disambiguation.** Hive's "team" is a *domain concept* — the roster of agent personas
> assembled for an epic (see `team-config-schema.md`). Claude Code's removed *team
> feature* was the `TeamCreate`/`TeamDelete` tool surface. This guide describes how the
> Hive domain concept now maps onto the `Agent(name:)` teammate mechanism. The two are
> not the same thing; do not conflate the roster with the removed tool.

Reference: https://code.claude.com/docs/en/agent-teams

## Detection

Parallel teammate dispatch is gated. Check whether it is enabled by reading the
environment variable:

```
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1    # or "true"
```

If this env var is not set (or is `0`/`false`), parallel teammates are unavailable and
the execute command MUST fall back to sequential execution gracefully — no error
messages, no warnings. Parallelism is an optimization, not a requirement; **sequential
execution is the guaranteed floor.**

Also check `hive.config.yaml` → `execution.parallel_teams: true`. Both the env var AND
the config must be enabled for parallel dispatch.

## Mapping Epics to Teammates

Each story in an epic maps to one teammate. Story-level `depends_on` fields become
dispatch-order dependencies.

```yaml
# Epic stories:
#   story-a (no deps)     → teammate-a (unblocked, spawned immediately)
#   story-b (no deps)     → teammate-b (unblocked, spawned in parallel with a when gated on)
#   story-c (deps: a, b)  → teammate-c (blocked until a AND b complete)
```

Rules:

- Each story = one named teammate (one `Agent(name:)` call)
- `depends_on` in the story YAML maps directly to dispatch dependencies
- Stories with no dependencies are unblocked; when the parallel flag is on they can be
  spawned immediately as separate teammates, otherwise they run one at a time
- Stories with dependencies wait until all predecessors complete before being spawned
- Within a story, phases (research, implement, test, review) still execute sequentially
  — parallelism is between stories, not within them

## Teammate Prompt Generation

Teammates are spawned by calling the `Agent` tool with a `name` and a natural-language
prompt — not by writing JSON config files.

**Tool hierarchy:**
- **Orchestrator → stories:** one `Agent(name:)` call spawns each story-level teammate.
  When the parallel flag is on, multiple named teammates run concurrently; when it is
  off, they are spawned one at a time (sequential floor).
- **Teammates → workflow steps:** Each teammate uses the `Agent` tool internally to spawn
  sub-workers (researcher, developer, tester) for individual workflow steps. These run
  inline within the teammate's context — this is correct.

### cmux in the tool hierarchy

When `execution.terminal_mux` resolves to `cmux`, Hive keeps the same story-level
delegation rules but changes the dispatch mechanism. Instead of spawning each story as an
in-session `Agent(name:)` teammate, the orchestrator spawns each story through the
agent-spawn skill, which opens a cmux split pane, launches `claude` directly, and returns
a `surface_id` for later messaging and polling.

The execute command describes the teammates and dependencies in prose:

```
Spawn one teammate per story for epic hive-phase3.
Task 1: agent-teams-guide — no dependencies
Task 2: code-review-workflow — no dependencies
Task 3: review-command — no dependencies
Task 4: parallel-execution — depends on task 1
Tasks 1-3 can run in parallel when CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1; otherwise
they run sequentially.
```

Each task prompt includes:
- The story YAML content (acceptance criteria, steps, context)
- Any relevant reference docs the story needs
- The agent persona to use for each phase
- Episode write instructions so downstream tasks receive handoff context

## Execution Flow

1. **Lead reads the epic** — loads all story YAMLs, builds the dependency graph
2. **Lead checks detection** — if `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is not `1`, falls
   back to sequential (the guaranteed floor)
3. **Lead spawns teammates** — one `Agent(name:)` call per unblocked story, describing
   tasks and dependencies in natural language; concurrent only when the flag is on
4. **Teammates self-claim work** — each teammate picks the next available unblocked task
5. **Dependencies auto-unblock** — when a task completes, tasks that depended on it become
   available
6. **Communication via mailbox** — teammates can message the lead or broadcast via
   `SendMessage`
7. **Lead monitors completion** — tracks task status (pending, in-progress, completed)
   until all tasks finish

Each teammate operates in its own context window. The shared task list with dependency
tracking is the coordination mechanism — teammates do not need to read each other's
context directly.

## cmux Native Execution

Overview: when `terminal_mux` is `cmux`, the orchestrator drives parallelism through cmux
panes instead of in-session `Agent(name:)` teammates. Stories run in cmux panes,
coordinated by the orchestrator's poll loop.

v2 API primitives:

- `surface.split` — create a pane for a story
- `surface.send_text` — deliver the initial prompt and follow-up messages
- `surface.read_text` — read pane output for completion and diagnostics
- `surface.health` — check whether the pane is still live
- `surface.close` — close the pane after completion or failure
- `notification.create_for_surface` — target notifications to a specific pane

Differences from in-session `Agent(name:)` teammates:

| Aspect | `Agent(name:)` teammates | cmux native |
|--------|--------------------------|-------------|
| Dispatch | One `Agent(name:)` call per story | Orchestrator loops, spawns per story |
| Dependency mgmt | Session-managed task list | Orchestrator-managed (poll + spawn) |
| Messaging | SendMessage(to: name) | surface.send_text to surface_id |
| Completion | Task result returned | [STORY-COMPLETE:{story-id}] marker + surface.health |
| Pane type | in-session teammate context | cmux pane |

When to prefer cmux: the user is already working in cmux, wants direct pane interaction,
or wants to inspect and message agents mid-execution.

Limitations: polling adds latency versus in-session teammate dispatch; the orchestrator
must stay alive to manage the loop; nested teams are still not allowed.

## Fallback: Sequential Execution

When parallel teammates are unavailable (the default — the flag is off), the execute
command processes stories one at a time. **This is the guaranteed floor; it always works
regardless of the flag.**

1. Topologically sort stories by `depends_on`
2. Execute each story in order, running its workflow phases sequentially
3. Write episode files after each phase so downstream stories have context

Sequential execution works the same regardless of `terminal_mux`. `cmux` versus `tmux`
only changes the parallel dispatch path; with the flag off, neither parallel path is
taken.

This is the existing behavior from Phase 1 and requires no additional configuration. The
execute command should silently use this path whenever parallel teammates are not
detected.

## Limitations

| Limitation | Impact |
|------------|--------|
| No nested teams | A teammate cannot spawn its own team of story-level teammates. Within a story, phases execute sequentially via subagent spawning. Only story-level parallelism uses named teammates. |
| One team per session | Every session has exactly one implicit team. Starting a new epic execution reuses that same team; finish or stand down the previous teammates first. |
| No session resumption | If a session is interrupted, its teammates cannot be resumed — they must be respawned. |
| Task status can lag | The shared task list updates asynchronously. A teammate may briefly see stale status for other tasks. |
| Parallelism is a research preview | Parallel teammates are gated behind `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` and are NOT GA. Behavior and API may change. Sequential execution is always available. |
