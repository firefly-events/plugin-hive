---
name: execute-mode-multica
description: Run Hive workflow stories through team cells. One Multica parent issue per Hive story (unassigned container); N child issues dispatched per workflow-phase in roster order. Per-workflow-phase episode markers. U2 failure-policy table governs retry, fail, and block outcomes.
---

# Hive Mode — Multica

Atomic skill, NOT inline `/execute` prose. Runs the Multica execution mode for a workflow using the team-cell model: each story gets one Multica **parent issue** (holds the brief, assigned to nobody) plus N child issues — one per resolved workflow-phase in roster order.

This file delivers the full rewrite per outline §4.6 steps 1–5 + design §2.3. The F1 null-`project_id` hard-block ships in tce-10. The renamed legacy single-developer path ships in tce-14.

Vocabulary anchor (outline §10): "team cell" = one parent issue + N child issues per workflow-phase. "workflow-phase" is the slot type. "role" is the persona bound to a workflow-phase. No bare "phase" outside §8 quotes.

## Invocation contract

Called once per parent workflow when `mode_decision == multica` was returned by the dispatch atom. The trigger is either:

- `HIVE_EXECUTION_MODE=multica`
- root `hive.config.yaml` with `execution.mode: multica`

**Inputs:**
- `workflow_path` — path to the resolved workflow YAML.
- `unblocked_stories[]` — ordered list of story specs whose `depends_on` is satisfied at this depth.
- `appends_map` — `{story_id: [sidecar_agent_name, ...]}` from the parent's escalation partition (v1: logged but DEFERRED).
- `epic_handle` — parent epic identifier (used for episode paths).
- `hive_config` — parsed root `hive.config.yaml` for `execution.multica.*` options.

**Outputs:**
- One parent Multica issue per story (unassigned, holds brief, bound to resolved `project_id`).
- N child Multica issues per story — one per resolved workflow-phase in roster order, each assigned to the role agent.
- One episode marker per workflow-phase at `${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/{workflow-phase}.yaml`.
- Roll-up summary returned to `/execute` with dispatched stories and terminal statuses.

## Process

### Step 0: Precondition gate

Resolve Multica connection settings before touching any story:

1. Read `task_tracking.multica.server_url` from `hive_config`.
2. If missing, read `~/.multica/config.json` `server_url`.
3. If still missing, read `MULTICA_SERVER_URL`.
4. Read the PAT from `MULTICA_TOKEN` or `~/.multica/config.json` `token`.
5. Resolve the workspace UUID:
   - call `GET /api/workspaces`
   - find the workspace whose `slug` matches the configured workspace slug
   - use the workspace `id` for all issue calls

6. Resolve the `project_id` for parent issue binding:
   - read `task_tracking.multica.project_id` from `hive_config`; if present, use it
   - otherwise read `MULTICA_PROJECT_ID`
   - if still absent, emit a warning and proceed without `project_id` binding (P1 posture: warning-with-default; hard-block ships in tce-10)

7. Load the execute cell definition from `hive/team-cells/execute-cell.yaml`. Abort with a clear error if the file does not exist — it is a required input delivered by tce-5.

On any credential resolution failure, abort immediately with a clear setup error. Do NOT fall back to sequential mode.

### Step 1: Resolve story → cell roster

For each story in `unblocked_stories[]`:

```js
import { resolveRoster } from '../../../../hive/lib/cell-roster-resolver/index.mjs';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const cellDef = parseYaml(readFileSync('hive/team-cells/execute-cell.yaml', 'utf8'));
const roster = resolveRoster(storySpec, cellDef);
// roster: Array<{ 'workflow-phase': string, role: string }>
```

Log the resolved roster to stderr:

```text
[multica:{story_id}] roster: {workflow-phase}={role}, ...
```

The resolver runs deterministically from story signals + cell YAML. One call per story; no network I/O.

### Step 2: Create parent issue

For each story, create **one** Multica parent issue that:
- Holds the story brief (serialized via `serializeStoryBrief`).
- Is **assigned to nobody** — parent is a pure container and roll-up handle.
- Carries `project_id` binding resolved at Step 0 (enables `/hive:status` aggregation and the closer from `story-loop-closure`).

```js
import { serializeStoryBrief } from '../../../../hive/lib/multica-story-dispatch/index.mjs';

const brief = serializeStoryBrief(storySpec);

// POST /api/issues?workspace_id=<workspaceId>
const parentIssue = await multicaFetch(
  `/api/issues?workspace_id=${encodeURIComponent(workspaceId)}`,
  {
    method: 'POST',
    body: {
      title: storySpec.title,
      description: brief,
      status: 'todo',
      project_id: resolvedProjectId ?? undefined,
      // no assignee_type / assignee_id — parent is unassigned
    },
  },
);
```

Capture `{ parentUuid, identifier }` from the response. Record in an in-memory map keyed by `story_id` for use in Steps 3–4 and Step 5.

Log to stderr:

```text
[multica:{story_id}] parent issue created: {identifier} ({parentUuid})
```

### Step 3: Per-workflow-phase child fan-out

Process each workflow-phase in `roster` order sequentially. Track `attemptsByPhase` (per workflow-phase retry counts, starting at 1).

#### 3a. Create child issue

Resolve the role agent UUID for this workflow-phase:

```js
import {
  resolveAgentUuidByName,
  serializeStoryBrief,
} from '../../../../hive/lib/multica-story-dispatch/index.mjs';

const roleAgentUuid = await resolveAgentUuidByName(serverUrl, token, workspaceId, phase.role);
```

Create the child issue with parent binding and role assignment:

```js
const childIssue = await multicaFetch(
  `/api/issues?workspace_id=${encodeURIComponent(workspaceId)}`,
  {
    method: 'POST',
    body: {
      title: `[${phase['workflow-phase']}] ${storySpec.title}`,
      description: phaseBrief,    // built in step 3b
      status: 'todo',
      parent_id: parentUuid,
      project_id: resolvedProjectId ?? undefined,
      assignee_type: 'agent',
      assignee_id: roleAgentUuid,
    },
  },
);
```

Log to stderr:

```text
[multica:{story_id}:{workflow-phase}] child created: {identifier} ({childUuid}) → role={role}
```

#### 3b. Inject workflow-phase brief

The workflow-phase brief is composed from two channels (R2 — marker `artifacts:` file-path-only):

1. **Story brief subset** — the parent brief produced by `serializeStoryBrief(storySpec)`, annotated with the current workflow-phase name so the agent knows which step it owns.
2. **Prior workflow-phase artifact paths** — if a prior workflow-phase marker exists at `.pHive/episodes/{epic_handle}/{story_id}/{prior-workflow-phase}.yaml`, extract its `artifacts:` list and append as a reference block. File paths only; no embedded prose.

Template:

```text
## Workflow-phase: {workflow-phase} (role: {role})

{parent_brief_content}

## Prior workflow-phase outputs
{artifact_path_1}
{artifact_path_2}
...
(omit section if no prior workflow-phases have run)
```

#### 3c. Poll until terminal

```js
import {
  pollTaskUntilTerminal,
} from '../../../../hive/lib/multica-story-dispatch/episode-sync.mjs';

const maxWallClockMs = (hive_config?.execution?.multica?.story_timeout_seconds ?? 1800) * 1000;
const pollIntervalMs = (hive_config?.execution?.multica?.poll_interval_seconds ?? 5) * 1000;
const messagesCaptureMax = hive_config?.execution?.multica?.messages_capture_max ?? 200;

const terminal = await pollTaskUntilTerminal({
  serverUrl,
  token,
  workspaceId,
  issueUuid: childIssue.id,
  maxWallClockMs,
  pollIntervalMs,
  messagesCaptureMax,
  onStateTransition(prev, next) {
    stderr.write(`[multica:${storyId}:${phase['workflow-phase']}] ${prev} → ${next}\n`);
  },
});
```

#### 3d. Write per-workflow-phase episode marker

```js
import {
  writeMulticaRunEpisode,
} from '../../../../hive/lib/multica-story-dispatch/episode-sync.mjs';

await writeMulticaRunEpisode({
  hiveStateDir: process.env.HIVE_STATE_DIR ?? '.pHive',
  epicHandle,
  storyId,
  issueUuid: childIssue.id,
  identifier: childIssue.identifier,
  terminal,
  messagesCaptureMax,
  phase: phase['workflow-phase'],   // → {workflow-phase}.yaml per tce-6
});
```

Marker path: `.pHive/episodes/{epic_handle}/{story_id}/{workflow-phase}.yaml`.

#### 3e. Consult U2 failure-policy table

When `terminal.status !== 'completed'`, look up the scenario in the explicit failure-policy table:

```js
const FAILURE_POLICY = {
  core_phase_fail:     (attempt, maxRetries) => attempt < maxRetries ? 'retry' : 'fail_story',
  optional_phase_fail: ()                    => 'block_story',
  circuit_breaker_hit: ()                    => 'fail_story',
};
```

| Scenario | Condition | Action |
|---|---|---|
| `core_phase_fail` — first attempt | `terminal.status === 'failed'` on a core workflow-phase, attempt 1 | `retry` — re-run step 3a through 3e for this workflow-phase (attempt 2) |
| `core_phase_fail` — after retries | `terminal.status === 'failed'` on a core workflow-phase, attempt ≥ `max_step_retries` (default 2) | `fail_story` — mark parent `failed`; emit no further workflow-phases |
| `optional_phase_fail` | `terminal.status === 'failed'` on an optional workflow-phase (any attempt) | `block_story` — mark parent `blocked`; halt; operator review required before continuation |
| `circuit_breaker_hit` | `terminal.status === 'cancelled'` (wall-clock timeout — `story_timeout_seconds`, design intent 45 min) | `fail_story` — cell terminated; mark parent `failed`; markers reflect final state |

Whether a workflow-phase is `core` or `optional` is determined by the roster slot type (from `execute-cell.yaml`): core workflow-phases come from `core[]`; optional workflow-phases originate from an `optional[]` slot with `appends_after:` or `replaces:`.

On `fail_story`:

```js
await multicaFetch(
  `/api/issues/${parentUuid}?workspace_id=${encodeURIComponent(workspaceId)}`,
  { method: 'PUT', body: { status: 'failed' } },
);
// dispatch no further workflow-phases; proceed to Step 5
```

On `block_story`:

```js
await multicaFetch(
  `/api/issues/${parentUuid}?workspace_id=${encodeURIComponent(workspaceId)}`,
  { method: 'PUT', body: { status: 'blocked' } },
);
stderr.write(
  `[multica:${storyId}:${phase['workflow-phase']}] BLOCKED — optional workflow-phase failed; operator review required\n`,
);
// dispatch no further workflow-phases; proceed to Step 5
```

### Step 4: Close parent issue

When all workflow-phases in the roster complete with `terminal.status === 'completed'`, mark the parent done:

```js
await multicaFetch(
  `/api/issues/${parentUuid}?workspace_id=${encodeURIComponent(workspaceId)}`,
  { method: 'PUT', body: { status: 'done' } },
);
```

Log to stderr:

```text
[multica:{story_id}] all {N} workflow-phases completed — parent closed: done
```

### Step 5: Return roll-up summary

After all stories in `unblocked_stories[]` have resolved (all workflow-phases completed, or a failure/block outcome reached), return to caller (`/execute`):

```js
{
  dispatched: [
    { story_id, parentUuid, identifier, roster: [{ 'workflow-phase', role }] }
  ],
  completed: [
    { story_id, status: 'passed', parentUuid, identifier }
  ],
  failed: [
    { story_id, status: 'failed' | 'cancelled' | 'blocked', parentUuid, identifier, notes }
  ]
}
```

`/execute` uses this summary to advance the DAG to the next depth, then re-invokes this skill for the next depth's unblocked stories.

### Sidecar deferral

For each `story_id` in `appends_map`, emit:

```text
[info] sidecar injection deferred to v2 multi-agent contract: {story_id} → {agent_names}
```

No additional Multica dispatch is performed for sidecars in v1.

## Failure modes

- Missing credentials or server URL: abort entire mode with a clear setup error; do not create issues.
- Workspace slug not found: abort entire mode with a clear workspace resolution error.
- `hive/team-cells/execute-cell.yaml` missing: abort with error — cell definition is required.
- Roster resolution failure (resolver throws): record per-story failure; continue with other stories; surface in `failed[]`.
- `resolveAgentUuidByName` throws `BOOTSTRAP_REQUIRED`: abort entire mode; emit runbook line (same pattern as prior single-developer mode).
- Multica `4xx` at parent or child issue creation: record per-story failure; continue with other stories in the same depth; surface in `failed[]`.
- `project_id` absent (P1 posture): warn to stderr and proceed; hard-block ships in tce-10.
- Core workflow-phase `failed` after retries: `fail_story` per U2 table — parent marked `failed`; no further workflow-phases dispatched.
- Optional workflow-phase `failed`: `block_story` per U2 table — parent marked `blocked`; operator review required.
- Wall-clock timeout (`terminal.status === 'cancelled'`): `circuit_breaker_hit` per U2 table — `fail_story`; parent marked `failed`.
- Transient network failures during poll: `pollTaskUntilTerminal`'s 3-strike rule throws `TRANSPORT`; episode marker written with `status=failed`; treated as core-phase-fail for policy purposes.

## Configuration

`hive.config.yaml`:

```yaml
execution:
  mode: multica                       # opt-in trigger
  multica:
    project_id: <uuid>                # bound project for parent + child issue creation
    poll_interval_seconds: 5          # how often to poll child task state (step 3c)
    story_timeout_seconds: 2700       # 45 min wall-clock circuit-breaker per story (U2; design intent)
    messages_capture_max: 200         # last N messages into sidecar per workflow-phase
    max_step_retries: 2               # max attempts per core workflow-phase (U2 retry)
```

## Reuses (atomic deps)

- `hive/lib/cell-roster-resolver/index.mjs` (tce-4) — `resolveRoster(storySpec, cellDef)`.
- `hive/team-cells/execute-cell.yaml` (tce-5) — execute cell roster spec (required at Step 0).
- `hive/lib/multica-story-dispatch/index.mjs` (s2) — `serializeStoryBrief`, `resolveAgentUuidByName`.
- `hive/lib/multica-story-dispatch/episode-sync.mjs` (tce-6) — `pollTaskUntilTerminal`, `writeMulticaRunEpisode` with `phase` parameter.
- `hive/adapters/multica/index.ts` (`multica-substrate-adoption` s1) — `multicaFetch` / issue CRUD.
- F1 null-`project_id` hard-block: tce-10.
- Legacy single-developer path renamed to `execute-mode-multica-flat`: tce-14.

## Constraint summary

| Rule | Enforcement |
|---|---|
| Atomic skill, not inline `/execute` prose | This file owns the Multica lifecycle for selected mode |
| Parent is unassigned | `POST /api/issues` carries no `assignee_type` / `assignee_id` |
| One parent issue per story | Step 2 creates exactly one parent; roll-up handle for `/hive:status` |
| One child issue per workflow-phase | Step 3a creates one child per roster slot; sequential within a story |
| `project_id` binding | Step 0 resolves project; Steps 2/3a pass it at creation; warn-only until tce-10 |
| No bare "workflow-phase" shortened to "phase" | V2 vocabulary rule — "workflow-phase" used throughout (outline §10) |
| U2 failure-policy is one explicit mapping table | `FAILURE_POLICY` object in step 3e; no scattered inline branching |
| Marker `artifacts:` entries are file paths only | R2 — no embedded prose; next child's brief includes file refs verbatim |
| Per-workflow-phase episode marker | `writeMulticaRunEpisode({phase})` called after each child terminates |
| Parent closed on all-completed | Step 4 sets `status: done`; `status: failed` on fail_story; `status: blocked` on block_story |
| Parallel only within current depth | `/execute` owns DAG advancement between depths |
| No sequential fallback | Setup failures abort Multica mode |
