---
name: test-mode-actual
description: Run Hive live-walk scenarios through the actual-manual vision-cursor tier. Ensures the MLX Qwen sidecar is ready, loads the scenario and overlay, invokes the am-4 flow-runner executor, collects the per-step hybrid V&V report, and writes the story manual_verdict.
---

# Hive Test Mode - Actual

Atomic skill, NOT inline `/test` prose. Runs the actual-manual test mode for
`/test` after the caller has resolved and validated a `live-walk` scenario and
`mode_decision == actual`. The caller selects this mode and hands off the inputs
below; this skill owns the lifecycle from sidecar readiness through per-step
execution to the terminal episode marker.

Structural mirror of `skills/hive/skills/test-mode-multica/SKILL.md`. The key
difference: this mode runs locally — no Multica dispatch, no polling, no external
tester agent. The vision-cursor parent executor (am-4) drives the live app
directly via Playwright + MLX Qwen grounding.

This skill is hard-gated on the prior layer work:

- am-2 overlay schema and loader (`hive/lib/actual-manual/bindings.mjs`) must be
  present; a missing overlay file fails before execution.
- am-3 `live-walk` mode must be added to `loadScenario`; a `mode:live-walk`
  scenario must load without an integrate-marker gate.
- am-4 flow-runner bridge (`hive/lib/actual-manual/flow-runner.mjs`) must be
  present; this skill invokes it and does not reimplement locate/verify/truth.
- am-5 MLX Qwen sidecar lifecycle (`hive/lib/actual-manual/mlx_sidecar.py`) must
  be present; this skill calls its readiness probe before execution.

## Invocation contract

Called once per `/test` invocation when the test dispatch resolver selected
`mode_decision == actual`.

The resolver is intentionally thin and mirrors `/execute` and `/plan`:

- `HIVE_TEST_MODE=actual` selects this skill with source `env`.
- Root `hive.config.yaml` with `test.mode: actual` selects this skill with
  source `config` when the environment variable is unset.
- Any other value is ignored by this mode and falls through.
- Env wins over config.

On selection, `/test` resolves the story and scenario exactly as it already does:

1. If the argument is a story ID, read
   `.pHive/epics/{epic_handle}/stories/{story_id}.yaml` and extract
   `manual_verdict.scenario_ref`.
2. If the argument is a path, load that path directly.
3. Call `loadScenario(path)` from `hive/lib/scenarios/load.mjs`; the scenario must
   carry `mode: live-walk`.

**Inputs:**
- `scenario_path` — repo-relative path to the live-walk scenario.
- `scenario` — parsed `loadScenario(scenario_path)` result (`mode: live-walk`).
- `overlay_path` — repo-relative path to the flow-bindings overlay for this
  scenario (derived from `scenario_path` by convention or explicit field).
- `story` — story YAML object that owns the scenario verdict.
- `story_path` — repo-relative path to the owning story YAML.
- `epic_handle` — parent epic identifier, used for episode paths.
- `story_id` — owning story identifier, used for episode paths.
- `hive_config` — parsed root `hive.config.yaml`, including `test.actual.*` and
  `paths.state_dir`.

**Outputs:**
- The owning story YAML updated in place with:

  ```yaml
  manual_verdict:
    scenario_ref: <scenario_path>
    verdict: pass | fail | inconclusive
    timestamp: "<ISO-8601 timestamp>"
    agent: actual
  ```

- One episode marker at
  `${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/actual-run.yaml`.
- One per-step report sidecar at
  `${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/actual-run.steps.jsonl`.
- Summary returned to `/test` with the verdict, step report path, and marker paths.

## Process

### Step 0: Mode resolve and precondition gate

The caller resolves the mode before invoking this skill:

```js
function resolveTestMode(env, hiveConfig) {
  if (env.HIVE_TEST_MODE === 'actual') {
    return { mode_decision: 'actual', field_sources: { test_mode: 'env' } };
  }
  if (hiveConfig?.test?.mode === 'actual') {
    return { mode_decision: 'actual', field_sources: { test_mode: 'config' } };
  }
  return { mode_decision: 'default', field_sources: { test_mode: 'default' } };
}
```

After selection, verify am-4 and am-5 dependencies are present before touching
the story:

1. Confirm `hive/lib/actual-manual/flow-runner.mjs` exists. If missing, abort with:

   ```text
   ERROR: actual-manual mode requires the flow-runner bridge (am-4).
          Expected: hive/lib/actual-manual/flow-runner.mjs
          Build that story first, then retry.
   ```

2. Confirm `hive/lib/actual-manual/bindings.mjs` exists. If missing, abort with:

   ```text
   ERROR: actual-manual mode requires the overlay loader (am-2).
          Expected: hive/lib/actual-manual/bindings.mjs
          Build that story first, then retry.
   ```

Exit `1` on either missing dependency. Do not fall back to the local
simulated-manual executor after a selected actual mode fails its dependency gate.

### Step 1: MLX sidecar readiness

Resolve MLX connection settings from config/env before touching the story:

1. Read `test.actual.mlx_host` from `hive_config`. Default: `127.0.0.1`.
2. Read `test.actual.mlx_port` from `hive_config`. Default: `8089` (avoids 8080,
   which is owned by Multica).
3. Read `test.actual.mlx_model` from `hive_config`. Default:
   `mlx-community/Qwen2.5-VL-7B-Instruct-4bit`.
4. Env overrides (env-over-config): `ACTUAL_MLX_HOST`, `ACTUAL_MLX_PORT`,
   `ACTUAL_MLX_MODEL`.

Call the am-5 readiness probe:

```python
from hive.lib.actual_manual.mlx_sidecar import probe_ready

result = probe_ready(host=mlx_host, port=mlx_port)
# result: { "state": "ready" | "not_ready" | "error", "detail": str }
```

Or from Node (thin subprocess shim):

```js
import { probeReady } from '../../../hive/lib/actual-manual/mlx-sidecar-probe.mjs';

const result = await probeReady({ host: mlxHost, port: mlxPort });
// result: { state: 'ready' | 'not_ready' | 'error', detail: string }
```

If `state !== 'ready'`, abort with a clear actionable message:

```text
ERROR: MLX Qwen sidecar is not ready (state=<state>: <detail>).
       Start the sidecar first:
         cd <repo> && python -m hive.lib.actual_manual.mlx_sidecar start
       Then retry /test.
       (Host: <mlx_host>:<mlx_port>  Model: <mlx_model>)
```

Exit `1`. Do not write a false verdict or proceed to scenario execution.

### Step 2: Scenario and overlay load

Load the scenario and its overlay before execution:

1. The caller already called `loadScenario(scenario_path)` and passed the result as
   `scenario`. Verify `scenario.mode === 'live-walk'`; fail fast if not:

   ```text
   ERROR: actual-manual mode requires a live-walk scenario.
          Got mode=<scenario.mode> in <scenario_path>.
   ```

2. Load the flow-bindings overlay:

   ```js
   import { loadBindings } from '../../../hive/lib/actual-manual/bindings.mjs';

   const overlay = await loadBindings(overlay_path);
   ```

   `loadBindings` validates the overlay schema and throws a structured error
   (`{ code, field, filePath }`) on failure. Surface the error exactly:

   ```text
   ERROR: Overlay validation failed [<code>] field=<field> file=<filePath>
   ```

3. Emit:

   ```text
   [info] test actual: story=<story_id> scenario=<scenario_path> overlay=<overlay_path> steps=<n>
   ```

### Step 3: Execute flow

Invoke the am-4 flow-runner executor:

```js
import { runFlow } from '../../../hive/lib/actual-manual/flow-runner.mjs';

const report = await runFlow({
  scenario,
  overlay,
  mlxEndpoint: `http://${mlxHost}:${mlxPort}`,
  mlxModel:    mlxModel,
  snapDom:     false, // DOM-snap OFF per §3 locked decision
  retryLimit:  hive_config?.test?.actual?.retry_limit ?? 3,
  stepTimeoutMs: (hive_config?.test?.actual?.step_timeout_seconds ?? 30) * 1000,
});
```

`runFlow` returns the per-step report:

```js
{
  steps: [
    {
      index:        number,
      action:       string,          // scenario action description
      vision_verify: {
        grounded:   boolean,
        coords:     { x: number, y: number } | null,
        label:      string,          // what the model located
      },
      truth: {
        signal:     string | null,   // e.g. "cta_enabled", "posted", null
        result:     boolean | null,  // null when no truth-signal declared
        authoritative: boolean,
      },
      pass:         boolean,         // truth.result if truth.authoritative, else vision_verify.grounded
      divergence:   boolean,         // truth.result !== vision_verify.grounded when both present
      error:        string | null,
    },
    // ...
  ],
  flow_passed: boolean,              // all steps pass
  aborted_at:  number | null,        // step index where execution stopped (null if full run)
}
```

Emit one progress line per step:

```text
[actual:<story_id>] step <i>/<n> action="<action>" pass=<true|false>
```

If `runFlow` throws, write a failed episode marker (Step 5) and return a failed
summary. Do not write a verdict.

### Step 4: Write verdict

Derive the verdict from the step report:

```js
const verdict =
  report.flow_passed         ? 'pass'        :
  report.aborted_at !== null ? 'inconclusive' :
                               'fail';
```

A flow that ran all steps with at least one failing step is `fail`. A flow that
was cut short by an unrecoverable runner error is `inconclusive`.

Update the owning story YAML in place:

```yaml
manual_verdict:
  scenario_ref: <scenario_path>
  verdict: pass | fail | inconclusive
  timestamp: "<ISO-8601 timestamp>"
  agent: actual
```

Write the step report sidecar:

```js
const stepsPath = `${hiveStateDir}/episodes/${epic_handle}/${story_id}/actual-run.steps.jsonl`;
// one JSON line per step in report.steps
```

If the YAML write fails, log the error and proceed to write the episode marker
with `artifacts_committed: false`. Do not suppress the error.

### Step 5: Episode marker

Write the `actual-run.yaml` episode marker. The marker uses the same doc/verdict
dialect as `multica-run.yaml` (`completion_kind: doc-verdict`) to keep episode
readers uniform across modes.

```js
const verdictObj = readUpdatedManualVerdict(story_path);
const artifactsCommitted =
  verdictObj?.agent === 'actual' &&
  ['pass', 'fail', 'inconclusive'].includes(verdictObj?.verdict);

const markerPath = `${hiveStateDir}/episodes/${epic_handle}/${story_id}/actual-run.yaml`;

writeActualRunEpisode({
  markerPath,
  stepsPath,
  verdict:            verdict,
  flowPassed:         report.flow_passed,
  stepCount:          report.steps.length,
  abortedAt:          report.aborted_at,
  artifactsCommitted,
  artifacts:          [story_path, stepsPath],
});
```

Required marker fields:

| Field | Required value for actual-manual |
|---|---|
| `completion_kind` | `doc-verdict` |
| `artifacts_committed` | `true` only after story-YAML verdict is written with `agent: actual` |
| `episode_terminal` | `true` when marker status is terminal |
| `requires_code_push_sha` | `false` |
| `code_push_sha` | `null` |
| `terminal_by_dialect` | `artifacts_committed && episode_terminal` |

The `artifacts` list must include the story YAML containing `manual_verdict` plus
`actual-run.steps.jsonl`.

### Step 6: Aggregate and return

Return to `/test`:

```js
{
  executed: {
    story_id,
    scenario_path,
    overlay_path,
    step_count: report.steps.length,
    aborted_at: report.aborted_at,
  },
  verdict: {
    scenario_ref: scenario_path,
    verdict:      verdictObj.verdict,
    timestamp:    verdictObj.timestamp,
    agent:        'actual',
  },
  steps: {
    stepsPath,
    flow_passed:   report.flow_passed,
    divergences:   report.steps.filter(s => s.divergence).length,
  },
  marker: {
    markerPath,
    terminal_by_dialect: artifactsCommitted,
  },
  failed: artifactsCommitted
    ? null
    : { verdict, notes: 'verdict not committed to story YAML' },
}
```

`/test` uses this summary as the actual-manual result. If `verdict.verdict` is
`fail`, the test run completed but the story did not pass the live-walk; report
the failing step(s) and do not proceed to review.

## Failure modes

- Missing `flow-runner.mjs` or `bindings.mjs` at Step 0: abort selected mode
  with exit `1`; user must build am-4 / am-2 first.
- MLX sidecar not ready at Step 1: abort with actionable start instruction; do
  not write a verdict.
- Scenario `mode !== 'live-walk'` at Step 2: abort before execution.
- Overlay validation failure at Step 2: surface structured `loadBindings` error
  and abort.
- `runFlow` throws at Step 3: write a failed episode marker with
  `artifacts_committed: false`; return a failed summary.
- Story YAML write fails at Step 4: log and proceed with `artifacts_committed: false`.
- All steps pass but `manual_verdict` missing or has wrong `agent`: treat as
  `inconclusive`; write `artifacts_committed: false` marker.
- Step-level `error` from runner: pass is `false` for that step; `aborted_at` set
  if execution halted; flow verdict is `inconclusive` when aborted.

## Configuration

`hive.config.yaml`:

```yaml
test:
  mode: actual                          # opt-in trigger
  actual:
    mlx_host: 127.0.0.1                # MLX server host
    mlx_port: 8089                     # MLX server port (avoids 8080/Multica)
    mlx_model: mlx-community/Qwen2.5-VL-7B-Instruct-4bit
    retry_limit: 3                     # two-pass grounding retries per step
    step_timeout_seconds: 30           # per-step wall-clock cap
```

Environment overrides (env-over-config):

```sh
HIVE_TEST_MODE=actual
ACTUAL_MLX_HOST=127.0.0.1
ACTUAL_MLX_PORT=8089
ACTUAL_MLX_MODEL=mlx-community/Qwen2.5-VL-7B-Instruct-4bit
```

## Reuses (atomic deps)

- `hive/lib/scenarios/load.mjs` (am-3) — canonical scenario loader; must support
  `mode: live-walk` without an integrate-marker gate.
- `hive/lib/actual-manual/bindings.mjs` (am-2) — overlay loader + fail-fast
  validator; maps each step to native|vision + setup + truth-signal.
- `hive/lib/actual-manual/flow-runner.mjs` (am-4) — vision-cursor parent executor;
  locate/verify/truth split, two-pass grounding, native-primitive delegation.
  This skill invokes it; it does not reimplement grounding or verify.
- `hive/lib/actual-manual/mlx_sidecar.py` (am-5) — Python-canonical MLX Qwen
  sidecar lifecycle; this skill calls the readiness probe only.
- `skills/hive/skills/test-dispatch/SKILL.md` (am-6) — mode resolver that routes
  `mode_decision: actual` to this skill.

## Constraint summary

| Rule | Enforcement |
|---|---|
| Atomic skill, not inline `/test` prose | This file owns the selected actual-manual lifecycle |
| Thin mode resolve | `HIVE_TEST_MODE=actual` or `test.mode: actual` selects this atom |
| Sidecar readiness required | Probe before execution; actionable error if not ready |
| live-walk scenario required | `scenario.mode === 'live-walk'` asserted at Step 2 |
| Overlay required | `loadBindings` validates before execution |
| Atomic executor boundary | `runFlow` invoked; locate/verify/truth NOT reimplemented here |
| Hybrid V&V | Truth-signal authoritative; vision recorded alongside; divergence surfaced |
| DOM-snap OFF | `snapDom: false` passed to flow-runner; pure vision coords + real pointer |
| Canonical verdict home | Story-YAML `manual_verdict`, not cycle-state |
| Canonical agent name | `manual_verdict.agent: actual` |
| doc-verdict dialect | `actual-run.yaml` uses same `completion_kind: doc-verdict` as `multica-run.yaml` |
| No silent fallback after selection | Dependency/sidecar failures abort selected mode |
