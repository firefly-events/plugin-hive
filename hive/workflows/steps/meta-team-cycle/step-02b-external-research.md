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

**No-leak boundary (MANDATORY — read before every query):**

Only sanitized, non-sensitive search terms may leave the target project. Before
constructing any Firecrawl / Context7 / arXiv query, validate the query string
against these rejection rules:

- No PII — personal names, email addresses, phone numbers, usernames.
- No secrets — API keys, tokens, passwords, credentials, environment values.
- No internal identifiers — internal hostnames, private URLs, ticket IDs from
  private trackers, internal project codenames not already public.
- No repository-specific paths — absolute filesystem paths to the target
  project, internal directory trees, repo-specific file names that expose
  non-public structure.
- No code excerpts containing any of the above.

Apply `sanitizeExternalQuery(query)` (or the equivalent `requireSanitizedQuery`
approval gate in the invoking session) BEFORE calling any provider. If a query
cannot be sanitized without losing its research intent, redact it or refuse
the call — do NOT send the query and record the refusal as a finding. If the
orchestrator or user has not explicitly authorized a borderline query, default
to refusal and escalate for approval.

Only after the sanitizer approves (or an explicit human-authorized override is
in place) is the query permitted to leave the project. Log the sanitized query
text alongside each candidate produced in step 4 so the evidence trail captures
what was actually sent outbound.

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

Use the `external-proposal-` ID namespace so external candidates never collide
with the `proposal-` namespace used by internal-audit conversions. Consumers
and validators (step-03-proposal.md + step-06-evaluation.md) MUST accept both
prefixes; the `discovery_source` field is the authoritative routing key, but
the distinct ID prefix lets grep-based tools and humans separate feeds at a
glance.

```yaml
id: external-proposal-{N}
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

**Guaranteed output contract:** this step ALWAYS emits a
`external_research_candidates` list as its output, including an explicit empty
list `[]` when no candidates qualify. Step 03 declares `external-research` as
a predecessor; the empty-list guarantee is how this step remains additive-only
rather than a blocker on proposal. Downstream consumers treat an empty list
identically to a missing one (additive = additive + ∅).

- No useful external ideas found: emit an empty candidate list and proceed normally.
- Provider unavailable (Firecrawl/Context7/arXiv network or auth error):
  continue with remaining providers if any; if ALL providers fail, emit an
  empty candidate list, note the full provider-outage in the summary, and
  proceed normally. Do NOT fail the step.
- Sanitizer refusal: log the refusal, skip that query, continue with remaining
  queries. If every query is refused, emit an empty candidate list.
- Candidate too vague to implement: discard it rather than passing low-quality
  noise to step 3.

## NEXT STEP

**Gating:** External research candidate list produced, including an explicit empty list if nothing qualified.
**Next:** Load `hive/workflows/steps/meta-team-cycle/step-03-proposal.md`
**If gating fails:** Report which providers or checks could not run and why.
