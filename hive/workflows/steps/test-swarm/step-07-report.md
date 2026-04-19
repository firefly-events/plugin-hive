# Step 7: Session Report

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Do NOT produce the report without reading all upstream artifacts — results, coverage, bug reports, and routing decisions
- Do NOT fabricate pass/fail counts — calculate from `.pHive/test-artifacts/{epic-id}/{story-id}/results.yaml`
- Do NOT omit the executive summary — it is the primary output consumed by the orchestrator and humans
- All artifact references MUST point to `.pHive/test-artifacts/` paths — no relative or invented paths
- Include both the executive summary (for quick decisions) and the detailed breakdown (for debugging)

## EXECUTION PROTOCOLS

**Mode:** autonomous

Synthesize all upstream outputs into a consolidated test session report. The report is the final deliverable of the test swarm — it must be complete, accurate, and actionable.

## CONTEXT BOUNDARIES

**Inputs available:**
- Execution results from step 3 (`.pHive/test-artifacts/{epic-id}/{story-id}/results.yaml`)
- Coverage report from step 4 (coverage_report)
- Bug reports from step 5 (bug_reports)
- Routing decisions from step 6 (routing_decisions)
- Context report from step 1 (for story reference)

**NOT available (do not read or assume):**
- Fix implementations (fixes happen after this report)
- Previous session reports
- Other stories' test results

## YOUR TASK

Produce a consolidated test session report with pass/fail counts, coverage analysis, bug tickets, artifact references, and an executive summary with actionable recommendations.

## TASK SEQUENCE

### 1. Gather all upstream data

Read these artifacts:
- `.pHive/test-artifacts/{epic-id}/{story-id}/results.yaml` — execution results
- Coverage report from step 4
- Bug reports and triage summary from step 5
- Routing decisions from step 6

### 2. Calculate aggregate metrics

From results.yaml, compute:
- Total tests executed
- Tests passed / failed / skipped
- Pass rate percentage
- Total execution time
- Per-platform breakdown (if multiple platforms)

From coverage report:
- Coverage percentage
- Number of gaps by severity

From bug reports:
- Total bugs filed
- By severity (high / medium / low)
- By routing (auto-routed / escalated)

### 3. Produce executive summary

A concise summary for quick decision-making:

```markdown
## Executive Summary

**Story:** {story-id} — {story title}
**Verdict:** {PASS | PASS WITH ISSUES | FAIL}
**Date:** {timestamp}

| Metric | Value |
|--------|-------|
| Tests Executed | {count} |
| Pass Rate | {percentage}% |
| Coverage | {percentage}% |
| Bugs Filed | {count} (H:{high} M:{medium} L:{low}) |
| Human Escalations | {count} |
| Auto-Routed Fixes | {count} |

**Verdict Logic:**
- PASS: All tests pass, coverage >= 80%, no high-severity bugs
- PASS WITH ISSUES: Tests pass but coverage gaps exist, or only low-severity bugs
- FAIL: Any high-severity bug, or pass rate < 70%, or critical coverage gaps

**Recommendations:**
1. {Most important action item}
2. {Second action item}
3. {Third action item}
```

### 4. Produce detailed breakdown

```markdown
## Detailed Test Results

### Per-Platform Results

#### Platform A: {name}
| Test ID | Requirement | Type | Status | Duration |
|---------|-------------|------|--------|----------|
| test-001 | AC-1 | happy_path | PASS | 2300ms |
| test-002 | AC-1 | edge_case | FAIL | 1800ms |

#### Platform B: {name} (if applicable)
{Same table format}

### Coverage Analysis
- Total criteria: {count}
- Fully covered: {count}
- Partially covered: {count}
- Not covered: {count}

**Gaps:**
{Gap list from coverage report with severity}

### Bug Tickets
{Full bug reports from step 5}

### Routing Decisions
- Transient (retry): {count} — {list}
- Story issues (back to planning): {count} — {list}
- Human blockers (escalate): {count} — {list}

### Artifacts
- Results: `.pHive/test-artifacts/{epic-id}/{story-id}/results.yaml`
- Screenshots: `.pHive/test-artifacts/{epic-id}/{story-id}/screenshots/`
- Logs: `.pHive/test-artifacts/{epic-id}/{story-id}/logs/`
```

### 5. Validate report completeness

Verify:
- Pass/fail counts match results.yaml totals
- Every bug from step 5 appears in the report
- Every gap from step 4 appears in the report
- All artifact paths are valid `.pHive/test-artifacts/` paths
- Executive summary verdict matches the data

## SUCCESS METRICS

- [ ] Executive summary produced with verdict, metrics table, and recommendations
- [ ] Pass/fail counts match actual execution results (no fabrication)
- [ ] Coverage percentage matches inspector's analysis
- [ ] All bug tickets included with severity and routing
- [ ] All artifact references point to `.pHive/test-artifacts/` paths
- [ ] Detailed breakdown includes per-platform results
- [ ] Verdict logic is correctly applied (PASS / PASS WITH ISSUES / FAIL)

## FAILURE MODES

- **Fabricating metrics:** Reporting counts that do not match results.yaml. Always calculate from the source artifact.
- **Missing executive summary:** The detailed report exists but the orchestrator needs a quick verdict. Always include both.
- **Broken artifact references:** Pointing to paths outside `.pHive/test-artifacts/` or paths that do not exist.
- **Optimistic verdict:** Reporting PASS when high-severity bugs exist or coverage is below threshold.
- **Missing recommendations:** The report describes problems but does not suggest next actions.

## NEXT STEP

**Gating:** Session report is complete with executive summary and detailed breakdown. All metrics verified against source data.
**Next:** Load `workflows/steps/test-swarm/step-08-promote.md`
**If gating fails:** Report which sections are incomplete and why. Do not continue workflow.
