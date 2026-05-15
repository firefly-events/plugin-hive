# Step 3: Proposal

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Only propose changes within charter scope — re-read `.pHive/meta-team/charter.md` scope table before ranking
- Do NOT propose changes that require human confirmation (config changes, tool list changes) — skip them
- Each proposal must have an explicit implementation plan — "improve this doc" is not a plan
- Cap approved proposals at 5 per cycle — prioritize depth over breadth

## ROUTING GATE (upstream)

Step 3 runs whenever ANY of three actionable signals from steps 2 / 2b is non-empty: `findings`, `external_research_candidates`, or `metric_signal`. Step-03b is the inverse fallback that runs ONLY when ALL three are empty. This is the **AND-of-empty** rule — `metric_signal` is orthogonal to findings, and structural findings drive this step even when `metric_signal: false`. The DAG executor encodes the rule via `when:` predicates on the step-03 and step-03b nodes in `meta-team-cycle.workflow.yaml`; see `hive/references/predicate-grammar.md` and `step-02-analysis.md` OUTPUT FORMAT for the field-binding contract.

## EXECUTION PROTOCOLS

**Mode:** autonomous

Review findings from step 2. Produce ranked, actionable proposals. No changes to the codebase in this step.

## CONTEXT BOUNDARIES

**Inputs available:**
- `findings` JSON from step 2
- `.pHive/meta-team/charter.md` — objectives, scope, hard constraints
- Full codebase read access for context on each finding

**NOT available:**
- User input
- Prior proposals from other cycles (proposals are generated fresh; prior cycle ledger is reference only)

## YOUR TASK

Convert analysis findings into a ranked list of implementation proposals, each with a concrete plan, risk assessment, and effort estimate.

## TASK SEQUENCE

### 1. Filter findings by charter scope
Review each finding from step 2:
- If the fix requires changes outside the charter's allowed domains: mark as `out_of_scope`, skip
- If the fix requires human confirmation (config changes, tool lists): mark as `needs_human`, skip
- Remaining findings: eligible for proposals

**GitHub forwarding check:** If `hive.config.yaml → meta_team.github_forwarding: true`, findings marked `out_of_scope` that represent genuine plugin-level bugs or gaps should be tagged `forward_to_github: true` in the skipped findings list. These will be filed as GitHub issues in the close step. If forwarding is disabled (default), skip this — out-of-scope findings stay local only.

### 2. Group related findings
Some findings address the same root cause. Group them into single proposals where the implementation naturally covers multiple findings (e.g., "create missing reference doc" may resolve both a MISSING_FILE finding and a dangling cross-reference).

If a grouped proposal deliberately replaces a prior proposal for the same root cause, emit `superseded` before recording the replacement. Use `subject` as the epic id or proposal id, `predicate` as `proposal`, `prior-object` as the replaced proposal id, `new-object` as the replacement proposal id, and `source-agent` as `meta-optimize`:

```bash
python3 -m hive.lib.kg_emit_cli \
  --mode supersede \
  --subject "{epic_id_or_proposal_id}" \
  --predicate "proposal" \
  --prior-object "{prior_proposal_id}" \
  --new-object "{new_proposal_id}" \
  --source-epic "{epic_id}" \
  --source-agent "meta-optimize"
```

The helper sets `valid_until` on the prior `proposal` triple when present and inserts exactly one `superseded` provenance edge.

### 2b. Merge external-research candidates into the eligible pool

Step `external-research` (step-02b) supplies an `external_research_candidates`
list as a workflow input. That list is always present (possibly empty — see
step-02b's guaranteed-output contract). Before ranking:

- Treat each `external_research_candidates[*]` entry as an eligible proposal
  alongside the internal-audit-derived proposals produced in Step 1.
- Tag merged external entries with `discovery_source: external_research` if
  that field isn't already set on them. Internal proposals default to
  `discovery_source: internal_audit` (missing field handling below).
- De-duplicate: if an external candidate proposes work that overlaps a
  grouped internal finding (Step 2), prefer the internal-derived proposal
  (it has concrete finding evidence) but keep the external entry's
  `rationale` text as appended context on the merged proposal. Do not
  silently drop the external evidence.
- IDs: internal proposals use `proposal-{N}`; external candidates use
  `external-proposal-{N}` (per step-02b's namespace). Consumers MUST accept
  both prefixes. The `discovery_source` field is the authoritative feed
  identifier, not the ID prefix.

The merged pool is the input to Step 3 ranking.

### 2c. Merge kg_signal findings into the eligible pool

Step `kg-signal` (step-02c) supplies a `kg-findings.yaml` file as a workflow
input. When present, treat each entry as an eligible analysis finding (the
step-02 shape, NOT the step-02b candidate shape). Before ranking:

- Tag each entry with `discovery_source: kg_signal` if that field isn't
  already set on it.
- De-duplicate against grouped internal findings from Step 2: if a kg entry
  overlaps a grouped internal finding, prefer the internal-derived proposal
  (it has concrete finding evidence) but append the kg entry's `rationale`
  text as additional context on the merged proposal. Same precedence rule as
  external candidates in 2b. Do not silently drop the kg evidence.
- IDs: kg findings use `kg-finding-{N}` per step-02c's namespace. Consumers
  MUST accept this prefix alongside `proposal-{N}` (internal) and
  `external-proposal-{N}` (external). The `discovery_source` field is the
  authoritative feed identifier, not the ID prefix.
- Cross-project hard tag: when a kg finding's `tag` is
  `cross_project_signal`, carry the `[cross-project: <name>]` prefix forward
  from the finding description into the rendered proposal `description` and
  `rationale` where applicable. If the finding description already starts with
  `[cross-project: <name>]`, preserve that exact prefix and do not add a second
  one.
- Absence-graceful: if `kg-findings.yaml` is missing or empty, fall through
  to existing behavior with no error.
- Observability: increment `kg_signal_proposals_total` once for each kg finding
  that enters the proposal pool, after de-duplication has decided it remains
  represented in the pool:

```bash
python3 -m hive.lib.metric_increment_cli \
  --counter kg_signal_proposals_total \
  --label cycle_id="{cycle_id}" \
  --by 1
```
- Dedup miss reason: after de-duplication, if the `kg-findings.yaml` input count
  was non-zero and every kg finding was removed by the step-02 merge, do not
  mutate step-02c's already-written output. Emit the step-03 summary line
  `miss_reason=dedup_eviction` so the empty downstream kg contribution is
  attributable to the merge site that caused it.

Rendered cross-project proposal example:

```yaml
id: proposal-2
title: Address repeated create-event phase failures
discovery_source: kg_signal
addresses_findings: [kg-finding-1]
description: "[cross-project: shindig] 3 phase_failed triples in epic create-event-enhancements within 30d window"
rationale: |
  [cross-project: shindig] KG signal shows repeated phase_failed triples from
  the source project. Preserve the prefix so reviewers can identify the
  cross-project provenance in proposal review.
```

### 3. Rank proposals
Score each proposal on three dimensions (1–5 each):
- **Impact:** How much does this improve Hive's quality/usability? (5 = blocks real usage, 1 = cosmetic)
- **Risk:** How much could this break existing content? (5 = high risk, 1 = no risk — LOWER is better)
- **Effort:** How many files, how many sections? (5 = large, 1 = single file addition)

**Priority score = Impact × (6 − Risk) / Effort**

Sort proposals by priority score descending.

### 4. Write proposal specs
For each proposal (top 5 by priority):
```yaml
id: proposal-{N}
title: {one-line title}
discovery_source: internal_audit  # or: external_research, kg_signal
addresses_findings: [finding-{N}, ...]
impact_score: {1-5}
risk_score: {1-5}
effort_score: {1-5}
priority_score: {calculated}
charter_objective: completeness | consistency | clarity | coverage | tooling
implementation_plan:
  - step: {action description}
    file: {target file path}
    action: create | add_section | update_field | add_entry
rationale: |
  {Why this change, what problem it solves, what the state will be after}
risk_notes: |
  {What could go wrong, what to check before shipping}
```

> **Backward compatibility:** Proposals written before this field was added (i.e., proposals without a `discovery_source` entry) default to `internal_audit` for schema-handling purposes. Do NOT reject or fail a proposal for a missing `discovery_source` field — treat it as the default. Valid `discovery_source` values are: `internal_audit`, `external_research`, `kg_signal`.

### 5. List skipped findings
Document all findings that were skipped:
```yaml
skipped:
  - finding_id: finding-{N}
    reason: out_of_scope | needs_human | low_priority | covered_by_other_proposal
```

### 6. Update cycle-state.yaml
Append to `.pHive/meta-team/cycle-state.yaml`:
```yaml
phase: proposal
approved_proposals:
  - {proposal objects}
skipped_findings:
  - {skipped objects}
```

### 7. Produce proposal summary
```
## Proposal Summary — Cycle {cycle_id}

Approved proposals (will implement): {N}
Skipped findings: {N}

Proposals (ranked):
  [{priority_score}] proposal-{N}: {title}
    Addresses: {finding IDs}
    Objective: {charter_objective}
    Plan: {N steps}

Skipped findings:
  {finding-id}: {reason}
```

## SUCCESS METRICS

- [ ] All findings reviewed against charter scope
- [ ] Proposals ranked by priority score
- [ ] Maximum 5 proposals approved (excess moved to skipped with reason: `deferred_to_next_cycle`)
- [ ] Each proposal has complete implementation plan with specific file paths and actions
- [ ] `cycle-state.yaml` updated with proposals and skipped findings
- [ ] Proposal summary produced

## FAILURE MODES

- Zero eligible findings: output "No proposals — codebase is in good shape" and proceed to close
- All findings are out-of-scope or need human: output summary and close cycle gracefully
- Proposal plan is vague: reject it, add to skipped with reason `plan_too_vague`

## NEXT STEP

**Gating:** At least one approved proposal with a concrete implementation plan, OR explicit "no proposals" close.
**Next:** Load `hive/workflows/steps/meta-team-cycle/step-04-implementation.md`
**If gating fails:** Stop and report which proposals could not be finalized.
