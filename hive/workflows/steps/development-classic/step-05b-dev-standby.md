# Step 5b: Developer Standby (During Test Swarm)

## MANDATORY EXECUTION RULES (READ FIRST)

- Do NOT shut down after review passes — stay idle and available
- You will receive bug reports via SendMessage from the test sentinel
- Fix bugs with your EXISTING implementation context — you have full memory of what you built and why
- After fixing: re-run the specific failing tests, then report back to sentinel
- Circuit breaker: max 3 fix attempts per bug. If 3 fixes don't resolve it, escalate to orchestrator.
- Only shut down when: all tests pass, OR circuit breaker trips, OR orchestrator sends shutdown

## EXECUTION PROTOCOLS

**Mode:** standby (idle, waiting for messages)

After review passes, enter standby mode. You are NOT executing tasks — you are waiting for bug reports. When a bug report arrives via SendMessage, switch to fix mode: diagnose, fix, test, report. Return to standby after each fix.

## CONTEXT BOUNDARIES

**Inputs available:**
- Your full implementation context (you just wrote this code)
- Story spec and research brief (already loaded)
- Bug reports from test sentinel (arrive via SendMessage)

**NOT available:**
- Test scripts (those are the test swarm's domain)
- Other stories' implementations
- Permission to modify test files

## YOUR TASK

Stay available during the test swarm. Fix bugs as they're reported. Maintain code quality through the fix loop.

## TASK SEQUENCE

### 1. Enter standby
After review passes, announce:
```
Developer on standby for story {story-id}. Test swarm is running.
Waiting for bug reports via SendMessage.
```

### 2. On receiving a bug report
The sentinel sends structured reports:
```
BUG REPORT:
  test_id: {id}
  file: {path}:{line}
  expected: {what should happen}
  actual: {what happened}
  screenshot: .pHive/test-artifacts/{epic-id}/{story-id}/screenshots/{filename}
  hypothesis: {sentinel's AI guess at root cause}
```

### 3. Diagnose
- Read the file at the reported location
- Check the sentinel's hypothesis — is it correct?
- Identify the root cause using YOUR implementation knowledge

### 4. Fix
- Apply the minimum fix
- Run the project test suite to verify:
  ```bash
  {project_test_command}
  ```
- If tests pass: report fix to sentinel
- If tests still fail: iterate (up to 3 attempts per bug)

### 5. Report back
Send fix report to sentinel:
```
FIX APPLIED:
  bug: {test_id}
  file: {path}:{line}
  change: {what was changed}
  tests: {passing | still failing — detail}
  attempt: {1|2|3} of 3
```

### 6. Circuit breaker
If 3 fix attempts fail for the same bug:
```
ESCALATION:
  bug: {test_id}
  attempts: 3
  last_error: {detail}
  recommendation: {may need architectural change or replanning}
```
Route to orchestrator for decision (replan or accept).

### 7. Shutdown conditions
Only shut down when one of:
- Sentinel sends "all tests green" → proceed to integrate
- Circuit breaker trips on all remaining bugs → escalate to orchestrator
- Orchestrator sends shutdown request

## SUCCESS METRICS

- [ ] Stayed available during full test swarm execution
- [ ] Responded to each bug report within the same session (no cold start)
- [ ] Each fix attempt ran tests before reporting
- [ ] Circuit breaker enforced (no more than 3 attempts per bug)
- [ ] Fix reports sent back to sentinel with structured format

## FAILURE MODES

- **Shutting down after review:** Orchestrator has to fix bugs cold, without implementation context.
- **Fixing without testing:** Introducing new regressions. ALWAYS run tests after each fix.
- **Infinite fix loop:** More than 3 attempts on the same bug. Use the circuit breaker.
- **Modifying test files:** You fix implementation, not tests. If the test is wrong, flag it.
- **Fixing bugs in other stories:** Only fix bugs in YOUR story's code.

## NEXT STEP

**Gating:** All tests pass (reported by sentinel) OR circuit breaker escalated.
**Next:** If green → load `workflows/steps/development-classic/step-08-integrate.md`
**If circuit breaker:** Orchestrator decides: replan or accept with known issues.
