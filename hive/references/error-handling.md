# Error Handling & Recovery Playbook

Every failure in the Hive workflow falls into one of three categories. The response differs based on category.

## Three Failure Categories

| Category | Response | Example |
|----------|----------|---------|
| **Transient** | Retry automatically | Agent timeout, file write failed, Linear API blip |
| **Story issue** | Send back to planning | Bad story spec, unimplementable criteria, wrong architecture, fundamental test failure |
| **Human blocker** | Escalate to human | Missing credentials, environment access, business decision needed |

The key rule: **if it's not a human blocker, it goes back to planning — not into an infinite fix loop.**

## Agent Isolation Principle

Each workflow step MUST run as a **separate agent instance** with its own context. The developer must NOT share a context window with the researcher. Why:

- When the same context runs both research and implementation, the developer "remembers" research shortcuts and doesn't follow the spec faithfully
- A developer with research context may skip steps the spec requires because they saw the code during research
- Self-review is meaningless when the reviewer shares context with the producer

**Enforcement:**
- With agent teams/worktrees: each step is a separate teammate with its own context
- Without agent teams (single session): each step should be a **subagent spawn** with only its persona + step inputs, NOT the main session continuing to the next step
- The step's inputs (research brief, story spec, etc.) are the ONLY context the next agent receives — not the full conversation history

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

## Circuit Breakers

Three types of circuit breakers protect against wasted time and tokens. If ANY breaker trips, stop immediately and take the prescribed action.

### 1. Time-Based Breakers

| Scope | Time Limit | Action When Tripped |
|-------|-----------|---------------------|
| Single step | 10 minutes | Kill the agent. Mark step failed. Retry once with fresh instance. If second attempt also hits 10 min, mark story `needs-replanning`. |
| Fix loop (all iterations) | 20 minutes total | Stop the loop. Mark story `needs-replanning` with all attempted fixes as context. |
| Single story (all steps) | 45 minutes | Halt the story. Something is fundamentally wrong. Mark `needs-replanning` and move to next story. |
| Full ceremony (all stories) | 4 hours | Begin session-end phase regardless. Push whatever is complete. Defer remaining work to next session. |

**How to track:** Note the wall-clock time when starting each scope. Check elapsed time before starting each new step or iteration. The orchestrator is responsible for enforcing time limits.

### 2. Attempt-Based Breakers

| Scope | Max Attempts | Action When Tripped |
|-------|-------------|---------------------|
| Same step retry | 2 | Mark step failed |
| Fix loop iterations | 3 | Back to planning |
| Gate retry (review/test) | Per workflow config (default 2) | Escalate |
| Same error repeated | 3 | Stop retrying — the approach is wrong |

### 3. Progress-Based Breakers (Loop Detection)

These detect when an agent is spinning without making progress:

| Signal | Detection | Action |
|--------|-----------|--------|
| **Same error 3x** | Error message matches previous attempts | Stop. Back to planning or escalate. |
| **Fix introduces new failures** | Test count regression after a fix | Revert the fix. Try one different approach. If that also regresses, back to planning. |
| **Output quality degrading** | Response getting shorter, losing structure, forgetting instructions | Context window exhaustion. Spawn fresh instance with curated context. |
| **Gate score not improving** | Score within ±0.05 across retries | Feedback isn't helping. Escalate to peer review or human. |
| **Agent talking to itself** | Agent producing output but not modifying files or running commands | Stuck in reasoning loop. Kill and retry with more specific instructions. |
| **Circular file edits** | Same file edited 3+ times with reverts | Stop. The approach is wrong. Back to planning. |

### Orchestrator Enforcement

The orchestrator MUST check circuit breakers:
- **Before each step:** check elapsed time for story and ceremony
- **After each step:** check attempt counts and progress signals
- **After each fix loop iteration:** check fix loop time limit and iteration count

If a breaker trips mid-agent-team, send shutdown to the team and collect whatever partial output exists. Partial output is better than no output — it provides context for the replanning phase.

### Configurable Limits

In `hive.config.yaml`:
```yaml
circuit_breakers:
  step_timeout_minutes: 10
  fix_loop_timeout_minutes: 20
  story_timeout_minutes: 45
  ceremony_timeout_hours: 4
  max_step_retries: 2
  max_fix_iterations: 3
  max_same_error_repeats: 3
```

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
