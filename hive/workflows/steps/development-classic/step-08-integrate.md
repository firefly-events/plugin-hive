# Step 8: Integrate

## MANDATORY EXECUTION RULES (READ FIRST)

- Only run after review verdict is "passed" or "needs_optimization" (and optimization is done)
- NEVER integrate after "needs_revision" — that goes to fix loop
- Commit PER STORY immediately after review passes — do NOT batch commits at epic end
- Each story commits on its OWN feature branch: `hive-{story-id}`
- Commit message MUST include story ID: `[{story-id}] {description}`
- Do NOT force-push or amend commits without user approval
- Verify all tests pass one final time before committing

## EXECUTION PROTOCOLS

**Mode:** autonomous

Final verification, commit, push. Report commit hash.

## CONTEXT BOUNDARIES

**Inputs available:**
- Implementation (from step 3 or step 7 if optimized)
- Review verdict (must be "passed" or "needs_optimization" post-fix)
- Story spec (for commit message context)

**NOT available:**
- New requirements or changes (scope is locked)

## YOUR TASK

Commit the implementation to the feature branch and verify CI.

## TASK SEQUENCE

### 1. Final test run
```bash
{project_test_command}
```
If tests fail: STOP. Do not commit broken code. Report regression.

### 2. Ensure feature branch exists
Each story gets its own branch. If not already on one:
```bash
git checkout -b hive-{story-id}
```
If parallel stories are running, each teammate should already be on its own branch.

### 3. Stage changed files
Stage ONLY the files that were modified during THIS story's implementation.
Do NOT use `git add -A` — stage specific files to avoid committing other stories' changes.

If shared files (e.g., ViewModel, data models) were also modified by another story:
- Check `git diff` to confirm your changes are the ones staged
- If conflict: rebase onto the other story's commit first

### 4. Write commit message
Include the story ID so changes are traceable. Follow the repository's convention:
```
[{story-id}] feat(scope): {description}
```

### 5. Commit
```bash
git commit -m "[{story-id}] {commit message}"
```

### 6. Push to feature branch
```bash
git push -u origin hive-{story-id}
```

### 6. Verify CI (if available)
If the project has CI: check that the push triggers a build and it passes.
If no CI: note "no CI configured" in the report.

### 7. Produce integration report
```markdown
## Integration Complete
- Commit: {hash}
- Branch: {branch-name}
- Files committed: {count}
  - path/to/file1.ts
  - path/to/file2.ts
- CI: {passing | pending | no CI}
- Story: {story-id} — {title}
```

## SUCCESS METRICS

- [ ] Tests pass before commit
- [ ] Only story-related files committed (no stray files)
- [ ] Commit message follows repository convention
- [ ] Pushed to feature branch
- [ ] Integration report produced with commit hash

## FAILURE MODES

- **Committing with failing tests:** Never. Final test run is mandatory.
- **git add -A:** May commit unrelated or sensitive files. Stage explicitly.
- **Force push:** Can destroy upstream work. Never without user approval.
- **No commit message convention:** Check git log for recent patterns.

## NEXT STEP

This is the final step. Story execution is complete.
Produce episode record and report to orchestrator.
