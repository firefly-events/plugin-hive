---
name: test-mode-cc-workflows
description: Run Hive simulated-manual test scenarios through the Claude Code Workflow tool. One assembled Workflow script dispatches a scenario to the default workflow subagent, returns a structured verdict payload, and lets Hive write episode markers plus a return summary while the orchestrator owns user-facing review gates.
---

# Hive Test Mode — CC Workflows

Atomic skill, NOT inline `/test` prose. Runs the `cc-workflows` test dispatch mode for a simulated-manual scenario. The caller (the `test-dispatch` router plus `/test` Phase 0) selects this mode when `mode_decision == "cc-workflows"` and hands off the inputs below; this skill owns the lifecycle from CC Workflow tool assembly through terminal episode markers and summary return.

CC Workflows test mode treats each simulated-manual scenario as a Workflow TOOL workload. The Workflow TOOL is the deterministic script orchestrator with `agent()` / `pipeline()` / `parallel()` / `phase()`; `/workflows` is only a history browser for running and completed workflows. Hive owns dispatch, polling, episode markers, and returning a test summary to `/test`; the Workflow tool owns subagent scheduling and transcript capture.

This is the test-side mirror of `plan-mode-cc-workflows`. The two skills share the same precondition gate, episode-marker schema family (`cc-workflows-run.yaml`), defensive `args` parse contract, and Workflow tool invocation pattern; what differs is the unit of work (scenario, not persona) and the artifact produced (verdict written to story YAML `manual_verdict`, not a planning document).

Dispatch granularity is per-scenario (architect-resolved Q3 in design-discussion §3): scenarios are the natural episode-marker unit. Per-persona dispatch would force artificial splits incompatible with the `manual_verdict` verdict schema. Each scenario maps to exactly one Workflow run, one episode marker, and one messages sidecar.

State directory resolution follows the same rule as the plan-mode CC Workflows skill:

```text
HIVE_STATE_DIR = hive_config.paths.state_dir || ".pHive"
```

All episode markers, messages sidecars, transcript references, and run summaries are rooted under that resolved state dir unless the Workflow tool returns an absolute transcript path.

Kickoff-gate fall-through behavior is explicit: if the runtime precondition gate rejects this mode, emit a structured `precondition_failed` error with `field_sources` and return control to `test-dispatch`; do not silently fall through to direct natural-language spawn, Codex, or Multica test paths. Fallback to those paths is the caller's responsibility and is gated on this skill returning a structured rejection, not on a silent partial dispatch.

Delegation rules: the orchestrator coordinates Workflow script assembly, Workflow invocation, polling, episode marker writes, and summary return; it does not run scenarios itself. Workflow agents execute the assigned scenario steps and return structured verdict payloads. Scenario behavior is loaded from the canonical `loadScenario(scenario_path)` result; do not improvise inline scenarios. **All workflow agents run on the default workflow subagent (no Codex `agentType`)** — cc-workflows mode is intentionally an inline-Claude substrate so the returned `<result>` IS the verdict payload. Codex routing belongs to other test paths; cc-workflows mode is an inline-Claude substrate and intentionally does not overlap.

**Gate ownership invariant.** Test agents dispatched here execute scenarios and return a verdict payload to the orchestrator; the orchestrator (`/test`) is the canonical owner of every story-YAML `manual_verdict` write. Agents MUST NOT mutate story YAMLs in-place. Agents never advance user review gates either. The orchestrator still presents and waits locally at any downstream review gate. Workflow tool completion is a verdict-readiness signal, not user review approval.

Reference spine: `skills/hive/skills/plan-mode-cc-workflows/SKILL.md` (atom mirror) and `skills/hive/skills/test-mode-multica/SKILL.md` (per-scenario dispatch precedent). The anchors in those files establish that the Workflow tool is the substrate; per-scenario episode-marker unit; and structured-result capture is in place.

## Invocation contract

Called once per `/test <story-id|scenario-file>` invocation when the test dispatch resolver selected `mode_decision == cc-workflows`. The legacy `--simulated-manual` flag was removed in t-1b; the current `/test` entry contract no longer carries it.

The resolver lives in `test-dispatch` Step 0 and mirrors the execute-dispatch resolver shape:

- `HIVE_TEST_MODE=cc-workflows` selects this skill with source `env`.
- root `hive.config.yaml` with `test.mode: cc-workflows` selects this skill with source `config` when the environment variable is unset.
- Any other value falls through to the existing test path (multica, local simulated-manual).
- Env wins over config.

On selection, `/test` resolves the story and scenario exactly as it already does, then routes here instead of spawning direct natural-language spawn, Multica, or local-executor test runs.

**Inputs:**
- `scenario_path` — repo-relative path to the canonical simulated-manual scenario.
- `scenario` — parsed `loadScenario(scenario_path)` result; must use the reconciled canonical shape from mpt-2.
- `story` — story YAML object that owns the scenario verdict.
- `story_path` — repo-relative path to the owning story YAML.
- `epic_handle` — parent epic identifier, used for episode paths and integration-branch context.
- `story_id` — owning story identifier, used for episode paths.
- `hive_config` — parsed root `hive.config.yaml`, including `test.cc-workflows.*`, `task_tracking.*`, and `paths.state_dir`.
- `integration_branch` — current epic branch/ref (`feat/<epic-id>`). Test agents do not commit the verdict independently; the orchestrator handles story-YAML verdict writes after this skill returns the agent file-list payloads.

Fixed call signature:

```text
invoked with scenario_path, scenario, story, story_path, epic_handle, story_id, hive_config, integration_branch
```

OUTER SEAM INVARIANT: any change to `workflow_assembly` for test agents affects WHAT the assembly emits but never HOW `test-dispatch` calls into this skill. This fixed call signature is the outer seam; downstream wiring through `/test` reads this contract and does not branch on internal workflow_assembly shape.

**Outputs:**
- A `verdict` payload returned to the orchestrator (see the aggregated return object below). The orchestrator — not this skill — writes `manual_verdict` onto the owning story YAML on the integration branch. The verdict payload shape is:

  ```yaml
  manual_verdict:
    scenario_ref: <scenario_path>
    verdict: pass | fail | inconclusive
    timestamp: "<ISO-8601 timestamp>"
    agent: tester
  ```

- One episode marker per dispatched scenario at `${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/cc-workflows-run.yaml`.
- One messages sidecar at `${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/cc-workflows-run.messages.jsonl`.
- Aggregated return object to `test-dispatch`:

```js
{
  dispatched: {
    story_id,
    scenario_path,
    run_id,
    transcript_dir,
    dispatch_started_at,
  },
  verdict: {
    scenario_ref: scenario_path,
    verdict: 'pass' | 'fail' | 'inconclusive',
    timestamp,
    agent: 'tester',
  },
  marker: {
    markerPath,
    messagesPath,
    status,
  },
  failed: null | { status, notes },
  run_id,
}
```

`test-dispatch` uses this summary to attribute final scenario outcomes and emit INFO logs. `/test` then reads the story YAML `manual_verdict` block to confirm the verdict is committed.

Gate ownership stays in `/test`: this skill never advances any user review or sign-off gate.

## Process

CC Workflows test mode runs the scenario through the Workflow TOOL. The dispatch is per-scenario and serial: assemble the Workflow script for the scenario, invoke the Workflow tool, poll to terminal, write the episode marker and messages sidecar, then return the summary. This bounds runtime pressure while retaining the Workflow tool's deterministic script surface.

The process below mirrors `plan-mode-cc-workflows`: precondition gate, per-scenario dispatch, terminal polling, one episode marker per scenario, sidecar deferral, then summary return. The unit of work is `scenario` (not `persona`); the episode marker uses the same `cc-workflows-run.yaml` filename family.

### Step 0: Precondition gate

```js
// Worktree-isolation check — must be the first action in this gate.
// Rejects before any field resolution if the skill is not running inside
// a `.claude/worktrees/<name>/` checkout.
import { assertWorktreeIsolation } from '../../../hive/lib/cc-workflows-preconditions.mjs';
assertWorktreeIsolation(); // throws precondition_failed if cwd is not a worktree
```

Resolve runtime and tooling before dispatching the scenario: verify CC runtime version `>= 2.1.154`; read `claude --version` when available; otherwise rely on Workflow tool presence as proxy. Verify `test.mode` resolves to `"cc-workflows"` OR `HIVE_TEST_MODE=cc-workflows` is set. Resolve `${HIVE_STATE_DIR}` from `hive_config.paths.state_dir`, then default to `.pHive`, and confirm `scenario_path`, `scenario`, `story`, and `story_path` are present.

Runtime field resolution must preserve source attribution:

```yaml
field_sources:
  test.mode:
    source: root config | shipped baseline | env | default
    value: cc-workflows
  HIVE_TEST_MODE:
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
  "message": "CC Workflows test mode requires runtime cc-workflows and Claude Code >= 2.1.154 or Workflow tool presence.",
  "field_sources": {}
}
```

The `field_sources` citation is mandatory on every Step 0 reject. It must show which source was consulted: root config, shipped baseline, env, or default. This is the audit trail for why the kickoff gate rejected the selected mode.

### Step 1: Per-scenario dispatch (serial — Phase 1)

Phase 1 dispatches the scenario via the Workflow tool. Dispatch granularity is per-scenario: one scenario maps to exactly one Workflow run.

1. **Scenario load verify.**
   - Confirm the `scenario` payload is the reconciled canonical shape from `loadScenario(scenario_path)`. If the canonical shape is missing or stale, fail the run with a structured dispatch error (`scenario_shape_invalid`) before touching the Workflow tool.

2. **Brief write.**
   - Build a test brief from `scenario.description`, `scenario.steps`, `story.title`, `story_path`, the integration branch, and the canonical simulated-manual executor contract at `hive/workflows/steps/test/simulated-manual.md`.
   - The brief must instruct the workflow agent to:
     - verify the checkout is on `integration_branch` before executing the scenario
     - load `scenario_path` through `loadScenario` and follow the canonical scenario shape
     - follow `hive/workflows/steps/test/simulated-manual.md` exactly
     - write the verdict to `story_path` under `manual_verdict` with `agent: tester`
     - not run `git commit`, `git add`, or `git push` — the orchestrator handles story-YAML verdict commits after this skill returns the file-list payload
   - Include the required no-git instruction: test agents do not commit; the orchestrator handles writes after this skill returns the file-list payload.

3. **Clone / verify.**
   - Require verification of the expected checkout before scenario execution. The requested ref is the integration branch, conventionally `feat/<epic-id>`.
   - Agents report observed checkout path, branch, and scenario file availability; verification failure maps to `failed` and still writes a marker.

4. **Dispatch: `workflow_assembly` plus Workflow tool invocation.**
   - Construct the Workflow tool script in memory: one meta block, one `phase()` named for the scenario (e.g. `SimulatedManual`), and one `agent()` call for the test agent.
   - **No Codex routing inside cc-workflows mode.** Every `agent()` call MUST use the default workflow subagent — do NOT pass `agentType: "codex:codex-rescue"` (or any other Codex `agentType`) even when `agent_backends` would route the tester agent to Codex in other modes. The cc-workflows substrate runs each agent INLINE within the Claude orchestrator so that the returned `<result>` IS the verdict payload, not a pointer to out-of-band work.
   - **`opts.model` is REQUIRED on every `agent()` call.** Before assembling the Workflow script, import and call the model-tier resolver for the tester role:
     ```js
     import { resolveModelTier } from 'hive/lib/cc-workflows-model-tier.mjs';
     const { tier, source } = resolveModelTier('tester', { config: hive_config });
     // assembled agent() call must carry opts.model:
     // agent(prompt, { schema, phase, label, model: tier })
     ```
     No `agent()` call may omit `opts.model`. The resolver reads `model_overrides` (runtime promotion) then `model_tiers` (base assignment) from `hive.config.yaml` — never from agent frontmatter. Unmapped agents default to `sonnet` with a WARN. Collect `{phase, role: 'tester', tier, source}` to populate `field_sources.agent_models` in the episode marker (Step 3).
   - **Defensive `args` parse contract.** Every assembled script MUST begin its body with `const a = typeof args === 'string' ? JSON.parse(args) : args;` and reference inputs via `a.<field>` (NOT `args.<field>`). The Workflow tool surface does not guarantee that the `args` global arrives as a parsed object when invoked from an orchestrator whose tool-call parameters are string-typed. Mirror the same contract documented in `plan-mode-cc-workflows` Step 1 — both skills share the same Workflow tool seam.
   - Invoke the Workflow TOOL with the assembled script.
   - Capture returned `run_id` and `transcript_dir`. This is not the `/workflows` slash command; `/workflows` is the history browser.

5. **Track.**
   - Record `{scenario_path, story_id, run_id, transcript_dir, dispatch_started_at}` in-memory.
   - The map feeds Step 2 polling and Step 3 marker writes.

The dispatch remains a single Workflow run per skill invocation. Do not advance to later `/test` phases inside this skill; `/test` owns phase advancement.

### Step 2: Poll until terminal

Wait for the Workflow TOOL completion signal. A `<task-notification>` arrives on completion with structured `<result>`, `<status>`, `<usage>`, an output file path, and a transcript directory.

Read and normalize:

```text
<result>  -> structured verdict payload including manual_verdict block, file list, and notes
<status>  -> completed | failed | cancelled
<usage>   -> agent_count, subagent_tokens, tool_uses, duration_ms
```

Terminal mapping:

| Workflow terminal | Episode marker status |
|---|---|
| `completed` | `passed` |
| `failed` | `failed` |
| `cancelled` | `cancelled` |

After the Workflow task reaches terminal, read `story_path` from the updated shared-branch checkout and verify the canonical verdict block exists:

```yaml
manual_verdict:
  scenario_ref: <scenario_path>
  verdict: pass | fail | inconclusive
  timestamp: "<ISO-8601 timestamp>"
  agent: tester
```

If the Workflow task reports `completed` but the story YAML is missing `manual_verdict`, has no verdict, or records any agent other than `tester`, treat the run as `failed`. Surface a notes string that names the missing or invalid field. Do not infer a verdict from the Workflow result commentary or transcript — only the story YAML `manual_verdict` block is authoritative.

### Step 3: Episode marker per scenario terminal

Receive structured file lists from the test agent:

```json
{ "files": [{ "path": "path/to/story.yaml", "change": "modified" }], "timestamp": "2026-06-07T00:00:00Z" }
```

After this skill returns, the orchestrator reconciles story-YAML verdict writes onto the integration branch. This skill's responsibility is the marker + sidecar — the orchestrator owns `git add`, `git commit`, and `git push` per the SERIAL-COMMIT GATE contract shared with `plan-mode-cc-workflows`.

Write exactly one episode marker per scenario run at:

```text
${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/cc-workflows-run.yaml
```

Marker shape:

```yaml
step: cc-workflows-run
scenario_path: <scenario_path>
story_id: <story_id>
epic: <epic_handle>
status: passed | failed | cancelled
workflow_run_id: <run_id>
transcript_dir: <path>
role: tester
files: [{path, change}]
started_at: <iso>
completed_at: <iso>
manual_verdict:
  scenario_ref: <scenario_path>
  verdict: pass | fail | inconclusive
  timestamp: <iso>
  agent: tester
field_sources:
  agent_models:
    SimulatedManual:
      role: tester
      tier: sonnet | opus | haiku
      source: model_overrides | model_tiers | default
```

`field_sources.agent_models` records the resolved model tier for the dispatched test agent keyed by phase label (matching the `phase()` label in the Workflow script). This enables post-run audit tooling to confirm the test agent ran at the intended tier. The `source` field traces whether the tier came from `model_overrides` (runtime promotion), `model_tiers` (base assignment), or the unmapped `default` (always `sonnet` with WARN). Mirrors the same field documented in `plan-mode-cc-workflows` Step 3 marker shape.

The marker references the scenario as the unit (not a persona). It uses the same `cc-workflows-run.yaml` filename family as `plan-mode-cc-workflows` and `execute-mode-cc-workflows` so downstream consumers (run-status event stream, etc.) can pattern-match a single emit shape.

Also write the adjacent messages sidecar:

```text
${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/cc-workflows-run.messages.jsonl
```

The marker references large artifacts by path, including `transcript_dir`, rather than inlining them. Terminal values are `passed`, `failed`, and `cancelled`.

### Step 4: Sidecar deferral

This skill does not consume an `appends_map` — sidecar deferral is an execute-mode concern (review-phase append routing for stories). Test is pre-integrate; there is no sidecar map to defer. If a future test concern requires per-scenario sidecar injection, add it here as a Phase 2 extension; for now this step is a documented no-op kept in the structure so the skill mirrors `plan-mode-cc-workflows` one-for-one for diff reviewers.

### Step 5: Return summary

Wait until the dispatched scenario has reached a terminal state or has produced a dispatch failure marker.

This skill does NOT update task tracker per scenario — test scenarios do not have tracker records in the way stories do. If a future test workflow ships scenario-level tracker integration, route through the vendor-neutral `task-tracking-dispatch.invoke("updateStatus", ...)` ABI; do not fork it for test mode.

Return this aggregate to `test-dispatch`:

```js
{
  dispatched: {
    story_id,
    scenario_path,
    run_id,
    transcript_dir,
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
  },
  failed: status === 'passed' ? null : { status, notes },
  run_id,
}
```

`test-dispatch` uses this summary to attribute final scenario outcomes and emit INFO logs. `/test` then reads the verdict block to determine pass/fail and advances its own flow accordingly.

## Failure modes

- `precondition_failed` — Step 0 reject. Must include `field_sources` citation showing root config, shipped baseline, env, or default source consulted for each rejected field. Triggers `test-dispatch` fallback.
- `scenario_shape_invalid` — `loadScenario(scenario_path)` returned a stale or invalid shape. Record as failed before Workflow dispatch.
- `workflow_dispatch_failed` — Workflow TOOL returned an invocation error or no `run_id` could be captured.
- `test_agent_failed` — the scenario's required Workflow agent call failed or returned a failed terminal status.
- `verdict_missing` — Workflow task reported `completed` but the story YAML `manual_verdict` block is absent, has no verdict, or records an agent other than `tester`.
- `commit_conflict_unrecoverable` — orchestrator post-return exhausted 3 non-fast-forward retries or encountered an unresolvable rebase conflict on a story-YAML verdict commit.
- `episode_marker_write_failed` — marker or `.messages.jsonl` sidecar could not be written for a scenario terminal.

Failure handling: Step 0 aborts the whole mode; verdict-missing failures write a failed marker; known `run_id` and `transcript_dir` values are preserved; marker write failures return the intended marker path.

## Configuration

`hive.config.yaml`:

```yaml
test:
  mode: cc-workflows
paths:
  state_dir: .pHive
```

Environment override:

```sh
HIVE_TEST_MODE=cc-workflows
```

Runtime and branch configuration:

| Setting | Value |
|---|---|
| `test.mode` | `"cc-workflows"` |
| `HIVE_TEST_MODE` | `cc-workflows` |
| `HIVE_STATE_DIR` | `hive_config.paths.state_dir \|\| ".pHive"` |
| Minimum CC runtime version | `2.1.154` |
| Integration branch convention | `feat/<epic-id>` |

Runtime source priority is resolver-owned (`test-dispatch` Step 0), but every reject must report the consulted source in `field_sources`. Test agent routing uses `hive/lib/cc-workflows-model-tier.mjs`; the behavior contract follows `hive/workflows/steps/test/simulated-manual.md`.

## Reuses (atomic deps)

- `hive/lib/cc-workflows-preconditions.mjs` — `assertWorktreeIsolation()` called at Step 0.
- `hive/lib/cc-workflows-model-tier.mjs` — model-tier resolver; consumed at Step 1 for every `agent()` call.
- `hive/lib/scenarios/load.mjs` — canonical `loadScenario(path)` validator; must succeed before dispatch.
- `hive/workflows/steps/test/simulated-manual.md` — canonical executor contract the test agent must follow.
- `hive/references/episode-schema.md` — episode marker format family.

Key references:

- `skills/hive/skills/plan-mode-cc-workflows/SKILL.md` — atom mirror target; same Workflow tool invocation pattern, same episode marker schema family, same precondition gate structure.
- `skills/hive/skills/test-mode-multica/SKILL.md` — per-scenario dispatch precedent; same verdict schema and `manual_verdict` contract.
- `skills/hive/skills/test-dispatch/SKILL.md` — caller; routes `mode_decision == cc-workflows` to this skill and consumes the Step 5 summary return.
- `skills/hive/skills/execute-mode-cc-workflows/SKILL.md` — substrate seam mirror; defensive `args` parse contract, episode marker schema family, and aggregate return shape are intentionally shared.
- `hive/references/episode-schema.md` — episode marker format.

## Constraint summary

| Rule | Enforcement |
|---|---|
| Atomic skill, NOT inline /test or test-dispatch prose | This file owns the CC Workflows test lifecycle for selected mode |
| Workflow TOOL vs /workflows slash command distinction is load-bearing | Workflow TOOL runs deterministic scripts; `/workflows` only browses history |
| Dispatch granularity is per-scenario | Q3 RESOLVED by architect — scenarios are the natural episode-marker unit |
| Skill does NOT advance user review/sign-off gates | `/test` owns all gate advancement |
| Skill does NOT run git commit/add/push | Orchestrator commits after return from file-list payloads |
| No Codex routing in cc-workflows mode | Every `agent()` call uses the default workflow subagent; Codex `agentType` is forbidden |
| No-git contract enforced via prompt | Default workflow subagent prompts carry an explicit "do not run git commit/add/push" instruction |
| Defensive `args` parse contract is mandatory | `const a = typeof args === 'string' ? JSON.parse(args) : args;` at script-body top |
| Target line count: 330-360 lines | Keep this skill compact but complete |
| Markdown level-2 headers for steps | Preserve the verbatim header list used by plan-mode-cc-workflows |
| Code fences for YAML snippets and shell-snippet excerpts | Required for marker and attribution contracts |
| One marker per scenario per run | `cc-workflows-run.yaml` plus `.messages.jsonl` sidecar |
| Fixed outer seam | `scenario_path`, `scenario`, `story`, `story_path`, `epic_handle`, `story_id`, `hive_config`, `integration_branch` |
| No fallback test mode inside this skill | Step 0 reject returns structured `precondition_failed`; `test-dispatch` owns fallback |
| Canonical verdict home | Test agent writes story-YAML `manual_verdict`, not cycle-state or episode marker |
| Canonical agent name | `manual_verdict.agent: tester` — resolve model tier for `tester` role |
