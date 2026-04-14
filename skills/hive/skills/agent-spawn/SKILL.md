# Agent Spawn Skill

Spawn a roster agent with full config validation, persona injection, and memory loading. This skill enforces the pre-spawn checklist from the orchestrator persona — use it instead of raw TeamCreate or Agent calls for story-level work.

**Input:** `$ARGUMENTS` contains the agent name and story context.

## When to Use

- **Orchestrator** spawning a team lead or specialist for a story
- **Team lead** spawning sub-workers (developer, tester, reviewer) for workflow steps
- Any time a roster agent needs to be created with its full persona and context

## When NOT to Use

- Quick inline questions where Agent tool is sufficient (no persona needed)
- The orchestrator deciding to handle work solo (no spawn needed)

## Procedure

### 1. Validate the agent name

Check that the requested agent exists in the roster:

```
hive/agents/{agent-name}.md
```

If the file does not exist: **STOP. Do not improvise a replacement.** Report the error and suggest the closest roster match.

Available roster (check `hive/agents/` for the current list):
`researcher`, `technical-writer`, `developer`, `frontend-developer`, `backend-developer`, `tester`, `reviewer`, `architect`, `analyst`, `tpm`, `ui-designer`, `pair-programmer`, `peer-validator`, `team-lead`, `test-scout`, `test-worker`, `test-inspector`, `test-sentinel`, `test-architect`, `animations-specialist`, `accessibility-specialist`, `idiomatic-reviewer`, `performance-reviewer`, `security-reviewer`

### 2. Read the agent's persona and config

Read `hive/agents/{agent-name}.md` in full. Parse the YAML frontmatter to extract:

- `model` → maps to the `model` parameter on Agent/TeamCreate
- `knowledge` → memory paths to load
- `skills` → skills to inject if their `use-when` matches the task
- `tools` → tool list for the agent
- `required_tools` → external tools to validate
- `domain` → write restrictions to communicate to the agent

### 3. Check required tools

For each entry in `required_tools`:

- **CLI tools** (`type: cli`): run `which {name}` to check availability
- **MCP tools** (`type: mcp`): check if the MCP server is in the active session

If a required tool is missing:
- If `fallback` is specified: note the fallback, proceed with a warning
- If no `fallback`: **STOP. Report the missing tool.** Do not silently proceed.

### 4. Resolve all paths

Before reading any `knowledge` or `skills` paths, normalize them:

- `~` or `~/` → expand to the user's home directory (`$HOME`)
- `${CLAUDE_PLUGIN_ROOT}` → expand to the plugin's installation directory
- Relative paths (no prefix) → resolve relative to the project root

**This is mandatory.** Paths containing unexpanded `~` or `${CLAUDE_PLUGIN_ROOT}` will silently fail to resolve. Always expand before reading.

Validation: after expansion, check that the resolved path exists. If it doesn't and no fallback is specified, log a warning (don't block the spawn — the directory may not have been bootstrapped yet).

### 5. Load agent memories (wiki-first retrieval)

Read the agent's memory directory (from the resolved `knowledge` paths).

**5a. Check wiki freshness:**
- Read `~/.claude/hive/memory-wiki/meta/compiled-at.md`
- If file absent or timestamp > 24 hours old: go to step 5c (L0 fallback)
- If file present and recent: proceed to step 5b

**5b. Wiki-based retrieval (L1):**
- Read `~/.claude/hive/memory-wiki/index.md`
- Identify topic slugs most relevant to the current task/story description
- Read the corresponding topic articles from `~/.claude/hive/memory-wiki/topics/`
- Optionally read the agent's digest from `~/.claude/hive/memory-wiki/agents/{agent}.md`
- Format loaded content as the "Prior Knowledge" block (same injection format as below)
- Proceed to step 5d for staleness surfacing

**5c. L0 fallback (keyword scan — current behavior):**
- Scan the memory directory for all `.md` files
- Read each memory's frontmatter `description` field
- Check relevance to the current task (keyword match: memory descriptions vs story description/context)
- Load the full content of relevant memories
- `override` and `pitfall` types always load (bypass relevance filter)
- `reference` type loads when topic keyword matches
- Cap at 5 memories; prefer recency
- Format as "Prior Knowledge" block

**5d. Staleness and override surfacing:**
- For each loaded memory: check `last_verified` + `ttl_days` vs today's date
- If past TTL: prepend `⚠ last verified: N days ago` to that memory's entry in Prior Knowledge
- Count override-type memories loaded; if count > 0, add header line:
  `{N} override memories loaded — oldest: {X} days since last_verified`
- These are informational signals, not blocking errors

**5e. KG Decision Context (L2 — when kg.sqlite active):**
- Run `query_decisions({subject: current_agent})` to fetch currently-valid triples where the agent (or its current epic) appears as subject or object
- See `hive/references/knowledge-graph-schema.md` → "query_decisions() Query Logic" for the SQL
- If results exist: append a **"Decision Context (from knowledge graph)"** block to Prior Knowledge AFTER the memory entries. Format as:
  ```
  ### Decision Context (from knowledge graph)
  - {subject} {predicate} {object} (since {valid_from}, via {source_epic})
  - ...
  ```
- **This block does NOT count against the 5-memory cap.** Memory cap applies only to the L0/L1 entries from steps 5b/5c.
- If kg.sqlite is not found, empty, or the query returns no results: **omit the block silently — do not raise an error.**

Include relevant memories in the agent's prompt as a "Prior Knowledge" section, after the persona and before the task instructions.

### 6. Check for applicable skills

For each skill in the agent's `skills` list:
1. Read the `use-when` description
2. If it matches the current task, check if the skill file exists at the resolved path
3. If the file exists: read it and include in the agent's prompt
4. If the file does not exist and `optional: true`: skip silently — the agent has fallback behavior
5. If the file does not exist and not optional: **STOP. Report the missing skill.**

### 7. Construct the spawn call

#### 7.0 Resolve backend (model provider)

Decide whether this spawn runs through Claude (default) or an external model.
Resolution order, first match wins:

1. Explicit `backend_override` passed in by the caller
2. `agent_backends.{agent-name}` in `hive/hive.config.yaml`
3. Default: `claude`

Supported backends: `claude` | `codex`.

If the resolved backend is `codex`:

- Record the backend in the episode record (for future cost/bias telemetry).
- Resolve `pane_mode` from the caller: `one-shot` (default) or `persistent`.
  - `one-shot`: open pane, send prompt, capture output, close pane (standard).
  - `persistent`: two sub-modes depending on whether `existing_surface_id` is
    provided:
    - **No surface_id (initial):** open pane, start codex interactive, return
      `surface_id` to caller. Do NOT send the task prompt or close the pane.
    - **Surface_id provided (follow-up):** send the prompt to the existing
      pane, poll for completion, capture output. Do NOT close the pane.
- Build the full prompt structure (steps 7.1 persona, 7.2 domain, 7.3 prior
  knowledge, 7.4 skills, 7.5 task) exactly as described below for one-shot
  mode and persistent follow-up mode. Skip prompt building for persistent
  initial mode because that call only opens the pane and returns `surface_id`.
- Do NOT call Agent/TeamCreate. Delegate to the `codex-invoke` skill with
  the built prompt, `pane_mode`, and optional `existing_surface_id`. Return
  its report. All subsequent steps in this skill (7b respawn, 8 report)
  still apply — codex-invoke is the dispatch, not a replacement for the
  surrounding procedure.

If the resolved backend is `claude`, proceed with the Agent/TeamCreate call
below unchanged.

#### 7.1 Resolve terminal multiplexer and pane mode

Read `hive.config.yaml` → `execution.terminal_mux`. Values:

- `tmux` (default): use TeamCreate/Agent which spawns tmux panes natively
- `cmux`: spawn the agent in a cmux split pane via the cmux CLI
- `auto`: check `which cmux` first; if available, use cmux; otherwise tmux

Also read `execution.interactive_panes` (default: `true`). This controls
whether cmux-spawned agents (both Claude and Codex backends) launch in
interactive mode or one-shot mode:

- `true`: launch in interactive mode. The agent stays alive for follow-up
  messages from the orchestrator. Required for cmux team execution (step 6b).
- `false`: launch in one-shot mode (`claude -p` / `codex exec`). Agent
  receives one prompt, runs, exits. No follow-up messaging possible.

#### 7.2 Agent/TeamCreate call (claude backend, tmux path)

When `terminal_mux` resolves to `tmux`, use the standard Agent/TeamCreate call:

```
Agent(
  prompt: [full persona markdown + story context + memories + skills + domain note],
  model: "{model}",  // opus, sonnet, or haiku
  name: "{agent-name}-{story-id}",
  description: "{agent-name} working on {story-id}"
)
```

#### 7.3 cmux pane spawn (claude backend, cmux path)

When `terminal_mux` resolves to `cmux`, spawn the agent in a visible cmux
split pane instead of using TeamCreate:

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
   - Persona — the full agent markdown file
   - Domain note — "You may modify files matching: {allow patterns}."
   - Prior knowledge — relevant memories

   **Task prompt file** (`<task-tempfile>`): contains the work assignment —
   everything that should be a user-level message:
   - Applicable skills
   - Continuation context (respawn only)
   - Task — the story spec, step instructions, and inputs from prior steps

   This split matters: with `--append-system-prompt-file`, the persona is
   injected as a system instruction with full authority. With TeamCreate/Agent,
   the `prompt` parameter handled this implicitly. In cmux panes, we must be
   explicit — persona-as-user-message loses authority and agents drift.

5. **Build the allowed tools list:** read the agent's `tools` field from the
   persona frontmatter. Map each tool name to the `--allowedTools` format:
   - Standard tools: `Bash`, `Edit`, `Read`, `Write`, `Grep`, `Glob`
   - Tool patterns: `Bash(git *)`, `Bash(npm *)`, etc.
   - If the persona has `domain.allow` patterns, include `Edit` and `Write`
     scoped to those patterns where possible

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
   and parallel stories, it should warn and fall back to TeamCreate (tmux path).

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

For the **tmux path** (TeamCreate/Agent), all six parts are concatenated into
the single `prompt` parameter — the framework handles system-level injection:
1. **Persona** — the full agent markdown file
2. **Domain note** — "You may modify files matching: {allow patterns}."
3. **Prior knowledge** — relevant memories from the agent's memory directory
4. **Applicable skills** — skill content if any matched
5. **Continuation Context** (respawn only) — see step 7b below
6. **Task** — the story spec, step instructions, and any inputs from prior steps

For the **cmux path**, the same content is split across two injection points:

*System prompt file* (via `--append-system-prompt-file`):
1. **Persona** — the full agent markdown file
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
- Backend: claude (Agent/TeamCreate) | codex (cmux pane via codex-invoke)
- Terminal mux: tmux (TeamCreate) | cmux (surface id: X)
- Respawn: yes (iteration {N} of 3) | no (fresh spawn)
- Required tools: available / missing (with fallback)
- Memories loaded: count and names
- Skills injected: count and names
- Continuation context: loaded from {path} | none
- Domain restrictions communicated
- Backend-specific info (codex only): surface id, transcript path, meta path,
  approval policy + source, thread id (or null)
- Pane mode (codex only): one-shot | persistent. If persistent, surface_id is
  returned for reuse by subsequent steps (implement, fix-loop, shutdown).

## Key Rules

1. **Never improvise replacements.** If a roster persona exists for the task, use it. If it fails, improve the persona — don't bypass it.
2. **Always inject the full persona.** Do not summarize, excerpt, or paraphrase the agent markdown.
3. **Always pass the model parameter.** Without it, the spawner may default to the wrong tier.
4. **Always load memories.** Memories are what make agents improve over time. Skipping them wastes accumulated knowledge.
5. **Always communicate domain.** The agent needs to know its write boundaries.
