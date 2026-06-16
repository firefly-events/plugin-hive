# Insights — am-9-user-docs

## Worktree collision on shared epic branch

The daemon auto-creates a branch `agent/developer/<task>` and checks out the worktree.
When the story integration contract says "work on `feat/actual-manual-tier`", that branch is
already claimed by another worktree from a parallel dispatch. `git checkout feat/actual-manual-tier`
fails with "already used by worktree at ...".

**Fix:** create a local tracking branch with a different name, then push to the target remote:
```sh
git checkout -b work/<story-id> FETCH_HEAD   # FETCH_HEAD set by prior git fetch
# ... do the work ...
git rebase origin/feat/actual-manual-tier
git push origin HEAD:feat/actual-manual-tier
```

## Scope note placement

"Scope note" belongs in both docs (README and operations-guide) and should be
co-located with the prerequisite, not buried elsewhere — readers enabling a new tier
read the prerequisite block and that's where the honest "web-first / follow-ons" caveat
lands with them.

## What to put in Commands Reference vs. Quick Start

Quick Start = how to switch modes (env/config knob + prereq + one-liner on what it does).
Commands Reference = full mode table with "when to use" column and mechanistic detail
(what the tier actually does under the hood, why it catches things native can't).
Splitting it this way avoids repeating the full explanation in the README.
