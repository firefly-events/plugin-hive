# Triage: execute durability window (un-reconciled commit lives only in Multica work_dir)

**Severity:** low–medium (narrow data-loss window, recoverable while workspace survives)
**Surfaced:** 2026-06-22, dag-execute ttt validation.

**Update / correction:** the chain HELD. The ttt work was NOT lost — `integrate`'s
`git push -u origin hive-{story-id}` (step-08) persisted every story branch to the
durable origin (`github.com/firefly-events/ttt-throwaway`: `hive-html-scaffold`,
`hive-game-logic` survived). Only the local temp working checkout vanished, which
is expected. So this is NOT "Hive erases committed work" — committed+integrated
work reaches origin. The residual concern below is the one genuine remaining gap.

## Durability chain today (real consumer project)
1. Multica agent commits on the epic branch in its isolated work_dir (ephemeral cache).
2. ReconcileHandler ff-merges work_dir -> `repo_root` (durable consumer checkout) (#8).
3. Integrate node: `git push -u origin hive-{story-id}` (durable remote).

Steps 2-3 make the work durable. For ttt, `repo_root` was a temp dir + no real
origin, so cleanup erased everything. That is a test-setup choice, not Hive losing
committed work.

## The real window
Between (1) agent-commit and (2) reconcile, the ONLY copy of the commit is the
Multica work_dir `~/multica_workspaces/<wsid>/<task>/workdir/<repo>`. If the run
aborts there and Multica GC/prunes the workspace before reconcile, the commit is
lost (recoverable only while the workspace dir survives on disk).

## Proposed fix
The branch-contract (#15) already puts the agent on the epic branch. Have the
agent **push that branch to origin itself** as the last act of its task, so a
durable remote copy exists the instant the task terminates — independent of
reconcile timing. ReconcileHandler then fetches FROM origin (already-durable)
rather than from the volatile work_dir.

- Add a "push your branch to origin" instruction to the execute agent brief
  (multica-story-dispatch Integration Contract) and/or step-08-integrate.
- ReconcileHandler: prefer `git fetch origin <epic-branch>` when the agent
  reports an origin push; fall back to work_dir fetch (current behaviour) when
  no origin is reachable (local-binding / offline).
- Guard: never prune a Multica workspace until its commit is confirmed on origin
  or reconciled into repo_root.

## Also for the test harness
Run validation epics in a **durable** repo path with a real origin remote, never
a mktemp dir, so a throwaway run cannot be confused with a Hive data-loss bug.
