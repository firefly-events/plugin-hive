# Step 8: Baseline Promotion and Artifact Archival

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Do NOT promote failing test patterns to baseline — only passing patterns qualify
- Do NOT overwrite baseline knowledge without preserving previous content — update incrementally
- Do NOT delete test artifacts — archive them, they may be needed for debugging
- Do NOT promote patterns from tests that were skipped or had transient failures
- Only promote framework detections that were verified by actual test execution

## EXECUTION PROTOCOLS

**Mode:** autonomous

Review test session results. Promote passing test patterns and verified framework detections to baseline knowledge. Archive test artifacts for future reference.

## CONTEXT BOUNDARIES

**Inputs available:**
- Session report from step 7 (for pass/fail verdict)
- Execution results from step 3 (`state/test-artifacts/{epic-id}/{story-id}/results.yaml`)
- Test manifest from step 2 (for framework and pattern information)
- Current baseline at `state/test-baseline/{project}/baseline-knowledge.md`

**NOT available (do not read or assume):**
- Bug fix implementations (fixes happen after test swarm completes)
- Other stories' baselines
- User preferences on what to promote (use the rules below)

## YOUR TASK

Promote successful test patterns and verified framework detections to baseline knowledge. Archive test artifacts. Update the baseline incrementally so future test runs benefit from this session's learnings.

## TASK SEQUENCE

### 1. Determine promotion eligibility

Read the session report verdict and results.yaml. Identify:

**Eligible for promotion:**
- Test patterns from tests that passed on all platforms
- Framework detections confirmed by successful test execution
- New test conventions discovered (naming, directory structure, fixtures)
- Cross-cutting test patterns that worked (shared flows, test tags)

**NOT eligible for promotion:**
- Patterns from failing tests (they may be wrong)
- Patterns from skipped tests (unverified)
- Framework detections that were recommended but not yet used
- Patterns from transient-failure tests (unreliable signal)

### 2. Update baseline knowledge

Read the current baseline at `state/test-baseline/{project}/baseline-knowledge.md`.

Update incrementally (do not overwrite):

**a. Add new framework detections:**
```markdown
## Test Frameworks (updated {date})
- {framework}: confirmed working at {config_path}
  - Last verified: {date}
  - Tests executed: {count}
  - Pass rate: {percentage}%
```

**b. Add new test patterns:**
```markdown
## Test Patterns (updated {date})
- {Pattern name}: {description}
  - Source: {story-id}
  - Framework: {framework}
  - Example: {path to passing test file}
```

**c. Update test infrastructure notes:**
- New test directories created
- New fixtures or utilities added
- Configuration changes made

**d. Add regression candidates:**
From the test manifest, promote tests flagged as regression candidates that passed:
```markdown
## Regression Suite
- {test_id}: {description} — covers {requirement_ref}
  - Path: {script_path}
  - Added: {date} from {story-id}
```

### 3. Archive test artifacts

Move or tag current session artifacts for long-term reference:

```bash
# Ensure archive directory exists
mkdir -p state/test-artifacts/{epic-id}/{story-id}/archive/

# Copy results to archive with timestamp
cp state/test-artifacts/{epic-id}/{story-id}/results.yaml state/test-artifacts/{epic-id}/{story-id}/archive/results-{timestamp}.yaml
```

The primary artifact directory (`state/test-artifacts/{epic-id}/{story-id}/`) remains intact for immediate access. The archive preserves a timestamped snapshot.

### 4. Produce promotion summary

```yaml
promotion_summary:
  story_id: "{story-id}"
  promoted_at: "{timestamp}"
  baseline_path: "state/test-baseline/{project}/baseline-knowledge.md"
  promoted:
    frameworks:
      - name: "{framework}"
        config_path: "{path}"
        tests_passed: {count}
    patterns:
      - name: "{pattern description}"
        source_test: "{test_id}"
        source_story: "{story-id}"
    regression_candidates:
      - test_id: "{test_id}"
        description: "{description}"
        script_path: "{path}"
  skipped:
    - item: "{what was not promoted}"
      reason: "{why — failing, skipped, transient}"
  artifacts_archived:
    archive_path: "state/test-artifacts/{epic-id}/{story-id}/archive/"
    files_archived: {count}
```

## SUCCESS METRICS

- [ ] Only passing test patterns promoted to baseline (no failing or skipped patterns)
- [ ] Baseline knowledge updated incrementally (previous content preserved)
- [ ] New framework detections added with verification metadata
- [ ] Regression candidates promoted with test paths and descriptions
- [ ] Test artifacts archived with timestamp
- [ ] Promotion summary produced listing what was promoted and what was skipped

## FAILURE MODES

- **Promoting failing patterns:** Adding test patterns that failed corrupts the baseline. Only verified-passing patterns qualify.
- **Overwriting baseline:** Replacing instead of updating loses institutional knowledge from previous sessions.
- **Deleting artifacts:** Removing test artifacts makes debugging impossible if issues resurface later. Always archive.
- **Promoting unverified framework detections:** Scout detected a framework but no tests ran on it. Do not promote to baseline as "confirmed."
- **No promotion summary:** Without tracking what was promoted, there is no audit trail for baseline changes.

## NEXT STEP

**Gating:** Baseline updated. Artifacts archived. Promotion summary complete.
**Next:** Test swarm workflow complete. Return control to orchestrator.
**If gating fails:** Report what could not be promoted or archived and why. Workflow can still complete — promotion failure is non-blocking.
