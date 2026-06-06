---
name: scope-drift-emit-at-review-complete
description: Know that /review emits scope_drift at phase_label "review:complete" — the only sanctioned call site in this skill.
applies_to: researcher
---

`skills/review/SKILL.md` step 6 (lines 88–104) is the sole scope_drift emit call site for the review skill. It calls `hive/lib/scope_drift.py::emit_scope_drift(phase_label="review:complete", skill="review", extra_dimensions={"verdict": ...})`. The `expected_scope` is the diff file list; `delivered_scope` is what the reviewer actually evaluated. Per the feedback memo `feedback_scope_drift_emit_sites.md`, only 3 call sites exist (`plan:phase-c`, `execute:story`, `review:complete`) — do not add per-step emits.
