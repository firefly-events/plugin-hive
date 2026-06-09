---
name: design-mode-cc-workflows
description: Run Hive /design through the Claude Code Workflow tool as per-persona dispatch. Toggle OFF = [ui-designer] (1 Workflow run). Toggle ON = [accessibility-specialist, animations-specialist, ui-designer] (3 Workflow runs, serial). One episode marker per persona. Mirrors plan-mode-cc-workflows — same Step 0/1/2/3/4/5 shape, unit of work is design persona.
---

# Hive Design Mode — CC Workflows

<!-- Mirror anchor: skills/hive/skills/plan-mode-cc-workflows/SKILL.md — per-persona serial dispatch, episode markers per persona, Step 0 precondition gate, defensive args parse contract, opts.model required. -->
<!-- Intentional substrate split: d-3 = Multica per-persona dispatch; d-4 = cc-workflows Workflow tool dispatch. Same persona set resolution from d-1 toggle, different substrate. DO NOT conflate. -->
<!-- Intentional asymmetry with dr-3: dr-3 = ONE Workflow run, FOUR agent() calls; d-4 = N Workflow runs (per-persona), N markers. No canonical design.workflow.yaml anchor. -->

Atomic skill, NOT inline `/design` prose. Runs `/design` through the cc-workflows substrate
as per-persona Workflow tool dispatch. The caller (`/design` Phase 0) selects this mode via
`design-dispatch` (d-2) and hands off the inputs below; this skill owns the lifecycle from
Workflow script assembly through terminal episode markers and summary return.

CC Workflows design mode treats each dispatched persona as one Workflow TOOL workload.
Each persona maps to exactly one Workflow run, dispatched serially. Episode markers are
written per persona. This mirrors `plan-mode-cc-workflows`'s per-persona fan-out applied to
the design substrate. Explicitly different from `design-review-mode-cc-workflows` (dr-3),
which creates ONE Workflow run with FOUR internal agent() calls.

**All workflow agents run on the default workflow subagent (no Codex `agentType`)** —
cc-workflows mode is intentionally an inline-Claude substrate so the returned `<result>` IS
the work product. `agentType: "codex:codex-rescue"` is forbidden here because it forwards to
a separate Codex CLI run and returns a status report immediately, breaking the dispatch →
immediate file-list return → episode marker write → reconcile contract.

State directory resolution follows the same rule as sibling cc-workflows skills:

```text
HIVE_STATE_DIR = hive_config.paths.state_dir || ".pHive"
```

Kickoff-gate fall-through is explicit: if the runtime precondition gate rejects this mode,
emit a structured `precondition_failed` error with `field_sources` and return control to
`design-dispatch`; do not silently fall through. Fallback is the caller's responsibility.

## Invocation contract

Called once per `/design` invocation when `mode_decision == cc-workflows` was returned by
`design-dispatch` (d-2). The trigger is either `HIVE_DESIGN_MODE=cc-workflows` or root
`hive.config.yaml` with `execution.mode: cc-workflows`.

**Inputs:**
- `arguments` — forwarded verbatim from d-2 (brief + flags).
- `include_constraints` — boolean resolved from the `--include-constraints` toggle in Phase A
  of `/design`. Controls persona set (see Step 1).
- `field_sources` — the resolved source map from d-2 (traceability only).
- `epic_handle` — parent epic identifier, used for episode paths.
- `hive_config` — parsed root `hive.config.yaml`, including `design.cc-workflows.*`,
  `task_tracking.*`, and `paths.state_dir`.
- `integration_branch` — current epic branch/ref for the shared-branch contract.
- `design_context` — brand context, topic slug, surface kind, rendition count, and any prior
  constraint artifacts.

Fixed call signature: `include_constraints, arguments, field_sources, epic_handle, hive_config, integration_branch, design_context`.

OUTER SEAM INVARIANT: any change to `workflow_assembly` for design personas affects WHAT the
assembly emits but never HOW `design-dispatch` calls into this skill.

**Outputs:**
- One episode marker per persona at
  `${HIVE_STATE_DIR}/episodes/{epic_handle}/{persona}/cc-workflows-run.yaml`.
- One messages sidecar per persona at
  `${HIVE_STATE_DIR}/episodes/{epic_handle}/{persona}/cc-workflows-run.messages.jsonl`.
- Aggregated summary returned to `/design` with per-persona run records.

## Phase 0c — 5-tier mode resolution

The caller (d-2 `design-dispatch`) resolves the mode. Precedence:
**env > root\_config > shipped\_baseline > skill\_override > default**.
`HIVE_DESIGN_MODE` registered in `hive/lib/mode-resolver.mjs`; recognized values:
`sandcastle`, `multica`, `cc-workflows`, `sequential`, `auto`.

```js
import { resolveMode } from '../../../../hive/lib/mode-resolver.mjs';
const { decision, sources } = resolveMode('HIVE_DESIGN_MODE', { env, rootConfig, shippedBaseline, skillOverride, default: 'auto' });
```

## Process

Mirrors `plan-mode-cc-workflows`: precondition gate → per-persona dispatch → terminal
polling → episode marker per persona → sidecar deferral → return. Unit of work is `design
persona`; everything else is structurally identical.

### Step 0: Precondition gate

```js
// Worktree-isolation check — must be the first action in this gate.
import { assertWorktreeIsolation } from '../../../hive/lib/cc-workflows-preconditions.mjs';
assertWorktreeIsolation(); // throws precondition_failed if cwd is not a worktree
```

Resolve runtime and tooling: verify CC runtime `>= 2.1.154`; read `claude --version` when
available; otherwise rely on Workflow tool presence as proxy. Verify `execution.mode`
resolves to `"cc-workflows"` OR `HIVE_DESIGN_MODE=cc-workflows` is set. Confirm
`include_constraints`, `design_context`, and `epic_handle` are present.

Runtime field resolution must preserve source attribution:

```yaml
field_sources:
  execution.mode:
    source: root config | shipped baseline | env | default
    value: cc-workflows
  HIVE_DESIGN_MODE:
    source: env
    value: cc-workflows
  HIVE_STATE_DIR:
    source: root config | default
    value: .pHive
  cc_runtime:
    source: claude --version | Workflow tool presence proxy
    value: 2.1.154
```

On reject, exit with a structured error and do not dispatch:

```json
{
  "error": "precondition_failed",
  "message": "CC Workflows design mode requires runtime cc-workflows and Claude Code >= 2.1.154 or Workflow tool presence.",
  "field_sources": {}
}
```

### Step 1: Resolve persona set from Phase A toggle

**Toggle OFF (default — `include_constraints === false`):**

```js
const personaSet = ['ui-designer'];
```

**Toggle ON (`include_constraints === true`):**

```js
const personaSet = ['accessibility-specialist', 'animations-specialist', 'ui-designer'];
```

Serial dispatch order: `accessibility-specialist → animations-specialist → ui-designer`.
This mirrors the Phase A pipeline order from `skills/design/SKILL.md` Phase A (a) → (b) → (c).

Maintain a `priorOutputs` map, seeded empty, that accumulates terminal results so later
personas receive earlier outputs as optional context blocks:

```js
const priorOutputs = {};  // { persona_slug: structured_result }
```

### Step 2: Per-persona dispatch (serial — one Workflow run per persona)

For each persona in `personaSet[]` (in order):

1. **Persona file load.** Read `hive/agents/<persona>.md`. If missing, fail with
   `persona_file_missing`, write a failure marker, continue with remaining personas.

2. **Brief write.** Build a design brief from `design_context`. Include `priorOutputs` as
   optional context blocks. Output targets: `accessibility-specialist` → `.pHive/design/{topic}/accessibility-constraints.md`;
   `animations-specialist` → `.pHive/design/{topic}/animations-constraints.md`;
   `ui-designer` → `.pHive/design/{topic}/v1.png`, `wireframe.f0`, `brief.md`.
   When `include_constraints=true`, ui-designer brief prepends both constraint blocks.
   All briefs include the integration branch, no-git instruction, and the insight-capture
   suffix below.

3. **Workflow script assembly.** Construct the Workflow script in memory: one meta block,
   one `phase()` named for the persona's contribution, one `agent()` call.

   **Defensive `args` parse contract (MANDATORY):**
   ```js
   const a = typeof args === 'string' ? JSON.parse(args) : args;
   ```
   Reference all inputs via `a.<field>` (NOT `args.<field>`). Mirrors the contract in
   `plan-mode-cc-workflows` Step 1.

   **`opts.model` is REQUIRED on every `agent()` call:**
   ```js
   import { resolveModelTier } from '../../../hive/lib/cc-workflows-model-tier.mjs';
   const { tier, source } = resolveModelTier(persona, { config: hive_config });
   // agent(prompt, { schema, phase, label, model: tier })
   ```
   Resolver reads `model_overrides` (runtime promotion) then `model_tiers` (base assignment)
   from `hive.config.yaml` — never from persona frontmatter. Unmapped personas default to
   `sonnet` with a WARN. Collect `{phase, persona, tier, source}` for each agent to populate
   `field_sources.agent_models` in the per-persona marker (Step 3).

   **No Codex routing.** Every `agent()` call MUST use the default workflow subagent. Do NOT
   pass `agentType: "codex:codex-rescue"` (or any other Codex `agentType`) even when
   `agent_backends[persona] == "codex"`.

   **Insight-capture suffix (MANDATORY — append verbatim to EVERY `agent()` prompt):**

   ```text
   INSIGHT CAPTURE (before returning your structured output)

   If you encountered any reusable lesson during this turn — a constraint that surprised you, a pattern that worked unexpectedly well, a footgun the next <persona> on this codebase will hit — append it to:

     hive/agents/memories/<persona>/<kebab-case-title>.md

   File shape (frontmatter + 3-5 line body):

   ---
   name: <kebab-case-title>
   description: <one-line summary, second-person imperative>
   applies_to: <persona>
   ---

   <2-4 lines: the lesson + why it matters. Concrete, not generic. Cite file paths or line numbers where useful.>

   Skip the capture entirely if nothing on this turn is reusable across stories. Do NOT write a memory just to satisfy this clause; empty captures pollute the memory dir. Fire-and-forget — do not block your return on the write. If the directory does not exist, create it.
   ```

4. **Invoke the Workflow TOOL.** Capture returned `run_id` and `transcript_dir`. This is NOT
   the `/workflows` slash command; `/workflows` is only the history browser.

5. **Track.** Record `{persona, role, run_id, transcript_dir, dispatch_started_at}` in an
   in-memory map. The map feeds Step 3 polling and Step 4 marker writes.

### Step 3: Poll until terminal (per persona)

Wait for the Workflow TOOL completion signal. A `<task-notification>` arrives on completion.

```text
<result>  -> structured design-artifact payloads (file lists, constraint docs, wireframe paths)
<status>  -> completed | failed | cancelled
<usage>   -> agent_count, subagent_tokens, tool_uses, duration_ms
```

Terminal mapping:

| Workflow terminal | Episode marker status |
|---|---|
| `completed` | `passed` |
| `failed` | `failed` |
| `cancelled` | `cancelled` |

After a persona reaches terminal, accumulate outputs for downstream personas:

```js
priorOutputs[persona] = result ?? {};
```

**Abort rules for serial chain:**
- `accessibility-specialist` fails → log warning, continue; outputs absent for downstream.
- `animations-specialist` fails → log warning, continue; outputs absent for `ui-designer`.
- `ui-designer` fails → design run is failed; surface in summary; prior markers preserved.

### Step 4: Episode marker per persona terminal

Write exactly one episode marker per persona immediately after terminal:

```text
${HIVE_STATE_DIR}/episodes/{epic_handle}/{persona}/cc-workflows-run.yaml
```

Marker shape:

```yaml
step: cc-workflows-run
persona: <persona>
epic: <epic_handle>
status: passed | failed | cancelled
workflow_run_id: <run_id>
transcript_dir: <path>
role: <e.g. accessibility-specialist | animations-specialist | ui-designer>
agentType: default
files: [{path, change}]
started_at: <iso>
completed_at: <iso>
field_sources:
  agent_models:
    <phase>:
      persona: <persona>
      tier: sonnet | opus | haiku
      source: model_overrides | model_tiers | default
```

Also write the adjacent messages sidecar:

```text
${HIVE_STATE_DIR}/episodes/{epic_handle}/{persona}/cc-workflows-run.messages.jsonl
```

The marker references large artifacts by path, including `transcript_dir`, rather than
inlining them. Mirrors `plan-mode-cc-workflows` Step 3 marker shape.

### Step 4b: Sidecar deferral

This skill does not consume an `appends_map` — sidecar deferral is an execute-mode concern.
Design is pre-execute; there is no sidecar map to defer. Documented no-op kept in the
structure so the skill mirrors `plan-mode-cc-workflows` one-for-one for diff reviewers.

## Reconciliation pattern

Structured file lists are the unit of commit attribution. The orchestrator validates returned
file lists and commits persona-by-persona on `feat/<epic-id>` in dispatch order. Persona
`failed` or `cancelled` → write marker, omit commits unless a partial write already occurred.

### Step 5: Wait for all personas to terminate, then return

Wait until every persona dispatched by this invocation has reached a terminal state or
produced a per-persona dispatch failure marker.

Return this aggregate to `/design`:

```js
{
  persona_runs: [
    {
      persona: 'accessibility-specialist',
      status: 'passed' | 'failed' | 'cancelled',
      run_id,
      transcript_dir,
      marker_path: `${hiveStateDir}/episodes/${epic_handle}/accessibility-specialist/cc-workflows-run.yaml`,
    },
    // ... animations-specialist (same shape) ...
    {
      persona: 'ui-designer',
      status: 'passed' | 'failed' | 'cancelled',
      run_id,
      transcript_dir,
      marker_path: `${hiveStateDir}/episodes/${epic_handle}/ui-designer/cc-workflows-run.yaml`,
    },
  ],
  run_id: `design-${epic_handle}-${Date.now()}`,
  include_constraints: include_constraints,
  topic: design_context.topic_slug,
  failed: persona_runs.some(r => r.persona === 'ui-designer' && r.status !== 'passed')
    ? { status: ui_designer_run.status, notes: ui_designer_run.result?.notes }
    : null,
}
```

When `include_constraints === false`, `persona_runs` contains only the `ui-designer` entry —
`accessibility-specialist` and `animations-specialist` are absent (not `status: skipped`;
absent entirely).

## Failure modes

- `precondition_failed` — Step 0 reject. Must include `field_sources` citation. Triggers
  `design-dispatch` fallback.
- `persona_file_missing` — `hive/agents/<persona>.md` missing; record as failed, write
  failure marker, continue with remaining personas.
- `workflow_dispatch_failed` — Workflow TOOL returned an invocation error or no `run_id`.
- `persona_agent_failed` — persona's Workflow agent call failed or returned failed terminal.
- `commit_conflict_unrecoverable` — orchestrator post-return exhausted 3 retries.
- `episode_marker_write_failed` — marker or `.messages.jsonl` sidecar could not be written.

## Configuration

`hive.config.yaml`:

```yaml
execution:
  mode: cc-workflows
paths:
  state_dir: .pHive
```

Environment override:

```sh
HIVE_DESIGN_MODE=cc-workflows
```

| Setting | Value |
|---|---|
| `execution.mode` | `"cc-workflows"` |
| `HIVE_DESIGN_MODE` | `cc-workflows` |
| `HIVE_STATE_DIR` | `hive_config.paths.state_dir \|\| ".pHive"` |
| Minimum CC runtime version | `2.1.154` |
| Integration branch convention | `feat/<epic-id>` |

## Reuses (atomic deps)

- `hive/lib/cc-workflows-preconditions.mjs` — `assertWorktreeIsolation()` called at Step 0.
- `hive/lib/cc-workflows-model-tier.mjs` — model-tier resolver; consumed at Step 2 for
  every `agent()` call.
- `hive/lib/mode-resolver.mjs` — 5-tier `resolveMode('HIVE_DESIGN_MODE', ctx)`.
- `hive/lib/task-tracking-dispatch/` — reserved for future per-persona tracker integration.
- `hive/references/episode-schema.md` — episode marker format family.
- `hive/references/wireframe-protocol.md` — forwarded to ui-designer prompt.
- `hive/agents/accessibility-specialist.md` — persona dispatched when toggle ON.
- `hive/agents/animations-specialist.md` — persona dispatched when toggle ON.
- `hive/agents/ui-designer.md` — persona dispatched in all paths.
- `skills/hive/skills/plan-mode-cc-workflows/SKILL.md` — mirror anchor; same precondition
  gate, defensive `args` parse contract, episode marker schema family, and aggregate shape.

Key references:

- `skills/hive/skills/design-mode-multica/SKILL.md` (d-3) — shape mirror; same persona set
  from d-1 toggle, different substrate.
- `skills/hive/skills/design-dispatch/SKILL.md` (d-2) — router that dispatches here;
  receives and forwards `--include-constraints`.
- `skills/design/SKILL.md` — parent skill; Phase 0 hands off here when
  `mode_decision == cc-workflows`.
- `skills/hive/skills/design-review-mode-cc-workflows/SKILL.md` (dr-3) — cc-workflows
  substrate reference; intentional asymmetry: ONE Workflow run, FOUR agent() calls vs
  d-4's N Workflow runs, N markers.
- `hive/references/episode-schema.md` — episode marker format.

## Constraint summary

| Rule | Enforcement |
|---|---|
| Atomic skill, NOT inline `/design` prose | This file owns the CC Workflows design lifecycle |
| Workflow TOOL vs /workflows slash command distinction is load-bearing | Workflow TOOL runs deterministic scripts; `/workflows` only browses history |
| Per-persona dispatch — toggle dictates persona count | Toggle OFF = [ui-designer]; Toggle ON = [accessibility-specialist, animations-specialist, ui-designer] |
| ONE Workflow run per persona | N runs, N markers; mirrors plan-mode-cc-workflows per-persona fan-out |
| ONE episode marker per persona | `cc-workflows-run.yaml` per persona slug as unit_id |
| Serial within dispatch | accessibility → animations → ui-designer; each polled to terminal before next dispatches |
| Prior persona outputs flow forward | animations receives accessibility result; ui-designer receives both |
| Skill does NOT run git commit/add/push | Orchestrator commits after return from file-list payloads |
| No Codex routing in cc-workflows mode | Every `agent()` call uses the default workflow subagent; no Codex agentType |
| opts.model REQUIRED on every agent() call | resolveModelTier() from cc-workflows-model-tier.mjs for every persona |
| Defensive args parse contract | `const a = typeof args === 'string' ? JSON.parse(args) : args;` at script-body top |
| Insight-capture suffix on every agent() prompt | Persona-substituted; mandatory on each dispatched agent |
| assertWorktreeIsolation() at Step 0 | Import from `hive/lib/cc-workflows-preconditions.mjs`; must be first action |
| 5-tier mode resolution | `resolveMode('HIVE_DESIGN_MODE', ctx)` via mode-resolver.mjs |
| No fallback design mode inside this skill | Step 0 reject returns structured `precondition_failed`; `design-dispatch` owns fallback |
| ui-designer failure = run failure | Prior constraint persona markers preserved; summary flags failed |
| Fixed outer seam | `include_constraints`, `arguments`, `field_sources`, `epic_handle`, `hive_config`, `integration_branch`, `design_context` |
