# Step 5: Bug Filing

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Do NOT file a bug without: expected behavior, actual behavior, screenshot path (if UI), repro steps, and AI hypothesis
- Do NOT reference screenshots or logs outside `state/test-artifacts/` — all paths must point there
- Do NOT guess at severity — classify based on the defined criteria below
- Do NOT skip the AI hypothesis — analyze the code to explain WHY the failure occurred, not just THAT it occurred
- Every bug report must be structured — no freeform text dumps
- If the dev agent is on standby (idle after review): route fix requests to the dev agent via SendMessage. The dev has full implementation context and can fix faster than a cold agent.
- If no dev agent is available: file the bug as a ticket for manual triage

## EXECUTION PROTOCOLS

**Mode:** autonomous

Process all test failures from execution results. For each failure, gather evidence, analyze root cause, classify severity, and produce a structured bug report. Route based on severity.

## CONTEXT BOUNDARIES

**Inputs available:**
- Execution results from step 3 (platform_a_results, platform_b_results)
- Context report from step 1 (context_doc — for code-level analysis)
- Test artifacts at `state/test-artifacts/{epic-id}/{story-id}/` (screenshots, logs)
- Project codebase (for root cause analysis)

**NOT available (do not read or assume):**
- Coverage report (produced in parallel by inspector)
- Previous bug reports from other test sessions
- User preferences on severity thresholds (use defaults)

## YOUR TASK

Process every test failure into a structured bug ticket with evidence, root cause hypothesis, and severity-based routing. Produce a triage summary.

## TASK SEQUENCE

### 1. Load failure results

Read `state/test-artifacts/{epic-id}/{story-id}/results.yaml`. Filter to tests with `status: fail`. For each failure, collect:
- test_id and requirement_ref
- error message
- screenshot path (if captured)
- log file path

### 2. Gather evidence per failure

For each failing test:

**a. Expected behavior:** From the test's requirement_ref, describe what should have happened.

**b. Actual behavior:** From the error message and logs, describe what happened instead.

**c. Screenshots:** Reference the screenshot path from `state/test-artifacts/{epic-id}/{story-id}/screenshots/{test_id}-fail.png`. If no screenshot was captured, note it explicitly.

**d. Reproduction steps:** Extract from the test script — the test steps ARE the repro steps:
1. {Precondition/setup}
2. {Action taken}
3. {Expected observation}
4. {Actual observation — the failure}

### 3. Generate AI hypothesis

For each failure, analyze the codebase to hypothesize WHY it failed:

- Read the error message and stack trace from the log file
- Identify the relevant source code file and line number
- Analyze the code path that should have produced the expected result
- Hypothesize the root cause at the code level

The hypothesis must be specific:
- BAD: "The login test failed"
- BAD: "There might be a bug in the login code"
- GOOD: "The handler at `src/auth/login.ts:42` does not check for null response from the API, which causes the crash when the network request times out"

### 4. Classify severity

| Severity | Criteria |
|----------|----------|
| **High** | Core user flow blocked, data loss, security issue, crash |
| **Medium** | Feature partially broken, workaround exists, non-critical path |
| **Low** | Cosmetic issue, edge case, minor UX inconsistency |

### 5. Produce bug reports

For each failure, produce a structured report:

```markdown
## Bug: {descriptive title}

**Severity:** {low | medium | high}
**Routing:** {auto-routed | escalated}
**Platform:** {iOS | Android | Web | Backend}
**Test ID:** {test_id}
**Requirement:** {requirement_ref}

### Expected
{What should have happened — from acceptance criterion}

### Actual
{What happened instead — from error and logs}

### Screenshots
{Path: state/test-artifacts/{epic-id}/{story-id}/screenshots/{test_id}-fail.png}

### Reproduction Steps
1. {Step from test script}
2. {Step}
3. {Observe failure}

### AI Hypothesis
{Code-level analysis of why this likely broke}

### Affected Code
- {file paths and line numbers if identifiable}

### Log Reference
{Path: state/test-artifacts/{epic-id}/{story-id}/logs/{framework}-{test_id}.log}
```

### 6. Route by severity

- **Low severity:** Auto-route to dev queue (no human intervention needed)
- **Medium severity:** Auto-route unless pattern history suggests escalation
- **High severity:** Always escalate to human via task tracker

### 7. Produce triage summary

```yaml
triage_summary:
  story_id: "{story-id}"
  triaged_at: "{timestamp}"
  total_failures: {count}
  by_severity:
    high: {count}
    medium: {count}
    low: {count}
  routing:
    auto_routed: {count}
    escalated: {count}
  bugs:
    - bug_id: "bug-001"
      title: "{title}"
      severity: "{severity}"
      routing: "{auto-routed | escalated}"
      test_id: "{test_id}"
      requirement_ref: "{AC-ID}"
```

## SUCCESS METRICS

- [ ] Every failing test has a structured bug report
- [ ] All bug reports include: expected, actual, screenshot path, repro steps, AI hypothesis
- [ ] All screenshot and log references point to `state/test-artifacts/` paths
- [ ] Severity classified for each bug using the defined criteria
- [ ] High severity bugs marked for escalation
- [ ] Low severity bugs auto-routed
- [ ] Triage summary produced with counts and routing decisions

## FAILURE MODES

- **Missing AI hypothesis:** "The test failed" is not a bug report. The hypothesis is what separates useful triage from noise.
- **Screenshot references outside state/test-artifacts/:** Downstream consumers (report, humans) cannot find the evidence. All paths must be canonical.
- **Wrong severity classification:** Over-classifying cosmetic issues as high wastes human attention. Under-classifying crashes as low misses critical bugs.
- **Freeform bug reports:** Without structure, bugs are hard to triage, track, and fix. Use the template.
- **Not reading log files:** The error message alone is often insufficient. The full log contains stack traces and context.

## NEXT STEP

**Gating:** All failures have structured bug reports. Triage summary is complete with routing decisions.
**Next:** Load `workflows/steps/test-swarm/step-06-triage.md`
**If gating fails:** Report which failures could not be processed and why. Do not continue workflow.
