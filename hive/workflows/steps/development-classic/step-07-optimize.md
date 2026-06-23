# Step 7: Optimize

## MANDATORY EXECUTION RULES (READ FIRST)

- This step is OPTIONAL — only runs when review verdict is needs_optimization
- Address ONLY the findings from the review — do not add unrelated improvements
- Do NOT change behavior — only improve quality, performance, or clarity
- Re-run tests after every change to verify nothing broke
- If review verdict was "passed": SKIP this step entirely

## EXECUTION PROTOCOLS

**Mode:** autonomous

Apply review findings. Verify tests still pass. Produce summary.

## CONTEXT BOUNDARIES

**Inputs available:**
- Review findings from step 6 (the specific improvements to make)
- Implementation from step 3
- Story spec

**NOT available:**
- New requirements (scope is locked to review findings)

## YOUR TASK

Apply each improvement from the review findings without changing behavior.

## TASK SEQUENCE

### 1. Read review findings
Extract each needs_optimization finding: file, line, what to improve.

### 2. Apply each finding
For each improvement finding:
- Make the change
- Run tests to verify nothing broke
- Record what was changed

### 3. Final verification
- Run full test suite
- Verify all acceptance criteria still pass
- Confirm behavior is unchanged

### 4. Produce optimization summary
```markdown
## Optimization Applied
- `file.ts:42` — {what was improved}
- `other.ts:55` — {what was improved}

## Tests: {all pass | REGRESSION — details}
```

## SUCCESS METRICS

- [ ] Every needs_optimization finding addressed
- [ ] Tests pass after all changes
- [ ] No behavioral changes — only quality/performance/clarity improvements

## FAILURE MODES

- **Scope creep:** Improving things the reviewer didn't mention.
- **Breaking behavior:** "Optimization" that changes what the code does.
- **Not re-running tests:** Optimization may introduce regressions.

## NEXT STEP

**Gating:** All findings addressed. Tests pass.
**Next:** Load `workflows/steps/development-classic/step-08-integrate.md`


## DAG executor outputs (required)

Before finishing, WRITE this step's declared outputs to
`.pHive/dag-outputs/outputs.yaml` (create the directory) in your working copy,
as a flat `key: value` YAML map. The DAG executor reads this file from your
work_dir and merges it onto this step's output graph so downstream nodes can
consume the values; without it those edges resolve to nothing and the run
fails. This file is gitignored execution scratch — do not commit it.

```yaml
optimized_implementation: <value>
```

Use concrete values: for path/artifact outputs give the repo-relative path you
wrote; for verdict/status give the literal string; for summaries give a short
string (or a path to the file you wrote). Do not omit a declared key.
