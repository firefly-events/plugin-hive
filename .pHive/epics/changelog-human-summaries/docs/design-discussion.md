# Design Discussion — Human-readable Changelog Entries

**Epic:** changelog-human-summaries
**Date:** 2026-06-12
**Author:** technical-writer (from researcher raw findings)

---

## §0 Prelude

git_flow resolved at plan time: base_branch=develop, branch_strategy=per-epic (source: plugin defaults).

---

## 1. What Are We Doing?

The goal is simple to state: every CHANGELOG.md release entry should tell a human reader what changed and why, not just which PRs got merged or which version bumped.

Right now, the only thing a skill automatically writes to CHANGELOG.md is a single version-accounting line from `skills/execute/SKILL.md` step 7e:

> `**{epic-id} release finalization.** /execute applied the planned {version_bump} version bump...`

That line is correct but useless to a reader. The good entries in CHANGELOG.md — 2.11.0, 2.10.0, 2.9.0 — have bold taglines and detailed feature bullets that explain outcomes, not just mechanism. All of them were hand-crafted in `chore(release)` commits by someone outside the skill pipeline.

"Done" looks like: every release entry (going forward) has a human-readable tagline, at least one prose sentence per major change, and PR refs relegated to suffix notation rather than used as the content itself. The skill pipeline enforces this by authoring a draft entry at the right moment and optionally gating on quality at ship time.

---

## 2. What I Found

**The only automated CHANGELOG writer is execute step 7e** (`skills/execute/SKILL.md:342-384`). It runs after the last story's integrate step — exactly the right timing for aggregating all story outcomes into one entry. The template (L360-365) is mechanical: one line, version accounting only.

**Ship step 3 is a gate, not an author** (`skills/ship/SKILL.md:124-165`). It checks that `## [Unreleased]` exists and names the bump level. It verifies structural presence, not prose quality. This is the right place to add a quality check, but it cannot produce prose — by the time /ship runs, /execute has already written the entry.

**Rich narrative already exists, just not in CHANGELOG.** `hive/lib/release_post.mjs` reads `shippedStories[].title`, `.outcome`, `.sourcePath` from story YAML and generates `post.md` and `video-script.md`. This is exactly the data a CHANGELOG narrative block needs. The two surfaces are currently separate and never share content.

**Good entries are manually authored.** CHANGELOG versions 2.11.0, 2.10.0, 2.9.0 all have strong prose. They were entered via `chore(release)` commits — not via any skill. This confirms the format works; the gap is process discipline.

**The format supports prose.** CHANGELOG.md's header cites keepachangelog.com, which explicitly calls for prose bullets under Added/Changed/Fixed. Nothing about the format blocks this. The gap is authoring, not format.

**Inconsistency risk: step 7e line may be a ghost.** Good entries (2.10.0, 2.11.0) don't contain the version-accounting line that step 7e mandates. Either it gets edited out in the chore(release) commit, or the safety-net /ship path is the only trigger. Before extending step 7e, I need to confirm which path actually fires in the normal flow.

---

## 3. My Proposed Approach

The fix lives in two places, in this order:

**Step A — Extend execute step 7e to draft a prose entry.**

In `skills/execute/SKILL.md` step 7e, before (or alongside) the version bump line, instruct the executing agent to write a prose CHANGELOG block under `## [Unreleased]`:

```
## [Unreleased]

**{one-sentence tagline describing what this release does for users}**

### Added
- {feature/story title}: {one-sentence outcome describing user or developer impact}. (#{pr-ref})

### Changed / Fixed
- (as applicable, same format)
```

The tagline and bullets should be authored from the story outcomes already known at step 7e's execution point. The `shippedStories` data available to `release_post.mjs` (title, outcome) is the model — step 7e should use the same fields. PR refs go at the end of bullets, not as the content.

**Step B — Add a prose quality check to /ship step 3.**

In `skills/ship/SKILL.md` step 3, extend the existing structural check to also verify:
- At least one prose sentence exists (not just a version-accounting line)
- No bullet is purely a PR number with no description

This is a gate check only. If it fails, the operator is instructed to revise the entry before proceeding — ship does not auto-fix.

**What I'd leave alone:** `hive/lib/release_post.mjs` and the release-post artifacts. The temptation to bridge them to CHANGELOG is real, but it adds a second narrative code path and drift risk. Keep them separate; the CHANGELOG entry is written by step 7e as prose, not synthesized from release artifacts.

**Retroactive cleanup:** don't mandate it. The 0.x–1.1.x entries are weak but they're historical. Mark the scope as "new releases only."

---

## 4. What Could Go Wrong

**High — The step 7e ghost risk.** If the normal `/execute` flow never actually writes the step 7e line (because chore(release) overwrites it), then extending step 7e adds a prose requirement to a step that may not fire. I need to confirm via `git log CHANGELOG.md` whether the step 7e template line ever appears in committed changelog entries, or whether it's always replaced. If it's always replaced, the right authoring hook is the chore(release) process, not step 7e.

**Medium — AI-generated prose quality.** If step 7e instructs the agent to draft the tagline and bullets from story outcomes, the output will be agent-generated prose. It may be bland, inaccurate, or miss the "why." The /ship gate can catch missing prose but not bad prose. Consider: the instruction in step 7e should be explicit that the agent must draft prose AND the operator should review it before shipping.

**Medium — Story outcome data availability.** I'm assuming story outcomes (title, outcome) are available to the agent running step 7e. `release_post.mjs` reads these fields — but it's unclear whether step 7e has the same data context. If story YAMLs aren't in scope at step 7e execution time, the agent can't synthesize accurate bullets.

**Low — /ship quality gate friction.** A prose quality check that blocks a release for a weak CHANGELOG entry may frustrate operators who just want to ship. The check should be advisory (warn + instruction) before it becomes a hard gate. Start soft.

**Low — Convention drift.** The Mixed category entries (2.8.0, 2.7.0) have inline `(PR #220)` notations. If the new format requires PR refs as suffixes, existing strong entries have inconsistent style. Acceptable — we only enforce on new entries, not retroactively.

---

## 5. Dependencies and Constraints

- **Internal:** `/execute` step 7e must be modified before /ship quality gate can be added — adding a gate without fixing authoring means the gate always blocks.
- **Internal:** The step 7e ghost-risk investigation (see §4) must happen before implementation; the right callsite depends on how the normal flow actually works.
- **Constraint:** `## [Unreleased]` must exist in CHANGELOG.md before /ship step 3 runs. Any prose-authoring step must write there.
- **Constraint:** CHANGELOG.md is append-only. No retroactive edits to existing entries.
- **No external dependencies.** This is prose/template work in two skill files. No library changes, no API changes, no CI/CD changes.
- **No cross-team coordination required.** Both files are in plugin-hive; no other team's work is a dependency.

---

## 6. Open Questions

1. **Does the step 7e template line ever appear in committed CHANGELOG.md entries?** (i.e., does step 7e actually fire in the normal flow, or is it always replaced by a manual chore(release) commit?) This determines whether step 7e is the right authoring hook.

2. **Are story outcome fields (title, outcome) available to the agent executing step 7e?** `release_post.mjs` uses these fields to build narrative — does the same data context exist at step 7e execution time?

3. **Should the /ship quality gate be advisory (warn + instruction) or hard-blocking?** Recommend advisory first, with a path to hard-block after operators confirm the authoring flow produces acceptable prose.

4. **Who authors the tagline?** Three options: (a) step 7e agent drafts it, operator reviews; (b) step 7e requires a human-written tagline as a prerequisite; (c) a dedicated "write changelog" step is added to `/execute` before step 7e. Option (a) is simplest; option (b) is most reliable for quality.

5. **Scope of retroactive cleanup?** The requirement says "each release entry needs a textual summary" — does this mean historical entries need updating? Recommend scoping to new releases only to keep this Small.

---

## 7. Verification Strategy

This is prose/template work — no runtime code, no tests in the traditional sense. Verification is behavioral.

```
VERIFICATION PLAN:
  Tools: manual review, git log, shell grep
  Platforms: plugin-hive repo only
  Automated: none (prose quality cannot be unit-tested)
  Manual:
    - Run /execute on a test epic end-to-end; inspect CHANGELOG.md for the prose block
    - Confirm step 7e produces a tagline + feature bullets (not just the accounting line)
    - Run /ship on that entry; confirm step 3 passes with prose present and fails/warns without it
    - Grep CHANGELOG.md for the new format pattern to confirm correct placement under ## [Unreleased]
  Not verifying:
    - Historical entry quality (out of scope — new releases only)
    - release_post artifact content (separate surface, not touched)
    - Prose quality judgment (AI-generated bullets may still be bland — human review is the gate)
```

---

## 8. Scale Assessment

Two skill files modified (`skills/execute/SKILL.md` step 7e, `skills/ship/SKILL.md` step 3), plus a possible reference doc for the new CHANGELOG entry format. No code, no migrations, no new subsystems.

The bulk of the work is:
1. Writing the prose template and instructions for step 7e
2. Writing the quality check instructions for /ship step 3
3. Resolving the step 7e ghost risk (investigation + possible pivot to a different callsite)

The ghost-risk investigation is the only genuine unknown that could expand scope — if step 7e doesn't fire in the normal flow, the fix lands somewhere else (chore(release) guidance or a new /execute step). That's still Small-to-Medium work, not a rewrite.

```
SCALE ASSESSMENT:
  Files affected: ~2-3 (execute/SKILL.md, ship/SKILL.md, optional reference doc)
  Subsystems: changelog authoring pipeline (execute + ship)
  Migration required: no
  Cross-team coordination: no
  Unknowns: 2 (step 7e ghost risk, story outcome data availability at step 7e)

  RECOMMENDATION: Proceed to stories
  RATIONALE: Scope is well-bounded — prose/template changes in two skill files. The ghost-risk
  unknown is an investigation task (small), not a design blocker. No migrations, no external
  dependencies, no cross-team work. A structured outline would add overhead without adding clarity.
```
