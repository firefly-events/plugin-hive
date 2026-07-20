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
- One team-memory note per story, when distill emits reusable signal, at `${HIVE_STATE_DIR}/team-memories/{epic_handle}/{story_id}.md`.
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

Then resolve the execution mode. **Three modes, in precedence order:**

1. **Phase-loop mode (X — recommended for TDD)** — when `hive_config.execution?.multica?.tdd_phases` is set (a list of `{phase, agent}`). The **orchestrator itself is the stateful leader**: it runs the TDD loop, dispatching each phase to its member agent on a shared remote story branch (git hand-off). No leader agent; workers are stateless. See **Step 1-X** below. This is the preferred cross-runtime TDD path.
2. **Squad mode** — when `execution.multica.squad` is set (a squad name). The issue is assigned to the squad; Multica's squad **leader agent** delegates phases to members. Works, but the leader is stateless and re-spawned per phase (higher cost than X). Cross-runtime, Multica-managed.
3. **Single-agent mode** (default) — the issue is assigned to the `developer` agent, which runs the whole brief itself.

```

On `BOOTSTRAP_REQUIRED`, abort immediately with stderr:

```text
ERROR: Multica execution mode requires a bootstrapped assignee.
       Single-agent mode needs the 'developer' agent (run /hive:multica-init).
       Phase-loop mode needs every configured phase agent to exist (execution.multica.tdd_phases).
       Squad mode needs the configured squad to exist (execution.multica.squad).
       (assignee missing in workspace <slug>)
```

Exit `1`. Do NOT fall back to sequential.

### Step 1: Per-story dispatch (serial within depth — Phase 1)

Phase 1 dispatches stories **serially** within the current depth: dispatch story N, poll to terminal (Step 2), write the episode marker (Step 3), then advance to story N+1. This is the v1 contract — it keeps Multica daemon load bounded, makes failure isolation trivial, and matches how `meta-improvement-reset` was actually run inline on 2026-05-25.

> **Phase 2 (future):** parallel-within-depth fanout is a documented option once we have evidence the daemon and agent runtime tolerate concurrent task pressure. Do not enable parallel dispatch in v1.

### Step 1-X: Orchestrator-driven TDD phase loop (when `mode === 'phase-loop'`)

The orchestrator is the long-lived stateful leader. For each story it runs the TDD
phases itself, handing the work tree between phases via a **shared remote story branch**
(each phase clones + checks out the branch, does its phase, commits, pushes). This is
validated: naive work_dir inheritance does NOT survive re-assignment, but git hand-off
across separate clones does.

```js
import {
  resolveAgentUuidByName, dispatchStoryToAgent, ensureIssueBriefMatches,
  moveOutOfBacklogIfNeeded, resolveStoryBranch, serializePhaseBrief,
} from '../../../../hive/lib/multica-story-dispatch/index.mjs';
import { pollTaskUntilTerminal, writeMulticaRunEpisode } from '../../../../hive/lib/multica-story-dispatch/episode-sync.mjs';

const baseBranch = epic?.git_flow?.base_branch ?? 'development';
const prefix     = hive_config?.task_tracking?.branch_prefix ?? 'fir';
const repoUrl    = /* the target repo SSH/HTTPS url */;

for (const story of unblocked_stories) {
  const issueUuid  = /* resolve/create per Step 1.1 */;
  const storyBranch = resolveStoryBranch(epic.name, story.id, prefix);
  await moveOutOfBacklogIfNeeded(serverUrl, token, workspaceId, issueUuid);
  const priorSummaries = [];
  for (let i = 0; i < tddPhases.length; i++) {
    const { phase, agent } = tddPhases[i];
    const brief = serializePhaseBrief(story, phase, {
      storyBranch, baseBranch, repoUrl, isFirst: i === 0, priorSummaries,
    });
    await ensureIssueBriefMatches(serverUrl, token, workspaceId, issueUuid, brief);
    const agentUuid = await resolveAgentUuidByName(serverUrl, token, workspaceId, agent);
    await dispatchStoryToAgent(serverUrl, token, workspaceId, issueUuid, agentUuid);
    const terminal = await pollTaskUntilTerminal({ serverUrl, token, workspaceId, issueUuid, /* timeouts from config */ });
    if (terminal.status !== 'completed') {
      // abort the loop for this story; record the failing phase; do NOT run later phases
      break;
    }
    priorSummaries.push(`${phase}: ${terminal.notes || 'done'}`);
  }
  // after all phases pass: episode marker + integrate (branch already carries every phase commit)
  await writeMulticaRunEpisode({ hiveStateDir, epicHandle: epic.name, storyId: story.id, issueUuid, identifier, terminal, messagesCaptureMax });
}
```

Notes:
- **Dependency base:** if `story.depends_on` includes an un-merged story, set `baseBranch`
  to that story's branch (`resolveStoryBranch`) so this story builds on it.
- **Branch hand-off is the contract:** each phase MUST commit + push the story branch;
  the next phase clones it fresh. `serializePhaseBrief` injects this git protocol.
- **Failure isolation:** a non-`completed` phase aborts only that story's loop; later
  phases are skipped, earlier commits remain on the branch for inspection.
- Skip Step 1's single-dispatch steps below — they apply only to `mode === 'single'` /
  `'squad'`.

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
   - Read `hive_config.agent_backends?.developer` (the `developer` role is the persona Multica's bootstrapped agent runs under). If it equals `'codex'` **and we are in single-agent mode** (`assigneeKind === 'agent'`), pass `{ codexInstruction: true }` so the brief instructs the inner Claude Code session to use `/codex:rescue` for implementation. In **squad mode** the green member already runs on the native codex runtime, so do NOT inject `codexInstruction` — omit options. Otherwise omit options for backward-compatible behavior.
   - `dispatchingPersona` here is `'developer'` (the bootstrapped single-agent persona). Call `await buildStoryBrief(story, { dispatchingPersona: 'developer', ...(assigneeKind === 'agent' && codexInstruction ? { codexInstruction: true } : {}) })` to produce Markdown — `buildStoryBrief` (not the sync `serializeStoryBrief`) is required so the persona stamp and Prior Experience section are injected on this dispatch route too.
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
   - Single-agent mode: `dispatchStoryToAgent(serverUrl, token, workspaceId, issueUuid, assigneeUuid)`.
   - Squad mode: `dispatchStoryToSquad(serverUrl, token, workspaceId, issueUuid, assigneeUuid)` (import it from the same dispatch module).
   - The `PUT` returns `200` with `assignee_type` (`agent` or `squad`) and `assignee_id` populated.
   - Multica internally enqueues the task after assignment. In squad mode the leader receives the task and delegates to members.

6. **Track.**
   - Record `{story_id, issueUuid, identifier, dispatch_started_at}` in an in-memory map for the poll loop.
   - Keep per-story state independent so one 4xx or terminal failure does not block sibling stories in the same depth.

The dispatch fanout is **serial within the current depth** in Phase 1 (see Step 1 preamble). Do not advance to later DAG depths inside this skill; `/execute` owns DAG advancement and re-invokes this skill for the next depth.

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
   - Determine the dispatching persona name for this story (e.g. `backend-developer`, `researcher`). Load `.pHive/multica/agents.yaml` once per `/execute` run (cache the parsed result; do not re-read per story).
   - Call `await buildStoryBrief(story, { dispatchingPersona, agents, agentBackends, integrationBranch })` to produce Markdown — `buildStoryBrief` (not the sync `serializeStoryBrief`) is required so the persona stamp AND the Prior Experience section (S2 harvest attribution) land on this dispatch route, where:
     - `dispatchingPersona` is the persona name string
     - `agents` is the `agents[]` array from the parsed agents.yaml
     - `agentBackends` is `hive_config.agent_backends` (an object mapping persona name → `'codex'|'claude'`)
     - The function applies the following decision: if `agents[persona].provider === 'codex'`, the `## Use /codex:rescue` section is **omitted** (native Codex runtime handles execution directly). If `agents[persona].provider === 'claude'` and `agentBackends[persona] === 'codex'`, the section is **embedded** (backward-compat rescue dance). Otherwise omitted.
   - Legacy callers that pass `{ codexInstruction: true }` without `dispatchingPersona` continue to work unchanged.
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
   - Single-agent mode: `dispatchStoryToAgent(serverUrl, token, workspaceId, issueUuid, assigneeUuid)`.
   - Squad mode: `dispatchStoryToSquad(serverUrl, token, workspaceId, issueUuid, assigneeUuid)`.
   - The `PUT` returns `200` with `assignee_type` (`agent` or `squad`) and `assignee_id` populated.
   - Multica internally enqueues the task after assignment. In squad mode the leader receives the task and delegates to members.

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
import { readSquadEvaluation } from '../../../../hive/lib/multica-story-dispatch/index.mjs';
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

**wr-5 investigation finding — out of reach for the `SubagentStop` completion
contract:** this dispatch path does not bind `SubagentStop` and does not need
`agent-spawn/SKILL.md`'s `## Completion Contract` block appended anywhere in
its prompt assembly. A Multica-dispatched story is a fully independent
Multica-managed session (its own top-level agent run, not a subagent of the
orchestrator's session — the same shape as this very `/execute` run when
launched via Multica), so `SubagentStop` structurally cannot fire for it.
`pollTaskUntilTerminal` above (issue status via the Multica API) IS this
path's completion signal and is unrelated to `.hive-task-status.json` /
`hooks/notify-agent-complete.sh`. Confirmed against `hive/lib/dag_executor/
executor/handlers/agent.py`'s `MulticaAgentSpawn`, which drives the same
dispatch+poll shape from the Python DAG executor. See
`agent-spawn/SKILL.md` §7.2 for the full carve-out list (cmux, Bash
`run_in_background`, `LocalAgentSpawn`, and this path).

### Step 3: Episode marker per terminal

Before calling `writeMulticaRunEpisode`, conditionally read the squad evaluation. Check for `${HIVE_STATE_DIR}/multica/squads.yaml` once per `/execute` run (cache the result — do not re-stat per story). If the file exists and `terminal.status === 'completed'`, attempt to read the squad evaluation:

```js
// squadsYamlExists: boolean cached once at run start via fs.access(`${hiveStateDir}/multica/squads.yaml`)
let squadEvaluation = null;
if (squadsYamlExists && terminal.status === 'completed') {
  try {
    const { evaluation } = await readSquadEvaluation(issueUuid, {
      serverUrl,
      token,
      workspaceId,
    });
    squadEvaluation = evaluation; // may be null if no squad_leader_evaluated entry
  } catch (err) {
    process.stderr.write(
      `[multica:${story.id}] warn: readSquadEvaluation failed — ${err?.message ?? err}; continuing\n`,
    );
    // best-effort: null result does not block /execute completion
  }
}
```

If `${HIVE_STATE_DIR}/multica/squads.yaml` is absent (consumer project has not adopted the squad layer), skip the read entirely — `squadEvaluation` stays `null` and no `squad_evaluation` block appears in the marker.

Call `writeMulticaRunEpisode` with the terminal state and optional squad evaluation:

```js
const { markerPath, messagesPath, status, notes } = await writeMulticaRunEpisode({
  hiveStateDir,            // resolved from paths.state_dir (default .pHive)
  epicHandle: epic_handle, // parent epic identifier
  storyId: story.id,
  issueUuid,               // captured in Step 1 dispatch
  identifier,              // human-readable issue ID (e.g. plugin-hive/PLU-42)
  terminal,                // object returned by pollTaskUntilTerminal in Step 2
  messagesCaptureMax,      // hive_config.execution.multica.messages_capture_max (default 200)
  squad_evaluation: squadEvaluation, // null when absent/no-op; omitted from marker when null
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

**Scope-drift emit (per-story boundary).** Immediately after the episode marker is written, emit one `scope_drift_score` event per `/execute`'s Scope-drift emit prescription. This is the per-story boundary call for Multica mode — fire-and-forget, no error handling. The `ed-1-maturity-helper` gate inside the helper silently skips on greenfield/early projects.

```sh
python3 -c "
from hive.lib.scope_drift import emit_scope_drift
emit_scope_drift(
    run_id='${run_id}',
    phase_label='execute:story',
    expected_scope=${json.dumps(story.acceptance_criteria or [])},
    delivered_scope=${json.dumps(parse_delivered_from(terminal.notes))},
    delta_reasons=[],
    story_id='${story.id}',
    skill='execute',
)
"
```

`delivered_scope` is sourced from the developer's done-summary captured in `terminal.notes` (one bullet per logical delivery; split on newlines/semicolons). When the parsed delivered list equals `expected_scope`, `delta_reasons` stays empty and the helper buckets to `none`. When divergence is detected (a future enhancement once we trust the parse), `delta_reasons` carries values from the cycle-state-schema enum: `rescope`, `scope-creep`, `deferred`, `blocked`, `misunderstood-ac`, `out-of-band-work`.

### Step 3.5: Orchestrator insight distill

After the episode marker and messages sidecar are written, run the orchestrator-side
distill pass for the story. This closes the Multica insight-capture loop:

- **mic-1 agent self-capture:** the dispatched agent writes non-obvious reusable
  findings to `.hive/insights/{story_id}.md` inside its repository checkout before
  finishing.
- **mic-2 orchestrator distill:** `writeMulticaRunEpisode` invokes
  `runMulticaInsightDistill` with the terminal `work_dir`, messages sidecar, and
  optional distill payload. The distill reads the agent self-capture, transcript
  tail, and git diff, then writes a team-memory note when it finds reusable signal.

The canonical invocation is via the `distill` option on `writeMulticaRunEpisode`:

```js
const { distill } = await writeMulticaRunEpisode({
  hiveStateDir,
  epicHandle: epic_handle,
  storyId: story.id,
  issueUuid,
  identifier,
  terminal,
  messagesCaptureMax,
  distill: {
    teamMemory,      // concise orchestrator-distilled note, if any
    hiveMemories,    // optional promoted persona memories
    diffBaseRef,     // optional base ref for git diff input
  },
});
```

When `distill.teamMemoryPath` is non-null, the team-memory output is:

```text
${HIVE_STATE_DIR}/team-memories/{epic_handle}/{story_id}.md
```

Distill is best-effort at the lifecycle level: it must not rewrite terminal status
or suppress the episode marker. Surface distill failures in the caller summary/logs
for diagnosis, but preserve the already-written `multica-run.yaml` and messages
sidecar as the source of execution truth.

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
  - `buildStoryBrief`
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
| Serial within current depth (no parallelism in v1) | `/execute` owns DAG advancement between depths; parallel-within-depth is Phase 2, see Step 1 |
| Episode marker per story | `multica-run.yaml` plus messages sidecar |
| Insight capture | mic-1 agent self-capture brief plus mic-2 orchestrator distill |
| No sequential fallback | Bootstrap or setup failures abort Multica mode |
