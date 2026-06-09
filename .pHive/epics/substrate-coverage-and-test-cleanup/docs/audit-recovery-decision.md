# Audit Recovery Decision — a-0-audit-recovery

**Epic:** substrate-coverage-and-test-cleanup
**Story:** a-0-audit-recovery
**Date:** 2026-06-05
**Branch taken:** (c) — accept-risk (single-citation acceptance)

---

## 1. What Risk We Accept

**Gate-ownership invariant — single-citation exposure.**

Constraint 5 (design-discussion §5) asserts that mode skills produce artifacts but never advance review/sign-off gates. This invariant was originally grounded by two citations: (a) the plan-mode-validation audit, and (b) the cc-workflows smoke audit (`cc-workflows-smoke-1780516800.yaml` referenced in structured-outline line 115).

The smoke audit does not exist anywhere on disk. An exhaustive `find .pHive -name 'cc-workflows-smoke-*.yaml'` across all subdirectories — including `post-run/`, `smoke-test/`, `mvl-proof/`, `mvs-proof/`, all episode dirs, and the worktree root — returned zero results. Branch (a) is closed; the file was never written or was purged.

Branch (b) was assessed as infeasible within the 0.5-day budget. The prior cc-workflows "smoke" was not an automated target but a manual one-shot Phase 0 capability spike (Run 2, 2026-06-02) executed via the Workflow tool runner against a purpose-built test epic (`smoke-test-execute-multica-codex`). No turn-key shell script, vitest target, or CI entry point exists to reproduce it without a full Workflow-tool runner session + new test epic + audit-writer instrument.

**Risk accepted:** Constraint 5 proceeds on a single-citation grounding for the duration of this epic. If the gate-ownership invariant is violated by any story implementation, the Slice 2 manual smoke (see §3) is the first runtime tripwire — not a second audit citation.

---

## 2. What Corroboration Replaces the Missing Citation

**Sole remaining grounding artifact:**

`.pHive/audits/post-run/cc-workflows-first-party-plan-mode-validation-2026-06-05.yaml`

This audit (substrate-validation, `audit_kind: substrate-validation`, timestamped 2026-06-05T00:00:00Z) records a live plan-mode-cc-workflows run against the hermes-guardrails-mvp epic on the feat/hermes-guardrails worktree. It confirms:

- `agent_type: default workflow subagent` throughout — no Codex routing
- `observed_branch` and `observed_cwd` both resolve to the correct isolated worktree
- Phase A research dispatch completed with `verdict: PASS`
- PR #241 commit `8c41671` explicitly forbids Codex `agentType` in cc-workflows mode (substrate finding fix)

This audit covers the **gate-ownership invariant from the plan-mode side**: the skill produced a research artifact (`research-findings.md`) without advancing any review or sign-off gate. The gate-ownership invariant is therefore grounded for the `/plan` cc-workflows substrate.

The missing smoke audit would have extended coverage to the `/execute` cc-workflows substrate. That runtime gap is the material exposure under §1.

**Additional corroboration (runtime, not a formal audit):**

`.pHive/epics/cc-workflows-first-party/docs/spike-findings.md` Run 2 PASS result (2026-06-02) and the `cwfp-s2-3/integration-test-run.yaml` artifact confirm that the `/execute` cc-workflows substrate ran end-to-end with a clean gate-ownership posture. This is informal evidence, not a citeable audit; it provides reasonable confidence but does not close the citation gap.

---

## 3. What Runtime Carrier Substitutes

**Substitute runtime carrier: Slice 2 manual smoke on the bounce-back.**

Per design-discussion §7 (Verification Strategy), every new mode skill requires a manual smoke run at ship time. The Slice A `t-3` story (`test-mode-cc-workflows`) is the earliest cc-workflows mode skill in the epic. Its manual smoke — running a test scenario through the new `test-mode-cc-workflows` skill end-to-end on an isolated worktree — acts as the runtime verification carrier for the gate-ownership invariant.

Specifically, the tester executing the `t-3` smoke MUST assert: the skill produced test output artifacts (episode markers, scenario results) without calling `completeStory()`, `advanceGate()`, `markReviewPassed()`, or any equivalent gate-advancement method. This assertion substitutes for what the missing smoke audit would have verified.

All four new `*-mode-cc-workflows` skills (`t-3`, `d-4`, `dr-3`, `r-3`) carry this same gate-ownership assertion in their manual smoke checklist. The Slice 2 `t-3` smoke is the first and earliest verification point; the remaining three reinforce the invariant at each subsequent mode skill.

**Escalation trigger:** If the `t-3` manual smoke reveals a gate-advancement call in the new cc-workflows mode skill body, that is a blocking finding for all downstream cc-workflows stories. The reviewer step for `t-3` is the gate.

---

## 4. Design-Discussion §5 Update

The following verbatim text replaces the current Constraint 5 trailing clause in design-discussion §5. Splice point: end of the sentence currently reading "Single-citation pending smoke-audit recovery (see Risk #high #2)."

**Verbatim replacement text:**

> **Gate ownership invariant** — mode skills produce artifacts but never advance review/sign-off gates. *Source:* outline line 20, `plan-mode-cc-workflows/SKILL.md:26+80`. Single-citation accepted; recovery rationale at `audit-recovery-decision.md`. Runtime substitute: Slice A `t-3` manual smoke carries the gate-ownership assertion as its first verification point; all four `*-mode-cc-workflows` manual smokes reinforce it.

The design-discussion §5 Constraint 5 entry is updated to read this text verbatim. The phrase "Single-citation accepted; recovery rationale at audit-recovery-decision.md" is the canonical marker text that confirms branch (c) closed.
