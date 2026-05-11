---
name: backend-dispatch
description: Resolve the model-provider backend (Claude vs Codex) for an agent spawn and route to the correct dispatch surface. Inherits the caller's model and persona context.
---

# Hive Backend Dispatch

Atomic skill, NOT inline agent-spawn prose. Resolves which provider serves a given persona spawn and selects the dispatch surface (Messages-API substrate, tmux fallback, or codex-invoke). The caller still builds the spawn prompt and owns the surrounding procedure (respawn handling, episode reporting); this skill only owns the resolution + dispatch handoff.

## Invocation contract

Call this skill after `memory-loading` returned `prior_knowledge_block` and the caller has assembled the full prompt structure, but BEFORE invoking the actual `Agent`/`TeamCreate`/`codex-invoke` surface.

**Inputs:**
- `persona_context` — output of `persona-resolve` (carries `agent_name`, `frontmatter.model`).
- `agent_backends` — `agent_backends.*` map from root `hive.config.yaml`.
- `backend_override` — optional explicit override the caller passed in (highest precedence).
- `prompt_parts` — assembled `{persona_text, domain_note, prior_knowledge_block, skills, continuation_context, task}` parts. Some surfaces concatenate; cmux variants split across system + task files (see `hive/references/agent-spawn-prompt-layout.md` for the canonical split, owned by agent-spawn proper).
- `caller_mode` — caller's invocation context: `team-execution` or `standalone`.
- `pane_mode` — `one-shot` (default) or `persistent` (only relevant when resolved backend is `codex`).
- `existing_surface_id` — only used when `pane_mode == persistent`.

**Outputs:**
- `resolved_backend` enum `claude | codex`.
- `dispatch_decision` — record of the chosen surface: `messages-api`, `tmux-fallback`, `codex-invoke-one-shot`, `codex-invoke-persistent-initial`, or `codex-invoke-persistent-followup`.
- `dispatch_result` — the report returned by whichever surface was invoked.

**Side effects:** episode record write (when backend is codex, log the backend for future cost/bias telemetry).

## Process

### Step 1: Resolve backend (model provider)

Decide whether this spawn runs through Claude (default) or an external model. Resolution order, first match wins:

1. Explicit `backend_override` passed in by the caller.
2. `agent_backends.{persona_context.agent_name}` in `hive/hive.config.yaml`.
3. Default: `claude`.

Supported backends: `claude` | `codex`.

### Step 2: Codex branch

If the resolved backend is `codex`:

- Record the backend in the episode record (for future cost/bias telemetry).
- Resolve `pane_mode` from the caller: `one-shot` (default) or `persistent`.
  - `one-shot`: open pane, send prompt, capture output, close pane (standard).
  - `persistent`: two sub-modes depending on whether `existing_surface_id` is provided:
    - **No surface_id (initial):** open pane, start codex interactive, return `surface_id` to caller. Do NOT send the task prompt or close the pane.
    - **Surface_id provided (follow-up):** send the prompt to the existing pane, poll for completion, capture output. Do NOT close the pane.
- Build the full prompt structure from `prompt_parts` exactly as the agent-spawn prompt-layout reference describes for one-shot mode and persistent follow-up mode. Skip prompt building for persistent initial mode because that call only opens the pane and returns `surface_id`.
- Do NOT call Agent/TeamCreate. Delegate to the `codex-invoke` skill with the built prompt, `pane_mode`, and optional `existing_surface_id`. Return its report as `dispatch_result`. All subsequent steps in the caller (respawn continuation, episode reporting) still apply — codex-invoke is the dispatch surface, not a replacement for the surrounding procedure.

### Step 3: Claude branch

If the resolved backend is `claude`, use this flow in order:

1. **Capability-check first:** initialize the Claude client/session substrate needed for story-level dispatch. If the client cannot be initialized, treat that as a substrate capability miss rather than a story failure.
2. **Messages-API substrate by default:** when the capability-check passes, route the spawn through `hive/lib/messages-session.js`. This is the default Claude path for direct story-level dispatch because it keeps the spawn on the Messages-API loop instead of opening a tmux pane first. Return `dispatch_decision=messages-api`.
3. **tmux fallback when client init fails:** if the Messages-API client init fails, log the failure and fall back to the existing tmux `Agent`/`TeamCreate` path. Do not modify the prompt shape during fallback; only the transport changes. Return `dispatch_decision=tmux-fallback`.

Note: the cmux variant (visible split panes) is owned by agent-spawn §7.3 because it is a presentation-layer concern coupled to the orchestrator's pane lifecycle, not a backend choice. This skill returns Claude as the resolved backend and the caller decides cmux-vs-tmux via `execution.terminal_mux`.
