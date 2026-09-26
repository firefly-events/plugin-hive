# Agent Spawn Skill

Spawn a roster agent with full config validation, persona injection, and memory loading. This skill enforces the pre-spawn checklist from the orchestrator persona — use it instead of calling the `Agent` tool directly for story-level work.

**Input:** `$ARGUMENTS` contains the agent name and story context.

## When to Use

- **Orchestrator** spawning a team lead or specialist for a story
- **Team lead** spawning sub-workers (developer, tester, reviewer) for workflow steps
- Any time a roster agent needs to be created with its full persona and context

## When NOT to Use

- Quick inline questions where Agent tool is sufficient (no persona needed)
- The orchestrator deciding to handle work solo (no spawn needed)

## Procedure

### 1-4. Resolve persona context

Invoke `skills/hive/skills/persona-resolve/SKILL.md` with:

- `agent_name` from `$ARGUMENTS`
- `task_context` from `$ARGUMENTS`

Bind the returned `persona_context`. Subsequent sections must read persona text,
frontmatter, resolved paths, validated tools, and domain constraints from
`persona_context` instead of re-reading `hive/agents/{agent-name}.md`.

### 5. Load agent memories

Invoke `skills/hive/skills/memory-loading/SKILL.md` with:
- `persona_context`: from sections 1-4
- `task_description`: story spec + current step task text
- `epic_handle`: the parent epic identifier (optional, enables L2 KG decision context)

Consume `prior_knowledge_block`, `staleness_signals`, and `memory_count`. Inject `prior_knowledge_block` as the "Prior Knowledge" section after the persona and before the task instructions in the assembled prompt structure.

Derive the learning-loop dimensions from `memory_count` (this is the only point in the spawn path where warm-vs-cold is actually known, not guessed):
- `prior_experience_injected = memory_count > 0`
- `prior_experience_count = memory_count`

**CAVEAT (loud, do not drop):** this derivation only happens on the classic tmux `Agent(name:)` path described by this skill. The Hermes/multica-dispatched execution loop respawns agents cold and does not call `memory-loading` or set these dimensions — a Hermes run showing `prior_experience_injected` absent means "this path isn't wired warm yet," not "injection had no effect." Do not read absence-of-dimension on that path as evidence against the learning loop.

When emitting the `agent_spawn` metrics event for this spawn (`hooks/metrics-agent-spawn.sh`), pass these through as `HIVE_PRIOR_EXPERIENCE_INJECTED` (`"true"`/`"false"`) and `HIVE_PRIOR_EXPERIENCE_COUNT` so they land in `dimensions.prior_experience_injected` / `dimensions.prior_experience_count` on the emitted row. See `.pHive/metrics/metrics-event.schema.md` §5 for the dimension contract.

### 6. Check for applicable skills

For each skill in `persona_context.frontmatter.skills`:
1. Read the `use-when` description
2. If it matches the current task, check if the skill file exists at the path in `persona_context.resolved_paths.skills`
3. If the file exists: read it and include in the agent's prompt
4. If the file does not exist and `optional: true`: skip silently — the agent has fallback behavior
5. If the file does not exist and not optional: **STOP. Report the missing skill.**

### 7. Construct the spawn call

#### 7.0 Resolve backend (model provider)

Invoke `skills/hive/skills/backend-dispatch/SKILL.md` with:
- `persona_context`, `agent_backends` map from root `hive.config.yaml`, optional `backend_override`
- `prompt_parts` assembled from §7.1–§7.5 below (the cmux path splits these across system + task prompt files; see §7.3)
- `caller_mode` (`team-execution` or `standalone`), `pane_mode` (`one-shot` or `persistent`, codex only), and `existing_surface_id` (codex persistent follow-up only)

Consume `resolved_backend`, `dispatch_decision`, and `dispatch_result`. When `resolved_backend == codex` the skill delegates to `codex-invoke`; respawn handling (§7b) and episode reporting (§8) still apply on the surrounding agent-spawn procedure.

#### 7.1 Resolve terminal multiplexer and pane mode

Read `hive.config.yaml` → `execution.terminal_mux`. Values:

- `tmux` (default): use `Agent(name:)` which spawns tmux panes natively
- `cmux`: spawn the agent in a cmux split pane via the cmux CLI
- `auto`: check `which cmux` first; if available, use cmux; otherwise tmux

Also read `execution.interactive_panes` (default: `true`). This controls
whether cmux-spawned agents (both Claude and Codex backends) launch in
interactive mode or one-shot mode:

- `true`: launch in interactive mode. The agent stays alive for follow-up
  messages from the orchestrator. Required for cmux team execution (step 6b).
- `false`: launch in one-shot mode (`claude -p` / `codex exec`). Agent
  receives one prompt, runs, exits. No follow-up messaging possible.

#### 7.2 `Agent(name:)` call (claude backend, tmux path)

When `terminal_mux` resolves to `tmux`, use the standard `Agent(name:)` call:

```
Agent(
  prompt: [persona_context.persona_text + story context + memories + skills + domain note + completion contract],
  model: "{persona_context.frontmatter.model}",  // opus, sonnet, or haiku
  name: "{agent-name}-{story-id}",
  description: "{agent-name} working on {story-id}"
)
```

**Completion contract (tmux/`Agent(name:)` path only — E5 s1):** this is the
only dispatch path `SubagentStop` fires for, and `hooks/notify-agent-complete.sh`
derives its verdict solely from a self-written `<cwd>/.hive-task-status.json`
marker (no exit-status field exists in the payload — see
`.pHive/epics/e5-execution-loop/docs/design-discussion.md` §2, §4 R1). Append
this instruction to the assembled task prompt so every tmux-dispatched agent
writes the marker as its last action. Canonical source of this block:
`hive/references/completion-contract.md` — the team-execution per-story
template (`skills/execute/references/team-execution.md`) carries the same
byte-identical block for named-teammate spawns; keep both copies in sync:

```
## Completion Contract
Before you finish, as your LAST action, run exactly one of:
  bash "${CLAUDE_PLUGIN_ROOT}/hooks/write-task-status.sh" success
  bash "${CLAUDE_PLUGIN_ROOT}/hooks/write-task-status.sh" failure
Use "success" only if every acceptance criterion for this task was met and
all required tests pass. Use "failure" otherwise. A missing marker is always
read downstream as failure, never success — so skipping this step silently
fails the story even if your work was correct.
```

Not required on the cmux path (no `SubagentStop` binding; completion is
detected via the `[STORY-COMPLETE:{story-id}]` scrollback marker instead —
see §7.3 step 11) or for Bash `run_in_background` dispatch (no completion
hook exists for that path at all — carve-out, not fixed).

**wr-5 investigation finding, REVISED round 1 (do not re-wire elsewhere):**
`Agent(name:)` over the tmux backend is the ONLY *class* of spawn in the
codebase that binds `SubagentStop` — but round 0 wrongly treated that as one
prompt-assembly path. It is two: this section's solo spawn template, and the
separate named-teammate template in
`skills/execute/references/team-execution.md` (team-execution Step 6), which
the runtime's natural-language auto-spawn model also dispatches over
`Agent(name:)`/tmux. Round-1 fetched a real delivered team-execution prompt
from the WFD campaign transcripts and found the contract text absent —
team-execution.md's template never had it (fixed now; see that file). Two
other production dispatch bindings look similar but are structurally out of
reach the same way as cmux/bg, for a different reason (no tracked subagent,
not just no hook registration):
- `LocalAgentSpawn` (`hive/lib/dag_executor/executor/handlers/agent.py`)
  shells `claude --print` as a one-shot top-level CLI process — it is never
  an `Agent`-tool subagent of the calling session, so `SubagentStop` cannot
  fire for it regardless of prompt content. Its `build_prompt()` does not
  (and structurally could not usefully) append this contract.
- `MulticaAgentSpawn` (same file) and `execute-mode-multica/SKILL.md` Step 2
  dispatch to an independent Multica-managed session and poll the issue's
  status via the Multica API (`pollTaskUntilTerminal`) — again a separate
  top-level process, not a subagent, with its own completion signal entirely
  unrelated to `.hive-task-status.json`.

Verified against real production `complete.json`/`agent_spawn` metric rows
(WFD E1-E10 campaign, 536/536 `verdict=failure`): every row's `cwd` is a
plain project directory (never a worktree path, never absent), consistent
only with `Agent(name:)` dispatch over tmux. Of those, the rows carrying real
persona `agent_type` values (e.g. `e9-s1-developer`) — i.e. exactly the
population this contract targets — were all named-teammate dispatches from
team-execution.md's assembler, still 100% `verdict=failure`. Grepping a real
delivered transcript for one of these rows confirmed the contract text was
never in the prompt team-execution.md sent. The gap was therefore **wiring
in team-execution.md's assembler, not honoring of this section's text** —
this section's own template was never the one used for those 31 rows. Both
assembly paths now carry the same canonical block
(`hive/references/completion-contract.md`). wr-1's completion-record
detector remains the visibility layer for the residual "agent honors the
now-present instruction inconsistently" risk this epic does not further
enforce (see grill-record.md H1-H3).
#### 7.3 cmux pane spawn (claude backend, cmux path)
When `terminal_mux` resolves to `cmux`, spawn the agent in a visible cmux
split pane instead of using the `Agent` tool:
1. **Pre-flight:** `which cmux` — if missing, fall back to tmux path with a
   warning (not a hard-fail; cmux is a visibility preference, not a backend).
2. **Open pane:** `cmux new-split right` in the current workspace.
   (v2: `surface.split`)
3. **Capture surface:** `cmux tree` before and after the split — diff to
   identify the new surface ref (e.g., `surface:13`). Record `surface_id`.
   (v2: `system.tree`)
4. **Prepare prompt files:** split the prompt into two temp files via `mktemp`:
   **System prompt file** (`<persona-tempfile>`): contains the agent's identity
   and constraints — everything that should be a system-level instruction:
   - Persona — `persona_context.persona_text`
   - Domain note — "You may modify files matching: {allow patterns}."
   - Prior knowledge — relevant memories
   **Task prompt file** (`<task-tempfile>`): contains the work assignment —
   everything that should be a user-level message:
   - Applicable skills
   - Continuation context (respawn only)
   - Task — the story spec, step instructions, and inputs from prior steps
   This split matters: with `--append-system-prompt-file`, the persona is
   injected as a system instruction with full authority. With `Agent(name:)`,
   the `prompt` parameter handled this implicitly. In cmux panes, we must be
   explicit — persona-as-user-message loses authority and agents drift.

5. **Build the allowed tools list:** read `persona_context.frontmatter.tools`.
   Map each tool name to the `--allowedTools` format:
   - Standard tools: `Bash`, `Edit`, `Read`, `Write`, `Grep`, `Glob`
   - Tool patterns: `Bash(git *)`, `Bash(npm *)`, etc.
   - If `persona_context.domain_constraints` has allow patterns, include `Edit`
     and `Write` scoped to those patterns where possible
   Also resolve `--permission-mode`:
   - If running in a worktree: `auto` (pre-approve safe operations)
   - If running in the main tree: `default` (prompt for destructive ops)
   - Caller can override via `permission_mode_override`
6. **Launch claude in the pane:** choose mode based on `execution.interactive_panes`:
   **One-shot mode** (`interactive_panes: false`):
   ```
   cmux send --surface <id> "claude -p --model <model> \
     --append-system-prompt-file <persona-tempfile> \
     --allowedTools '<tool-list>' \
     --permission-mode <mode> \
     - < <task-tempfile>"
   cmux send-key --surface <id> enter
   ```
   (`cmux send` v2: `surface.send_text`; `cmux send-key` v2: `surface.send_key`)
   **Interactive mode** (`interactive_panes: true`, default):
   ```
   cmux send --surface <id> "claude --model <model> \
     --append-system-prompt-file <persona-tempfile> \
     --allowedTools '<tool-list>' \
     --permission-mode <mode>"
   cmux send-key --surface <id> enter
   ```
   Wait for the session to initialize (poll `surface.read_text` for the claude
   prompt indicator), then deliver the task via a file-backed send to avoid
   shell-escaping issues with quotes, backticks, and `$` content regardless
   of prompt size:
   ```
   cmux send --surface <id> --from-file <task-tempfile>
   cmux send-key --surface <id> enter
   ```
   If the cmux version in use does not support `--from-file`, fall back to
   `cmux send --surface <id> "$(cat <task-tempfile>)"` — but this is best-effort
   and may mangle special characters.
   **Note:** cmux team execution (execute step 6b) requires `interactive_panes: true`.
   If the orchestrator detects `interactive_panes: false` with `terminal_mux: cmux`
   and parallel stories, it should warn and fall back to the `Agent(name:)` tmux path.
7. **Clean up temp files** after delivery. Remove both `<persona-tempfile>` and
   `<task-tempfile>`.
8. **Record in episode:** surface_id, terminal_mux: cmux, pane direction,
   permission_mode, allowed_tools list.
   The user can focus this pane anytime via `cmux focus-pane --pane <id>`
   (v2: `pane.focus`). Capture output later via
   `cmux read-screen --surface <id> --scrollback` (v2: `surface.read_text`).
9. **Completion handling depends on caller mode:**
   - **Team execution mode (execute step 6b):** return immediately after spawn
     with `surface_id`. Do not poll for completion and do not close the pane
     here — the orchestrator's poll loop owns completion detection and cleanup.
   - **Standalone spawn mode:** poll `cmux read-screen --surface <id>`
     (v2: `surface.read_text`) every 10 seconds until the shell prompt (`$` or
     `%`) reappears on the last line, which indicates `claude` exited. Use the
     step timeout from `circuit_breakers` as the max polling duration; on
     timeout, capture scrollback and hard-fail instead of continuing to
     cleanup/reporting early. Also check `surface.health` periodically — if the
     surface is no longer healthy, claude has exited unexpectedly. Capture
     scrollback and report failure.
10. **Close policy depends on caller mode:**
    - **Team execution mode:** orchestrator closes surfaces during global cleanup
      (execute step 6b). Do not close here.
    - **Standalone spawn mode:** close the pane after capturing output via
      `cmux read-screen --scrollback`: `cmux close-surface --surface <id>`
      (v2: `surface.close`). Skip if capture failed so the user can inspect
      manually.
11. **Completion marker (team execution only):** when the agent's workflow
    completes successfully, emit `[STORY-COMPLETE:{story-id}]` as the final
    output line. The orchestrator's poll loop watches for this marker via
    `surface.read_text`. If the agent crashes or times out without emitting the
    marker, `surface.health` is the fallback detection.

The cmux path splits the prompt differently from the tmux path: persona,
domain, and memories go into `--append-system-prompt-file` (system-level authority),
while skills, continuation context, and the task go as the first user message.
Memory loading, skill injection, and respawn continuation are identical in
content — only the injection point differs.
**Prompt structure (shared by both paths):**
For the **tmux path** (`Agent(name:)`), all six parts are concatenated into
the single `prompt` parameter — the framework handles system-level injection:
1. **Persona** — `persona_context.persona_text`
2. **Domain note** — "You may modify files matching: {allow patterns}."
3. **Prior knowledge** — relevant memories from the agent's memory directory
4. **Applicable skills** — skill content if any matched
5. **Continuation Context** (respawn only) — see step 7b below
6. **Task** — the story spec, step instructions, any inputs from prior steps,
   and (tmux/`Agent(name:)` path only) the Completion Contract from §7.2
For the **cmux path**, the same content is split across two injection points:
*System prompt file* (via `--append-system-prompt-file`):
1. **Persona** — `persona_context.persona_text`
2. **Domain note**
3. **Prior knowledge**
*Task prompt* (first user message):
4. **Applicable skills**
5. **Continuation Context** (respawn only)
6. **Task**
This split ensures the persona has system-level authority. Skills and task
content work correctly as user messages since they're instructions to execute,
not identity to embody.

### 7b. Handle respawn continuation (optional)

If a `respawn_summary_path` is provided (indicating this is a respawn, not a fresh spawn):

1. **Read the respawn summary** from the provided file path
2. **Parse the frontmatter** to extract `respawn_iteration`, `story_id`, `step_id`
3. **Inject the summary** into the prompt as a "Continuation Context" section (position 5 in the prompt structure above), wrapped with:

```
## Continuation Context

You are continuing work from a previous instance of yourself (respawn iteration {N}).
Review the context below carefully before proceeding. Do not repeat completed work.
Verify the current state of files and tests before assuming the summary is accurate —
things may have changed since the previous instance wrote this.

{full respawn summary content}
```

If `respawn_summary_path` is NOT provided, skip this step entirely — behavior is unchanged from a normal fresh spawn.

### 8. Report spawn result

After spawning, report:
- Agent name and model tier used
- Backend: claude (`Agent(name:)`) | codex (cmux pane via codex-invoke)
- Terminal mux: tmux (`Agent(name:)`) | cmux (surface id: X)
- Respawn: yes (iteration {N} of 3) | no (fresh spawn)
- Required tools: `persona_context.validated_tools` available / missing (with fallback)
- Memories loaded: count and names
- Prior experience injected: yes/no (`memory_count`) — classic tmux path only; see §5 caveat
- Skills injected: count and names
- Continuation context: loaded from {path} | none
- Domain restrictions communicated
- Backend-specific info (codex only): surface id, transcript path, meta path,
  approval policy + source, thread id (or null)
- Pane mode (codex only): one-shot | persistent. If persistent, surface_id is
  returned for reuse by subsequent steps (implement, fix-loop, shutdown).

## Key Rules

1. **Never improvise replacements.** If a roster persona exists for the task, use it. If it fails, improve the persona — don't bypass it.
2. **Always inject the full persona text.** Do not summarize, excerpt, or paraphrase `persona_context.persona_text`.
3. **Always pass the model parameter.** Without it, the spawner may default to the wrong tier.
4. **Always load memories.** Memories are what make agents improve over time. Skipping them wastes accumulated knowledge.
5. **Always communicate domain.** The agent needs to know its write boundaries.
