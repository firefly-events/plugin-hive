# Step 3 (Backend): Implement Backend Scope

## MANDATORY EXECUTION RULES (READ FIRST)

- Execute tasks in story order. NEVER reorder or skip.
- Run tests after EVERY file change. NEVER proceed with failing tests.
- NEVER claim tests are written or passing without actually running them.
- Track ALL modified files — record every changed file for the episode record.
- You are a SEPARATE agent from the researcher. Work from the research brief and story spec ONLY — do not rely on "remembered" context.
- Implement ONLY what the story specifies for backend scope. No extra features, no unsolicited refactoring, no gold-plating.
- Follow existing patterns from the research brief. Do not introduce new patterns.
- BACKEND SCOPE ONLY: APIs, server logic, database, services, infrastructure. Do NOT touch UI components, view layer, or front-end-specific code — that's the frontend implement step.

## EXECUTION PROTOCOLS

**Mode:** autonomous

Execute continuously until backend acceptance criteria are satisfied or a blocker is hit. Do not pause between tasks.

## CONTEXT BOUNDARIES

**Inputs available:**
- Story spec (description, acceptance criteria, files_to_modify, code_examples, design_decisions)
- Research brief from step 2 (patterns, affected files, recommended approach)
- Cross-cutting concerns from the story's `cross_cutting` section (if present)

**NOT available:**
- Researcher's raw exploration (you only see the brief)
- Other stories in the epic
- Frontend implementation work (runs separately, after this step)

## YOUR TASK

Implement the BACKEND portion of the story by translating each backend acceptance criterion into code, following the research brief's recommended approach. The frontend implement step runs after you, depending on backend changes for API surfaces.

## TASK SEQUENCE

### 0. Check for existing progress
Check `.pHive/episodes/{epic-id}/{story-id}/` for backend-implement episode.
If completed, skip to next step.

### 1. Read story spec completely
Extract from the story YAML:
- Acceptance criteria scoped to backend (the contract — every backend criterion must be satisfied)
- files_to_modify scoped to backend (your scope — nothing else gets touched in this step)
- code_examples for backend patterns
- design_decisions affecting backend
- cross_cutting (additional requirements applicable to backend)

### 2. Read research brief
From step 2 output, extract:
- Recommended backend approach (your implementation plan)
- Existing backend patterns to follow (cite specific files)
- Backend utilities to reuse
- Backend risks to watch for

### 3. Implement each backend acceptance criterion
For each backend criterion, in order:

a. Write the minimum code to satisfy the criterion
b. Follow existing patterns from the research brief
c. Run the project's test/build command to verify nothing broke
d. If tests fail: FIX IMMEDIATELY before moving to the next criterion
e. Record the file(s) changed

### 4. Address backend cross-cutting concerns

### 5. Final verification
- Run full test suite one more time
- Verify every backend acceptance criterion is satisfied
- Verify no UI/frontend files were touched

### 6. Produce backend implementation summary

## SUCCESS METRICS

- [ ] Every backend acceptance criterion has corresponding code changes
- [ ] Tests pass after final verification
- [ ] Only backend files in `files_to_modify` were changed (no scope creep, no UI changes)
- [ ] Backend cross-cutting concerns addressed
- [ ] Implementation summary produced with file list

## FAILURE MODES

See `step-03-implement.md` (canonical) for full FAILURE MODES list. The above scope-creep guard against UI changes is the backend-specific addition.

## NEXT STEP

**Gating:** All backend acceptance criteria satisfied. Tests pass. Implementation summary produced.
**Next:** `step-03-implement-frontend.md` (if `needs_frontend == true`) or downstream test/review.
**If gating fails:** Report which backend criteria failed and why. Do not proceed.


## DAG executor outputs (required)

Before finishing, WRITE this step's declared outputs to
`.pHive/dag-outputs/outputs.yaml` (create the directory) in your working copy,
as a flat `key: value` YAML map. The DAG executor reads this file from your
work_dir and merges it onto this step's output graph so downstream nodes can
consume the values; without it those edges resolve to nothing and the run
fails. This file is gitignored execution scratch — do not commit it.

```yaml
implementation: <value>
```

Use concrete values: for path/artifact outputs give the repo-relative path you
wrote; for verdict/status give the literal string; for summaries give a short
string (or a path to the file you wrote). Do not omit a declared key.
