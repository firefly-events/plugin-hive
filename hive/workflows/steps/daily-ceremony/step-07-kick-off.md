# Step 7: Kick Off Execution

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Do NOT spawn teams or agents before evaluating whether parallel or sequential execution is appropriate
- Do NOT execute stories out of dependency order — dependencies must complete before dependents start
- Do NOT skip loading the development workflow for each story — every story executes through its workflow steps
- If a story fails mid-execution, write a `failed` episode marker and continue with independent stories — do NOT halt the entire session

## EXECUTION PROTOCOLS

**Mode:** autonomous

Evaluate execution strategy, spawn teams or agents as appropriate, execute stories through their development workflows. Write status markers after each step.

## CONTEXT BOUNDARIES

**Inputs available:**
- Approved plan from step 6 (story IDs, execution order, parallel flag)
- Story specs at `.pHive/epics/{epic-id}/stories/{story-id}.yaml`
- Cycle state at `.pHive/cycle-state/{epic-id}.yaml`
- Development workflow at `workflows/development.classic.workflow.yaml` (or TDD variant)
- Agent personas at `agents/{agent}.md`
- Step files at `workflows/steps/{workflow-name}/` (if they exist for the development workflow)
- Agent memories loaded in step 2 (relevant memories for team lead to inject)

**NOT available:**
- User input (execution is autonomous after plan approval)
- External tracker live queries (ticket operations happen at status transitions)

## YOUR TASK

Execute the approved stories through their development workflows, using parallel teams for independent stories when possible and sequential execution otherwise.

## TASK SEQUENCE

### 1. Evaluate execution strategy
Analyze the approved stories for independence:
- **Independent stories:** no dependency relationships between them — can run in parallel
- **Dependent stories:** must execute in dependency order

Decision matrix:
- If 2+ independent stories AND `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`: use TeamCreate for parallel execution
- If all stories are dependent (chain): execute sequentially using the Agent tool
- If mixed: group independent stories into a parallel batch, chain dependent stories sequentially

### 2. Set up parallel execution (if applicable)
For parallel teams:
- Use `TeamCreate` to create a team for the session
- Create tasks for each independent story using `TaskCreate`
- Spawn teammates using the Agent tool with `team_name` and `name` parameters
- Each teammate receives: story spec, cycle state, relevant agent memories, development workflow

### 3. Execute each story through its development workflow
For each story (whether via team or sequential):

**a. Load the development workflow.**
Read the workflow YAML (e.g., `workflows/development.classic.workflow.yaml`). Identify the steps: research, implement, test, review, optimize, integrate.

**b. For each workflow step:**
1. Read the agent persona from `agents/{agent}.md`
2. Check for a step file at `workflows/steps/{workflow-name}/{step-file}.md`
   - If step file exists: use it as primary task instructions (WHO + HOW + WHAT model)
   - If no step file: use the workflow step's inline `task` description
3. Spawn a subagent via the Agent tool with:
   - Agent persona (WHO)
   - Step file or task description (HOW)
   - Story spec + cycle state + relevant memories (WHAT)
4. Capture the step output

**c. Write episode markers after each step.**
Write to `.pHive/episodes/{epic-id}/{story-id}/{step-id}.yaml` with all required fields:
- `step_id`, `story_id`, `epic_id`, `agent`, `status`, `timestamp`
- `conclusions`, `decisions_made`, `artifacts_produced`, `context_for_next_phase`

**d. Check gate criteria before advancing.**
- If a step's verdict is `failed` or `needs_revision`: handle per the workflow's gate logic
- If `passed`: proceed to next step
- If `needs_optimization` and an optimize step exists: route through it

### 4. Handle failures gracefully
If a story fails during execution:
1. Write a `failed` episode marker with `conclusions` describing the failure
2. Update cycle state with the failure details
3. Check if other stories depend on this one — mark those as `blocked`
4. Continue executing independent stories that are not affected
5. Include the failure in the session-end summary

### 5. Update cycle state
After each story completes (or fails):
- Record decisions made during execution in `cycle_state.decisions`
- Update story status in cycle state
- If external tracker configured: update ticket status (In Progress -> Done or Blocked)

### 6. Capture insights for session-end
During execution, when agents encounter non-obvious patterns or pitfalls:
- Write insights to `.pHive/insights/{epic-id}/{story-id}/` staging directory
- Follow the staged insight format from `references/agent-memory-schema.md`
- These will be evaluated in step 8

## SUCCESS METRICS

- [ ] Execution strategy evaluated (parallel vs. sequential) based on story independence
- [ ] Each story executed through its full development workflow
- [ ] Episode markers written after every workflow step
- [ ] Gate criteria checked between workflow steps
- [ ] Failed stories handled gracefully — independent stories continue
- [ ] Cycle state updated with decisions and statuses
- [ ] Insights staged for session-end evaluation

## FAILURE MODES

- Spawning parallel teams for dependent stories — race conditions, one story starts without its prerequisite's output
- Skipping episode markers — next session's standup cannot reconstruct what happened
- Halting all execution when one story fails — wastes the session, independent stories could have completed
- Not loading step files when they exist — agents improvise instead of following prescriptive procedures
- Forgetting to update cycle state — decisions and status changes are lost between sessions

## NEXT STEP

**Gating:** All stories have either completed or been marked as failed/blocked. Episode markers written for every step executed.
**Next:** Load `workflows/steps/daily-ceremony/step-08-session-end.md`
**If gating fails:** If execution is interrupted (timeout, crash), write `in_progress` episode markers for incomplete steps so the next session can resume. Then proceed to step 8 for whatever cleanup is possible.
