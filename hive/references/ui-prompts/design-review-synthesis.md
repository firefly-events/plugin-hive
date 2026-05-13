## Required placeholders

- `{artifacts reviewed}`
- `{file-or-brief}`
- `{section}`
- `{finding}`
- `{specific actionable change with rationale}`
- `{artifact_target}`

Synthesize all domain critiques into a unified target-aware review verdict.
Collect findings from: accessibility critique (if run), animations critique
(if run), and your own design critique. Merge and deduplicate findings.
Rank by severity: blocking (design intent broken, accessibility violation) →
significant (UX degraded, brand inconsistency) → cosmetic (minor polish).
Use artifact_target to distinguish design-decision findings from implementation/code-fix findings, and use the target-specific verdict vocabulary supplied by the skill.
Produce a structured verdict:

## Design Review: {artifacts reviewed}

## Findings
- `{file-or-brief}:{section}` — {finding} [severity: blocking | significant | cosmetic] [domain: accessibility | motion | design]

## Recommended Changes
- {specific actionable change with rationale}

## Remaining Questions
- Design decisions requiring human input before proceeding

## Summary
One-paragraph assessment of overall design quality and readiness to proceed.

## Verdict
approved | needs_revision | needs_redesign (or the target-specific vocabulary supplied via context)

Verdict criteria:
- approved: no blocking findings; significant findings are documented for follow-up
- needs_revision: one or more blocking findings that must be addressed before implementation
- needs_redesign: fundamental design approach is flawed; requires re-scoping
