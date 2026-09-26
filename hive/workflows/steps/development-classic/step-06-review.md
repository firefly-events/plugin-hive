# Step 6: Review

## OUTPUT FORMAT (executor contract)

Step output is a JSON object matching this schema. The DAG executor binds
the gate-review node and downstream `when:` predicates to these fields. The
field names below are the SINGLE canonical schema — they match the `review`
node's declared outputs in `development.classic.workflow.yaml`
(`review_verdict`, `review_findings`, `review_passed`). A missing
`review_verdict` or `review_passed` fail-closes:
gate-review BLOCKS integrate rather than shipping an unreviewed change (see
`hive/references/predicate-grammar.md`).

```yaml
output_format:
  review_verdict: str    # one of: passed | needs_optimization | needs_revision
  review_findings: str   # human-readable findings, each citing file:line
  review_passed: bool    # true when review_verdict is passed or needs_optimization
```

The classic terminal gate references the grammar-valid boolean
`$step.output.review_passed == true`; GateHandler validates the paired verdict
before allowing it to pass. Bare `$step.output.verdict` is undefined under
this contract and fail-closes to False — see predicate-grammar.md Risk #13.

## MANDATORY EXECUTION RULES (READ FIRST)

- You are a DIFFERENT agent from the developer — fresh context, no shared state
- GATE: Do NOT run if test step produced no test artifacts — reject and send back
- Every finding MUST reference a specific file path and line number
- Verdict MUST be exactly one of: passed, needs_optimization, needs_revision
- If cross-cutting concerns exist in the story, verify each is addressed

## EXECUTION PROTOCOLS

**Mode:** autonomous

Independent review with structured output. No collaboration with developer — you see only the final artifacts.

## CONTEXT BOUNDARIES

**Inputs available:**
- Story spec (acceptance criteria, design decisions, cross_cutting concerns)
- Research brief (architectural context and constraints)
- Implementation summary and changed files from step 3
- Test results and test artifacts from step 5
- Platform verification results from step 4 (if it ran)

**NOT available:**
- Developer's internal reasoning or episode records
- Researcher's raw exploration

## YOUR TASK

Evaluate the implementation and tests for correctness, security, performance, and convention compliance. Produce a verdict.

## TASK SEQUENCE

### 1. Verify test artifacts exist
Check that step 5 produced actual test files (not just a "tests pass" message).
If no test artifacts: **REJECT. Verdict: needs_revision. Reason: no test artifacts.**

### 2. Verify acceptance criteria
For each acceptance criterion in the story spec:
- Is there corresponding implementation code?
- Is there a corresponding test?
- Does the implementation satisfy the criterion?

### 3. Review dimensions
Evaluate across these dimensions:

**Correctness:** Does the code do what the spec says? Are edge cases handled?
**Security:** Input validation, injection risks, auth checks, data exposure?
**Performance:** Unnecessary loops, N+1 queries, missing indexes, large payloads?
**Conventions:** Follows existing patterns from research brief? Naming, structure, formatting?
**Test quality:** Tests are meaningful (not trivially passing)? Cover error cases?

### 4. Verify cross-cutting concerns
If the story has a `cross_cutting` section:
- For each concern: is the specified action implemented?
- Check against the concern's implementation checklist

### 5. Produce verdict

```markdown
## Review Verdict: {passed | needs_optimization | needs_revision}

### Acceptance Criteria
- [x] AC-1: satisfied in `file.ts:42`
- [x] AC-2: satisfied in `other.ts:18`

### Cross-Cutting Concerns
- [x] {concern}: {verified how}

### Findings

#### Critical (blocks merge)
- **[{category}]** `file.ts:42` — {finding}

#### Improvements (recommended)
- **[{category}]** `file.ts:55` — {suggestion}

#### Nits (optional)
- **[{category}]** `file.ts:60` — {minor observation}

### Summary
{One-sentence overall assessment}
```

**Verdict rules:**
- **passed** — no critical findings, all AC satisfied, tests meaningful
- **needs_optimization** — no blockers, but improvements would help (triggers step 7)
- **needs_revision** — critical issues that must be fixed (triggers fix loop or replanning)

### 6. Emit structured output (executor contract)

In addition to the prose verdict above, emit a JSON object matching the
OUTPUT FORMAT declared at the top of this file. Predicate-evaluator
fail-closed semantics: omit a required field and downstream `when:`
predicates skip with a warning — see `hive/references/predicate-grammar.md`.

```json
{
  "review_verdict": "passed | needs_optimization | needs_revision",
  "review_findings": "security — file.ts:42 — <message>; convention — other.ts:10 — <message>",
  "review_passed": true
}
```

`review_passed` is the convergence signal the terminal gate (`gate-review`)
evaluates. It MUST be true for `passed` and `needs_optimization` (Hive's own
non-blocking verdict — nits/suggestions, not defects) and false only for
`needs_revision`:
- `passed`             → `review_passed: true`  (permits integrate)
- `needs_optimization` → `review_passed: true`  (permits integrate)
- `needs_revision`     → `review_passed: false` (blocks integrate)

The orchestrator-narrated path consumes the prose section; the executor path
binds to this JSON. Both must agree. Missing, malformed, or inconsistent
values are rejected by the terminal gate — never infer approval from a
non-empty or merely non-`needs_revision` verdict.

## SUCCESS METRICS

- [ ] Test artifacts verified to exist before review started
- [ ] Every acceptance criterion checked against implementation
- [ ] All review dimensions evaluated
- [ ] Cross-cutting concerns verified (if present)
- [ ] Verdict is exactly one of the three allowed values
- [ ] Every finding references specific file:line

## FAILURE MODES

- **Self-review:** Being the same agent instance as the developer. Must be separate.
- **Rubber-stamping:** "Looks good" without checking each AC. Verify every criterion.
- **Vague findings:** "Code could be better" without file:line references. Be specific.
- **Invalid verdict:** Using "approved" or "rejected" instead of the three allowed values.
- **Skipping cross-cutting concerns:** These are additional acceptance criteria.

## NEXT STEP

**Gating:** Verdict produced.
- If **passed**: skip step 7 (optimize), go to `step-08-integrate.md`
- If **needs_optimization**: satisfies the terminal gate (permits integrate);
  go to `step-07-optimize.md` for the recommended follow-ups, then
  `step-08-integrate.md`
- If **needs_revision**: route to fix loop (orchestrator handles)


## DAG executor outputs (required)

Before finishing, WRITE this step's declared outputs to
`.pHive/dag-outputs/outputs.yaml` (create the directory) in your working copy,
as a flat `key: value` YAML map. The DAG executor reads this file from your
work_dir and merges it onto this step's output graph so downstream nodes can
consume the values; without it those edges resolve to nothing and the run
fails. This file is gitignored execution scratch — do not commit it.

```yaml
review_verdict: <value>
review_findings: <value>
review_passed: <true|false>
```

Use concrete values: for path/artifact outputs give the repo-relative path you
wrote; for verdict/status give the literal string; for summaries give a short
string (or a path to the file you wrote). Do not omit a declared key.

### Findings report (required — s3-persist-review-findings)

In ADDITION to `outputs.yaml`, write the full prose verdict from step 5
("Produce a verdict") to `.pHive/dag-outputs/review-report.md` in your
working copy, on EVERY review round (the initial `review` step and every
`fix-cycle-review` round). This is the auditable surface an operator reads
when a round blocks — a blocked story must never resolve to an empty or
missing report.

The report MUST be non-blank and MUST name a verdict and the reviewed SHA
(e.g. `## Review Verdict: needs_revision` and a `Reviewed SHA: <sha>` line).
When the verdict carries findings, each one MUST still cite `file:line`
per the MANDATORY EXECUTION RULES above. A clean `passed` round with no
findings is still non-empty — record the verdict, the reviewed SHA, and an
explicit "no findings" statement.

The executor reads this file directly and uses its validated content —
not the terse `review_findings` scalar above — as the authoritative
`review_findings` value. A missing, blank, or structurally invalid report
is treated as an incomplete round and retried, exactly like any other
missing declared output; do not substitute a path string for the report's
actual content in `outputs.yaml`.
