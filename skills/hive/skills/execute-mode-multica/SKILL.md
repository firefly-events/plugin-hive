---
name: execute-mode-multica
description: Run Hive workflow stories by dispatching to Multica agents. One Multica issue per Hive story; the assigned agent runs the whole story internally in its own work_dir. Episode markers track the multica-run lifecycle (queued → running → completed|failed|cancelled).
---

# Hive Mode — Multica

Atomic skill, NOT inline `/execute` prose. Runs the Multica execution mode for a workflow. The caller (the dispatch skill plus `/execute`) selects this mode and hands off the inputs below; this skill owns the lifecycle from per-story dispatch to terminal episode marker.

Multica mode treats each Hive story as one Multica issue assigned to the bootstrapped `developer` agent. Multica owns the internal task work directory and task execution after assignment. Hive owns dispatch, polling, episode markers, and returning a depth summary to `/execute`.

## Invocation contract

Called once per parent workflow when `mode_decision == multica` was returned by the dispatch atom. The trigger is either:

- `HIVE_EXECUTION_MODE=multica`
- root `hive.config.yaml` with `execution.mode: multica`

**Inputs:**
- `workflow_path` — path to the resolved workflow YAML.
- `unblocked_stories[]` — ordered list of story specs whose `depends_on` is satisfied at start.
- `appends_map` — `{story_id: [sidecar_agent_name, ...]}` from the parent's escalation partition (v1: logged but DEFERRED; see Constraints below).
- `epic_handle` — parent epic identifier (used for episode paths).
- `hive_config` — parsed root `hive.config.yaml` for `execution.multica.*` options.

**Outputs:**
- One episode marker per story at `${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/multica-run.yaml`.
- One messages sidecar per story at `${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/multica-run.messages.jsonl`.
- Summary returned to `/execute` with dispatched stories and terminal statuses.

## Process

### Step 0: Precondition gate

Resolve Multica connection settings before touching any story:

1. Read `task_tracking.multica.server_url` from `hive_config`.
2. If missing, read `~/.multica/config.json` `server_url`.
3. If still missing, read `MULTICA_SERVER_URL`.
4. Read the PAT from `MULTICA_TOKEN` or `~/.multica/config.json` `token`.
5. Resolve the workspace UUID with the same pattern as the `multica-init` bootstrap:
   - call `GET /api/workspaces`
   - find the workspace whose `slug` matches the configured workspace slug
   - use the workspace `id` for all issue and agent calls

Then call:

```js
import { resolveAgentUuidByName } from '../../../../hive/lib/multica-story-dispatch/index.mjs';

const developerAgentUuid = await resolveAgentUuidByName(
  serverUrl,
  token,
  workspaceId,
  'developer',
);
```

On `BOOTSTRAP_REQUIRED`, abort immediately with stderr:

```text
ERROR: Multica execution mode requires bootstrapped agents.
       Run /hive:multica-init to create them, then retry.
       (developer agent missing in workspace <slug>)
```

Exit `1`. Do NOT fall back to sequential.

### Step 1: Per-story dispatch (serial within depth — Phase 1)

Phase 1 dispatches stories **serially** within the current depth: dispatch story N, poll to terminal (Step 2), write the episode marker (Step 3), then advance to story N+1. This is the v1 contract — it keeps Multica daemon load bounded, makes failure isolation trivial, and matches how `meta-improvement-reset` was actually run inline on 2026-05-25.

> **Phase 2 (future):** parallel-within-depth fanout is a documented option once we have evidence the daemon and agent runtime tolerate concurrent task pressure. Do not enable parallel dispatch in v1.

For each story in `unblocked_stories[]` at this depth:

1. **Issue resolution.**
   - If `story.tracker_id` is populated, for example `plugin-hive/PLU-42` from `/plan` Phase D, use `getStory` from `hive/adapters/multica/index.ts` to fetch by `tracker_id`.
   - Capture the Multica issue UUID and identifier.
   - If `story.tracker_id` is missing, use `createStory({title: story.title, body: '<brief placeholder — will be filled at step 3>', labels: []})`.
   - Capture the new `tracker_id`, UUID, and identifier.

2. **Backlog kick.**
   - Call `moveOutOfBacklogIfNeeded(serverUrl, token, workspaceId, issueUuid)`.
   - This ensures a newly dispatchable story is not stranded in backlog state before assignment.

3. **Brief write.**
   - Read `hive_config.agent_backends?.developer` (the `developer` role is the persona Multica's bootstrapped agent runs under). If it equals `'codex'`, pass `{ codexInstruction: true }` so the brief instructs the inner Claude Code session to use `/codex:rescue` for implementation. Otherwise omit options for backward-compatible behavior.
   - Call `serializeStoryBrief(story, codexInstruction ? { codexInstruction: true } : {})` to produce Markdown.
   - Resolve `requestedRef` from the current epic branch/ref (for example `feat/multica-integration-fixes`) and include it in the issue brief as the required repository ref for the agent task.
   - Call `ensureIssueBriefMatches(serverUrl, token, workspaceId, issueUuid, brief)`.
   - If the issue description has drifted, the helper updates it with `PUT`.

4. **Clone + verify.**
   - Standalone `multica repo checkout` is daemon-task scoped. Do not run it as an orchestrator-side pre-dispatch command unless the Multica daemon API exposes an equivalent checkout endpoint for this workflow.
   - Preserve the auto-clone success path used by h-01-style runs: if `workdir/plugin-hive/` already exists inside the assigned task and its current branch equals `requestedRef`, skip the explicit clone and continue.
   - Otherwise, the task brief or dispatch payload MUST instruct the agent to run this as its first repository action inside the daemon task:

     ```sh
     multica repo checkout https://github.com/firefly-events/plugin-hive --ref "${requestedRef}"
     ```

   - Post-dispatch verify before implementation work:

     ```sh
     test -d workdir/plugin-hive
     ls -la workdir
     ls -la workdir/plugin-hive
     git -C workdir/plugin-hive branch --show-current
     ```

   - Fail fast if verification fails or the branch output does not equal `requestedRef`. Emit an error message that names all of:
     - workdir path: `workdir/plugin-hive`
     - requested ref: `${requestedRef}`
     - actual contents: output from `ls -la workdir`, `ls -la workdir/plugin-hive`, and `git -C workdir/plugin-hive branch --show-current`
     - suggested manual rerun command: `multica repo checkout https://github.com/firefly-events/plugin-hive --ref "${requestedRef}"`
   - Stop the task after that error. Do NOT let the agent improvise on an unknown checkout.

5. **Dispatch.**
   - Call `dispatchStoryToAgent(serverUrl, token, workspaceId, issueUuid, developerAgentUuid)`.
   - The `PUT` returns `200` with `assignee_type` and `assignee_id` populated.
   - Multica internally enqueues the task after assignment.

6. **Track.**
   - Record `{story_id, issueUuid, identifier, dispatch_started_at}` in an in-memory map for the poll loop.
   - Keep per-story state independent so one 4xx or terminal failure does not block sibling stories in the same depth.

The dispatch fanout is **serial within the current depth** in Phase 1 (see Step 1 preamble). Do not advance to later DAG depths inside this skill; `/execute` owns DAG advancement and re-invokes this skill for the next depth.

### Step 2: Poll until terminal (per story)

For each dispatched story, drive `pollTaskUntilTerminal` with:

- `onStateTransition` callback:

  ```text
  [multica:{story_id}] {prev} → {new}
  ```

- `maxWallClockMs` from `hive_config.execution.multica.story_timeout_seconds * 1000`.
- Default `maxWallClockMs` is `1_800_000` (30 minutes).
- `pollIntervalMs` from `hive_config.execution.multica.poll_interval_seconds * 1000`.
- Default `pollIntervalMs` is `5_000`.

Import the helpers:

```js
import {
  pollTaskUntilTerminal,
  writeMulticaRunEpisode,
} from '../../../../hive/lib/multica-story-dispatch/episode-sync.mjs';
```

Poll call shape:

```js
const terminal = await pollTaskUntilTerminal({
  serverUrl,
  token,
  workspaceId,
  issueUuid,
  maxWallClockMs,
  pollIntervalMs,
  messagesCaptureMax,
  onStateTransition(prev, next) {
    process.stderr.write(`[multica:${story.id}] ${prev} → ${next}\n`);
  },
});
```

`terminal` is an object of shape:

```text
{
  status:        'completed' | 'failed' | 'cancelled',
  notes:         string,
  messages:      [<message>, ...],            // last messagesCaptureMax entries
  task_id:       string,
  agent_id:      string | null,
  agent_name:    string | null,
  work_dir:      string | null,
  attempts:      number,
  started_at:    ISO-8601 string | null,
  completed_at:  ISO-8601 string | null,
}
```

A timeout-cancelled story returns `status: 'cancelled'` and `notes: 'timeout after Ns'`; transport failure after 3 consecutive errors throws `TRANSPORT` (caller catches per-story and writes a failure marker — see Failure modes).

### Step 3: Episode marker per terminal

Call `writeMulticaRunEpisode` with the terminal state returned by polling:

```js
const { markerPath, messagesPath, status, notes } = await writeMulticaRunEpisode({
  hiveStateDir,            // resolved from paths.state_dir (default .pHive)
  epicHandle: epic_handle, // parent epic identifier
  storyId: story.id,
  issueUuid,               // captured in Step 1 dispatch
  identifier,              // human-readable issue ID (e.g. plugin-hive/PLU-42)
  terminal,                // object returned by pollTaskUntilTerminal in Step 2
  messagesCaptureMax,      // hive_config.execution.multica.messages_capture_max (default 200)
});
```

The marker path is:

```text
${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/multica-run.yaml
```

The messages sidecar path is:

```text
${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/multica-run.messages.jsonl
```

Terminal status mapping is owned by the helper:

| Multica terminal | Episode marker status |
|---|---|
| `completed` | `passed` |
| `failed` | `failed` |
| `cancelled` | `cancelled` |

The helper writes exactly one marker per story per run. The marker includes the Multica issue UUID, identifier, task ID, agent ID/name, work_dir, attempts, started/completed timestamps, and notes/error text when present. Truncation is reflected in `notes` when `messagesCaptureMax` clips the captured tail.

### Step 4: Sidecar deferral

For each `story_id` in `appends_map`, emit:

```text
[info] sidecar injection deferred to v2 multi-agent contract: {story_id} → {agent_names}
```

No Multica dispatch is performed for sidecars in v1. Do not create extra issues, do not assign additional agents, and do not mutate the primary issue for sidecar-only work.

## Reconciliation pattern

Reconcile completed Multica work by bringing the agent branch back onto the epic branch with the smallest history-preserving operation that matches the branch shape.

Multica agent commits land on:

```text
agent/<persona>/<run-short>
```

Canonical orchestrator-side reconciliation is cherry-pick when selecting a subset of commits or when the agent branch has diverged unrelated work:

```sh
git fetch origin agent/developer/<run-short>:refs/remotes/origin/agent/developer/<run-short>
git switch feat/multica-integration-fixes
git cherry-pick <commit-sha>
```

Use fetch + rebase, or fetch + fast-forward merge, when the agent branch is a clean linear extension of the epic branch:

```sh
git fetch origin agent/developer/<run-short>:refs/remotes/origin/agent/developer/<run-short>
git switch agent/developer/<run-short>
git rebase feat/multica-integration-fixes
git switch feat/multica-integration-fixes
git merge --ff-only agent/developer/<run-short>
```

Fast-forward-only variant:

```sh
git fetch origin agent/developer/<run-short>:refs/remotes/origin/agent/developer/<run-short>
git switch feat/multica-integration-fixes
git merge --ff-only origin/agent/developer/<run-short>
```

### Step 5: Wait for all depth-0 to terminate, then return

Wait until every story dispatched for this invocation has reached a terminal state or has produced a per-story dispatch failure marker.

Return to caller (`/execute`) with a summary:

```js
{
  dispatched: [
    { story_id, issueUuid, identifier, tracker_id, dispatch_started_at }
  ],
  completed: [
    { story_id, status: 'passed', issueUuid, identifier }
  ],
  failed: [
    { story_id, status: 'failed' | 'cancelled', issueUuid, identifier, notes }
  ]
}
```

`/execute` uses this summary to advance the DAG to the next depth, then re-invokes this skill with the next depth's unblocked stories.

## Failure modes

- `BOOTSTRAP_REQUIRED` at Step 0: abort entire mode with exit `1`; user must run `/hive:multica-init`.
- Missing credentials or server URL: abort entire mode with a clear setup error; do not create issues.
- Workspace slug not found: abort entire mode with a clear workspace resolution error.
- Multica issue `4xx` at any per-story step: record per-story failure; emit episode marker with `status=failed`; continue with other stories in the same depth; surface summary to `/execute`.
- Wall-clock timeout per story: s4's `pollTaskUntilTerminal` calls the Multica cancel endpoint and returns `status=cancelled`; episode marker is written.
- Transient network failures during poll: s4's 3-strike rule throws `TRANSPORT` after 3 consecutive failures; episode marker is written with `status=failed` and `notes='polling lost connection'`.

## Configuration

`hive.config.yaml`:

```yaml
execution:
  mode: multica                      # opt-in trigger
  multica:
    poll_interval_seconds: 5         # how often to poll task state
    story_timeout_seconds: 1800      # 30 min wall-clock per story
    messages_capture_max: 200        # last N messages into sidecar
```

## Reuses (atomic deps)

- `hive/lib/multica-story-dispatch/index.mjs` (s2) — 5 dispatch helpers:
  - `resolveAgentUuidByName`
  - `serializeStoryBrief`
  - `ensureIssueBriefMatches`
  - `dispatchStoryToAgent`
  - `moveOutOfBacklogIfNeeded`
- `hive/lib/multica-story-dispatch/episode-sync.mjs` (s4) — poll plus episode write.
- `hive/adapters/multica/index.ts` (`multica-substrate-adoption` s1) — issue CRUD via dispatch ABI.
- `.pHive/multica/agents.yaml` (`multica-substrate-adoption` s4) — persona seed; must be bootstrapped via `/hive:multica-init`.

## Constraint summary

| Rule | Enforcement |
|---|---|
| Atomic skill, not inline `/execute` prose | This file owns the Multica lifecycle for selected mode |
| Bootstrap required | `resolveAgentUuidByName(..., 'developer')` gates execution |
| One Multica issue per Hive story | Story dispatch creates or reuses only the primary issue |
| Sidecars deferred in v1 | Log deferral only; no extra Multica dispatch |
| Parallel only within current depth | `/execute` owns DAG advancement between depths |
| Episode marker per story | `multica-run.yaml` plus messages sidecar |
| No sequential fallback | Bootstrap or setup failures abort Multica mode |
