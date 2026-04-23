---
name: codex-invoke
description: Spawn a roster agent persona in a side-by-side cmux pane running OpenAI Codex. Routes work to an external model to reduce cost and model bias. Called from agent-spawn when an agent's configured backend is `codex`.
---

# Codex Invoke Skill

Run a roster agent persona through OpenAI Codex in a visible cmux pane. Reuses
the Hive persona verbatim (via the adapter prefix) — no forked personas.

**Input:** `$ARGUMENTS` carries the already-constructed prompt (persona +
domain + prior knowledge + skills + task) from agent-spawn, plus:
`agent_name`, `story_id`, `step_id`, optional `approval_override`, and
optional `pane_mode` (`one-shot` | `persistent`, default: `one-shot`).

## When to Use

- Called by `agent-spawn` step 7 when the resolved backend is `codex`
- Not called directly — go through agent-spawn so memory, skills, and domain
  are resolved the same way they are for Claude-backed spawns

## When NOT to Use

- Any task where Claude is the resolved backend (default path — use TeamCreate)
- Non-macOS machines (cmux is macOS-only — hard-fail at pre-flight)

**Supported personas (PoC):** `backend-developer`, `reviewer`,
`technical-writer`, `architect`, `tpm`, `researcher`. Other roster personas
may work but are untested — broaden as validated.

**Known-incompatible personas:** `ui-designer` — depends on Frame0 CLI and
firecrawl MCP tooling that a Codex pane cannot reliably provide. Stay on
the Claude backend for this persona.

**Validation history:**
- `backend-developer` — validated 2026-04-14 in external-model-integration
  PoC (Codex PoC-test-1 story)
- `reviewer` — validated 2026-04-18 as adversarial reviewer in
  meta-improvement-system (S4+ review cycles, Opus-override)
- `technical-writer`, `architect` — validated 2026-04-22 across
  meta-improvement-system planning (56 stories, 10 slices; research briefs,
  design discussions, H/V plans, structured outlines, architect memos and
  review memos across S1-S9 execution)
- `tpm`, `researcher` — validated 2026-04-22 across meta-improvement-system
  and hive-release-readiness planning (TPM horizontal/vertical plan
  sequencing, researcher raw findings + review-gate fact-checking)

## Contract consumed by plan-skill routing

The `Supported personas (PoC)` and `Known-incompatible personas` lists above
form the contract that the planning skill (`skills/plan/SKILL.md`) consults
when deciding whether to route a planning teammate through Codex
(`agent_backends: <persona>: codex`) or fall back to direct TeamCreate.

Plan-skill routing behavior for each case:
- Persona in `Supported personas`: route through codex-invoke.
- Persona in `Known-incompatible personas`: fall back to direct TeamCreate,
  INFO-log why (persona known-incompatible with Codex backend).
- Persona in neither list: fall back to direct TeamCreate, INFO-log that
  the persona is unvalidated for Codex and route conservatively.

Future stories that tighten or expand this contract must update both the
list(s) above AND any consumers (currently only the plan skill). Do NOT
let the lists drift out of sync with actual validation state.

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

**Command pattern — choose mode based on `execution.interactive_panes`:**

**One-shot mode** (`interactive_panes: false`, or `pane_mode: one-shot`):
```
cmux send --surface <id> "codex exec <approval_flags> -o <output_path> -C <workdir> - < <tempfile>"
cmux send-key --surface <id> enter
```

Write long prompts to a temp file first and pass `-` as the prompt to read
from stdin:
```
cmux send --surface <id> "codex exec <approval_flags> -o <output_path> - < <tempfile>"
cmux send-key --surface <id> enter
```

**Interactive mode** (`interactive_panes: true`, or `pane_mode: persistent`):
```
cmux send --surface <id> "codex"
cmux send-key --surface <id> enter
```
Then deliver prompts via temp file after the session starts. The pane stays
alive for follow-up prompts (fix loops, review feedback). This is the same
behavior as the existing persistent pane mode — `interactive_panes: true`
makes it the default for all Codex spawns, not just TDD cross-model workflows.

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

### 7a. Wait for codex to finish (polling)

Poll until codex completes:

```
while elapsed < step_timeout_seconds:
  cmux read-screen --surface <id>
  if the last line ends with a shell prompt (`$` or `%`):
    break
  sleep 10
```

`step_timeout_seconds` comes from `hive.config.yaml` →
`circuit_breakers.step_timeout_minutes` × 60 (default: 600s).

When the shell prompt reappears:
- Read the output file (`-o` path) — this is the codex response
- Proceed to step 7b for transcript capture

If the timeout expires:
- Capture current pane state via `cmux read-screen --surface <id> --scrollback`
- Write partial transcript to diagnostics
- Hard-fail with timeout error — the orchestrator decides whether to retry

### 7b. Capture transcript + meta

Create the episode codex dir if needed:

```
mkdir -p .pHive/episodes/{story_id}/codex
```

Paths (use ISO-8601 timestamp for collision safety, e.g. `20260414T143012Z`):

- Transcript: `.pHive/episodes/{story_id}/codex/{agent_name}-{ts}.transcript.md`
- Meta:       `.pHive/episodes/{story_id}/codex/{agent_name}-{ts}.meta.json`

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
  "transcript_path": ".pHive/episodes/.../backend-developer-20260414T143012Z.transcript.md"
}
```

Thread id capture: scan the transcript for a codex thread/session identifier
with a loose regex (the exact format varies between codex versions). If not
found, set `thread_id: null` and log a warning — DO NOT fail the spawn.

### 7c. Close the pane

After transcript and meta are captured, close the codex pane:

```
cmux close-surface --surface <id>
```

This keeps the workspace clean. The transcript file preserves all output.
If capture failed or was partial, skip the close so the user can inspect
the pane manually.

### 8. Report

Return to the caller (agent-spawn):

- Backend: `codex`
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

---

## Persistent Pane Mode

When `pane_mode: persistent` is passed, the skill operates differently to
support multi-turn workflows (e.g., TDD cross-model: implement → fix loop).

### Differences from one-shot mode

| Aspect | one-shot (default) | persistent |
|--------|-------------------|------------|
| Pane lifecycle | Open → prompt → capture → close | Open → return surface_id. Caller sends prompts later. |
| Close trigger | Step 7c (auto-close after capture) | Explicit `shutdown` step only |
| Prompt delivery | Single prompt at open time | Multiple prompts over pane lifetime |
| Safety net | None needed (pane closes immediately) | Idle timeout (execution.idle_timeout_seconds) |

### Open-only mode (persistent, initial call)

When `pane_mode: persistent` and no `existing_surface_id` is provided:

1. Run pre-flight, approval, and open-pane steps as normal.
2. Start codex in **interactive mode** (not `exec`):
   ```
   cmux send --surface <id> "codex"
   cmux send-key --surface <id> enter
   ```
3. Verify launch (step 6).
4. **Skip prompt building and skip steps 5 (build command), 7a (poll), 7b (capture), 7c (close).**
5. Return the report with `surface_id` and `pane_mode: persistent`.
   The caller is responsible for sending prompts and closing the pane.

### Send-followup mode (persistent, subsequent calls)

When `pane_mode: persistent` and `existing_surface_id` is provided:

1. **Skip steps 1–4** (pre-flight already passed, pane already open).
2. Write the new prompt to a temp file.
3. Deliver to the existing pane:
   ```
   cmux send --surface <existing_surface_id> "cat <tempfile>"
   cmux send-key --surface <existing_surface_id> enter
   ```
4. Clean up temp file.
5. Poll `cmux read-screen --surface <id>` for completion (step 7a logic).
6. Capture output to transcript (append, not overwrite — accumulate across
   iterations).
7. **Do NOT close the pane.**
8. Return report with updated transcript path and iteration count.

### Idle timeout (orphan prevention)

Persistent panes must not linger forever if the orchestrator dies.

Timeout value: `hive.config.yaml` → `execution.idle_timeout_seconds`
(default: 300 = 5 minutes).

**Episode record fields for idle timeout:**

The meta.json for persistent panes includes:
```json
{
  "pane_last_prompt_at": "2026-04-17T03:42:00Z",
  "pane_last_completion_at": "2026-04-17T03:45:12Z",
  "pane_idle_since": "2026-04-17T03:45:12Z",
  "pane_idle_timeout_seconds": 300
}
```

- `pane_last_prompt_at` — updated each time a prompt is sent to the pane
- `pane_last_completion_at` — updated each time codex finishes (shell prompt
  reappears after polling)
- `pane_idle_since` — set to `pane_last_completion_at` after each completion;
  cleared (set to null) when a new prompt is sent
- `pane_idle_timeout_seconds` — copied from `hive.config.yaml` →
  `execution.idle_timeout_seconds` at pane open time

**How it works:**
- The timeout clock starts when `pane_idle_since` is set (codex finishes a
  prompt and the pane is waiting for the next one).
- The clock resets when a new prompt is delivered (`pane_idle_since` → null,
  `pane_last_prompt_at` updated).
- The orchestrator checks the timeout at step boundaries by reading meta.json:
  `now - pane_idle_since > pane_idle_timeout_seconds`
- If the timeout has expired:
  1. Capture scrollback to transcript: `cmux read-screen --surface <id> --scrollback`
  2. Write a warning to the episode record: `"pane_closed_reason": "idle_timeout"`
  3. Close the pane: `cmux close-surface --surface <id>`

**Implementation note:** the idle timeout is enforced by the orchestrator
or team lead checking meta.json at step boundaries — not by a background
process inside the pane. If the orchestrator itself dies, the pane will
linger until cmux is restarted or the user closes it manually — this is
an acceptable PoC tradeoff.

### Shutdown sequence (persistent pane close)

The shutdown step is the authoritative close path for persistent panes:

1. Send pre-shutdown capture prompt to the pane:
   ```
   cmux send --surface <id> "Summarize what you implemented, decisions you made, difficulties encountered, and patterns you would reuse. Output as markdown."
   cmux send-key --surface <id> enter
   ```
2. Poll for response.
3. Capture insights to: `.pHive/episodes/{story_id}/codex/{agent}-insights.md`
4. Capture full scrollback to transcript.
5. Close the pane: `cmux close-surface --surface <id>`
6. Write final meta.json with pane_lifetime_seconds, total_fix_iterations,
   final_verdict.
