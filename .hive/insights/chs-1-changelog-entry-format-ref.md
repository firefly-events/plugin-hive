# chs-1 insights — changelog-entry-format reference

- The epic branch `feat/changelog-human-summaries` was already checked out in
  another agent's worktree (multica daemon creates one worktree per agent over
  a shared bare repo), so `git checkout <branch>` fails with
  "already used by worktree". Workaround that preserves the integration
  contract: `git checkout --detach origin/<branch>`, commit on detached HEAD,
  then `git push origin HEAD:<branch>`. Future stories on shared epic branches
  should expect this.
- `release_post.mjs` actually implements the degradation chain as
  `outcome ?? description_summary ?? firstSentence(description) ?? title`
  (line ~99) — one link richer than the spec's
  `outcome ?? firstSentence(description) ?? title + acceptance_criteria`.
  The reference doc canonicalizes the story-spec version per the design
  discussion; if chs-3/chs-4 reuse release_post.mjs code directly, reconcile
  the `description_summary` link.
- The 2.11.0 CHANGELOG entry (the canonical exemplar) uses a flat bullet list
  with no `### Added/Changed/Fixed` sections. The doc allows flattening when
  one category dominates, so the exemplar entry stays compliant rather than
  retroactively non-conforming (CHANGELOG is append-only — it could not be
  fixed anyway).
