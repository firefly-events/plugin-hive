> `$HIVE_STATE_DIR` resolves from `paths.state_dir` in `hive.config.yaml` (default `.pHive`).

# Step 02b: External Research

## Purpose

Add an external-research pass between analysis and proposal so the meta-team can surface candidate proposals from outside sources in parallel with the internal audit. This step is additive only: it does not replace analysis findings, does not suppress internal-audit proposals, and does not alter the existing proposal ranking or fallback behavior.

## Providers

The research agent may query these external sources:
- Firecrawl
- Context7
- arXiv
Use them to identify relevant ideas, patterns, safeguards, or implementation approaches that could improve Hive within charter scope.

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Treat this step as additive research only — do not replace or reinterpret step 2 findings
- Generate candidate proposals, not final ranked approvals
- Keep all candidates within charter scope and current workflow constraints
- Tag every externally sourced candidate with `discovery_source: external_research`
- Do NOT write code or modify Hive workflow semantics in this step

## EXECUTION PROTOCOLS

**Mode:** autonomous

Run a bounded external research pass after analysis completes. Produce a candidate proposal list that will be merged into the existing proposal-ranking queue in step 3.

## CONTEXT BOUNDARIES

**Inputs available:**
- `cycle_id` from step 1
- `findings` from step 2 for context on current internal gaps
- `<HIVE_STATE_DIR>/meta-team/charter.md` — scope boundaries and allowed change domains
- `<HIVE_STATE_DIR>/meta-team/cycle-state.yaml` — for recording research candidates if the workflow persists them there
- Stable reference material already present in the repo, including `hive/references/meta-team-external-research.md`

**NOT available:**
- User input
- Authority to change envelope structure, workflow authority, promotion rules, or revert semantics
- Authority to suppress, skip, or downgrade internal-audit proposals

## YOUR TASK

Research external sources and produce a list of candidate proposals that may be useful for Hive, even when the internal audit already found enough work. These candidates are an additional feed into step 3, where they are ranked alongside internal-audit proposals.

## TASK SEQUENCE

### 1. Re-anchor on scope
Before querying any provider:
- Re-read the charter scope and hard constraints
- Re-read the step 2 findings summary so external research complements, rather than duplicates, the internal audit
- Exclude ideas that would require changes outside the charter or human-only decisions

### 2. Query external providers
Use Firecrawl, Context7, and arXiv as available to gather:
- Comparable workflow patterns for autonomous review / proposal systems
- Documentation or reference patterns that improve maintainability, clarity, or schema consistency
- Research-backed practices for ranking, validation, or bounded agent execution that fit Hive's current model

Do not treat any single provider as authoritative. Cross-check promising ideas before turning them into candidates.

### 3. Extract candidate proposals
Convert useful external findings into proposal candidates. Each candidate must:
- Be actionable inside the Hive codebase
- Stay within charter scope
- Preserve the existing internal-audit proposal path
- Preserve the current fallback loop by acting only as an additional input to proposal ranking
- Include `discovery_source: external_research`

When an externally sourced idea overlaps with an internal finding, keep it as a separate candidate or clearly note the overlap. Do not delete or subsume the internal finding.

### 4. Shape candidates for step 3
Write each candidate in the same general proposal shape expected by step 3, using the usual proposal fields where they can already be determined. Include:

```yaml
id: proposal-{N}
title: {one-line title}
discovery_source: external_research
addresses_findings: [finding-{N}, ...]  # optional if no direct internal finding maps cleanly
impact_score: {1-5}
risk_score: {1-5}
effort_score: {1-5}
priority_score: {calculated or provisional}
charter_objective: completeness | consistency | clarity | coverage | tooling
implementation_plan:
  - step: {action description}
    file: {target file path}
    action: create | add_section | update_field | add_entry
rationale: |
  {Why this externally sourced change is relevant to Hive}
risk_notes: |
  {What could go wrong or what should be validated}
```

If a field cannot yet be finalized, provide the best grounded draft for step 3 to refine. Keep the candidate concrete enough that the proposal step can rank it without redoing the research from scratch.

### 5. Record research output
Produce a candidate list for handoff to step 3. If persisted to `<HIVE_STATE_DIR>/meta-team/cycle-state.yaml`, record it as external research output for the current cycle without overwriting the analysis findings.

### 6. Produce research summary
Summarize:
- Providers queried
- Candidate count
- Any overlaps with internal findings
- Any ideas rejected as out-of-scope or too vague

## Non-scope

This step does NOT do the following:
- Modify envelope structure, authority model, promotion semantics, or revert semantics
- Replace the analysis step or reinterpret internal audit findings
- Replace the proposal step's internal-audit path
- Introduce a new fallback tier or change the existing fallback loop
- Suppress or skip internal-audit proposals because external research produced alternatives

## Output

Hand step 3 a list of externally sourced proposal candidates in the usual proposal schema shape, now including `discovery_source: external_research`. These candidates are additional inputs to the proposal ranking queue, not a separate approval track.

Expected handoff:

```yaml
external_research_candidates:
  - {proposal object with usual step-03 fields, discovery_source: external_research}
research_summary: {string summary of provider usage and notable candidate themes}
```

## SUCCESS METRICS

- [ ] External research executed regardless of internal audit count
- [ ] Firecrawl, Context7, and arXiv are treated as eligible providers for this step
- [ ] Every candidate includes `discovery_source: external_research`
- [ ] Output is shaped for direct consumption by step 3 proposal ranking
- [ ] Internal-audit proposals remain intact and unsuppressed

## FAILURE MODES

- No useful external ideas found: output an empty candidate list and proceed normally
- Provider unavailable: continue with remaining providers and note the gap in the summary
- Candidate too vague to implement: discard it rather than passing low-quality noise to step 3

## NEXT STEP

**Gating:** External research candidate list produced, including an explicit empty list if nothing qualified.
**Next:** Load `hive/workflows/steps/meta-team-cycle/step-03-proposal.md`
**If gating fails:** Report which providers or checks could not run and why.
