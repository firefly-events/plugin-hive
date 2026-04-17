---
name: codex-invoke
description: Spawn a roster agent persona in a side-by-side cmux pane running OpenAI Codex. Routes work to an external model to reduce cost and model bias. Called from agent-spawn when an agent's configured backend is `codex`.
---

# Codex Invoke Skill

Run a roster agent persona through OpenAI Codex in a visible cmux pane. Reuses
the Hive persona verbatim (via the adapter prefix) — no forked personas.

**Input:** `$ARGUMENTS` carries the already-constructed prompt (persona +
domain + prior knowledge + skills + task) from agent-spawn, plus:
`agent_name`, `story_id`, `step_id`, and optional `approval_override`.

## When to Use

- Called by `agent-spawn` step 7 when the resolved backend is `codex`
- Not called directly — go through agent-spawn so memory, skills, and domain
  are resolved the same way they are for Claude-backed spawns

## When NOT to Use

- Any task where Claude is the resolved backend (default path — use TeamCreate)
- Non-macOS machines (cmux is macOS-only — hard-fail at pre-flight)

**Supported personas (PoC):** `backend-developer`, `reviewer`. Other roster
personas may work but are untested — broaden as validated.

## Procedure

### 1. Pre-flight

All checks are hard-fail with a specific message. No fallback to Claude —
silent fallback would mask the bugs the PoC exists to find.

- `which codex` → must return a path. On miss:
  `codex-invoke: codex CLI not found on PATH. Install with: npm install -g @openai/codex && codex login`
- `which cmux` → must return a path. On miss:
  `codex-invoke: cmux CLI not found on PATH. Install: brew install --cask cmux, then symlink per https://cmux.com/docs`
- Codex auth — run the codex CLI's whoami-equivalent (check current `codex --help`
  for the exact subcommand in this version; prefer a non-interactive check).
  On miss: `codex-invoke: codex is installed but not authenticated. Run: codex login`
- Platform — if `uname` is not `Darwin`, hard-fail:
  `codex-invoke: cmux is macOS-only. This backend is PoC-scoped to Darwin. Use backend: claude on this machine.`

### 2. Resolve approval policy

Precedence: explicit `approval_override` from caller → worktree detection → default.

- Worktree detection: `git rev-parse --git-dir` returns a path containing
  `/worktrees/` OR `git worktree list --porcelain` shows the current dir as
  a linked worktree (not the main one).
- In a worktree: `auto`
- Outside a worktree: `deny`

**Map resolved policy to codex CLI flags:**
- `auto` → `--full-auto` (workspace-write sandbox + auto-approve)
- `deny` → `--sandbox read-only` (no file writes, no auto-approve)

Record the chosen policy, the mapped flags, and the source of the decision
(override vs detection) for the meta.json.

### 3. Build the system prompt

Compose in this order — do NOT paraphrase or excerpt any section:

1. **Adapter prefix** — read `${CLAUDE_PLUGIN_ROOT}/skills/hive/skills/codex-invoke/adapter-prefix.md` verbatim
2. **Persona** — full content of `hive/agents/{agent_name}.md` (frontmatter included; the adapter prefix tells codex to ignore the Claude-specific fields)
3. **Domain note** — same text agent-spawn would produce for the Claude path
4. **Prior Knowledge** — whatever agent-spawn's memory loading produced (steps 5a–5e of agent-spawn); passed in via `$ARGUMENTS`
5. **Applicable skills** — passed in via `$ARGUMENTS`
6. **Task** — the story spec, step instructions, and inputs from prior steps

Do not add headers, wrappers, or summaries beyond what's already in those
sections. The adapter prefix is the ONLY new text this skill injects.

### 4. Open the cmux pane

```
cmux tree                       # capture surface list before
cmux new-split right            # open new pane
cmux tree                       # capture surface list after — diff to find new surface
```

Identify the new surface by diffing the tree output. Record its `surface_id`
(e.g., `surface:13`). If no new surface appears, hard-fail:
`codex-invoke: cmux new-split did not create a new surface. Is cmux running?`

### 5. Build and send the codex command

Codex CLI reference (v0.118+):
- `codex exec [PROMPT]` — non-interactive agent execution
- `codex review --uncommitted [PROMPT]` — review uncommitted changes (note:
  `review` does NOT support `-o`; use `exec` when output capture is needed)
- `-m <model>` — override model
- `-o <file>` — write last message to file (exec only)
- `--json` — JSONL event stream to stdout
- `-C <dir>` — set working directory
- `--full-auto` — auto-approve + workspace-write sandbox
- `--sandbox read-only` — read-only sandbox (no file writes)
- `--sandbox workspace-write` — sandbox with write access to working dir

**Approval policy → codex flags mapping:**
- `auto` (worktree detected): `--full-auto`
- `deny` (no worktree / default): `--sandbox read-only`
- Caller override is passed through directly

**Command pattern — always chain the cmux signal at the end:**

```
cmux send --surface <id> "codex exec <approval_flags> -o <output_path> -C <workdir> - < <tempfile> ; cmux wait-for -S codex-<surface_id>-done"
cmux send-key --surface <id> enter
```

The `; cmux wait-for -S codex-<surface_id>-done` fires a named signal when
codex exits (success or failure). The orchestrator blocks on this signal
(see step 7a).

Write long prompts to a temp file first and pass `-` as the prompt to read
from stdin:
```
cmux send --surface <id> "codex exec <approval_flags> -o <output_path> - < <tempfile> ; cmux wait-for -S codex-<surface_id>-done"
cmux send-key --surface <id> enter
```

### 6. Verify launch (failure detection)

After sending the command, wait 3 seconds, then read the pane:

```
sleep 3
cmux read-screen --surface <id>
```

Scan the output for failure indicators:
- `error:` — CLI argument error (wrong flags, missing args)
- `Error:` — runtime error (auth failure, network)
- Shell prompt reappeared (e.g., `$` or `%` at the last line) — codex exited
  immediately

If any failure is detected:
1. Capture the full error via `cmux read-screen --surface <id> --scrollback`
2. Write the error to the transcript path for diagnostics
3. **Hard-fail** with the captured error message — do not silently proceed
4. Close the pane: `cmux close-surface --surface <id>`

If the pane shows codex actively running (progress lines, no shell prompt),
proceed to step 7.

### 7a. Wait for codex to finish (callback signal)

The orchestrator blocks until codex completes:

```
cmux wait-for codex-<surface_id>-done --timeout <step_timeout_seconds>
```

`step_timeout_seconds` comes from `hive.config.yaml` →
`circuit_breakers.step_timeout_minutes` × 60 (default: 600s).

When the signal fires:
- Read the output file (`-o` path) — this is the codex response
- Proceed to step 7b for transcript capture

If the timeout expires:
- Capture current pane state via `cmux read-screen --surface <id> --scrollback`
- Write partial transcript to diagnostics
- Hard-fail with timeout error — the orchestrator decides whether to retry

### 7b. Capture transcript + meta

Create the episode codex dir if needed:

```
mkdir -p state/episodes/{story_id}/codex
```

Paths (use ISO-8601 timestamp for collision safety, e.g. `20260414T143012Z`):

- Transcript: `state/episodes/{story_id}/codex/{agent_name}-{ts}.transcript.md`
- Meta:       `state/episodes/{story_id}/codex/{agent_name}-{ts}.meta.json`

Transcript capture strategy (PoC):
- Prefer reading codex's own session log if it writes one (check `~/.codex/` or
  equivalent; varies by codex version). Symlink/copy to the transcript path.
- Fallback: `cmux read-screen --surface <id> --scrollback` captures the full
  pane scrollback. Write what's available at skill exit. Loose capture is
  acceptable for PoC — the transcript is a diagnostic artifact, not the contract.

Meta JSON shape:

```json
{
  "agent_name": "backend-developer",
  "story_id": "codex-developer-poc-test-1",
  "step_id": "implement",
  "surface_id": "<cmux surface id>",
  "approval_policy": "auto",
  "approval_source": "worktree-detection",
  "thread_id": "<codex thread id or null>",
  "persona_file": "hive/agents/backend-developer.md",
  "adapter_prefix_version": 1,
  "started_at": "2026-04-14T14:30:12Z",
  "transcript_path": "state/episodes/.../backend-developer-20260414T143012Z.transcript.md"
}
```

Thread id capture: scan the transcript for a codex thread/session identifier
with a loose regex (the exact format varies between codex versions). If not
found, set `thread_id: null` and log a warning — DO NOT fail the spawn.

### 8. Report

Return to the caller (agent-spawn):

- Backend: `codex`
- Surface id and where to view it (`cmux focus-surface --surface <id>`)
- Transcript path and meta path
- Approval policy used + source
- Pre-flight results (codex: ok, cmux: ok, auth: ok, platform: ok)
- Memories loaded count (from the passed-in prompt build)
- Skills injected count (from the passed-in prompt build)
- Domain restrictions communicated
- Thread id (or `null` with a note)

## Key Rules

1. **Hard-fail on missing prerequisites.** No Claude fallback during PoC — the
   whole point is to surface codex-specific issues.
2. **Never fork the persona.** Reuse `hive/agents/{agent_name}.md` verbatim.
   Adapter text lives only in `adapter-prefix.md`.
3. **Never edit the adapter inline.** If behavior needs to change, edit
   `adapter-prefix.md` and bump its version comment.
4. **Preserve the spawn contract.** Output report shape should match
   agent-spawn's Claude-path report so the orchestrator is backend-agnostic.
5. **Episode record always gets backend info.** Future cost/bias telemetry
   depends on every spawn recording which backend it used.

## Known Limitations (PoC)

- macOS-only (cmux constraint)
- Transcript capture is best-effort, not structured
- Thread id parsing is loose regex — follow-up story migrates to codex
  JSON-RPC for reliable structured events
- No multi-turn resume yet — thread id is captured for future use
