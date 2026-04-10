# Step 6: Approve Plan

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Do NOT proceed to execution without explicit user approval — "yes", "approve", "go", or equivalent
- Do NOT hide validation failures — present them prominently so the user can make informed decisions
- Do NOT auto-fix failed stories — present options and let the user decide
- If the user rejects the plan, return to step 4 for re-selection

## EXECUTION PROTOCOLS

**Mode:** interactive

Present the validated plan to the user. Wait for explicit approval. Handle modifications and rejections.

## CONTEXT BOUNDARIES

**Inputs available:**
- Today's work list from step 4 (execution order)
- Validation report from step 5 (checklist results per story)
- Cross-cutting concern evaluations from step 5
- Story specs from `state/epics/{epic-id}/stories/{story-id}.yaml`

**NOT available:**
- Execution infrastructure (teams, agents — set up in step 7)
- External tracker ticket states (already captured during standup)

## YOUR TASK

Present the validated plan with checklist results to the user and obtain explicit approval before execution begins.

## TASK SEQUENCE

### 1. Format the approval presentation
Combine the work list and validation results into a single view:

```
## Today's Plan — Approval Required

### Execution Order
1. [{story-id}] {title} — Validation: PASS
2. [{story-id}] {title} — Validation: FAIL (2 checks)
3. [{story-id}] {title} — Validation: PASS

### Validation Failures (action required)
**[{story-id}] {title}:**
- Check 2 (Scope boundaries): No out-of-scope section
  Remediation: {specific fix}
- Check 7 (Ambiguous requirements): "{quoted ambiguity}"
  Remediation: {specific clarification needed}

### Cross-Cutting Concerns Applied
- [{concern-id}] {title} → applies to: {story-ids}

### Estimated Session Scope
- Stories: {count}
- Total complexity: {sum of complexity ratings}
- Parallel execution possible: {yes/no — based on independence}
```

### 2. Present decision options
After the plan summary, present clear options:

```
### Options
- **approve** — proceed to execution with all stories as listed
- **approve with fixes** — fix the validation failures inline, then execute
- **drop {story-id}** — remove a story from today's list
- **add {story-id}** — add another story (will re-validate)
- **reject** — return to work selection (step 4)
```

### 3. Handle user response

**If approved:** Mark all selected stories as ready for execution. Record the approval decision in the session context. Proceed to step 7.

**If approved with fixes:** For each failed story:
- Apply the remediation from the validation report
- Update the story spec file at `state/epics/{epic-id}/stories/{story-id}.yaml`
- Re-run the failed checks to confirm they now pass
- Then proceed to step 7

**If stories dropped:** Remove them from the work list. Re-check dependency order for remaining stories. Present updated plan for re-approval.

**If stories added:** Read the new story spec, run validation (step 5 checks) on it, present updated plan for re-approval.

**If rejected:** Return to step 4 for new work selection.

### 4. Record approved plan
Once approved, record the final plan for execution reference:
- Story IDs in execution order
- Which stories passed validation vs. had fixes applied
- Whether parallel execution is possible
- Any user notes or overrides

## SUCCESS METRICS

- [ ] Plan presented with validation results for every story
- [ ] Validation failures shown prominently with remediation options
- [ ] User provided explicit approval (not assumed)
- [ ] Any story modifications (fixes, drops, adds) applied and re-validated
- [ ] Final approved plan recorded for step 7 consumption

## FAILURE MODES

- Proceeding without explicit user approval — user loses control over what gets executed
- Hiding validation failures in fine print — user approves a plan with known issues
- Auto-fixing stories without user consent — changes may not match user's intent
- Not re-validating after modifications — fixes may introduce new issues

## NEXT STEP

**Gating:** User has explicitly approved the plan. All stories in the plan either passed validation or had fixes applied and confirmed.
**Next:** Load `workflows/steps/daily-ceremony/step-07-kick-off.md`
**If gating fails:** If user rejects, return to `workflows/steps/daily-ceremony/step-04-select-work.md`. If user wants to modify stories, apply changes and re-present for approval.
