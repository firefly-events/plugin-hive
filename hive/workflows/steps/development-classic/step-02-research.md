# Step 2: Research

## MANDATORY EXECUTION RULES (READ FIRST)

- Max 3 research questions — if the orchestrator provides more, prioritize
- Read each file ONCE — never re-read at different offsets
- Stay on-brief — do NOT explore adjacent systems unless they're in key_files
- Time budget: 5 min (low), 10 min (medium), 15 min (high complexity)
- SKIP this step entirely for low-complexity stories (orchestrator decides)
- Do NOT use Explore agents — use direct Read, Grep, Glob calls

## EXECUTION PROTOCOLS

**Mode:** autonomous

Scoped exploration producing a research brief. Stop when time budget expires or all questions are answered — whichever comes first.

## CONTEXT BOUNDARIES

**Inputs available:**
- Story spec (description, acceptance criteria, key_files, files_to_modify)
- Preflight report from step 1

**NOT available:**
- Implementation code (doesn't exist yet)
- Other story specs in the epic (each story is self-contained)
- MAIN.md, product briefs, or hive system files

## YOUR TASK

Explore the codebase to produce a research brief that gives the developer everything needed to implement the story.

## TASK SEQUENCE

### 0. Check for existing progress
Check `state/episodes/{epic-id}/{story-id}/` for research episode.
If completed, skip to next step.

### 1. Extract research questions (max 3)
From the story spec, identify:
- Q1: What existing patterns should the developer follow?
- Q2: What files will be affected and how are they currently structured?
- Q3: What risks or edge cases exist?

### 2. Read key files
Read ONLY the files listed in story's `key_files` and `files_to_modify`.
For each file: note patterns, conventions, existing implementations.

### 3. Search for related patterns
Use Grep to find similar implementations in the codebase.
Keep searches scoped to the story's domain — don't explore unrelated modules.

### 4. Check cross-cutting concerns
If `state/cross-cutting-concerns.yaml` exists, read it.
Note which concerns apply to this story for inclusion in the brief.

### 5. Produce research brief

```markdown
## Affected Files and Modules
- `path/to/file.ts:12-45` — what it does, why it's relevant

## Existing Patterns and Conventions
- Pattern observed (cite specific file)

## Architectural Constraints
- Constraint and source

## Recommended Approach
- Step-by-step with rationale, citing existing utilities to reuse

## Cross-Cutting Concerns
- {concern}: {specific action needed for this story}

## Risks and Edge Cases
- [severity] Risk — evidence from codebase
```

## SUCCESS METRICS

- [ ] Max 3 research questions answered
- [ ] Only files from key_files/files_to_modify were read
- [ ] Research brief produced with all sections
- [ ] Time budget not exceeded
- [ ] Cross-cutting concerns evaluated (if config exists)

## FAILURE MODES

- **Scope drift:** Reading 20+ files when the story names 3-4. Stay on key_files.
- **Re-reading files:** Reading event.service.ts 7 times at different offsets. Read once.
- **48-minute research runs:** Time budget prevents this. Stop and produce brief with what you have.
- **Reading orchestrator files:** MAIN.md, GUIDE.md are NOT research targets.

## NEXT STEP

**Gating:** Research brief is complete (or story is low-complexity and this step was skipped).
**Next:** Load `workflows/steps/development-classic/step-03-implement.md`
**If gating fails:** Produce partial brief and note gaps. Developer can still proceed with partial context.
