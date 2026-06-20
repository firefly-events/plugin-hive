# Research Brief — changelog-human-summaries

**Epic:** changelog-human-summaries
**Source:** `research-findings-raw.md` (researcher agent, 2026-06-12)
**Author:** technical-writer
**Date:** 2026-06-12

---

## 1. Summary

The investigation covered the full changelog authoring pipeline in plugin-hive: `CHANGELOG.md`, `/execute` step 7e, `/ship` step 3, and the `release_post` artifact system. Headline finding: **no skill mandates human-readable prose in `CHANGELOG.md`**. The only automated write is `skills/execute/SKILL.md` step 7e, which produces a single version-accounting line with no feature narrative. All good prose entries observed in `CHANGELOG.md` (2.10.0, 2.11.0, 2.9.0, etc.) were manually authored via `chore(release)` commits outside any skill.

---

## 2. Key Files & Surfaces

| File | Role |
|------|------|
| `CHANGELOG.md` | Full release history; ~50% entries have good prose, ~50% are thin (0.x–early 1.x era) |
| `skills/execute/SKILL.md:342-384` | Step 7e — the only skill-automated CHANGELOG writer; writes one mechanical version-accounting line |
| `skills/ship/SKILL.md:124-165` | Step 3 — verifies `## [Unreleased]` entry exists and names planned bump level; no prose quality gate |
| `hive/lib/release_post.mjs:1-80` | Generates rich narrative artifacts (`post.md`, `video-script.md`) from story YAML; separate from CHANGELOG |
| `hive/references/release-post/post-template.md` | Narrative template with `{{highlights}}` and `{{story_trace}}` slots; never flows to CHANGELOG |
| `hive/references/status-lifecycle.md` | Silent on changelog authoring; lifecycle contract does not reference CHANGELOG.md |

---

## 3. Patterns & Conventions

- **execute step 7e template** (`skills/execute/SKILL.md:360-365`): writes `**{epic-id} release finalization.** /execute applied the planned {version_bump} version bump ({old} → {new}) and kept plugin version sources in lockstep.` — pure accounting, zero feature prose.
- **Good entries are manual.** Versions 2.11.0, 2.10.0, 2.9.0 all carry bold taglines + detailed bullet summaries entered via `chore(release)` commits. No skill generates them.
- **/ship verifies structure, not substance.** Step 3 checks that `## [Unreleased]` exists and names the bump level (`skills/ship/SKILL.md:141-145`). Quality of prose is unchecked.
- **release_post uses story outcomes.** `hive/lib/release_post.mjs` reads `shippedStories[].title`, `.outcome`, `.sourcePath` to build `post.md` — the same fields that would seed a CHANGELOG narrative block. The two surfaces are currently disjoint.
- **Append-only convention.** The changelog format (keepachangelog.com, per file header) requires prepending under `## [Unreleased]`; prior entries are never edited.

---

## 4. Constraints

1. **Append-only.** New authoring must prepend under `## [Unreleased]`; no retroactive edits to released entries. (`CHANGELOG.md` format header)
2. **`## [Unreleased]` must exist before /ship step 3 runs.** Any authoring requirement must land inside the Unreleased block before /ship. (`skills/ship/SKILL.md:141-145`)
3. **execute step 7e owns the version bump write.** The prose-narrative requirement must either extend step 7e or occupy an earlier step in `/execute`; it cannot live in `/ship` (which verifies, not authors). (`skills/execute/SKILL.md:342-384`)
4. **release_post artifacts are a separate surface.** Rich narrative in `post.md`/`video-script.md` is not automatically reusable for CHANGELOG without an explicit bridge; keeping them in sync independently creates drift risk. (`hive/lib/release_post.mjs`)

---

## 5. Risks

| Severity | Risk | Evidence |
|----------|------|----------|
| **High** | No skill mandates human-readable prose; all good entries are manually authored. Gap is structural, not accidental. | `skills/execute/SKILL.md:360-365`, `CHANGELOG.md` pattern |
| **Medium** | `release_post.mjs` generates usable narrative (highlights, story_trace) never surfaced in CHANGELOG. Bridge is possible but adds a second narrative code path with drift risk. | `hive/lib/release_post.mjs`, `hive/references/release-post/post-template.md` |
| **Medium** | Prose-per-story vs prose-per-release tension. If prose must aggregate all story outcomes, it can only be written after all stories complete — which is step 7e's existing timing. One aggregate entry is correct; per-story entries would be noisy. | `skills/execute/SKILL.md:342-384` |
| **Low** | A quality gate in /ship step 3 can block releases but cannot produce prose. Gate-only enforcement without authoring support creates friction with no fix path. | `skills/ship/SKILL.md:141-145` |

---

## 6. Open Questions

1. **Who authors the taglines in 2.10.0/2.11.0?** Not traced to any skill step. Human maintainer via `chore(release)` commit, or a release-specific step not captured in any SKILL.md?
2. **Does /plan capture story outcomes in YAML fields readable by step 7e?** The `shippedStories` array in `release_post.mjs` includes `title` and `outcome` — are these populated at plan time or only at ship time?
3. **Is there a step-08-integrate that could add per-story CHANGELOG entries?** Not checked in research pass; a per-story authoring hook would change the aggregation model.
4. **Should the fix mandate a human-authored tagline (skill instructs, human writes) or a skill-generated one (LLM synthesizes from story outcomes)?** The former is simpler; the latter is more automated but produces AI-generated prose that may need human review.

---

## 7. Inconsistency Risk Signals

- **Vocabulary mismatch** (`skills/execute/SKILL.md:360-365` vs `CHANGELOG.md:12-23`): step 7e mandates the version-accounting line, but good CHANGELOG entries (2.10.0, 2.11.0) never contain it. Either it gets edited out in the `chore(release)` commit, or the safety-net `/ship` path is the only one that triggers it. If the entry is always overwritten, extending step 7e may produce a ghost requirement.
- **Hidden assumption** (`skills/ship/SKILL.md:141-145`): the requirement frames /ship as a prose quality enforcement point. But /ship runs after /execute and cannot retroactively author prose — it can only gate/reject. Quality authoring must live in `/execute` or earlier; /ship can only add a structural verification check.
- **Unresolved tension** (`hive/lib/release_post.mjs` vs `CHANGELOG.md`): two separate narrative surfaces cover the same release. If the fix generates CHANGELOG prose from story outcomes, the same logic as `release_post.mjs` applies — but maintaining two separate generation paths creates long-term drift.

---

## Context7/Web Validation Note

Research is **codebase-only**. No external SDK, API, or library is involved. `keepachangelog.com` is referenced in `CHANGELOG.md`'s own file header, but the format already supports prose bullets — the gap is authoring discipline, not format capability. Web escalation was not performed and is not needed; all relevant authoring callsites were located via direct file reads. Confidence: high.
