---
name: review-mode-multica
description: Run Hive /review through Multica. ONE Multica issue, ONE solo reviewer agent, ONE episode marker. Atomic thin wrapper — SOLO reviewer only, panel-mode DEFERRED. scope_drift emit at review:complete is preserved by r-1 and confirmed observable through cycle-state; atom does NOT duplicate the emit.
---

# Hive Review Mode — Multica

Atomic skill, NOT inline `/review` prose. Runs the Multica review mode after the
caller (r-1 `review-dispatch`) has resolved and validated the mode selection. The
caller selects this mode and hands off the inputs below; this skill owns the
lifecycle from issue creation to terminal episode marker.

Multica review mode treats the entire review as one dispatched unit. ONE Multica
issue is created, assigned to ONE `reviewer` agent, which runs the solo reviewer
pattern (Phase 1 of `skills/review/SKILL.md`) internally. This is the intentional
thin-wrapper contrast with `execute-mode-multica`'s per-story fan-out.

**SOLO reviewer only.** Panel-mode (multi-reviewer dispatch) is explicitly out of
scope for this atom. A future panel-mode atom would be a separate skill file.

## Invocation contract

Called once per `/review` invocation when the dispatch resolver (r-1) returns
`mode_decision == multica`.

The resolver is intentionally thin and mirrors `/execute`, `/plan`, and
`/design-review`:

- `HIVE_REVIEW_MODE=multica` selects this skill with source `env`.
- root `hive.config.yaml` with `execution.mode: multica` selects this skill with
  source `config` when the environment variable is unset.
- Any other value is ignored by this mode and falls through to the inline path.
- Env wins over config per 5-tier precedence.

**Inputs:**
- `arguments` — forwarded verbatim from r-1: PR number, branch name, or file
  paths; `--sequential` flag state (accepted, no-op for single-agent dispatch).
- `field_sources` — the resolved source map from r-1 (traceability only; not
  consumed operationally by this atom).
- `epic_id` — parent epic identifier when known, used for episode paths.
- `hive_config` — parsed root `hive.config.yaml`, including
  `review.multica.*`, `task_tracking.multica.*`, and `paths.state_dir`.
- `integration_branch` — current epic branch/ref for shared-branch contract.

**Outputs:**
- One episode marker at
  `${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/multica-run.yaml`.
- One messages sidecar at
  `${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/multica-run.messages.jsonl`.
- Summary returned to `/review` with the Multica issue ID, terminal status,
  reviewer verdict, and marker paths.

**State directory:** `HIVE_STATE_DIR = hive_config.paths.state_dir || '.pHive'`.

## Phase 0c — 5-tier mode resolution

The caller (r-1) resolves the mode before invoking this atom. The canonical
resolver call for reference:

```js
import { resolveMode } from '../../../../hive/lib/mode-resolver.mjs';

const { decision, sources } = resolveMode('HIVE_REVIEW_MODE', {
  env,             // raw 'HIVE_REVIEW_MODE=multica' token or undefined
  rootConfig,      // parsed root hive.config.yaml
  shippedBaseline, // additive slot — falls through when absent
  skillOverride,   // additive slot — falls through when absent
  default: 'auto',
});
// decision: 'multica' | 'sandcastle' | 'cc-workflows' | 'sequential' | 'auto'
// sources: { env?: string } | { root_config?: string } | ... (winning tier only)
```

Precedence: **env > root\_config > shipped\_baseline > skill\_override > default**.

`HIVE_REVIEW_MODE` is registered in `hive/lib/mode-resolver.mjs` (lines 39–44).
Recognized mode strings: `sandcastle`, `multica`, `cc-workflows`, `sequential`,
`auto`. Unrecognized env values are silently ignored and resolution falls through.

## Process

### Step 0: Precondition gate

Resolve Multica connection settings before touching any issue:

1. Read `task_tracking.multica.server_url` from `hive_config`.
2. If missing, read `~/.multica/config.json` `server_url`.
3. If still missing, read `MULTICA_SERVER_URL`.
4. Read the PAT from `MULTICA_TOKEN` or `~/.multica/config.json` `token`.
5. Resolve the workspace UUID:
   - call `GET /api/workspaces`
   - find the workspace whose `slug` matches the configured workspace slug
   - use the workspace `id` for all subsequent issue and agent calls

Resolve the `reviewer` agent:

```js
import { resolveAgentUuidByName } from '../../../../hive/lib/multica-story-dispatch/index.mjs';

const reviewerAgentUuid = await resolveAgentUuidByName(
  serverUrl,
  token,
  workspaceId,
  'reviewer',
);
```

On `BOOTSTRAP_REQUIRED`, abort immediately with stderr:

```text
ERROR: Multica review mode requires bootstrapped agents.
       Run /hive:multica-init to create them, then retry.
       (reviewer agent missing in workspace <slug>)
```

Exit `1`. Do NOT fall back to the inline review path after a selected Multica
mode fails its bootstrap gate. Do NOT fall back silently.

### Step 1: Review issue resolution and brief write

Create or reuse ONE Multica issue for the review run. The reviewer runs the
full solo-reviewer pattern internally from this single issue.

1. If the review unit already carries dispatch metadata for this exact PR or
   branch arg, reuse the recorded Multica issue UUID and identifier.
2. Otherwise create one issue with title format carrying the PR/branch argument:
   - PR review: `{PR#} - code review`
   - Branch review: `{branch} - code review`
   - Default (staged diff): `code review - {epic_id|'ad-hoc'}`
   - Use `createStory({title, body: '<brief placeholder>', labels: []})`.
3. Call `moveOutOfBacklogIfNeeded(serverUrl, token, workspaceId, issueUuid)`.
4. Render the issue brief. The brief must instruct the assigned `reviewer` agent
   to:
   - check out `integration_branch` from the plugin-hive repo:
     ```sh
     multica repo checkout https://github.com/firefly-events/plugin-hive --ref "${integration_branch}"
     ```
   - obtain the review diff using the argument forwarded from r-1 (PR number,
     branch, or file paths — same mapping as `skills/review/SKILL.md` argument
     parsing table)
   - if the argument starts with `#` or looks like a PR URL, verify `gh auth status`
     succeeds before fetching the diff
   - run the solo reviewer workflow (Phase 1 of `skills/review/SKILL.md`):
     - **Step a** — researcher subagent: scope analysis, complexity, affected modules
     - **Step b** — reviewer subagent: correctness, security, conventions, performance
   - collect both outputs and return a structured summary with:
     - `verdict`: one of `passed | needs_optimization | needs_revision`
     - `evidence_ref`: PR comment thread URL or local transcript path
     - `researcher_findings`: scope analysis summary
     - `reviewer_findings`: full review output
   - the `--sequential` flag is accepted verbatim; it is a no-op for single-agent
     dispatch (there is only one reviewer)
   - emit `scope_drift` at `review:complete` per the r-1 contract obligation
     (see scope_drift contract below)
5. Call `ensureIssueBriefMatches(serverUrl, token, workspaceId, issueUuid, brief)`.

### Step 2: Dispatch to reviewer

Dispatch the issue to the `reviewer` agent:

```js
import { dispatchStoryToAgent } from '../../../../hive/lib/multica-story-dispatch/index.mjs';

await dispatchStoryToAgent(serverUrl, token, workspaceId, issueUuid, reviewerAgentUuid);
```

Record:

```js
{
  unit_id,          // e.g. PR# or branch name or 'ad-hoc'
  issueUuid,
  identifier,       // human-readable issue ID e.g. plugin-hive/PLU-42
  agentUuid: reviewerAgentUuid,
  dispatch_started_at,
  review_target,    // PR# | branch | 'staged-diff'
}
```

Emit:

```text
[info] review multica dispatch: unit={unit_id} agent=reviewer issue={identifier} target={review_target}
```

Do NOT dispatch to `verify-team-squad`, `test-worker`, or any multi-reviewer
pipeline. This mode covers only the solo reviewer pattern. Panel-mode is DEFERRED.

### Step 3: Poll until terminal

Drive `pollTaskUntilTerminal` with a review-scoped transition callback:

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
    process.stderr.write(`[multica-review:${unit_id}] ${prev} -> ${next}\n`);
  },
});
```

Configuration:

- `maxWallClockMs` from `hive_config.review.multica.run_timeout_seconds * 1000`.
- Default `maxWallClockMs` is `1_800_000` (30 minutes).
- `pollIntervalMs` from `hive_config.review.multica.poll_interval_seconds * 1000`.
- Default `pollIntervalMs` is `5_000`.
- `messagesCaptureMax` from `hive_config.review.multica.messages_capture_max`.
- Default `messagesCaptureMax` is `200`.

Terminal status mapping (owned by the poll helper):

| Multica terminal | Episode marker status |
|---|---|
| `completed` | `passed` |
| `failed` | `failed` |
| `cancelled` | `cancelled` |

Transport failure after three consecutive polling errors is caught and written
as a failed marker.

### Step 4: Episode marker

Write ONE `multica-run.yaml` marker capturing the reviewer verdict and evidence.

Before calling the writer, annotate the terminal object:

```js
const messagesPath = `${hiveStateDir}/episodes/${epic_handle}/${unit_id}/multica-run.messages.jsonl`;
const reviewTerminal = {
  ...terminal,
  completion_kind: 'doc-verdict',
  artifacts_committed:
    terminal.status === 'completed' &&
    ['passed', 'needs_optimization', 'needs_revision'].includes(agentSummary?.verdict),
  artifacts: [messagesPath],
  scope_drift_observed: null,  // atom does NOT emit; r-1 owns the emit contract
};
```

Then write:

```js
const { markerPath, messagesPath: writtenMessages, status, notes, completion } =
  await writeMulticaRunEpisode({
    hiveStateDir,
    epicHandle: epic_handle,
    storyId: unit_id,
    issueUuid,
    identifier,
    terminal: reviewTerminal,
    messagesCaptureMax,
  });
```

The marker path is:

```text
${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/multica-run.yaml
```

Required doc/verdict fields written by `writeMulticaRunEpisode`:

| Field | Required value for review |
|---|---|
| `completion_kind` | `doc-verdict` |
| `artifacts_committed` | `true` only after reviewer returns a valid verdict |
| `episode_terminal` | `true` when marker status is terminal |
| `requires_code_push_sha` | `false` |
| `code_push_sha` | `null` |
| `terminal_by_dialect` | `artifacts_committed && episode_terminal` |
| `scope_drift_observed` | `null` — atom confirms r-1 emit obligation; does NOT duplicate |

The `evidence_ref` (PR comment thread or local transcript path) from the agent
summary is captured in the marker `notes` field alongside the verdict.

### Step 5: closeIssue on terminal

After the episode marker is written, close the Multica issue:

```js
// resolve the terminal state label from the Multica task API and close
await closeIssue(serverUrl, token, workspaceId, issueUuid);
```

Use the Multica issue close endpoint. Do not leave the issue open after the
episode marker is committed.

### Step 6: Aggregate and return

Return to `/review`:

```js
{
  dispatched: {
    unit_id,
    issueUuid,
    identifier,
    agentUuid: reviewerAgentUuid,
    dispatch_started_at,
    review_target,
  },
  verdict: {
    verdict: agentSummary.verdict,   // 'passed' | 'needs_optimization' | 'needs_revision'
    evidence_ref: agentSummary.evidence_ref,
    researcher_findings: agentSummary.researcher_findings,
    reviewer_findings: agentSummary.reviewer_findings,
  },
  marker: {
    markerPath,
    messagesPath: writtenMessages,
    status,
    terminal_by_dialect: completion.terminalByDialect,
  },
  failed: status === 'passed' && completion.terminalByDialect
    ? null
    : { status, notes },
}
```

## scope_drift Emit Contract

The `scope_drift` emit at `review:complete` is **the responsibility of the
reviewer agent** dispatched inside the Multica issue. The emit contract is:

```python
emit_scope_drift(
    run_id='${run_id}',
    phase_label='review:complete',
    expected_scope=<story acceptance_criteria>,
    delivered_scope=<reviewer findings list>,
    delta_reasons=[],
    extra_dimensions={'verdict': '<passed|needs_optimization|needs_revision>'},
    skill='review',
)
```

This atom does NOT duplicate the emit. `scope_drift_observed: null` in the
episode marker confirms this atom has verified the emit contract rather than
owning the call. The r-1 dispatch skill (`review-dispatch/SKILL.md`) documents
this as one of exactly 3 sanctioned `emit_scope_drift` call sites in the
codebase. Any change to this contract is a policy violation.

## Failure modes

- `BOOTSTRAP_REQUIRED` at Step 0: abort with exit `1`; user must run
  `/hive:multica-init`. Do NOT fall back to inline review.
- Missing credentials or server URL: abort with a clear setup error; do not
  create a review issue.
- Workspace slug not found: abort with a clear workspace resolution error.
- Missing `reviewer` agent: abort with the missing agent name.
- precondition_failed (structured reject): emit structured error with `code`,
  `reason`, and `remediation` keys; exit `1` immediately.
- Multica issue `4xx` during issue resolution, brief write, or dispatch: write a
  failed marker with the transport/API notes and return a failed summary.
- Wall-clock timeout: `pollTaskUntilTerminal` cancels the active task and returns
  `status: cancelled`; write the marker.
- Transient network failures during poll: three-strike rule throws `TRANSPORT`;
  write a failure marker with `notes='polling lost connection'`.
- Completed task with missing or invalid verdict: write a failed doc/verdict
  marker with `artifacts_committed: false` and `terminal_by_dialect: false`.

## Configuration

`hive.config.yaml`:

```yaml
review:
  mode: multica                         # opt-in trigger
  multica:
    poll_interval_seconds: 5            # how often to poll task state
    run_timeout_seconds: 1800           # 30 min wall-clock
    messages_capture_max: 200           # last N messages into sidecar
```

Environment override:

```sh
HIVE_REVIEW_MODE=multica
```

## Reuses (atomic deps)

- `hive/adapters/multica/index.ts` — issue CRUD via dispatch ABI.
- `hive/lib/multica-story-dispatch/index.mjs` — dispatch helpers:
  - `resolveAgentUuidByName`
  - `ensureIssueBriefMatches`
  - `dispatchStoryToAgent`
  - `moveOutOfBacklogIfNeeded`
- `hive/lib/multica-story-dispatch/episode-sync.mjs` — poll plus
  `multica-run.yaml` episode writer with doc/verdict completion dialect.
- `hive/lib/mode-resolver.mjs` — 5-tier `resolveMode('HIVE_REVIEW_MODE', ctx)`.
- `hive/references/episode-schema.md` — canonical marker schema.
- `hive/agents/reviewer.md` — reviewer persona; the Multica agent runs under
  this persona.
- `.pHive/multica/agents.yaml` — persona seed and provider roster; must be
  bootstrapped via `/hive:multica-init`.
- `skills/review/SKILL.md` Phase 1 — solo reviewer pattern (researcher +
  reviewer sequential steps) that the dispatched agent follows internally.
- `skills/hive/skills/review-dispatch/SKILL.md` (r-1) — router that dispatches
  into this atom; owns scope_drift emit contract declaration.

## Constraint summary

| Rule | Enforcement |
|---|---|
| Atomic skill, not inline `/review` prose | This file owns the selected Multica lifecycle |
| SOLO reviewer only — panel-mode DEFERRED | Single createIssue; single reviewer agent assigned |
| ONE Multica issue, ONE episode marker | `multica-run.yaml` written once after terminal |
| scope_drift emit preserved by r-1 | Atom does NOT duplicate; `scope_drift_observed: null` in marker confirms |
| --sequential flag forwarded verbatim | Accepted by this atom; no-op for single-agent dispatch |
| 5-tier mode resolution | `resolveMode('HIVE_REVIEW_MODE', ctx)` via mode-resolver.mjs |
| Bootstrap required before issue creation | Resolve `reviewer` agent; abort with `BOOTSTRAP_REQUIRED` |
| No silent fallback after selection | Setup/bootstrap failures exit `1`; do NOT fall back to inline review |
| Fixed outer seam | Inputs: `arguments`, `field_sources`, `epic_id`. Outputs: marker path + summary. |
| closeIssue on terminal | Step 5 closes the Multica issue after marker is written |
| labels: [] | No issue labels, matching execute-mode-multica + test-mode-multica convention |
