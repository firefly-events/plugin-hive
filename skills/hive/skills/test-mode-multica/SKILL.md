---
name: test-mode-multica
description: Run Hive simulated-manual scenarios through Multica. Dispatches one canonical scenario to the Multica tester agent, polls to terminal, and writes the story manual_verdict plus the doc/verdict multica-run episode marker.
---

# Hive Test Mode - Multica

Atomic skill, NOT inline `/test` prose. Runs the Multica test mode for
`/test --simulated-manual` after the caller has resolved and validated the
scenario. The caller selects this mode and hands off the inputs below; this skill
owns the lifecycle from tester dispatch to terminal episode marker.

Multica test mode treats one simulated-manual scenario as one dispatched unit. It
assigns the scenario to the concrete Multica `tester` agent, not to
`verify-team-squad`: the S1 carrier verdict established per-persona fan-out for
dispatch that must preserve agent identity. The tester replays the canonical S2
scenario shape, writes the verdict to the story YAML `manual_verdict` block
pinned by S3, and this skill writes one `multica-run.yaml` marker using the S4
doc/verdict completion dialect.

This skill is hard-gated on the prior schema and marker work:

- S2 scenario reconciliation must be present; stale foreign scenario keys must fail
  in `loadScenario` before dispatch.
- S3 verdict-home and agent-name unification must be present; the only canonical
  verdict home is story YAML `manual_verdict`, and the only assignee/verdict agent
  name is `tester`.
- S4 doc/verdict done-signal must be present; the terminal predicate is
  `artifacts_committed && episode_terminal` on `multica-run.yaml`.

## Invocation contract

Called once per `/test --simulated-manual <story-id|scenario-file>` invocation
when the test dispatch resolver selected `mode_decision == multica`.

The resolver is intentionally thin and mirrors `/execute` and `/plan`:

- `HIVE_TEST_MODE=multica` selects this skill with source `env`.
- root `hive.config.yaml` with `test.mode: multica` selects this skill with
  source `config` when the environment variable is unset.
- Any other value is ignored by this mode and falls through to the existing local
  simulated-manual executor.
- Env wins over config.

On selection, `/test` resolves the story and scenario exactly as it already does:

1. If the argument is a story ID, read
   `.pHive/epics/{epic_handle}/stories/{story_id}.yaml` and extract
   `manual_verdict.scenario_ref`.
2. If the argument is a path, load that path directly.
3. Call `loadScenario(path)` from `hive/lib/scenarios/load.mjs`; the scenario must
   use the reconciled canonical shape from S2.

**Inputs:**
- `scenario_path` - repo-relative path to the canonical simulated-manual scenario.
- `scenario` - parsed `loadScenario(scenario_path)` result.
- `story` - story YAML object that owns the scenario verdict.
- `story_path` - repo-relative path to the owning story YAML.
- `epic_handle` - parent epic identifier, used for episode paths.
- `story_id` - owning story identifier, used for episode paths.
- `hive_config` - parsed root `hive.config.yaml`, including
  `test.multica.*`, `task_tracking.multica.*`, and `paths.state_dir`.
- `integration_branch` - current epic branch/ref for the shared-branch contract.

**Outputs:**
- The owning story YAML updated in place with:

  ```yaml
  manual_verdict:
    scenario_ref: <scenario_path>
    verdict: pass | fail | inconclusive
    timestamp: "<ISO-8601 timestamp>"
    agent: tester
  ```

- One episode marker at
  `${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/multica-run.yaml`.
- One messages sidecar at
  `${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/multica-run.messages.jsonl`.
- Summary returned to `/test` with the Multica issue ID, terminal status, verdict,
  and marker paths.

## Process

### Step 0: Mode resolve and precondition gate

The caller resolves the mode before invoking this skill:

```js
function resolveTestMode(env, hiveConfig) {
  if (env.HIVE_TEST_MODE === 'multica') {
    return { mode_decision: 'multica', field_sources: { test_mode: 'env' } };
  }
  if (hiveConfig?.test?.mode === 'multica') {
    return { mode_decision: 'multica', field_sources: { test_mode: 'config' } };
  }
  return { mode_decision: 'default', field_sources: { test_mode: 'default' } };
}
```

After selection, resolve Multica connection settings before touching the story:

1. Read `task_tracking.multica.server_url` from `hive_config`.
2. If missing, read `~/.multica/config.json` `server_url`.
3. If still missing, read `MULTICA_SERVER_URL`.
4. Read the PAT from `MULTICA_TOKEN` or `~/.multica/config.json` `token`.
5. Resolve the workspace UUID with the same pattern as `multica-init`:
   - call `GET /api/workspaces`
   - find the workspace whose `slug` matches the configured workspace slug
   - use the workspace `id` for all issue and agent calls

Resolve the tester agent:

```js
import { resolveAgentUuidByName } from '../../../../hive/lib/multica-story-dispatch/index.mjs';

const testerAgentUuid = await resolveAgentUuidByName(
  serverUrl,
  token,
  workspaceId,
  'tester',
);
```

On `BOOTSTRAP_REQUIRED`, abort immediately with stderr:

```text
ERROR: Multica test mode requires bootstrapped agents.
       Run /hive:multica-init to create them, then retry.
       (tester agent missing in workspace <slug>)
```

Exit `1`. Do not fall back to the local simulated-manual executor after a selected
Multica mode fails its bootstrap gate.

### Step 1: Test issue resolution and brief write

Create or reuse one Multica issue for the simulated-manual run. The issue is owned
by the story being tested, but the assigned agent is always `tester`.

1. If the story already carries test dispatch metadata for this exact scenario,
   reuse the recorded Multica issue UUID and identifier.
2. Otherwise create one issue with title format:
   `{story.title} - simulated manual test`.
3. Call `moveOutOfBacklogIfNeeded(serverUrl, token, workspaceId, issueUuid)`.
4. Render the issue brief from the story and scenario. The brief must instruct the
   tester to:
   - run `multica repo checkout https://github.com/firefly-events/plugin-hive --ref "${integration_branch}"`
     if `workdir/plugin-hive` is absent or not on the requested ref
   - verify the checkout before executing the scenario
   - load `scenario_path` through `loadScenario`
   - follow `hive/workflows/steps/test/simulated-manual.md` exactly
   - write the verdict to `story_path` under `manual_verdict`
   - commit and push the story-YAML verdict on `integration_branch`
5. Call `ensureIssueBriefMatches(serverUrl, token, workspaceId, issueUuid, brief)`.

The brief must name the canonical verdict home explicitly. `.pHive/cycle-state/*`
may be mentioned only as a derived/index mirror, never as the source of truth.

### Step 2: Dispatch to tester

Dispatch the issue to the tester agent:

```js
import { dispatchStoryToAgent } from '../../../../hive/lib/multica-story-dispatch/index.mjs';

await dispatchStoryToAgent(serverUrl, token, workspaceId, issueUuid, testerAgentUuid);
```

Record:

```js
{
  story_id,
  scenario_path,
  issueUuid,
  identifier,
  agentUuid: testerAgentUuid,
  dispatch_started_at,
}
```

Emit:

```text
[info] test multica dispatch: story={story_id} scenario={scenario_path} agent=tester issue={identifier}
```

Do not dispatch to `test-worker`, `verify-team-squad`, or the full test-swarm
pipeline. This mode covers only `--simulated-manual`.

### Step 3: Poll until terminal

Drive `pollTaskUntilTerminal` with a test-scoped transition callback:

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
    process.stderr.write(`[multica-test:${story_id}] ${prev} -> ${next}\n`);
  },
});
```

Configuration:

- `maxWallClockMs` from `hive_config.test.multica.scenario_timeout_seconds * 1000`.
- Default `maxWallClockMs` is `1_800_000` (30 minutes).
- `pollIntervalMs` from `hive_config.test.multica.poll_interval_seconds * 1000`.
- Default `pollIntervalMs` is `5_000`.
- `messagesCaptureMax` from `hive_config.test.multica.messages_capture_max`.
- Default `messagesCaptureMax` is `200`.

Transport failure after three consecutive polling errors is caught for this scenario
and written as a failed marker.

### Step 4: Verify verdict artifact

After the Multica task reaches terminal, read `story_path` from the updated shared
branch checkout and verify the canonical verdict block exists:

```yaml
manual_verdict:
  scenario_ref: <scenario_path>
  verdict: pass | fail | inconclusive
  timestamp: "<ISO-8601 timestamp>"
  agent: tester
```

If the Multica task reports `completed` but the story YAML is missing
`manual_verdict`, has no verdict, or records any agent other than `tester`, treat the
run as failed for this mode. Surface a notes string that names the missing or invalid
field. Do not infer a verdict from the issue comment, task notes, or messages.

### Step 5: Episode marker

Use the mpt-4 doc/verdict dialect on the existing `multica-run.yaml` marker. Do not
invent a test-specific marker.

Before calling the writer, derive the sibling messages path and annotate the
terminal object. The writer emits `multica-run.messages.jsonl` next to
`multica-run.yaml` in the episode directory, so the path is deterministic; both
artifacts must be listed per the contract table below.

```js
const messagesPath = `${hiveStateDir}/episodes/${epic_handle}/${story_id}/multica-run.messages.jsonl`;
const verdictTerminal = {
  ...terminal,
  completion_kind: 'doc-verdict',
  artifacts_committed:
    terminal.status === 'completed' &&
    manualVerdict?.agent === 'tester' &&
    ['pass', 'fail', 'inconclusive'].includes(manualVerdict?.verdict),
  artifacts: [story_path, messagesPath],
};
```

Then write:

```js
const { markerPath, messagesPath, status, notes, completion } =
  await writeMulticaRunEpisode({
    hiveStateDir,
    epicHandle: epic_handle,
    storyId: story_id,
    issueUuid,
    identifier,
    terminal: verdictTerminal,
    messagesCaptureMax,
  });
```

The marker path is:

```text
${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/multica-run.yaml
```

Required doc/verdict fields are written by `writeMulticaRunEpisode`:

| Field | Required value for simulated-manual test |
|---|---|
| `completion_kind` | `doc-verdict` |
| `artifacts_committed` | `true` only after the story-YAML verdict is committed |
| `episode_terminal` | `true` when marker status is terminal |
| `requires_code_push_sha` | `false` |
| `code_push_sha` | `null` |
| `terminal_by_dialect` | `artifacts_committed && episode_terminal` |

The `artifacts` list must include the story YAML containing `manual_verdict` plus
`multica-run.messages.jsonl`.

### Step 6: Aggregate and return

Return to `/test`:

```js
{
  dispatched: {
    story_id,
    scenario_path,
    issueUuid,
    identifier,
    agentUuid: testerAgentUuid,
    dispatch_started_at,
  },
  verdict: {
    scenario_ref: scenario_path,
    verdict: manualVerdict.verdict,
    timestamp: manualVerdict.timestamp,
    agent: 'tester',
  },
  marker: {
    markerPath,
    messagesPath,
    status,
    terminal_by_dialect: completion.terminalByDialect,
  },
  failed: status === 'passed' && completion.terminalByDialect
    ? null
    : { status, notes },
}
```

`/test` uses this summary as the simulated-manual result. If `verdict.verdict` is
`fail`, the test run itself completed but the story did not pass the manual
scenario; report the failing scenario result and do not proceed to review.

## Failure modes

- `BOOTSTRAP_REQUIRED` at Step 0: abort the selected mode with exit `1`; user must
  run `/hive:multica-init`.
- Missing credentials or server URL: abort selected mode with a clear setup error;
  do not create a test issue.
- Workspace slug not found: abort selected mode with a clear workspace resolution
  error.
- Missing `tester` agent: abort selected mode with the missing agent name.
- Scenario validation failure: abort before dispatch and surface the structured
  `loadScenario` error (`code`, `field`, `filePath`).
- Missing `manual_verdict.scenario_ref` for a story-ID invocation: abort before
  dispatch with the existing `/test` error text.
- `implementation-walk` without `.pHive/episodes/{epic_handle}/{story_id}/integrate.yaml`:
  abort before dispatch with the simulated-manual executor's existing error text.
- Multica issue `4xx` during issue resolution, brief write, or assignment: write a
  failed marker with the transport/API notes and return a failed summary.
- Wall-clock timeout: `pollTaskUntilTerminal` cancels the active task and returns
  `status: cancelled`; write the marker.
- Transient network failures during poll: the helper's three-strike rule throws
  `TRANSPORT`; write a failure marker with `notes='polling lost connection'`.
- Completed task without a committed story-YAML verdict: write a failed
  doc/verdict marker with `artifacts_committed: false` and
  `terminal_by_dialect: false`.

## Configuration

`hive.config.yaml`:

```yaml
test:
  mode: multica                         # opt-in trigger
  multica:
    poll_interval_seconds: 5            # how often to poll task state
    scenario_timeout_seconds: 1800      # 30 min wall-clock per scenario
    messages_capture_max: 200           # last N messages into sidecar
```

Environment override:

```sh
HIVE_TEST_MODE=multica
```

## Reuses (atomic deps)

- `hive/lib/scenarios/load.mjs` (mpt-2) - canonical simulated-manual scenario
  loader and validator.
- `hive/workflows/steps/test/simulated-manual.md` (mpt-3) - local executor
  contract the Multica tester must follow.
- `hive/lib/multica-story-dispatch/index.mjs` (mpt-5) - dispatch helpers:
  - `resolveAgentUuidByName`
  - `ensureIssueBriefMatches`
  - `dispatchStoryToAgent`
  - `moveOutOfBacklogIfNeeded`
- `hive/lib/multica-story-dispatch/episode-sync.mjs` (mpt-4) - poll plus
  `multica-run.yaml` episode writer with the doc/verdict completion dialect.
- `.pHive/multica/agents.yaml` - persona seed and provider roster; must be
  bootstrapped via `/hive:multica-init`.
- `skills/test/SKILL.md` - existing `--simulated-manual` argument resolution and
  local fallback path.

## Constraint summary

| Rule | Enforcement |
|---|---|
| Atomic skill, not inline `/test` prose | This file owns the selected Multica lifecycle |
| Thin mode resolve | `HIVE_TEST_MODE=multica` or `test.mode: multica` selects this atom |
| Bootstrap required | Resolve `tester` before issue creation or dispatch |
| Canonical scenario shape | Caller must use `loadScenario` before dispatch |
| Canonical verdict home | Tester writes story-YAML `manual_verdict`, not cycle-state |
| Canonical agent name | `manual_verdict.agent: tester`; resolve `tester` in Multica |
| One scenario, one tester issue | Do not assign `verify-team-squad` or run test swarm |
| Episode marker per scenario | One `multica-run.yaml` plus messages sidecar |
| Shared doc/verdict dialect | `completion_kind: doc-verdict`, no code-push SHA required |
| No silent fallback after selection | Setup/bootstrap failures abort selected Multica mode |
