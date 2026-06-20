# Insight: ship worktree prune (a2-ship-closes-worktrees)

## The self-deletion trap

`git worktree remove` on your own cwd silently corrupts the session — the
directory disappears mid-run. Guard by checking `$PWD` (or cwd()) as a prefix
of the candidate path before any removal. If it matches, skip and tell the user
to clean up after they leave. This is distinct from the repo's main worktree
(which git itself refuses to remove); it's about the *agent's own session
worktree* being the epic's worktree.

## `git worktree list --porcelain` is the only machine-readable form

The default tabular output truncates long paths. Always use `--porcelain` and
parse `worktree` + `branch` fields in sequence. The branch field is a full ref
(`refs/heads/feat/…`), not a short name — adjust grep accordingly.

## Merged guard needs an explicit ref, not just `--merged`

`git branch --merged` defaults to HEAD, which may not be the ship target
(especially inside a feature worktree). Always pass the ship-target ref
explicitly so "merged" means "merged into what the release actually shipped to".

## `git worktree prune` is a separate cleanup step

Even after `git worktree remove` succeeds, stale administrative pointers can
linger in `.git/worktrees/`. Always run `git worktree prune` after the removal
loop. It's idempotent and harmless when nothing is stale.

## Idempotency is free

`git worktree list` simply returns nothing for already-removed worktrees.
No special-casing needed — the empty grep result means the loop body never runs.
