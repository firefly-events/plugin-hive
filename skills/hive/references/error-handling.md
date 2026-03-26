# Error Handling & Recovery Playbook

Every failure in the Hive workflow falls into one of three categories. The response differs based on category.

## Three Failure Categories

| Category | Response | Example |
|----------|----------|---------|
| **Transient** | Retry automatically | Agent timeout, file write failed, Linear API blip |
| **Story issue** | Send back to planning | Bad story spec, unimplementable criteria, wrong architecture, fundamental test failure |
| **Human blocker** | Escalate to human | Missing credentials, environment access, business decision needed |

The key rule: **if it's not a human blocker, it goes back to planning — not into an infinite fix loop.**

---

## Per-Phase Error Handling

### Standup Phase

| Failure | Category | Response |
|---------|----------|----------|
| Status markers unreadable | Transient | Retry read. If persists, report what IS readable and flag gaps. |
| Cycle state corrupted | Transient | Start fresh cycle state. Note loss of prior decisions. |
| Linear API unavailable | Transient | Fall back to local-only mode for this session. Note in standup report. |
| No prior state exists (first run) | Not a failure | Proceed with empty standup — user provides direction in planning. |

### Planning Phase

| Failure | Category | Response |
|---------|----------|----------|
| Planning swarm produces incomplete stories | Story issue | Re-run planning with more specific direction from user. |
| Agent-ready checklist fails on stories | Story issue | Flag failures. User can approve with known gaps or ask to re-plan. |
| Stories have conflicting requirements | Story issue | Surface conflicts to user. Do not proceed until resolved. |
| Analyst/architect agent crashes | Transient | Retry with fresh agent instance. If repeated, escalate. |

### Execution Phase

| Failure | Category | Response |
|---------|----------|----------|
| **Story is unimplementable** (wrong assumptions, impossible acceptance criteria, architectural conflict) | **Story issue → BACK TO PLANNING** | Mark story as `needs-replanning`. Write status marker with `status: replanning` and context about what's wrong. Route back to planning phase with the failure context so the planning swarm can revise. |
| Agent timeout during step | Transient | Retry step with fresh agent. Max 2 retries, then mark step failed. |
| Agent produces invalid output | Transient | Retry with explicit format instructions. If repeated, mark failed. |
| Research brief is inadequate | Story issue | If developer can't proceed, mark story `needs-replanning` with feedback about what research missed. |
| File system error (can't write, permissions) | Transient | Retry. If persists, report to user — likely environment issue. |
| Git operations fail (branch, commit) | Transient | Retry. If lock file, investigate. If auth, escalate as human blocker. |
| Linear ticket claim fails (already locked) | Transient | Skip this story, work on next available. Report in standup. |

### Commit Phase

| Failure | Category | Response |
|---------|----------|----------|
| Nothing to commit | Not a failure | Skip to next phase (execution produced no changes). |
| Pre-commit hook fails | Transient | Fix the issue (lint, format), retry commit. Max 2 retries. |
| Git commit fails | Transient | Investigate cause, retry. If disk space or permissions, escalate. |

### Test Handoff / Testing Phase

| Failure | Category | Response |
|---------|----------|----------|
| Test framework not detected | Story issue | Back to planning — story needs test infrastructure specified. |
| Tests reveal fundamental design flaw (not just a bug) | **Story issue → BACK TO PLANNING** | The implementation approach is wrong, not just buggy. Mark story `needs-replanning` with test evidence. Planning swarm revises the approach. |
| All tests pass but coverage gaps found | Story issue | Route to planning for scope clarification (are the gaps acceptable?). |
| Device/environment unavailable for test execution | Transient | Skip that platform, report partial results. Don't block the pipeline. |
| Test swarm agent crashes | Transient | Retry the failed step. If repeated, produce partial report. |

### Fix Loop

| Failure | Category | Response |
|---------|----------|----------|
| Bug is a simple code fix | Transient | Fix, commit, re-test. Normal flow. |
| Bug reveals the story spec is wrong | **Story issue → BACK TO PLANNING** | The fix requires changing acceptance criteria or approach. Mark `needs-replanning`. |
| Bug requires architectural change | **Story issue → BACK TO PLANNING** | Can't fix within current story scope. Re-plan with architectural context. |
| Fix introduces new test failures | Transient | Revert fix, try different approach. Max 2 attempts before escalating. |
| Terminal issue (missing deps, env access, etc.) | **Human blocker → ESCALATE** | Push to task tracker, notify user, mark BLOCKED. |
| Fix loop exceeds 3 iterations without convergence | Story issue | Stop iterating. Mark `needs-replanning` — the story's approach is likely flawed. |

### Final Review

| Failure | Category | Response |
|---------|----------|----------|
| Review returns `needs_revision` with fixable issues | Transient | Route to fix loop. Normal flow. |
| Review returns `needs_revision` with fundamental concerns | **Story issue → BACK TO PLANNING** | Reviewer says the approach is wrong, not just the implementation. Mark `needs-replanning`. |
| Reviewer agent crashes | Transient | Retry with fresh instance. |

### Push Phase

| Failure | Category | Response |
|---------|----------|----------|
| Merge conflict | Transient | Attempt auto-rebase. If complex, escalate to human. |
| Push rejected (force push needed) | Human blocker | Never force push. Escalate to user. |
| CI fails after push | Transient | Investigate failure, fix, push again. If flaky, note it. |
| GitHub/remote unavailable | Transient | Retry. If persists, note in session end — push deferred to next session. |

### Session End

| Failure | Category | Response |
|---------|----------|----------|
| Insight evaluation fails | Transient | Skip evaluation, keep insights staged for next session. |
| Cycle state write fails | Transient | Retry. If fails, warn — next session will have incomplete state. |

---

## The "Back to Planning" Protocol

When a story is routed back to planning:

1. **Mark status:** Write status marker with `status: replanning`
2. **Capture context:** Write a `replanning-context.yaml` alongside the story:
   ```yaml
   story_id: event-detail
   returned_from: execution  # or testing, fix-loop, review
   reason: |
     The acceptance criteria assume a REST API for events, but the
     codebase uses GraphQL. The story needs to be re-planned with
     the correct API protocol.
   evidence:
     - "researcher found GraphQL schema at src/graphql/schema.ts"
     - "developer couldn't implement REST endpoint — no Express routes exist"
   original_steps_completed:
     - research (completed)
     - implement (failed — wrong API assumption)
   ```
3. **Cycle state:** Mark story as `replanning` in cycle state
4. **External tracker:** If configured, move ticket back to Todo with comment explaining why
5. **Next planning phase:** The planning swarm receives the replanning context and revises the story. It doesn't start from scratch — it builds on what was learned.

### What triggers back-to-planning (NOT the fix loop):

- Story assumptions are wrong (architecture, tech stack, API protocol)
- Acceptance criteria are unimplementable or contradictory
- Research reveals the story scope needs to change
- Tests reveal the design approach is fundamentally flawed
- Reviewer says the approach is wrong (not just the implementation)
- Fix loop exceeds 3 iterations without convergence

### What stays in the fix loop (NOT back to planning):

- Simple code bugs (null check, off-by-one, missing import)
- Lint/format failures
- Test failures with clear code-level fixes
- Review findings about code quality (not approach)

---

## Retry Policy

| Failure Type | Max Retries | Backoff | Then |
|-------------|-------------|---------|------|
| Agent timeout | 2 | None — fresh instance | Mark step failed |
| Agent bad output | 2 | Include format example | Mark step failed |
| File system error | 3 | 1s between | Escalate to user |
| Git operation | 2 | None | Investigate cause |
| Linear API | 3 | 2s between | Fall back to local mode |
| Fix loop iteration | 3 | None | Back to planning |
| Gate retry (review/test) | Per workflow config (default 2) | Feedback injection | Escalate |

---

## Convergence Detection

If any of these happen, stop retrying and change strategy:

- **Same error 3 times** — the fix isn't working. Back to planning or escalate.
- **Fix introduces new failures** — revert and try a different approach. If that also fails, back to planning.
- **Agent output quality degrades** — context window exhaustion. Spawn fresh instance.
- **Gate score not improving across retries** — the feedback isn't helping. Escalate to peer review or human.

---

## Status Marker Extensions

Add these status values for error handling:

| Status | Meaning |
|--------|---------|
| `completed` | Step finished successfully |
| `failed` | Step failed after retries exhausted |
| `escalated` | Needs human intervention |
| `blocked` | Waiting for external dependency or human action |
| `replanning` | Story sent back to planning — approach needs revision |

The `replanning` status is distinct from `failed` — the story isn't dead, it's being revised.
