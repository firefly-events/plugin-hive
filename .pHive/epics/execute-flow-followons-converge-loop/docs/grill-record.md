# Grill Record — execute-flow-followons-converge-loop

**Source draft:** `.pHive/epics/execute-flow-followons-converge-loop/docs/design-discussion.md`
**CONTEXT.md substrate:** present
**inconsistency_risk_signals:** absent (heuristic pass — this design node receives only `requirement`; the research brief is wired into the author node, not here)
**Generated:** 2026-06-22

## Summary

- Vocabulary mismatches: 1 finding
- Hidden assumptions: 2 findings
- Unresolved tensions: 3 findings
- Convention violations: clean
- Posture mismatches: clean

## Vocabulary mismatches

- **V1** — "wave" is used to mean *a group of implement nodes dispatched in parallel by the walker*, which shifts meaning from CONTEXT.md's definition of **Wave** as a story-level sequencing label (W0, W1, …; synonym for *slice*).
  - Draft location: §4 ("If two implement nodes run in the same wave, their reconciles could interleave") and §3.
  - Reference: `.pHive/CONTEXT.md` → Terminology → "Wave — a sequencing label (W0, W1, …) on stories".
  - Question for planner: should the draft use a distinct term (e.g. "parallel dispatch group" / "walker wave") to avoid colliding with the story-sequencing "Wave", or is the executor-internal reuse of "wave" acceptable in-context?

## Hidden assumptions

- **H1** — The draft assumes a per-node reconcile can be invoked *mid-flow* (after each implement node, before the gate) without redesign, but the cited `reconcile` node materializes committed work *pre-gate* only. Re-entrant, per-node reconcile is asserted as "lower-blast-radius" without evidence that the handler is safe to call repeatedly within a wave.
  - Draft location: §3 Story 2 ("I lean toward a per-node reconcile because reconcile already exists").
  - Why this matters: if reconcile is not re-entrant, story 2's preferred mechanism collapses and the fallback (per-node push) — which the draft argues leaks flow control into the agent — becomes the only option.
  - Question for planner: should story 2 carry a spike to confirm reconcile re-entrancy before committing to it as the mechanism, or pick the push mechanism up front?

- **H2** — Story 6 frames "teach `_dispatch_with_retry` to honor `retry_node`" as a localized change, but the walker currently only re-dispatches the **same** node (`walker.py:405`). Honoring `retry_node` means re-dispatching an *upstream* node and re-walking its dependents — a control-flow change to the walker, not a one-line field read.
  - Draft location: §3 Story 6 ("teach `_dispatch_with_retry` … to honor `retry_node`").
  - Why this matters: understating the walker change risks under-scoping the largest story and mis-sequencing its sub-split.
  - Question for planner: should story 6's walker-execution sub-story explicitly own "re-dispatch upstream node + re-walk dependents" as its scope, rather than implying a retry-field tweak?

## Unresolved tensions

- **U1** — The draft both *acknowledges* (§4) that overloading `Node.retry` conflates transient-failure retry with deliberate converge iteration, and *proposes* (§3) generalizing that same field. It surfaces the tension but does not decide whether the two concerns should stay as separate fields.
  - Draft location: §3 Story 6 vs §4 ("risks overloading one field with two meanings").
  - Tension: reuse `retry` (fewer concepts, but two semantics on one field) vs add a distinct `converge`/`loop` block (clearer, but a new schema concept).
  - Question for planner: one field with two meanings, or two fields — which does the maintainer want before story 6 schema work begins?

- **U2** — Story 4's fix paths are in tension: "reset issue status before dispatch" preserves the cached tracker id (and dedup), while "mint a fresh tracker id on each retry" forces a re-run but weakens cross-machine dedup (`_resolve_tracker_id`). The draft lists both (Q4) without leaning.
  - Draft location: §3/§6 Story 4, §4 ("easy to break dedup while fixing re-dispatch").
  - Tension: idempotent resume vs guaranteed re-execution.
  - Question for planner: is preserving dedup a hard constraint (forcing the status-reset path), or is a fresh tracker id acceptable when a deliberate retry is requested?

- **U3** — The requirement mandates **independently-shippable** stories, but the draft floats splitting story 6 into schema / walker / termination-resume / telemetry / tests (Q6). A schema change without the walker change ships nothing usable, so those sub-stories are not independently shippable in the requirement's sense.
  - Draft location: §3 Story 6 ("may itself warrant an internal split"), §8, §6 Q6.
  - Tension: "independently shippable" constraint vs a natural internal decomposition that is sequential-only.
  - Question for planner: does "independently shippable" apply at the epic-story level (story 6 ships as one) with any sub-split being internal-only, or must every emitted story stand alone?

## Convention violations

Clean. The draft respects one-branch-per-epic / one-commit-per-story (`feedback_git_flow_per_epic`), the PR < 150 file limit (`feedback_pr_file_count_limit`), and Python-canonical executor work (`CLAUDE.md`). No memo contradictions surfaced.

## Posture mismatches

Clean. The draft actively defends the composable-substrate posture — it rejects pushing flow control into the agent (§3 Story 2) and rejects a new `LOOP` node_type in favor of keeping the four-member `NodeType` enum (§3 Story 6), both consistent with the executor-owns-flow / minimal-primitive posture in `.pHive/CONTEXT.md`.

## Notes

- The term **converge-loop** is introduced by this epic and is not yet in `.pHive/CONTEXT.md`'s glossary. Not a finding against the draft, but if story 6 lands, the glossary should gain the term (substrate hygiene). Signal, not finding.

## Out of scope (this pass)

Grill does NOT propose solutions, score quality, gate work, or prioritize findings. Each finding ends with a question for the planner; the planner's job is to revise the draft (or document accepted deviations) before stories are written.
