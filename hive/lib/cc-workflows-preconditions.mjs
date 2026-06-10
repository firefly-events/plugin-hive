/**
 * cc-workflows-preconditions.mjs
 *
 * Shared precondition helpers for cc-workflows skill atoms
 * (execute-mode-cc-workflows, plan-mode-cc-workflows).
 *
 * WORKTREE-ISOLATION INVARIANT
 * ─────────────────────────────
 * Every cc-workflows substrate run MUST be invoked from inside a dedicated
 * `.claude/worktrees/<name>/` checkout. Running from a regular working tree
 * risks branch-churn corruption of the feature branch when an external
 * session touches the same checkout concurrently.
 *
 * Rationale: feedback_cc_workflows_worktree_required (2026-06-05) — branch
 * corruption was observed during cc-workflows substrate run when an external
 * session modified the feat branch while the substrate run was in-flight.
 * Design-discussion Constraint 7 codifies this as a hard gate.
 *
 * See also: feedback_codex_parallel_race — Agent(isolation:worktree) does NOT
 * isolate codex:codex-rescue subagents launched inside the same session, so
 * the worktree requirement is the outer safety boundary.
 *
 * Pattern: the invocation cwd (or any ancestor) must contain the segment
 *   /.claude/worktrees/<name>
 * where <name> is one or more non-slash characters.
 */

const WORKTREE_RE = /\.claude\/worktrees\/[^/]+/;

/**
 * Assert that the current working directory is inside a dedicated
 * `.claude/worktrees/<name>/` checkout.
 *
 * Throws a structured Error (with `.precondition_failed` properties) if the
 * cwd does not match the worktree-isolation pattern. The error shape mirrors
 * the `precondition_failed` JSON emitted by Step 0 so callers can surface it
 * with a consistent `field_sources` audit trail.
 *
 * @param {string} [cwd=process.cwd()] - Directory to check (defaults to cwd).
 * @throws {Error} If cwd does not contain `/.claude/worktrees/<name>`.
 *
 * @example
 * import { assertWorktreeIsolation } from '../../../hive/lib/cc-workflows-preconditions.mjs';
 * assertWorktreeIsolation(); // throws if not in a worktree
 */
export function assertWorktreeIsolation(cwd = process.cwd()) {
  if (WORKTREE_RE.test(cwd)) return;

  const err = new Error(
    `[cc-workflows] Worktree-isolation invariant violated.\n` +
    `  Required: invocation cwd must contain /.claude/worktrees/<name>/\n` +
    `  Failing cwd: ${cwd}\n` +
    `  Fix: run this skill from a dedicated worktree checkout, e.g.\n` +
    `       /Users/<you>/.claude/worktrees/<epic-name>/`
  );

  // Attach structured precondition_failed fields so callers can forward
  // directly into the Step 0 reject JSON without additional reshaping.
  err.precondition_failed = true;
  err.field_sources = {
    worktree_isolation: {
      source: 'cwd',
      value: cwd,
      required_pattern: '.claude/worktrees/<name>/',
      verdict: 'fail',
    },
  };

  throw err;
}

export default assertWorktreeIsolation;
