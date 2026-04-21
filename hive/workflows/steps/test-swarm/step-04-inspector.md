# Step 4: Coverage Validation

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Do NOT report "100% coverage" without mapping every acceptance criterion to at least one executed test
- Do NOT skip edge case and error state coverage checks — happy path alone is insufficient
- Do NOT invent acceptance criteria — validate only what the story spec defines
- Do NOT rely on test names alone — verify each test actually exercises its claimed criterion
- Cross-cutting concern coverage is not optional — check shared flows, regression areas, and test tags

## EXECUTION PROTOCOLS

**Mode:** autonomous

Compare the test manifest and execution results against the story's acceptance criteria. Identify every gap. Classify gap severity. Produce a structured coverage report with gap analysis.

## CONTEXT BOUNDARIES

**Inputs available:**
- Test manifest from step 2 (test_manifest)
- Context report from step 1 (context_doc)
- Story spec YAML (for acceptance criteria — the authoritative source)
- Execution results from step 3 (results.yaml in `.pHive/test-artifacts/`)

**NOT available (do not read or assume):**
- Bug reports (not filed yet)
- Other stories' test results
- Future test plans

## YOUR TASK

Validate that the authored and executed tests adequately cover the story's acceptance criteria. Identify coverage gaps with specificity and severity classification. Produce a coverage report.

## TASK SEQUENCE

### 1. Extract all testable requirements

Read the story spec YAML. List every acceptance criterion as a testable requirement:

```
REQUIREMENTS:
  AC-1: {criterion text} — testable: yes
  AC-2: {criterion text} — testable: yes
  AC-3: {criterion text} — testable: {yes | no — explain why}
```

Flag any criteria that cannot be automated (e.g., "looks professional" without specific metrics).

### 2. Inventory executed tests

Read the test manifest and `.pHive/test-artifacts/{epic-id}/{story-id}/results.yaml`. For each test, record:
- test_id
- requirement_ref (which AC it covers)
- type (happy_path, edge_case, error_state, regression)
- status (pass/fail from execution)

### 3. Map requirements to tests

For each acceptance criterion, list its covering tests:

```
COVERAGE MAP:
  AC-1: "User can log in with valid credentials"
    - test-001 (happy_path) — PASS
    - test-002 (edge_case) — PASS
    - test-003 (error_state) — FAIL
    - test-004 (error_state) — PASS
    Coverage: 4 tests (1 happy, 1 edge, 2 error)
    Status: COVERED

  AC-2: "User sees error on invalid credentials"
    - test-005 (happy_path) — PASS
    Coverage: 1 test (1 happy, 0 edge, 0 error)
    Status: PARTIAL — missing edge cases

  AC-3: "Session persists across app restart"
    Coverage: 0 tests
    Status: GAP — no tests authored
```

### 4. Identify coverage gaps

For each gap, classify severity:

- **Critical:** Core flow acceptance criterion with no tests at all
- **Critical:** testId exists in source but component is not rendered (layout anti-pattern hiding it) — Maestro timeout
- **Moderate:** Criterion has happy path but missing edge cases or error states
- **Low:** Cosmetic or UX criterion with partial coverage

Produce gap list:
```
GAPS:
  - gap-1:
      criterion: AC-3
      severity: critical
      reason: "No tests authored for session persistence"
      recommendation: "Add Maestro flow: login, kill app, relaunch, verify session"

  - gap-2:
      criterion: AC-2
      severity: moderate
      reason: "Happy path only — no edge cases for special character passwords"
      recommendation: "Add edge case test with unicode/special character passwords"
```

### 5. Check cross-cutting concern coverage

From the context report, verify:
- Shared Maestro flows referenced by this story have tests
- Regression-sensitive areas identified by scout have regression tests
- Test tags/categories are correctly applied
- Integration points between modules have coverage

### 6. Produce coverage report

```yaml
coverage_report:
  story_id: "{story-id}"
  validated_at: "{timestamp}"
  summary:
    total_criteria: {count}
    fully_covered: {count}
    partially_covered: {count}
    not_covered: {count}
    coverage_pct: {(fully + partially) / total * 100}
  by_type:
    happy_path: {count of criteria with happy path tests}
    edge_case: {count of criteria with edge case tests}
    error_state: {count of criteria with error state tests}
  gaps:
    - criterion: "AC-3"
      severity: critical
      reason: "No tests authored"
      recommendation: "{specific test to add}"
    - criterion: "AC-2"
      severity: moderate
      reason: "Missing edge cases"
      recommendation: "{specific test to add}"
  cross_cutting:
    shared_flows_covered: {yes/no — list}
    regression_areas_covered: {yes/no — list}
    tag_compliance: {yes/no}
```

## SUCCESS METRICS

- [ ] Every acceptance criterion mapped to its covering test(s) or explicitly marked as a gap
- [ ] Gap severity classified for each uncovered or partially covered criterion
- [ ] Cross-cutting concerns validated (shared flows, regression areas)
- [ ] Coverage percentage calculated accurately
- [ ] Recommendations provided for each gap (specific enough for architect to act on)
- [ ] Coverage report produced with all sections populated

## FAILURE MODES

- **Reporting 100% coverage without verification:** Claiming full coverage because tests exist, without checking they actually cover the criteria. Map each criterion individually.
- **Missing edge case gaps:** Only checking for happy path presence. A criterion with only a happy path test is "partially covered," not "fully covered."
- **Ignoring cross-cutting concerns:** Shared flows and regression areas are easy to miss but critical for integration quality.
- **Vague gap recommendations:** "Add more tests" is useless. Specify exactly what test to add and what it should verify.
- **Not reading execution results:** Validating against the manifest only misses tests that were authored but failed to execute.

## NEXT STEP

**Gating:** Coverage report is complete with gap analysis. Every criterion has a status.
**Next:** Load `workflows/steps/test-swarm/step-05-sentinel.md`
**If gating fails:** Report which criteria could not be assessed and why. Do not continue workflow.
