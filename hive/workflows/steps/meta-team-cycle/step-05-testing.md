# Step 5: Testing

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Test ONLY the changes made in step 4 — do not re-audit the entire codebase
- Read-only access in this step — do NOT modify any files
- A test failure does NOT stop the cycle — record it and continue
- Report results truthfully — a false pass is worse than an honest fail

## EXECUTION PROTOCOLS

**Mode:** autonomous

**Authority model:** this step is read-only. Test results are returned via the
`test_results` and `validation_report` workflow outputs; tester does NOT write
cycle-state, ledger, envelope, or metrics-carrier files from within this step.
Persistent control-plane writes are owned by downstream steps (evaluation,
promotion, close) coordinated via the workflow output graph and the B0 envelope
contract (`.pHive/epics/meta-improvement-system/docs/b0-consumer-contract.md`).
The team-grant for this role is read-only by design; see the swarm-specific
team configs `.pHive/teams/meta-optimize.yaml` and
`.pHive/teams/meta-meta-optimize.yaml` (introduced in A2.6).

Validate each change from step 4 using the prescribed check set. Produce the
structured `test_results` workflow output and companion `validation_report`.

## CONTEXT BOUNDARIES

**Inputs available:**
- `changes_made` from step 4 — list of files modified and actions taken
- Full codebase read access

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

**Team config files** (`.pHive/teams/**/*.yaml`):
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
This structured dictionary is the `test_results` workflow output for this step,
not an intermediate artifact.

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

### 5. Produce validation report
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
- [ ] `test_results` output produced for every change
- [ ] Validation report produced

## FAILURE MODES

- Schema doc not found: apply minimum check (title + 1 section), note in results
- File was blocked in step 4 (not created): mark as `skip` in test results
- Test result is ambiguous: default to `fail` with note `ambiguous` — false negatives are safer than false positives

## WHAT THIS STEP DOES NOT OWN

- Persistent cycle-state / ledger / envelope writes — Step 8 (close) is the single lifecycle writer per A2.1–A2.5; Steps 4–7 (including evaluation) are output-graph-only and do not perform inline persistent writes
- Metrics-carrier emission (C2 emitters, opt-in; Step 5 does not emit events)
- Quality-bar verdicts (Step 6 evaluation)
- Promotion or revert decisions (Step 7)
- Closure invariant checks (Step 8 close validator per B0 §1.11)
- Fixing failures discovered in testing (flagged for re-planning / downstream handling)

## NEXT STEP

**Gating:** Test results produced for every change from Step 4 and surfaced in the `test_results` output (pass or fail — not absent). No file-system writes from this step.
**Next:** Load `hive/workflows/steps/meta-team-cycle/step-06-evaluation.md`
**If gating fails:** Report which changes have no test results and why.
