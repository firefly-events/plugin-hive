# Step 3 (Frontend): Implement Frontend Scope

## MANDATORY EXECUTION RULES (READ FIRST)

- Execute tasks in story order. NEVER reorder or skip.
- Run tests after EVERY file change. NEVER proceed with failing tests.
- NEVER claim tests are written or passing without actually running them.
- Track ALL modified files — record every changed file for the episode record.
- You are a SEPARATE agent from the researcher and from the backend implementer. Work from the research brief, story spec, and the backend implementation output ONLY — do not rely on "remembered" context.
- Implement ONLY what the story specifies for frontend scope. No extra features, no unsolicited refactoring, no gold-plating.
- Follow existing patterns from the research brief. Do not introduce new patterns.
- FRONTEND SCOPE ONLY: UI components, view layer, client-side state, presentation logic. Do NOT touch APIs, server logic, or backend infrastructure — that's the backend implement step (which has already run if needed).

## EXECUTION PROTOCOLS

**Mode:** autonomous

Execute continuously until frontend acceptance criteria are satisfied or a blocker is hit. Do not pause between tasks.

## CONTEXT BOUNDARIES

**Inputs available:**
- Story spec (description, acceptance criteria, files_to_modify, code_examples, design_decisions)
- Research brief from step 2 (patterns, affected files, recommended approach)
- Backend implementation output from `backend-implement` (API surfaces, types, contracts) when present
- Cross-cutting concerns from the story's `cross_cutting` section (if present)

**NOT available:**
- Researcher's raw exploration (you only see the brief)
- Other stories in the epic

## YOUR TASK

Implement the FRONTEND portion of the story, consuming the backend's published API surface where applicable.

## TASK SEQUENCE

### 0. Check for existing progress
Check `.pHive/episodes/{epic-id}/{story-id}/` for frontend-implement episode.
If completed, skip to next step.

### 1. Read story spec completely
Extract from the story YAML:
- Acceptance criteria scoped to frontend
- files_to_modify scoped to frontend
- code_examples for frontend patterns
- design_decisions affecting frontend
- cross_cutting (additional requirements applicable to frontend)

### 2. Read research brief and backend output
From step 2 output, extract frontend-relevant patterns. From `backend-implement` output (when present), extract:
- New or changed API surface
- New types / contracts
- Behavioural changes to existing endpoints

### 3. Implement each frontend acceptance criterion
For each frontend criterion, in order — following the same per-criterion test/verify discipline as the canonical step-03-implement.md.

### 4. Address frontend cross-cutting concerns

### 5. Final verification
- Run full test suite (UI + integration)
- Verify every frontend acceptance criterion is satisfied
- Verify no backend files were touched

### 6. Produce frontend implementation summary

## SUCCESS METRICS

- [ ] Every frontend acceptance criterion has corresponding code changes
- [ ] Tests pass after final verification
- [ ] Only frontend files in `files_to_modify` were changed
- [ ] Frontend cross-cutting concerns addressed
- [ ] Implementation summary produced with file list

## FAILURE MODES

See `step-03-implement.md` (canonical) for full FAILURE MODES list.

## NEXT STEP

**Gating:** All frontend acceptance criteria satisfied. Tests pass. Implementation summary produced.
**Next:** Downstream test/review.
**If gating fails:** Report which frontend criteria failed and why. Do not proceed.
