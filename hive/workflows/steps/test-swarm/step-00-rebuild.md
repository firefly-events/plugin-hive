# Step 0: Rebuild and Deploy

## MANDATORY EXECUTION RULES (READ FIRST)

- ALWAYS rebuild before running ANY tests — never test against stale artifacts
- Verify build timestamp is AFTER the latest commit in the test target branch
- If the build is stale: rebuild. Do not proceed with old artifacts.
- If deploying to devices: verify the app is installed and launchable

## EXECUTION PROTOCOLS

**Mode:** autonomous

Rebuild, deploy, verify. Gate on failure.

## CONTEXT BOUNDARIES

**Inputs available:**
- Project build commands (from CLAUDE.md or project config)
- Target devices/platforms (from story spec or test config)
- Latest commit hash (from git log)

**NOT available:**
- Test scripts (that's the architect's job)
- Test results (tests haven't run yet)

## YOUR TASK

Build the latest code and deploy to test targets so the test swarm runs against fresh artifacts.

## TASK SEQUENCE

### 1. Check latest commit
```bash
git log --oneline -1
```
Record the commit hash and timestamp.

### 2. Build the project
Run the project's build command:
```bash
{project_build_command}
```
Examples: `./gradlew assembleDebug`, `npm run build`, `xcodebuild -scheme {scheme} build`

If cross-platform: build each target.

### 3. Verify build freshness
Compare the build artifact timestamp against the commit timestamp.
If the artifact is older than the latest commit: the build is stale. Rebuild.

### 4. Deploy to devices (if mobile)
For connected devices:
```bash
# Android
adb install -r {path-to-apk}

# iOS (via Maestro or xcodebuild)
xcrun simctl install booted {path-to-app}
```

Verify the app launches after install.

### 5. Produce build report
```
BUILD REPORT:
  Commit: {hash} ({timestamp})
  Build: {pass | FAIL}
  Platforms:
    Android: {built | FAIL} → {deployed | skipped}
    iOS: {built | FAIL} → {deployed | skipped}
  Status: {READY FOR TESTING | BLOCKED}
```

## SUCCESS METRICS

- [ ] Build command executed against latest commit
- [ ] Build artifact is fresh (timestamp after latest commit)
- [ ] Deployed to test targets (if mobile)
- [ ] App launches on device (if deployed)
- [ ] Build report produced

## FAILURE MODES

- **Testing against stale build:** The #1 reason this step exists. A prior project ran tests against a pre-enhancement APK twice before catching the issue.
- **Not verifying deploy:** Build succeeds but app doesn't install or launch.
- **Skipping this step:** If the test swarm starts without a fresh build, all results are unreliable.

## NEXT STEP

**Gating:** Build is fresh and deployed. Status is READY FOR TESTING.
**Next:** Load `workflows/steps/test-swarm/step-01-scout.md`
**If gating fails:** Report build failure. Do not start test swarm.
