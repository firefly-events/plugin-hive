# Step 5: Test

## MANDATORY EXECUTION RULES (READ FIRST)

- You MUST produce actual test files — not just an assessment that "tests look good"
- Every acceptance criterion in the story MUST have at least one corresponding test
- Tests MUST pass when run. Never submit tests that fail.
- Never claim tests pass without running them
- Use existing test patterns from the project — do not introduce new test frameworks
- Review step is BLOCKED until test artifacts exist

## EXECUTION PROTOCOLS

**Mode:** autonomous

Write tests, run them, verify they pass. Produce test artifacts and results.

## CONTEXT BOUNDARIES

**Inputs available:**
- Story spec (acceptance criteria = test requirements)
- Implementation from step 3 (the code under test)
- Research brief from step 2 (test infrastructure, existing patterns)

**NOT available:**
- Review feedback (that's step 6)

## YOUR TASK

Write comprehensive tests that verify every acceptance criterion, then run them to confirm they pass.

## TASK SEQUENCE

### 0. Check for existing progress
Check `.pHive/episodes/{epic-id}/{story-id}/` for test episode.
If completed, skip to next step.

### 1. Map acceptance criteria to tests
For each acceptance criterion in the story spec:
- Identify the test type: unit, integration, or E2E
- Identify the test location following project conventions
- Plan the test: input, expected output, assertions

### 2. Write tests
For each planned test:
- Follow existing test patterns from the project (check research brief)
- Use the project's test framework (jest, pytest, JUnit, etc.)
- Include: happy path, error case, edge case for each criterion
- If cross-cutting concerns specify test tags: add them

### 3. Run tests
```bash
{project_test_command}  # e.g., npm test, ./gradlew test, pytest
```

- ALL tests must pass
- If any test fails: fix the test (if test is wrong) or report implementation bug
- Never submit failing tests

### 4. Verify coverage
Check that every acceptance criterion has at least one test:
- List each criterion and its corresponding test(s)
- If a criterion has no test: write one

### 5. Produce test results
```markdown
## Test Results
- Total: {N} tests, {pass} passed, {fail} failed

## Coverage Map
| Acceptance Criterion | Test File | Test Name | Status |
|---------------------|-----------|-----------|--------|
| AC-1: ... | test/foo.test.ts | should do X | pass |
| AC-2: ... | test/bar.test.ts | should handle Y | pass |

## Test Artifacts
- test/foo.test.ts (new)
- test/bar.test.ts (new)
```

## SUCCESS METRICS

- [ ] Every acceptance criterion has at least one test
- [ ] All tests pass
- [ ] Test files actually exist (not just described)
- [ ] Tests use existing project patterns and framework
- [ ] Coverage map links criteria to specific tests

## FAILURE MODES

- **No test artifacts:** Saying "tests look good" without writing test files. The review step requires actual test code.
- **Tests that don't run:** Test files exist but aren't wired into the test runner. Verify with the test command.
- **Claiming coverage without verification:** "All criteria are covered" without listing which test covers which criterion.
- **Introducing new test framework:** Use what the project already has.

## NEXT STEP

**Gating:** All tests pass. Test artifacts exist. Coverage map is complete.
**Next:** Load `workflows/steps/development-classic/step-06-review.md`
**If gating fails:** Report failing tests. Fix or report implementation bug.
