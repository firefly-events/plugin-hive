# Step 6: Evaluation

## OUTPUT FORMAT (executor contract)

Step output is a JSON object that distinguishes per-change and
cycle-level verdicts. The DAG executor binds downstream `when:`
predicates to specific fields by name; missing fields fail-closed
(downstream skips with a `predicate_evaluated` warning event per
`hive/references/predicate-grammar.md`).

```yaml
output_format:
  # Per-change entries — one per change with status: done from step 4.
  evaluations: list  # [{change_id: str, change_verdict: str, reason: str, ...}]
                     # change_verdict ∈ {passed, needs_optimization, needs_revision}
  # Cycle-level aggregate — single value over all changes in the cycle.
  cycle_verdict: str        # one of: passed | partial | poor
  pass_count: int
  needs_optimization_count: int
  needs_revision_count: int
  # Promotion-evidence inputs for step 7 / step 8.
  metrics_snapshot: dict    # raw candidate metric values (non-empty)
  compare: dict             # hive.lib.meta_experiment.compare output
```

`change_verdict` and `cycle_verdict` are DIFFERENT fields living in
DIFFERENT value spaces:

- `change_verdict` (per change): `passed | needs_optimization | needs_revision`.
  Same 3-value space as `reviewer.md` and `step-06-review.md`.
- `cycle_verdict` (per cycle, aggregate): `passed | partial | poor`.
  `passed` here means "cycle-aggregate-pass" — different semantics
  from change-level `passed`.

Predicates referencing the change-level verdict MUST use
`$step.output.evaluations[*].change_verdict` or the per-change view —
never bare `$step.output.verdict`. Bare `verdict` is undefined under
the executor contract and fail-closes to False — see
`hive/references/predicate-grammar.md` Risk #13.

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
envelope, or metrics-carrier files inline from this step. Step 7 remains
output-graph-only as well: it returns promotion results and evidence but does
not perform persistent control-plane writes. Step 8 (promotion/close) is the
single lifecycle writer responsible for persistent control-plane writes
coordinated through the workflow output graph and the B0 envelope contract
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

Evaluate each implemented change against the safety-constraints quality bar plus swarm charter criteria. Assign `passed`, `needs_optimization`, or `needs_revision` change_verdict per change, with rationale.

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
change_verdict: passed | needs_optimization | needs_revision
charter_objective: {which objective this addresses}
quality_score: {0.0-1.0}
rationale: |
  {Why this change_verdict. Cite specific evidence.}
revision_notes: |
  {Only if needs_revision — specific fix required}
```

The field name is `change_verdict`, not bare `verdict`. Predicates on
this output bind by name (`$step.output.evaluations[*].change_verdict`);
silent renames will fail-close downstream routing — see
`hive/references/predicate-grammar.md` Risk #13.

### 3. Aggregate results
- Count: passed, needs_optimization, needs_revision (per-change `change_verdict`)
- Overall `cycle_verdict`: `passed` if ≥ 70% of changes are passed or needs_optimization; `partial` if 40–70%; `poor` if < 40%
- Cycle-level value space (`passed | partial | poor`) is distinct from change-level (`passed | needs_optimization | needs_revision`); bind predicates by explicit field name (see OUTPUT FORMAT above)

### 4. Bind compare output to metrics_snapshot (BL2.3)
Use `hive.lib.meta_experiment.compare` with the captured baseline already present in the envelope context and the candidate metrics collected during the step-04/step-05 run.

- Load the baseline from the current envelope context
- Emit `metrics_snapshot` as the raw candidate metric dict, for example
  `{'tokens': 0, 'wall_clock_ms': 39, 'first_attempt_pass': true}`. This value
  must stay non-empty and is what step 8 later places into the envelope for
  post-close `rollback_watch.evaluate_watch(...)` comparisons.
- Compare the baseline against those candidate metrics using
  `hive.lib.meta_experiment.compare`
- Produce a separate comparison dict such as `evaluation_results.compare` or
  `evaluation_results.verdict`
- Base the evaluation verdict on that compare output rather than on prose-only
  reasoning
- Do not write promotion evidence here; step 7 owns promotion evidence and step 8
  later consumes the raw `metrics_snapshot`

This makes the step-06 verdict explicitly depend on the shared lifecycle library output that step 8 later validates.

The compare output itself is separate workflow output, such as
`evaluation_results.compare` or `evaluation_results.verdict`. Do not substitute
that verdict/regression-metrics structure for the envelope `metrics_snapshot`;
the snapshot must remain the raw candidate values that
`rollback_watch.evaluate_watch(...)` will later compare against post-close
observations.

#### 4a. Evidence shape preservation

- `metrics_snapshot` must be a non-empty dict
- `metrics_snapshot` must contain raw metric values only; do not embed compare output
- Evaluation must NOT populate `commit_ref` or `pr_ref`
- Step 7 remains the sole owner of promotion evidence fields; step 6 only
  produces raw `metrics_snapshot` plus separate compare output

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
metrics_snapshot: {non-empty raw candidate metric dict}
compare: {structured compare output}
```

### 6. Produce evaluation report
```
## Evaluation Report — Cycle {cycle_id}

Cycle verdict: {cycle_verdict}   # passed | partial | poor
Changes evaluated: {N}
  Passed: {N}
  Needs optimization: {N}
  Needs revision: {N}

Results:
  [passed] {proposal_id}: {rationale summary}
  [needs_optimization] {proposal_id}: {what to improve}
  [needs_revision] {proposal_id}: {what to fix}
```

## SUCCESS METRICS

- [ ] Each change with `status: done` has an evaluation entry
- [ ] Each evaluation cites specific evidence (not just "looks good")
- [ ] Overall cycle verdict calculated
- [ ] `metrics_snapshot` is a non-empty raw candidate metric dict
- [ ] `hive.lib.meta_experiment.compare` output is emitted separately and drives the verdict
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
