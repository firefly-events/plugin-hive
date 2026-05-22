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

### 6a. Multica story close (adapter gate)

After a successful push, close the story's Multica issue — best-effort, never blocks integration.

**Skip this step entirely if:**
- Running in dry-run mode (`--dry-run` present in `$ARGUMENTS`)
- /execute was invoked in `--simulated-manual` mode (cycle state `simulated_manual: true`)

**Gate check:** Read `task_tracking.adapter` from the root `hive.config.yaml`. If the value is not `'multica'`, emit one log line and skip:
```
[gate_mode] task_tracking.adapter={value} — Multica close skipped
```

**When `task_tracking.adapter === 'multica'`:**

```javascript
import { closeStoryIssue } from 'hive/lib/multica-issue-closer.mjs';

const result = await closeStoryIssue({ epic_id, story_id });
```

Emit one log line based on the result. Use `story.tracker_id` as the issue identifier when available; otherwise use the `story_id`:

| Result | Log line |
|---|---|
| `ok: true, was_changed: true` | `[multica-closer] closed {identifier} (story_id={story_id})` |
| `ok: true, was_changed: false` | `[multica-closer] {identifier} already {result.reason} (story_id={story_id})` |
| `ok: false` | `[multica-closer] WARN {result.reason} for story_id={story_id} — Multica board may be stale` |

On `ok: false`: emit the warn line and continue. Do **not** halt the integrate step.

### 6b. Verify CI (if available)
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
