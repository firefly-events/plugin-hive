# Step 6: Evaluation

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Evaluate each change independently — don't let a strong change inflate a weak one
- Use the quality bar in `hive/references/meta-safety-constraints.md` (A1.2 authoritative reference) plus the swarm-specific charter in effect (per A2.7 post-rewrite — the legacy meta-team charter is ARCHIVED and must not be treated as the active authority)
- Self-review bias check: you did not implement any of these changes (you are the reviewer agent) — evaluate honestly

## EXECUTION PROTOCOLS

**Mode:** autonomous

**Authority model:** this step is read-only against the code under review and
its sole persistent output is the `evaluation_results` JSON + `verdict` string
returned via the workflow output graph. Do NOT write cycle-state, ledger,
envelope, or metrics-carrier files inline from this step. Downstream steps
(promotion, close) own persistent control-plane writes coordinated through
the workflow output graph and the B0 envelope contract
(`.pHive/epics/meta-improvement-system/docs/b0-consumer-contract.md`). The
quality bar is the A1.2 shared safety-constraints reference
(`hive/references/meta-safety-constraints.md`) plus the active swarm's charter.
`.pHive/meta-team/charter.md` is ARCHIVED — do not use it as the quality bar.

Read all changes and test results. Apply the safety-constraints quality bar +
swarm-specific charter criteria. Produce a final verdict per change.

## CONTEXT BOUNDARIES

**Inputs available:**
- `changes_made` from step 4 — what was written
- `test_results` from step 5 — pass/fail per check
- `hive/references/meta-safety-constraints.md` — authoritative quality bar
- swarm-specific charter (post-A2.7)
- Full codebase read access

**NOT available:**
- Write access to files under review
- User input

## YOUR TASK

Evaluate each implemented change against the safety-constraints quality bar plus swarm charter criteria. Assign `pass`, `needs_optimization`, or `needs_revision` verdict per change, with rationale.

## TASK SEQUENCE

### 1. Load evaluation inputs
Read:
- `changes_made` from step 4 and `test_results` from step 5
- `hive/references/meta-safety-constraints.md` plus the active swarm's charter
  for the quality bar criteria

If the active swarm charter is not present (historical cycle-state or pre-A2.7
state), fall back to `hive/references/meta-safety-constraints.md` alone rather
than using the archived legacy meta-team charter.

### 2. Evaluate each change

For each change with `status: done` from step 4:

#### 2a. Read the actual change
Open the file that was written or modified. Read the added content.

#### 2b. Apply safety-constraints quality bar plus swarm charter criteria
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

### 4. Bind compare output to metrics_snapshot (BL2.3)
Use `hive.lib.meta_experiment.compare` with the captured baseline already present in the envelope context and the candidate metrics collected during the step-04/step-05 run.

- Load the baseline from the current envelope context
- Compare the baseline against the candidate metrics using `hive.lib.meta_experiment.compare`
- Produce a comparison dict
- Step-06 emits `metrics_snapshot` for the envelope as the raw candidate metric values that post-close rollback watching will compare against later, for example `{'tokens': 0, 'wall_clock_ms': 39, 'first_attempt_pass': true}`. This value is consumed by step-08 during envelope assembly. Step-06 does not write the envelope directly.
- Include the compare-derived `metrics_snapshot` in `evaluation_results` or as a sibling workflow output field
- Base the evaluation verdict on that comparison output rather than on prose-only reasoning
- Evaluation must emit the `metrics_snapshot` and the decision verdict in a form that can later serve as the baseline for post-close `rollback_watch.evaluate_watch(...)` comparisons.

This makes the step-06 verdict explicitly depend on the shared lifecycle library output that step 8 later validates.

The compare output itself is separate workflow output, such as `evaluation_results.compare` or `evaluation_results.verdict`. Do not substitute that verdict/regression-metrics structure for the envelope `metrics_snapshot`; the snapshot must remain the raw baseline values that `rollback_watch.evaluate_watch(...)` will later compare against post-close observations.

#### 4a. Evidence shape preservation

- `metrics_snapshot` must be a non-empty dict
- Evaluation must NOT populate `commit_ref` or `pr_ref`
- Step 7 remains the sole owner of promotion evidence fields; step 6 only produces the compare-backed `metrics_snapshot`

### 5. Compile workflow outputs
This structured dictionary is the `evaluation_results` workflow output for this
step, not a side-effect write:
```yaml
evaluations:
  - {evaluation objects}
cycle_verdict: passed | partial | poor
pass_count: {N}
needs_optimization_count: {N}
needs_revision_count: {N}
metrics_snapshot: {non-empty compare-derived dict}
```

### 6. Produce evaluation report
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
- [ ] `hive.lib.meta_experiment.compare` output is bound into a non-empty `metrics_snapshot`
- [ ] `evaluation_results` output emitted with per-change entries and cycle_verdict
- [ ] Evaluation report produced

## FAILURE MODES

- Change content is missing (file not found): verdict is `needs_revision` — implementation failed
- Test results for a change are absent: apply conservative evaluation (check the file manually)
- All changes pass: valid outcome — don't invent problems to seem rigorous

## WHAT THIS STEP DOES NOT OWN

- Persistent cycle-state / ledger / envelope writes — Step 8 (close) is the single lifecycle writer per A2.1–A2.5; Step 7 (promotion) is output-graph-only and does not perform inline persistent writes
- Metrics-carrier emission (C2 emitters, opt-in)
- Promotion or revert decisions (Step 7)
- Closure invariant checks (Step 8 close validator per B0 §1.11)
- Fixing changes the evaluator flagged (re-planning or next-cycle handling)
- Redefining the quality bar (anchored in hive/references/meta-safety-constraints.md + swarm charter)

## NEXT STEP

**Gating:** All changes evaluated. `cycle_verdict` surfaced in `evaluation_results` output and `verdict` returned via the workflow output graph.
**Next:** Load `hive/workflows/steps/meta-team-cycle/step-07-promotion.md`
**If gating fails:** Report which changes could not be evaluated.
