# Step 2: Test Authoring and Manifest Generation

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Do NOT author tests without first reading the scout's context report
- Do NOT choose a test framework that contradicts the scout's detection — use what the project already uses
- Do NOT skip requirement traceability — every test MUST map to an acceptance criterion
- Do NOT invent acceptance criteria — test only what the story spec defines
- Follow existing test patterns from baseline knowledge (naming, directory structure, helpers)
- When referencing testIds/testTags in Maestro scripts, VERIFY the component is actually RENDERED — not just present in source. Check for layout anti-patterns that hide components.

## EXECUTION PROTOCOLS

**Mode:** autonomous

Read the context report from step 1. Detect the appropriate framework per test type. Author test scripts for every acceptance criterion. Produce a test manifest mapping tests to requirements.

## CONTEXT BOUNDARIES

**Inputs available:**
- Context report from step 1 (context_doc)
- Baseline knowledge at `.pHive/test-baseline/{project}/baseline-knowledge.md`
- Story spec YAML (for acceptance criteria reference)
- Project codebase (for existing test patterns)

**NOT available (do not read or assume):**
- Test results (tests have not been executed yet)
- Bug reports (no failures yet)
- Other stories' test files

## YOUR TASK

Map each acceptance criterion to concrete test cases, author test scripts using the detected framework, and produce a structured test manifest that workers and inspectors will consume.

## TASK SEQUENCE

### 1. Load context and baseline

Read the context report from step 1. Extract:
- Acceptance criteria list (these are your test targets)
- Detected test frameworks and config paths
- Existing test patterns and conventions
- Platform targets

Read baseline knowledge for:
- Test directory structure conventions
- Naming patterns for test files
- Shared fixtures or utilities available
- Framework-specific configuration

### 2. Select framework per test type

Based on the scout's framework detection:

| Test Type | Framework Selection |
|-----------|-------------------|
| Mobile UI | Maestro (if `.maestro/` detected) |
| Web UI | Playwright or Cypress (whichever config exists) |
| API/Backend Python | pytest (if `conftest.py` or `pytest.ini` detected) |
| API/Backend JS/TS | Jest or Vitest (whichever config exists) |
| iOS native | XCTest (if `XCTestCase` files detected) |
| Android/JVM | JUnit/Kotest (if `@Test` files detected) |

If no framework detected for a required test type: recommend the most appropriate framework and note it in the manifest as `framework_recommended: true`.

### 3. Map acceptance criteria to test cases

For each acceptance criterion:

- **Happy path test:** The primary expected behavior
- **Edge cases:** Boundary values, empty states, maximum lengths
- **Error states:** Invalid input, network failures, permission denied
- **Regression candidates:** Flag tests that cover areas with history of breakage (from baseline)

Produce a mapping:
```
AC-1: "User can log in with valid credentials"
  - test-001: happy_path — valid email/password login succeeds
  - test-002: edge_case — login with email containing special characters
  - test-003: error_state — login with invalid password shows error message
  - test-004: error_state — login with empty fields shows validation errors
```

### 4. Author test scripts

Write test files following the project's existing patterns:

- Use the same directory structure as existing tests
- Use the same naming conventions (e.g., `test_*.py`, `*.spec.ts`, `*.maestro`)
- Import and reuse existing test utilities and fixtures
- Include clear test descriptions that reference the acceptance criterion

Each test file header should include:
```
# Requirement: {AC-ID}
# Type: {happy_path | edge_case | error_state | regression}
# Framework: {framework name}
# Platform: {target platform}
```

### 5. Verify testId render visibility (Maestro/E2E tests only)

For any test that references a testTag, testId, or accessibilityIdentifier:

a. **Find the component in source:** Grep for the testId in the codebase
b. **Check the layout context:** Read the surrounding layout code
c. **Scan for render-hiding anti-patterns:**
   - `Modifier.weight(1f)` inside a scrollable Column/Row → component gets zero height
   - `LazyVerticalGrid` or `LazyColumn` inside a scrollable Column → zero height rendering
   - `Modifier.alpha(0f)` or `visibility = GONE/INVISIBLE` → present but not visible
   - Conditional rendering (`if (condition)`) where condition may be false in test state
d. **Flag issues:** If a testId exists but the component may be invisible, flag it:
   ```
   WARNING: testId "{id}" in {file}:{line} may not render.
   Reason: {anti-pattern detected}
   Impact: Maestro flow will timeout waiting for element.
   ```

This check prevents a known failure where weight(1f) in a scrollable Column hid ALL new components — testIds existed but Maestro couldn't find them.

### 6. Produce test manifest

Output a structured YAML manifest:

```yaml
test_manifest:
  story_id: "{story-id}"
  generated_at: "{timestamp}"
  frameworks_used:
    - name: "{framework}"
      config_path: "{path to config}"
  tests:
    - test_id: "test-001"
      requirement_ref: "AC-1"
      type: happy_path
      framework: "{framework}"
      script_path: "{path to test file}"
      platform: "{target platform}"
      regression_candidate: false
    - test_id: "test-002"
      requirement_ref: "AC-1"
      type: edge_case
      framework: "{framework}"
      script_path: "{path to test file}"
      platform: "{target platform}"
      regression_candidate: false
  coverage_summary:
    total_criteria: {count}
    criteria_with_tests: {count}
    total_tests: {count}
    by_type:
      happy_path: {count}
      edge_case: {count}
      error_state: {count}
      regression: {count}
```

## SUCCESS METRICS

- [ ] Every acceptance criterion has at least one happy path test
- [ ] Edge cases and error states authored for each criterion
- [ ] All tests map to a specific acceptance criterion (traceability)
- [ ] Framework selection matches scout's detection (not invented)
- [ ] Test files follow existing project conventions (naming, structure, imports)
- [ ] Test manifest produced with complete coverage summary
- [ ] Regression candidates flagged based on baseline knowledge

## FAILURE MODES

- **Authoring tests for wrong framework:** Scout detected pytest but architect writes Jest tests. Always check the context report.
- **Missing requirement traceability:** Tests exist but nobody can tell which acceptance criterion they cover. Every test must have a `requirement_ref`.
- **Inventing test targets:** Testing things not in the story's acceptance criteria causes scope drift and wasted execution time.
- **Ignoring existing patterns:** Writing tests in a completely different style from the project's test suite. Read baseline for conventions.
- **No edge cases or error states:** Only happy paths means coverage gaps the inspector will flag, requiring re-work.

## NEXT STEP

**Gating:** Test manifest is complete. Every acceptance criterion has mapped tests. Test files are written.
**Next:** Load `workflows/steps/test-swarm/step-03-worker.md`
**If gating fails:** Report which criteria lack tests or which framework could not be determined. Do not continue workflow.
