# BMAD Agent Patterns — Improvement Brief for Hive

What makes BMAD agents produce consistent, low-friction results, and how to apply those patterns to Hive.

## 1. Activation Protocol

**BMAD pattern:** Every agent has numbered activation steps (8-16 steps) that execute BEFORE any work begins. Steps 1-3 are universal (load persona, load config, store user name). Steps 4+ are role-specific execution rules. The agent does not produce output until activation is complete.

**BMAD developer example (steps 4-11):**
```
4. READ entire story file BEFORE any implementation
5. Execute tasks IN ORDER as written — no skipping, no reordering
6. Mark task [x] ONLY when implementation AND tests are complete and passing
7. Run full test suite after each task — NEVER proceed with failing tests
8. Execute continuously without pausing until all tasks complete
9. Document what was implemented, tests created, decisions made
10. Update file list with ALL changed files after each task
11. NEVER lie about tests being written or passing
```

**Hive gap:** Hive agents have no activation protocol. They receive a persona and a task, then improvise their startup. This leads to: skipping context loading, not verifying tools, starting work before understanding scope.

**Fix:** Add an `## Activation Protocol` section to every Hive agent persona with numbered steps. Keep it lean (10-15 lines). Universal steps:
1. Read story spec / task context
2. Load agent memories from `~/.claude/hive/memories/{agent}/`
3. Verify required tools (agent-specific)
4. Confirm scope boundaries
5. Execute

Role-specific steps after step 5 (developer gets test gates, researcher gets scope limits, etc.).

## 2. Strict Execution Model (Developer)

**BMAD pattern:** The developer agent (Amelia) has the strictest execution model of any BMAD agent. Key rules:
- **Story is source of truth** — tasks executed exactly as written in the story file, not reinterpreted
- **Sequential execution** — no skipping, no reordering, no "I'll come back to this"
- **Test gates** — full test suite runs after every task. Failing tests = full stop.
- **No lying** — explicit rule: "NEVER lie about tests being written or passing — tests must actually exist and pass 100%"
- **File tracking** — all changed files recorded in story after each task
- **Continuous execution** — no pausing between tasks unless blocked

**Hive gap:** Hive's developer persona (`hive/agents/developer.md`) has general quality guidance but no hard execution rules. Nothing prevents: skipping tests, reordering tasks, claiming tests pass without running them, or losing track of modified files.

**Fix:** Add these rules to Hive's developer persona activation protocol AND to the `step-03-implement.md` step file:
```
- Execute tasks in story order. Never reorder or skip.
- Run tests after EVERY file change. NEVER proceed with failing tests.
- NEVER claim tests are written or passing without running them.
- Track all modified files in the episode record.
- Execute continuously — do not pause between tasks.
```

## 3. Config Injection

**BMAD pattern:** Step 2 of every BMAD agent's activation is: "Load and read config.yaml NOW. Store ALL fields as session variables." The config contains: user_name, communication_language, output_folder, and project-specific settings. This means:
- No runtime prompts for project context — it's injected at startup
- All agents share the same config — consistency across agents
- Config loading is MANDATORY — agent stops if config fails to load

**Hive gap:** Hive agents receive context through the orchestrator's prompt, not through a structured config. This means:
- Context varies depending on how the orchestrator phrases it
- No guaranteed consistency across agents in the same epic
- Project-specific settings (test commands, build commands, paths) are ad-hoc

**Fix:** Hive already has `hive.config.yaml` and cycle state. The activation protocol should explicitly load:
1. `hive.config.yaml` — global Hive settings
2. `.pHive/cycle-state/{epic-id}.yaml` — accumulated decisions for this epic
3. Cross-cutting concerns (if present at `.pHive/cross-cutting-concerns.yaml`)
4. Agent memories from `~/.claude/hive/memories/{agent}/`

This isn't a new config file — it's making existing files part of the mandatory activation sequence.

## 4. State-Aware Continuation

**BMAD pattern:** BMAD step files check for existing work before starting fresh. Example from step-01-init.md:
```
1. Check if output document already exists
2. If exists and has stepsCompleted: load step-01b-continue.md
3. If not exists: fresh workflow setup
```

This means interrupted workflows resume from where they left off rather than restarting.

**Hive gap:** Hive has episode records (`.pHive/episodes/`) that track completion, but step files don't check them. If a workflow is re-run, it starts from scratch rather than resuming.

**Fix:** Add a continuation check to the first step of every workflow:
```
## TASK SEQUENCE

### 0. Check for existing progress (before anything else)
Check .pHive/episodes/{epic-id}/{story-id}/ for existing episode files.
If the previous step has a completed episode, skip to the next incomplete step.
If no episodes exist, start from step 1.
```

This should be a standard section in step-01 of every workflow, not in every step file.

## 5. Permission Avoidance

**BMAD pattern:** BMAD avoids permission friction through:
- **Config injection** — sensitive vars loaded from config, not prompted
- **Lazy file loading** — "Load files ONLY when executing a chosen workflow"
- **Deterministic handlers** — menu items declare exactly which files to load; no improvisation
- **No ad-hoc commands** — everything goes through the workflow.xml executor

The result: BMAD agents rarely trigger permission prompts because they follow prescribed paths, not improvised ones.

**Hive gap:** Hive agents trigger excessive permission prompts because:
- Shell variable assignments in commands (`F0="path"`) trigger "contains newlines" prompts
- Agents improvise CLI commands instead of using templates
- Agents use Write tool for tool-managed files (.f0) instead of the CLI
- No pre-approved command patterns documented

**Fix (already partially done for UI design):**
1. Step files provide exact command templates — agents copy-paste, don't improvise
2. Step files explicitly forbid patterns that trigger prompts (shell variables, multi-line commands, Write tool for managed files)
3. Document per-workflow permission allowlists in `references/permission-patterns.md`
4. Ensure all step files use single-line commands with literal values

## Summary — Priority Fixes

| Pattern | Impact | Effort | Priority |
|---------|--------|--------|----------|
| Activation protocol (all agents) | High — prevents cold-start failures | Medium — 14 agent files, 10-15 lines each | P1 |
| Strict developer execution | High — prevents test skipping, task reordering | Low — one agent file + one step file | P1 |
| Config injection via activation | Medium — improves consistency | Low — activation steps already load these files | P2 |
| State-aware continuation | Medium — prevents wasted re-work | Low — one section in step-01 of each workflow | P2 |
| Permission avoidance | High — eliminates user friction | Already done for UI, extend to other workflows | P1 |
