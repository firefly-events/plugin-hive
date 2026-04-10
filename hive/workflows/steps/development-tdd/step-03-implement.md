# Step 3: Implement (TDD)

## MANDATORY EXECUTION RULES (READ FIRST)

- Do NOT modify test files. The tests from step 2 are the contract. You satisfy them, not change them.
- Write the MINIMUM code needed to make all failing tests pass
- Run the full test suite after EVERY file change
- NEVER proceed with failing tests
- NEVER claim tests pass without running them
- Follow existing patterns from the research brief
- If a test seems wrong: flag it in your summary. Do NOT modify it.

## EXECUTION PROTOCOLS

**Mode:** autonomous

Make all failing tests pass with minimum code. Do not touch test files.

## CONTEXT BOUNDARIES

**Inputs available:**
- Story spec (acceptance criteria, files_to_modify, design_decisions)
- Research brief from step 1 (patterns, utilities, approach)
- Test files and test manifest from step 2 (the contract to satisfy)

**NOT available:**
- Permission to modify test files (tests are the spec)

## YOUR TASK

Implement the minimum code needed to make all failing tests from step 2 pass.

## TASK SEQUENCE

### 1. Read test manifest
Understand what each test expects: input, expected output, assertions.
The tests define the implementation requirements.

### 2. Implement to satisfy tests
For each failing test (in order of the test manifest):
a. Read the test to understand what it expects
b. Write the minimum implementation code to make it pass
c. Run the full test suite:
```bash
{project_test_command}
```
d. If the test now passes: move to next
e. If it still fails: iterate on implementation (NOT on the test)

### 3. Verify all tests pass
After implementing for all tests:
- Run full suite one more time
- ALL tests (new and existing) must pass
- Count: 0 failures

### 4. Address cross-cutting concerns
If the story has a `cross_cutting` section, implement those requirements.
Run tests again after each concern is addressed.

### 5. Produce implementation summary
```markdown
## TDD Implementation Complete

## Changes Made
- `path/to/file.ts` — what was implemented to satisfy which test(s)

## Test Results
- All {N} tests passing (was {N} failing before implementation)
- Test files NOT modified

## Cross-Cutting Concerns
- {concern}: {what was done}

## Files Modified (implementation only — no test files)
- path/to/file1.ts
- path/to/file2.ts

## Notes
- Any tests that seemed wrong (flagged, not modified)
```

## SUCCESS METRICS

- [ ] ALL tests from step 2 now pass
- [ ] NO test files were modified
- [ ] Implementation is minimal — no extra features or abstractions
- [ ] Cross-cutting concerns addressed
- [ ] Only files in files_to_modify were changed
- [ ] Existing tests still pass

## FAILURE MODES

- **Modifying test files:** The #1 TDD violation. Tests are the contract. If you change them to make them pass, you're not doing TDD.
- **Over-engineering:** Writing more code than tests require. TDD says: make the test pass, nothing more.
- **Skipping tests:** "Tests probably pass" without running them. Run. Every. Time.
- **Ignoring a failing test:** If you can't make a test pass, flag it — don't silently skip.

## NEXT STEP

**Gating:** All tests pass. No test files modified. Implementation summary produced.
**Next:** Load `workflows/steps/development-classic/step-06-review.md` (shared with classic)
