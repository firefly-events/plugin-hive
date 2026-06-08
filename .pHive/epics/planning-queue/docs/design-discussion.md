# Design Discussion - Planning Queue

## 1. What Are We Doing?

We are building the first version of an autonomous planning queue for Hive.

The north star from `.pHive/proposals/cluster-b-planning-queue-brief.md` is a rough-idea queue that feeds Multica planning work when the kanban gets thin, plus a human-gate path that lets a leader ask the maintainer a question through Hermes and resume later.

The maintainer locked four decisions that I am treating as inputs, not risks: use a separate `planning-queue.yaml`; surface the queue through an `idea-queue` label and saved board view; trigger feeding by kanban low watermark; and use a `hermes-multica` plugin seam.

The queue is not the triage queue. The existing triage queue gives us mechanics, but the planning queue has consumption-fed semantics and a different lifecycle.

The visual surface is not a Multica core tab. For v1, `idea-queue` plus a saved board view is the convention.

The feeder is event-driven. When ready/in-progress depth drops below watermark `N`, the feeder promotes at most the configured cap from `planning-queue.yaml`.

The gate path is for work already in motion. A leader posts `@orchestrator GATE: <question>`, marks the issue blocked, applies `blocked-for-human`, and waits for the Hermes-to-Slack answer loop.

Done means the queue store, feeder, gate contract, Hermes/Multica plugin, gateway-owned relay, config, risks, forks, and verification strategy are clear enough for the next planning gate.

## 2. What I Found

The existing triage queue gives us useful mechanics but the wrong domain model. `hive/references/triage-queue-schema.md` defines a top-level `version: 1` and `items: []`; `skills/triage/run.mjs` implements ensure-create behavior, monotonic IDs, queue mutation, and JSON command envelopes. I would reuse that single-writer posture, not the triage lifecycle.

The Multica dispatch seam has fan-out and polling ideas worth copying. `hive/lib/multica-story-dispatch/index.mjs` has `dispatchStoryToPersonas(...)` and REST helpers; `hive/lib/multica-story-dispatch/episode-sync.mjs` has `pollTaskUntilTerminal(...)` and episode marker writing. Those files are ESM and story-dispatch oriented, while the brief says new B code follows the completed Python-first language ADR, so the planning queue should be a Python surface that borrows behavior.

The Multica CLI can do the happy-path mutations. Research found `issue update`, `issue status`, `issue assign`, `issue comment add`, and `issue label add/remove`. `multica issue list` can filter by status, priority, assignee, project, limit, and offset, and returns JSON list metadata.

The important CLI constraint is missing label filtering. The feeder and relay can poll by status, but label matching likely has to happen client-side unless implementation uses a REST endpoint beyond the researched CLI surface.

Label operations have setup risk. Research found `issue label add` requires a label ID, and `multica label list --output json` returned `[]`. `idea-queue` and `blocked-for-human` need a `resolve_or_create_label(name)` seam or equivalent cache before they are reliable.

Hermes has two relevant patterns, not one. `/Users/don/Code/hermes-agent/hermes_cli/plugins.py` exposes directory plugin discovery and `PluginContext.register_tool(...)`; the spotify and teams pipeline plugins show the `plugin.yaml` plus `__init__.py register(ctx)` tool pattern. The kanban area gives dashboard and gateway-watcher prior art, not a generic polling plugin.

No generic `register_routine` or `register_poll` API was found in `PluginContext`. That is a hard design constraint: `hermes-multica` can package Multica tools, but the long-running blocked/GATE watcher belongs in the Hermes gateway or a gateway-adjacent daemon.

Slack is gateway-owned today. `/Users/don/Code/hermes-agent/gateway/platforms/slack.py` owns Slack auth, outbound posts, inbound Socket Mode events, thread replies, and slash command handling. A pure directory plugin relay would duplicate the wrong layer.

State-dir resolution is partly designed and partly not shipped. `hooks/common.sh` has the live `state_dir` resolver contract, and `hive/references/state-relocation.md` documents the relocation direction. The target path should be `<resolved_state_dir>/planning-queue.yaml`, defaulting to `.pHive/planning-queue.yaml`.

Config has precedent but needs a better reader. `hive.config.yaml` and `hive/hive.config.yaml` already carry task-tracking labels and nested Multica polling/timeouts/caps, but `hive/lib/config.py` mainly exposes lifecycle emission timing.

There is a label convention tension. Existing examples use `task_tracking.label_prefix: "hive"` and labels like `hive:ready`; the locked design uses unprefixed `idea-queue` and `blocked-for-human`. I would keep the locked names as defaults and make them configurable.

## 3. My Proposed Approach

I would build five cooperating surfaces, starting with the queue store.

First, add `hive/lib/planning_queue/` with `store.py`, `schema.py`, `config.py`, and probably `errors.py`. The store owns only `<resolved_state_dir>/planning-queue.yaml`; it does not create Multica issues, apply labels, or talk to Slack.

The YAML should follow the architect sketch:

```yaml
version: 1
next_id: pq-001
items: []
```

Each item should carry `id`, `state`, `title`, `sketch`, `priority`, `source`, `added_at`, `promoted_at`, `promoted_issue_id`, `closed_reason`, `closed_at`, and `state_history`. The small state machine should be `ready -> held | promoted | discarded`, `held -> ready | discarded`, `promoted -> consumed`, and `consumed` terminal.

The useful store API is `read_queue`, `append_item`, `reorder_items`, `promote_next`, and `mark_consumed`. `QueueMissing` should mean empty/create-on-write. `QueueMalformed` should refuse overwrite.

Second, add a local command surface, probably `hive/bin/planning-queue`, for append, reorder, promote, hold, discard, and list. The issue brief calls out append, reorder, and promote operations, and the feeder should not be the only mutation path.

Third, add `WatermarkFeeder` in `hive/lib/planning_queue/feeder.py` plus `multica_client.py`. The architect's signature is right: `feed_if_below_watermark(config: PlanningQueueConfig, *, now: datetime) -> FeedResult`.

For v1, the feeder should read live Multica issue depth using status-filtered `issue list` or equivalent REST. The default count target should be `ready` plus `in_progress` if those match the workspace kanban vocabulary. It should compare depth to `planning_queue.watermark`, then promote at most `planning_queue.consumption_cap_per_tick`, default `1`.

Fourth, encode the gate-elevation contract as leader behavior and relay input. The leader should resolve or create `blocked-for-human`, post a comment beginning with `@orchestrator GATE:`, set issue status to `blocked`, and attach `blocked-for-human` by label ID.

I think v1 should require both label and GATE comment, even though the brief keeps that as an open fork. The label gives the relay an operational signal; the comment carries the actual question and context. Comment-only is noisy because no researched comment-text filter exists. Label-only loses the question payload.

Fifth, build `hermes-multica` as a Hermes tool plugin plus a gateway-owned relay. The plugin side should follow the spotify-style `plugin.yaml` and `register(ctx)` pattern using `PluginContext.register_tool(...)`.

Likely tools are `multica_post_comment`, `multica_update_issue`, `multica_resolve_label`, `multica_add_label`, and `multica_list_blocked_gates`.

The gateway side should own the watcher because no generic plugin routine API was found. I would add `gateway/multica_gate_relay.py` and a small `gateway/run.py` integration, following the existing gateway watcher pattern. Slack outbound should use the existing Slack adapter `send(chat_id, content, reply_to=None, metadata=None)`.

Slack answers should post back into the original Multica thread as:

```text
GATE ANSWER:
<maintainer answer>

Source: Slack <channel>/<thread_ts>
```

The relay should store correlation metadata from Slack channel/thread to Multica issue/comment thread so answer routing is deterministic.

Finally, add config under `planning_queue` in `hive.config.yaml`:

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

Because `hive/lib/config.py` is narrow today, this needs a typed planning queue config reader instead of scattered ad hoc YAML reads.

## 4. What Could Go Wrong

**High - label operations can fail before the workflow starts.** Label attachment is ID-based, and the current label list returned empty. Mitigation: add `resolve_or_create_label(name)` and cache label IDs where appropriate.

**High - relay polling cannot server-side filter by label through the researched CLI.** `multica issue list` supports status filters but no label filter in the research. Mitigation: poll `status=blocked`, cap the scan, then client-side filter labels and latest unresolved `@orchestrator GATE:` comments.

**Medium - Hermes relay cannot be a pure directory plugin.** `PluginContext` has tool registration but no researched poll/routine registration. Mitigation: keep tools in `hermes-multica`, but put long-running blocked/GATE polling in the Hermes gateway.

**Medium - Python-primary queue work can drift from JS Multica dispatch behavior.** The existing dispatch seam is ESM while new B code is Python-primary. Mitigation: write a small Python Multica client with the same timeout, JSON, and error posture, and bridge to JS only if needed.

**Medium - config can split across readers.** `hive/lib/config.py` does not currently expose planning queue config. Mitigation: add one typed reader for `planning_queue`, and make store, feeder, and gate helpers consume that type.

**Medium - Slack answer correlation can get messy.** Slack thread replies are already ingested by the gateway, but mapping a Slack thread back to the exact Multica issue and GATE comment is new. Mitigation: persist Multica issue ID, gate comment ID, Slack channel, and Slack thread timestamp.

**Low - unprefixed labels differ from existing label-prefix examples.** The locked design says `idea-queue` and `blocked-for-human`; existing examples use `hive:` labels. Mitigation: default to the locked names and keep them configurable.

**Low - state-dir resolver is not broadly shipped.** The desired path is `<resolved_state_dir>/planning-queue.yaml`, but `.pHive` is still the current default convention. Mitigation: use the resolver contract where available and keep `.pHive/planning-queue.yaml` as default.

## 5. Dependencies and Constraints

Dependency: C language ADR is done. The brief says B should follow the Python-first plus bridges direction.

Dependency: state-dir-resolver is planned, not shipped. The design should target `<resolved_state_dir>/planning-queue.yaml`, but implementation should not block on full resolver rollout.

Dependency: Hermes/Multica glue is net-new. The `hermes-multica` plugin, Multica tool handlers, label helpers, blocked gate scan, and answer-posting flow do not exist yet in the researched surfaces.

Constraint: the four locked decisions from `.pHive/proposals/cluster-b-planning-queue-brief.md` are inputs, not risks or open questions.

Constraint: Slack relay belongs near the Hermes gateway because Slack auth, outbound post, inbound thread reply, and slash-command handling are in `gateway/platforms/slack.py`.

Constraint: no generic Hermes plugin polling API was found, so the relay has to be hybrid unless Hermes grows a routine API.

Constraint: Multica labels are ID-based, so every label operation needs lookup/create before applying `idea-queue` or `blocked-for-human`.

Constraint: Multica issue list label filtering was not found, so the design needs capped client-side filtering or implementation-time REST/API discovery.

Constraint: no saved board-view CLI/API surface was found. The locked decision still only requires the label plus saved view convention for v1 planning.

## 6. Open Questions

1. What exact Multica PAT scope should `hermes-multica` use for comment, assign, label, issue update, and squad operations?

2. When the maintainer answer is posted back to Multica, does that comment auto-wake the blocked leader, or should the relay explicitly re-dispatch the leader if no wake happens?

3. Should the watermark feeder read live `multica issue list` depth for v1, or is there a reliable cached depth signal that the research did not identify?

4. Should v1 require both `blocked-for-human` and `@orchestrator GATE:`, or should the label alone be treated as the relay signal?

5. Should the blocked gate relay be implemented as a Hermes gateway feature with plugin-owned tools, or should a separate gateway-adjacent daemon own the polling loop?

6. Which API, if any, creates or manages the saved Multica board view for the `idea-queue` convention?

## 7. Verification Strategy

The queue store can be verified with Python unit tests around schema parsing, creation, transitions, ordering, and malformed-file behavior.

The feeder needs integration-style tests around a fake Multica client so low-watermark behavior is proven without hitting the real workspace.

The label resolver needs tests for empty label list, existing label, create-if-missing, and ID-based attach.

The gate contract needs tests or fixtures that assert the exact comment prefix and blocked/label mutation sequence.

The Hermes plugin tools should be tested against mocked Multica CLI/REST calls.

The gateway relay needs a fake Slack adapter and fake Multica gate list so answer correlation can be exercised without live Slack.

Manual verification should cover one end-to-end sandbox path: seed an idea, reduce kanban depth below watermark, promote exactly one idea, post a GATE comment, relay to Slack, answer in thread, and observe the Multica answer comment plus resume behavior.

Because label filtering is client-side in the current design, test scan caps and pagination behavior with enough fake issues to show the relay stops at `max_issue_scan`.

Security verification should review PAT scope, Slack-to-Multica answer sanitization, and whether relay metadata leaks private Slack details.

VERIFICATION PLAN:
  Tools: pytest for Python queue/feeder/config tests; Hermes plugin unit tests with mocked PluginContext; fake Slack adapter tests for relay correlation.
  Platforms: local Hive repo; Multica workspace sandbox if available; Hermes gateway local/dev environment for relay smoke test.
  Automated: queue schema, state transitions, malformed YAML, config parsing, feeder watermark decisions, label resolution, gate candidate filtering, answer comment formatting.
  Manual: one seeded planning idea through promotion; one blocked GATE through Slack answer and Multica answer posting.
  Not verifying: production Slack delivery guarantees or large-scale Multica load testing in this slice, because the design scope is v1 workflow correctness with capped scans.

## 8. Scale Assessment

This is not a small isolated story. It touches local Hive state, Multica issue operations, label management, queue feeding, Hermes plugin registration, Hermes gateway polling, Slack relay behavior, and config.

It also crosses language boundaries: new B code is Python-primary, while useful Multica dispatch prior art is ESM.

The data migration burden is low because `planning-queue.yaml` is a new store. The integration risk is real because `hermes-multica` and the gateway relay are net-new.

The biggest unknowns are PAT scopes, wake/re-dispatch behavior, label/filter API limits, saved board-view management, and the exact gateway integration point.

I would call this **Large** for implementation planning. The queue store alone is small-to-medium, but the whole epic is multi-component and cross-service.

SCALE ASSESSMENT:
  Files affected: ~10-16 across Hive plus Hermes, depending on whether relay lands in gateway/run.py directly or behind a new module.
  Subsystems: planning queue store, config, Multica client/CLI, feeder, label management, gate contract, Hermes plugin tools, Hermes gateway watcher, Slack relay.
  Migration required: no existing data migration; yes for introducing a new state file and config keys.
  Cross-team coordination: yes, because Multica PAT scopes, Hermes gateway relay behavior, and maintainer Slack flow need agreement.
  Unknowns: 6 open questions.

  RECOMMENDATION: Needs structured outline
  RATIONALE: The locked decisions are clear, but implementation spans too many surfaces for direct story decomposition from this draft alone. A structured outline should split queue store, feeder, gate contract, plugin tools, gateway relay, and config/docs into separate slices with explicit integration order.
