---
name: design-review-mode-multica
description: Run Hive design-review workflow through Multica. ONE Multica issue, FOUR sequential agent() calls matching design-review.workflow.yaml:8-81 (accessibility → animations → ui-designer-critique → ui-designer-synthesis), ONE episode marker capturing all four outputs. Intentionally different from d-3 per-persona shape — workflow.yaml is the canonical anchor.
---

# Hive Design Review Mode — Multica

<!-- Architectural anchor: hive/workflows/design-review.workflow.yaml:8-81 -->
<!-- Intentional asymmetry: dr-2 = single Multica run with 4 agent() calls. d-3 = per-persona fan-out. DO NOT conflate. -->

Atomic skill, NOT inline `/design-review` prose. Runs the Multica design-review
mode after the caller has resolved and validated the design artifacts. The caller
selects this mode via `design-review-dispatch/SKILL.md` (dr-1) and hands off the
inputs below; this skill owns the lifecycle from issue creation to terminal episode
marker.

Multica design-review mode treats the entire 4-step workflow as one dispatched
unit. Unlike `plan-mode-multica` (per-persona fan-out) and unlike `d-3`
(design-mode-multica per-persona), dr-2 creates ONE Multica issue whose assigned
agent runs FOUR agent() calls internally, in the order defined by
`hive/workflows/design-review.workflow.yaml`:

1. `accessibility-specialist` — accessibility critique (optional step)
2. `animations-specialist` — animations critique (optional step, receives
   accessibility critique output)
3. `ui-designer` critique — design critique using
   `hive/references/ui-prompts/design-review-design-critique.md` (required)
4. `ui-designer` synthesis — synthesis using
   `hive/references/ui-prompts/design-review-synthesis.md` (required, depends on
   all three prior outputs)

This 4-step sequential model preserves the `design-review.workflow.yaml` shape
exactly. The architectural justification (Q11 resolution) is recorded in
`.pHive/epics/substrate-coverage-and-test-cleanup/docs/outline-collab-review-record.md`.

## Invocation contract

Called once per `/design-review` invocation when the dispatch resolver selected
`mode_decision == multica`.

The resolver is intentionally thin and mirrors `/execute` and `/plan`:

- `HIVE_DESIGN_REVIEW_MODE=multica` selects this skill with source `env`.
- root `hive.config.yaml` with `execution.mode: multica` selects this skill with
  source `config` when the environment variable is unset.
- Any other value is ignored by this mode and falls through to the inline path.
- Env wins over config.

**Inputs:**
- `workflow_path` — path to `hive/workflows/design-review.workflow.yaml`.
- `unblocked_stories[]` — design-review stories at the current dispatch tick.
- `appends_map` — `{story_id: [sidecar_agent_name, ...]}` (logged; v1 DEFERRED).
- `epic_handle` — parent epic identifier, used for episode paths.
- `hive_config` — parsed root `hive.config.yaml`, including
  `design_review.multica.*`, `task_tracking.multica.*`, and `paths.state_dir`.
- `integration_branch` — current epic branch/ref for the shared-branch contract.
- `design_artifacts` — the artifact payload (URLs, file paths, or inline content)
  passed through to the agent prompts. Forwarded verbatim.
- `--skip` flag state — captured from caller arguments; a list of step IDs to
  skip (e.g. `--skip accessibility`, `--skip animations`). Forwarded verbatim.
- `--artifact-target` flag value — `design | implementation`; forwarded verbatim
  to the agent prompts so the ui-designer critique targets the right surface.

**Outputs:**
- One episode marker at
  `${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/multica-run.yaml`
  where `{unit_id}` is the design-review unit identifier (e.g. story ID).
- One messages sidecar at
  `${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/multica-run.messages.jsonl`.
- Summary returned to `/design-review` with the Multica issue ID, terminal
  status, and marker paths.

## Process

### Step 0: Mode resolve and precondition gate

The caller (dr-1 dispatch skill) resolves the mode before invoking this skill.
The 5-tier resolution call for this mode is:

```js
import { resolveMode } from '../../../../hive/lib/mode-resolver.mjs';

const { decision, sources } = resolveMode('HIVE_DESIGN_REVIEW_MODE', {
  env,            // raw 'HIVE_DESIGN_REVIEW_MODE=multica' token or undefined
  rootConfig,     // parsed root hive.config.yaml
  shippedBaseline, // additive slot — falls through when absent
  skillOverride,   // additive slot — falls through when absent
  default: 'auto',
});
// decision: 'multica' | 'sandcastle' | 'cc-workflows' | 'sequential' | 'auto'
// sources: { env?: string } | { root_config?: string } | ... (winning tier only)
```

Precedence: **env > root\_config > shipped\_baseline > skill\_override > default**.

After selection, resolve Multica connection settings before touching any story:

1. Read `task_tracking.multica.server_url` from `hive_config`.
2. If missing, read `~/.multica/config.json` `server_url`.
3. If still missing, read `MULTICA_SERVER_URL`.
4. Read the PAT from `MULTICA_TOKEN` or `~/.multica/config.json` `token`.
5. Resolve the workspace UUID:
   - call `GET /api/workspaces`
   - find the workspace whose `slug` matches the configured workspace slug
   - use the workspace `id` for all subsequent issue and agent calls

Resolve the `ui-designer` agent (primary worker for steps 3 and 4):

```js
import { resolveAgentUuidByName } from '../../../../hive/lib/multica-story-dispatch/index.mjs';

const uiDesignerAgentUuid = await resolveAgentUuidByName(
  serverUrl,
  token,
  workspaceId,
  'ui-designer',
);
```

On `BOOTSTRAP_REQUIRED`, abort immediately with stderr:

```text
ERROR: Multica design-review mode requires bootstrapped agents.
       Run /hive:multica-init to create them, then retry.
       (ui-designer agent missing in workspace <slug>)
```

Exit `1`. Do not fall back to the inline design-review path after a selected
Multica mode fails its bootstrap gate.

### Step 1: Design-review issue resolution and brief write

Create or reuse ONE Multica issue for the entire 4-step design-review run. All
four agent() calls execute inside this single Multica issue — this is the
intentional contrast with `plan-mode-multica`'s per-persona fan-out.

1. If the design-review unit already carries dispatch metadata for this exact
   set of artifacts, reuse the recorded Multica issue UUID and identifier.
2. Otherwise create one issue with title format:
   `{story.title} - design review`.
3. Call `moveOutOfBacklogIfNeeded(serverUrl, token, workspaceId, issueUuid)`.
4. Render the issue brief. The brief must instruct the assigned agent to:
   - check out `integration_branch` from the plugin-hive repo
   - run the 4-step design-review sequence in order:

     **Step A — accessibility critique** (optional; skip if `--skip accessibility`):
     ```
     agent(accessibility-specialist, task=<workflow step accessibility-critique task>,
           inputs={design_artifacts}, step_file=null)
     ```
     Log `[info] skipping accessibility step — --skip accessibility` and set
     `accessibility_critique = null` when skipped.

     **Step B — animations critique** (optional; skip if `--skip animations`):
     ```
     agent(animations-specialist, task=<workflow step animations-critique task>,
           inputs={design_artifacts, accessibility_critique (if present)},
           step_file=null)
     ```
     Log `[info] skipping animations step — --skip animations` and set
     `animations_critique = null` when skipped.

     **Step C — ui-designer critique** (required):
     ```
     agent(ui-designer, task=<design-review-design-critique.md>,
           inputs={design_artifacts, accessibility_critique, animations_critique,
                   artifact_target},
           step_file=hive/references/ui-prompts/design-review-design-critique.md)
     ```

     **Step D — ui-designer synthesis** (required):
     ```
     agent(ui-designer, task=<design-review-synthesis.md>,
           inputs={accessibility_critique, animations_critique, design_critique,
                   artifact_target},
           step_file=hive/references/ui-prompts/design-review-synthesis.md)
     ```

   - `--artifact-target {design|implementation}` is forwarded verbatim to Steps C
     and D agent prompts
   - collect all four outputs (null for skipped optional steps) and return a
     structured summary containing each step's output verbatim
5. Call `ensureIssueBriefMatches(serverUrl, token, workspaceId, issueUuid, brief)`.

### Step 2: Dispatch to ui-designer

Dispatch the issue to the `ui-designer` agent:

```js
import { dispatchStoryToAgent } from '../../../../hive/lib/multica-story-dispatch/index.mjs';

await dispatchStoryToAgent(serverUrl, token, workspaceId, issueUuid, uiDesignerAgentUuid);
```

Record:

```js
{
  unit_id,
  issueUuid,
  identifier,
  agentUuid: uiDesignerAgentUuid,
  dispatch_started_at,
  skip_flags,         // e.g. ['accessibility']
  artifact_target,    // e.g. 'design'
}
```

Emit:

```text
[info] design-review multica dispatch: unit={unit_id} agent=ui-designer issue={identifier} skip={skip_flags} artifact_target={artifact_target}
```

The dispatched agent drives all four workflow steps internally. This skill does
not dispatch four separate issues — that is `plan-mode-multica`'s pattern and is
explicitly excluded here per the Q11 ruling.

### Step 3: Poll until terminal

Drive `pollTaskUntilTerminal` with a design-review-scoped transition callback:

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
    process.stderr.write(`[multica-design-review:${unit_id}] ${prev} -> ${next}\n`);
  },
});
```

Configuration:

- `maxWallClockMs` from `hive_config.design_review.multica.run_timeout_seconds * 1000`.
- Default `maxWallClockMs` is `3_600_000` (60 minutes — four agent calls take
  longer than a single tester run).
- `pollIntervalMs` from `hive_config.design_review.multica.poll_interval_seconds * 1000`.
- Default `pollIntervalMs` is `5_000`.
- `messagesCaptureMax` from `hive_config.design_review.multica.messages_capture_max`.
- Default `messagesCaptureMax` is `200`.

Transport failure after three consecutive polling errors is caught and written as
a failed marker.

### Step 4: Verify outputs

After the Multica task reaches terminal, verify the structured summary returned
by the agent contains at minimum:

- `design_critique` — non-null (required step C)
- `synthesis` — non-null (required step D)
- `accessibility_critique` — null iff `--skip accessibility` was passed, otherwise present
- `animations_critique` — null iff `--skip animations` was passed, otherwise present

If the task reports `completed` but the structured summary is missing any required
field, treat the run as failed. Surface a notes string naming the missing field.
Do not infer outputs from issue comments or task notes.

### Step 5: Episode marker

Write ONE `multica-run.yaml` marker capturing all four agent() outputs. This
single marker is the intentional contrast with `plan-mode-multica`'s one-marker-
per-persona shape. The completion dialect is `doc-verdict`.

```js
const messagesPath = `${hiveStateDir}/episodes/${epic_handle}/${unit_id}/multica-run.messages.jsonl`;
const verdictTerminal = {
  ...terminal,
  completion_kind: 'doc-verdict',
  artifacts_committed:
    terminal.status === 'completed' &&
    agentSummary?.design_critique != null &&
    agentSummary?.synthesis != null,
  artifacts: [messagesPath],
};

const { markerPath, messagesPath: writtenMessages, status, notes, completion } =
  await writeMulticaRunEpisode({
    hiveStateDir,
    epicHandle: epic_handle,
    storyId: unit_id,
    issueUuid,
    identifier,
    terminal: verdictTerminal,
    messagesCaptureMax,
  });
```

The marker path is:

```text
${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/multica-run.yaml
```

Required doc/verdict fields written by `writeMulticaRunEpisode`:

| Field | Required value for design-review |
|---|---|
| `completion_kind` | `doc-verdict` |
| `artifacts_committed` | `true` only after required steps C+D outputs are present |
| `episode_terminal` | `true` when marker status is terminal |
| `requires_code_push_sha` | `false` |
| `code_push_sha` | `null` |
| `terminal_by_dialect` | `artifacts_committed && episode_terminal` |

The marker captures all four step outputs in its `notes` field. The messages
sidecar at `multica-run.messages.jsonl` holds the full agent conversation.

### Step 6: Aggregate and return

Return to `/design-review`:

```js
{
  dispatched: {
    unit_id,
    issueUuid,
    identifier,
    agentUuid: uiDesignerAgentUuid,
    dispatch_started_at,
    skip_flags,
    artifact_target,
  },
  outputs: {
    accessibility_critique: agentSummary.accessibility_critique,  // null if skipped
    animations_critique: agentSummary.animations_critique,        // null if skipped
    design_critique: agentSummary.design_critique,
    synthesis: agentSummary.synthesis,
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

## --skip flag semantics

The `--skip` flag is forwarded from the caller (dr-1) verbatim. Each recognized
skip value suppresses exactly one optional workflow step:

| Flag value | Suppressed step | Step requirement |
|---|---|---|
| `accessibility` | Step A (accessibility-critique) | optional per workflow.yaml |
| `animations` | Step B (animations-critique) | optional per workflow.yaml |

Unrecognized skip values are logged as a warning and ignored:

```text
[warn] design-review-mode-multica: unknown --skip value "{value}" — ignored
```

Required steps C (design-critique) and D (synthesis) cannot be skipped. If the
caller passes `--skip design-critique` or `--skip synthesis`, log the warning and
proceed with those steps unchanged.

When a step is skipped, its output in the structured summary is explicitly `null`.
The downstream steps that declare an optional dependency on a skipped step receive
`null` and must handle it gracefully per `workflow.yaml` `optional: true` semantics.

## --artifact-target flag semantics

`--artifact-target {design|implementation}` is forwarded verbatim to the issue
brief and injected into the Step C and Step D agent prompts. The value scopes the
critique to design artifacts (wireframes, mockups) or implementation artifacts
(running code, screenshots). Default behaviour when the flag is absent is
implementation-agnostic review (both surfaces considered).

## Failure modes

- `BOOTSTRAP_REQUIRED` at Step 0: abort with exit `1`; user must run
  `/hive:multica-init`.
- Missing credentials or server URL: abort with a clear setup error.
- Workspace slug not found: abort with a clear workspace resolution error.
- Missing `ui-designer` agent: abort with the missing agent name.
- Multica issue `4xx` during issue resolution, brief write, or dispatch: write a
  failed marker with the transport/API notes and return a failed summary.
- Wall-clock timeout: `pollTaskUntilTerminal` cancels the active task and returns
  `status: cancelled`; write the marker.
- Transient network failures during poll: three-strike rule throws `TRANSPORT`;
  write a failure marker with `notes='polling lost connection'`.
- Completed task missing required step outputs: write a failed doc/verdict marker
  with `artifacts_committed: false` and `terminal_by_dialect: false`.

## Configuration

`hive.config.yaml`:

```yaml
design_review:
  mode: multica                           # opt-in trigger
  multica:
    poll_interval_seconds: 5             # how often to poll task state
    run_timeout_seconds: 3600            # 60 min wall-clock (4 agent calls)
    messages_capture_max: 200            # last N messages into sidecar
```

Environment override:

```sh
HIVE_DESIGN_REVIEW_MODE=multica
```

## Reuses (atomic deps)

- `hive/workflows/design-review.workflow.yaml` — architectural anchor; 4-step
  model (lines 8-81) defines the canonical step order and dependency shape.
- `hive/references/ui-prompts/design-review-design-critique.md` — step_file for
  Step C (ui-designer critique).
- `hive/references/ui-prompts/design-review-synthesis.md` — step_file for Step D
  (synthesis).
- `hive/lib/multica-story-dispatch/index.mjs` — dispatch helpers:
  - `resolveAgentUuidByName`
  - `ensureIssueBriefMatches`
  - `dispatchStoryToAgent`
  - `moveOutOfBacklogIfNeeded`
- `hive/lib/multica-story-dispatch/episode-sync.mjs` — poll plus
  `multica-run.yaml` episode writer with the doc/verdict completion dialect.
- `hive/lib/mode-resolver.mjs` — 5-tier `resolveMode('HIVE_DESIGN_REVIEW_MODE', ctx)`.
- `.pHive/multica/agents.yaml` — persona seed and provider roster; must be
  bootstrapped via `/hive:multica-init`.
- `skills/hive/skills/design-review-dispatch/SKILL.md` (dr-1) — router that
  dispatches into this atom; receives and forwards `--skip` and `--artifact-target`.

## Constraint summary

| Rule | Enforcement |
|---|---|
| Atomic skill, not inline `/design-review` prose | This file owns the selected Multica lifecycle |
| ONE Multica issue, FOUR agent() calls | Single createIssue; 4 agent() calls inside the assigned run |
| ONE episode marker capturing all 4 outputs | `multica-run.yaml` written ONCE after terminal; contrast with plan-mode-multica |
| Intentional asymmetry with d-3 | d-3 is per-persona fan-out (no workflow.yaml anchor); dr-2 mirrors workflow.yaml shape |
| workflow.yaml is the anchor | Step order, optional flags, step_files are derived from design-review.workflow.yaml:8-81 |
| --skip flag forwarded verbatim | Optional steps A+B only; required steps C+D cannot be skipped |
| --artifact-target forwarded verbatim | Injected into Steps C+D agent prompts |
| 5-tier mode resolution | `resolveMode('HIVE_DESIGN_REVIEW_MODE', ctx)` via mode-resolver.mjs |
| Bootstrap required | Resolve `ui-designer` agent before issue creation or dispatch |
| No silent fallback after selection | Setup/bootstrap failures abort the selected Multica mode |
