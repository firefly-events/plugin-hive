# Insights: dpt-3 planning-classification skill

## The two-section trap in specialist-triggers.md

`specialist-triggers.md` has two distinct sections with very different semantics:
- `planning_composition` — compose-at-intake (step 1 of /plan), no `placement` field
- `Catalog` — raise-at-review-gate (escalation triggers, has `placement: pre-exec|post-exec|append`)

A future agent editing the catalog might accidentally add `placement` to composition entries
or read composition rows as triggers. The lifecycle note at the top of each section is load-bearing;
don't remove or merge them.

## Spine-self-sufficiency is a safety rail, not a fallback

The invariant "low-confidence → spine-only" exists because a wrong specialist is worse than no
specialist: an improvised persona can self-implement and bypass backend routing (documented in
memory `feedback_no_team_lead_intermediary`). When evidence is ambiguous, return the spine and let
the operator correct at the confirmation gate — don't guess.

## `architect` deduplication is the common case

Both `architecture` and `data` tags resolve to `architect`. In a requirement mentioning both
("add a data migration for the new schema design"), you get one `architect` in the roster (first
occurrence wins). The dedup-by-first-occurrence ordering rule matters; don't sort alphabetically.

## `has_ui` fallback heuristic is narrow by design

The `tech_stack` heuristic (presence of react/vue/html → infer has_ui) is a conservative
fallback for absent profiles, not a general inference engine. If the profile is present but
`has_ui` is missing, treat it as unknown (suppressed-unknown-ui), not as a reason to scan
tech_stack. The profile is the authoritative source.

## This skill is a pure function — keep it that way

No file writes, no agent spawns, no state mutation. The caller (/plan) owns all side effects.
This makes the skill safe to call from any runtime (local /plan today, Multica-hosted /plan
tomorrow) without coupling it to a specific execution substrate.
