# Step 1: Preflight

## MANDATORY EXECUTION RULES (READ FIRST)

- Do NOT proceed to any other step if preflight fails — mark story as blocked
- Do NOT skip build verification even if the story seems simple
- Run the ACTUAL build command — do not assume it passes from prior sessions
- If cross-platform: verify EACH platform independently

## EXECUTION PROTOCOLS

**Mode:** autonomous

Run all checks sequentially. Gate on any failure. Report results.

## CONTEXT BOUNDARIES

**Inputs available:**
- Story spec (for platform targets and build context)
- Project CLAUDE.md (for build commands)

**NOT available:**
- Implementation code (doesn't exist yet)
- Research brief (not produced yet)

## YOUR TASK

Verify the project builds cleanly before any code changes begin.

## TASK SEQUENCE

### 0. Check for existing progress
Check `state/episodes/{epic-id}/{story-id}/` for existing episode files.
If `preflight` episode exists with `status: completed`, skip to next step.

### 1. Identify build commands
Read the project's CLAUDE.md or equivalent config for:
- Build command (e.g., `./gradlew assembleDebug`, `npm run build`, `cargo build`)
- Test command (e.g., `./gradlew test`, `npm test`)
- Lint command (e.g., `./gradlew spotlessCheck`, `npm run lint`)

### 2. Run build
Execute the build command. Capture output.
- If build succeeds: record success, continue
- If build fails: STOP. Record the error. Mark story as **blocked**.

### 3. Verify critical config files
Check that files referenced in the story's `context.key_files` and `files_to_modify` exist.
Missing files = potential setup issue. Report but don't block unless they're creation targets.

### 4. Cross-platform check (if applicable)
If story spec indicates multiple platforms (e.g., iOS + Android for KMP):
- Build each platform independently
- Report per-platform status

### 5. Produce preflight report
```
PREFLIGHT REPORT:
  Build: {pass | FAIL — error message}
  Platforms: {per-platform status if cross-platform}
  Config files: {all present | missing: list}
  Status: {READY | BLOCKED — reason}
```

## SUCCESS METRICS

- [ ] Build command executed (not assumed)
- [ ] Build passes on all target platforms
- [ ] Critical config files verified
- [ ] Preflight report produced

## FAILURE MODES

- **Assuming build passes from prior session:** The codebase may have changed. Always run.
- **Continuing after build failure:** Wastes time implementing on a broken foundation.
- **Not checking cross-platform builds:** Story may pass on one platform but fail on another.

## NEXT STEP

**Gating:** Preflight status is READY. If BLOCKED, halt story execution.
**Next:** Load `workflows/steps/development-classic/step-02-research.md`
**If gating fails:** Mark story as blocked with preflight error. Do not continue.
