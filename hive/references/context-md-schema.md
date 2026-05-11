# CONTEXT.md Schema

`.pHive/CONTEXT.md` is the project's single-file domain glossary. It answers one question: **what do these terms, paths, and conventions mean in this codebase?**

It is the substrate Borrow 2 from the mattpocock atomic-skill posture (see `.pHive/epics/hive-composability-audit/spikes/skills-lens/borrows-scope.md` §2). Single file, single source — NOT a tree, NOT a memory stack, NOT a generated knowledge base.

## What CONTEXT.md is

- A flat glossary of project-specific vocabulary, paths, and conventions.
- The first thing planning + execution agents read after the persona load — gives them domain literacy before they write a research brief or implementation plan.
- Maintained by a human (or human-supervised automation) — not a runtime artifact.

## What CONTEXT.md is NOT

- **Not a changelog.** Per-feature history belongs in commits and PR descriptions.
- **Not project status.** Open work, blockers, and active milestones belong in project memos (`~/.claude/projects/.../memory/project_*.md`) or task trackers.
- **Not architecture documentation.** Detailed design lives in `hive/references/` or per-epic docs. CONTEXT.md only points at architecture canonically; it does not explain it.
- **Not a multi-file knowledge base.** The atomic-skill posture forbids tree growth — keep it single-file. Specific schemas, protocols, and detailed references already have homes in `hive/references/`.

## Format

Standard markdown. Three to five top-level sections, each lightweight:

```markdown
# Project CONTEXT

Brief 1-2 sentence project description.

## Terminology

- **Term** — 1–3 sentence definition. Optional cross-reference to canonical doc.
- **Term** — definition.

## Key paths

- `path/to/thing` — what lives there, what it controls.
- `another/path` — purpose.

## Conventions

- One-sentence convention. Cross-reference if formalized in a `feedback_*` memo or reference doc.

## Canonical references

- Pointers (no copies) to authoritative docs that elaborate on terms above.
```

Length target: **<200 lines**. If you're approaching that, it's a signal that detail is leaking in. Move detail into a dedicated reference and leave a one-line pointer here.

## Content rules

1. **Define, don't explain.** Each term is a 1–3 sentence definition, not an essay. Link to canonical references for elaboration.
2. **Plural over singular.** Prefer terms that appear in multiple places — if a word shows up once in one file, it doesn't need a glossary entry.
3. **Project-specific over generic.** Don't define "epic" or "story" with industry-standard meanings; define what THIS codebase means by them (which often refines or specializes the generic).
4. **Cross-reference, don't duplicate.** When a term has a canonical reference (e.g., `hive/references/specialist-triggers.md`), the CONTEXT.md entry says "see [link]" rather than restating.
5. **No code samples.** CONTEXT.md is vocabulary, not implementation. Code samples belong in references and SKILL.md files.

## Update triggers

Update CONTEXT.md when:

- A new domain term enters the codebase (new persona, new skill type, new substrate concept).
- An existing term's meaning shifts (e.g., "slice" → "wave" rename).
- A borrowed pattern lands (mattpocock-style atomic skills, etc.).
- A major architecture decision changes which paths are canonical.

Do NOT update CONTEXT.md for:

- Implementation changes that don't introduce new vocabulary.
- Minor bug fixes.
- Per-story progress.
- Routine refactors.

## Maintenance contract

- **Owner:** the maintainer team (human + supervised assistant). One file, one source of truth.
- **Cadence:** opportunistic — when triggers above fire, not on a schedule.
- **Review:** part of any PR that introduces new vocabulary or shifts existing meaning. CodeRabbit / reviewer agents flag PRs that introduce new terms without CONTEXT.md updates.
- **Audit:** periodic grep for terms in code/refs that aren't defined here, and removal of terms here that no longer appear in the codebase.

## How agents use CONTEXT.md

Skill-prelude.md cites CONTEXT.md so every skill load includes domain literacy after the persona/config/memory steps. Agents do not write to CONTEXT.md — only the maintainer (with assistant help) does. Researchers reading the codebase ground their findings in CONTEXT.md vocabulary; planners use it to keep stories speaking the project's language.

## Bootstrap

`/hive:kickoff` produces an initial CONTEXT.md scaffold for new projects (see `hive/references/kickoff-protocol.md`). The scaffold is intentionally minimal — the maintainer fills in domain terms as the project's vocabulary stabilizes.

## See also

- `.pHive/epics/hive-composability-audit/spikes/skills-lens/borrows-scope.md` — Borrow 2 specification
- `hive/references/skill-prelude.md` — cites CONTEXT.md as part of the standard preamble (story a-26-context-md-skill-prelude-citation)
- `hive/references/kickoff-protocol.md` — kickoff bootstraps the file (story a-26-context-md-kickoff-bootstrap)
