# d-1 — Three named AC subsections become the test-independence contract

**Story:** `d-1-design-multi-persona-pipeline` (substrate-coverage-and-test-cleanup)
**Date:** 2026-06-08

## Non-obvious finding

When a story spec declares "3 AC subsections that verify independently," the most
effective enforcement mechanism is not a reviewer assertion or a CI rule — it is
**the test file's describe block layout**. The d-1 tester wrote
`skills/design/test/phase-a-toggle.test.mjs` with **three top-level `describe`
blocks** (one per AC subsection), and vitest's per-`it` isolation means one
subsection failing literally cannot mask or block the other two. The reviewer's
"verify each independently" check then collapses to a single observation: does
the test file have 3 top-level describes, one per subsection? If yes, the
independence contract is structurally guaranteed by the test runner.

This is a stronger contract than "the reviewer manually walked each subsection"
— a fresh reviewer six months from now will see the 3-describe shape and know
the independence invariant is preserved without re-deriving the rationale.

## Pattern for future multi-subsection stories

When a story spec calls out N named AC subsections:

1. Require the test file to have N top-level `describe` blocks, one per subsection.
2. Reviewer assertion collapses from "verify each AC independently" (manual walk)
   to "verify N describe blocks exist + named to match subsection names"
   (structural check).
3. The describe-block names become the load-bearing index — name them exactly as
   the AC subsection names ("AC Subsection 1 — Phase A structural insert + Phase 0
   wiring", etc.) so reviewer-to-spec mapping is grep-trivial.

## Anti-pattern to avoid

A single `describe` block with N `it` blocks inside collapses subsection
boundaries — one shared `beforeAll` failure now blocks all subsections.
Multi-subsection stories MUST use multiple `describe` blocks, not a single
describe with multiple `it`s.
