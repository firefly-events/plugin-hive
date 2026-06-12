# Insights — chs-2-ship-authoring-step

- The `/ship` version-bump verification (now step 4) checks two *different* things
  living in the same `## [Unreleased]` section: the bump-level accounting line
  (owned by `/execute` step 7e, or the ship-time safety net) and the prose entry
  (now authored in-flow by `/ship` step 3). When editing either skill, do not let
  the prose entry satisfy or fail the bump-evidence check — they are separate
  artifacts that happen to share a heading. The reworded step 4 states this
  explicitly; keep it that way.

- `skills/ship/SKILL.md` step numbers are referenced internally (safety-net text
  cited "step 7e" of execute, and now step 3 of ship) but nothing *outside* the
  file references ship step numbers — verified via grep before renumbering 4–7
  to 5–8. If a future change adds external references to ship step numbers,
  renumbering becomes a cross-file change.

- `hive/references/changelog-entry-format.md` is a hard "MANDATORY single source"
  (grill finding P1): any step touching changelog prose must cite it by path and
  must NOT restate rules like bullet shape or PR-suffix notation inline — even
  paraphrases count as duplication per the epic's acceptance criteria. Cite
  section numbers (§3 source chain, §4 degraded marking, §5 quality criteria)
  instead.

- Branch contention gotcha: the epic branch `feat/changelog-human-summaries` was
  already checked out by a peer agent's worktree, so `git checkout <branch>`
  failed with "already used by worktree". Working detached on FETCH_HEAD and
  pushing `HEAD:feat/changelog-human-summaries` satisfies the shared-branch
  integration contract without disturbing the peer worktree.

- 7e cross-reference decision: 7e's "Write a changelog entry … for this epic"
  reads as entry ownership even though its template is pure version accounting,
  so the conditional one-line clarification was added rather than skipped.
