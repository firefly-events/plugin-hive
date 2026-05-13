---
name: execute-mode-session
description: Run story dispatch on Claude Agent SDK /v1/sessions. One session per story, isolated context, sidecar injection at review, SSE resilience monitoring, and structured retry. Inherits the caller's model.
---

# Hive Mode — Session

Atomic skill, NOT inline `/execute` prose. Runs the session-based execution mode for a workflow. The caller (the dispatch skill plus `/execute`) selects this mode and hands off the inputs below; this skill owns each session's lifecycle from registry-record creation through close.

This mode **replaces** the respawn skill for its stories — do NOT call the respawn protocol on session-path stories. Resilience is driven by SSE staleness + bounded retries.

## Invocation contract

Call this skill once per parent workflow when `mode_decision == sessions` was returned by the dispatch atom (sessions opt-in via `HIVE_SESSIONS_ENABLED` env or `sessions.enabled: true` in `hive.config.yaml`).

**Inputs:**
- `workflow_path` — path to the resolved workflow YAML.
- `unblocked_stories[]` — ordered list of story specs whose `depends_on` is satisfied at start.
- `appends_map` — `{story_id: [sidecar_agent_name, ...]}` from the parent's escalation partition (review-phase sidecar injection target).
- `epic_handle` — the parent epic identifier (used for branch naming and registry records).
- `hive_config` — parsed root `hive.config.yaml` for `sessions.model`, `sessions.stuck_timeout_ms`, `sessions.max_retries`, and any `model_tiers` inheritance for the story's primary agent.

**Outputs:**
- Session records persisted under `${HIVE_STATE_DIR}/sessions/index.yaml`.
- Per-story commits on `hive-{story-id}` feature branches.
- `sse_last_event_at` updated through the run, driving resilience retries.

## Process

### Step 1: Bootstrap session registry

Run the session-registry bootstrap skill (`skills/hive/skills/session-registry/SKILL.md`) to ensure `${HIVE_STATE_DIR}/sessions/index.yaml` exists. Idempotent — safe to call even if already initialized. See `hive/references/session-registry-schema.md` for the registry record shape.

### Step 2: Create session entries

For each story in dependency order:

- Append a session record to `${HIVE_STATE_DIR}/sessions/index.yaml` with `status: pending`, `story_id: {story-id}`, `epic_id: {epic-handle}`, and `created_at: {NOW}`.
- Use the model from `hive_config.sessions.model` (or inherit from `model_tiers` for the story's primary agent).

### Step 3: Invoke each session

When a story's dependencies are complete, open its session using the `/v1/sessions` API via `hive/scripts/session-invoke.mjs`. Format the initial session prompt using the session prompt spec from `hive/references/session-system-prompt-spec.md`. The prompt must include: story spec, workflow step sequence, episode write path, and any escalation context from `appends_map` (sidecar reviewers).

Update the registry record: set `status: active` and `last_active_at: {NOW}`.

### Step 4: Sidecar injection (session path)

When `appends_map[story_id]` is non-empty, append the matched sidecar reviewer agents to the review-phase session context using the exact verbiage:

```
Additional reviewers: {agent-1}, {agent-2}
Each additional reviewer should run their activation protocol after the primary review.
Load their persona from hive/agents/{agent-name}.md.
```

Resolution uses the canonical specialist catalog at `hive/references/specialist-triggers.md` `responds_with.id` (already done upstream in the parent's escalation partition). If `appends_map[story_id]` is empty for the story, proceed with the standard reviewer only.

### Step 5: Monitor and update

As sessions run, update `sse_last_event_at` in the registry on each received SSE event. Watch for stuck sessions per the resilience procedure in `hive/references/session-resilience.md`.

### Step 6: Close sessions

On session completion, set `status: completed` (or `failed`) and update `last_active_at`. Sessions are never reopened — each story run gets a new session record.

## Per-story commits

Stories commit independently on their own feature branches (`hive-{story-id}`) as soon as review passes, same as the team mode.

## Resilience monitoring

While sessions are active, poll `sse_last_event_at` in `${HIVE_STATE_DIR}/sessions/index.yaml`. If any active session has not updated `sse_last_event_at` within `hive_config.sessions.stuck_timeout_ms` (default 90s), trigger the session retry procedure from `hive/references/session-resilience.md`. Max `hive_config.sessions.max_retries` retries per story (default 3) before escalating to the user. This **replaces** the respawn skill for session-based stories — do NOT use the respawn protocol on session-path stories.
