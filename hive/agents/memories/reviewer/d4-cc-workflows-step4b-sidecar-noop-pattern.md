---
name: d4-cc-workflows-step4b-sidecar-noop-pattern
description: When reviewing cc-workflows atoms, accept Step 4b sidecar-deferral as a documented no-op kept for diff-review parity with plan-mode-cc-workflows.
applies_to: reviewer
---

Design-side cc-workflows atoms (d-4 / `design-mode-cc-workflows`) keep the `Step 4b: Sidecar
deferral` header even though design is pre-execute and has no `appends_map` to consume. This
is deliberate parity with `plan-mode-cc-workflows` so diff reviewers can confirm step
shape line-for-line. Do NOT flag the no-op as missing implementation — the prose explicitly
calls out that sidecar deferral is an execute-mode concern. Apply this same precedent when
reviewing future `*-mode-cc-workflows` skills that mirror the canonical 0/1/2/3/4/4b/5 shape.
