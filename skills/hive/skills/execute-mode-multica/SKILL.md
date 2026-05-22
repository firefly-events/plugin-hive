---
name: execute-mode-multica
description: Run Hive workflow stories through team cells. One Multica parent issue per Hive story (pure container, unassigned); per-workflow-phase child fan-out dispatched by tce-9. Episode markers track lifecycle per workflow-phase.
---

# Hive Mode — Multica (cell shell)

Atomic skill, NOT inline `/execute` prose. Runs the Multica execution mode for a workflow using the team-cell model: each story gets one Multica **parent issue** (holds the brief, assigned to nobody) plus N child issues per resolved workflow-phase (dispatched in tce-9).

This file delivers the parent-issue half of the rewrite (outline §4.6 steps 1–2 + 5; design §2.3). Child fan-out (steps 3–4) ships in tce-9. The F1 null-`project_id` hard-block ships in tce-10. The renamed legacy single-developer path ships in tce-14.

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
- Roll-up summary returned to `/execute` with parent issue handles per story.
- Per-workflow-phase episode markers (`multica-run-{workflow-phase}.yaml`) are written by tce-9's child fan-out.

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

Capture `{ parentUuid, identifier }` from the response. Record in an in-memory map keyed by `story_id` for use in Step 5 and by tce-9's child fan-out.

Log to stderr:

```text
[multica:{story_id}] parent issue created: {identifier} ({parentUuid})
```

### Steps 3–4: Per-workflow-phase child fan-out — DEFERRED (tce-9)

Steps 3 and 4 (child issue creation per workflow-phase + parent close) ship in tce-9. When this story merges in isolation, no child issues are created and the parent issue remains open.

Emit for each story:

```text
[multica:{story_id}] child fan-out deferred to tce-9 — roster has {N} workflow-phase(s): {list}
```

### Step 5: Return roll-up summary

After all stories in `unblocked_stories[]` have produced a parent issue (or a per-story failure record), return to caller (`/execute`):

```js
{
  parents: [
    {
      story_id,
      parentUuid,
      identifier,
      project_id: resolvedProjectId ?? null,
      roster: [{ 'workflow-phase': string, role: string }],
      created_at,
    }
  ],
  failed: [
    { story_id, reason }
  ]
}
```

`/execute` uses this summary to advance the DAG to the next depth, then re-invokes this skill for the next depth's unblocked stories. Child fan-out (tce-9) consumes `parents[].parentUuid` and `parents[].roster` to create per-workflow-phase child issues.

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
- Multica `4xx` at parent issue creation: record per-story failure; continue with other stories in the same depth; surface in `failed[]`.
- `project_id` absent (P1 posture): warn to stderr and proceed; hard-block ships in tce-10.

## Configuration

`hive.config.yaml`:

```yaml
execution:
  mode: multica                       # opt-in trigger
  multica:
    project_id: <uuid>                # bound project for parent issue creation
    poll_interval_seconds: 5          # used by tce-9 child polling
    story_timeout_seconds: 1800       # 30 min wall-clock per story (tce-9)
    messages_capture_max: 200         # last N messages into sidecar (tce-9)
```

## Reuses (atomic deps)

- `hive/lib/cell-roster-resolver/index.mjs` (tce-4) — `resolveRoster(storySpec, cellDef)`.
- `hive/team-cells/execute-cell.yaml` (tce-5) — execute cell roster spec (required at Step 0).
- `hive/lib/multica-story-dispatch/index.mjs` (s2) — `serializeStoryBrief`.
- `hive/adapters/multica/index.ts` (`multica-substrate-adoption` s1) — `multicaFetch` / issue CRUD.
- Per-workflow-phase episode markers and child fan-out: tce-9.
- F1 null-`project_id` hard-block: tce-10.
- Legacy single-developer path renamed to `execute-mode-multica-flat`: tce-14.

## Constraint summary

| Rule | Enforcement |
|---|---|
| Atomic skill, not inline `/execute` prose | This file owns the Multica lifecycle for selected mode |
| Parent is unassigned | `POST /api/issues` carries no `assignee_type` / `assignee_id` |
| One parent issue per story | Step 2 creates exactly one parent; roll-up handle for `/hive:status` |
| `project_id` binding | Step 0 resolves project; Step 2 passes it at creation; warn-only until tce-10 |
| No bare "workflow-phase" shortened to "phase" | V2 vocabulary rule — "workflow-phase" used throughout (outline §10) |
| Child fan-out deferred | Steps 3–4 stub; tce-9 owns per-workflow-phase child issues |
| Parallel only within current depth | `/execute` owns DAG advancement between depths |
| No sequential fallback | Setup failures abort Multica mode |
