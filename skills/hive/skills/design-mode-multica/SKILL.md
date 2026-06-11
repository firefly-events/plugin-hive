---
name: design-mode-multica
description: Run Hive /design through Multica as per-persona dispatch within a team-cell. One Multica issue per persona; one episode marker per persona. Toggle OFF = ui-designer only (1 issue). Toggle ON = accessibility-specialist → animations-specialist → ui-designer (3 issues). Serial within the team-cell. Mirrors execute-mode-multica per-persona precedent — intentionally different from dr-2 (single-run 4-step shape).
---

# Hive Design Mode — Multica

<!-- Mirror anchor: skills/hive/skills/execute-mode-multica/SKILL.md — per-persona dispatch within team-cell, episode markers per persona, serial within team-cell. -->
<!-- Intentional asymmetry: d-3 = per-persona fan-out (N issues, N markers). dr-2 = ONE issue, FOUR agent() calls. DO NOT conflate. See design-discussion §6 Q10 resolution. -->

Atomic skill, NOT inline `/design` prose. Runs `/design` through the Multica
substrate as per-persona dispatch within a team-cell. The caller (`/design`
Phase 0) selects this mode via `design-dispatch` (d-2) and hands off the inputs
below; this skill owns the lifecycle from per-persona issue creation to terminal
episode markers.

Multica design mode treats each dispatched persona as one Multica issue. Each
persona (accessibility-specialist, animations-specialist, ui-designer) maps to
exactly one issue, dispatched serially. Episode markers are written per persona.
This is the **execute-mode-multica per-persona precedent** applied to the design
substrate. It is explicitly different from `design-review-mode-multica` (dr-2),
which creates ONE Multica issue with FOUR internal agent() calls anchored to
`design-review.workflow.yaml:8-81`.

**Why per-persona instead of a single issue?** `/design` has no
`design.workflow.yaml` canonical anchor. The `--include-constraints` toggle
determines which personas run. Per-persona dispatch gives clean per-persona
traceability and failure isolation matching execute-mode-multica's per-story
precedent. This is the Q10 resolution in design-discussion §6.

## State directory

```js
const hiveStateDir = hive_config?.paths?.state_dir ?? '.pHive';
```

## Invocation contract

Called once per `/design` invocation when `mode_decision == multica` was returned
by `design-dispatch` (d-2). The trigger is either:

- `HIVE_DESIGN_MODE=multica`
- root `hive.config.yaml` with `execution.design_mode: multica`

**Inputs:**
- `arguments` — forwarded verbatim from d-2: the design brief string plus any
  flags (`--topic`, `--renditions`, `--include-constraints`, `--from-plan`).
- `include_constraints` — boolean resolved from the `--include-constraints` toggle
  in Phase A of `/design`. Controls persona set (see Step 1).
- `field_sources` — the resolved source map from d-2 (traceability only).
- `epic_handle` — parent epic identifier, used for episode paths.
- `hive_config` — parsed root `hive.config.yaml`, including
  `design.multica.*`, `task_tracking.multica.*`, and `paths.state_dir`.
- `integration_branch` — current epic branch/ref for the shared-branch contract.
- `design_context` — brand context, topic slug, surface kind, rendition count,
  and any prior constraint artifacts (when re-running against an existing topic).

**Outputs:**
- One Multica issue per dispatched persona (labels: []).
- One episode marker per persona at
  `${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/multica-run.yaml`
  where `{unit_id}` is the persona slug (e.g. `ui-designer`).
- One messages sidecar per persona at
  `${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/multica-run.messages.jsonl`.
- Aggregated summary returned to `/design` with per-persona run records.

## Phase 0c — 5-tier mode resolution

The caller (d-2 `design-dispatch`) resolves the mode before invoking this atom.
The canonical resolver call for reference:

```js
import { resolveMode } from '../../../../hive/lib/mode-resolver.mjs';

const { decision, sources } = resolveMode('HIVE_DESIGN_MODE', {
  env,             // raw 'HIVE_DESIGN_MODE=multica' token or undefined
  rootConfig,      // parsed root hive.config.yaml
  shippedBaseline, // additive slot — falls through when absent
  skillOverride,   // additive slot — falls through when absent
  default: 'auto',
});
// decision: 'multica' | 'sandcastle' | 'cc-workflows' | 'sequential' | 'auto'
// sources: { env?: string } | { root_config?: string } | ... (winning tier only)
```

Precedence: **env > root\_config > shipped\_baseline > skill\_override > default**.

`HIVE_DESIGN_MODE` is registered in `hive/lib/mode-resolver.mjs`. Recognized mode
strings: `sandcastle`, `multica`, `cc-workflows`, `sequential`, `auto`.
Unrecognized env values are silently ignored and resolution falls through.

## Process

### Step 0: Precondition gate

Resolve Multica connection settings before touching any persona:

1. Read `task_tracking.multica.server_url` from `hive_config`.
2. If missing, read `~/.multica/config.json` `server_url`.
3. If still missing, read `MULTICA_SERVER_URL`.
4. Read the PAT from `MULTICA_TOKEN` or `~/.multica/config.json` `token`.
5. Resolve the workspace UUID:
   - call `GET /api/workspaces`
   - find the workspace whose `slug` matches the configured workspace slug
   - use the workspace `id` for all subsequent issue and agent calls

On `BOOTSTRAP_REQUIRED`, abort immediately with stderr:

```text
ERROR: Multica design mode requires bootstrapped agents.
       Run /hive:multica-init to create them, then retry.
       (agent missing in workspace <slug>: <persona-name>)
```

Exit `1`. Do NOT fall back to the inline design path after a selected Multica
mode fails its bootstrap gate. Do NOT fall back silently.

When the precondition gate fails, emit a structured rejection:

```js
{
  code: 'precondition_failed',
  reason: '<connection | bootstrap | workspace>',
  remediation: 'Run /hive:multica-init or verify MULTICA_SERVER_URL / MULTICA_TOKEN.',
}
```

Exit `1` immediately after emitting.

### Step 1: Resolve persona set from Phase A toggle

The persona set is determined by the `--include-constraints` toggle resolved
in Phase A of `/design` before this atom was called.

**Toggle OFF (default — `include_constraints === false`):**

```js
const personaSet = ['ui-designer'];
```

One persona, one Multica issue.

**Toggle ON (`include_constraints === true`):**

```js
const personaSet = ['accessibility-specialist', 'animations-specialist', 'ui-designer'];
```

Three personas, three Multica issues. Dispatch order is serial:
`accessibility-specialist → animations-specialist → ui-designer`.

This ordering is intentional: animations-specialist receives the
accessibility notes as optional input context, and ui-designer receives
both as prepended constraint blocks in its brief. This mirrors the Phase A
pipeline order from `skills/design/SKILL.md` Phase A steps (a) → (b) → (c).

**Q10 contract (one issue per persona — locked):** Do NOT collapse personas
into a single bundled issue. Per-persona issue creation is the default and
gives clean per-persona traceability matching the per-persona episode marker
shape. This default mirrors `execute-mode-multica`'s per-story precedent.

Resolve each persona agent UUID before dispatch (throws `BOOTSTRAP_REQUIRED`
if any agent is missing — Step 0 catches this and aborts):

```js
import { resolveAgentUuidByName } from '../../../../hive/lib/multica-story-dispatch/index.mjs';

const personaAgentUuids = {};
for (const persona of personaSet) {
  personaAgentUuids[persona] = await resolveAgentUuidByName(
    serverUrl, token, workspaceId, persona,
  );
}
```

### Step 2: Per-persona serial dispatch within team-cell

Dispatch personas **serially** in `personaSet` order. Dispatch persona N,
poll to terminal (Step 2.4), write the episode marker (Step 2.5), then
advance to persona N+1. Serial dispatch is the v1 contract — it keeps Multica
daemon load bounded, makes failure isolation trivial, and allows downstream
personas to consume prior persona outputs as optional context.

Maintain a `priorOutputs` map, seeded empty, that accumulates terminal notes
from completed personas so later personas receive them as input blocks:

```js
const priorOutputs = {};  // { persona_slug: terminal.notes }
```

For each persona in `personaSet[]` (in order):

#### Step 2.1: Issue resolution

1. Derive the unit slug: the persona slug (e.g. `ui-designer`).
2. Derive the issue title: `{topic} - {persona-slug} design` where `topic`
   comes from `design_context.topic_slug`.
3. Create one Multica issue:
   ```js
   const { issueUuid, identifier } = await createStory({
     title: `${topic} - ${persona} design`,
     body: '<brief placeholder — will be filled at step 2.3>',
     labels: [],
   });
   ```
   `labels: []` — no issue labels, matching `execute-mode-multica` and
   `review-mode-multica` convention.
4. Capture the new `issueUuid` and `identifier` for this persona.

#### Step 2.2: Backlog kick

```js
await moveOutOfBacklogIfNeeded(serverUrl, token, workspaceId, issueUuid);
```

This ensures the issue is not stranded in backlog state before assignment.

#### Step 2.3: Brief write

Render a persona-specific brief. The brief must instruct the assigned agent to:

- check out `integration_branch` from the plugin-hive repo:
  ```sh
  multica repo checkout https://github.com/firefly-events/plugin-hive --ref "${integration_branch}"
  ```
- read its persona file from `hive/agents/{persona}.md`
- execute its design task for `design_context.topic_slug` using the
  `design_context` payload (brand context, surface kind, brief, rendition count)
- include prior persona outputs as optional context blocks (see per-persona brief
  shapes below)
- write its outputs to `.pHive/design/{topic}/` under the prescribed path
- return a structured summary in `terminal.notes` containing output paths and
  key findings

**Per-persona brief shapes (key differences):**

- `accessibility-specialist`: brief + brand context; WCAG 2.1 AA advisory pass;
  output → `.pHive/design/{topic}/accessibility-constraints.md`.
- `animations-specialist`: brief + brand context + `priorOutputs['accessibility-specialist']`
  as optional input; motion/animation advisory pass;
  output → `.pHive/design/{topic}/animations-constraints.md`.
- `ui-designer`: brief + brand context + rendition count +
  `hive/references/wireframe-protocol.md`; when `include_constraints=true`,
  prepend accessibility and animations constraint blocks from `priorOutputs`;
  outputs → `.pHive/design/{topic}/v1.png`, `wireframe.f0`, `brief.md`.

All three briefs include:
- Checkout instruction: `multica repo checkout ... --ref "${integration_branch}"`.
- Persona file reference: `hive/agents/{persona}.md`.
- Insight capture suffix: write one memory at `hive/agents/memories/{persona}/`
  capturing one non-obvious finding from this design pass.

After rendering the brief:

```js
await ensureIssueBriefMatches(serverUrl, token, workspaceId, issueUuid, brief);
```

#### Step 2.4: Dispatch to persona agent

```js
import { dispatchStoryToAgent } from '../../../../hive/lib/multica-story-dispatch/index.mjs';

await dispatchStoryToAgent(serverUrl, token, workspaceId, issueUuid, personaAgentUuids[persona]);
```

Record:

```js
{
  persona,
  issueUuid,
  identifier,
  agentUuid: personaAgentUuids[persona],
  dispatch_started_at: new Date().toISOString(),
}
```

Emit:

```text
[info] design multica dispatch: persona={persona} issue={identifier} topic={topic}
```

#### Step 2.5: Poll until terminal

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
    process.stderr.write(`[multica-design:${persona}] ${prev} → ${next}\n`);
  },
});
```

Configuration:

- `maxWallClockMs` from `hive_config.design.multica.run_timeout_seconds * 1000`.
- Default `maxWallClockMs` is `1_800_000` (30 minutes per persona).
- `pollIntervalMs` from `hive_config.design.multica.poll_interval_seconds * 1000`.
- Default `pollIntervalMs` is `5_000`.
- `messagesCaptureMax` from `hive_config.design.multica.messages_capture_max`.
- Default `messagesCaptureMax` is `200`.

Terminal status mapping (owned by the poll helper):

| Multica terminal | Episode marker status |
|---|---|
| `completed` | `passed` |
| `failed` | `failed` |
| `cancelled` | `cancelled` |

Transport failure after three consecutive polling errors is caught and written
as a failed marker. Continue to the next persona unless the failed persona is
a hard prerequisite (see Step 3 abort rules).

#### Step 2.6: Episode marker per persona

Write one `multica-run.yaml` marker per persona immediately after terminal:

```js
const { markerPath, messagesPath, status, notes } = await writeMulticaRunEpisode({
  hiveStateDir,
  epicHandle: epic_handle,
  storyId: persona,        // persona slug is the unit_id for this atom
  issueUuid,
  identifier,
  terminal,
  messagesCaptureMax,
});
```

The marker path is:

```text
${HIVE_STATE_DIR}/episodes/{epic_handle}/{persona}/multica-run.yaml
```

The messages sidecar path is:

```text
${HIVE_STATE_DIR}/episodes/{epic_handle}/{persona}/multica-run.messages.jsonl
```

After writing the marker, accumulate the terminal notes for downstream personas:

```js
priorOutputs[persona] = terminal.notes ?? '';
```

This allows `animations-specialist` to receive `accessibility-specialist`
notes, and `ui-designer` to receive both constraint outputs as baked-in
context blocks.

#### Step 2.7: Abort rules for serial chain

- `accessibility-specialist` fails → log warning, continue; notes absent for
  downstream personas.
- `animations-specialist` fails → log warning, continue; notes absent for
  `ui-designer`.
- `ui-designer` fails → design run is failed; surface in summary; prior markers
  preserved.

### Step 3: Wait for all personas to reach terminal

The serial dispatch loop (Step 2) ensures this naturally — each persona is
polled to terminal before the next dispatches. After the loop exits, every
persona has either a written episode marker or a dispatch failure record.
Collect persona run records for the aggregated summary.

### Step 4: Aggregate and return

Return to `/design`:

```js
{
  persona_runs: [
    {
      persona: 'accessibility-specialist',
      status: 'passed' | 'failed' | 'cancelled' | 'skipped',
      issueUuid,
      identifier,
      marker_path: `${hiveStateDir}/episodes/${epic_handle}/accessibility-specialist/multica-run.yaml`,
      evidence_ref: null,        // UI design: no code artifact; constraint doc is the output
    },
    {
      persona: 'animations-specialist',
      // same shape
    },
    {
      persona: 'ui-designer',
      status: 'passed' | 'failed' | 'cancelled',
      issueUuid,
      identifier,
      marker_path: `${hiveStateDir}/episodes/${epic_handle}/ui-designer/multica-run.yaml`,
      evidence_ref: null,
    },
  ],
  run_id: `design-${epic_handle}-${Date.now()}`,
  include_constraints: include_constraints,
  topic: design_context.topic_slug,
  failed: persona_runs.some(r => r.persona === 'ui-designer' && r.status !== 'passed')
    ? { status: ui_designer_run.status, notes: ui_designer_run.terminal?.notes }
    : null,
}
```

When `include_constraints === false`, `persona_runs` contains only the
`ui-designer` entry — `accessibility-specialist` and `animations-specialist`
are absent (not `status: skipped`; absent entirely).

## Failure modes

- `BOOTSTRAP_REQUIRED` at Step 0: exit `1`; run `/hive:multica-init`. No fallback to inline design.
- `precondition_failed` (connection/workspace): emit structured rejection; exit `1`.
- Missing persona agent at Step 0: abort with agent name; do not reach Step 2.
- Multica `4xx` per persona: write failed marker; continue (unless `ui-designer`).
- Wall-clock timeout: `pollTaskUntilTerminal` cancels + returns `status=cancelled`; write marker; continue.
- Transport failures: three-strike `TRANSPORT`; failed marker `notes='polling lost connection'`.
- `ui-designer` non-passed terminal: overall run `failed`; prior persona markers preserved.

## Configuration

`hive.config.yaml`:

```yaml
design:
  mode: multica                        # opt-in trigger
  multica:
    poll_interval_seconds: 5           # how often to poll task state
    run_timeout_seconds: 1800          # 30 min wall-clock per persona
    messages_capture_max: 200          # last N messages into sidecar
```

Environment override:

```sh
HIVE_DESIGN_MODE=multica
```

## Reuses (atomic deps)

- `hive/adapters/multica/index.ts` — issue CRUD via dispatch ABI:
  - `createStory` — create the per-persona issue
  - `getStory` — fetch by tracker_id when already known
- `hive/lib/multica-story-dispatch/index.mjs` — dispatch helpers:
  - `resolveAgentUuidByName`
  - `serializeStoryBrief` (extended for persona brief shapes above)
  - `ensureIssueBriefMatches`
  - `dispatchStoryToAgent`
  - `moveOutOfBacklogIfNeeded`
- `hive/lib/multica-story-dispatch/episode-sync.mjs` — poll plus
  `multica-run.yaml` episode writer.
- `hive/lib/mode-resolver.mjs` — 5-tier `resolveMode('HIVE_DESIGN_MODE', ctx)`.
- `hive/references/episode-schema.md` — canonical marker schema.
- `hive/agents/accessibility-specialist.md` — persona dispatched when toggle ON.
- `hive/agents/animations-specialist.md` — persona dispatched when toggle ON.
- `hive/agents/ui-designer.md` — persona dispatched in all paths.
- `.pHive/multica/agents.yaml` — persona seed and provider roster; must be
  bootstrapped via `/hive:multica-init`.
- `skills/hive/skills/execute-mode-multica/SKILL.md` — mirror anchor (per-persona
  dispatch within team-cell, episode markers per persona, serial within team-cell).

## Constraint summary

| Rule | Enforcement |
|---|---|
| Atomic skill, not inline `/design` prose | This file owns the Multica design lifecycle |
| Per-persona dispatch — NOT single-run | Each persona = one issue; mirrors execute-mode-multica per-story precedent |
| ONE issue per persona (Q10 locked) | Three issues when toggle ON; one when toggle OFF; no single-bundled issue |
| ONE episode marker per persona | `multica-run.yaml` per persona slug as unit_id |
| Serial within team-cell | accessibility → animations → ui-designer; each polled to terminal before next dispatches |
| --include-constraints toggle dictates persona count | Toggle OFF = [ui-designer]; Toggle ON = [accessibility-specialist, animations-specialist, ui-designer] |
| Prior persona outputs flow forward | animations receives accessibility notes; ui-designer receives both as optional context |
| labels: [] | No issue labels, matching execute-mode-multica + review-mode-multica convention |
| 5-tier mode resolution | `resolveMode('HIVE_DESIGN_MODE', ctx)` via mode-resolver.mjs |
| Bootstrap required before issue creation | All persona agents resolved at Step 0; abort on BOOTSTRAP_REQUIRED |
| No silent fallback after selection | Setup/bootstrap failures exit 1; do NOT fall back to inline design |
| Intentional asymmetry with dr-2 | dr-2 = ONE issue, FOUR internal agent() calls, ONE marker; d-3 = N issues, N markers (per-persona fan-out) |
| ui-designer failure = run failure | Prior constraint persona markers preserved; summary flags failed |
