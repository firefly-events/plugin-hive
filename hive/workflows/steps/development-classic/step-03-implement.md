# Step 3: Implement

## MANDATORY EXECUTION RULES (READ FIRST)

- Execute tasks in story order. NEVER reorder or skip.
- Run tests after EVERY file change. NEVER proceed with failing tests.
- NEVER claim tests are written or passing without actually running them.
- Track ALL modified files — record every changed file for the episode record.
- You are a SEPARATE agent from the researcher. Work from the research brief and story spec ONLY — do not rely on "remembered" context.
- Implement ONLY what the story specifies. No extra features, no unsolicited refactoring, no gold-plating.
- Follow existing patterns from the research brief. Do not introduce new patterns.

## EXECUTION PROTOCOLS

**Mode:** autonomous

Execute continuously until all acceptance criteria are satisfied or a blocker is hit. Do not pause between tasks.

## CONTEXT BOUNDARIES

**Inputs available:**
- Story spec (description, acceptance criteria, files_to_modify, code_examples, design_decisions)
- Research brief from step 2 (patterns, affected files, recommended approach)
- Cross-cutting concerns from the story's `cross_cutting` section (if present)

**NOT available:**
- Researcher's raw exploration (you only see the brief)
- Other stories in the epic
- Test code (that's step 4 in classic mode)

## YOUR TASK

Implement the story by translating each acceptance criterion into code, following the research brief's recommended approach.

## TASK SEQUENCE

### 0. Check for existing progress
Check `.pHive/episodes/{epic-id}/{story-id}/` for implement episode.
If completed, skip to next step.

### 1. Read story spec completely
Extract from the story YAML:
- Acceptance criteria (the contract — every one must be satisfied)
- files_to_modify (your scope — nothing else gets touched)
- code_examples (patterns to follow)
- design_decisions (settled questions — do not re-evaluate)
- cross_cutting (additional requirements from cross-cutting concerns)

### 2. Read research brief
From step 2 output, extract:
- Recommended approach (your implementation plan)
- Existing patterns to follow (cite specific files)
- Utilities to reuse (don't rebuild what exists)
- Risks to watch for

### 3. Implement each acceptance criterion
For each criterion, in order:

a. Write the minimum code to satisfy the criterion
b. Follow existing patterns from the research brief
c. Run the project's test/build command to verify nothing broke
d. If tests fail: FIX IMMEDIATELY before moving to the next criterion
e. Record the file(s) changed

**After EVERY file change:**
```bash
{project_test_command}  # e.g., ./gradlew test, npm test
```
If this fails, stop and fix before continuing.

### 4. Address cross-cutting concerns
For each concern in the story's `cross_cutting` section:
- Implement the specified action
- Verify against the concern's implementation checklist

### 5. Final verification
- Run full test suite one more time
- Verify every acceptance criterion is satisfied
- Verify no files outside `files_to_modify` were changed

### 6. Produce implementation summary

```markdown
## Changes Made
- `path/to/file.ts` — what was changed and why

## Acceptance Criteria Status
- [x] Criterion 1 — implemented in `file.ts:42`
- [x] Criterion 2 — implemented in `other.ts:18`

## Cross-Cutting Concerns Addressed
- {concern}: {what was done}

## Files Modified
- path/to/file1.ts
- path/to/file2.ts

## Decisions Made
- Decision and rationale (if any ambiguity was resolved)

## Notes for Reviewer
- Anything the reviewer should pay attention to
```

## SUCCESS METRICS

- [ ] Every acceptance criterion has corresponding code changes
- [ ] Tests pass after final verification
- [ ] Only files in `files_to_modify` were changed (no scope creep)
- [ ] Cross-cutting concerns addressed (if present)
- [ ] Implementation summary produced with file list
- [ ] No new patterns introduced without justification

## FAILURE MODES

- **Skipping tests:** Proceeding with failing tests means downstream steps inherit broken code. NEVER skip.
- **Reordering tasks:** Story order exists for a reason (often dependency order). Follow it.
- **Lying about tests:** Claiming "tests pass" without running them. The reviewer and tester will catch this, wasting everyone's time.
- **Scope creep:** Modifying files not in `files_to_modify`. Refactoring adjacent code. Adding error handling "just in case." Stick to the spec.
- **Ignoring research brief:** Introducing new patterns when existing ones were identified. The brief exists so you don't reinvent.
- **Ignoring cross-cutting concerns:** Missing caching, analytics, or test tags because they weren't in the acceptance criteria. Check the `cross_cutting` section.

## NEXT STEP

**Gating:** All acceptance criteria satisfied. Tests pass. Implementation summary produced.
**Next:** Load `workflows/steps/development-classic/step-04-platform-verify.md` (if cross-platform) or `step-05-test.md`
**If gating fails:** Report which criteria failed and why. Do not proceed.
