# Test Swarm Architecture

A generalized testing swarm ported from MTS (Mobile Test Swarm). Supports mobile (Maestro), web (Playwright), API (pytest/Jest), and backend testing. The pipeline is framework-agnostic — framework-specific behavior lives in agent personas and configuration.

## 8-Task Pipeline

```
1. gather-context    (scout)      — read story/PR/commits, build structured context
2. verify-baseline   (scout)      — check/create baseline knowledge for the project
3. author-tests      (architect)  — write test scripts in detected framework  ─┐ parallel
4. validate-coverage (inspector)  — verify tests cover story requirements     ─┘
5. execute-platform-a (worker)    — run tests on platform A                   ─┐ parallel
6. execute-platform-b (worker)    — run tests on platform B                   ─┘
7. file-bugs         (sentinel)   — triage failures, classify severity, route
8. compile-report    (team-lead)  — session report with results and recommendations
```

**Parallel pairs:** Tasks 3+4 dispatch together after baseline is verified. Tasks 5+6 dispatch together after tests are authored. This minimizes wall-clock time.

## Agent Roles

| Role | Persona | Responsibility |
|------|---------|---------------|
| **Scout** | `test-scout.md` | Context gathering, baseline management, discovery passes |
| **Architect** | `test-architect.md` | Test authoring, script generation, requirement tracing |
| **Worker** | `test-worker.md` | Test execution on target platforms, result collection |
| **Inspector** | `test-inspector.md` | Coverage validation against requirements |
| **Sentinel** | `test-sentinel.md` | Bug triage, severity classification, auto-routing |
| **Coordinator** | `team-lead.md` | Orchestration, report compilation (uses existing team-lead) |

## Framework Detection

The architect detects the project's test framework by checking for config files and dependencies:

| Indicator | Framework | Platform |
|-----------|-----------|----------|
| `.maestro/` dir or `maestro` in deps | Maestro | Mobile (iOS/Android) |
| `playwright.config.{ts,js}` | Playwright | Web |
| `cypress.config.{ts,js}` | Cypress | Web |
| `pytest.ini` or `conftest.py` | pytest | Backend (Python) |
| `jest.config.{ts,js}` or `vitest.config.{ts,js}` | Jest/Vitest | Backend (JS/TS) |
| `XCTestCase` in `*.swift` | XCTest | iOS native |
| `@Test` in `*.kt` with JUnit | JUnit/Kotest | Android/JVM |

If multiple frameworks detected, the architect authors tests in each. If none detected, the architect recommends appropriate frameworks based on the tech stack.

## Cross-Swarm Handoff

The test swarm receives context from the dev swarm via the handoff protocol (`references/cross-swarm-handoff.md`):

- **Story specs** — what was supposed to be built
- **Implementation artifacts** — what was actually built (file paths, commit refs)
- **Cycle state** — technology decisions, naming conventions, constraints

The test swarm does NOT re-read the full codebase from scratch. It uses the handoff context + its own baseline knowledge.

## Configuration

```yaml
# In hive.config.yaml or test-swarm-specific config
test_swarm:
  frameworks: auto              # auto-detect, or explicit: [maestro, playwright]
  platforms:                    # target platforms for execution
    - name: ios
      type: simulator           # simulator or physical
      device: "iPhone 15 Pro"
    - name: android
      type: physical
      serial: "DEVICE_SERIAL"
  artifacts_dir: state/test-artifacts/{epic-id}/{story-id}/
  baseline_path: state/test-baseline/{project}/baseline-knowledge.md
  bug_routing:
    auto_route_threshold: low   # auto-route bugs at or below this severity
    escalation_target: human    # where to escalate high-severity bugs
```

## Context Gathering

The scout reads from highest-priority source available:

1. **Story file** — richest structured context (acceptance criteria, requirements)
2. **PR reference** — specific change context (diff, description, linked issues)
3. **Latest commits** — auto-context from recent changes when no story/PR specified

### Gathering Protocol

1. Identify context source (story, PR, commits, or ad-hoc)
2. Read and parse the primary source
3. Cross-reference: story vs code vs commits vs wireframes (if available)
4. Enrich with baseline knowledge (existing project understanding)
5. Output structured context document

### Baseline Knowledge

A living document that captures project-level test context. Created on first discovery pass, updated incrementally.

**Contents:**
- Project structure (key directories, modules, entry points)
- Navigation/routing structure
- Technology stack and dependencies
- Existing test infrastructure (frameworks, configs, test directories)
- Known test patterns and conventions
- Platform-specific considerations

**Storage:** `state/test-baseline/{project}/baseline-knowledge.md`

**Discovery pass:** When no baseline exists, the scout runs a full discovery — inspecting the codebase for structure, patterns, and conventions. This creates the initial baseline.

## Test Authoring

The architect translates requirements into test scripts:

1. Load context document from scout
2. Load baseline knowledge for project conventions
3. Detect test framework (or use configured framework)
4. For each acceptance criterion:
   - Author happy path test
   - Identify edge cases and error states
   - Author edge case tests
5. Map each test to its source requirement (traceability)
6. Flag regression candidates (tests that validate core behavior)
7. Output: test files + test manifest (structured list of tests with metadata)

### Test Manifest

```yaml
tests:
  - id: test-001
    name: "Login with valid credentials"
    requirement_ref: "AC-1"
    type: happy_path           # happy_path, edge_case, error_state
    platforms: [ios, android]
    regression_candidate: true
    script_path: state/test-artifacts/.../test-001.yaml
```

## Test Execution

Workers execute tests on target platforms in parallel:

1. Detect connected devices/browsers
2. Report availability (what's ready, what's missing)
3. Load test scripts from architect output
4. Execute each test, capturing: pass/fail, timing, screenshots on failure, logs
5. Compile structured results per platform

**Platform dispatch:** One worker per platform. iOS and Android workers run simultaneously. Web workers can run multiple browsers in parallel.

## Coverage Validation

The inspector validates test coverage against requirements:

1. Extract all testable requirements from story/context
2. Inventory the architect's authored tests
3. Map each requirement to its covering test(s)
4. Identify gaps: requirements without tests, missing edge cases
5. Calculate coverage: (covered requirements / total) × 100
6. Classify gap severity: critical (core flow), moderate (edge case), low (cosmetic)
7. Report gaps to architect for iteration (if in parallel dispatch)

## Bug Triage

The sentinel processes test failures:

1. Load failure results from workers
2. For each failure:
   - Gather context: expected vs actual, screenshots, repro steps
   - Analyze code to generate AI hypothesis on root cause
   - Classify severity: low / medium / high
3. Check memory for learned patterns (adaptive routing)
4. Route based on severity:
   - **Low:** auto-route to dev queue (task tracker)
   - **Medium:** escalate unless memory shows user always auto-approves this type
   - **High:** always escalate to human
5. Record triage decisions in memory for future learning

### Adaptive Learning

The sentinel learns from user feedback:
- After 5+ consistent auto-approvals of a bug type → lower its escalation threshold
- After user overrides a classification → adjust future scoring
- Trust scores decay if not recently validated (same as quality gate trust)

## Session Report

Final output of a test swarm run:

```markdown
# Test Session Report: {story-id}

**Date:** {timestamp}
**Frameworks:** {detected frameworks}
**Platforms:** {platforms tested}

## Summary
- Tests authored: {N}
- Tests passed: {N}
- Tests failed: {N}
- Coverage: {N}% of requirements

## Results by Platform

### iOS
| Test | Status | Duration |
|------|--------|----------|
| test-001 | PASS | 2.3s |
| test-002 | FAIL | 1.8s |

### Android
...

## Coverage Analysis
- {N}/{M} requirements covered
- Gaps: {list critical gaps}

## Bugs Filed
| # | Severity | Description | Routing |
|---|----------|-------------|---------|
| 1 | High | Crash on payment submit | Escalated to human |
| 2 | Low | Padding mismatch on profile | Auto-routed to dev |

## Recommendations
- {Actionable next steps}
```

## Entry Point

The test swarm is triggered via:
- Cross-swarm handoff from dev swarm (automated pipeline)
- Manual: `/hive:test {story-id}` (future command)
- Daily ceremony: orchestrator decides to run test swarm after dev execution
