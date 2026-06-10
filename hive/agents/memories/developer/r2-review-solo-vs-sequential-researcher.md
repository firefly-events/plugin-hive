# r-2: Solo reviewer dispatch — researcher is an internal agent() call, not a separate Multica issue

When implementing `review-mode-multica`, the naive reading of `test-mode-multica` (one
tester → one issue) maps cleanly to review. But `skills/review/SKILL.md` Phase 1 actually
dispatches TWO agents sequentially: researcher (Step 3a scope analysis) then reviewer
(Step 3b critique).

The resolution: the **reviewer** is the Multica assignee. The brief instructs the reviewer
to spawn the researcher as an internal `agent()` call — same pattern as dr-2 (design-review-
mode-multica) where the ui-designer internally runs 4 agent() calls. The outer Multica issue
has ONE assignee (`reviewer`); the researcher lives inside that run. This preserves the solo
reviewer contract (no panel-mode, no multi-issue fan-out) while still running the full Phase 1
two-step workflow.

DO NOT create a separate Multica issue for the researcher. That would be panel-mode, which is
explicitly DEFERRED per Decision Point 2.
