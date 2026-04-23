# Step 3: Proposal

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Only propose changes within charter scope — re-read `.pHive/meta-team/charter.md` scope table before ranking
- Do NOT propose changes that require human confirmation (config changes, tool list changes) — skip them
- Each proposal must have an explicit implementation plan — "improve this doc" is not a plan
- Cap approved proposals at 5 per cycle — prioritize depth over breadth

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
discovery_source: internal_audit  # or: external_research
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

> **Backward compatibility:** Proposals written before this field was added (i.e., proposals without a `discovery_source` entry) default to `internal_audit` for schema-handling purposes. Do NOT reject or fail a proposal for a missing `discovery_source` field — treat it as the default.

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
