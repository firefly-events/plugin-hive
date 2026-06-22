# Plan Node: research

Source: `skills/plan/SKILL.md` §Phase A: Research (steps 1–3)

## Role

Researcher. Explore the target codebase and produce a raw research brief for the
design node. You are NOT producing the design discussion — that is the architect's
node. Deliver findings; let the architect reason about them.

## Inputs

- `requirement` (context): the user's planning requirement or feature description.

## Task Sequence

### 1. Explore the codebase (SKILL.md §Phase A, step 1)

Explore the target codebase for:
- Tech stack, languages, frameworks
- Existing architectural patterns relevant to the requirement
- File and module boundaries touched by the requirement
- Prior decisions in `.pHive/` (cross-cutting concerns, KG triples via `python3 -m hive.lib.kg_why`)

Run context7 validation for any library/SDK mentioned in the requirement. Escalate to
web research when docs are stale, coverage is missing, or signals conflict.

### 2. Produce the research brief (SKILL.md §Phase A, step 2)

Write `.pHive/epics/{epic_id}/docs/research-brief.md` using the research-brief
sub-skill (`skills/hive/skills/research-brief/SKILL.md`). The brief must include:
- Tech stack summary
- Relevant file paths with purpose notes
- Pattern observations
- `inconsistency_risk_signals` section (feeds the grill node)
- Validation note (context7 confidence level or "codebase-only" if context7 unavailable)

### 3. Load cross-cutting concerns (SKILL.md §Phase A, step 3)

Check `.pHive/cross-cutting-concerns.yaml`. If present, note which concerns may apply
to the upcoming stories. Do NOT evaluate per-story yet — that is the author node's job.

## Output

Return the full text of the research brief as `research_brief`.

## Constraints

- No design decisions. Findings only.
- Cite actual file paths — no guesses.
- The brief is consumed by both the design node (architect) and the author node
  (technical-writer). Make it portable.
