Shared Multica epic branches may already be checked out in a sibling worktree.
When the story contract says to work directly on the shared branch, inspect
`git worktree list` before forcing local branch operations. If the branch is
locked elsewhere and that worktree is clean, use that existing branch worktree
and reset it to origin; trying to check out the same branch in the task worktree
will fail before any story files can be touched.
