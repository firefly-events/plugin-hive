# Grill Record — kg-repair-activation

**Source draft:** `.pHive/epics/kg-repair-activation/docs/design-discussion.md`
**CONTEXT.md substrate:** present
**inconsistency_risk_signals:** present (5 signals lifted from research-brief)
**Generated:** 2026-05-26T07:00:00Z

## Summary

- Vocabulary mismatches: 1 finding
- Hidden assumptions: 3 findings
- Unresolved tensions: 2 findings
- Convention violations: 2 findings
- Posture mismatches: 1 finding

## Vocabulary mismatches

- **V1** — "live" is used for two distinct states without disambiguation.
  - Draft location: line 38 ("`phase_failed` ... yes") vs line 67 ("DAG walker already emits ... at step boundaries")
  - Reference: `research-brief.md:43` distinguishes "actually fires" from "documented path"
  - Question for planner: should story YAMLs adopt a 3-state taxonomy — `declared`, `documented` (path exists, no live caller), `firing` (verified in DB) — and use it consistently in acceptance criteria so each story has a measurable transition?

## Hidden assumptions

- **H1** — Density math (`§2 / Why Shape 2`) assumes 3 new source agents × N active epics ≈ 6-9/day without naming N or showing the arithmetic.
  - Draft location: line 51 ("Shape 2 with 3 new source agents + 5 lifecycle predicates fires ~6-9/day naturally per active epic")
  - Why this matters: if active-epic count is 1-2 (currently we average ~1 in-flight), the math collapses to 2-3/day and Shape 2 misses the target.
  - Question for planner: anchor the math to a measurable substrate — e.g. "given the trailing-30-day commit count and ~3 active stories/week, Shape 2 should produce ≥X/day; if it produces <Y, escalate to a follow-on" — or downgrade the target.

- **H2** — Draft assumes DAG walker emits actually reach `~/.claude/hive/kg.sqlite`.
  - Draft location: line 14 ("DAG walker (`walker.py:944,954`) ... fires"), line 67 ("DAG walker already emits `phase_blocked`/`phase_failed`")
  - Why this matters: audit shows only **1 `phase_blocked` triple** in the DB (from `/plan` step 10, not from DAG walker). If DAG walker fires hundreds of times per epic, they're not landing in this DB — either separate DB, FK violation silently dropped, or an emit-on-write gate keeping them out.
  - Question for planner: add an investigation story (or fold into a repair story) that confirms WHERE DAG walker emits land, before assuming `phase_started`/`phase_complete` wired into the same site will help.

- **H3** — `/hive:why` fix described as "~3 lines" without locating the catch site.
  - Draft location: line 78 ("Recommendation: (a) first")
  - Why this matters: the brief notes the crash propagates from the ChromaDB provider — the catch could be inside `_extract_chroma_response` (line 292), at the call site (line 213), or in `query_chromadb` itself. Each placement has different blast radius (e.g. a wrap at line 213 hides ALL provider errors, not just the iteration bug).
  - Question for planner: name the catch location in the story AC, and require the story to add a log line on catch (already noted as risk-mitigation; promote to AC).

## Unresolved tensions

- **U1** — D2 says "wire `phase_started`/`phase_complete` in DAG walker alongside existing emits, NOT new emit sites" — but H2 shows existing emits don't land in audited DB. The fix path therefore EITHER also touches the silent-drop path (broader than "same call site") OR the new emits will inherit the same silent failure.
  - Draft location: lines 67-69 (D2) vs research-brief line 43 ("DAG walker — `phase_blocked`, `phase_failed` — Actually fires")
  - Tension: the draft treats wiring as a same-site additive change; if the silent-drop bug is upstream of the call site, story sequencing needs the investigation first.
  - Question for planner: resolve order — investigation story BLOCKS phase-lifecycle wiring, or wiring story HANDLES the silent-drop fix as part of its scope?

- **U2** — `phase_handoff` decision (D4: add to schema) vs the broader question of whether undeclared predicates should be silently inserted at all.
  - Draft location: lines 84-88 (D4) — proposes adding `phase_handoff`, but doesn't address the class of bug ("undeclared predicates emit without raising")
  - Tension: declaring `phase_handoff` fixes this one case but leaves the schema enforcement gap. The unique-triple index covers (subject, predicate, object, source_epic) but predicate→predicates-table FK enforcement isn't audited in the draft.
  - Question for planner: add a story (or expand D4's story) that audits FK enforcement on `predicate REFERENCES predicates(predicate)` — current schema declares the reference (research-brief §schema row in raw-research §3), but if SQLite isn't enforcing it (`PRAGMA foreign_keys=ON` not set?), the bug class persists.

## Convention violations

- **C1** — Draft says scope_drift memory tension "may evaporate" but does NOT verify before relying on the resolution.
  - Draft location: line 70 ("memory clarified: was about scope_drift, NOT KG — tension may evaporate")
  - Convention: `~/.claude/projects/-Users-don-Documents-plugin-hive/memory/feedback_scope_drift_emit_sites.md` is feedback-class memory; per the auto-memory protocol, feedback memories carry **Why:** + **How to apply:** lines that should be consulted, not paraphrased away.
  - Question for planner: should a story explicitly verify the memory's scope (re-read the memo, confirm it's scope_drift-only) and, if the tension actually evaporates, update the memo with a "see also kg-repair-activation epic — does NOT apply to KG emit sites" line so the next planner doesn't reopen the same question?

- **C2** — Insights-before-shutdown is named but not load-bearing.
  - Draft location: line 47 ("via insights-before-shutdown contract (already exists per `feedback_insights_before_shutdown`)")
  - Convention: `feedback_insights_before_shutdown` says "always capture agent insights before sending shutdown requests" — this is a hook point but the discussion treats it as a write-trigger ("emit one validated/tested/implemented per role per story"). Insights are a free-text capture; new predicates need a structured emit, not insight-text.
  - Question for planner: clarify whether the new emits hook into the insights-capture pre-shutdown sequence (and how — same call, parallel call, post-hook?) or use a separate per-step write that the agent emits independently.

## Posture mismatches

- **P1** — meta-optimize consumer impact treated as a risk rather than an architectural design point.
  - Draft location: line 95 (risks table row: "Adding new predicates breaks meta-optimize step-02c consumer")
  - Posture reference: composable-substrate posture — `step-02c-kg-signal.md:79` is the contract surface between KG and ranking; predicate additions are a contract change, not a side-effect risk.
  - Question for planner: should new predicate stories carry an explicit `step-02c` update as part of their AC (contract-change pattern), rather than treating it as downstream cleanup?

## Notes

- The recommendation seed already deferred graphify to a follow-on epic — that decision is clean and shouldn't be re-opened here.
- Open question Q3 ("`/hive:kg-stats` skill") is genuinely cheap and would have caught H2 above on the first run. Strong candidate for a no-deps quick-win story.
- D1 → wire-up plan currently adds 3 predicates (validated/tested/implemented) but §2 Shape 2 references "3-4 new predicates" — minor count inconsistency, but Shape 2's "3-4" should be reconciled (likely the 4th is `phase_handoff` from D4).

## Out of scope (this pass)

Grill does NOT propose solutions, score quality, gate work, or prioritize findings. Each finding above ends with a question for the planner; the planner's job is to revise the draft (or document accepted deviations) before stories are written.
