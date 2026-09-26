---
name: test-mode-actual
description: Run a scenario through SimMan (the external vision-cursor testing product, firefly-events/simman) via its CLI, then map SimMan's RunReport to the story manual_verdict + an actual-run episode marker. Thin adapter — SimMan owns the browser, grounding, and verdict; Hive owns scenario resolution and episode I/O.
---

# Hive Test Mode - Actual (SimMan adapter)

Atomic skill, NOT inline `/test` prose. Runs the `actual` test mode for `/test` when
the dispatch resolver selected `mode_decision == actual` AND `decideActual` confirmed
SimMan is present. This skill is a **thin adapter** over the external **SimMan** product
(`firefly-events/simman`): it shells out to the `simman` CLI, parses the JSON RunReport,
and writes Hive's verdict + episode artifacts.

The vision-cursor runner, MLX sidecar, grounding, overlay compilation, and Playwright
all live in SimMan now — they were removed from Hive in M2 (see
`.pHive/proposals/simman-spinout-plan.md`). Hive ships zero of that weight.

Structural sibling of `skills/hive/skills/test-mode-multica/SKILL.md`. The difference:
multica dispatches to a Multica `tester` agent; this mode shells to a local `simman`
CLI. Both write the same `manual_verdict` home + a doc-verdict episode marker.

## Boundary — who owns what

| Concern | Owner |
|---|---|
| Detect SimMan availability + prefer/fallback | `test-dispatch` → `hive/lib/actual-backend.mjs` (before this skill runs) |
| Scenario file (authored SimMan-format YAML) | Hive resolves the path; SimMan parses + compiles it |
| Drive browser, ground, verify, RunReport | **SimMan** (`simman run … --json`) |
| Map RunReport → story `manual_verdict` | **this skill** |
| Write `actual-run.yaml` marker + `.steps.jsonl` | **this skill** |
| Provider / model / MLX-sidecar readiness | **SimMan** (its `simman.config.yaml`; surfaced via exit code 2) |

## Invocation contract

Called once per `/test` invocation when dispatch resolved `mode_decision == actual`
(SimMan present). `test-dispatch` has already run `decideActual` — this skill does NOT
re-probe or re-implement fallback.

**Inputs:**
- `simman_cmd` — the resolved SimMan command from the probe (`actual-backend.mjs:resolveSimmanCmd`; default `simman`).
- `scenario_path` — repo-relative path to the **SimMan-format** scenario YAML
  (single authored file: `id`, `baseUrl?`, `steps[{action, expected, do, truth?}]`).
  Resolved from the story's `manual_verdict.scenario_ref`, or passed directly.
- `story`, `story_path` — the story YAML object + path that owns the verdict.
- `epic_handle`, `story_id` — used for episode paths.
- `hive_config` — parsed root `hive.config.yaml` (`test.actual.*`, `paths.state_dir`).

**Outputs:**
- Story YAML updated in place with `manual_verdict` (`agent: actual`, `backend: simman`).
- Episode marker `${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/actual-run.yaml`.
- Per-step sidecar `${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/actual-run.steps.jsonl`.
- Summary returned to `/test` (verdict, step path, marker path).

## Process

### Step 0: Resolve command + scenario

1. `simman_cmd` is provided by `test-dispatch` (the probe already confirmed it
   resolves). If absent, resolve it: `hive_config.test.actual.simman_cmd` →
   `SIMMAN_CMD` env → `simman` on PATH (see `actual-backend.mjs:resolveSimmanCmd`).
2. Resolve `scenario_path`: if the `/test` argument is a story ID, read
   `manual_verdict.scenario_ref` from the story YAML; if a path, use it directly.
   The file is a **SimMan-format** scenario — Hive does NOT pre-parse or compile it;
   SimMan owns that.

Do NOT re-probe availability or fall back here — that was decided upstream.

### Step 1: Invoke SimMan

Run the SimMan CLI, capturing stdout + exit code:

```js
import { execFile } from 'node:child_process';

const args = ['run', scenario_path, '--json'];
const baseUrl = hive_config?.test?.actual?.base_url;
if (baseUrl) args.push('--base-url', baseUrl);
const provider = hive_config?.test?.actual?.provider; // google | mlx (optional)
if (provider) args.push('--provider', provider);

// exit: 0 pass · 1 fail · 2 error
const { stdout, code } = await runSimman(simman_cmd, args, {
  timeoutMs: (hive_config?.test?.actual?.run_timeout_seconds ?? 300) * 1000,
});
```

Emit:

```text
[info] test actual: story=<story_id> scenario=<scenario_path> cmd="<simman_cmd> run … --json"
```

SimMan reads its own provider/model/sidecar config from `simman.config.yaml` (hosted
Gemini by default; local MLX Qwen optional). Those are NOT Hive's concern — if SimMan
can't reach a provider it exits `2`, which this skill maps to `inconclusive`.

### Step 2: Parse RunReport + derive verdict

Parse `stdout` as JSON. SimMan's RunReport:

```js
{
  scenario: string,
  model: string,
  flowPassed: boolean,
  stepsPassed: number,
  posted: boolean,
  steps: [
    { i: number, action: string, pass: boolean,
      passBasis: 'truth' | 'native-act' | 'vision-verify',
      how: 'native' | 'vision', truth?: boolean,
      topmost?: string, actError?: string, why?: string },
    // ...
  ],
}
```

Derive the verdict from the **exit code** (authoritative), corroborated by the report:

```js
const verdict =
  code === 0 ? 'pass' :
  code === 1 ? 'fail' :
               'inconclusive';   // code 2 (error) or unparseable JSON
```

If stdout is not valid JSON, treat as `inconclusive` and record the raw stderr/stdout
tail in the marker notes — do not fabricate a step report.

### Step 3: Write verdict

Update the owning story YAML in place:

```yaml
manual_verdict:
  scenario_ref: <scenario_path>
  verdict: pass | fail | inconclusive
  timestamp: "<ISO-8601 timestamp>"
  agent: actual
  backend: simman
```

Write the per-step sidecar (`actual-run.steps.jsonl`) — one JSON line per
`report.steps[i]`. If the YAML write fails, log it and proceed to the marker with
`artifacts_committed: false`.

### Step 4: Episode marker

Write `actual-run.yaml` using the same doc/verdict dialect as `multica-run.yaml`:

```js
const artifactsCommitted =
  verdictObj?.agent === 'actual' &&
  ['pass', 'fail', 'inconclusive'].includes(verdictObj?.verdict);

writeActualRunEpisode({
  markerPath: `${hiveStateDir}/episodes/${epic_handle}/${story_id}/actual-run.yaml`,
  stepsPath:  `${hiveStateDir}/episodes/${epic_handle}/${story_id}/actual-run.steps.jsonl`,
  verdict, flowPassed: report?.flowPassed ?? null,
  stepCount: report?.steps?.length ?? 0,
  backend: 'simman', model: report?.model ?? null,
  artifactsCommitted, artifacts: [story_path, stepsPath],
});
```

| Field | Required value |
|---|---|
| `completion_kind` | `doc-verdict` |
| `artifacts_committed` | `true` only after the story-YAML verdict is written with `agent: actual` |
| `episode_terminal` | `true` when terminal |
| `requires_code_push_sha` | `false` |
| `code_push_sha` | `null` |
| `terminal_by_dialect` | `artifacts_committed && episode_terminal` |

### Step 5: Aggregate and return

```js
{
  executed: { story_id, scenario_path, backend: 'simman', step_count, exit_code: code },
  verdict:  { scenario_ref: scenario_path, verdict, timestamp, agent: 'actual', backend: 'simman' },
  steps:    { stepsPath, flow_passed: report?.flowPassed ?? null },
  marker:   { markerPath, terminal_by_dialect: artifactsCommitted },
  failed:   artifactsCommitted ? null : { verdict, notes: 'verdict not committed to story YAML' },
}
```

If `verdict` is `fail`, the run completed but the flow did not pass — report the failing
step(s) and do not proceed to review. If `inconclusive`, SimMan errored (provider
unreachable, bad scenario, crash) — surface SimMan's stderr; this is NOT a fallback
trigger (fallback is the resolver's job, pre-run).

## Failure modes

- `simman` exits `2` (provider/sidecar/scenario error): verdict `inconclusive`; record
  stderr tail in the marker. Do not write a false pass/fail.
- stdout not valid JSON: `inconclusive`; do not fabricate steps.
- CLI vanished between probe and run (rare TOCTOU): execFile ENOENT → `inconclusive`
  with a clear note (the probe is the availability gate; this is a defensive case).
- Story YAML write fails: log, write marker with `artifacts_committed: false`.
- `simman run` exceeds `run_timeout_seconds`: killed → `inconclusive`.

## Configuration

`hive.config.yaml`:

```yaml
test:
  mode: actual
  actual:
    simman_cmd: simman          # or an absolute path to the simman bin
    base_url: http://localhost:3100   # optional; else the scenario's baseUrl
    provider: google            # optional passthrough: google | mlx
    run_timeout_seconds: 300
    on_unavailable: fallback    # read by test-dispatch, not here
```

Environment overrides: `SIMMAN_CMD` (binary), `ACTUAL_ON_UNAVAILABLE` (resolver).
SimMan's own vision-provider/model/MLX config lives in **SimMan's** `simman.config.yaml`,
not here — Hive does not configure SimMan's internals.

## Reuses (atomic deps)

- `hive/lib/actual-backend.mjs` — SimMan command resolution + availability decision
  (`resolveSimmanCmd`, `decideActual`); consumed by `test-dispatch`, surfaced here.
- `skills/hive/skills/test-dispatch/SKILL.md` — resolver that routes
  `mode_decision: actual` to this skill (after probing SimMan).
- External: **SimMan** (`firefly-events/simman`) — the `simman run <scenario> --json`
  CLI. Not vendored; detected at runtime.

## Constraint summary

| Rule | Enforcement |
|---|---|
| Thin adapter, not a runner | Browser/grounding/verdict owned by SimMan; this skill shells `simman run --json` |
| No vendored runner in Hive | `hive/lib/actual-manual/` deleted in M2; no Playwright/MLX in Hive |
| Availability + fallback decided upstream | `test-dispatch`/`decideActual` prefers or downgrades before this skill runs |
| Exit code is authoritative | 0 pass · 1 fail · 2 inconclusive; report corroborates |
| Canonical verdict home | Story-YAML `manual_verdict` (`agent: actual`, `backend: simman`) |
| doc-verdict dialect | `actual-run.yaml` matches `multica-run.yaml` completion dialect |
| SimMan config is SimMan's | Provider/model/sidecar live in `simman.config.yaml`, not Hive |
