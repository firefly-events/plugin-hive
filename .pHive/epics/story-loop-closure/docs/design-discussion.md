# Design discussion — story-loop-closure

## Goal

After a story's PR merges to `develop` or `main`, the Multica issue that tracked that story (`PLU-N`) should transition to `done`. Today it sits at `in_review` forever — file-side reconciliation is solved (epic `autonomous-cycle-loop`, story `e-1`), board-side is not.

## Proposed approach

Mirror the file-side `story-status-reconcile.yml` workflow with a Multica-issue-closer that runs as a sibling GH Action on PR merge:

1. **`hive/lib/multica-issue-closer.mjs`** — new module. Inputs: list of `{epic, story}` pairs (derived from merged commits). For each, read the episode marker at `.pHive/episodes/<epic>/<story>/multica-run.yaml`, extract `issue_id` + `issue_identifier`, PUT status `done` via Multica API. Idempotent (no-op when already done or cancelled). Best-effort (warn-only on transport / auth errors).

2. **`.github/workflows/multica-issue-close.yml`** — new workflow, same trigger shape as `story-status-reconcile.yml` (`pull_request: closed`, merged=true, branches `main` / `develop`). Reads `hive.config.yaml` `task_tracking.adapter`; gates the closer on `=== 'multica'`. Parses the merged commits for story-id references (same logic the file-side workflow uses), invokes the closer module per match.

3. **Auth surface for CI** — the local daemon at `localhost:8080` is not reachable from GitHub-hosted runners. Two paths:
   - **(a)** Skip CI execution entirely; instead wire the closer into the `/execute integrate` step so it fires locally just after the integrate commit (operator-side). Keeps the workflow simple and auth uses `~/.multica/config.json`.
   - **(b)** Run the closer in CI against a remote Multica server. Needs a deploy of the Multica server + a secret in repo settings for the token.

   For the current plugin-hive setup (local-only Multica), **(a) is the right call**. Add an optional CI workflow file that gates on the presence of a `MULTICA_SERVER_URL` repo secret — works for local-only by default, can be turned on later when a hosted Multica exists.

## Risks

- **R1: marker drift.** If the integrate step writes the file-side marker but the Multica run was cancelled/retried with a different issue ID, the closer chases the wrong issue. Mitigation: re-read the marker each time, validate `issue_id` is still assigned to the same agent (the closer can drop the close if the issue identity changed).
- **R2: race with manual operator action.** Operator could close the Multica issue manually (cancelled) while the closer is mid-flight. Mitigation: re-fetch issue status immediately before PUT; if `cancelled`, skip.
- **R3: silent failure.** A best-effort closer that fails silently leaves the loop perpetually half-closed. Mitigation: every closer failure writes a one-line warning to the integrate-step's stdout (operator path) or the workflow log (CI path); a periodic sweep job is out of scope but flagged for a future epic.

## Dependencies

- Episode markers MUST carry `issue_id` and `issue_identifier` (verified in research brief — wave-1/2/3 of autonomous-cycle-loop all do)
- Multica daemon reachable from the integrate-step's process (always true today; assumed for the operator-side variant)

## Open questions

1. **Hook surface:** operator-side (integrate-step hook) or CI-side (GH Action)? Recommendation in research brief is **operator-side primary, CI optional**. Confirming.
2. **Reverse direction (Multica cancelled → YAML deferred):** include in scope or defer? Research recommends slice C optional. Confirming.
3. **What about issues with no marker?** A story merged outside the Multica path has no marker → closer no-op. Confirming nothing in this epic should backfill markers retroactively.

## Scale assessment

**Small.** 5 stories across 2 slices. Each story is ~1 file or ~50-line change. No multi-system coupling, no new infra. The largest pieces (Multica API auth, episode-marker schema, GH Action structure) are all existing patterns being mirrored. Proceeding directly to story decomposition (Phase C).

## Decision points for user

1. Confirm operator-side (integrate-step hook) as primary trigger; CI workflow added as opt-in via secret.
2. Confirm reverse direction (Multica cancelled → YAML deferred) stays as scope slice C optional / drop-friendly.
3. Confirm Multica vocabulary mapping: `done` on board ↔ `completed` in YAML deriver (no unification).
