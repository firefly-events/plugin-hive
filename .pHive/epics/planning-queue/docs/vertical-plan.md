# Vertical Plan - Planning Queue

## 1. Slicing Strategy

STRATEGY:
  Total horizontal items: 55.
  Planned slices: 6.
  First slice goal: prove a human can seed, inspect, reorder, and locally promote from a separate `planning-queue.yaml` using typed config.
  Final slice goal: complete v1 planning queue with live watermark feeding, machine-detectable human gates, Hermes Multica tools, Slack relay, explicit leader re-dispatch, and operator docs.

SLICING RATIONALE:
  - The first slice is intentionally local and thin: queue file, typed config, and CLI/store operations only.
  - The feeder is second because it depends on queue promotion and config but can be verified with fake Multica client behavior before Slack or Hermes exist.
  - The leader-side gate contract is third because it creates the machine-detectable blocked/GATE signal the relay will later consume.
  - The `hermes-multica` plugin is fourth because it packages Multica operations needed by the gateway without claiming ownership of long-running polling.
  - The gateway relay is fifth because it depends on the blocked/GATE contract, Multica tools, Slack adapter behavior, and correlation metadata.
  - Docs and tunables close the plan after behavior and exact defaults are stable.

LOCKED DECISION BINDINGS:
  - G1: Slice 4 provides plugin tools; Slice 5 provides the gateway relay.
  - G2: All slices treat `idea-queue` as the v1 visual surface and defer saved board-view automation.
  - G3: The plan remains six cross-stack slices because the epic spans Hive, Multica, Hermes, Slack, config, and docs.
  - G4: The implementation is planned as a minor version change.

## 2. Vertical Slice Plan

## Step 1: Queue Store + Config + CLI Ops

WHAT WORKS AFTER THIS STEP:
  A human can seed, inspect, reorder, and locally promote ideas in a separate planning queue file without touching Multica, Hermes, or Slack.

LAYERS TOUCHED:
  Queue Store:
    - Add `hive/lib/planning_queue/schema.py`.
    - Add `hive/lib/planning_queue/store.py`.
    - Add queue errors for missing, malformed, version mismatch, duplicate ID, and invalid transition cases.
    - Implement `<resolved_state_dir>/planning-queue.yaml`, default `.pHive/planning-queue.yaml`.
    - Implement document shape with `version`, `next_id`, and `items`.
    - Implement item fields from the architect sketch.
    - Implement `ready`, `held`, `promoted`, `discarded`, and `consumed` state transitions.
    - Implement `read_queue`.
    - Implement `append_item`.
    - Implement `reorder_items`.
    - Implement `promote_next`.
    - Implement local `mark_consumed` only as a store operation, not yet connected to Multica.

  Config:
    - Extend `hive/lib/config.py` with `PlanningQueueConfig`.
    - Add typed reader for `planning_queue.path`.
    - Add defaults for `watermark`, `consumption_cap_per_tick`, label names, ready statuses, poll interval, and max scan.
    - Resolve queue path against state-dir contract where available, defaulting to `.pHive/planning-queue.yaml`.

  Docs:
    - Add short internal usage notes or CLI help text for seed/list/reorder/promote behavior.

NOT YET:
  - No live Multica issue count.
  - No Multica issue creation.
  - No `idea-queue` label attachment.
  - No gate-elevation behavior.
  - No Hermes plugin.
  - No Slack relay.
  - No board-view automation.

VERIFIED BY:
  - Unit tests: missing queue behaves as empty/create-on-write.
  - Unit tests: malformed queue refuses overwrite.
  - Unit tests: append allocates monotonic `pq-*` IDs and records `state_history`.
  - Unit tests: reorder affects only `ready` and `held` items.
  - Unit tests: invalid state transitions fail.
  - Manual: run the CLI to append two items, list them, reorder them, and promote the top item.

COMMIT REPRESENTS:
  Basic planning queue state file, typed config, and local queue operations.

---

## Step 2: Watermark Feeder

BUILDS ON:
  Step 1.

WHAT WORKS AFTER THIS STEP:
  The queue auto-feeds the Multica planning board by promoting at most one ready idea when live ready/in-progress depth is below the configured watermark.

LAYERS TOUCHED:
  Multica Client:
    - Add `hive/lib/planning_queue/multica_client.py`.
    - Implement status-filtered issue listing for configured ready statuses.
    - Implement strict JSON parsing and bounded timeout behavior.
    - Implement issue creation for promoted planning ideas.
    - Implement `resolve_or_create_label(name)`.
    - Implement label attachment by ID for `idea-queue`.

  Watermark Feeder:
    - Add `hive/lib/planning_queue/feeder.py`.
    - Implement `feed_if_below_watermark(config, *, now) -> FeedResult`.
    - Count live Multica issues using `planning_queue.multica.ready_statuses`.
    - Respect `planning_queue.watermark`.
    - Respect `planning_queue.consumption_cap_per_tick`, default `1`.
    - Respect `planning_queue.multica.max_issue_scan`.
    - Promote the top ready queue item only when depth is below watermark.
    - Create a Multica issue from the promoted idea.
    - Apply `idea-queue`.
    - Mark the item consumed with the promoted issue ID.

  Config:
    - Wire feeder to typed watermark, cap, label, ready-status, timeout, and scan-cap settings.

NOT YET:
  - No leader GATE workflow.
  - No `blocked-for-human` relay detection.
  - No Hermes tool plugin.
  - No Slack relay.
  - No saved board-view API automation.

VERIFIED BY:
  - Unit tests with fake Multica client: no promotion when depth is at or above watermark.
  - Unit tests with fake Multica client: exactly one promotion when depth is below watermark and cap is `1`.
  - Unit tests: no duplicate issue for already promoted/consumed item.
  - Unit tests: label resolver handles empty label list, existing label, and create-if-missing.
  - Integration-style test: fake issue creation records `promoted_issue_id` and `idea-queue` attach call.
  - Manual sandbox path if available: seed queue, lower kanban depth, run feeder, observe one created/labeled planning issue.

COMMIT REPRESENTS:
  Live watermark feeder that turns ready queue ideas into labeled Multica planning issues.

---

## Step 3: Gate-Elevation Contract (Leader Side)

BUILDS ON:
  Step 2.

WHAT WORKS AFTER THIS STEP:
  A planning leader can raise a human gate that is machine-detectable because the issue is blocked, labeled `blocked-for-human`, and contains a canonical `@orchestrator GATE:` question.

LAYERS TOUCHED:
  Gate-Elevation Contract:
    - Add reusable leader-side helper or documented command sequence for gate elevation.
    - Implement exact `@orchestrator GATE:` comment formatter.
    - Require context bullets and needed-by line.
    - Require blocked status.
    - Require `blocked-for-human` label.
    - Define `GATE ANSWER:` reply format for later relay consumption.

  Multica Client:
    - Ensure comment posting supports parent/thread argument where available.
    - Ensure issue status update supports `blocked`.
    - Ensure label resolver supports `blocked-for-human`.
    - Ensure label attach is by label ID.

  Config:
    - Use `planning_queue.labels.blocked_for_human`, default `blocked-for-human`.

NOT YET:
  - No Hermes plugin tools.
  - No automated blocked/GATE polling.
  - No Slack relay.
  - No automatic leader re-dispatch.

VERIFIED BY:
  - Unit tests: generated GATE comment begins with exact `@orchestrator GATE:` prefix.
  - Unit tests: leader helper performs comment, status, and label operations.
  - Unit tests: missing label ID resolution fails explicitly.
  - Fixture test: blocked issue candidate contains both `blocked-for-human` and latest unresolved GATE comment.
  - Manual sandbox path if available: raise a gate and inspect Multica issue status, label, and comment.

COMMIT REPRESENTS:
  Canonical machine-detectable human-gate signal for blocked planning issues.

---

## Step 4: `hermes-multica` Plugin Tools

BUILDS ON:
  Step 3.

WHAT WORKS AFTER THIS STEP:
  Hermes can drive Multica operations through tool calls for comments, issue updates, label resolution, label attachment, and blocked gate listing.

LAYERS TOUCHED:
  `hermes-multica` Plugin:
    - Add `/Users/don/Code/hermes-agent/plugins/multica/plugin.yaml`.
    - Add `/Users/don/Code/hermes-agent/plugins/multica/__init__.py`.
    - Add `/Users/don/Code/hermes-agent/plugins/multica/tools.py`.
    - Register tools through `register(ctx)` and `ctx.register_tool(...)`.
    - Implement `multica_post_comment`.
    - Implement `multica_update_issue`.
    - Implement `multica_resolve_or_create_label`.
    - Implement `multica_add_label`.
    - Implement `multica_list_blocked_gates`.

  Multica Client:
    - Share or mirror Python Multica operation semantics in the plugin environment.
    - Keep timeout, JSON, and redaction behavior consistent.
    - Implement client-side filtering for `blocked-for-human` because no label filter was found in `issue list`.

  Gate-Elevation Contract:
    - Reuse the same blocked/GATE detection rules.

NOT YET:
  - No gateway-owned long-running poll loop.
  - No Slack send/reply correlation.
  - No answer-back automation.
  - No leader re-dispatch.

VERIFIED BY:
  - Plugin unit tests with mocked `PluginContext`: each tool registers with the expected name and schema.
  - Tool tests with fake Multica client: post comment returns structured result.
  - Tool tests: update issue handles status and assignment fields.
  - Tool tests: resolve-or-create label handles empty label list.
  - Tool tests: list-blocked-gates polls blocked issues, filters by label and GATE comment, and respects max scan.
  - Manual Hermes dev check if available: plugin loads and tool list includes all five tools.

COMMIT REPRESENTS:
  Hermes Multica tool surface for comments, labels, issue updates, and blocked gate discovery.

---

## Step 5: Gateway Relay Loop

BUILDS ON:
  Step 4.

WHAT WORKS AFTER THIS STEP:
  A blocked planning issue with `blocked-for-human` and `@orchestrator GATE:` is relayed to Slack, a Slack thread answer is posted back as `GATE ANSWER:`, and the planning leader is explicitly re-dispatched.

LAYERS TOUCHED:
  Gateway Relay:
    - Add `/Users/don/Code/hermes-agent/gateway/multica_gate_relay.py`.
    - Add a small `/Users/don/Code/hermes-agent/gateway/run.py` integration.
    - Poll blocked/GATE candidates using the plugin tool or shared helper.
    - Respect poll interval and max scan config.
    - Deduplicate already-relayed gates.
    - Persist correlation for Multica issue ID, GATE comment ID, Slack channel, and Slack `thread_ts`.
    - Detect Slack replies in the correlated thread.
    - Post `GATE ANSWER:` to the original Multica thread where possible.
    - Explicitly re-dispatch the leader after answer.
    - Mark correlations answered/resumed to avoid duplicate dispatch.

  `hermes-multica` Plugin:
    - Expose or share blocked gate listing and answer-posting helpers.
    - Keep plugin as tools-only; do not move long-running polling into PluginContext.

  Gate-Elevation Contract:
    - Consume the label-plus-comment signal.
    - Produce the canonical answer comment format.

  Multica Client:
    - Support comment thread targeting.
    - Support leader re-dispatch/update path per available Multica operation.

  Config:
    - Add relay poll interval, scan cap, Slack target, and re-dispatch settings where the gateway expects them.

NOT YET:
  - No production-scale load testing.
  - No saved board-view automation.
  - No alternate pure-plugin routine API.
  - No cached kanban depth optimization.

VERIFIED BY:
  - Unit tests with fake Multica blocked gate list and fake Slack adapter: first poll sends one Slack thread.
  - Unit tests: repeated poll does not duplicate an already-correlated gate.
  - Unit tests: Slack thread reply posts one `GATE ANSWER:` comment to Multica.
  - Unit tests: answer flow re-dispatches the leader exactly once.
  - Unit tests: candidate scan stops at max scan.
  - Manual sandbox path if available: raise gate, observe Slack relay, answer in Slack thread, observe Multica answer comment and leader resume.

COMMIT REPRESENTS:
  End-to-end asynchronous human gate over Slack for blocked planning issues.

---

## Step 6: Docs + Tunables Polish

BUILDS ON:
  Step 5.

WHAT WORKS AFTER THIS STEP:
  Maintainers and operators can configure, run, verify, and troubleshoot the planning queue, feeder, gate contract, Hermes tools, and Slack relay using repository docs.

LAYERS TOUCHED:
  Docs:
    - Update README Quick Start with planning queue seed/list/reorder/promote basics.
    - Update README Quick Start with watermark feeder invocation.
    - Update `docs/operations-guide.md` with operator workflow.
    - Document `planning_queue` config block and defaults.
    - Document `idea-queue` as label-only v1 visual surface.
    - Document that saved board-view automation is deferred.
    - Document `blocked-for-human` plus `@orchestrator GATE:` as both required.
    - Document `GATE ANSWER:` reply format.
    - Document relay re-dispatch behavior.
    - Document known risks: label ID setup, capped client-side scans, PAT scope, Slack correlation.

  Config:
    - Confirm defaults match docs.
    - Confirm comments/examples do not imply board-view automation.

  Gateway Relay:
    - Confirm operator-facing tunables are discoverable.

NOT YET:
  - No Multica core UI changes.
  - No automatic saved board-view creation.
  - No production load/performance audit beyond capped scan verification.

VERIFIED BY:
  - Documentation review: README and operations guide use exact config keys.
  - Documentation review: examples use `idea-queue`, `blocked-for-human`, `@orchestrator GATE:`, and `GATE ANSWER:`.
  - Smoke test: follow Quick Start in a sandbox/local environment through seed and feed.
  - Smoke test: follow gate workflow in a sandbox if Slack/Hermes credentials are available.

COMMIT REPRESENTS:
  Operator-ready planning queue documentation and finalized tunable defaults.

## 3. Overlay Diagram

```text
VERTICAL SLICE OVERLAY
-----------------------------------------------------------------------------------------------------

                 | Step 1          | Step 2          | Step 3         | Step 4        | Step 5
                 | Queue proof     | Feeder          | Gate signal    | Plugin tools  | Relay loop
-----------------+-----------------+-----------------+----------------+---------------+------------
Queue Store      | schema/store    | promote/consume |                |               |
                 | CLI ops         | issue id record |                |               |
-----------------+-----------------+-----------------+----------------+---------------+------------
Config           | typed reader    | watermark/caps  | blocked label  | scan defaults | relay cfg
                 | path defaults   | ready statuses  |                |               | Slack target
-----------------+-----------------+-----------------+----------------+---------------+------------
Multica Client   |                 | list/create     | comment/status | tool backend  | answer/resume
                 |                 | idea label      | blocked label  | blocked scan  |
-----------------+-----------------+-----------------+----------------+---------------+------------
Watermark Feeder |                 | depth < N       |                |               |
                 |                 | one pull/tick   |                |               |
-----------------+-----------------+-----------------+----------------+---------------+------------
Gate Contract    |                 |                 | GATE + blocked | list contract | answer format
                 |                 |                 | + label        |               |
-----------------+-----------------+-----------------+----------------+---------------+------------
Hermes Plugin    |                 |                 |                | register_tool | helper/tool use
                 |                 |                 |                | five tools    |
-----------------+-----------------+-----------------+----------------+---------------+------------
Gateway Relay    |                 |                 |                |               | poll/Slack/retry
                 |                 |                 |                |               | re-dispatch
-----------------+-----------------+-----------------+----------------+---------------+------------
Docs             | CLI help notes  |                 |                |               |
                 |                 |                 |                |               |
-----------------------------------------------------------------------------------------------------

                 | Step 6
                 | Docs/tunables
-----------------+----------------
Queue Store      | schema examples
Config           | config reference
Multica Client   | auth/error notes
Watermark Feeder | feeder ops
Gate Contract    | gate workflow
Hermes Plugin    | tool references
Gateway Relay    | relay runbook
Docs             | README + ops guide
-----------------------------------------------------------------------------------------------------

Each column is a commit-worthy working state.
```

## 4. Deferred Items

DEFERRED:
  - Saved Multica board-view creation or management.
  - Multica core UI tab or core product change.
  - Generic Hermes plugin routine/poll API.
  - Cached kanban depth source.
  - Server-side label filtering unless a Multica API surface is discovered during implementation.
  - Production-scale load testing over large workspaces.
  - PAT scope narrowing beyond the workspace-scoped default identified in the gate decisions.

RATIONALE:
  - G2 locks label-only v1 and defers board-view automation.
  - Research found no saved board-view CLI/API surface.
  - Research found no generic Hermes `register_poll` or `register_routine` API, so v1 uses gateway integration.
  - Fork defaults lock live issue-list depth with capped scan instead of cached signal.
  - Current CLI research found status filtering but no label filter.
  - The design target is v1 workflow correctness, not production-scale relay load validation.

## 5. Risk by Slice

RISK PER SLICE:
  Step 1: Low - local Python queue state and config only; primary risk is malformed YAML overwrite behavior.
  Step 2: Medium - first Multica integration; risks are label ID resolution, missing label-create surface, timeout posture, and duplicate issue creation.
  Step 3: Medium - gate detectability depends on exact comment prefix, blocked status, and ID-based label attach all succeeding.
  Step 4: Medium - Hermes plugin shape is known for tools, but the Multica plugin is net-new and must avoid implying long-running polling support.
  Step 5: High - relay crosses Multica, Hermes gateway, Slack send/reply handling, correlation storage, and explicit leader re-dispatch.
  Step 6: Low - docs and tunables polish; risk is documentation drifting from actual defaults or implying deferred board-view automation.

## 6. Moldability Notes

- Step 1 should remain first because every later slice depends on the queue store and typed config.
- Step 2 should remain before Step 3 if the team wants the planning queue to feed real work before human gates are automated.
- Step 3 can be implemented before Step 2 only if the team prioritizes gate workflow over queue feeding, but the Multica client work would still be needed.
- Step 4 can start in parallel with Step 3 after the gate contract format is stable.
- Step 5 should not start until Step 3 and Step 4 are complete because it depends on both detection rules and Multica tool/helper behavior.
- Step 6 can begin incrementally but should close last so docs match implemented names, flags, and defaults.
- If label creation is unavailable, add a setup/config slice before Step 2 to provision `idea-queue` and `blocked-for-human` labels manually.
- If Multica exposes server-side label filtering during implementation, Step 4 and Step 5 can replace capped client-side filtering without changing the slice boundaries.
- If Slack credentials are unavailable, Step 5 can still land with fake adapter tests and mark manual Slack verification as environment-blocked.
- If scope shrinks, the safest cut is to ship Steps 1-2 as queue feeding only and defer Steps 3-5 as the human-gate relay follow-up.
