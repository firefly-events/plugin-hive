# Research brief — story-loop-closure

**Audience:** planner + execute agents
**Scope:** read the existing pieces that already close half of the loop; identify the precise gap on the Multica-issue side.

## Current state — half-closed loop

The autonomous-cycle-loop epic (PR #211, merged 2026-05-21) shipped `e-1-story-status-reconciliation` which closes the **file-side** of the loop:

- `.github/workflows/story-status-reconcile.yml` fires on every PR merge to `develop` or `main`
- The workflow runs `hive/scripts/story-status-backfill.mjs` which calls `hive/lib/story-status.mjs` `deriveStoryStatus()`
- The deriver looks at episode markers + git state (branch merged to main) and derives `completed | in_progress | pending | deferred | blocked | failed`
- When a story YAML's `status:` is stale, the workflow opens `chore/status-reconcile-<date>-<run_id>` with the patched YAML

So `.pHive/epics/<epic>/stories/<id>.yaml` `status:` fields flip from `pending` → `completed` automatically after a PR merge.

## The gap — Multica board

Multica issues (`PLU-14`, `PLU-15`, …) are an independent task tracker. Each story dispatched via Multica gets an issue assigned to `agent:developer`. After the developer agent finishes the classic workflow, the Multica issue lands at `in_review` (developer-agent terminal state). **Nothing closes them after the matching PR merges.** PLU-14..21 from the autonomous-cycle-loop epic are still at `in_review` on the local daemon as of 2026-05-21 22:18 UTC.

## Existing wiring already in place

1. **Episode markers carry the issue identifier.**
   Format: `.pHive/episodes/<epic>/<story>/multica-run.yaml` with `issue_identifier: PLU-N` and `issue_id: <uuid>`. Verified across all 8 stories on the just-shipped epic (after the lint fix in PR #213).

2. **Multica CLI knows how to set status.**
   `multica issue status <key> <status>` — verified by reading `multica issue --help`. Status vocabulary: `backlog | todo | in_progress | in_review | done | cancelled` (probable; needs confirmation in research step of s1-1).

3. **Multica API also supports direct status writes.**
   `PUT /api/issues/<id>?workspace_id=<wid>` accepts a `{"status": "done"}` body; confirmed during this session when we PUT `mcp_config: null` on the agent endpoint (`405` on PATCH, `200` on PUT).

4. **Auth surface is already solved.**
   `~/.multica/config.json` provides `server_url`, `token`, `workspace_id`. The closer can reuse the same auth path that `multica-bootstrap` and `multica-story-dispatch` use.

5. **Adapter pattern is already established.**
   `hive/lib/external/github-issues-adapter.js` (Epic D sandcastle-ops-layer) provides the wrapper-around-`gh-cli` pattern for closing the label-existing leg. `hive/lib/task-tracking-dispatch/` (Epic C ABI) provides the multi-adapter dispatch surface. The Multica adapter for `createStory` already exists; closing on PR merge is the missing inverse direction.

## Open questions for the planning team

1. **Trigger:** GH Action on PR merge? Or post-integrate-step hook inside `/execute`? Or both?
   - GH Action: works for any PR merged through GitHub (including human merges)
   - Post-integrate hook: works only when `/execute` is the path, but fires earlier and doesn't need network round-trip to GH
   - Recommendation: GH Action (the canonical merge surface; humans + bots both flow through it)

2. **Issue→story matching:**
   - Primary: read `.pHive/episodes/<epic>/<story>/multica-run.yaml` for `issue_identifier`, look up by ID
   - Fallback: parse PR title / merged commits for story-id refs, fuzzy-match against Multica issue titles
   - Edge: stories merged by hand that never went through Multica dispatch — no marker, no issue, nothing to close (no-op)

3. **Gate:** `task_tracking.adapter === 'multica'` is the natural gate but the *closer* runs in CI where it doesn't know the local adapter config. Options:
   - Check repo config from the action checkout (read `hive.config.yaml`)
   - Always run the closer; let "no matching Multica issue" be a no-op
   - Recommendation: combine — read config; if `multica`, run; else skip with a one-line log

4. **Failure modes:** Multica daemon down, auth expired, issue already closed, issue cancelled (do not flip cancelled → done).
   - Daemon-down → CI step warns, does not fail the workflow (closer is best-effort metadata, not a release gate)
   - Auth-expired → same warn-only
   - Already-done → no-op (idempotent)
   - Cancelled → skip (never resurrect a cancelled issue to done)

5. **Reverse direction (Multica issue cancelled → story YAML `status: deferred`):**
   - Useful for the reverse loop (operator manually cancels in Multica board, story should reflect that)
   - But: no GH webhook fires on Multica issue cancellation; would need a poller or a Multica-side webhook
   - Recommendation: scope this as a separate slice (slice C, optional, drop if complexity/value tradeoff doesn't pencil out)

## Validation note

context7 not consulted — this is internal Hive infra and Multica's CLI is the canonical contract, not a third-party API. Web research not required.

## inconsistency_risk_signals

- **Term reuse:** "story status" means different things (Multica issue status field vs YAML `status:` field). Be explicit in story names which side you're talking about.
- **`done` vs `completed`:** Multica says `done`; the deriver says `completed`. Don't unify; document the mapping at the adapter boundary.
- **Adapter gate:** the autonomous-cycle-loop epic kept `task_tracking.adapter` at its old value during dispatch; the Multica side worked despite the gate not being multica. Make the closer's gate semantics explicit in s1-2.
