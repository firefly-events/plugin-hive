# Design Discussion — Human-readable Changelog Entries

**Epic:** changelog-human-summaries
**Date:** 2026-06-12
**Author:** technical-writer (revised after grill + team reviews)

---

## §0 Prelude

git_flow resolved at plan time: base_branch=develop, branch_strategy=per-epic (source: plugin defaults).

---

## 1. What Are We Doing?

Goal: every CHANGELOG.md release entry tells a human reader what changed and why — not just which PRs merged or which version bumped.

The good entries — 2.11.0, 2.10.0, 2.9.0 — have bold taglines and detailed feature bullets. All were hand-crafted in `chore(release)` commits by maintainers outside the skill pipeline. The skill pipeline writes nothing prose-quality today.

"Done" looks like: every release entry (going forward) has a human-readable tagline, at least one prose sentence per major change, and PR refs relegated to suffix notation. The skill pipeline enforces this by authoring a draft entry at the correct callsite and optionally gating on quality at ship time.

**Ghost confirmation (researcher + TPM evidence):** The string "release finalization" — the step 7e template line — has **never appeared** in any committed CHANGELOG.md entry in the full repository history. All entries are manually authored via `chore(release)` or agent docs-step commits. Step A as originally written (extend step 7e) proposes modifying a callsite that does not fire in practice. Story 1 investigates and picks the correct callsite before any authoring change is made.

---

## 2. What I Found

**The only automated CHANGELOG writer is execute step 7e** (`skills/execute/SKILL.md:342-384`) — but its template line has never appeared in committed history (researcher: `grep 'release finalization' CHANGELOG.md` → zero matches across full git log). Either step 7e never fires in the normal flow, or its output is always replaced before commit.

**Ship step 3 is a gate, not an author** (`skills/ship/SKILL.md:124-165`). Checks structural presence only. Right place to add a quality check — cannot produce prose.

**Rich narrative already exists in release_post.mjs** (`hive/lib/release_post.mjs:81-99`). Graceful degradation chain: `outcome ?? description_summary ?? firstSentence(description) ?? title`. This is the authoring spec for CHANGELOG bullets.

**Good entries are manually authored.** Versions 2.11.0, 2.10.0, 2.9.0 entered via `chore(release)` commits. Format works; the gap is process discipline.

**Story YAML `outcome:` fields are absent.** Sampled 3 shipped YAMLs across 2 epics — no story carries a top-level `outcome:` field (researcher evidence). The absence is the current normal, not an edge case. Any prose-authoring step must use the release_post.mjs degradation chain from day one.

**Constraint: shippedStories data source unconfirmed.** `release_post.mjs` reads `shippedStories[]` — how this aggregation is built and whether it is reachable at the authoring callsite is an unanswered question from the raw findings.

**`step-08-integrate.md` unchecked.** `hive/workflows/steps/development-classic/step-08-integrate.md` was not analyzed — directly relevant to per-story vs per-epic aggregation and remains unresolved.

---

## 3. My Proposed Approach

Four stories in dependency order:

**Story 1 — Ghost-risk investigation + callsite decision**

Trace `git log --follow -p -- CHANGELOG.md` to confirm whether step 7e ever fires, and follow one live `/execute` run to identify where CHANGELOG is actually written. Output: an explicit recorded decision among three branches:
- (a) Extend step 7e — only if confirmed to fire in normal flow
- (b) Add chore(release) authoring guidance — if step 7e output is always replaced
- (c) Add a new dedicated authoring step in `/execute` before step 7e

Stories 2–4 are written against the branch outcome, not against a pre-committed callsite.

**Story 2 — `hive/references/changelog-entry-format.md` (MANDATORY single source)**

Canonical format spec: tagline structure, bullet shape, PR-ref-as-suffix rule, prose quality criteria. Both /execute (authoring) and /ship (gating) cite this document. Not optional. Resolves P1.

Authoring spec embedded in the reference doc: draft each bullet from `outcome` if present, else from story title + first sentence of description. Mark degraded-source bullets (e.g., `<!-- degraded: sourced from description -->`). Never block, never hallucinate. Source chain: `outcome ?? firstSentence(description) ?? title + acceptance_criteria`.

Listed option (not in scope for this epic): `/plan` captures a one-line `changelog_summary` per story at planning time — gives the authoring agent richer data. Explicit deferral.

**Story 3 — Authoring change at the callsite selected by story 1**

Add prose authoring instruction at the confirmed callsite, authored against `hive/references/changelog-entry-format.md`. Operator review of the draft is required before /ship runs.

**Story 4 — /ship step 3 advisory quality check + operations-guide docs update**

Check: agent judgment with stated criteria from `hive/references/changelog-entry-format.md`. Advisory only in this epic — warn + instruction, no hard block. Hard gate = listed deferral (revisit after operators validate authoring output from a real release).

Operations-guide release section + format reference link is an **acceptance criterion** of this story, not optional. Resolves C1.

**Explicit deferrals (listed with rationale):**
- `release_post.mjs` → CHANGELOG one-way bridge: real option, code work, would tip scale to Medium. Deferred.
- Hard-blocking /ship gate: listed deferral; decision after operators see real authoring output.
- Populate `outcome` at integrate time: separate deferrable follow-up; out of scope for this epic.

**On narrative-path duplication (U2):** Two independent paths reading the same story fields are accepted explicitly for this epic. The reference doc is the shared format anchor that prevents prose divergence. CHANGELOG and release_post serve different audiences and formats; duplication is tolerable here. One-way bridge is a listed deferral.

---

## 4. What Could Go Wrong

**High — Ghost confirmed, callsite still unknown.** Step 7e never fires in committed history (researcher-confirmed). Story 1 must resolve the callsite before any authoring change is safe.

**Medium — Degraded-source bullets are the day-one baseline.** All current stories lack `outcome:` fields. The fallback chain is the primary path, not a fallback. Degraded-source marking makes this visible to operators; it is expected, not exceptional.

**Medium — shippedStories data source unconfirmed.** How `release_post.mjs` aggregates `shippedStories[]` is unconfirmed. If the aggregation is unavailable at the authoring callsite, story 3 must adapt. Constraint for story 3, not a design blocker.

**Low — /ship gate quality drift.** Agent judgment gate with advisory output will vary between runs. Criteria in the reference doc bound the drift; advisory posture makes non-reproducibility acceptable in this epic.

---

## 5. Dependencies and Constraints

- Story 1 (investigation) must close before story 3 (authoring implementation).
- Story 2 (reference doc) must exist before stories 3 and 4 can cite it.
- **Constraint:** `## [Unreleased]` must exist in CHANGELOG.md before /ship step 3 runs.
- **Constraint:** CHANGELOG.md is append-only. No retroactive edits to existing entries.
- **Constraint:** shippedStories data source unconfirmed — story 3 must verify data is reachable at the selected callsite before writing authoring instructions.
- No external dependencies. Prose/template work in skill files and one reference doc.
- No cross-team coordination required.

---

## 6. Open Questions

1. **Which callsite does story 1 select?** (step 7e / chore(release) guidance / new /execute step) — answer blocks story 3. Ghost is confirmed; correct hook is not yet determined.

2. **step-08-integrate.md: per-story vs per-epic aggregation.** `hive/workflows/steps/development-classic/step-08-integrate.md` was not analyzed. Relevant to how shippedStories data is built and whether per-story changelog content is aggregated at integrate time or only at execute/ship time.

3. **Who authors the tagline?** Default for this epic: authoring-callsite agent drafts, operator reviews before /ship. Options: (a) agent drafts; (b) human-written prerequisite; (c) captured at plan time via `changelog_summary`.

4. **Advisory → hard gate transition.** After operators validate real authoring output, should /ship step 3 become a hard blocker? When and who decides? Listed deferral.

---

## 7. Verification Strategy

```
VERIFICATION PLAN:
  Tools: manual review, git log, shell grep
  Platforms: plugin-hive repo only
  Automated: none (prose quality cannot be unit-tested)
  Manual:
    - Story 1: git log archaeology + /execute trace confirms callsite and branch decision
    - Story 2: reference doc exists and is citable; format criteria are explicit
    - Story 3: test-epic /execute run produces prose block at selected callsite;
               degraded-source bullets marked; operator can review before /ship
    - Story 4: /ship warns on prose-free entry; operations-guide reflects new release flow
  Not verifying:
    - Historical entry quality (out of scope — new releases only)
    - release_post artifact content (separate surface, not touched)
    - Prose quality judgment (human review is the gate; AI bullets may be bland)
```

---

## 8. Scale Assessment

```
SCALE DECISION: Small

RATIONALE: Worst-case branch outcome (step 7e is a ghost; authoring moves to a new /execute
step or chore(release) guidance) is 2-3 skill-file prose edits + one reference doc. The ghost-
risk investigation is a bounded story inside a Small plan — it changes WHERE prose lands, not
HOW MUCH work exists. No migrations, no code, no cross-team coordination. Medium routing would
add overhead without clarity (design §8 rationale confirmed by TPM review).

Files affected: ~3-4 (reference doc, execute/SKILL.md or chore-release guidance,
                       ship/SKILL.md, operations-guide)
Subsystems: changelog authoring pipeline (execute + ship)
Migration required: no
Cross-team coordination: no
Unknowns: 2 (correct callsite — resolved by story 1; shippedStories data source)

RECOMMENDATION: Proceed to stories
```

---

## 9. Team Review Summary

| Finding | Resolution |
|---------|------------|
| **U1** — plan commits to step 7e callsite before investigating | Story 1 is now a callsite investigation with explicit 3-way branch decision; stories 2–4 written against outcome, not pre-committed callsite |
| **H1** — assumed `outcome:` fields populated; no fallback designed | Researcher-confirmed absent in all sampled YAMLs; release_post.mjs degradation chain adopted as primary authoring spec; degraded-source marking required |
| **V1** — "Small-to-Medium" not a routable scale value | Bound to `Small`; rationale: worst-case branch is ≤3 skill-file prose edits + ref doc; confirmed by TPM |
| **P1** — format spec embedded inline; reference doc "optional" | `hive/references/changelog-entry-format.md` is MANDATORY single source; both skills cite it |
| **C1** — docs update listed as optional | operations-guide/README update is acceptance criterion of story 4, not optional |
| **U2** — declines code bridge but creates duplicate prose authoring path | Duplication accepted explicitly for this epic; reference doc is shared format anchor; release_post bridge = listed deferral (code work, scale) |
| **H2** — gate enforcement mechanism unspecified | Agent judgment with stated criteria from reference doc; advisory only this epic; hard-block = listed deferral |
| **Ghost confirmed (researcher + TPM)** | Evidence drives story 1 structure; §1 and §4 updated to reflect confirmed-not-hypothetical risk |
| **outcome fields absent (researcher)** | Current-normal documented; degradation chain is primary path; populate-at-integrate-time = explicit deferral |
| **step-08-integrate.md unchecked (researcher)** | Added as open question §6.2 |
| **shippedStories data source unconfirmed (researcher)** | Listed as constraint in §5; story 3 must verify before writing authoring instructions |
