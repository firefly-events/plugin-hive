# Step 6: Evaluation

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Evaluate each change independently — don't let a strong change inflate a weak one
- Use the quality bar in `state/meta-team/charter.md` — don't invent your own criteria
- Self-review bias check: you did not implement any of these changes (you are the reviewer agent) — evaluate honestly

## EXECUTION PROTOCOLS

**Mode:** autonomous

Read all changes and test results. Apply the charter's quality bar. Produce a final verdict per change.

## CONTEXT BOUNDARIES

**Inputs available:**
- `changes_made` from step 4 — what was written
- `test_results` from step 5 — pass/fail per check
- `state/meta-team/charter.md` — quality bar criteria
- Full codebase read access

**NOT available:**
- Write access to files under review
- User input

## YOUR TASK

Evaluate each implemented change against the charter quality bar. Assign `pass`, `needs_optimization`, or `needs_revision` verdict per change, with rationale.

## TASK SEQUENCE

### 1. Load evaluation inputs
Read:
- `state/meta-team/cycle-state.yaml` for changes and test results
- `state/meta-team/charter.md` for the quality bar section

### 2. Evaluate each change

For each change with `status: done` from step 4:

#### 2a. Read the actual change
Open the file that was written or modified. Read the added content.

#### 2b. Apply charter quality bar
A change passes when:
- It addresses a specific, named finding (verify against the finding it claims to address)
- It doesn't break any existing cross-references (check test results)
- It doesn't remove existing functionality
- The content is accurate, consistent with the schema it follows, and usable

A change needs_revision when:
- The test result has a `fail` on schema_compliance or content_safety
- The content doesn't actually address the finding (wrong file, wrong section, misses the point)
- The content introduces a new cross-reference that doesn't resolve

A change needs_optimization when:
- Tests passed but the content could be more complete (e.g., a new reference doc exists but lacks examples)
- Minor wording issues that don't affect usability

#### 2c. Score the change
```yaml
change_id: {proposal_id}_{file_slug}
verdict: pass | needs_optimization | needs_revision
charter_objective: {which objective this addresses}
quality_score: {0.0-1.0}
rationale: |
  {Why this verdict. Cite specific evidence.}
revision_notes: |
  {Only if needs_revision — specific fix required}
```

### 3. Aggregate results
- Count: pass, needs_optimization, needs_revision
- Overall cycle verdict: `passed` if ≥ 70% of changes pass or needs_optimization; `partial` if 40–70%; `poor` if < 40%

### 4. Update cycle-state.yaml
Append to `state/meta-team/cycle-state.yaml`:
```yaml
phase: evaluation
evaluations:
  - {evaluation objects}
cycle_verdict: passed | partial | poor
pass_count: {N}
needs_optimization_count: {N}
needs_revision_count: {N}
```

### 5. Produce evaluation report
```
## Evaluation Report — Cycle {cycle_id}

Cycle verdict: {verdict}
Changes evaluated: {N}
  Pass: {N}
  Needs optimization: {N}
  Needs revision: {N}

Results:
  [pass] {proposal_id}: {rationale summary}
  [needs_optimization] {proposal_id}: {what to improve}
  [needs_revision] {proposal_id}: {what to fix}
```

## SUCCESS METRICS

- [ ] Each change with `status: done` has an evaluation entry
- [ ] Each evaluation cites specific evidence (not just "looks good")
- [ ] Overall cycle verdict calculated
- [ ] `cycle-state.yaml` updated with evaluations and cycle verdict
- [ ] Evaluation report produced

## FAILURE MODES

- Change content is missing (file not found): verdict is `needs_revision` — implementation failed
- Test results for a change are absent: apply conservative evaluation (check the file manually)
- All changes pass: valid outcome — don't invent problems to seem rigorous

## NEXT STEP

**Gating:** All changes evaluated. `cycle_verdict` written to `cycle-state.yaml`.
**Next:** Load `hive/workflows/steps/meta-team-cycle/step-07-promotion.md`
**If gating fails:** Report which changes could not be evaluated.
