# Step 4: Platform Verify

## MANDATORY EXECUTION RULES (READ FIRST)

- SKIP this step if the story is single-platform or backend-only
- Test EACH platform independently — do not assume one passing means all pass
- Report per-platform results even if all pass
- If any platform fails: STOP and report. Do not continue to review.

## EXECUTION PROTOCOLS

**Mode:** autonomous

Check if cross-platform, then verify each platform. Skip if not applicable.

## CONTEXT BOUNDARIES

**Inputs available:**
- Story spec (platform targets)
- Implementation from step 3

**NOT available:**
- Test artifacts (that's step 5)

## YOUR TASK

Verify the implementation builds and runs correctly on ALL target platforms.

## TASK SEQUENCE

### 1. Determine if this step applies
Check story spec for platform indicators:
- `context.tech_stack` mentions multiple platforms (e.g., iOS + Android, web + mobile)
- Story description mentions cross-platform behavior
- If single-platform or backend-only: produce "SKIPPED — single platform" report and proceed

### 2. Build each platform
For each target platform, run the platform-specific build:
- **Android:** `./gradlew assembleDebug` or equivalent
- **iOS:** `xcodebuild -scheme {scheme} -destination 'platform=iOS Simulator,name=iPhone 15 Pro'`
- **Web:** `npm run build` or equivalent

### 3. Run platform-specific tests (if they exist)
- **Android:** `./gradlew testDebugUnitTest`
- **iOS:** `xcodebuild test -scheme {scheme} ...`
- Platform-specific test files may not exist — that's OK, just note it

### 4. Produce platform report
```
PLATFORM VERIFICATION:
  Android: {pass | FAIL — error}
  iOS: {pass | FAIL — error}
  Tests: {ran N tests | no platform-specific tests}
  Status: {ALL PASS | BLOCKED — platform failures}
```

## SUCCESS METRICS

- [ ] Each target platform builds successfully
- [ ] Platform-specific tests pass (if they exist)
- [ ] Per-platform report produced

## FAILURE MODES

- **Skipping a platform:** "It works on Android, iOS is probably fine." Verify both.
- **Continuing after platform failure:** Broken platform = blocked story.

## NEXT STEP

**Gating:** All platforms pass (or step was skipped for single-platform).
**Next:** Load `workflows/steps/development-classic/step-05-test.md`
