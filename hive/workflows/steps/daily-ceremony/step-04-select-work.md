# Step 4: Select Work

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Do NOT auto-select stories for the user — always present options and wait for their choice
- Do NOT offer blocked stories as available work — check dependency graph first
- Do NOT proceed without user selection — this is an interactive gate
- If no stories are available (all blocked/completed), tell the user and ask if they want to plan new work

## EXECUTION PROTOCOLS

**Mode:** interactive

Present available stories. User selects which to work on today. Validate selections against dependencies. Produce today's work list.

## CONTEXT BOUNDARIES

**Inputs available:**
- Standup report from step 3 (story statuses, dependency graph)
- State reconstruction from step 1 (full story list with statuses)
- Epic index files at `state/epics/{epic-id}/epic.yaml`
- Story spec files at `state/epics/{epic-id}/stories/{story-id}.yaml`

**NOT available:**
- Story validation results (produced in step 5)
- Agent-ready checklist results (produced in step 5)

## YOUR TASK

Guide the user through selecting which stories to work on today, ensuring all selections respect dependency constraints.

## TASK SEQUENCE

### 1. Build available work list
From the standup data, identify stories that are:
- Status: `pending` or `in_progress` (continuation)
- Not blocked by incomplete dependencies
- Not marked as `blocked` in cycle state

For each available story, read its spec from `state/epics/{epic-id}/stories/{story-id}.yaml` to get the title, description summary, and complexity.

### 2. Present available stories
Format as a numbered selection list:
```
### Available Stories

**Epic: {epic-id} — {epic-title}**

  1. [{story-id}] {title} (complexity: {level})
     {one-line description}
     Dependencies: {met | none}

  2. [{story-id}] {title} (complexity: {level})
     {one-line description}
     Dependencies: {met | none}

**Continuation (in-progress from previous session):**

  3. [{story-id}] {title} — resume from {last-step}
     {one-line description}

---
Select stories for today (numbers, story IDs, or "all"):
```

### 3. Validate user selection
When the user responds:
- Map their selection (numbers or story IDs) to actual story objects
- Check each selected story's `depends_on` field — all dependencies must be either completed or also selected (will be executed first)
- If a dependency is not met, inform the user:
  ```
  Story {id} depends on {dep-id} which is not completed and not selected.
  Options: add {dep-id} to today's list | skip {id} | override (not recommended)
  ```

### 4. Handle new work requests
If the user describes new work not yet planned as stories:
- Note it for the planning phase — it will need decomposition
- Ask: "This needs planning first. Add a planning pass before execution?"
- If yes, flag the new work for step 5 to handle via a compressed planning swarm

### 5. Produce today's work list
Compile the validated selection into an ordered work list:
```
### Today's Work List

Execution order (respecting dependencies):
1. [{story-id}] {title} — {estimated complexity}
2. [{story-id}] {title} — {estimated complexity}
3. [{story-id}] {title} — {estimated complexity}

New work requiring planning:
- {description of unplanned item}

Confirm this work list? (yes / modify)
```

Wait for user confirmation before proceeding.

## SUCCESS METRICS

- [ ] All available (unblocked) stories presented to user with summaries
- [ ] Blocked stories excluded from the selection list
- [ ] User made an explicit selection (not auto-selected)
- [ ] Dependency constraints validated for all selected stories
- [ ] Work list ordered by dependency relationships
- [ ] User confirmed the final work list

## FAILURE MODES

- Auto-selecting stories without user input — removes user agency, may select wrong priorities
- Offering blocked stories — user selects them, execution fails on unmet dependencies
- Not validating dependency chains — story starts but cannot complete because prerequisite is missing
- Ignoring in-progress stories from previous sessions — work gets restarted from scratch instead of resumed

## NEXT STEP

**Gating:** User has confirmed today's work list. At least one story or new work item selected.
**Next:** Load `workflows/steps/daily-ceremony/step-05-validate-stories.md`
**If gating fails:** If user selects no work, ask if they want to end the session or plan new work. Do not proceed to validation with an empty list.
