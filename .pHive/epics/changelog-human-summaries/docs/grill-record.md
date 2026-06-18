# Grill Record — changelog-human-summaries

**Source draft:** `.pHive/epics/changelog-human-summaries/docs/design-discussion.md`
**CONTEXT.md substrate:** present
**inconsistency_risk_signals:** present (research-brief §7, 3 signals)
**Generated:** 2026-06-12T13:55:00Z

## Summary

- Vocabulary mismatches: 1 finding
- Hidden assumptions: 2 findings
- Unresolved tensions: 2 findings
- Convention violations: 1 finding
- Posture mismatches: 1 finding

## Vocabulary mismatches

- **V1** — §8 recommendation says "Proceed to stories" without binding to the scale enum; narrative says "Small-to-Medium" (line 151) while the assessment block implies Small.
  - Draft location: lines 151, 161 ("RECOMMENDATION: Proceed to stories")
  - Reference: `/plan` step 5 requires `SCALE DECISION: [Small | Medium | Large]` — Medium routes through H/V planning, Small does not. "Small-to-Medium" is not a routable value.
  - Question for planner: commit to Small or Medium explicitly — does the ghost-risk investigation tip this to Medium, or is it a story inside a Small plan?

## Hidden assumptions

- **H1** — Draft assumes story YAML `outcome` fields are populated and readable at step 7e execution time, with no fallback designed if they are not.
  - Draft location: line 65 ("The `shippedStories` data available to `release_post.mjs` ... is the model — step 7e should use the same fields")
  - Why this matters: research-brief Q2 states it is unknown whether `outcome` is populated at plan time, execute time, or only at ship reconcile. If absent at 7e, Step A produces empty or hallucinated bullets — worse than the current mechanical line.
  - Question for planner: what is the fallback when `outcome` is empty at 7e — block, draft from story title + AC only, or defer authoring to ship-time reconcile?

- **H2** — Draft assumes the /ship step 3 prose-quality check is mechanically enforceable ("at least one prose sentence", "no bullet is purely a PR number").
  - Draft location: lines 69-72
  - Why this matters: "prose sentence" detection is agent judgment, not a grep. Unspecified enforcement means the gate's behavior will drift between runs; an advisory warning whose trigger is fuzzy trains operators to ignore it.
  - Question for planner: specify the check's mechanism — regex heuristics (deterministic, coarse) vs agent judgment (accurate, non-reproducible) — and which failure mode is acceptable.

## Unresolved tensions

- **U1** — Draft commits Step A to extending step 7e while simultaneously rating "step 7e may be a ghost" as the single High risk and gating implementation on resolving it.
  - Draft location: lines 49, 83, 98, 108
  - Tension: the proposed approach pre-commits to a callsite whose validity is the top open question. If the investigation lands "always overwritten by chore(release)", Step A as written is dead prose.
  - Question for planner: should the plan's first story be the investigation with an explicit branch (7e-extension vs chore(release)-guidance vs new step), rather than baking the 7e callsite into the approach?

- **U2** — Draft declines a release_post→CHANGELOG bridge to avoid "a second narrative code path and drift risk" (line 75), yet Step A creates a second narrative *authoring* path modeled on the same `shippedStories` fields (line 65).
  - Draft location: lines 65, 75
  - Tension: two independent generators reading the same story fields and producing diverging narrative is exactly the drift the draft says it avoids. Declining the code bridge does not dissolve the duplication; it relocates it to prose instructions.
  - Question for planner: accept the duplication explicitly (with a stated sync convention), or reconsider a one-way pull (CHANGELOG block seeds the release post highlights, or vice versa)?

## Convention violations

- **C1** — Draft changes operator-facing release behavior (/execute writes a prose block; /ship gains a gate) but plans no user-docs update; the reference doc is marked "optional".
  - Draft location: lines 144, 155 ("optional reference doc")
  - Convention: `feedback_new_command_needs_user_docs` — behavior changes invisible outside SKILL.md don't count as shipped; README/operations-guide must reflect the new release flow expectations.
  - Question for planner: add an explicit docs story (operations-guide release section + format reference), or justify why skill prose alone suffices?

## Posture mismatches

- **P1** — Format spec (tagline + bullet shape + PR-ref-as-suffix rule) is embedded inline in two skills' step prose with the shared reference doc left optional.
  - Draft location: lines 53-65 (template inline in Step A), 69-72 (quality criteria inline in Step B), 155
  - Posture reference: composable-substrate / atomic-skill posture (CONTEXT.md "Mattpocock posture", `.pHive/epics/hive-composability-audit/docs/recommendation.md`) — two skills enforcing one format must cite a single canonical reference, not carry divergeable copies.
  - Question for planner: make `hive/references/changelog-entry-format.md` (or similar) the mandatory single source, with execute authoring against it and ship gating against it?

## Notes

The draft is internally honest — its §4 risks and §6 open questions already surface most of what this pass found; the gap is that the proposed approach doesn't yet *bend* to those admissions (U1, H1). Overall coherence is good; findings are resolvable by restructuring story order and hardening two decisions, not by redesign.

## Out of scope (this pass)

Grill does NOT propose solutions, score quality, gate work, or prioritize findings. Each finding ends with a question for the planner; the planner's job is to revise the draft (or document accepted deviations) before stories are written.
