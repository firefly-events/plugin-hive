# Step 3: Test Execution

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- NEVER scatter test artifacts in the project root — ALL artifacts go to `.pHive/test-artifacts/{epic-id}/{story-id}/`
- Screenshots MUST go to `.pHive/test-artifacts/{epic-id}/{story-id}/screenshots/`
- Logs MUST go to `.pHive/test-artifacts/{epic-id}/{story-id}/logs/`
- Results MUST be written to `.pHive/test-artifacts/{epic-id}/{story-id}/results.yaml`
- Do NOT modify test files — execute them as authored by the architect
- Do NOT skip failing tests — capture the failure and continue
- Capture timing for every test (start time, end time, duration)

## EXECUTION PROTOCOLS

**Mode:** autonomous

Execute all tests from the manifest. Run platforms in parallel when possible. Capture all results, screenshots, and logs into the artifact directory structure. Produce structured results.

## CONTEXT BOUNDARIES

**Inputs available:**
- Test manifest from step 2 (test_manifest)
- Test files from step 2 (test_files)
- Project codebase (test infrastructure, configs)

**NOT available (do not read or assume):**
- Story spec (already consumed in steps 1-2)
- Context report (already consumed in step 2)
- Coverage analysis (not performed yet)

## YOUR TASK

Execute all authored tests on target platforms, capturing pass/fail status, timing, screenshots on failure, and logs. Store all artifacts in the correct directory structure.

## TASK SEQUENCE

### 1. Prepare artifact directories

```bash
mkdir -p .pHive/test-artifacts/{epic-id}/{story-id}/screenshots
mkdir -p .pHive/test-artifacts/{epic-id}/{story-id}/logs
```

Replace `{epic-id}` and `{story-id}` with actual values from the test manifest.

### 2. Read test manifest

Load the test manifest from step 2. Group tests by:
- Platform (iOS, Android, Web, Backend)
- Framework (Maestro, Playwright, pytest, Jest, etc.)

### 3. Execute tests per platform

Run tests using the appropriate framework command. Capture output to logs.

**Mobile (Maestro):**
```bash
maestro test {script_path} 2>&1 | tee .pHive/test-artifacts/{epic-id}/{story-id}/logs/maestro-{test_id}.log
```
On failure, Maestro auto-captures screenshots. Copy them:
```bash
cp ~/.maestro/tests/*/screenshots/* .pHive/test-artifacts/{epic-id}/{story-id}/screenshots/
```

**Web (Playwright):**
```bash
npx playwright test {script_path} --reporter=json 2>&1 | tee .pHive/test-artifacts/{epic-id}/{story-id}/logs/playwright-{test_id}.log
```
Screenshots on failure:
```bash
cp test-results/**/*.png .pHive/test-artifacts/{epic-id}/{story-id}/screenshots/ 2>/dev/null
```

**Backend (pytest):**
```bash
pytest {script_path} -v --tb=short 2>&1 | tee .pHive/test-artifacts/{epic-id}/{story-id}/logs/pytest-{test_id}.log
```

**Backend (Jest/Vitest):**
```bash
npx jest {script_path} --verbose 2>&1 | tee .pHive/test-artifacts/{epic-id}/{story-id}/logs/jest-{test_id}.log
```

### 4. Capture timing per test

For each test, record:
- `started_at`: timestamp before execution
- `finished_at`: timestamp after execution
- `duration_ms`: calculated difference

### 5. Compile results

Write structured results to `.pHive/test-artifacts/{epic-id}/{story-id}/results.yaml`:

```yaml
execution_results:
  story_id: "{story-id}"
  epic_id: "{epic-id}"
  executed_at: "{timestamp}"
  platform: "{platform name}"
  device: "{device or environment description}"
  results:
    - test_id: "test-001"
      requirement_ref: "AC-1"
      status: pass
      duration_ms: 2300
      started_at: "{timestamp}"
      finished_at: "{timestamp}"
    - test_id: "test-002"
      requirement_ref: "AC-1"
      status: fail
      duration_ms: 1800
      started_at: "{timestamp}"
      finished_at: "{timestamp}"
      error: "Element not found: #submit-button"
      screenshot: .pHive/test-artifacts/{epic-id}/{story-id}/screenshots/test-002-fail.png
      log: .pHive/test-artifacts/{epic-id}/{story-id}/logs/playwright-test-002.log
  summary:
    total: {count}
    passed: {count}
    failed: {count}
    skipped: {count}
    total_duration_ms: {sum}
  artifacts:
    screenshots_dir: .pHive/test-artifacts/{epic-id}/{story-id}/screenshots/
    logs_dir: .pHive/test-artifacts/{epic-id}/{story-id}/logs/
    results_file: .pHive/test-artifacts/{epic-id}/{story-id}/results.yaml
```

### 6. Verify artifact placement

Confirm all artifacts are in the correct location:
```bash
ls -la .pHive/test-artifacts/{epic-id}/{story-id}/
ls -la .pHive/test-artifacts/{epic-id}/{story-id}/screenshots/
ls -la .pHive/test-artifacts/{epic-id}/{story-id}/logs/
ls -la .pHive/test-artifacts/{epic-id}/{story-id}/results.yaml
```

If any artifacts ended up elsewhere (project root, `test-results/`, `~/.maestro/`), move them to the correct artifact directory.

## BEHAVIOR MATRIX

| Condition | Behavior |
|-----------|----------|
| Test type is unit/integration | Run platforms in parallel if possible |
| Test type is Maestro (mobile E2E) | **SERIALIZE iOS and Android.** Maestro uses port 7001 as a single driver — only one platform can run at a time. Run Android first, then iOS (or vice versa). |
| Test fails | Capture error, screenshot, log. Continue to next test. Do NOT stop. |
| Framework not installed | Report missing framework. Skip those tests with `status: skipped, reason: framework_not_found`. |
| Device not connected | Report missing device. Skip those tests with `status: skipped, reason: device_not_connected`. |

## SUCCESS METRICS

- [ ] All tests from manifest executed (none skipped without reason)
- [ ] Every test has pass/fail status and timing recorded
- [ ] All screenshots stored in `.pHive/test-artifacts/{epic-id}/{story-id}/screenshots/`
- [ ] All logs stored in `.pHive/test-artifacts/{epic-id}/{story-id}/logs/`
- [ ] `results.yaml` written with complete structured results
- [ ] No artifacts scattered in project root or framework default locations
- [ ] Summary counts match individual test results

## FAILURE MODES

- **Artifacts in project root:** Screenshots, logs, or results files outside `.pHive/test-artifacts/` directory. This breaks downstream references in bug reports and the final report. Always verify placement.
- **Skipping failing tests:** All tests must run. A failure is a result, not a reason to stop. Capture the error and continue.
- **Missing timing data:** Without duration_ms, performance regression detection is impossible.
- **Modifying test files:** Workers execute, they do not author. If a test fails due to a script error, report it — do not fix it.
- **Missing screenshots on failure:** Sentinel needs visual evidence for bug reports. Always capture and copy failure screenshots.

## NEXT STEP

**Gating:** `results.yaml` exists with all test results. All artifacts are in the correct directories.
**Next:** Load `workflows/steps/test-swarm/step-04-inspector.md`
**If gating fails:** Report which tests could not be executed and why. Do not continue workflow.
