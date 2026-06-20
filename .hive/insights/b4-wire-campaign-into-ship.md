# b4 — Wire /marketing-campaign into /ship: Implementation Insights

## Step numbering conflict (b4 vs a2)

Story a2 (worktree-prune) was on the `feat/plugin-hygiene` branch, NOT yet merged into `feat/marketing-team` at the time b4 landed. Both stories append after step 8 (Mark Shipped). Resolution: b4 claims step 9 (campaign hook) and explicitly documents that any worktree-prune step follows after. When a2 merges, it must renumber its step to 10 and remove b4's "Sequence note" caveat.

## Consumer gate uses `project_type == consumer-app`

The kickoff schema has three valid values: `framework`, `consumer-app`, `service`. The issue spec said "project_type consumer" — the actual persisted value in `project-profile.yaml` is `consumer-app`. Verify against that exact string when implementing the gate check.

## Opt-in: `--campaign` flag beats `ship.campaign: true` in ergonomics

The config key (`ship.campaign: true`) is better for teams that always want campaigns on ship. The flag is better for one-off opt-in. Both are wired; the gate passes if either is true. The `--campaign` flag is documented inline in the Input table (added to the same table as `--dry-run`, `--partial`, etc.).

## `/marketing-campaign` owns the review gate — `/ship` doesn't add one

The `/marketing-campaign` skill has its own user-review gate after the creative pass. `/ship` hands off the changelog path and does not prompt again. This is intentional: adding a second prompt in `/ship` would duplicate the gate and confuse operators about where to actually review.

## Changelog path is always `CHANGELOG.md` (repo root)

Step 3 writes the `## [Unreleased]` entry to `CHANGELOG.md` at the repo root. The campaign hook passes that path verbatim. No need to resolve a dynamic path.

## `--from-ship` arg documentation loop in the spec

The spec said the step should "document" the `--campaign` flag including a table row to add. That table row is already in the Input flags table at the top of SKILL.md. The "add when maintained" caveat in step 9 body is redundant but harmless — kept for forward-compat clarity.
