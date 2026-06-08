# Architect findings — planning-queue (harvested from PLU-282)

COMPONENT_SEAMS:

## Architecture Overview
Planning queue v1 is a Python-primary Hive surface with one local state file, one event-driven feeder, and a Hermes gateway relay for human gates.

ASCII flow:

```
.pHive/planning-queue.yaml
  -> planning queue CLI/service promotes next ready item
  -> watermark feeder counts Multica kanban ready/in_progress issues
  -> Multica issue + idea-queue label
  -> leader can elevate by GATE comment + blocked + blocked-for-human label
  -> Hermes gateway watcher relays blocked GATE to Slack
  -> maintainer Slack answer posts Multica comment
  -> relay/dispatcher wakes or reassigns leader, depending on retrigger fork
```

## Component Boundaries

- **PlanningQueueStore** — owns `<resolved_state_dir>/planning-queue.yaml`; does not own Multica issue creation or Slack relay.
  - Files: proposed `hive/lib/planning_queue/store.py`, `hive/lib/planning_queue/schema.py`, optional CLI `hive/bin/planning-queue`.
  - Reuse: copy the triage single-writer posture from `skills/triage/run.mjs:138-158`, but not the triage state machine (`skills/triage/run.mjs:28-36`).
  - Path: resolve `paths.state_dir` using the contract in `hooks/common.sh:64-149`; default remains `.pHive/planning-queue.yaml` until resolver is broadly shipped.

- **WatermarkFeeder** — owns deciding whether to promote one idea per event/tick; does not own queue mutation outside `promote_next()` and does not own Hermes Slack behavior.
  - Files: proposed `hive/lib/planning_queue/feeder.py`, `hive/lib/planning_queue/multica_client.py`.
  - Signature: `feed_if_below_watermark(config: PlanningQueueConfig, *, now: datetime) -> FeedResult`.
  - Reads Multica depth from `multica issue list --status <status> --output json` or equivalent REST helper; status filtering exists but label filtering does not (`multica issue list --help`). Count target statuses should be configurable, default `ready,in_progress` if those match the workspace kanban vocabulary.
  - Promotes at most `consumption_cap_per_tick` items, default `1`, preserving locked event-driven semantics.
  - Placement decision: Python-primary module. Do not put feeder under `hive/lib/multica-story-dispatch/` because that surface is ESM (`index.mjs`, `episode-sync.mjs`) and existing functions are story dispatch/task polling (`dispatchStoryToPersonas`, `pollTaskUntilTerminal`, `writeMulticaRunEpisode`). Reuse its API/error ideas and, if necessary, a small bridge only for Multica API details.

- **HermesMulticaPlugin** — owns Multica action tools and answer posting; does not own long-running polling by PluginContext alone.
  - Files: proposed Hermes bundled plugin `/Users/don/Code/hermes-agent/plugins/multica/plugin.yaml`, `/Users/don/Code/hermes-agent/plugins/multica/__init__.py`, `/Users/don/Code/hermes-agent/plugins/multica/tools.py`.
  - Tool registration uses `ctx.register_tool(name, toolset, schema, handler, ...)` from `/Users/don/Code/hermes-agent/hermes_cli/plugins.py:317-355`, matching the bundled plugin pattern in `/Users/don/Code/hermes-agent/plugins/spotify/__init__.py:56-66`.
  - Tool signatures:
    - `multica_post_comment(issue_id: str, content: str, parent_id: str | None = None) -> MulticaCommentResult`
    - `multica_update_issue(issue_id: str, status: str | None = None, assignee_type: str | None = None, assignee_id: str | None = None) -> MulticaIssueResult`
    - `multica_resolve_label(name: str, create: bool = True) -> MulticaLabelRef`
    - `multica_add_label(issue_id: str, label_name: str) -> MulticaIssueResult`
    - `multica_list_blocked_gates(status: str = "blocked", label_name: str = "blocked-for-human", since: datetime | None = None) -> list[GateCandidate]`
  - Polling boundary: hybrid. Plugin owns tools and Multica label/comment helpers; gateway owns the long-running watcher because no `register_routine`/`register_poll` API exists in PluginContext (`plugins.py:287-710`), and existing long-running Hermes routines are gateway watchers per researcher findings.
  - Gateway files: proposed `/Users/don/Code/hermes-agent/gateway/multica_gate_relay.py` and a small `/Users/don/Code/hermes-agent/gateway/run.py` integration, following the gateway watcher pattern. Slack send should use `SlackAdapter.send(chat_id, content, reply_to=None, metadata=None)` from `/Users/don/Code/hermes-agent/gateway/platforms/slack.py:758-830`; inbound Slack replies already enter `_handle_slack_message()` at `slack.py:1767-1835`.

- **GateElevationContract** — owns the canonical leader signal and resume metadata; does not own Slack formatting beyond enough correlation data for relay.
  - Leader action sequence:
    1. Ensure label exists: `blocked-for-human` via `multica label list --output json`; create if absent, then attach by ID because `multica issue label add <issue-id> <label-id>` is ID-based.
    2. Post a top-level or thread reply comment using this exact prefix:
       ```
       @orchestrator GATE: <single concise question>

       Context:
       <1-5 bullets with issue/story constraints>

       Needed by:
       <agent or squad name>
       ```
    3. Set issue status to `blocked`.
    4. Attach `blocked-for-human` label.
  - Relay detection: poll `status=blocked`, then client-side filter for the `blocked-for-human` label and latest unresolved `@orchestrator GATE:` comment. Use both label and comment for v1: label narrows operational state, comment carries the human question. Comment-only is noisy; label-only lacks the actual question.
  - Resume contract after answer: post a Multica comment in the original thread if possible:
       ```
       GATE ANSWER:
       <maintainer answer>

       Source: Slack <channel>/<thread_ts>
       ```
    Then either rely on automatic comment-trigger wake or re-dispatch the leader per the open fork.

## Interface Definitions

### PlanningQueue YAML
- Path: `<resolved_state_dir>/planning-queue.yaml`; default `.pHive/planning-queue.yaml`.
- Top-level:
  ```yaml
  version: 1
  next_id: pq-001
  items: []
  ```
- Item shape:
  ```yaml
  - id: pq-001
    state: ready
    title: "Short idea title"
    sketch: |
      Rough problem/opportunity and any constraints.
    priority: p2
    source:
      kind: human
      ref: "maintainer"
    added_at: 2026-06-08T00:00:00Z
    promoted_at: null
    promoted_issue_id: null
    closed_reason: null
    closed_at: null
    state_history:
      - { state: ready, at: 2026-06-08T00:00:00Z }
  ```
- Required fields: `id`, `state`, `title`, `sketch`, `priority`, `source`, `added_at`, `promoted_at`, `promoted_issue_id`, `closed_reason`, `closed_at`, `state_history`.
- State machine:
  - `ready -> held | promoted | discarded`
  - `held -> ready | discarded`
  - `promoted -> consumed`
  - `discarded -> ready` only if explicitly restored
  - `consumed` terminal
- Reorder operation may only reorder `ready`/`held` items; it must not mutate `state_history` unless it also changes state.

### Queue Store API
- `read_queue(path: Path) -> PlanningQueueDocument`
- `append_item(doc: PlanningQueueDocument, item: NewPlanningItem) -> PlanningQueueDocument`
- `reorder_items(doc: PlanningQueueDocument, ordered_ids: list[str]) -> PlanningQueueDocument`
- `promote_next(doc: PlanningQueueDocument, now: datetime) -> tuple[PlanningQueueDocument, PlanningQueueItem | None]`
- `mark_consumed(doc: PlanningQueueDocument, item_id: str, issue_id: str, now: datetime) -> PlanningQueueDocument`
- Errors: `QueueMissing` is treated as empty/create-on-write; `QueueMalformed` warns and refuses overwrite; `InvalidTransition`; `DuplicateId`; `SchemaVersionMismatch`.

### Watermark Config
- Proposed `hive.config.yaml` block, matching existing nested tunable style at `hive.config.yaml:256-261`:
  ```yaml
  planning_queue:
    path: null
    watermark: 3
    consumption_cap_per_tick: 1
    labels:
      idea_queue: idea-queue
      blocked_for_human: blocked-for-human
    multica:
      ready_statuses: [ready, in_progress]
      poll_interval_seconds: 5
      max_issue_scan: 200
  ```
- Python config reader must be broadened or supplemented; `hive/lib/config.py:20-96` currently only has a narrow general parser plus `read_emit_lifecycle_at()` convenience.

## Decision Log

### Decision: Separate Python-primary planning queue store
- Chosen: new Python module under `hive/lib/planning_queue/`, writing `<state_dir>/planning-queue.yaml`.
- Alternatives considered:
  - Reuse `.pHive/triage/queue.yaml` — rejected because the brief locks a separate queue and triage has a five-state intake lifecycle.
  - Put all queue logic in `skills/triage/run.mjs` — rejected because new B code is Python-primary and this would couple idea-feed semantics to a skill-specific JS writer.
- Rationale: preserves the locked queue separation while retaining the proven single-writer mechanics.

### Decision: Feeder reads live Multica issue depth first
- Chosen: status-filtered issue list/API call, client-side label filtering where needed, one promotion per event/tick.
- Alternatives considered:
  - Cached depth signal — rejected for v1 because no current producer is documented and stale depth can over-promote.
  - Cron-only refill — rejected because the locked decision says watermark consumption is event-driven, not cadence-driven.
- Rationale: live depth is verifiable today; config caps bound cost.

### Decision: Hermes hybrid plugin + gateway watcher
- Chosen: bundled `plugins/multica` tools plus gateway watcher integration.
- Alternatives considered:
  - Pure Hermes plugin with `register_poll` — rejected because no such API was found in PluginContext.
  - External cron daemon only — rejected because Slack send/reply correlation already lives inside Hermes gateway.
- Rationale: keeps Multica operations packaged as a plugin while placing long-running behavior where Hermes currently supports it.

### Decision: Label plus GATE comment for elevation
- Chosen: require both `blocked-for-human` label and `@orchestrator GATE:` comment.
- Alternatives considered:
  - Label only — rejected because it lacks the actual question payload and context.
  - Comment only — rejected because CLI/server filtering by comment text is absent and blocked issue scans would be noisy.
- Rationale: both signals are needed for reliable polling and human-readable context.

OPEN_FORKS:
- PAT scope: exact Multica PAT scopes for issue comment/update/assign/squad/label operations remain unknown from CLI help. Recommend owner/admin PAT for v1, narrowed after Multica scope docs/API are confirmed.
- Re-trigger mechanism: unknown whether a maintainer answer comment auto-wakes a blocked leader. Design should support both: first try answer-comment wake; if no active task starts within a configured timeout, relay reassigns/re-dispatches the leader.
- Watermark read source: v1 should read live `multica issue list`/API depth; cached depth remains a later optimization if scan cost becomes measurable.
- Label-vs-GATE-comment: v1 should require both. This is a design answer, but keep it visible because the brief names it as an open fork.

RISKS:
- [high] Label operations are setup-sensitive — evidence: `multica issue label add` requires label ID, and `multica label list --output json` currently returns `[]`. Mitigation: add `resolve_or_create_label(name)` and cache label IDs.
- [high] Relay cannot server-side filter by label through current CLI — evidence: `multica issue list --help` supports status/priority/assignee/project only. Mitigation: poll `--status blocked`, then client-side filter labels/comments; cap scan size.
- [medium] Hermes polling cannot be plugin-only — evidence: PluginContext exposes tools/commands/platforms/hooks, no generic routine/poll API. Mitigation: gateway watcher integration with plugin-owned helper functions.
- [medium] Python-primary code can drift from existing JS Multica helper behavior — evidence: dispatch helpers live in `hive/lib/multica-story-dispatch/*.mjs`. Mitigation: define a small Python Multica client with the same timeout/redaction/error conventions, or bridge only the stable REST calls.
- [medium] Config reader seam is incomplete — evidence: `hive/lib/config.py` has no `planning_queue` accessor. Mitigation: add a typed config loader for `planning_queue` instead of ad hoc YAML reads in each component.
- [low] Unprefixed locked labels differ from existing `task_tracking.label_prefix: "hive"` convention at `hive.config.yaml:129`. Mitigation: default to locked names but keep labels configurable.

ESCALATION FLAGS:
- [moderate] security:plan-audit — new multi-system integration touches Multica PAT permissions, label mutation, issue assignment/comment APIs, Hermes Slack relay, and blocked human-gate workflow — raised_by: architect
- [moderate] security:impl-audit — implementation will touch secrets handling, input validation for Slack-to-Multica answers, and surfaces flagged in plan audit — raised_by: architect
- [minor] performance:audit — relay and feeder introduce polling/client-side scans over Multica issues because label filtering is unavailable in the CLI — raised_by: architect