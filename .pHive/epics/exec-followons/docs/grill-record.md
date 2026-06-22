# Grill Record — exec-followons

**Source draft:** `.pHive/epics/exec-followons/docs/design-discussion.md`
**CONTEXT.md substrate:** present
**inconsistency_risk_signals:** absent (heuristic pass — this design node received only `requirement`, no research-brief)
**Generated:** 2026-06-22 (plan node `design`, Phase A2)

## Summary

- Vocabulary mismatches: 2 findings
- Hidden assumptions: 2 findings
- Unresolved tensions: 2 findings
- Convention violations: 1 finding
- Posture mismatches: 1 finding

## Vocabulary mismatches

- **V1** — Draft uses "Wave 0/1/2/3" to group *work items* before stories exist; CONTEXT.md defines **Wave** as "a sequencing label (W0, W1, …) **on stories** that gates dependency ordering."
  - Draft location: §3 ("I'd sequence this as four waves…")
  - Reference: `.pHive/CONTEXT.md` → Terminology → Wave
  - Question for planner: rename the item-grouping axis (e.g. "tranche" / "sequence group") so "wave" stays reserved for story-level sequencing, or explicitly note these waves *become* the story waves at decomposition?

- **V2** — Draft's "bounded converge-loop" (item 6) overlaps the already-defined **Outcomes loop** ("iterative review-fix loop with rubric-format grading; wraps `/review` per CWC 2026 slice s15", CONTEXT.md) without ever reconciling the two terms. A reader can't tell if the new primitive *is* the outcomes loop lowered into the DAG, a different thing, or a rename.
  - Draft location: §1, §3 Wave 3, §6 Q1–Q2
  - Reference: `.pHive/CONTEXT.md` → Terminology → Outcomes loop
  - Question for planner: is the converge-loop primitive the DAG-level realization of the existing outcomes loop (and should cite it), or a distinct primitive? Name the relationship.

## Hidden assumptions

- **H1** — Draft assumes review's fresh Multica checkout (item 2) is a checkout of the **epic branch**, so "push to epic branch per implement node" makes the work visible. The ref the review Multica issue actually checks out is not verified in the research.
  - Draft location: §3 Wave 2-parallel ("review's fresh Multica checkout of the epic branch then simply contains the work")
  - Why this matters: if the review node checks out `main`/default or its own `agent/<persona>/<task>` branch rather than the epic branch, pushing to the epic branch does not fix the stale-tree bug — the whole preferred mechanism fails silently.
  - Question for planner: should item 2's first task be to confirm which ref `MulticaAgentSpawn` hands the review agent, before committing to the push-to-epic-branch mechanism?

- **H2** — Draft's whole item-4 fix direction rests on "re-dispatching a terminal issue no-ops" — inferred from cli.mjs idempotency, hedged as "strongly suggests," but the sequencing treats the fix as needed.
  - Draft location: §2 ("strongly suggests…no-ops"), §3 Wave 2, §4 [medium]
  - Why this matters: if the live instance shows re-dispatch *does* re-run a terminal issue, item 4 collapses to a verify-only story and the under-run guard is already correct — the wave's "fix" half evaporates.
  - Question for planner: state explicitly that item 4's fix scope is conditional on the investigation outcome, including the "no fix needed" branch, so the story isn't padded with a fix that may not exist.

## Unresolved tensions

- **U1** — Item 1 (add a *halting* `gate-review` to tdd/bdd) and item 6 (convert halting gates into *converging* loops) are sequenced as build-then-rewrite (Wave 0 then Wave 3) without resolving whether that's rework.
  - Draft location: §3 Wave 0 vs Wave 3; §6 Q5 surfaces it but does not resolve
  - Tension: item 1 ships a halting gate that item 6 may immediately replace with a converging one in the same files.
  - Question for planner: is item 1 a deliberate ship-the-safe-stopgap-now decision (halting gate is strictly better than today's silent integrate, and converging is a later upgrade), or should item 1's tdd/bdd gates be designed loop-ready so item 6 wraps rather than rewrites them?

- **U2** — Item 2 picks "push to epic branch per implement node" as the preferred mechanism in §3, then in §4 [high] admits parallel backend/frontend pushes can race and may need reconcile-style serialization — the preference and the race aren't reconciled into a single recommendation.
  - Draft location: §3 Wave 2-parallel vs §4 [high] "push to epic branch per implement node can race"
  - Tension: the recommended mechanism carries an unmitigated concurrency risk in the same document.
  - Question for planner: does the recommendation become "push to per-node refs the review checkout fetches" (avoiding the shared-branch race), or "serialize the push through the existing reconcile ordering"? Pick one as the design's lead option.

## Convention violations

- **C1** — Mirrored `gate-review` node carries `agent: validator`. CONTEXT.md's roster enumeration (researcher, developer, tester, reviewer, peer-validator, architect, analyst, tpm, ui-designer, technical-writer, pair-programmer, team-lead, + specialists) does not list `validator`; the roster memo (`feedback_use_roster_agents`) forbids off-roster agents.
  - Draft location: §3 Wave 0 ("agent `validator`")
  - Convention: `.pHive/CONTEXT.md` → Roster; `feedback_use_roster_agents` memo
  - Question for planner: is `validator` an accepted gate-node pseudo-agent (gate nodes are `node_type: gate` and don't spawn a real persona, and the existing classic `gate-review`/`gate-code`/`gate-tests` already use it) — in which case note it as inherited-and-justified — or should gate nodes use an on-roster name?

## Posture mismatches

- **P1** — Item 6 adds a new primitive to the executor's closed `NodeType` enum / graph core. Project North Star is "composable substrate, user-directed"; growing the core primitive set is a substrate change that the draft justifies functionally (generalizes `retry`) but does not check against the composability posture.
  - Draft location: §3 Wave 3 (schema), §4 [high] "reopens the No LOOP design lock"
  - Posture reference: `.pHive/CONTEXT.md` → Composability / "Mattpocock posture"; `project_hive_2_0_milestone` memo
  - Question for planner: confirm the loop primitive is the minimal substrate addition (loop-as-handler over an acyclic node-set, no new user-facing surface) and is justified as substrate the user *directs* (declares in workflow yaml) rather than a director-chair control-flow bolt-on.

## Notes

The draft is internally coherent and well-grounded in the #316 base (verified: `_MUST_NOT_EQUAL` predicate, `gate-review` node + edge, #13 channel on dev-classic steps, `.pHive/dag-outputs/` gitignore line all exist on `feat/dag-execute-node-outputs`). The findings above are sharpening, not structural rejection. The two highest-leverage items to resolve before stories are H1 (does push-to-epic-branch actually fix item 2?) and U1 (build-then-rewrite between items 1 and 6).

## Out of scope (this pass)

Grill does NOT propose solutions, score quality, gate work, or prioritize findings. Each finding ends with a question for the planner; the planner's job is to revise the draft (or document accepted deviations) before stories are written.
