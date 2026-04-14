# Session Resilience

Defines SSE stuck detection and session retry for Managed Agent session execution (step
6b in `skills/execute/SKILL.md`). This document covers the session-native resilience
mechanisms that replace the respawn skill when sessions are active.

**Respawn vs Session Retry:** The respawn skill (`skills/hive/skills/respawn/SKILL.md`)
is for TeamCreate execution (step 6a). When sessions are active (step 6b), use this
document instead. Both mechanisms share the same goal — recover from degraded execution
with minimal context loss — but the mechanics differ.

## SSE Stuck Detection

A session is "stuck" when its Server-Sent Events (SSE) stream goes silent for longer
than `stuck_timeout_ms` (default: 90 seconds, configured via `hive.config.yaml
sessions.stuck_timeout_ms`).

### Detection Heuristic

The orchestrator polls `state/sessions/index.yaml` at a regular interval (suggested: every
15 seconds). For each session with `status: active`, check:

```
now - sse_last_event_at > stuck_timeout_ms
```

If this condition is true: the session is stuck. Proceed to the stuck session recovery
procedure below.

**Important:** `sse_last_event_at` must be updated by the session consumer every time an
SSE event is received. If no events have been received since session creation, use
`created_at` as the baseline.

### False Positive Mitigation

Long-running steps (implement, test) can legitimately have quiet periods while the model
is reasoning. Before declaring a session stuck:

1. Check if the session's `step_id` is one of: `implement`, `test`, `optimize` — these
   may have 30–60 second quiet stretches during complex reasoning.
2. If `step_id` is a "potentially quiet" step: apply a 2× multiplier to the timeout
   threshold (`stuck_timeout_ms * 2`) before declaring stuck.
3. If `step_id` is `research`, `review`, `write-brief`, `integrate`, or `doc-check`:
   apply no multiplier — these steps should produce output continuously.

## Stuck Session Recovery Procedure

When a session is declared stuck, follow these steps:

### Step 1: Mark session as stuck

Update the registry record (`state/sessions/index.yaml`):
- Set `status: stuck`
- Set `last_active_at: {NOW}`

Log:
```
SESSION STUCK: session_id={session_id} story={story_id} step={step_id}
  Last SSE event: {sse_last_event_at} ({elapsed}s ago, threshold: {threshold}s)
  Initiating session retry ({N}/3)
```

### Step 2: Write continuation context

Write a continuation context file to:
```
state/sessions/{session_id}-continuation.md
```

The continuation context captures the last known progress so the retry session can
pick up where the stuck session left off. Format:

```markdown
---
original_session_id: {session_id}
story_id: {story_id}
step_id: {step_id}
retry_iteration: {N}
timestamp: {ISO-8601}
---

# Session Continuation Context

## Last Known Position
- Story: {story_id} — {story_title}
- Step: {step_id}
- Session became stuck at: {sse_last_event_at}

## Work Completed (from episode records)
Read `state/episodes/{epic_id}/{story_id}/` for any completed step markers.
List completed steps here.

## Active Step Context
The stuck session was working on: {step_id}.
Any partial artifacts at this step should be checked before continuing.

## Resume Instructions
Verify the current state of all files before assuming any work is complete.
Do not repeat steps that have completed episode markers.
Continue from the {step_id} step.
```

Read the episode records for the story to populate "Work Completed." If no episode
records exist, the session was stuck early — the retry starts from the first incomplete
step.

### Step 3: Check retry count

Before opening a retry session, count the number of `stuck` records for this `story_id`
in the session index.

- **Retry count < 3:** Proceed with session retry (step 4)
- **Retry count = 3:** This story has exhausted retries. Escalate to the user:

```
SESSION RETRY LIMIT: story={story_id} step={step_id}

This story's sessions have been stuck 3 times. Continuing may indicate:
- The step is too large and should be decomposed
- There is a fundamental blocker (missing file, API failure)
- The task requires human judgment

Continuation files:
  state/sessions/{session_id_1}-continuation.md
  state/sessions/{session_id_2}-continuation.md
  state/sessions/{session_id_3}-continuation.md

Options:
  a) Decompose this step into smaller sub-steps
  b) Provide additional guidance and retry once more
  c) Skip this story and mark it blocked
```

### Step 4: Open retry session

Create a new session record in `state/sessions/index.yaml` with:
- New `session_id` (from the `/v1/sessions` API)
- Same `story_id`, `epic_id`
- `status: pending`
- `created_at: {NOW}`

Format the new session's initial prompt with:
1. Standard story spec and workflow context (same as a fresh session)
2. Continuation context injected as a "Continuation Context" section:

```
## Continuation Context

You are continuing work from a previous session that became unresponsive. Review the
context below before proceeding. Verify the current state of files — do not assume
the previous session's work is complete.

{full content of state/sessions/{original_session_id}-continuation.md}
```

Activate the session and update its status to `active` once SSE events begin flowing.

## How Session Retry Differs from Respawn

| Aspect | Respawn (TeamCreate) | Session Retry |
|--------|---------------------|---------------|
| Trigger | Orchestrator detects quality degradation via behavioral signals | SSE silence exceeds stuck_timeout_ms |
| Signal mechanism | `SendMessage` RESPAWN SIGNAL to old agent | No signal — orchestrator reads registry directly |
| Summary mechanism | Agent writes its own respawn summary file | Orchestrator writes continuation context from episode records |
| Old instance cleanup | Orchestrator withholds messages (natural termination) | Stuck session remains in registry with `status: stuck` |
| New instance | Fresh agent via agent-spawn skill with respawn_summary_path | Fresh session via `/v1/sessions` with continuation context injected |
| Max iterations | 3 respawns per step | 3 retries per story |
| Scope | Per workflow step | Per story |

## Configuration

Controlled by `hive.config.yaml sessions.*` block (see `hive/references/configuration.md`):

| Setting | Default | Description |
|---------|---------|-------------|
| `sessions.stuck_timeout_ms` | 90000 | SSE silence (ms) before declaring stuck |
| `sessions.max_retries` | 3 | Max stuck+retry cycles before escalating |

## References

- `hive/references/session-registry-schema.md` — `sse_last_event_at` field; status lifecycle including `stuck`
- `skills/execute/SKILL.md` — step 6b resilience monitoring paragraph references this doc
- `hive/references/configuration.md` — `sessions.stuck_timeout_ms` and `sessions.max_retries`
- `skills/hive/skills/respawn/SKILL.md` — TeamCreate respawn; use that doc for step 6a execution
- `hive/references/episode-schema.md` — episode records used to populate continuation context
