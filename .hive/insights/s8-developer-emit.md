# s8-developer-emit insights

- The `implemented` object can't use a closed `ALLOWED_OBJECTS` frozenset like
  `validated`/`tested` — commit SHAs are open-ended. Pinned shape instead with
  `IMPLEMENTED_OBJECT_RE` (`wip` | 7-40 hex chars), checked after the frozenset
  gate so the two validation styles coexist in one function.
- Gotcha: the helper lowercases verdicts before validation, which is what makes
  hex SHA shape-matching safe — an uppercase SHA from a caller normalizes before
  the regex runs. The regex deliberately has no `re.IGNORECASE`; lowercasing is
  the single normalization point.
- Watch out: hex-shaped words can collide with the SHA pattern (e.g. `decade`,
  `cafebabe` are valid 7-40 hex). The shape gate filters obvious junk
  (`done`, branch names) but is not proof the SHA exists — auditors wanting
  referential integrity must resolve objects against the repo.
- The epic branch was held by a peer worktree, so `git checkout` of the shared
  branch fails with "already used by worktree". Detached HEAD at
  `origin/<branch>` + `git push origin HEAD:<branch>` satisfies the
  single-shared-branch contract without touching the peer's checkout.
