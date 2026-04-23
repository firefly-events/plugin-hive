---
name: review
description: Run a structured code review on changes, a PR, or a branch.
---

# Hive Review

> **State Directory Note:** Paths shown as `.pHive/...` assume the default
> state directory. If you have relocated state via `paths.state_dir`,
> substitute your configured location. See
> [state-relocation.md](../../hive/references/state-relocation.md) (or
> `hive/references/state-relocation.md` from repo root).

Run a structured code review workflow.

**Input:** `$ARGUMENTS` optionally contains a PR number, branch name, or file paths.

## Kickoff Gate

**Before doing anything else**, check whether Hive has been initialized for this project:

1. Check if `.pHive/project-profile.yaml` exists in the project root
2. If it exists, verify it has a populated `tech_stack` field (not empty, not null)
3. As a secondary check, verify `hive.config.yaml` exists (check both `hive/hive.config.yaml` and `hive.config.yaml` in the project root — either location is valid)

If **any** of these checks fail, display this message and **stop** — do not proceed with the review:

> Hive hasn't been set up for this project yet. Run `/hive:kickoff` first — it takes a few minutes and ensures every agent has full context about your codebase, preferences, and available tools.

If all checks pass, proceed silently — do not announce that the kickoff gate passed. Only surface this section when a check fails.

## Before Executing Any Skill

1. **Load your persona.** Read `hive/agents/orchestrator.md` — it contains team evaluation criteria, pre-spawn checklist, circuit breakers, model tier routing, dev-on-standby pattern, decision protocols, and research prompt construction rules. This is WHO you are and HOW you make decisions.
2. **Load project config.** Read `hive/hive.config.yaml` for execution settings (methodology, parallel teams, circuit breaker limits, model overrides).
3. **Load your memories.** Read the `knowledge` paths from your orchestrator frontmatter. Scan `~/.claude/hive/memories/orchestrator/` for all `.md` files. Read each file's frontmatter `description` field. Load the full content of any memories relevant to the current task. If no memories exist yet, proceed — this is expected for new projects.

## Argument Parsing

| Argument | Interpretation | Diff command |
|----------|---------------|--------------|
| *(none)* | Review staged changes (fall back to unstaged if nothing staged) | `git diff --cached` (or `git diff` if empty) |
| `feature-branch` | Review branch diff against main | `git diff main..feature-branch` |
| `#123` or PR URL | Review a pull request | `gh pr diff 123` |
| `src/foo.ts src/bar.ts` | Review only those files | `git diff -- src/foo.ts src/bar.ts` |

**Pre-flight:** If the argument starts with `#` or looks like a PR URL, verify `gh auth status` succeeds. If `gh` is not authenticated, report the error and suggest using a branch name instead.

## Process

1. **Obtain the diff.** Run the appropriate diff command from the table above. If the diff is empty, report "No changes to review" and stop.

2. **Load the review workflow.** Read `hive/workflows/code-review.workflow.yaml`. This defines the ordered steps for a code review. If the file does not exist, fall back to the two-step process below.

3. **Execute workflow steps sequentially.** For each step in the workflow:

   **a.** Read the agent persona referenced by the step's `agent` field from `hive/agents/{agent}.md`. The two primary agents are:
   - **Researcher** (`hive/agents/researcher.md`) — analyzes scope, complexity, and affected modules
   - **Reviewer** (`hive/agents/reviewer.md`) — evaluates correctness, security, conventions, and performance

   **b.** Spawn a subagent with:
   - The agent persona as system context
   - The step's `task` description (or step file if available)
   - The diff content as input
   - Any `inputs` from previous steps

   **c.** Capture the step output for downstream steps.

4. **Write episode records.** After each step, write an episode to:
   ```
   .pHive/episodes/review/{timestamp}/{step-id}.yaml
   ```

5. **Display structured findings:**

   ```
   ## Code Review Results

   ### Analysis (Researcher)
   - {N} files changed, {M} modules affected
   - Changes touch {summary of affected areas}

   ### Review (Reviewer)
   **Verdict: {passed | needs_optimization | needs_revision}**

   #### Critical
   - **[{category}]** `{file}:{line}` — {finding}

   #### Improvements
   - **[{category}]** `{file}:{line}` — {suggestion}

   #### Nits
   - **[{category}]** `{file}:{line}` — {minor suggestion}

   ### Summary
   {One-sentence overall assessment and recommended action.}
   ```

   Categories: `security`, `correctness`, `performance`, `convention`, `clarity`, `testing`.

   Verdicts:
   - **passed** — No critical findings, safe to merge
   - **needs_optimization** — No blockers, but improvements recommended
   - **needs_revision** — Critical issues that must be addressed before merge

## Key References

- `hive/agents/reviewer.md` — reviewer persona and verdict format
- `hive/agents/researcher.md` — analysis persona
- `hive/references/episode-schema.md` — episode record format
