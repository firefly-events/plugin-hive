# Insights — plan-changelog-human-summaries

## Non-obvious findings worth carrying forward

### 1. execute step 7e is the only automated CHANGELOG writer — and it's version-only

`skills/execute/SKILL.md:342-384` writes exactly one mechanical line to CHANGELOG.md at epic finalize. All the good entries in recent releases (2.10.0, 2.11.0) come from manual chore(release) commits, not from any skill. Any fix that doesn't touch step 7e will miss the only automated insertion point.

**Implication for implementor:** The fix belongs in step 7e (extend it to also write a prose feature block) or as a new story-by-story step that accumulates entries during /execute. Putting it in /ship is too late — /ship can gate but not generate.

### 2. /ship step 3 is a structural gate, not a quality gate

Ship checks `## [Unreleased]` exists and names the bump level. It does not read the prose. A quality gate added here can only block bad entries, not produce good ones — and "bad prose" is hard to detect mechanically. The real fix is upstream (at authoring time in /execute), with /ship as an optional secondary verifier.

### 3. release_post.mjs has the right data — CHANGELOG doesn't use it

`generateReleasePostArtifacts` already receives `shippedStories` with `title`, `outcome`, `sourcePath` per story — exactly what a human-readable CHANGELOG bullet needs. The post.md and CHANGELOG.md use separate generation paths with no shared code. The fastest implementation path is to add a CHANGELOG narrative step to step 7e that mirrors the release_post highlights generation logic.

### 4. The mystery of the good entries: chore(release) commits

Recent strong entries were authored in manual `chore(release): amend 2.9.0 changelog with full multi-epic scope` commits — i.e., someone wrote them by hand after the fact. This means the skills have NEVER been responsible for the quality. Any new mandate will be a net-new requirement, not a fix to existing prose.

### 5. Beware the ghost requirement risk

The step 7e mechanical line ("`{epic-id}` release finalization. /execute applied...") may not appear in the final CHANGELOG of good releases because it's overwritten in the chore(release) commit. If that's the pattern, mandating a new automated entry in step 7e that also gets hand-edited later means the mandate is partially theater. Investigate whether step 7e entries are preserved or replaced before committing to "extend step 7e" as the fix.
