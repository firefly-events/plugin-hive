---
name: review-mode-cc-workflows
description: Run Hive /review through the Claude Code Workflow tool. ONE assembled Workflow script dispatches ONE solo reviewer agent() call, returns a structured verdict payload, and lets Hive write an episode marker plus return summary while the orchestrator owns commit gates. Atomic thin wrapper — SOLO reviewer only, panel-mode DEFERRED. scope_drift emit at review:complete is owned by the dispatched reviewer agent per r-1 contract.
---

# Hive Review Mode — CC Workflows

Atomic skill, NOT inline `/review` prose. Runs the `cc-workflows` review dispatch mode after
the caller (r-1 `review-dispatch`) resolves and validates the mode selection. The caller selects
this mode when `mode_decision == "cc-workflows"` and hands off the inputs below; this skill owns
the lifecycle from Workflow tool assembly through terminal episode marker and summary return.

CC Workflows review mode treats the entire review as ONE Workflow TOOL workload with ONE
`agent()` call inside. The Workflow TOOL is the deterministic script orchestrator with `agent()`
/ `pipeline()` / `phase()`; `/workflows` is only a history browser. Unlike `plan-mode-cc-workflows`
(per-persona fan-out), r-3 creates ONE Workflow run with ONE solo reviewer agent() call.

**SOLO reviewer only.** Panel-mode is explicitly out of scope — Decision Point 2 DEFERS it.
A future panel-mode atom would be a separate skill file.

This is the cc-workflows mirror of `review-mode-multica` (r-2): same solo reviewer shape and
scope_drift emit contract; substrate differs (r-2 = Multica issue; r-3 = Workflow TOOL script).

State directory: `HIVE_STATE_DIR = hive_config.paths.state_dir || ".pHive"`.

**Kickoff-gate fall-through:** if Step 0 rejects, emit a structured `precondition_failed` error
and return control to `review-dispatch`. Do not fall through silently. Fallback is the caller's
responsibility.

**All workflow agents run on the default workflow subagent (no Codex `agentType`)** — cc-workflows
is an inline-Claude substrate; the returned `<result>` IS the work product.

## Invocation contract

Called once per `/review` when r-1 returns `mode_decision == cc-workflows`.

**Inputs:**
- `arguments` — forwarded verbatim from r-1: PR number, branch name, or file paths; `--sequential`
  flag (accepted, no-op for single-agent dispatch).
- `field_sources` — resolved source map from r-1 (traceability; not operationally consumed).
- `epic_id` — parent epic identifier when known; used for episode paths.
- `hive_config` — parsed root `hive.config.yaml`, including `review.cc-workflows.*` and `paths.state_dir`.
- `integration_branch` — current epic branch/ref for shared-branch contract.
- `dispatch_kind` — `initial | follow_up | rerun | resume`, resolved by `review-dispatch`.
- `prior_reviewer_model` — null for `initial`; required for every non-initial
  dispatch and copied from the prior review marker's
  `field_sources.agent_models.Review.tier`.
- `prior_reviewer_source` — null for `initial`; required for every non-initial
  dispatch and copied from the prior review marker's
  `field_sources.agent_models.Review.source`.

Fixed call signature: `invoked with arguments, field_sources, epic_id, hive_config, integration_branch, dispatch_kind, prior_reviewer_model, prior_reviewer_source`

OUTER SEAM INVARIANT: internal `workflow_assembly` changes never affect HOW `review-dispatch` calls
this skill. The fixed call signature is the outer seam.

**Outputs:**
- Episode marker: `${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/cc-workflows-run.yaml`
- Messages sidecar: `${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/cc-workflows-run.messages.jsonl`
- Summary to `/review`: run_id, terminal status, reviewer verdict, marker paths.

## Phase 0c — 5-tier mode resolution

The caller (r-1) resolves mode before invoking this atom. Reference call:

```js
import { resolveMode } from '../../../../hive/lib/mode-resolver.mjs';

const { decision, sources } = resolveMode('HIVE_REVIEW_MODE', {
  env, rootConfig, shippedBaseline, skillOverride, default: 'auto',
});
// decision: 'cc-workflows' | 'multica' | 'sandcastle' | 'sequential' | 'auto'
```

Precedence: **env > root\_config > shipped\_baseline > skill\_override > default**.
`HIVE_REVIEW_MODE` registered in `hive/lib/mode-resolver.mjs`. Recognized: `sandcastle`,
`multica`, `cc-workflows`, `sequential`, `auto`. Unrecognized env values silently fall through.

## Process

### Step 0: Precondition gate

```js
// Worktree-isolation check — must be the first action in this gate.
import { execFileSync } from 'node:child_process';
const precondition = JSON.parse(execFileSync('python3', ['hive/lib/cc_workflows_preconditions.py'], { input: JSON.stringify({ cwd: process.cwd() }), encoding: 'utf8' }));
// Python equivalent of assertWorktreeIsolation(); this must remain first.
if (!precondition.ok) throw Object.assign(new Error(precondition.error), precondition);
```

Resolve runtime and tooling: verify CC runtime `>= 2.1.217`; read `claude --version` or proxy on
Workflow tool presence. Verify `review.mode == "cc-workflows"` OR `HIVE_REVIEW_MODE=cc-workflows`.
Resolve `${HIVE_STATE_DIR}` from `hive_config.paths.state_dir`, default `.pHive`. Confirm `arguments` present.

Runtime field resolution must preserve source attribution:

```yaml
field_sources:
  review.mode:
    source: root config | shipped baseline | env | default
    value: cc-workflows
  HIVE_REVIEW_MODE:
    source: env
    value: cc-workflows
  HIVE_STATE_DIR:
    source: root config | default
    value: .pHive
  cc_runtime:
    source: claude --version | Workflow tool presence proxy
    value: 2.1.217
```

On reject, exit with a structured error — do not dispatch:

```json
{
  "error": "precondition_failed",
  "message": "CC Workflows review mode requires runtime cc-workflows and Claude Code >= 2.1.217 or Workflow tool presence.",
  "field_sources": {}
}
```

`field_sources` citation is mandatory on every Step 0 reject (root config / shipped baseline /
env / default source per field). This is the audit trail and trigger for `review-dispatch` fallback.

### Step 1: Review Workflow dispatch (ONE run, ONE agent() call)

Phase 1 assembles ONE Workflow script containing ONE `agent()` call for the solo reviewer, invokes
the Workflow TOOL, and tracks it. Dispatch granularity is per-review: one review maps to one run.

1. **Resolve model tier before assembly.**

   Consume the `dispatch_kind`, `prior_reviewer_model`, and `prior_reviewer_source`
   values produced by r-1,
   then build the actual agent options:

   ```js
   const reviewerResolution = JSON.parse(execFileSync(
     'python3',
     ['hive/lib/cc_workflows_model_tier.py'],
     {
       input: JSON.stringify({
         persona: 'reviewer',
         config: hive_config,
         dispatch_kind,
         prior_model: prior_reviewer_model,
         prior_source: prior_reviewer_source,
       }),
       encoding: 'utf8',
     },
   ));
   const reviewerTier = reviewerResolution.tier;
   const reviewerSource = reviewerResolution.source;
   const reviewerOpts = reviewerResolution.agent_options;
   ```

   No `agent()` call may omit `opts.model`. Resolver reads `model_overrides` then `model_tiers`
   from `hive.config.yaml` — never from agent frontmatter. Unmapped agents default to `sonnet` with WARN.
   This applies to every follow-up, rerun, and resumed reviewer dispatch as well as the first call:
   call the options builder and pass `reviewerOpts` (which contains
   `model: reviewerTier`) explicitly. Non-initial dispatches preserve the prior
   marker's reviewer model even if current config or the parent model differs.
   Never rely on the resumed
   Workflow or parent session to retain/inherit reviewer model identity. Record the resolved
   `{tier, source}` for each dispatch in `field_sources.agent_models`.

2. **Brief assembly.** Derive `unit_id` from the argument (PR number, branch name, or `ad-hoc`).
   Build the Workflow script in memory:

   - One meta block; one `phase()` named `Review`; one `agent()` call.
   - **Defensive `args` parse contract**: `const a = typeof args === 'string' ? JSON.parse(args) : args;`
     at script-body top; reference all inputs via `a.<field>`.

   **Solo reviewer call** (required):

   ```text
   agent(reviewer, task=<solo review brief>, opts=reviewerOpts)
   ```

   The reviewer agent prompt must instruct the agent to:
   - obtain the review diff per r-1 argument (PR, branch, file paths — same mapping as
     `skills/review/SKILL.md` argument parsing table)
   - if argument is `#` or PR URL, verify `gh auth status` first
   - run the full solo reviewer workflow (Phase 1 of `skills/review/SKILL.md`) BOTH steps internally:
     - **Step a** — researcher scope analysis: scope, complexity, affected modules
     - **Step b** — reviewer findings: correctness, security, conventions, performance
   - return structured summary: `verdict`, `evidence_ref`, `researcher_findings`, `reviewer_findings`
   - emit `scope_drift` at `review:complete` per r-1 contract (see scope_drift contract below)
   - NOT run `git commit`, `git add`, or `git push` — orchestrator handles commits after return
   - `--sequential` accepted verbatim; no-op for single-agent dispatch

   The agent prompt MUST end with the insight-capture suffix below.

3. **Insight-capture suffix template (MANDATORY — append verbatim to the agent() prompt).**

   ```text
   INSIGHT CAPTURE (before returning your structured output)

   If you encountered any reusable lesson during this turn — a constraint that surprised you, a pattern that worked unexpectedly well, a footgun the next reviewer on this codebase will hit — append it to:

     hive/agents/memories/reviewer/<kebab-case-title>.md

   File shape (frontmatter + 3-5 line body):

   ---
   name: <kebab-case-title>
   description: <one-line summary, second-person imperative>
   applies_to: reviewer
   ---

   <2-4 lines: the lesson + why it matters. Concrete, not generic. Cite file paths or line numbers where useful.>

   Skip the capture entirely if nothing on this turn is reusable across stories. Do NOT write a memory just to satisfy this clause; empty captures pollute the memory dir. Fire-and-forget — do not block your return on the write. If the directory does not exist, create it.
   ```

4. **No Codex routing.** Every `agent()` call MUST use the default workflow subagent.

5. **Invoke the Workflow TOOL.** Capture returned `run_id` and `transcript_dir`.

6. **Track.** Record `{unit_id, run_id, transcript_dir, dispatch_started_at, review_target}` in memory.

### Step 2: Poll until terminal

Wait for the Workflow TOOL completion signal. Read and normalize:

```text
<result>  -> structured verdict payload: verdict, evidence_ref, researcher_findings, reviewer_findings
<status>  -> completed | failed | cancelled
<usage>   -> agent_count, subagent_tokens, tool_uses, duration_ms
```

Terminal mapping:

| Workflow terminal | Episode marker status |
|---|---|
| `completed` | `passed` |
| `failed` | `failed` |
| `cancelled` | `cancelled` |

If the task reports `completed` but structured result is missing `verdict` or `evidence_ref`, treat
as `failed`. Do not infer verdict from Workflow commentary or transcript.

### Step 3: Episode marker per terminal

Write ONE `cc-workflows-run.yaml` marker at:

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
role: reviewer
completion_kind: doc-verdict
artifacts_committed: true  # only when reviewer returns a valid verdict
episode_terminal: true
requires_code_push_sha: false
code_push_sha: null
terminal_by_dialect: <artifacts_committed && episode_terminal>
scope_drift_observed: true  # atom owns emit contract; reviewer agent calls emit_scope_drift at review:complete
review_target: <PR# | branch | 'staged-diff'>
started_at: <iso>
completed_at: <iso>
verdict:
  verdict: passed | needs_optimization | needs_revision
  evidence_ref: <PR comment thread URL or transcript path>
  researcher_findings: <string>
  reviewer_findings: <string>
field_sources:
  agent_models:
    Review:
      persona: reviewer
      tier: sonnet | opus | haiku
      source: model_overrides | model_tiers | default
```

`scope_drift_observed: true` — the dispatched reviewer agent calls `emit_scope_drift` at
`review:complete` inside its prompt-driven run. The Workflow TOOL result confirms the verdict fired.

Also write:

```text
${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/cc-workflows-run.messages.jsonl
```

### Step 4: Sidecar deferral

No `appends_map` — sidecar deferral is an execute-mode concern. Documented no-op kept in structure
so the skill mirrors `test-mode-cc-workflows` one-for-one for diff reviewers.

### Step 5: Return summary

```js
{
  dispatched: { unit_id, run_id, transcript_dir, dispatch_started_at, review_target },
  verdict: {
    verdict: agentSummary.verdict,        // 'passed' | 'needs_optimization' | 'needs_revision'
    evidence_ref: agentSummary.evidence_ref,
    researcher_findings: agentSummary.researcher_findings,
    reviewer_findings: agentSummary.reviewer_findings,
  },
  marker: { markerPath, messagesPath, status, terminal_by_dialect: completion.terminalByDialect },
  failed: status === 'passed' && completion.terminalByDialect ? null : { status, notes },
  run_id,
}
```

## scope_drift Emit Contract

The `scope_drift` emit at `review:complete` is the responsibility of the **reviewer agent** dispatched
inside the Workflow run. The emit contract:

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

`scope_drift_observed: true` in the marker confirms this atom owns the emit obligation per r-1
contract. This is one of exactly 3 sanctioned `emit_scope_drift` call sites. Any change is a
policy violation.

## Failure modes

- `precondition_failed` — Step 0 reject; must include `field_sources`. Triggers `review-dispatch` fallback.
- `workflow_dispatch_failed` — Workflow TOOL returned an invocation error or no `run_id` captured.
- `review_agent_failed` — reviewer agent() failed or Workflow run returned failed terminal status.
- `verdict_missing` — `completed` but missing `verdict` or `evidence_ref` in structured result.
- `episode_marker_write_failed` — marker or sidecar could not be written.
- `commit_conflict_unrecoverable` — orchestrator exhausted 3 non-fast-forward retries post-return.

Failure handling: Step 0 aborts the whole mode; verdict-missing writes a failed marker with
`artifacts_committed: false`; `run_id` and `transcript_dir` preserved in all failure branches.

## Configuration

`hive.config.yaml`:

```yaml
review:
  mode: cc-workflows
paths:
  state_dir: .pHive
```

Environment override: `HIVE_REVIEW_MODE=cc-workflows`

| Setting | Value |
|---|---|
| `execution.review_mode` | `"cc-workflows"` |
| `HIVE_REVIEW_MODE` | `cc-workflows` |
| `HIVE_STATE_DIR` | `hive_config.paths.state_dir \|\| ".pHive"` |
| Minimum CC runtime | `2.1.217` |
| Integration branch convention | `feat/<epic-id>` |

## Reuses (atomic deps)

- `hive/lib/cc_workflows_preconditions.py` — worktree-isolation precondition at Step 0.
- `hive/lib/cc_workflows_model_tier.py` — model-tier resolver; consumed at Step 1.
- `hive/lib/mode-resolver.mjs` — 5-tier `resolveMode('HIVE_REVIEW_MODE', ctx)`.
- `hive/lib/task-tracking-dispatch` — reserved for future tracker integration; not consumed in v1.
- `hive/references/episode-schema.md` — episode marker format family.
- `hive/agents/reviewer.md` — reviewer persona.
- `skills/review/SKILL.md` Phase 1 — solo reviewer pattern the dispatched agent follows internally.
- `skills/hive/skills/review-dispatch/SKILL.md` (r-1) — router; owns scope_drift emit contract declaration.

## Constraint summary

| Rule | Enforcement |
|---|---|
| Atomic skill, NOT inline `/review` prose | This file owns the CC Workflows review lifecycle |
| Workflow TOOL vs /workflows slash distinction is load-bearing | Workflow TOOL runs deterministic scripts; `/workflows` only browses history |
| SOLO reviewer only — panel-mode DEFERRED | ONE Workflow run; ONE agent() call (reviewer) |
| ONE episode marker per terminal | `cc-workflows-run.yaml` plus `.messages.jsonl` sidecar |
| scope_drift emit at review:complete owned by dispatched reviewer agent | `scope_drift_observed: true` in marker; reviewer agent instructed to emit |
| No Codex routing | Default workflow subagent only; Codex agentType forbidden |
| No-git contract enforced via reviewer prompt | Agent prompt carries "do not run git commit/add/push"; orchestrator commits after return |
| opts.model REQUIRED on every agent() call | Python model-tier resolver for `reviewer` |
| Defensive args parse contract | `const a = typeof args === 'string' ? JSON.parse(args) : args;` at script-body top |
| Insight-capture suffix on agent() prompt | Per execute-mode-cc-workflows mandatory clause; persona = reviewer |
| worktree isolation at Step 0 | Invoke `hive/lib/cc_workflows_preconditions.py`; first action |
| No fallback inside this skill | Step 0 reject returns structured error; `review-dispatch` owns fallback |
| Fixed outer seam | `arguments`, `field_sources`, `epic_id`, `hive_config`, `integration_branch`, `dispatch_kind`, `prior_reviewer_model`, `prior_reviewer_source` |
| completion_kind: doc-verdict | Review produces a verdict document, not code commits |
