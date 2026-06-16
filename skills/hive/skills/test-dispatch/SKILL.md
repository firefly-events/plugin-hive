---
name: test-dispatch
description: Resolve /test mode selection from caller-supplied environment, config, workflow, and arguments. Inherits the caller's model and execution context. Structural mirror of execute-dispatch.
---

# Hive Test Dispatch

Atomic skill, NOT inline `/test` prose. It resolves the pre-test dispatch layer and returns the mode and sources the caller switches on. It inherits the caller's model and does not choose or override it.

Structural mirror of `skills/hive/skills/execute-dispatch/SKILL.md` (architect ESCALATION anchor). Step 0/1/2 shapes are intentionally identical to execute-dispatch — dispatch routers across slices share this anchor to prevent re-invention.

## Invocation contract

Call this skill once at the single `/test` dispatch point where the caller has both the scenario execution context and the current workflow handoff context.

**Inputs:** `env` with at minimum `HIVE_TEST_MODE`; parsed root `hive.config.yaml` containing `test.mode` and `paths.state_dir`; parsed consumer `.pHive/hive.config.yaml` or `None`; `scenario_path` — the resolved scenario file path or story-ID argument; `story_id` when known; `epic_id` when known; and `arguments` containing flag state (e.g. `--execution-mode`). The `--simulated-manual` flag was removed in t-1b; do not reintroduce it in downstream routers or tests.

**Outputs:** `mode_decision` enum `cc-workflows | multica | actual | default`; `sources` map covering `test_mode` so callers can attribute every resolution.

`mode_decision` values:
- `cc-workflows` — route to `skills/hive/skills/test-mode-cc-workflows/SKILL.md`
- `multica` — route to `skills/hive/skills/test-mode-multica/SKILL.md`
- `actual` — route to `skills/hive/skills/test-mode-actual/SKILL.md` (am-4 vision-cursor parent executor)
- `default` — fall through to the existing local simulated-manual executor

**Side effects:** emit a structured INFO line on every resolve. Emit a loud warning only when consumer config sets `test.mode` to an unknown non-empty value.

## Input semantics

The mode selection uses these exact match conditions, in precedence order:

1. **Env check:** match when `env.HIVE_TEST_MODE` (as the raw `"HIVE_TEST_MODE=value"` token) resolves to a recognized mode string (`cc-workflows`, `multica`, `actual`). Env wins over every config or default input.
2. **Config check:** match when root `hive.config.yaml` has `test.mode: cc-workflows`, `test.mode: multica`, or `test.mode: actual` and no env override is set.
3. **Default fall-through:** when neither env nor config selects a mode, return `mode_decision=default` so the caller invokes the existing local simulated-manual executor.

## Process

### Step 0: Resolve Fields with Source Tracking

For each tracked field, apply strict precedence: **env > root config > shipped baseline > skill override > default**. Record the source in `sources`. Run this BEFORE Step 1.

The field resolution delegates to `resolveMode` from `hive/lib/mode-resolver.mjs`:

```js
import { resolveMode } from '../../../hive/lib/mode-resolver.mjs';

// ctx.env must be the raw "VARNAME=value" token, not just the value.
// e.g. ctx.env = 'HIVE_TEST_MODE=cc-workflows'  (not just 'cc-workflows')
// The resolver parses at the '=' sign: mode-resolver.mjs line 75.
const ctx = {
  env: process.env.HIVE_TEST_MODE != null
    ? `HIVE_TEST_MODE=${process.env.HIVE_TEST_MODE}`
    : undefined,
  rootConfig: hive_config,
  shippedBaseline: undefined, // additive slot — falls through when absent
  skillOverride:   undefined, // additive slot — falls through when absent
  default:         'auto',
};

const { decision, sources } = resolveMode('HIVE_TEST_MODE', ctx);
```

Precedence chain: **env > root_config > shipped_baseline > skill_override > default**. Root config corresponds to the parsed root `hive.config.yaml`; shipped baseline and skill override are additive source slots that fall through when no value is present.

- `test_mode`:
  - env path: raw `HIVE_TEST_MODE=<value>` token, recognized values: `cc-workflows`, `multica`, `actual`. Unrecognized values are silently ignored per the resolver silencing rule — resolution falls through to next tier.
  - config path: root `hive.config.yaml test.mode: <value>` — recognized values only (`cc-workflows`, `multica`, `actual`)
  - shipped_baseline: falls through when absent
  - skill_override: falls through when absent
  - default: `auto` (maps to `mode_decision=default` at Step 1)

Alias the resolver return into the test-dispatch contract:

```js
// mode-resolver returns { decision, sources } — alias for test-dispatch callers
const mode_decision = decision === 'default' ? 'default' : decision;
const resolvedSources = sources;
```

Emit one inline telemetry line covering the field resolution:

```
[telemetry] test_dispatch test_mode={source}
```

When `decision` is `default` (no env/config/baseline/override matched): fall through to Step 1. `test_mode=default` does NOT trigger a "fell to defaults" warning — it is the normal non-override path and is expected for runs without explicit mode configuration.

When `decision` is `cc-workflows`, `multica`, or `actual`: immediately set `mode_decision={decision}` and emit INFO. Proceed to Step 1.

Emit a loud warning only when `test.mode` in root config is set to an unknown non-empty value that is not in the recognized set:

```
WARNING: test.mode=<value> is not a recognized test mode. Recognized: cc-workflows, multica, actual.
         Falling through to default (local simulated-manual executor).
         Override in hive.config.yaml (test.mode) or env (HIVE_TEST_MODE).
```

### Step 1: Resolve Mode Decision and Dispatch

Select the mode atom based on `mode_decision` from Step 0. Emit one INFO log line with the selected mode and source:

```
INFO [test-dispatch] mode={mode_decision} source={winning source key} scenario={scenario_path}
```

Switch on `mode_decision`:

- **`cc-workflows`:** invoke `skills/hive/skills/test-mode-cc-workflows/SKILL.md` with the full invocation contract:
  ```text
  invoked with scenario_path, scenario, story, story_path, epic_handle, story_id, hive_config, integration_branch
  ```
  Wait for the structured return from the atom skill (Step 5 aggregate). Forward the return summary to the caller. Do not intercept or modify the verdict.

- **`multica`:** invoke `skills/hive/skills/test-mode-multica/SKILL.md` with the full invocation contract:
  ```text
  invoked with scenario_path, scenario, story, story_path, epic_handle, story_id, hive_config, integration_branch
  ```
  Wait for the structured return from the atom skill. Forward the return summary to the caller.

- **`actual`:** invoke `skills/hive/skills/test-mode-actual/SKILL.md` with the full invocation contract:
  ```text
  invoked with scenario_path, scenario, story, story_path, epic_handle, story_id, hive_config, integration_branch
  ```
  Wait for the structured return from the atom skill (am-4 vision-cursor parent executor wrapping Playwright). Forward the return summary to the caller.

- **`default`:** fall through to the existing local simulated-manual executor (`hive/workflows/steps/test/simulated-manual.md`). This is the pre-dispatch path; test-dispatch does not own its lifecycle beyond forwarding.

Do NOT silently fall back from `cc-workflows` or `multica` to `default` after a mode has been selected. If the chosen atom returns a `precondition_failed` error, surface it to the caller; fallback is the caller's (`/test`) responsibility, not this router's.

### Step 2: Return

Return the resolution result and dispatch outcome to the caller:

```js
{
  mode_decision,  // 'cc-workflows' | 'multica' | 'actual' | 'default'
  sources,        // { env?: string, root_config?: string, shipped_baseline?: string, skill_override?: string, default?: string }
}
```

When the selected atom returned a structured result, merge it into the return:

```js
{
  mode_decision,
  sources,
  dispatched: atom_result.dispatched,
  verdict:    atom_result.verdict,
  marker:     atom_result.marker,
  failed:     atom_result.failed,
  run_id:     atom_result.run_id,
}
```

When `mode_decision=default`, return only `{ mode_decision: 'default', sources }` — the caller invokes the local executor directly and this router's job is done.

`sources` always contains only the winning tier key (e.g. `{ env: 'HIVE_TEST_MODE=cc-workflows' }` or `{ root_config: 'test.mode=multica' }` or `{ default: 'auto' }`). This is the audit provenance trail for downstream callers.

## Single Dispatch Point

This skill is the single dispatch point for `/test` mode selection. Callers must consume `mode_decision` and `sources` from this skill instead of re-implementing any of those decisions in another skill or workflow step. Any future test mode that wants to participate in env/config-driven selection MUST be added to the recognized mode registry in `hive/lib/mode-resolver.mjs` AND registered as a `mode_decision` branch in Step 1 of this skill.

## Configuration

`hive.config.yaml`:

```yaml
test:
  mode: cc-workflows   # or: multica, actual
```

Environment override:

```sh
HIVE_TEST_MODE=cc-workflows  # or: multica, actual
```

Runtime source priority:

| Tier | Source | Example |
|---|---|---|
| 1 (highest) | env `HIVE_TEST_MODE` | `HIVE_TEST_MODE=cc-workflows` (or `multica`, `actual`) |
| 2 | root `hive.config.yaml` | `test.mode: multica` (or `cc-workflows`, `actual`) |
| 3 | shipped baseline | additive slot, falls through when absent |
| 4 | skill override | additive slot, falls through when absent |
| 5 (lowest) | default | `auto` → `mode_decision=default` |

## Reuses (atomic deps)

- `hive/lib/mode-resolver.mjs` — 5-tier resolver consumed at Step 0. `HIVE_TEST_MODE` is a registered varName in the 6-name registry.
- `skills/hive/skills/test-mode-cc-workflows/SKILL.md` — atom for `mode_decision=cc-workflows`.
- `skills/hive/skills/test-mode-multica/SKILL.md` — atom for `mode_decision=multica`.
- `skills/hive/skills/test-mode-actual/SKILL.md` — atom for `mode_decision=actual` (am-4 vision-cursor parent executor).
- `skills/test/SKILL.md` — caller; delegates to this router at `/test` Phase 0 dispatch point.

Key references:

- `skills/hive/skills/execute-dispatch/SKILL.md` — structural mirror anchor (architect ESCALATION); Step 0/1/2 shapes are intentionally identical.
- `skills/hive/skills/design-dispatch/SKILL.md`, `skills/hive/skills/review-dispatch/SKILL.md`, `skills/hive/skills/design-review-dispatch/SKILL.md` — sibling dispatch routers sharing the same Step 0/1/2 structural anchor.
- `hive/lib/mode-resolver.mjs` — canonical 5-tier resolver; `ctx.env` must be the raw `"VARNAME=value"` token (NOT just the env value) — the resolver parses at `=` (line 75).

## Constraint summary

| Rule | Enforcement |
|---|---|
| Structural mirror of execute-dispatch | Step 0/1/2 shapes are intentionally identical to execute-dispatch (architect ESCALATION) |
| Single dispatch point | All `/test` mode selection routes through this skill |
| `resolveMode('HIVE_TEST_MODE', ctx)` — exact call | varName must be the string `'HIVE_TEST_MODE'`; ctx.env must be the raw token |
| Returns `{mode_decision, sources}` always | Callers can audit provenance on every resolution |
| No silent fallback after mode selection | If chosen atom rejects, surface `precondition_failed` to caller |
| No Codex routing in this router | Router selects atom; atom owns substrate choice |
| `default` maps to local executor fall-through | Not a warning condition — expected for unconfigured runs |
| Env wins over config | Enforced by `resolveMode` tier ordering |
