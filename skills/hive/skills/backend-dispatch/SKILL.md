---
name: backend-dispatch
description: Resolve the model-provider backend (Claude vs Codex) for an agent spawn and route to the correct dispatch surface. Inherits the caller's model and persona context.
---

# Hive Backend Dispatch

Atomic skill, NOT inline agent-spawn prose. Resolves which provider serves a given persona spawn and selects the dispatch surface (Messages-API substrate, tmux fallback, or codex-invoke). The caller still builds the spawn prompt and owns the surrounding procedure (respawn handling, episode reporting); this skill only owns the resolution + dispatch handoff.

## Invocation contract

Call this skill after `memory-loading` returned `prior_knowledge_block` and the caller has assembled the full prompt structure, but BEFORE invoking the actual `Agent`/`codex-invoke` surface.

**Inputs:**
- `persona_context` — output of `persona-resolve` (carries `agent_name`, `frontmatter.model`).
- `agent_backends` — `agent_backends.*` map from root `hive.config.yaml`.
- `backend_override` — optional explicit override the caller passed in (highest precedence).
- `prompt_parts` — assembled `{persona_text, domain_note, prior_knowledge_block, skills, continuation_context, task}` parts. Some surfaces concatenate; cmux variants split across system + task files (see `hive/references/agent-spawn-prompt-layout.md` for the canonical split, owned by agent-spawn proper).
- `caller_mode` — caller's invocation context: `team-execution` or `standalone`.
- `pane_mode` — `one-shot` (default) or `persistent` (only relevant when resolved backend is `codex`).
- `existing_surface_id` — only used when `pane_mode == persistent`.

**Outputs:**
- `resolved_backend` enum `claude | codex | multica:<runtime>` (e.g. `multica:opencode`, `multica:gemini`).
- `dispatch_decision` — record of the chosen surface: `messages-api`, `tmux-fallback`, `codex-invoke-one-shot`, `codex-invoke-persistent-initial`, `codex-invoke-persistent-followup`, or `multica-issue-assign`.
- `dispatch_result` — the report returned by whichever surface was invoked.

**Side effects:** episode record write (when backend is codex, log the backend for future cost/bias telemetry; for `multica:<runtime>`, log the runtime tag).

## Process

### Step 1: Resolve backend (model provider)

Decide which backend serves this spawn. Resolution order, first match wins:

1. Explicit `backend_override` passed in by the caller.
2. `agent_backends.{persona_context.agent_name}` from root `hive.config.yaml` (consumer override layer; falls back to `hive/hive.config.yaml`). Matches the input-section contract at line 16. Normalize the resolved value: `opencode` is a convenience alias for `multica:opencode`.
3. Default: `claude`.

Supported backends: `claude` | `codex` | `multica:<runtime>` (e.g. `multica:opencode`, `multica:gemini`). The `opencode` short-form is accepted in config and treated as `multica:opencode` at resolution time.

### Step 2: Codex branch

If the resolved backend is `codex`:

- Record the backend in the episode record (for future cost/bias telemetry).
- Build the full prompt string from `prompt_parts` exactly as the agent-spawn prompt-layout reference describes.
- Dispatch via `hive/lib/codex-backend.mjs` → `runCodexExec(prompt, opts)`:
  - **No cmux dependency.** Do NOT open a visible pane. Do NOT invoke the `codex-invoke` skill. The headless path shells directly to the local `codex` binary as a subprocess.
  - **Non-interactive invocation form** (verified against v0.143.0, DOS-334):
    ```
    codex exec --json --ephemeral --skip-git-repo-check [--sandbox <mode>] [-C <workDir>] "<prompt>"
    ```
    - `--json` — emits JSONL events; required for headless parsing (bare `codex exec` hangs ~2 min without it).
    - `--ephemeral` — no session files written to disk.
    - `--skip-git-repo-check` — allows execution outside a git repository.
    - `--sandbox <mode>` — optional: `read-only` (default safe), `workspace-write`, or `danger-full-access`.
    - `-C <workDir>` — pass the story's working directory when available.
  - The JSONL event stream is parsed: `thread.started`, `item.completed` (agent_message / command_execution), and `turn.completed` events are captured.
  - `runCodexExec` returns a `terminal` object in the episode-record shape (`status`, `notes`, `messages`, `task_id: null`, `agent_id: null`, `agent_name`, `work_dir`, `attempts: 1`, `started_at`, `completed_at`, plus codex-specific extras `thread_id`, `usage`).
- Pass the returned `terminal` directly to `writeMulticaRunEpisode` (episode-sync.mjs) as the episode record — same path as the claude and multica branches.
- Return `dispatch_result` with `dispatch_decision: 'codex-exec-headless'` and the `terminal` object.

### Step 3: Claude branch

If the resolved backend is `claude`, use this flow in order:

1. **Capability-check first:** initialize the Claude client/session substrate needed for story-level dispatch. If the client cannot be initialized, treat that as a substrate capability miss rather than a story failure.
2. **Messages-API substrate by default:** when the capability-check passes, route the spawn through `hive/lib/messages-session.js`. This is the default Claude path for direct story-level dispatch because it keeps the spawn on the Messages-API loop instead of opening a tmux pane first. Return `dispatch_decision=messages-api`.
3. **tmux fallback when client init fails:** if the Messages-API client init fails, log the failure and fall back to the existing tmux `Agent(name:)` path. Do not modify the prompt shape during fallback; only the transport changes. Return `dispatch_decision=tmux-fallback`.

Note: the cmux variant (visible split panes) is owned by agent-spawn §7.3 because it is a presentation-layer concern coupled to the orchestrator's pane lifecycle, not a backend choice. This skill returns Claude as the resolved backend and the caller decides cmux-vs-tmux via `execution.terminal_mux`.

### Step 4: multica:<runtime> branch

If the resolved backend matches `multica:<runtime>` (e.g. `multica:opencode`, `multica:gemini`):

- Record the runtime tag in the episode record (for future cost/bias telemetry).
- Do NOT open a cmux pane. Do NOT invoke the Messages-API or tmux substrate. Dispatch exclusively through the **Multica CLI substrate** (issue assignment via `multica issue update --assignee`).
- The persona's story brief MUST NOT include a `/codex:rescue` instruction — the assigned agent is a native Multica agent that already knows its own runtime.
- Assign the story issue to the agent persona's Multica agent UUID via `dispatchStoryToAgent`. Return `dispatch_decision=multica-issue-assign`.
- The dispatched agent runs on the Multica runtime identified by `<runtime>` (e.g. Opencode, Gemini) and posts its result as a comment on the story issue, which the orchestrator picks up through the existing episode-record path.
- Return `dispatch_result` with the same envelope shape as the codex and claude branches (`carrier`, `dispatches`, `dispatch_decision`).
