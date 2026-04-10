# Step 2: Test Spec (TDD)

## MANDATORY EXECUTION RULES (READ FIRST)

- You are writing tests BEFORE implementation — there is NO code to test against
- Tests MUST FAIL when run — if they pass, something is wrong (you're not in TDD mode)
- Do NOT write implementation code — you produce ONLY test files
- Every acceptance criterion MUST have at least one test
- Use existing test patterns from the research brief
- Produce a test manifest mapping each test to its acceptance criterion

## EXECUTION PROTOCOLS

**Mode:** autonomous

Write failing tests from spec only. Verify they fail. Produce manifest.

## CONTEXT BOUNDARIES

**Inputs available:**
- Story spec (acceptance criteria are your test requirements)
- Research brief from step 1 (test infrastructure, existing patterns, affected files)

**NOT available:**
- Implementation code (doesn't exist yet — that's the point of TDD)
- Other story test files

## YOUR TASK

Write tests that define expected behavior from the story specification. Tests must fail because no implementation exists yet.

## TASK SEQUENCE

### 1. Map acceptance criteria to tests
For each acceptance criterion:
- Define test name, input, expected output, assertions
- Choose test type: unit, integration, E2E
- Follow existing test patterns from research brief

### 2. Write test files
For each planned test:
- Use the project's test framework
- Write clear assertions against expected behavior
- Test file location follows project conventions
- Include edge cases and error scenarios per criterion

### 3. Run tests — verify they FAIL
```bash
{project_test_command}
```
- ALL new tests should FAIL (no implementation exists)
- If any test passes: the test is wrong (testing nothing) — fix it
- Existing tests should still pass (you didn't break anything)

### 4. Produce test manifest
```markdown
## Test Manifest

| Acceptance Criterion | Test File | Test Name | Status |
|---------------------|-----------|-----------|--------|
| AC-1: ... | test/foo.test.ts | should do X when Y | FAIL (expected) |
| AC-2: ... | test/bar.test.ts | should reject Z | FAIL (expected) |

## Test Files Created
- test/foo.test.ts
- test/bar.test.ts

## Existing Tests: {all passing | N failures — details}
```

## SUCCESS METRICS

- [ ] Every acceptance criterion has at least one test
- [ ] ALL new tests fail (no implementation exists)
- [ ] Existing tests still pass
- [ ] Tests use existing project framework and patterns
- [ ] Test manifest maps each test to its criterion
- [ ] No implementation code was written

## FAILURE MODES

- **Tests that pass:** In TDD, passing tests before implementation means the test is trivially true. Fix it.
- **Writing implementation code:** This step writes ONLY tests. Implementation is step 3.
- **Tests that assume internal structure:** Test against public interfaces and expected behavior, not implementation details that don't exist yet.
- **Breaking existing tests:** Your new test files should not affect existing tests.

## NEXT STEP

**Gating:** All new tests fail. All existing tests pass. Test manifest is complete.
**Next:** Load `workflows/steps/development-tdd/step-03-implement.md`
