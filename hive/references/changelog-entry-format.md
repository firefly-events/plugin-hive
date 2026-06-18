# Changelog Entry Format

**Status: MANDATORY single source.** This document is the canonical format
specification for human-readable `CHANGELOG.md` entries. The `/ship` authoring
step and any quality-gate language MUST cite this document by path
(`hive/references/changelog-entry-format.md`). Format rules MUST NOT be
duplicated inline in skill or workflow prose — if a step needs a rule, it
links here. (Origin: grill finding P1 — format spec was embedded inline in two
skills with the shared reference left optional.)

## 1. Entry shape

Every release entry has, in order:

1. **Version heading** — `## [X.Y.Z] - YYYY-MM-DD` (Keep-a-Changelog style).
2. **Tagline** — one bold sentence, on its own line, describing what the
   release does *for users*. It summarizes the release's theme or headline
   outcomes, not its mechanics. One sentence; em-dash elaboration after the
   headline clause is fine.
3. **Sections** — Keep-a-Changelog category headings (`### Added`,
   `### Changed`, `### Fixed`; also `### Deprecated`, `### Removed`,
   `### Security` when applicable), each containing prose bullets. A release
   with a single dominant category may flatten to a bare bullet list directly
   under the tagline (the 2.11.0 entry does this); when more than one category
   is represented, use the section headings.

`CHANGELOG.md` is append-only: new entries are added under `## [Unreleased]`;
existing released entries are never retroactively edited.

## 2. Bullet shape

Each bullet:

- **Leads with a human-readable outcome sentence** — what changed and why it
  matters to a user or operator. The first clause must be understandable
  without opening any PR.
- **PR references are suffix notation only** — `(PR #N)` or `(PRs #N, #M)` at
  the *end* of the bullet (or at the end of its bolded lead-in). A PR number
  is never the content of the bullet, never the subject of the sentence, and
  never appears without surrounding prose.
- May open with a **bold short label** naming the feature
  (`**State-dir resolver** (PRs #276, #280): …`) followed by the outcome
  prose. The label is optional; the outcome sentence is not.
- One bullet per major change. Closely-related PRs that ship one user-facing
  outcome share one bullet; unrelated changes never share a bullet.

## 3. Authoring source chain

Bullet prose is drafted from story data using the degradation chain adopted
from `hive/lib/release_post.mjs`:

```
outcome ?? firstSentence(description) ?? title + acceptance_criteria
```

- If the story YAML has an `outcome:` field, use it verbatim as the bullet's
  outcome sentence (light copy-editing allowed).
- Else, use the first sentence of the story `description`.
- Else, synthesize from the story `title` plus its `acceptance_criteria`.

**Day-one expectation:** story YAMLs currently carry no `outcome:` field
(researcher-verified), so the degraded paths are the *normal* case, not an
edge case. Authoring never blocks on missing data and never hallucinates
outcomes the story data does not support — degrade down the chain instead.

## 4. Degraded-source marking

Any bullet whose prose was synthesized from a degraded source (description or
title + acceptance criteria, rather than a real `outcome:` field) is annotated
with a trailing HTML comment naming the source:

```markdown
- New triage queue ages out stale entries after 14 days. <!-- degraded: sourced from description -->
- Dispatch routers cover the review workflow mode. <!-- degraded: sourced from title + acceptance_criteria -->
```

Purpose: the operator review step in `/ship` sees exactly which bullets came
from thin data and deserve a closer read or a rewrite.

**Markers are stripped after operator approval.** Approved prose is no longer
degraded; no marker survives into a released entry.

## 5. Quality criteria (used by the /ship authoring review)

An entry passes the authoring review only if all of the following hold:

1. **Tagline present** — one bold sentence under the version heading,
   describing user-facing value.
2. **Prose per change** — every major change has at least one full prose
   sentence describing what changed and why it matters.
3. **No bare PR bullets** — no bullet whose content is only a PR number,
   a PR title, or a PR link. PR refs are suffixes (§2), never the substance.
4. **No mechanical substitutes** — version-accounting lines ("bumped X to
   Y.Z", "merged N PRs", dependency-bump dumps) do not count as prose and are
   not a substitute for outcome sentences.
5. **Degraded markers resolved** — at release time, no
   `<!-- degraded: … -->` markers remain (all were reviewed and stripped).

## 6. Exemplar and counter-example

### Good entry

```markdown
## [2.12.0] - 2026-06-20

**Human-readable release notes by default — /ship now drafts changelog prose from story outcomes and gates on quality before release.**

### Added
- **Changelog authoring step** (PR #301): /ship drafts each release bullet from story outcomes, falling back to descriptions when no outcome field exists, so operators review prose instead of writing it from scratch.

### Changed
- Release gating now cites a single canonical format spec, eliminating drift between the two skills that previously embedded their own copies of the rules (PR #303).

### Fixed
- Story-status reconcile no longer double-counts stories that ship in the same run they complete (PR #305).
```

Each bullet says what changed and why it matters; PR numbers sit at the end;
the tagline tells a user what the release means for them.

### Counter-example (PR-dump style — rejected)

```markdown
## [2.12.0] - 2026-06-20

- PR #301
- #303: chs-2 wiring
- Merged #305
- Bumped version to 2.12.0, 3 PRs merged
```

Fails every criterion: no tagline, no prose, bullets are bare PR numbers, and
the last line is mechanical version accounting standing in for content.
