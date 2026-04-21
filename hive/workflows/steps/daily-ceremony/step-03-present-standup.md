# Step 3: Present Standup

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Do NOT present raw YAML dumps — format everything into human-readable sections
- Do NOT omit failed or blocked stories — these are the most important items for the user
- Do NOT proceed past presentation — this step ends after the user has seen the report
- If there are no active epics, say so explicitly and proceed to planning phase

## EXECUTION PROTOCOLS

**Mode:** interactive

Format the combined state and memory data into a structured standup report. Present to the user. Wait for acknowledgment before proceeding.

## CONTEXT BOUNDARIES

**Inputs available:**
- State reconstruction report from step 1
- Memory summary from step 2
- Cross-cutting concerns from step 2

**NOT available:**
- Story spec details (only IDs and statuses are known)
- External tracker live data (already captured in step 1 if adapter configured)

## YOUR TASK

Combine state reconstruction and memory summary into a single structured standup report and present it to the user.

## TASK SEQUENCE

### 1. Build the standup header
Include date, active epic count, and overall health indicator:
- GREEN: no failed/blocked stories, work can proceed
- YELLOW: some blocked stories but unblocked work is available
- RED: all remaining stories are blocked or failed

### 1b. Format overnight remote work section

If the step 1 report includes `overnight_pulls` with any commits, add this section at the very top of the standup output (above "Completed"):

```
### 🌙 Overnight
- Commits pulled: {N}
- [if meta_team_commits present]
  **Meta-team cycle `{cycle_id}` ran** — verdict: {passed|partial|poor}
  Read `.pHive/meta-team/morning-summary.md` for the full report.
  Top highlights:
    - {summary bullet 1}
    - {summary bullet 2}
    - {summary bullet 3}
  Deferred to next cycle: {count} findings
- [if non-meta-team commits present]
  Other remote commits: {subject list}
```

If a meta-team cycle ran, read `.pHive/meta-team/morning-summary.md` and pull out:
- The verdict line
- The "What Changed Tonight" top 3 items (condensed to one line each)
- The count of items under "What Was Found (Not Fixed This Cycle)"

If no overnight pulls occurred, skip this section entirely — do NOT add an empty "Overnight: nothing" placeholder.

If the pull was skipped (uncommitted local changes, merge conflict), surface this as a YELLOW warning at the top of the standup:
```
⚠ Overnight remote work NOT pulled: {skip reason}
  You have {N} commits waiting on origin/main. Handle local changes, then `git pull` before proceeding.
```

### 2. Format completed work section
List stories completed in previous sessions, grouped by epic:
```
### Completed
- [{epic-id}] {story-id}: {title} — completed {date}
```

### 3. Format in-progress work section
List stories that were started but not finished:
```
### In Progress
- [{epic-id}] {story-id}: {title}
  Last step: {step-name} ({status})
  Next step: {expected-next-step}
```

### 4. Format blocked and failed work section
This is the most critical section — present with clear action items:
```
### Blocked (needs resolution)
- [{epic-id}] {story-id}: {title}
  Blocker: {description}
  Since: {date}
  Action needed: {what the user needs to do}

### Failed (needs retry or decision)
- [{epic-id}] {story-id}: {title}
  Failure: {description from episode conclusions}
  Last attempt: {date}
  Options: retry | skip | redesign
```

### 5. Format dependency graph
Show the dependency relationships between remaining stories:
```
### Dependency Graph
{story-A} → {story-B} → {story-C}
{story-D} (independent)
{story-E} ✗ blocked by {story-F}
```

### 6. Include relevant memories
Summarize key agent memories that affect today's work:
```
### Institutional Knowledge
- [{agent}] {memory-name}: {one-line summary}
```

### 7. Present the full standup report
Output the complete report to the user. End with:
```
### Ready for Planning
{N} stories available for today's work. Proceed to planning? (yes / or provide specific story IDs)
```

## SUCCESS METRICS

- [ ] Overnight section surfaced at the top of the standup when commits were pulled
- [ ] Meta-team cycle results highlighted when a meta-team cycle ran overnight
- [ ] Skipped-pull warning shown when local changes blocked the pull
- [ ] Standup report includes all five sections: completed, in-progress, blocked, failed, dependency graph
- [ ] Health indicator (GREEN/YELLOW/RED) is accurate based on story statuses
- [ ] Blocked and failed stories have clear action items
- [ ] Dependency graph shows which stories are available vs. blocked
- [ ] Relevant agent memories are summarized
- [ ] Report is presented to the user (not just computed internally)

## FAILURE MODES

- Dumping raw YAML instead of formatted output — user cannot quickly parse status
- Omitting blocked stories — user proceeds to planning without resolving blockers, wasting a session
- Not showing the dependency graph — user may select stories whose dependencies are not met
- Presenting memories without filtering — irrelevant memories dilute the important ones

## NEXT STEP

**Gating:** Standup report presented to user. User has acknowledged.
**Next:** Load `workflows/steps/daily-ceremony/step-04-select-work.md`
**If gating fails:** If user requests changes to the report format or wants more detail on specific items, provide it before proceeding.
