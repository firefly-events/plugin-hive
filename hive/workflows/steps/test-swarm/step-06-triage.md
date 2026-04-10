# Step 6: Failure Triage and Routing

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Do NOT route a failure without categorizing it first — every failure gets a category
- Do NOT retry transient failures without evidence they are actually transient (flaky history, timeout, network)
- Do NOT send story-level issues back to planning without clearly describing what needs to change
- Do NOT escalate to human without exhausting automated resolution options first
- Map every failure to one of the three defined categories — no uncategorized failures allowed

## EXECUTION PROTOCOLS

**Mode:** autonomous

Review all bug reports from step 5. Categorize each failure into one of three categories: transient (retry), story issue (back to planning), or human blocker (escalate). Produce routing decisions that downstream steps and the orchestrator can act on.

## CONTEXT BOUNDARIES

**Inputs available:**
- Bug reports and triage summary from step 5
- Context report from step 1 (for story context)
- Execution results from step 3 (for failure patterns)
- Project error-handling categories from `references/error-handling.md` (if it exists)

**NOT available (do not read or assume):**
- User preferences on retry policies (use defaults)
- Historical failure data from previous sessions (use only current session data)
- Fix implementations (this step routes, it does not fix)

## YOUR TASK

Categorize every test failure into an actionable routing category and produce decisions that the orchestrator uses to determine next actions: retry, send back to planning, or escalate.

## TASK SEQUENCE

### 1. Load bug reports

Read the bug reports and triage summary from step 5. For each bug, extract:
- bug_id, severity, test_id, requirement_ref
- AI hypothesis (this informs categorization)
- Error type from logs

### 2. Categorize each failure

Apply these categories in order of priority:

**Category 1: Transient (retry)**
Indicators:
- Timeout errors (network, device connection, simulator startup)
- Flaky test patterns (element not found due to timing, animation delays)
- Environment issues (port already in use, stale cache, simulator state)
- Error message contains: timeout, ECONNREFUSED, ECONNRESET, "not attached", "stale element"

Action: Schedule for automatic retry (up to 2 retries). If still failing after retries, reclassify.

**Category 2: Story issue (back to planning)**
Indicators:
- Acceptance criterion is ambiguous or contradictory
- Implementation does not match the acceptance criterion (genuine functional bug)
- Missing feature — the code path does not exist
- Test correctly identifies a gap between spec and implementation

Action: Route back to development/planning swarm with:
- Which acceptance criterion is affected
- What the test expected vs what the code does
- Specific file/function that needs change

**Category 3: Human blocker (escalate)**
Indicators:
- Architectural flaw (not fixable within story scope)
- Missing external dependency (third-party API, hardware, credentials)
- Environment issue that requires human setup (device provisioning, certificates)
- Security vulnerability discovered
- AI hypothesis indicates deep systemic issue beyond story scope

Action: Escalate to human via task tracker with full context. Do not attempt automated resolution.

### 3. Map to error-handling categories

If `references/error-handling.md` exists, cross-reference your categorization with the project's defined error categories. Ensure consistency with the project's error handling taxonomy.

### 4. Produce routing decisions

```yaml
routing_decisions:
  story_id: "{story-id}"
  decided_at: "{timestamp}"
  total_bugs: {count}
  decisions:
    - bug_id: "bug-001"
      category: transient
      action: retry
      max_retries: 2
      reason: "Timeout error on simulator connection — likely transient"

    - bug_id: "bug-002"
      category: story_issue
      action: back_to_planning
      affected_criterion: "AC-2"
      reason: "Login handler does not validate empty email — implementation gap"
      fix_target: "src/auth/login.ts:42 — add email validation check"

    - bug_id: "bug-003"
      category: human_blocker
      action: escalate
      reason: "Third-party OAuth provider returns 503 — requires API key rotation by ops team"
      escalation_target: "task tracker"

  summary:
    transient_retry: {count}
    story_issues: {count}
    human_blockers: {count}
    auto_resolvable: {transient_retry + story_issues count}
    needs_human: {human_blockers count}
```

## SUCCESS METRICS

- [ ] Every bug from step 5 has a category assignment (transient, story_issue, human_blocker)
- [ ] Transient failures have retry limits set (max 2)
- [ ] Story issues include specific criterion and fix target
- [ ] Human blockers include escalation context sufficient for a human to act
- [ ] No uncategorized failures remain
- [ ] Routing decisions document produced with summary counts

## FAILURE MODES

- **Classifying everything as transient:** Retrying genuine bugs wastes cycles and delays real fixes. Only timeout/flaky patterns qualify.
- **Escalating fixable bugs to human:** If the AI hypothesis identifies a clear code fix, it is a story issue, not a human blocker. Escalation is for problems agents cannot solve.
- **Vague routing back to planning:** "Bug in login" is not actionable. Include the specific criterion, file, and expected change.
- **Not mapping to error-handling categories:** If the project has defined error categories, ignoring them creates inconsistency in how failures are tracked.
- **Missing retry limits:** Infinite retry loops waste execution time. Always cap at 2 retries.

## NEXT STEP

**Gating:** All bugs categorized and routing decisions produced. No uncategorized failures.
**Next:** Load `workflows/steps/test-swarm/step-07-report.md`
**If gating fails:** Report which bugs could not be categorized and why. Do not continue workflow.
