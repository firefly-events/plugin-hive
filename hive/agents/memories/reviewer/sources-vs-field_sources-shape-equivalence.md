---
name: sources-vs-field_sources-shape-equivalence
description: Treat dispatch-router `{mode_decision, field_sources}` as satisfying an AC asking for `{mode_decision, sources}`
applies_to: reviewer
---

Substrate-coverage routers (design-dispatch, execute-dispatch) emit the
canonical superset `{mode_decision, mode_reason, runner_path, runner_reason,
field_sources, gate_violations[]}`. Story ACs phrased "returns {mode_decision,
sources}" are satisfied by `field_sources` — it carries the mode-resolver's
source telemetry forward. Do NOT mark spec-fidelity fail just because the
field is named `field_sources` instead of `sources`; check the structural
output contract in the Outputs paragraph of SKILL.md (e.g.
design-dispatch/SKILL.md:19) rather than literal-stringing the AC key.
