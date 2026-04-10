# Step 6: Review

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
- If **needs_optimization**: go to `step-07-optimize.md`
- If **needs_revision**: route to fix loop (orchestrator handles)
