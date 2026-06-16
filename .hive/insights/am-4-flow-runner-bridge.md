# Insights — am-4-flow-runner-bridge

## live-walk mode bypass

`loadScenario` from `hive/lib/scenarios/load.mjs` only accepts `spec-walk` and `implementation-walk` modes. The `live-walk` mode (am-3) wasn't committed yet when am-4 ran, so the flow-runner loads scenario YAML directly with js-yaml rather than calling `loadScenario`. This is intentional: the runner is an executor, not a validator. Once am-3 lands, callers can validate before passing the scenario in.

## Auth is the caller's concern

The spike embedded Clerk auth directly in the runner. The bridge surface does NOT — `runFlow(page, ...)` takes an already-set-up page. This keeps the runner portable (no Clerk dep, works with any auth scheme). The standalone CLI entry point navigates to BASE_URL and leaves auth to session-storage/cookie state managed by the caller.

## fail-closed verify: why the regex list matters

The `parse_verdict` / `verify()` logic is fail-closed: ANY negative regex match → fail, regardless of positive signals. This is not paranoia — the spike showed that vision models frequently mix `"pass":false` with explanatory text that also contains affirmative words ("the button is shown but not posted"). The negative-first short-circuit prevents false-passes on mixed responses.

## DOM-snap default OFF is important for the trust model

SNAP_R=0 means the click goes exactly where vision said, including under overlays. This is what makes the actual-manual tier catch render-fidelity bugs — a DOM-snap crutch would bypass overlays and make the tier no better than a native selector test. Only raise SNAP_R when explicitly debugging grounding accuracy, never for production runs.

## Two-pass grounding vs retry semantics

The retry loop (≤3) wraps the full two-pass sequence, not just the viewport pass. Reflows on SPAs can cause the first fullPage glance to have stale layout. Retrying the full two-pass (not just the viewport re-ground) handles the case where the element moves between the glance and the re-ground.

## pngSize is the cheap alternative to a PNG library

Reading width/height from bytes 16–19 and 20–23 of a PNG buffer (IHDR chunk) avoids any image processing dep. This works because PNG IHDR is always the first chunk and width/height are always at fixed offsets in the header.

## Truth-signal network listener must be attached BEFORE navigation

`page.on('request', ...)` is registered at the top of `runFlow()` before any step runs. If you attach it after a goto step, you'll miss the POST if the step fires the request synchronously on page load. The early attachment is load-bearing.
