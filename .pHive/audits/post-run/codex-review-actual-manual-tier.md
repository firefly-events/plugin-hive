# Codex Review: actual-manual test tier

Scope: independent read-only review of `develop...feat/actual-manual-tier`, focused on the net-new actual-manual vision-cursor tier and requested dispatch/config deltas.

## Findings

### High: Actual-mode skill calls a sidecar readiness API that does not exist

- File: `skills/hive/skills/test-mode-actual/SKILL.md:136`
- Offending line: `from hive.lib.actual_manual.mlx_sidecar import probe_ready`
- Related lines:
  - `skills/hive/skills/test-mode-actual/SKILL.md:138`: `result = probe_ready(host=mlx_host, port=mlx_port)`
  - `skills/hive/skills/test-mode-actual/SKILL.md:145`: `import { probeReady } from '../../../hive/lib/actual-manual/mlx-sidecar-probe.mjs';`
  - `hive/lib/actual-manual/mlx_sidecar.py:134`: `def probe(handle: SidecarHandle) -> ProbeState:`

What is wrong: the selected actual-mode lifecycle tells callers to import `probe_ready` from `hive.lib.actual_manual.mlx_sidecar`, but the new Python file is under `hive/lib/actual-manual/mlx_sidecar.py` and exposes `probe(handle)`, not `probe_ready(host, port)`. The Node fallback also imports `mlx-sidecar-probe.mjs`, which is not present in the diff.

Why it matters: Step 1 of the selected `actual` mode cannot execute as written, so `/test` will fail before running any live-walk scenario. This is a JS/Python contract mismatch at the MLX readiness boundary.

Concrete fix: either add the documented host/port readiness API, for example `probe_ready(host='127.0.0.1', port=8089) -> {"state", "detail"}`, plus a real importable package path or subprocess wrapper, or update the skill to call the actual CLI/API that exists. If the sidecar is intentionally externally managed, the probe should not require a `SidecarHandle`/PID.

### High: Actual-mode skill invokes `runFlow` with the wrong signature and option names

- File: `skills/hive/skills/test-mode-actual/SKILL.md:203`
- Offending line: `const report = await runFlow({`
- Related lines:
  - `hive/lib/actual-manual/flow-runner.mjs:302`: `export async function runFlow(page, scenario, binding, opts = {}) {`
  - `skills/hive/skills/test-mode-actual/SKILL.md:206`: `mlxEndpoint: \`http://${mlxHost}:${mlxPort}\`,`
  - `hive/lib/actual-manual/flow-runner.mjs:66`: `async function ask(b64, text, { mlx, model } = {}) {`

What is wrong: the skill documents a single-object call with `{ scenario, overlay, mlxEndpoint, mlxModel, snapDom, retryLimit, stepTimeoutMs }`, but the implementation requires `(page, scenario, binding, opts)` and reads `opts.mlx`, `opts.model`, `opts.snapR`, `opts.viewport`, and `opts.baseUrl`.

Why it matters: following the actual-mode integration contract will pass a plain object as `page`, leaving `scenario` undefined. `runFlow` then reaches `page.on(...)` and fails because the object is not a Playwright `Page`. Even if adapted past that, `mlxEndpoint`/`mlxModel` are ignored, so configured sidecar settings would not be used.

Concrete fix: align the skill and implementation. Either wrap `runFlow` in a higher-level actual-mode executor that owns Playwright page/context creation and accepts the documented object shape, or update the skill to create/pass a real Playwright `Page`, pass `overlay` as the third positional argument, and use `{ mlx: 'http://host:port/v1/chat/completions', model, snapR }`.

### High: Accepted native overlays fill empty text and `tapText` searches for `undefined`

- File: `hive/lib/actual-manual/flow-runner.mjs:251`
- Offending line: `await page.locator(args.selector).first().fill(args.text || '');`
- Related lines:
  - `hive/lib/actual-manual/__tests__/bindings.test.mjs:27`: `{ how: 'native', act: 'fill', args: { selector: '[data-testid=caption-input]', value: 'Hello' }, truth: 'cta_enabled' },`
  - `hive/lib/actual-manual/__tests__/bindings.test.mjs:98`: `{ act: 'tapText', args: { text: 'Submit' } },`
  - `hive/lib/actual-manual/flow-runner.mjs:257`: `await page.getByText(new RegExp(args.name, 'i')).first().click();`

What is wrong: the validator/tests accept `fill` arguments with `value`, but the runner only reads `args.text`, so valid overlays fill `''`. The tests also accept `tapText` arguments with `text`, but the runner only reads `args.name`, so it constructs `/undefined/i`.

Why it matters: a valid overlay can silently perform the wrong user action. In the common compose/post flow, filling an empty caption can keep the CTA disabled, make truth-signal verification fail, or worse, click unintended text when `/undefined/i` matches unexpected page content.

Concrete fix: make the runner and schema agree. Either change overlays/tests to require `args.text`/`args.name`, or support both aliases explicitly (`const text = args.text ?? args.value`, `const name = args.name ?? args.text`) and add per-act validation tests for the required fields.

### High: `mlx_sidecar.py start --wait` leaks the sidecar process on readiness timeout

- File: `hive/lib/actual-manual/mlx_sidecar.py:242`
- Offending line: `except TimeoutError as e:`
- Related lines:
  - `hive/lib/actual-manual/mlx_sidecar.py:238`: `handle = start(cfg)`
  - `hive/lib/actual-manual/mlx_sidecar.py:243`: `print(json.dumps({"state": "timeout", "pid": handle.pid, "error": str(e)}))`
  - `hive/lib/actual-manual/mlx_sidecar.py:244`: `sys.exit(1)`

What is wrong: the CLI starts `mlx_lm.server`, waits for readiness, and on timeout exits without calling `stop(handle)`.

Why it matters: a slow model load or wedged server leaves a detached MLX process running on the configured port. Subsequent actual-manual runs may hit the stale server, fail to bind, or consume GPU/MLX resources indefinitely.

Concrete fix: in the `TimeoutError` path, call `stop(handle)` before exiting, or make the documented behavior explicit and print that the process is intentionally left running. For test automation, stopping on failed `--wait` is the safer default.

### Medium: MLX completion calls have no timeout or abort path

- File: `hive/lib/actual-manual/flow-runner.mjs:78`
- Offending line: `const r = await fetch(endpoint, {`

What is wrong: the MLX HTTP boundary does not pass an `AbortSignal.timeout(...)` or any caller-provided signal. If the sidecar accepts the TCP connection but never completes the response, every `locate()`/`verify()` call can hang indefinitely.

Why it matters: `runFlow` has no per-step timeout despite the skill documenting one, so a single wedged MLX request can stall the whole `/test actual` invocation and leave browser resources owned by the caller open until the parent process is killed.

Concrete fix: add a timeout option to `ask`, default it from config (for example 30s), and call `fetch(endpoint, { ..., signal: AbortSignal.timeout(timeoutMs) })`. Surface timeout errors in `rec.actError` or `rec.verify.why` just like other MLX failures.

### Medium: `package.json` adds Playwright but `package-lock.json` is stale

- File: `package.json:16`
- Offending line: `"playwright": "1.52.0"`
- Related line: `package-lock.json:15`: `"zod": "4.4.3"`

What is wrong: `package.json` declares a new runtime dependency on Playwright, but the root `package-lock.json` was not changed and its root dependency list still ends at `zod`.

Why it matters: `npm ci` installs from the lockfile and will not install the new Playwright dependency. The CLI path in `flow-runner.mjs` imports Playwright dynamically, so clean installs can fail at runtime even though `package.json` looks correct.

Concrete fix: regenerate and commit the root `package-lock.json` with Playwright 1.52.0 and its transitive packages, or remove the lockfile if this repo intentionally does not use `npm ci`.

### Medium: Binding validation does not reject overlays for the wrong scenario

- File: `hive/lib/actual-manual/bindings.mjs:110`
- Offending line: `if (!doc.scenario || typeof doc.scenario !== 'string' || !doc.scenario.trim()) {`
- Related line: `hive/lib/actual-manual/bindings.mjs:76`: `validateBindings(doc, scenarioId ?? doc?.scenario ?? '(unknown)');`

What is wrong: `loadBindings(filePath, scenario.id)` passes the expected scenario id into validation, but validation only checks that `doc.scenario` is a non-empty string. It never compares `doc.scenario` to `scenarioId`.

Why it matters: a stale overlay for a different scenario can be accepted and then mapped by step index in `runFlow`. That can drive the live browser through the wrong native/vision actions while producing a report under the current scenario id.

Concrete fix: when `scenarioId` is provided and not `'(unknown)'`, require `doc.scenario === scenarioId` and throw a structured validation error on mismatch. Add a unit test that `loadBindings(path, 'expected')` rejects `{ scenario: 'other', steps: [...] }`.

### Medium: Normalized-coordinate full-page scroll math uses the wrong denominator

- File: `hive/lib/actual-manual/flow-runner.mjs:193`
- Offending line: `const docY = Math.round((full.iy / full.H) * scrollH);`

What is wrong: when `MLX_COORDS=norm`, `locate(..., true)` instructs the model to return 0-1000 normalized coordinates, but the full-page scroll code still divides `full.iy` by the PNG height. For a full-page screenshot taller than 1000 px, this scrolls to the wrong document position.

Why it matters: normalized mode is documented and configurable. In that mode, off-viewport vision targets can fail to be centered, causing the second viewport locate to miss or click the wrong area.

Concrete fix: branch on `opts.coords || DEFAULTS.coords`; use `full.iy / 1000` for normalized coordinates and `full.iy / full.H` for pixel coordinates.

### Low: `runFlow` leaves a request listener attached to reused pages

- File: `hive/lib/actual-manual/flow-runner.mjs:305`
- Offending line: `page.on('request', (req) => {`

What is wrong: `runFlow` installs an anonymous `request` listener and never removes it.

Why it matters: callers that reuse an authenticated Playwright page/context across multiple actual-manual runs accumulate closed-over `networkState` listeners. This is a small resource leak and can eventually produce listener warnings or unnecessary per-request work.

Concrete fix: assign the handler to a named function and remove it in a `finally` block with `page.off('request', handler)`.

## Checked And Not Flagged

- I did not find shell command injection in the MLX sidecar spawn path. `mlx_sidecar.py` builds an argument array and calls `subprocess.Popen(cmd, ...)` without `shell=True` at `hive/lib/actual-manual/mlx_sidecar.py:117-130`.
- I did not find a browser leak in the standalone CLI happy/error path after the browser is launched. `flow-runner.mjs` closes the browser in `finally` at `hive/lib/actual-manual/flow-runner.mjs:439-440`; closing the browser also closes its context.
- I did not find a language-policy violation for the new JS files under the named actual-manual bridge surface. `CLAUDE.md` explicitly registers `hive/lib/actual-manual/` as a Node bridge surface, and the dispatch edits are in pre-existing Node bridge modules.
- I did not find MLX secret leakage in the new HTTP client. The runner sends only JSON content to the configured endpoint and does not attach Authorization headers.

## Flow Trace

Happy path traced: CLI loads the scenario and binding, launches Chromium, creates a context/page, navigates to `BASE_URL`, then `runFlow` iterates `scenario.steps`. For each step, setup primitives run through `native()`, action is either `visionTap()` or `native()`, `verify()` calls MLX, optional truth signals override vision, and the CLI prints the JSON report before `browser.close()` in `finally`.

Error path traced: if a setup primitive throws, the outer `try` in `runFlow` records one `{ fatal: ... }` and returns a failed report. If an action throws, it is captured in `rec.actError` and verification still runs. If verification throws, the step fails closed. The CLI browser still closes after `runFlow`. Separately, the sidecar `start --wait` timeout path does not stop the already-started MLX process, which is the process-lifecycle leak noted above.

## Verdict

Blocked. The branch is not mergeable as-is because the selected actual-mode integration path cannot call the documented sidecar probe or `runFlow` API, and valid accepted overlays can execute incorrect native actions. Fix the API/option contracts, sidecar timeout cleanup, and dependency lockfile before merging.
