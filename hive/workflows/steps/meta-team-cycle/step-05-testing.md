# Step 5: Testing

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Test ONLY the changes made in step 4 — do not re-audit the entire codebase
- Read-only access in this step — do NOT modify any files
- A test failure does NOT stop the cycle — record it and continue
- Report results truthfully — a false pass is worse than an honest fail

## EXECUTION PROTOCOLS

**Mode:** autonomous

Validate each change from step 4 using the prescribed check set. Produce a test results document.

## CONTEXT BOUNDARIES

**Inputs available:**
- `changes_made` from step 4 — list of files modified and actions taken
- Full codebase read access
- `state/meta-team/cycle-state.yaml`

**NOT available:**
- Write access to any files
- User input

## YOUR TASK

Verify that all changes from step 4 are structurally correct, don't break cross-references, and meet schema requirements.

## TASK SEQUENCE

### 1. Cross-reference integrity check
For each newly created file that is referenced from other files:
- Confirm the referencing file uses the exact path where the new file was created
- If a proposal created a file to resolve a dangling reference: re-read the referencing file and confirm the path now resolves

For each file that was edited:
- Check that any wikilinks or path references added point to existing files

Record: `PASS` or `FAIL` with specific path that doesn't resolve.

### 2. Schema compliance check
For each new or modified file, apply the appropriate schema:

**Step files** (`hive/workflows/steps/**/*.md`):
- Title present: `# Step N: Name`
- MANDATORY EXECUTION RULES section present
- EXECUTION PROTOCOLS section present
- CONTEXT BOUNDARIES section present
- TASK SEQUENCE present
- SUCCESS METRICS present (with at least one checkable item)
- FAILURE MODES present
- NEXT STEP present

**Agent memory files** (`skills/hive/agents/memories/**/*.md`):
- Frontmatter present with: `name`, `description`, `type`
- `type` is one of: `pattern`, `pitfall`, `override`, `codebase`, `reference`

**Team config files** (`state/teams/**/*.yaml`):
- Required fields present: `name`, `description`, `lead`, `members`, `team_memory_path`
- Each member has: `agent`, `role`

**Workflow YAML** (`hive/workflows/**/*.yaml`):
- Required fields: `name`, `version`, `steps`
- Each step has: `id`, `agent`, and either `task` or `step_file`

**Reference docs** (`hive/references/**/*.md`):
- Has a title (`# Title`)
- Has at least one substantive section (> 5 lines of content)

Record: `PASS` or `FAIL` per file with specific missing field if any.

### 3. Content safety check
For each modified existing file:
- Count original line count and new line count
- Count removed lines (lines present in original but absent in modified, via `git diff --stat` or line-by-line comparison)
- If removed lines > 50% of original line count: record as `CONTENT_LOSS` failure (even if new lines were added to replace them)
- If new line count < 50% of original: record as `CONTENT_LOSS` failure (catches pure deletions)

### 4. Compile test results
For each change from step 4:
```yaml
change_id: {proposal_id}_{file_slug}
file: {file path}
tests:
  cross_reference_integrity: pass | fail | skip
  schema_compliance: pass | fail | skip
  content_safety: pass | fail | skip
overall: pass | fail
failure_notes: {details if any test failed}
```

### 5. Update cycle-state.yaml
Append to `state/meta-team/cycle-state.yaml`:
```yaml
phase: testing
test_results:
  - {test result objects}
overall_pass_rate: {X}/{total}
```

### 6. Produce validation report
```
## Validation Report — Cycle {cycle_id}

Changes tested: {N}
  All tests pass: {N}
  Has failures: {N}

Results by change:
  [pass] {proposal_id} — {file}
  [fail] {proposal_id} — {file}: {failure type} — {details}
```

## SUCCESS METRICS

- [ ] Every change from step 4 has a test result entry
- [ ] Cross-reference integrity checked for all new files
- [ ] Schema compliance checked against appropriate schema
- [ ] Content safety checked for all modified existing files
- [ ] `cycle-state.yaml` updated with test results
- [ ] Validation report produced

## FAILURE MODES

- Schema doc not found: apply minimum check (title + 1 section), note in results
- File was blocked in step 4 (not created): mark as `skip` in test results
- Test result is ambiguous: default to `fail` with note `ambiguous` — false negatives are safer than false positives

## NEXT STEP

**Gating:** Test results produced for all changes (pass or fail — not absent).
**Next:** Load `hive/workflows/steps/meta-team-cycle/step-06-evaluation.md`
**If gating fails:** Report which changes have no test results and why.
