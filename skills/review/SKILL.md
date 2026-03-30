---
name: review
description: Run a structured code review on changes, a PR, or a branch.
---

# Hive Review

Run a structured code review workflow.

**Input:** `$ARGUMENTS` optionally contains a PR number, branch name, or file paths.

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
   state/episodes/review/{timestamp}/{step-id}.yaml
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
