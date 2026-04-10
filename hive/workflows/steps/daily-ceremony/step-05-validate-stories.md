# Step 5: Validate Stories

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Do NOT skip the agent-ready checklist — all 9 checks must run on every selected story
- Do NOT auto-pass stories that failed checks — flag them for user review in step 6
- Do NOT modify story files during validation — this step is read-only analysis
- Load the full checklist from `references/agent-ready-checklist.md` before evaluating

## EXECUTION PROTOCOLS

**Mode:** autonomous

Run validation checks on each selected story. Produce a validation report. No user interaction — results are presented in step 6.

**Agent:** analyst

This step is executed by the analyst agent persona. Load `agents/analyst.md` for the agent's quality standards and evaluation approach.

## CONTEXT BOUNDARIES

**Inputs available:**
- Today's work list from step 4 (story IDs and execution order)
- Story spec files at `state/epics/{epic-id}/stories/{story-id}.yaml`
- Agent-ready checklist at `references/agent-ready-checklist.md`
- Cross-cutting concerns from step 2 (loaded from `state/cross-cutting-concerns.yaml`)
- Cycle state from step 1 (decisions and constraints)

**NOT available:**
- User preferences on which checks to skip (all checks are mandatory)
- External tracker data (validation is spec-based, not ticket-based)

## YOUR TASK

Validate each selected story against the 9-point agent-ready checklist and evaluate cross-cutting concerns, producing a detailed validation report.

## TASK SEQUENCE

### 1. Load the agent-ready checklist
Read `references/agent-ready-checklist.md` to get the full 9-point checklist. The checks typically include:
1. Clear acceptance criteria (Given/When/Then)
2. Defined scope boundaries (in-scope / out-of-scope)
3. Identified dependencies (resolved or documented)
4. File paths specified (not vague references)
5. Technology decisions made (no open questions)
6. Test strategy defined
7. No ambiguous requirements
8. Complexity is appropriate (not too large for a single story)
9. Cross-cutting concerns evaluated

### 2. Validate each story
For each story in today's work list, read the full story spec from `state/epics/{epic-id}/stories/{story-id}.yaml` and evaluate all 9 checks:

For each check, record:
- **Pass/Fail** — does the story satisfy this check?
- **Evidence** — quote the specific section of the story spec that passes or fails
- **Remediation** — if failed, what needs to change?

### 3. Evaluate cross-cutting concerns per story
For each story, evaluate each cross-cutting concern from `state/cross-cutting-concerns.yaml`:
- Does the concern's `applies_when` condition match this story?
- If yes, does the story's spec already address the concern's required `action`?
- If the concern applies but is not addressed, flag it as a validation failure

### 4. Compile validation report
Produce a structured report:

```
## Validation Report

### Story: {story-id} — {title}
**Overall: {PASS | FAIL — N checks failed}**

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Acceptance criteria | PASS | "Given X, When Y, Then Z" defined |
| 2 | Scope boundaries | FAIL | No out-of-scope section |
| ... | ... | ... | ... |
| 9 | Cross-cutting concerns | PASS | Addresses: {concern-ids} |

**Cross-Cutting Concerns:**
- [{concern-id}] {title}: {applies | does not apply} — {status}

**Failed Checks Remediation:**
- Check 2: Add explicit out-of-scope section listing {items}

---
(repeat for each story)

### Summary
- {N} stories validated
- {M} passed all checks
- {K} failed one or more checks
- Stories requiring attention: {list of story IDs that failed}
```

## SUCCESS METRICS

- [ ] Agent-ready checklist loaded from `references/agent-ready-checklist.md`
- [ ] All 9 checks evaluated for every selected story
- [ ] Cross-cutting concerns evaluated per story (if concerns file exists)
- [ ] Each failed check has specific remediation guidance
- [ ] Validation report produced with per-story and summary sections
- [ ] No story files were modified during validation

## FAILURE MODES

- Skipping checks for stories that "look fine" — missed validation leads to execution failures mid-workflow
- Not loading the actual checklist file and evaluating from memory — checklist may have been updated since training
- Ignoring cross-cutting concerns — stories ship without required project-wide behaviors (logging, error handling, etc.)
- Auto-remediating failed stories instead of flagging them — changes should go through user approval in step 6

## NEXT STEP

**Gating:** Validation report complete for all selected stories.
**Next:** Load `workflows/steps/daily-ceremony/step-06-approve-plan.md`
**If gating fails:** If a story spec file cannot be read, report the missing file and exclude that story from validation. Continue validating remaining stories.
