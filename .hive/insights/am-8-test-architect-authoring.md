# Insights — am-8 test-architect overlay authoring guidance

## The vision_tap / how:vision naming gap

The design discussion (§4) references "the `verify:`/`vision_tap` overlay" but the actual schema
uses `how: "vision"`, not `vision_tap`. These are the same thing. When test-architect receives
design docs, treat `vision_tap` as `how: "vision"` in JSON. The schema doc
(`hive/references/actual-manual-overlay-schema.md`) is the canonical reference — not the design
discussion prose.

## Truth-signals are opt-in, not opt-out

The memory was written with an explicit opt-in model: add `truth` only when vision is unreliable
(enabled-state, ephemeral events). The temptation is to add `truth` everywhere for safety — but
that couples tests to implementation details (exact selectors, exact network calls) and breaks
when those details change. Reserve it for the two proven-necessary cases.

## setup[] is a safety net, not a first resort

`setup[]` exists because vision steps may run after unexpected page resets (SPA navigation, retry
loops). The pattern is: if the vision step depends on state set by a prior native step, repeat
that state-setting in `setup[]` on the vision step. Don't use `setup[]` to patch over missing
prior steps — fix the prior step's `how` instead.

## Sibling memory shape: minimal frontmatter

Existing test-architect memories (`maestro-cli-awareness.md`, `strategy-before-test-generation.md`,
`avoid-coverage-overlap-with-story-tests.md`) use: name, description, type, last_verified,
ttl_days, source. No extra fields. The body is free-form prose + tables — no rigid template.
Matching this keeps the set scannable and consistently parseable by future tooling.
