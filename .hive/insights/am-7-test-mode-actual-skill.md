# Insights: am-7 test-mode-actual skill

## Verdict agent is `actual`, not an external agent name

In `test-mode-multica`, `manual_verdict.agent: tester` names the Multica agent that wrote the
verdict externally. In `test-mode-actual`, the local executor writes the verdict itself — there is
no Multica dispatch, no assignee. Using `agent: actual` (the mode name) is intentional: it's
self-describing, avoids confusion with a real agent named `tester`, and lets episode readers
distinguish multica-dispatched from locally-executed verdicts without extra fields.

## Episode marker uses `doc-verdict` dialect despite being local

`actual-run.yaml` reuses the same `completion_kind: doc-verdict` as `multica-run.yaml`. This is
deliberate: downstream episode readers (story-level state computation) switch on `completion_kind`,
not mode. Inventing a new dialect for local execution would require touching every reader. The key
distinguisher between the two markers is the file name (`actual-run.yaml` vs `multica-run.yaml`),
not the dialect.

## Three-layer dependency gate prevents half-built execution

The skill gates on am-2 (bindings.mjs), am-4 (flow-runner.mjs), and am-5 (sidecar readiness)
before touching the story YAML. The ordering matters: missing files abort immediately (exit 1) so
no false verdict gets written. Sidecar readiness is checked last because it's the most likely
transient failure and deserves the clearest actionable message. Do not reorder.

## Inconclusive vs fail distinction

`inconclusive` = execution aborted mid-flow (runner threw, step timed out, sidecar dropped). `fail`
= full flow completed, at least one step failed. This distinction is load-bearing: a reviewer can
tell whether the scenario actually ran or got cut short. The `aborted_at` field in the marker and
return value carries the step index for inconclusive cases.

## Overlay path convention: caller derives it, not this skill

The `overlay_path` is an input, not derived inside the skill. The caller (test-dispatch → /test)
resolves it — by convention from `scenario_path` (e.g. same dir, `flow-bindings.json`) or an
explicit field in the story YAML. This keeps the skill testable in isolation and avoids baking
path conventions into the atomic boundary.
