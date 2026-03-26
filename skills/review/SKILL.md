---
name: review
description: |
  Run a structured code review on staged changes, a PR, or a branch. Spawns
  researcher and reviewer agents for independent analysis. Use when the user
  says "review this code", "code review", "review my changes", "hive review",
  or wants a structured multi-perspective review of their work.
---

# Hive Review

Run a structured code review workflow.

**Input:** `$ARGUMENTS` optionally contains a PR number, branch name, or file paths to review.

**Examples:**
- `/hive:review` — review current staged changes (or unstaged if nothing is staged)
- `/hive:review feature-branch` — review the diff of `feature-branch` against `main`
- `/hive:review #123` — review pull request 123
- `/hive:review src/auth.ts src/middleware.ts` — review specific files only

If no arguments are provided, the review targets whatever is in the current working tree diff.

**Instructions:** Read the full Hive skill at `skills/hive/ORCHESTRATOR.md` and follow the **Review Command** section. Agent personas are in `skills/hive/agents/`.
