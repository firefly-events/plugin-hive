---
name: design-review-mode-cc-workflows
description: Run Hive design-review workflow through the Claude Code Workflow tool. ONE assembled Workflow script dispatches FOUR sequential agent() calls matching design-review.workflow.yaml:8-81 (accessibility → animations → ui-designer-critique → ui-designer-synthesis), ONE episode marker capturing all four outputs. Direct cc-workflows substrate mirror of dr-2 (design-review-mode-multica).
---

# Hive Design Review Mode — CC Workflows

<!-- Architectural anchor: hive/workflows/design-review.workflow.yaml:8-81 -->
<!-- Intentional substrate split: dr-2 = Multica single-issue dispatch; dr-3 = cc-workflows Workflow tool dispatch. Same 4-step model, different substrate. DO NOT conflate. -->

Atomic skill, NOT inline `/design-review` prose. Runs the `cc-workflows` design-review
dispatch mode after the caller has resolved and validated the design artifacts. The caller
selects this mode via `design-review-dispatch/SKILL.md` (dr-1) when `mode_decision ==
"cc-workflows"` and hands off the inputs below; this skill owns the lifecycle from Workflow
tool assembly through terminal episode marker and summary return.

CC Workflows design-review mode treats the entire 4-step workflow as ONE Workflow TOOL
workload with FOUR sequential `agent()` calls internally. The Workflow TOOL is the
deterministic script orchestrator with `agent()` / `pipeline()` / `phase()`; `/workflows`
is only a history browser. Unlike `plan-mode-cc-workflows` (per-persona fan-out), dr-3
creates ONE Workflow run whose script drives FOUR agent() calls in the order defined by
`hive/workflows/design-review.workflow.yaml`:

1. `accessibility-specialist` — accessibility critique (optional step A)
2. `animations-specialist` — animations critique (optional step B; receives accessibility output)
3. `ui-designer` critique — design critique using
   `hive/references/ui-prompts/design-review-design-critique.md` (required step C)
4. `ui-designer` synthesis — synthesis using
   `hive/references/ui-prompts/design-review-synthesis.md` (required step D, depends on
   all prior outputs)

This 4-step sequential model preserves the `design-review.workflow.yaml` shape exactly.

State directory resolution follows the same rule as sibling cc-workflows skills:

```text
HIVE_STATE_DIR = hive_config.paths.state_dir || ".pHive"
```

All episode markers, messages sidecars, and run summaries are rooted under that resolved
state dir unless the Workflow tool returns an absolute transcript path.

Kickoff-gate fall-through behavior is explicit: if the runtime precondition gate rejects
this mode, emit a structured `precondition_failed` error with `field_sources` and return
control to `design-review-dispatch`; do not silently fall through to Multica or sequential
design-review paths. Fallback is the caller's responsibility.

**All workflow agents run on the default workflow subagent (no Codex `agentType`)** —
cc-workflows mode is intentionally an inline-Claude substrate so the returned `<result>`
IS the work product. Codex routing belongs to other dispatch modes.

## Invocation contract

Called once per `/design-review` invocation when the dispatch resolver selected
`mode_decision == cc-workflows`.

The resolver lives in `design-review-dispatch` Step 0 and mirrors the execute-dispatch
resolver shape:

- `HIVE_DESIGN_REVIEW_MODE=cc-workflows` selects this skill with source `env`.
- root `hive.config.yaml` with `design_review.mode: cc-workflows` selects this skill with
  source `config` when the environment variable is unset.
- Any other value falls through to the existing design-review path (multica, sequential).
- Env wins over config.

**Inputs:**
- `workflow_path` — path to `hive/workflows/design-review.workflow.yaml`.
- `unblocked_stories[]` — design-review stories at the current dispatch tick.
- `appends_map` — `{story_id: [sidecar_agent_name, ...]}` (logged; v1 DEFERRED).
- `epic_handle` — parent epic identifier, used for episode paths.
- `hive_config` — parsed root `hive.config.yaml`, including `design_review.cc-workflows.*`,
  `task_tracking.*`, and `paths.state_dir`.
- `integration_branch` — current epic branch/ref for the shared-branch contract.
- `design_artifacts` — the artifact payload (URLs, file paths, or inline content) passed
  through to the agent prompts. Forwarded verbatim.
- `--skip` flag state — a list of step IDs to skip (e.g. `--skip accessibility`,
  `--skip animations`). Forwarded verbatim.
- `--artifact-target` flag value — `design | implementation`; forwarded verbatim to the
  agent prompts so the ui-designer critique targets the right surface.

**Outputs:**
- One episode marker at
  `${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/cc-workflows-run.yaml`
  where `{unit_id}` is the design-review unit identifier (e.g. story ID).
- One messages sidecar at
  `${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/cc-workflows-run.messages.jsonl`.
- Summary returned to `/design-review` with the Workflow run ID, terminal status, and
  marker paths.

## Process

### Step 0: Precondition gate

```js
// Worktree-isolation check — must be the first action in this gate.
// Rejects before any field resolution if the skill is not running inside
// a `.claude/worktrees/<name>/` checkout.
import { execFileSync } from 'node:child_process';
const precondition = JSON.parse(execFileSync('python3', ['hive/lib/cc_workflows_preconditions.py'], { input: JSON.stringify({ cwd: process.cwd() }), encoding: 'utf8' }));
// Python equivalent of assertWorktreeIsolation(); this must remain first.
if (!precondition.ok) throw Object.assign(new Error(precondition.error), precondition);
```

Resolve runtime and tooling before dispatching any design-review work: verify CC runtime
version `>= 2.1.154`; read `claude --version` when available; otherwise rely on Workflow
tool presence as proxy. Verify `design_review.mode` resolves to `"cc-workflows"` OR
`HIVE_DESIGN_REVIEW_MODE=cc-workflows` is set. Resolve `${HIVE_STATE_DIR}` from
`hive_config.paths.state_dir`, then default to `.pHive`, and confirm `workflow_path`,
`design_artifacts`, and `unblocked_stories[]` are present.

5-tier resolution call for this mode:

```js
import { resolveMode } from '../../../../hive/lib/mode-resolver.mjs';

const { decision, sources } = resolveMode('HIVE_DESIGN_REVIEW_MODE', {
  env,             // raw 'HIVE_DESIGN_REVIEW_MODE=cc-workflows' token or undefined
  rootConfig,      // parsed root hive.config.yaml
  shippedBaseline, // additive slot — falls through when absent
  skillOverride,   // additive slot — falls through when absent
  default: 'auto',
});
// decision: 'cc-workflows' | 'multica' | 'sandcastle' | 'sequential' | 'auto'
// sources: { env?: string } | { root_config?: string } | ... (winning tier only)
```

Precedence: **env > root\_config > shipped\_baseline > skill\_override > default**.

Runtime field resolution must preserve source attribution:

```yaml
field_sources:
  design_review.mode:
    source: root config | shipped baseline | env | default
    value: cc-workflows
  HIVE_DESIGN_REVIEW_MODE:
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
  "message": "CC Workflows design-review mode requires runtime cc-workflows and Claude Code >= 2.1.154 or Workflow tool presence.",
  "field_sources": {}
}
```

The `field_sources` citation is mandatory on every Step 0 reject. It must show which source
was consulted: root config, shipped baseline, env, or default.

### Step 1: Design-review Workflow dispatch (ONE run, FOUR agent() calls)

Phase 1 assembles ONE Workflow script containing FOUR sequential `agent()` calls in
`design-review.workflow.yaml:8-81` order, invokes the Workflow tool, and tracks it. This
is the intentional contrast with `plan-mode-cc-workflows`'s per-persona fan-out: the entire
design-review 4-step sequence is ONE Workflow run.

1. **Resolve model tiers for all four roles before assembly.**

   ```js
   const { tier: accessTier, source: accessSource } = JSON.parse(execFileSync('python3', ['hive/lib/cc_workflows_model_tier.py'], { input: JSON.stringify({ persona: 'accessibility-specialist', config: hive_config }), encoding: 'utf8' }));
   // Python equivalent of resolveModelTier('accessibility-specialist', { config: hive_config }).
   const { tier: animTier, source: animSource } = JSON.parse(execFileSync('python3', ['hive/lib/cc_workflows_model_tier.py'], { input: JSON.stringify({ persona: 'animations-specialist', config: hive_config }), encoding: 'utf8' }));
   // Python equivalent of resolveModelTier('animations-specialist', { config: hive_config }).
   const { tier: criTier, source: criSource } = JSON.parse(execFileSync('python3', ['hive/lib/cc_workflows_model_tier.py'], { input: JSON.stringify({ persona: 'ui-designer', config: hive_config }), encoding: 'utf8' }));
   // Python equivalent of resolveModelTier('ui-designer', { config: hive_config }).
   const { tier: synTier, source: synSource } = JSON.parse(execFileSync('python3', ['hive/lib/cc_workflows_model_tier.py'], { input: JSON.stringify({ persona: 'ui-designer', config: hive_config }), encoding: 'utf8' }));
   ```

   No `agent()` call may omit `opts.model`. The resolver reads `model_overrides` (runtime
   promotion) then `model_tiers` (base assignment) from `hive.config.yaml` — never from
   agent frontmatter. Unmapped agents default to `sonnet` with a WARN.

2. **Brief assembly.**

   Build the Workflow script in memory:

   - One meta block.
   - One `phase()` named `DesignReview` containing four sequential `agent()` calls.
   - **Defensive `args` parse contract**: the script body MUST begin with
     `const a = typeof args === 'string' ? JSON.parse(args) : args;` and reference all
     inputs via `a.<field>`.

   **Step A — accessibility critique** (optional; skip if `--skip accessibility`):

   ```text
   agent(accessibility-specialist, task=<workflow step accessibility-critique task>,
         inputs={a.design_artifacts}, opts.model=accessTier)
   ```

   Log `[info] skipping accessibility step — --skip accessibility` and set
   `accessibility_critique = null` when skipped. The agent prompt MUST end with the
   insight-capture suffix below.

   **Step B — animations critique** (optional; skip if `--skip animations`):

   ```text
   agent(animations-specialist, task=<workflow step animations-critique task>,
         inputs={a.design_artifacts, accessibility_critique (if present)},
         opts.model=animTier)
   ```

   Log `[info] skipping animations step — --skip animations` and set
   `animations_critique = null` when skipped. The agent prompt MUST end with the
   insight-capture suffix below.

   **Step C — ui-designer critique** (required):

   ```text
   agent(ui-designer, task=<design-review-design-critique.md>,
         inputs={a.design_artifacts, accessibility_critique, animations_critique,
                 a.artifact_target},
         step_file=hive/references/ui-prompts/design-review-design-critique.md,
         opts.model=criTier)
   ```

   `a.artifact_target` is forwarded verbatim from `--artifact-target`. The agent prompt
   MUST end with the insight-capture suffix below.

   **Step D — ui-designer synthesis** (required):

   ```text
   agent(ui-designer, task=<design-review-synthesis.md>,
         inputs={accessibility_critique, animations_critique, design_critique,
                 a.artifact_target},
         step_file=hive/references/ui-prompts/design-review-synthesis.md,
         opts.model=synTier)
   ```

   `a.artifact_target` is forwarded verbatim. The agent prompt MUST end with the
   insight-capture suffix below.

3. **Insight-capture suffix template (MANDATORY — append verbatim to EACH agent() prompt).**

   Persona substitution: replace `<persona>` with the agent's role name (e.g.
   `accessibility-specialist`, `animations-specialist`, `ui-designer`).

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

4. **No Codex routing inside cc-workflows mode.** Every `agent()` call MUST use the
   default workflow subagent — do NOT pass `agentType: "codex:codex-rescue"` (or any
   other Codex `agentType`). The cc-workflows substrate runs each agent INLINE within
   the Claude orchestrator so that the returned `<result>` IS the work product.

5. **Invoke the Workflow TOOL.** Capture returned `run_id` and `transcript_dir`. This is
   not the `/workflows` slash command; `/workflows` is the history browser.

6. **Track.** Record `{unit_id, run_id, transcript_dir, dispatch_started_at, skip_flags,
   artifact_target}` in memory. This feeds Step 2 polling and Step 3 marker writes.

Record model tier attribution for the episode marker:

```yaml
field_sources:
  agent_models:
    DesignReview/accessibility-specialist:
      role: accessibility-specialist
      tier: <resolved tier>
      source: model_overrides | model_tiers | default
    DesignReview/animations-specialist:
      role: animations-specialist
      tier: <resolved tier>
      source: model_overrides | model_tiers | default
    DesignReview/ui-designer-critique:
      role: ui-designer
      tier: <resolved tier>
      source: model_overrides | model_tiers | default
    DesignReview/ui-designer-synthesis:
      role: ui-designer
      tier: <resolved tier>
      source: model_overrides | model_tiers | default
```

### Step 2: Poll until terminal

Wait for the Workflow TOOL completion signal. A `<task-notification>` arrives on completion
with structured `<result>`, `<status>`, `<usage>`, an output file path, and a transcript
directory.

Read and normalize:

```text
<result>  -> structured design-review payload including all four step outputs
<status>  -> completed | failed | cancelled
<usage>   -> agent_count, subagent_tokens, tool_uses, duration_ms
```

Terminal mapping:

| Workflow terminal | Episode marker status |
|---|---|
| `completed` | `passed` |
| `failed` | `failed` |
| `cancelled` | `cancelled` |

After the Workflow task reaches terminal, verify the structured result contains at minimum:

- `design_critique` — non-null (required step C)
- `synthesis` — non-null (required step D; `review_verdict` + `review_summary`)
- `accessibility_critique` — null iff `--skip accessibility` was passed, otherwise present
- `animations_critique` — null iff `--skip animations` was passed, otherwise present

If the task reports `completed` but the structured result is missing any required field,
treat the run as failed. Surface a notes string naming the missing field. Do not infer
outputs from Workflow tool commentary or transcript.

### Step 3: Episode marker

Write ONE `cc-workflows-run.yaml` marker capturing all four agent() outputs. This single
marker is the intentional contrast with `plan-mode-cc-workflows`'s one-marker-per-persona
shape.

```text
${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/cc-workflows-run.yaml
```

Marker shape:

```yaml
step: cc-workflows-run
unit_id: <unit_id>
epic: <epic_handle>
status: passed | failed | cancelled
workflow_run_id: <run_id>
transcript_dir: <path>
completion_kind: doc-verdict
artifacts_committed: true  # only when required steps C+D outputs are present
episode_terminal: true     # when marker status is terminal
requires_code_push_sha: false
code_push_sha: null
terminal_by_dialect: <artifacts_committed && episode_terminal>
skip_flags: []             # e.g. ['accessibility']
artifact_target: null      # e.g. 'design'
started_at: <iso>
completed_at: <iso>
outputs:
  accessibility_critique: <string | null>
  animations_critique: <string | null>
  design_critique: <string>
  synthesis: <string>
field_sources:
  agent_models:
    DesignReview/accessibility-specialist:
      role: accessibility-specialist
      tier: sonnet | opus | haiku
      source: model_overrides | model_tiers | default
    DesignReview/animations-specialist:
      role: animations-specialist
      tier: sonnet | opus | haiku
      source: model_overrides | model_tiers | default
    DesignReview/ui-designer-critique:
      role: ui-designer
      tier: sonnet | opus | haiku
      source: model_overrides | model_tiers | default
    DesignReview/ui-designer-synthesis:
      role: ui-designer
      tier: sonnet | opus | haiku
      source: model_overrides | model_tiers | default
```

Also write the adjacent messages sidecar:

```text
${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/cc-workflows-run.messages.jsonl
```

The marker references large artifacts by path, including `transcript_dir`, rather than
inlining them.

### Step 4: Sidecar deferral

`appends_map` is logged and deferred. Design-review does not have a post-review story
sidecar append contract in v1. If a future design-review concern requires sidecar injection,
add it here as a Phase 2 extension; for now this step is a documented no-op kept in the
structure so the skill mirrors `test-mode-cc-workflows` one-for-one for diff reviewers.

### Step 5: Aggregate return

Return to `/design-review`:

```js
{
  dispatched: {
    unit_id,
    run_id,
    transcript_dir,
    dispatch_started_at,
    skip_flags,
    artifact_target,
  },
  outputs: {
    accessibility_critique: agentResult.accessibility_critique,  // null if skipped
    animations_critique: agentResult.animations_critique,        // null if skipped
    design_critique: agentResult.design_critique,
    synthesis: agentResult.synthesis,
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

## --skip flag semantics

The `--skip` flag is forwarded from the caller (dr-1) verbatim. Each recognized skip value
suppresses exactly one optional workflow step:

| Flag value | Suppressed step | Step requirement |
|---|---|---|
| `accessibility` | Step A (accessibility-critique) | optional per workflow.yaml |
| `animations` | Step B (animations-critique) | optional per workflow.yaml |

Unrecognized skip values are logged as a warning and ignored:

```text
[warn] design-review-mode-cc-workflows: unknown --skip value "{value}" — ignored
```

Required steps C (design-critique) and D (synthesis) cannot be skipped. If the caller
passes `--skip design-critique` or `--skip synthesis`, log the warning and proceed with
those steps unchanged.

When a step is skipped, the agent() call is omitted from the Workflow script and its output
in the result payload is explicitly `null`. Downstream steps that declare an optional
dependency on a skipped step receive `null` and must handle it gracefully per
`workflow.yaml` `optional: true` semantics.

## --artifact-target flag semantics

`--artifact-target {design|implementation}` is forwarded verbatim and injected into the
Step C and Step D agent prompts via `a.artifact_target`. The value scopes the critique to
design artifacts (wireframes, mockups) or implementation artifacts (running code,
screenshots). Default behaviour when the flag is absent is implementation-agnostic review
(both surfaces considered).

## Failure modes

- `precondition_failed` — Step 0 reject. Must include `field_sources` citation showing
  root config, shipped baseline, env, or default source consulted for each rejected field.
  Triggers `design-review-dispatch` fallback.
- `workflow_dispatch_failed` — Workflow TOOL returned an invocation error or no `run_id`
  could be captured.
- `design_review_agent_failed` — one of the four required agent() calls failed or the
  Workflow run reported a failed terminal status.
- `required_output_missing` — Workflow task reported `completed` but the structured result
  is missing `design_critique` or `synthesis`.
- `episode_marker_write_failed` — marker or `.messages.jsonl` sidecar could not be written
  for the terminal.

Failure handling: Step 0 aborts the whole mode; output-missing failures write a failed
marker with `artifacts_committed: false` and `terminal_by_dialect: false`; known `run_id`
and `transcript_dir` values are preserved in all failure branches.

## Configuration

`hive.config.yaml`:

```yaml
design_review:
  mode: cc-workflows
paths:
  state_dir: .pHive
```

Environment override:

```sh
HIVE_DESIGN_REVIEW_MODE=cc-workflows
```

## Reuses (atomic deps)

- `hive/workflows/design-review.workflow.yaml` — architectural anchor; 4-step model
  (lines 8-81) defines the canonical step order and dependency shape.
- `hive/references/ui-prompts/design-review-design-critique.md` — step_file for Step C.
- `hive/references/ui-prompts/design-review-synthesis.md` — step_file for Step D.
- `hive/lib/cc_workflows_preconditions.py` — worktree-isolation precondition called at Step 0.
- `hive/lib/cc_workflows_model_tier.py` — model-tier resolver; consumed at Step 1 for
  all four `agent()` calls.
- `hive/lib/mode-resolver.mjs` — 5-tier `resolveMode('HIVE_DESIGN_REVIEW_MODE', ctx)`.
- `skills/hive/skills/design-review-dispatch/SKILL.md` (dr-1) — router that dispatches
  into this atom; receives and forwards `--skip` and `--artifact-target`.

Key references:

- `skills/hive/skills/design-review-mode-multica/SKILL.md` (dr-2) — shape mirror;
  same 4-step model, different substrate (Multica issue dispatch instead of Workflow tool).
- `skills/hive/skills/test-mode-cc-workflows/SKILL.md` — cc-workflows substrate reference;
  same precondition gate, episode-marker schema family, defensive args parse contract.
- `skills/hive/skills/plan-mode-cc-workflows/SKILL.md` — cc-workflows substrate reference
  for model-tier resolver and args parse contract.
- `hive/references/episode-schema.md` — episode marker format family.

## Constraint summary

| Rule | Enforcement |
|---|---|
| Atomic skill, NOT inline `/design-review` prose | This file owns the cc-workflows design-review lifecycle |
| Workflow TOOL vs /workflows slash command distinction is load-bearing | Workflow TOOL runs deterministic scripts; `/workflows` only browses history |
| ONE Workflow run, FOUR agent() calls | Single Workflow script; 4 agent() calls inside one `phase()` |
| ONE episode marker capturing all 4 outputs | `cc-workflows-run.yaml` written ONCE after terminal |
| workflow.yaml is the anchor | Step order, optional flags, step_files derived from design-review.workflow.yaml:8-81 |
| --skip flag forwarded verbatim | Optional steps A+B only; required steps C+D cannot be skipped |
| --artifact-target forwarded verbatim | Injected into Steps C+D agent prompts via `a.artifact_target` |
| 5-tier mode resolution | `resolveMode('HIVE_DESIGN_REVIEW_MODE', ctx)` via mode-resolver.mjs |
| worktree isolation at Step 0 | Invoke `hive/lib/cc_workflows_preconditions.py`; must be first action |
| No Codex routing | Zero `agentType` literals in code blocks; zero `codex:codex-rescue` references; zero `agent_backends` keys |
| opts.model REQUIRED on every agent() call | Python model-tier resolver for all 4 roles |
| Defensive args parse contract | `const a = typeof args === 'string' ? JSON.parse(args) : args;` at script-body top |
| Insight-capture suffix on every agent() prompt | Per execute-mode-cc-workflows mandatory clause; persona substituted per call |
| completion_kind: doc-verdict | Design-review produces a verdict document, not code commits |
| No fallback design-review mode inside this skill | Step 0 reject returns structured `precondition_failed`; dr-1 owns fallback |
