---
name: plan-mode-multica
description: Run Hive planning personas through Multica. One Multica issue per assembled persona; per-persona fan-out preserves the backend split, polls each unit to terminal, and writes doc/verdict multica-run episode markers.
---

# Hive Plan Mode - Multica

Atomic skill, NOT inline `/plan` prose. Runs the Multica planning mode for `/plan`
Phase 0 after the caller has assembled the planning personas. The caller selects
this mode and hands off the inputs below; this skill owns the lifecycle from
per-persona dispatch to terminal episode marker.

Multica planning mode treats each assembled planning persona as one dispatched
unit. The carrier is per-persona fan-out, not squad assignment: the S1 spike
showed Multica squad tasks run leader-only and do not preserve member execution.
This skill therefore creates or reuses one Multica issue per persona, assigns the
concrete agent UUID for that persona, polls the issue task independently, and
writes one `multica-run.yaml` marker for each dispatched unit.

## Invocation contract

Called once per `/plan` Phase 0 planning-team assembly when the plan dispatch
resolver selected `mode_decision == multica`.

The resolver is intentionally thin and mirrors `/execute`:

- `HIVE_PLANNING_MODE=multica` selects this skill with source `env`.
- root `hive.config.yaml` with `planning.mode: multica` selects this skill with
  source `config` when the environment variable is unset.
- Any other value is ignored by this mode and falls through to the existing
  planning-routing path.
- Env wins over config.

On selection, `/plan` Phase 0 routes the assembled planning cell here instead of
spawning direct natural-language spawn or `agent-spawn` teammates.

**Inputs:**
- `assembled_personas[]` - ordered final planning persona names, for example
  `researcher`, `architect`, `technical-writer`, `tpm`.
- `planning_story` - synthetic story-like payload describing the planning work,
  including `id`, `epic`, `title`, `description`, `acceptance_criteria`,
  `files_to_modify`, and `references` for the docs being produced.
- `persona_issues` - existing Multica issue UUIDs per persona, or enough issue
  metadata for the caller to create/reuse one issue per persona before dispatch.
- `epic_handle` - parent epic identifier, used for episode paths.
- `hive_config` - parsed root `hive.config.yaml`, including `agent_backends`,
  `planning.multica.*`, `task_tracking.multica.*`, and `paths.state_dir`.
- `integration_branch` - current epic branch/ref for the shared-branch contract.

**Outputs:**
- One episode marker per dispatched persona at
  `${HIVE_STATE_DIR}/episodes/{epic_handle}/{planning_story.id}-{persona}/multica-run.yaml`.
- One messages sidecar per dispatched persona at
  `${HIVE_STATE_DIR}/episodes/{epic_handle}/{planning_story.id}-{persona}/multica-run.messages.jsonl`.
- Summary returned to `/plan` with dispatched personas, Multica issue IDs, and
  terminal marker statuses.

## Process

### Step 0: Mode resolve and precondition gate

The caller resolves the mode before invoking this skill:

```js
function resolvePlanningMode(env, hiveConfig) {
  if (env.HIVE_PLANNING_MODE === 'multica') {
    return { mode_decision: 'multica', field_sources: { planning_mode: 'env' } };
  }
  if (hiveConfig?.planning?.mode === 'multica') {
    return { mode_decision: 'multica', field_sources: { planning_mode: 'config' } };
  }
  return { mode_decision: 'default', field_sources: { planning_mode: 'default' } };
}
```

After selection, resolve Multica connection settings before touching any persona:

1. Read `task_tracking.multica.server_url` from `hive_config`.
2. If missing, read `~/.multica/config.json` `server_url`.
3. If still missing, read `MULTICA_SERVER_URL`.
4. Read the PAT from `MULTICA_TOKEN` or `~/.multica/config.json` `token`.
5. Resolve the workspace UUID with the same pattern as `multica-init`:
   - call `GET /api/workspaces`
   - find the workspace whose `slug` matches the configured workspace slug
   - use the workspace `id` for all issue and agent calls

Load `.pHive/multica/agents.yaml` once per `/plan` run. For every persona in
`assembled_personas[]`, call:

```js
import { resolveAgentUuidByName } from '../../../../hive/lib/multica-story-dispatch/index.mjs';

const agentUuid = await resolveAgentUuidByName(
  serverUrl,
  token,
  workspaceId,
  persona,
);
```

On `BOOTSTRAP_REQUIRED`, abort immediately with stderr:

```text
ERROR: Multica planning mode requires bootstrapped agents.
       Run /hive:multica-init to create them, then retry.
       (<persona> agent missing in workspace <slug>)
```

Exit `1`. Do not fall back to direct planning after a selected Multica mode fails
its bootstrap gate.

### Step 1: Per-persona dispatch

Use the mpt-5 carrier helper. The carrier preserves the S1 verdict by assigning
concrete agent UUIDs per persona rather than assigning a squad issue.

```js
import { dispatchStoryToPersonas } from '../../../../hive/lib/multica-story-dispatch/index.mjs';

const carrier = await dispatchStoryToPersonas(
  serverUrl,
  token,
  workspaceId,
  planning_story,
  persona_issues,
  {
    agents,
    agentBackends: hive_config.agent_backends ?? {},
    integrationBranch: integration_branch,
  },
);
```

The carrier call above is a **single** batch dispatch: `dispatchStoryToPersonas`
iterates `persona_issues` internally — for each persona it ensures the issue
brief, dispatches the issue to that persona's agent, and moves it out of backlog
— then returns `{ carrier: 'per-persona-fan-out', dispatches }`. It does not
poll. Polling and marker-writing are serial in v1 (Step 2): poll persona N to
terminal, write its episode marker, then advance to N+1. This bounds Multica
daemon load and keeps failures isolated to one planning unit.

Before the carrier call, for each persona:

1. Ensure or create one Multica issue for that persona. Title format:
   `{planning_story.title} - {persona}`.
2. Add `{ persona, issueUuid }` to the `persona_issues` array passed to the carrier.

After the carrier returns:

3. Confirm the returned `carrier` is `per-persona-fan-out`.
4. For each entry in `dispatches`, record
   `{persona, issueUuid, identifier, agentUuid, dispatch_started_at}` for the
   poll loop.
5. Emit one info line per persona:
   `[info] planning multica dispatch: persona={persona} carrier=per-persona-fan-out issue={identifier}`.

Do not create or assign a squad issue. Do not collapse personas into one shared
issue. Backend split is preserved by the agent selected for each persona and by
the brief rendering inside `dispatchStoryToPersonas`.

### Step 2: Poll until terminal

For each dispatched persona, drive `pollTaskUntilTerminal` with a persona-scoped
transition callback:

```js
import {
  pollTaskUntilTerminal,
  writeMulticaRunEpisode,
} from '../../../../hive/lib/multica-story-dispatch/episode-sync.mjs';

const terminal = await pollTaskUntilTerminal({
  serverUrl,
  token,
  workspaceId,
  issueUuid,
  maxWallClockMs,
  pollIntervalMs,
  messagesCaptureMax,
  onStateTransition(prev, next) {
    process.stderr.write(`[multica-plan:${planning_story.id}:${persona}] ${prev} -> ${next}\n`);
  },
});
```

Configuration:

- `maxWallClockMs` from `hive_config.planning.multica.persona_timeout_seconds * 1000`.
- Default `maxWallClockMs` is `1_800_000` (30 minutes).
- `pollIntervalMs` from `hive_config.planning.multica.poll_interval_seconds * 1000`.
- Default `pollIntervalMs` is `5_000`.
- `messagesCaptureMax` from `hive_config.planning.multica.messages_capture_max`.
- Default `messagesCaptureMax` is `200`.

Transport failure after three consecutive polling errors is caught per persona and
written as that persona's failed marker. Other personas continue.

### Step 3: Episode marker per dispatched unit

Use the mpt-4 doc/verdict dialect on the existing `multica-run.yaml` marker. Do
not invent a plan-specific marker.

Before calling the writer, annotate the terminal object:

```js
const planningTerminal = {
  ...terminal,
  completion_kind: 'doc-verdict',
  artifacts_committed: terminal.status === 'completed',
  artifacts: plannedArtifactPathsForPersona(persona),
};
```

Then write:

```js
const storyId = `${planning_story.id}-${persona}`;

const { markerPath, messagesPath, status, notes } = await writeMulticaRunEpisode({
  hiveStateDir,
  epicHandle: epic_handle,
  storyId,
  issueUuid,
  identifier,
  terminal: planningTerminal,
  messagesCaptureMax,
});
```

The marker path is:

```text
${HIVE_STATE_DIR}/episodes/{epic_handle}/{planning_story.id}-{persona}/multica-run.yaml
```

Required doc/verdict fields are written by `writeMulticaRunEpisode`:

| Field | Required value for planning |
|---|---|
| `completion_kind` | `doc-verdict` |
| `artifacts_committed` | `true` only after planning artifacts are committed |
| `episode_terminal` | `true` when marker status is terminal |
| `requires_code_push_sha` | `false` |
| `code_push_sha` | `null` |
| `terminal_by_dialect` | `artifacts_committed && episode_terminal` |

Planning artifacts are the docs or outline files produced by the persona plus the
messages sidecar. A completed Multica task without committed planning artifacts is
not terminal by dialect and must surface as failed or blocked to the caller.

### Step 4: Aggregate and return

Wait until every persona dispatched by this invocation has reached a terminal
state or has produced a per-persona dispatch failure marker.

Return to `/plan`:

```js
{
  dispatched: [
    { persona, issueUuid, identifier, agentUuid, dispatch_started_at }
  ],
  completed: [
    { persona, status: 'passed', issueUuid, identifier, markerPath }
  ],
  failed: [
    { persona, status: 'failed' | 'cancelled', issueUuid, identifier, notes, markerPath }
  ]
}
```

`/plan` uses this summary to collect committed planning documents and continue its
normal document review/presentation flow.

## Failure modes

- `BOOTSTRAP_REQUIRED` at Step 0: abort the selected mode with exit `1`; user must
  run `/hive:multica-init`.
- Missing credentials or server URL: abort selected mode with a clear setup error;
  do not create persona issues.
- Workspace slug not found: abort selected mode with a clear workspace resolution error.
- Missing assembled persona agent: abort selected mode with the missing persona name.
- Multica issue `4xx` at any per-persona step: record that persona as failed,
  write its failure marker, and continue with remaining personas.
- Wall-clock timeout per persona: `pollTaskUntilTerminal` cancels the active task
  and returns `status: cancelled`; write the marker.
- Transient network failures during poll: the helper's three-strike rule throws
  `TRANSPORT`; write a failure marker with `notes='polling lost connection'`.

## Configuration

`hive.config.yaml`:

```yaml
planning:
  mode: multica                         # opt-in trigger
  multica:
    poll_interval_seconds: 5            # how often to poll task state
    persona_timeout_seconds: 1800       # 30 min wall-clock per persona
    messages_capture_max: 200           # last N messages into sidecar
```

Environment override:

```sh
HIVE_PLANNING_MODE=multica
```

## Reuses (atomic deps)

- `hive/lib/multica-story-dispatch/index.mjs` (mpt-5) - per-persona fan-out carrier:
  - `dispatchStoryToPersonas`
  - `resolveAgentUuidByName`
  - `serializeStoryBrief`
  - `ensureIssueBriefMatches`
  - `dispatchStoryToAgent`
  - `moveOutOfBacklogIfNeeded`
- `hive/lib/multica-story-dispatch/episode-sync.mjs` (mpt-4) - poll plus
  `multica-run.yaml` episode writer with the doc/verdict completion dialect.
- `.pHive/multica/agents.yaml` - persona seed and provider roster; must be
  bootstrapped via `/hive:multica-init`.
- `skills/hive/skills/planning-routing/SKILL.md` - existing direct/Codex route
  contract used when this mode is not selected.

## Constraint summary

| Rule | Enforcement |
|---|---|
| Atomic skill, not inline `/plan` prose | This file owns the selected Multica lifecycle |
| Thin mode resolve | `HIVE_PLANNING_MODE=multica` or `planning.mode: multica` selects this atom |
| Bootstrap required | Resolve every assembled persona before dispatch |
| Per-persona fan-out | Use `dispatchStoryToPersonas`; never assign one squad issue |
| Backend split preserved | Persona agent UUIDs and `agents.yaml` provider data drive dispatch |
| Serial within planning cell | Dispatch, poll, and write marker before next persona in v1 |
| Episode marker per unit | One `multica-run.yaml` plus messages sidecar per persona |
| Shared doc/verdict dialect | `completion_kind: doc-verdict`, no code-push SHA required |
| No silent fallback after selection | Setup/bootstrap failures abort selected Multica mode |
