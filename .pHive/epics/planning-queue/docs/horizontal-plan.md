# Horizontal Plan - Planning Queue

## 1. Layer Inventory

- Queue store: net-new Python-primary state layer for `<resolved_state_dir>/planning-queue.yaml`, default `.pHive/planning-queue.yaml`, borrowing single-writer mechanics from `skills/triage/run.mjs` but not the triage lifecycle.
- Config: extends `hive/lib/config.py` with a typed `planning_queue` reader for path, watermark, caps, label names, ready statuses, polling, and scan limits.
- Multica client (Python): net-new small Python client for issue list/create/comment/label/assign/update operations, mirroring the timeout, JSON, and error posture of `hive/lib/multica-story-dispatch/*.mjs`.
- Watermark feeder: net-new Python service that reads live Multica kanban depth with capped scans and promotes at most one configured pull per tick when depth is below the watermark.
- Gate-elevation contract: extends leader behavior with the required `@orchestrator GATE:` comment, `blocked-for-human` label, and blocked status sequence.
- `hermes-multica` plugin: net-new Hermes tool plugin using `plugin.yaml` plus `register(ctx)` / `register_tool(...)` to expose Multica comment, issue, label, and blocked-gate tools.
- Gateway relay: extends Hermes gateway with `gateway/multica_gate_relay.py` and a `gateway/run.py` hook for blocked/GATE polling, Slack relay, Slack answer ingestion, Multica answer posting, and leader re-dispatch.
- Docs: extends README and `docs/operations-guide.md` with planning queue quick start, operator tunables, gate workflow, and known v1 limits.

## 2. Per-Layer Requirements

## Layer: Queue Store

RESPONSIBILITY:
  - Own only the planning queue state file at `<resolved_state_dir>/planning-queue.yaml`.
  - Default unresolved state to `.pHive/planning-queue.yaml`.
  - Keep planning ideas separate from `.pHive/triage/queue.yaml`.
  - Preserve a single-writer posture from `skills/triage/run.mjs`.

NET-NEW:
  - `hive/lib/planning_queue/schema.py` - queue document and item schema.
  - `hive/lib/planning_queue/store.py` - read, write, append, reorder, promote, consume operations.
  - `hive/lib/planning_queue/errors.py` - queue-specific error types.
  - Optional `hive/bin/planning-queue` - local CLI for humans and tests.
  - `.pHive/planning-queue.yaml` - created on write, not pre-seeded by this plan.

EXTENDS EXISTING:
  - `skills/triage/run.mjs` provides mechanics to copy conceptually: ensure-create, monotonic IDs, mutation discipline, and state history.
  - `hive/references/triage-queue-schema.md` provides schema precedent, not reusable lifecycle semantics.
  - `hooks/common.sh` provides the state-dir resolver contract.

DATA SHAPE:
  - Top level:
    - `version: 1`
    - `next_id: pq-001`
    - `items: []`
  - Item fields:
    - `id`
    - `state`
    - `title`
    - `sketch`
    - `priority`
    - `source`
    - `added_at`
    - `promoted_at`
    - `promoted_issue_id`
    - `closed_reason`
    - `closed_at`
    - `state_history`

STATE MACHINE:
  - `ready -> held`
  - `ready -> promoted`
  - `ready -> discarded`
  - `held -> ready`
  - `held -> discarded`
  - `promoted -> consumed`
  - `discarded -> ready` only by explicit restore.
  - `consumed` terminal.

STORE OPS:
  - `read_queue(path)` returns a typed queue document.
  - `append_item(doc, item)` allocates `next_id`, appends `state_history`, and advances the monotonic ID.
  - `reorder_items(doc, ordered_ids)` reorders only `ready` and `held` items.
  - `promote_next(doc, now)` moves the top eligible `ready` item to `promoted`.
  - `mark_consumed(doc, item_id, issue_id, now)` records the Multica issue ID and terminal consumption.

ERROR POSTURE:
  - `QueueMissing` means empty/create-on-write.
  - `QueueMalformed` refuses overwrite.
  - `SchemaVersionMismatch` blocks mutation.
  - `DuplicateId` blocks mutation.
  - `InvalidTransition` blocks mutation.

DEPENDS ON:
  - Config for resolved path and default location.
  - Docs for operator-facing schema expectations.

## Layer: Config

RESPONSIBILITY:
  - Provide one typed `planning_queue` reader for queue store, feeder, gate helpers, and relay-facing defaults.
  - Avoid scattered ad hoc YAML reads.

NET-NEW:
  - `PlanningQueueConfig` type.
  - `read_planning_queue_config(...)` or equivalent function in `hive/lib/config.py`.
  - Defaults for path, watermark, cap, labels, ready statuses, polling interval, and scan cap.

EXTENDS EXISTING:
  - `hive/lib/config.py` currently reads limited lifecycle timing and imports PyYAML optionally.
  - `hive.config.yaml` and `hive/hive.config.yaml` already show nested tunable style under planning and Multica keys.
  - `hooks/common.sh` defines the state-dir resolver contract that config must honor where available.

CONFIG BLOCK:
  - `planning_queue.path: null`
  - `planning_queue.watermark: 3`
  - `planning_queue.consumption_cap_per_tick: 1`
  - `planning_queue.labels.idea_queue: idea-queue`
  - `planning_queue.labels.blocked_for_human: blocked-for-human`
  - `planning_queue.multica.ready_statuses: [ready, in_progress]`
  - `planning_queue.multica.poll_interval_seconds: 5`
  - `planning_queue.multica.max_issue_scan: 200`

LOCKED DECISION BINDINGS:
  - G2 label-only v1 means config defaults to `idea-queue`; saved board-view automation is deferred.
  - Fork default requires `blocked-for-human` plus `@orchestrator GATE:`.
  - Watermark source is live issue-list depth with capped scan.

DEPENDS ON:
  - Queue store for path semantics.
  - Multica client and feeder for ready statuses, timeouts, and scan caps.
  - Gate contract and plugin tools for label names.

## Layer: Multica Client (Python)

RESPONSIBILITY:
  - Provide Python-primary Multica operations needed by the queue feeder, label helpers, gate contract, and Hermes plugin tools.
  - Mirror the ESM dispatch seam's timeout, JSON parsing, and error posture without directly reusing ESM in the first implementation path.

NET-NEW:
  - `hive/lib/planning_queue/multica_client.py`.
  - Structured result/error objects for issue, comment, label, assignment, and list operations.
  - Label resolver with create-if-missing behavior and cache.

EXTENDS EXISTING:
  - `hive/lib/multica-story-dispatch/index.mjs` provides direct REST and dispatch behavior to mirror.
  - `hive/lib/multica-story-dispatch/episode-sync.mjs` provides polling and terminal-state behavior to mirror where needed.
  - Multica CLI supports `issue list`, `issue update`, `issue status`, `issue assign`, `issue comment add`, and `issue label add/remove`.

OPERATIONS:
  - `list_issues(status, limit, offset)` for ready/in-progress depth and blocked scan.
  - `create_issue(...)` for promotion from queue idea to planning issue.
  - `post_comment(issue_id, content, parent_id=None)` for GATE and answer comments.
  - `update_issue(issue_id, status=None, assignee_type=None, assignee_id=None)` for blocked/resume transitions.
  - `assign_issue(issue_id, assignee_type, assignee_id)` where assign is a separate command/API.
  - `list_labels()` for label lookup.
  - `create_label(name)` where API/CLI support exists.
  - `resolve_or_create_label(name)` because issue label attachment is ID-based.
  - `add_label(issue_id, label_id)` for `idea-queue` and `blocked-for-human`.

ERROR POSTURE:
  - Time out bounded calls.
  - Parse JSON strictly.
  - Return structured command/API errors.
  - Redact secrets in logs and exceptions.
  - Treat missing label-create support as a setup failure, not a silent pass.

DEPENDS ON:
  - Config for timeout, scan caps, ready statuses, and label names.
  - Queue store for promoted item metadata.
  - Gate contract for exact comment prefixes.

## Layer: Watermark Feeder

RESPONSIBILITY:
  - Promote queue items only when live Multica kanban depth falls below the configured watermark.
  - Preserve the locked event-driven semantics with idempotent, capped work per tick.

NET-NEW:
  - `hive/lib/planning_queue/feeder.py`.
  - `FeedResult` type for observed depth, promoted item IDs, created issue IDs, skipped reason, and errors.
  - Tests around fake queue store and fake Multica client.

EXTENDS EXISTING:
  - Existing Multica issue-list CLI/API surface for status-filtered reads.
  - Existing story dispatch ideas only as behavioral precedent, not direct dependency.

FLOW:
  - Read config.
  - Count live Multica issues in configured ready statuses.
  - Stop when observed depth is greater than or equal to `watermark`.
  - Promote at most `consumption_cap_per_tick`, default `1`.
  - Create one Multica planning issue for the promoted item.
  - Resolve/apply `idea-queue` label.
  - Mark the queue item consumed with `promoted_issue_id`.

IDEMPOTENCY:
  - One pull per tick by default.
  - Do not promote when there is no ready item.
  - Do not create duplicate issues for already promoted/consumed items.
  - Scan cap prevents unbounded issue-list paging.

DEPENDS ON:
  - Queue store for `promote_next` and `mark_consumed`.
  - Config for watermark, cap, labels, ready statuses, and scan limit.
  - Multica client for issue count, issue creation, label resolution, and label attach.

## Layer: Gate-Elevation Contract

RESPONSIBILITY:
  - Define the canonical leader-side signal that a human gate exists.
  - Make blocked planning issues machine-detectable by the relay.

NET-NEW:
  - Leader helper behavior or reusable command for gate elevation.
  - Exact GATE comment formatter.
  - Detection contract for unresolved gates.
  - Resume comment format.

EXTENDS EXISTING:
  - Multica issue comments, labels, and status mutation.
  - Existing blocked issue status vocabulary.

LOCKED DECISION BINDINGS:
  - Fork default requires both `blocked-for-human` label and `@orchestrator GATE:` comment.
  - Relay re-dispatches the leader after answer; no auto-wake assumption.

LEADER ACTION SEQUENCE:
  - Resolve or create `blocked-for-human`.
  - Post a comment beginning with `@orchestrator GATE:`.
  - Set the issue status to `blocked`.
  - Attach `blocked-for-human` by label ID.

COMMENT FORMAT:
  - Prefix: `@orchestrator GATE: <single concise question>`
  - Context: one to five bullets.
  - Needed by: agent or squad name.

RELAY DETECTION:
  - Poll `status=blocked`.
  - Client-side filter for `blocked-for-human`.
  - Client-side find latest unresolved `@orchestrator GATE:` comment.
  - Ignore blocked issues without both signals.

ANSWER FORMAT:
  - Prefix: `GATE ANSWER:`
  - Body: maintainer answer.
  - Source: Slack channel/thread timestamp.

DEPENDS ON:
  - Multica client for labels, comments, and status.
  - Config for label names.
  - Gateway relay for answer routing and re-dispatch.

## Layer: `hermes-multica` Plugin

RESPONSIBILITY:
  - Package Multica operations as Hermes tools.
  - Keep long-running blocked/GATE polling out of `PluginContext` because no generic routine/poll API was found.

NET-NEW:
  - `/Users/don/Code/hermes-agent/plugins/multica/plugin.yaml`.
  - `/Users/don/Code/hermes-agent/plugins/multica/__init__.py`.
  - `/Users/don/Code/hermes-agent/plugins/multica/tools.py`.

EXTENDS EXISTING:
  - `/Users/don/Code/hermes-agent/hermes_cli/plugins.py` for directory plugin discovery and `PluginContext.register_tool(...)`.
  - `/Users/don/Code/hermes-agent/plugins/spotify/plugin.yaml` and `__init__.py` for tool plugin pattern.
  - `/Users/don/Code/hermes-agent/plugins/teams_pipeline/plugin.yaml` and `__init__.py` for another tool registration example.

TOOLS:
  - `multica_post_comment(issue_id, content, parent_id=None)`.
  - `multica_update_issue(issue_id, status=None, assignee_type=None, assignee_id=None)`.
  - `multica_resolve_or_create_label(name)`.
  - `multica_add_label(issue_id, label_name)`.
  - `multica_list_blocked_gates(status="blocked", label_name="blocked-for-human", since=None)`.

SECURITY AND ERROR POSTURE:
  - Require workspace-scoped PAT for issue comment, update, assign, label, and issue mutation.
  - Redact PAT and Slack tokens from errors.
  - Return structured tool errors for missing label support, missing issue, malformed JSON, timeout, and forbidden scope.

DEPENDS ON:
  - Multica client behavior and label resolver.
  - Gate contract for blocked gate detection and answer formats.
  - Config defaults for label names and scan caps.

## Layer: Gateway Relay

RESPONSIBILITY:
  - Own the long-running blocked/GATE polling loop.
  - Relay gate questions to Slack.
  - Ingest Slack thread replies.
  - Post `GATE ANSWER:` back to Multica.
  - Explicitly re-dispatch the leader after answer.

NET-NEW:
  - `/Users/don/Code/hermes-agent/gateway/multica_gate_relay.py`.
  - Small `/Users/don/Code/hermes-agent/gateway/run.py` integration.
  - Correlation store for Multica issue/comment to Slack channel/thread timestamp.

EXTENDS EXISTING:
  - `/Users/don/Code/hermes-agent/gateway/run.py` watcher and cron polling patterns.
  - `/Users/don/Code/hermes-agent/gateway/platforms/slack.py` outbound `send(...)` and inbound thread reply handling.

POLL LOOP:
  - Poll blocked issues using `multica_list_blocked_gates` or equivalent helper.
  - Respect `max_issue_scan`.
  - Require both label and GATE comment.
  - Deduplicate already-relayed gates with correlation metadata.
  - Send question to configured Slack channel/thread.

CORRELATION:
  - Store Multica issue ID.
  - Store GATE comment ID.
  - Store Slack channel.
  - Store Slack `thread_ts`.
  - Store answer-posted status.
  - Store leader dispatch/resume status.

ANSWER FLOW:
  - Detect maintainer reply in Slack thread.
  - Post `GATE ANSWER:` comment back into the original Multica thread if possible.
  - Re-dispatch the leader explicitly per locked fork default.
  - Mark correlation as answered to avoid duplicate resumes.

DEPENDS ON:
  - `hermes-multica` plugin tools or shared Multica helper.
  - Slack adapter for send and inbound reply events.
  - Gate-elevation contract for candidate and answer formats.
  - Config for scan caps, polling interval, and label names.

## Layer: Docs

RESPONSIBILITY:
  - Make planning queue operation understandable to maintainers, leaders, and implementers.

NET-NEW:
  - README Quick Start section for planning queue.
  - `docs/operations-guide.md` planning queue section.
  - Example `planning_queue` config block.
  - Example `planning-queue.yaml` entry.
  - Gate elevation example.

EXTENDS EXISTING:
  - Existing README project entry point.
  - Existing `docs/operations-guide.md`.
  - Existing `.pHive/epics/planning-queue/docs/*` planning docs.

CONTENT:
  - How to seed the queue.
  - How to inspect and reorder the queue.
  - How watermark feeding works.
  - What `idea-queue` means in Multica.
  - How to raise a human gate.
  - What `blocked-for-human` means.
  - How Slack answer relay resumes the leader.
  - Tunables: path, watermark, consumption cap, ready statuses, poll interval, scan cap, label names.
  - v1 limits: label-only visual surface, saved board view manual/deferred, no Multica core UI change.

DEPENDS ON:
  - All other layers for accurate commands, config names, and workflow guarantees.

## 3. Cross-Layer Dependencies

DEPENDENCIES:

Queue store -> Config:
  - Queue path depends on `planning_queue.path` and state-dir resolution.

Queue store -> Docs:
  - Human queue seed examples must match schema and state transitions.

Config -> Queue store:
  - Store must consume the typed resolved queue path.

Config -> Watermark feeder:
  - Feeder requires watermark, consumption cap, ready statuses, and scan cap.

Config -> Gate-elevation contract:
  - Gate helpers require `blocked-for-human` label default.

Config -> `hermes-multica` plugin:
  - Plugin tools require label defaults, scan cap, timeout, and workspace/auth settings.

Config -> Gateway relay:
  - Relay requires poll interval, scan cap, Slack target, label names, and re-dispatch behavior.

Multica client -> Watermark feeder:
  - Feeder needs issue-depth reads, issue creation, and `idea-queue` label attach.

Multica client -> Gate-elevation contract:
  - Gate sequence needs comment, label resolve, label attach, and status update.

Multica client -> `hermes-multica` plugin:
  - Plugin tool handlers wrap the same operations.

Multica client -> Gateway relay:
  - Relay needs blocked issue scans, comment reads, answer posting, and re-dispatch/update helpers.

Watermark feeder -> Queue store:
  - Feeder promotes and consumes the next ready queue item.

Watermark feeder -> Config:
  - Feeder behavior is controlled by watermark and cap tunables.

Watermark feeder -> Multica client:
  - Promotion is not complete until the Multica planning issue exists and is labeled.

Gate-elevation contract -> Multica client:
  - Both signal parts require Multica mutation.

Gate-elevation contract -> Gateway relay:
  - Relay detection requires the exact label-plus-comment contract.

`hermes-multica` plugin -> Gateway relay:
  - Relay can call plugin/shared helpers to list blocked gates and post answers.

Gateway relay -> Slack adapter:
  - Relay depends on `SlackAdapter.send(...)` and inbound thread reply handling in `gateway/platforms/slack.py`.

Gateway relay -> Gate-elevation contract:
  - Answer comments must match the `GATE ANSWER:` format.

Gateway relay -> Multica client:
  - Relay posts answers and explicitly re-dispatches the leader.

Docs -> Config:
  - Docs must publish exact config keys and defaults.

Docs -> Gate-elevation contract:
  - Docs must publish exact GATE comment and blocked label workflow.

Docs -> Watermark feeder:
  - Docs must explain one-pull-per-tick and capped scan behavior.

## 4. Layer Map Diagram

```text
HORIZONTAL LAYER MAP
----------------------------------------------------------------------------------------------

Queue Store       | schema.py        | store.py ops       | CLI seed/list      | state file
                  | pq item schema   | append/reorder     | promote/consume    | .pHive/planning-queue.yaml
------------------+------------------+--------------------+--------------------+------------
Config            | PlanningQueueCfg | path resolver      | labels/defaults    | scan caps
                  | typed reader     | state_dir fallback | idea/blocked       | watermark
------------------+------------------+--------------------+--------------------+------------
Multica Client    | issue list       | issue create       | comments/status    | labels
                  | ready depth      | promotion output   | gate/answer        | resolve/add
------------------+------------------+--------------------+--------------------+------------
Watermark Feeder  | depth check      | promote next       | issue materialize  | idempotency
                  | live capped scan | queue mutation     | idea-queue label   | one pull/tick
------------------+------------------+--------------------+--------------------+------------
Gate Contract     | GATE comment     | blocked status     | blocked label      | answer format
                  | question payload | leader pauses      | relay signal       | resume input
------------------+------------------+--------------------+--------------------+------------
Hermes Plugin     | plugin.yaml      | register(ctx)      | Multica tools      | list gates
                  | tool manifest    | register_tool      | comment/update     | client filter
------------------+------------------+--------------------+--------------------+------------
Gateway Relay     | blocked poll     | Slack send         | reply ingest       | re-dispatch
                  | GATE candidates  | channel/thread     | GATE ANSWER        | leader wake
------------------+------------------+--------------------+--------------------+------------
Docs              | README quickstart| operations guide   | config reference   | v1 limits
                  | seed/inspect     | gate workflow      | tunables           | label-only
----------------------------------------------------------------------------------------------
```

## 5. Scope Summary

HORIZONTAL SCOPE:
  Layers affected: 8.
  Total items: 55 concrete requirements across schema, store ops, config, client operations, feeder behavior, gate contract, plugin tools, relay flow, and docs.
  New vs modified: 33 net-new items, 22 extensions of existing patterns or files.
  Estimated total effort: large.

LARGEST LAYER:
  - Gateway relay, because it owns polling, Slack send, inbound thread reply handling, answer posting, correlation, and explicit leader re-dispatch.

RISKIEST LAYER:
  - Gateway relay plus Multica client, because current CLI research found no label server-side filter, label attachment is ID-based, exact PAT scopes are unknown, and long-running polling cannot live in a pure Hermes plugin.

LOCKED DECISIONS APPLIED:
  - G1: Relay is a Hermes gateway feature plus `hermes-multica` plugin tools.
  - G2: Visual surface is label-only v1 with board-view deferred.
  - G3: Scope is large and requires H/V planning before stories.
  - G4: Version bump is minor.
