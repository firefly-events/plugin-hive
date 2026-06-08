# Structured Outline - Planning Queue

## Part 1: Executive Summary

Hive is adding a v1 autonomous planning queue that stores rough ideas in a separate queue file, promotes them into Multica planning work when the active planning board gets thin, and provides a human-gate path that can pause a leader, relay a question to Slack through Hermes, and resume the leader after an answer.

The design is bound by the planning-queue gate decisions in `design-gate-decisions.md`. The relay is a Hermes gateway feature plus `hermes-multica` plugin tools. The visual surface is label-only for v1 through `idea-queue`; saved board-view automation is deferred. The implementation is Large scope and targets a minor version bump. The queue implementation is Python-primary, with a small Python Multica client rather than direct reliance on the ESM story dispatch helper.

The implementation strategy is six commit-worthy vertical slices from `vertical-plan.md`. Step 1 proves the local queue store and typed config. Step 2 adds the live watermark feeder and `idea-queue` label attachment. Step 3 defines the leader-side gate-elevation signal. Step 4 packages Multica operations as Hermes plugin tools. Step 5 adds the Hermes gateway relay loop, Slack answer correlation, `GATE ANSWER:` posting, and explicit leader re-dispatch. Step 6 closes with operator docs and tunable defaults.

The key architectural boundary is that each layer owns only its part of the workflow. `hive/lib/planning_queue/store.py` owns `<resolved_state_dir>/planning-queue.yaml`; `hive/lib/planning_queue/feeder.py` owns low-watermark promotion; the Python Multica client owns issue/comment/label/update operations; the leader gate helper owns the canonical blocked/GATE signal; the Hermes plugin owns tools; the Hermes gateway owns long-running polling and Slack relay. This preserves the locked hybrid relay decision and avoids implying a generic Hermes plugin polling API that research did not find.

Product goals:

- Success metrics: a maintainer can seed, inspect, reorder, and promote ideas locally; the feeder creates exactly one labeled Multica issue per default tick when depth is below watermark; a blocked human gate is machine-detectable only when both required signals exist; a Slack answer posts back as `GATE ANSWER:` and re-dispatches the leader once.
- Non-goals: Multica core UI changes, automatic saved board-view creation, a generic Hermes plugin routine API, cached kanban depth, production-scale load testing, or PAT scope narrowing beyond the workspace-scoped default.
- Stakeholders: Hive maintainers, planning leaders, Hermes gateway operators, and Multica workspace operators.

## Part 2: Detailed Approach

## Phase 1: Queue Store + Config + CLI Ops

**Goal:** A human can seed, inspect, reorder, and locally promote ideas in a separate planning queue file without touching Multica, Hermes, or Slack.

**Working-state assertion:** After this phase, `planning-queue.yaml` exists as the local source of truth, typed config resolves its path and defaults, and local queue operations are testable without any external service.

**Depends on:** No prior phase.

### Detailed Approach

1. Create the Python planning-queue package under `hive/lib/planning_queue/`.
   - Use `hive/lib/planning_queue/schema.py` for document and item types.
   - Use `hive/lib/planning_queue/store.py` for read/write/mutation operations.
   - Use `hive/lib/planning_queue/errors.py` for queue-specific errors.
   - Keep this separate from `.pHive/triage/queue.yaml`; the triage files `skills/triage/run.mjs` and `hive/references/triage-queue-schema.md` are implementation precedent only.

2. Implement the queue file contract.
   - Path is `<resolved_state_dir>/planning-queue.yaml`.
   - Default path is `.pHive/planning-queue.yaml` until the state-dir resolver is broadly shipped.
   - Resolve state dir using the contract in `hooks/common.sh`; if unavailable to Python code, use the same default semantics documented in `hive/references/state-relocation.md`.
   - Top-level YAML shape:

```yaml
version: 1
next_id: pq-001
items: []
```

3. Implement planning item fields exactly as the architect notes describe.
   - Required fields: `id`, `state`, `title`, `sketch`, `priority`, `source`, `added_at`, `promoted_at`, `promoted_issue_id`, `closed_reason`, `closed_at`, `state_history`.
   - `source` records at least `kind` and `ref`.
   - `state_history` records every state transition with timestamp.

4. Implement the local state machine.
   - `ready -> held`
   - `ready -> promoted`
   - `ready -> discarded`
   - `held -> ready`
   - `held -> discarded`
   - `promoted -> consumed`
   - `discarded -> ready` only by explicit restore.
   - `consumed` is terminal.

5. Implement store operations.
   - `read_queue(path: Path) -> PlanningQueueDocument`
   - `append_item(doc: PlanningQueueDocument, item: NewPlanningItem) -> PlanningQueueDocument`
   - `reorder_items(doc: PlanningQueueDocument, ordered_ids: list[str]) -> PlanningQueueDocument`
   - `promote_next(doc: PlanningQueueDocument, now: datetime) -> tuple[PlanningQueueDocument, PlanningQueueItem | None]`
   - `mark_consumed(doc: PlanningQueueDocument, item_id: str, issue_id: str, now: datetime) -> PlanningQueueDocument`

6. Preserve the single-writer posture.
   - Treat missing queue as empty and create on write.
   - Refuse to overwrite malformed YAML.
   - Reject duplicate IDs.
   - Reject schema version mismatch.
   - Reject invalid transitions.
   - Keep `next_id` monotonic with `pq-*` IDs.

7. Extend typed config in `hive/lib/config.py`.
   - Add `PlanningQueueConfig`.
   - Add a typed reader for `planning_queue`.
   - Avoid scattered ad hoc YAML reads.
   - Include defaults for path, watermark, consumption cap, labels, ready statuses, poll interval, and scan cap even though only the path and local CLI are exercised in this phase.

8. Add a local command surface.
   - Use `hive/bin/planning-queue` if the repository convention allows a Python executable.
   - Support seed/append, list, reorder, hold, discard, promote, and consume as local operations.
   - Keep CLI help text short and aligned with Step 1 scope.

### File Manifest

- Net-new `hive/lib/planning_queue/__init__.py` — package marker and stable imports.
- Net-new `hive/lib/planning_queue/schema.py` — queue document, item types, state enum, and validation helpers.
- Net-new `hive/lib/planning_queue/errors.py` — `QueueMissing`, `QueueMalformed`, `SchemaVersionMismatch`, `DuplicateId`, and `InvalidTransition`.
- Net-new `hive/lib/planning_queue/store.py` — queue read/write, append, reorder, promote, and consume operations.
- Net-new `hive/bin/planning-queue` — local human/test CLI for queue operations.
- Extends-existing `hive/lib/config.py` — add `PlanningQueueConfig` and typed `planning_queue` reader.
- Extends-existing `hive.config.yaml` — add example/default `planning_queue` block if config examples live there.
- Extends-existing `hive/hive.config.yaml` — mirror config example only if this file is the repo's canonical nested config sample.
- Net-new tests under the existing Python test tree, likely `tests/planning_queue/test_store.py` and `tests/planning_queue/test_config.py`.

### Risk Registry

| # | Risk | Severity | Likelihood | Mitigation |
|---|------|----------|------------|------------|
| 1 | Malformed YAML is overwritten by create-on-write behavior. | medium | medium | Separate `QueueMissing` from `QueueMalformed`; only missing queues are create-on-write. |
| 2 | State-dir resolution drifts from `hooks/common.sh`. | medium | medium | Centralize path resolution in the config reader and document the `.pHive/planning-queue.yaml` fallback. |
| 3 | Planning queue accidentally inherits triage lifecycle semantics. | medium | low | Keep schema/state machine in `hive/lib/planning_queue/schema.py`; use triage only as mechanics precedent. |
| 4 | Reorder mutates promoted or consumed items. | low | medium | Restrict `reorder_items` to `ready` and `held` IDs and test terminal-state preservation. |

### Interfaces and Contracts

```python
class PlanningQueueConfig:
    path: Path
    watermark: int
    consumption_cap_per_tick: int
    labels: PlanningQueueLabels
    multica: PlanningQueueMulticaConfig

def read_planning_queue_config(config_path: Path | None = None) -> PlanningQueueConfig: ...
```

```python
def read_queue(path: Path) -> PlanningQueueDocument: ...
def append_item(doc: PlanningQueueDocument, item: NewPlanningItem) -> PlanningQueueDocument: ...
def reorder_items(doc: PlanningQueueDocument, ordered_ids: list[str]) -> PlanningQueueDocument: ...
def promote_next(doc: PlanningQueueDocument, now: datetime) -> tuple[PlanningQueueDocument, PlanningQueueItem | None]: ...
def mark_consumed(doc: PlanningQueueDocument, item_id: str, issue_id: str, now: datetime) -> PlanningQueueDocument: ...
```

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

### Validation

- Unit test missing queue as empty/create-on-write.
- Unit test malformed queue refuses overwrite.
- Unit test append allocates monotonic `pq-*` IDs and records `state_history`.
- Unit test duplicate ID blocks mutation.
- Unit test invalid transitions fail.
- Unit test reorder affects only `ready` and `held` items.
- Manual: append two items, list them, reorder them, and promote the top item.

## Phase 2: Watermark Feeder

**Goal:** The queue auto-feeds the Multica planning board by promoting at most one ready idea when live ready/in-progress depth is below the configured watermark.

**Working-state assertion:** After this phase, a seeded local idea can become a Multica planning issue labeled `idea-queue`, and the queue records the promoted issue ID without duplicating work on later ticks.

**Depends on:** Phase 1.

### Detailed Approach

1. Add the Python Multica client surface.
   - Create `hive/lib/planning_queue/multica_client.py`.
   - Keep it Python-primary per the locked language direction.
   - Mirror timeout, JSON parsing, and structured error posture from `hive/lib/multica-story-dispatch/index.mjs` and `episode-sync.mjs`, without importing ESM as the default path.

2. Implement live kanban depth reads.
   - Use status-filtered `multica issue list --status <status> --output json` or equivalent REST.
   - Count configured statuses from `planning_queue.multica.ready_statuses`.
   - Respect `planning_queue.multica.max_issue_scan`.
   - Do not assume label server-side filtering exists; research found status filtering but no label filter.

3. Implement issue creation for promoted ideas.
   - Convert queue item `title` and `sketch` into a Multica issue title/description.
   - Preserve source and queue ID in the created issue body or metadata if the available API supports it.
   - Return a structured result containing the created issue ID.

4. Implement label resolution and attachment.
   - `resolve_or_create_label(name)` must handle an empty label list.
   - Label attachment must use label ID, not label name.
   - Use `planning_queue.labels.idea_queue`, default `idea-queue`.
   - Treat missing label-create support as setup failure.

5. Add `hive/lib/planning_queue/feeder.py`.
   - Implement `feed_if_below_watermark(config: PlanningQueueConfig, *, now: datetime) -> FeedResult`.
   - Read live depth.
   - If depth is at or above watermark, do nothing and report skipped reason.
   - If depth is below watermark, promote up to `consumption_cap_per_tick`, default `1`.
   - Create the Multica issue.
   - Apply `idea-queue`.
   - Mark the queue item consumed with `promoted_issue_id`.

6. Preserve idempotency.
   - Never create a duplicate issue for an item already `promoted` or `consumed`.
   - Mark consumed only after issue creation and label attachment succeed, unless the failure policy intentionally records partial promotion.
   - Return enough `FeedResult` detail for tests and operators to understand whether the tick promoted, skipped, or failed.

### File Manifest

- Net-new `hive/lib/planning_queue/multica_client.py` — Python Multica issue/list/comment/label/update client used by feeder and later gate helpers.
- Net-new `hive/lib/planning_queue/feeder.py` — watermark decision and one-pull-per-tick promotion flow.
- Extends-existing `hive/lib/planning_queue/store.py` — connect `promote_next` and `mark_consumed` to feeder flow.
- Extends-existing `hive/lib/config.py` — ensure watermark, cap, ready statuses, timeout, and scan cap are typed and defaulted.
- Net-new tests, likely `tests/planning_queue/test_multica_client.py` and `tests/planning_queue/test_feeder.py`.

### Risk Registry

| # | Risk | Severity | Likelihood | Mitigation |
|---|------|----------|------------|------------|
| 1 | Label attachment fails because Multica requires label ID. | high | medium | Implement `resolve_or_create_label(name)` before feeder attach; test empty-list and existing-label cases. |
| 2 | Label creation is unavailable. | high | medium | Return explicit setup failure; document manual provisioning as fallback. |
| 3 | Feeder creates duplicate issues under repeated ticks. | high | medium | Store state transition and promoted issue ID; fake-client tests must repeat ticks on same queue. |
| 4 | Live issue scan is unbounded. | medium | medium | Enforce `max_issue_scan` in the client. |
| 5 | Python client behavior diverges from ESM dispatch error posture. | medium | medium | Define structured errors, bounded timeout, strict JSON parsing, and redaction in `multica_client.py`. |

### Interfaces and Contracts

```python
class FeedResult:
    observed_depth: int
    watermark: int
    promoted_item_ids: list[str]
    created_issue_ids: list[str]
    skipped_reason: str | None
    errors: list[MulticaClientError]

def feed_if_below_watermark(config: PlanningQueueConfig, *, now: datetime) -> FeedResult: ...
```

```python
class MulticaClient:
    def list_issues(self, *, status: str, limit: int, offset: int = 0) -> IssueListResult: ...
    def create_issue(self, *, title: str, description: str, priority: str | None = None) -> IssueResult: ...
    def list_labels(self) -> list[LabelRef]: ...
    def create_label(self, name: str) -> LabelRef: ...
    def resolve_or_create_label(self, name: str) -> LabelRef: ...
    def add_label(self, issue_id: str, label_id: str) -> IssueResult: ...
```

### Validation

- Unit test with fake Multica client: no promotion when depth is at or above watermark.
- Unit test with fake Multica client: exactly one promotion when depth is below watermark and cap is `1`.
- Unit test no duplicate issue for an already promoted or consumed item.
- Unit test label resolver handles empty label list, existing label, and create-if-missing.
- Integration-style fake: issue creation records `promoted_issue_id` and `idea-queue` attach call.
- Manual sandbox if available: seed queue, lower Multica depth, run feeder, observe one created/labeled planning issue.

## Phase 3: Gate-Elevation Contract (Leader Side)

**Goal:** A planning leader can raise a human gate that is machine-detectable because the issue is blocked, labeled `blocked-for-human`, and contains a canonical `@orchestrator GATE:` question.

**Working-state assertion:** After this phase, leaders can produce a blocked issue candidate that later relay code can identify without Slack or Hermes automation.

**Depends on:** Phase 2.

### Detailed Approach

1. Encode the leader-side gate sequence.
   - Resolve or create `blocked-for-human`.
   - Post a comment beginning with exact prefix `@orchestrator GATE:`.
   - Set issue status to `blocked`.
   - Attach `blocked-for-human` by label ID.
   - Use config key `planning_queue.labels.blocked_for_human`, default `blocked-for-human`.

2. Define the GATE comment formatter.
   - Prefix: `@orchestrator GATE: <single concise question>`
   - Include `Context:` with one to five bullets.
   - Include `Needed by:` with agent or squad name.
   - Keep the question payload in the comment because the label alone does not carry context.

3. Define detection semantics.
   - Relay candidates must be `status=blocked`.
   - Relay candidates must have `blocked-for-human`.
   - Relay candidates must have the latest unresolved `@orchestrator GATE:` comment.
   - Blocked issues without both label and comment are ignored.

4. Define answer format even though the relay is implemented later.
   - Prefix: `GATE ANSWER:`
   - Body: maintainer answer.
   - Source line: Slack channel/thread timestamp.
   - Prefer posting to the original Multica thread when comment threading is available.

5. Extend Multica client operations as needed.
   - `post_comment(issue_id, content, parent_id=None)`
   - `update_issue(issue_id, status="blocked")`
   - `resolve_or_create_label("blocked-for-human")`
   - `add_label(issue_id, label_id)`
   - Comment thread targeting where available.

### File Manifest

- Net-new `hive/lib/planning_queue/gates.py` — gate comment formatter, answer formatter, and leader helper.
- Extends-existing `hive/lib/planning_queue/multica_client.py` — comment posting, status update, and label attach support.
- Extends-existing `hive/lib/config.py` — ensure blocked-for-human label default is available.
- Net-new tests, likely `tests/planning_queue/test_gates.py`.

### Risk Registry

| # | Risk | Severity | Likelihood | Mitigation |
|---|------|----------|------------|------------|
| 1 | Relay cannot detect gates because prefix varies. | high | medium | Unit test exact `@orchestrator GATE:` prefix; document canonical formatter. |
| 2 | Gate label attach fails by name. | high | medium | Reuse ID-based `resolve_or_create_label`. |
| 3 | Blocked issue lacks comment context. | medium | medium | Require context bullets and needed-by line in helper validation. |
| 4 | Comment thread targeting is unavailable. | medium | medium | Post top-level fallback while recording original GATE comment ID for later correlation if available. |

### Interfaces and Contracts

```python
def format_gate_comment(question: str, *, context: list[str], needed_by: str) -> str: ...
def format_gate_answer(answer: str, *, slack_channel: str, thread_ts: str) -> str: ...
def raise_gate(client: MulticaClient, issue_id: str, gate: GateRequest) -> GateRaiseResult: ...
```

```text
@orchestrator GATE: <single concise question>

Context:
- <constraint or fact>
- <constraint or fact>

Needed by:
<agent or squad name>
```

```text
GATE ANSWER:
<maintainer answer>

Source: Slack <channel>/<thread_ts>
```

### Validation

- Unit test generated GATE comment begins with exact prefix.
- Unit test helper performs comment, status, and label operations.
- Unit test missing label ID resolution fails explicitly.
- Fixture test blocked issue candidate contains both `blocked-for-human` and latest unresolved GATE comment.
- Manual sandbox if available: raise a gate and inspect Multica issue status, label, and comment.

## Phase 4: `hermes-multica` Plugin Tools

**Goal:** Hermes can drive Multica operations through tool calls for comments, issue updates, label resolution, label attachment, and blocked gate listing.

**Working-state assertion:** After this phase, Hermes has a tools-only Multica plugin that exposes the operations the gateway relay will need, without moving the long-running poll loop into PluginContext.

**Depends on:** Phase 3.

### Detailed Approach

1. Create the Hermes plugin files.
   - Add `/Users/don/Code/hermes-agent/plugins/multica/plugin.yaml`.
   - Add `/Users/don/Code/hermes-agent/plugins/multica/__init__.py`.
   - Add `/Users/don/Code/hermes-agent/plugins/multica/tools.py`.
   - Follow the tool plugin pattern from `/Users/don/Code/hermes-agent/plugins/spotify/plugin.yaml` and `/Users/don/Code/hermes-agent/plugins/spotify/__init__.py`.

2. Register tools through `register(ctx)`.
   - Use `ctx.register_tool(...)` from `/Users/don/Code/hermes-agent/hermes_cli/plugins.py`.
   - Keep schemas explicit.
   - Keep handlers structured and testable.

3. Implement tool surface.
   - `multica_post_comment(issue_id, content, parent_id=None)`
   - `multica_update_issue(issue_id, status=None, assignee_type=None, assignee_id=None)`
   - `multica_resolve_or_create_label(name)`
   - `multica_add_label(issue_id, label_name)`
   - `multica_list_blocked_gates(status="blocked", label_name="blocked-for-human", since=None)`

4. Mirror Python Multica semantics in plugin environment.
   - Use bounded timeouts.
   - Parse JSON strictly.
   - Redact PAT and Slack tokens from errors.
   - Return structured tool errors for missing label support, missing issue, malformed JSON, timeout, and forbidden scope.

5. Implement blocked gate listing.
   - Poll blocked issues.
   - Client-side filter for `blocked-for-human`, because research found no label filter in `issue list`.
   - Find latest unresolved `@orchestrator GATE:` comment.
   - Respect max scan.
   - Return `GateCandidate` records for the gateway relay.

6. Keep polling boundary explicit.
   - This phase does not create a long-running loop.
   - No `register_poll` or `register_routine` is implied.
   - Gateway relay remains Phase 5.

### File Manifest

- Net-new `/Users/don/Code/hermes-agent/plugins/multica/plugin.yaml` — Hermes plugin manifest.
- Net-new `/Users/don/Code/hermes-agent/plugins/multica/__init__.py` — `register(ctx)` entry point.
- Net-new `/Users/don/Code/hermes-agent/plugins/multica/tools.py` — Multica tool handlers and schemas.
- Net-new Hermes plugin tests, likely in Hermes test tree near existing plugin tests.
- Extends-existing shared helper only if Hermes already has a utility location for Multica client behavior; otherwise keep plugin-local.

### Risk Registry

| # | Risk | Severity | Likelihood | Mitigation |
|---|------|----------|------------|------------|
| 1 | Plugin suggests it owns long-running polling. | medium | medium | Manifest and docs call it tools-only; gateway relay remains separate. |
| 2 | Tool schema drifts from gateway needs. | medium | medium | Include `GateCandidate` fields required by Phase 5 correlation. |
| 3 | PAT or Slack token leaks through tool errors. | high | low | Redaction tests around structured error output. |
| 4 | Label scan misses candidates due to no server-side label filter. | medium | medium | Use status blocked plus capped client-side filtering and return scan metadata. |

### Interfaces and Contracts

```python
def register(ctx):
    ctx.register_tool("multica_post_comment", "multica", schema, handler, ...)
    ctx.register_tool("multica_update_issue", "multica", schema, handler, ...)
    ctx.register_tool("multica_resolve_or_create_label", "multica", schema, handler, ...)
    ctx.register_tool("multica_add_label", "multica", schema, handler, ...)
    ctx.register_tool("multica_list_blocked_gates", "multica", schema, handler, ...)
```

```python
class GateCandidate:
    issue_id: str
    issue_identifier: str | None
    gate_comment_id: str
    question: str
    context: list[str]
    needed_by: str
    labels: list[str]
    updated_at: datetime | None
```

### Validation

- Plugin unit test with mocked `PluginContext`: each tool registers with expected name and schema.
- Tool test fake client: post comment returns structured result.
- Tool test update issue handles status and assignment fields.
- Tool test resolve-or-create label handles empty label list.
- Tool test list-blocked-gates polls blocked issues, filters by label and GATE comment, and respects max scan.
- Manual Hermes dev check if available: plugin loads and tool list includes all five tools.

## Phase 5: Gateway Relay Loop

**Goal:** A blocked planning issue with `blocked-for-human` and `@orchestrator GATE:` is relayed to Slack, a Slack thread answer is posted back as `GATE ANSWER:`, and the planning leader is explicitly re-dispatched.

**Working-state assertion:** After this phase, the full asynchronous human gate path works end to end across Multica, Hermes gateway, Slack, answer correlation, and leader re-dispatch.

**Depends on:** Phase 4.

### Detailed Approach

1. Add gateway relay module.
   - Create `/Users/don/Code/hermes-agent/gateway/multica_gate_relay.py`.
   - Add a small `/Users/don/Code/hermes-agent/gateway/run.py` integration.
   - Follow gateway watcher and cron polling patterns identified in `gateway/run.py`.
   - Use Slack adapter behavior from `/Users/don/Code/hermes-agent/gateway/platforms/slack.py`.

2. Poll blocked/GATE candidates.
   - Use `multica_list_blocked_gates` or equivalent shared helper.
   - Respect poll interval and max scan config.
   - Require both label and GATE comment.
   - Ignore candidates already correlated and not answered.

3. Relay questions to Slack.
   - Use `SlackAdapter.send(chat_id, content, reply_to=None, metadata=None)`.
   - Send to configured Slack target.
   - Preserve Multica issue ID and GATE comment ID in metadata/correlation.
   - Keep the human question and context clear enough for a maintainer answer.

4. Persist correlation.
   - Multica issue ID.
   - Multica issue identifier when available.
   - GATE comment ID.
   - Slack channel.
   - Slack `thread_ts`.
   - Answer-posted status.
   - Leader dispatch/resume status.
   - Timestamps for relayed, answered, and resumed.

5. Detect Slack replies.
   - Use existing inbound Slack thread reply handling.
   - Match channel and `thread_ts` against correlation.
   - Treat the first accepted maintainer answer as the answer unless the gateway already has a richer policy.
   - Avoid reposting duplicate answers.

6. Post answer back to Multica.
   - Format with `GATE ANSWER:`.
   - Post to the original GATE thread where possible.
   - Include `Source: Slack <channel>/<thread_ts>`.
   - Mark correlation answered.

7. Explicitly re-dispatch the leader.
   - Do not assume comment posting wakes the blocked leader.
   - Use the locked fork default: relay explicitly re-dispatches the leader.
   - Mark correlation resumed/dispatched.
   - Ensure repeated polls do not dispatch twice.

### File Manifest

- Net-new `/Users/don/Code/hermes-agent/gateway/multica_gate_relay.py` — blocked/GATE poll, Slack relay, answer ingestion, Multica answer posting, leader re-dispatch.
- Extends-existing `/Users/don/Code/hermes-agent/gateway/run.py` — hook relay into gateway lifecycle/polling.
- Extends-existing `/Users/don/Code/hermes-agent/gateway/platforms/slack.py` only if existing inbound metadata handling needs a small adapter point.
- Extends-existing `/Users/don/Code/hermes-agent/plugins/multica/tools.py` — expose answer posting or blocked gate helper if needed.
- Net-new gateway tests for relay, correlation, answer, and re-dispatch.

### Risk Registry

| # | Risk | Severity | Likelihood | Mitigation |
|---|------|----------|------------|------------|
| 1 | Duplicate Slack threads for same gate. | high | medium | Correlation store keyed by issue ID + GATE comment ID before send. |
| 2 | Slack answer posts to wrong Multica issue. | high | low | Correlation must include channel/thread, issue ID, and GATE comment ID. |
| 3 | Leader resumes more than once. | high | medium | Track answer-posted and resumed status; test repeated poll/reply cycles. |
| 4 | Gateway misses gates due to scan cap. | medium | medium | Expose max scan as tunable and report skipped/scan metadata. |
| 5 | Secrets leak in Slack or Multica errors. | high | low | Reuse redaction posture and test errors. |
| 6 | Slack credentials unavailable for manual verification. | medium | medium | Land fake-adapter tests; mark live Slack smoke as environment-dependent. |

### Interfaces and Contracts

```python
class GateCorrelation:
    issue_id: str
    issue_identifier: str | None
    gate_comment_id: str
    slack_channel: str
    slack_thread_ts: str
    relayed_at: datetime
    answer_posted_at: datetime | None
    leader_dispatched_at: datetime | None
```

```python
def poll_and_relay_gates(config: RelayConfig, *, now: datetime) -> RelayPollResult: ...
def handle_slack_thread_reply(event: SlackMessageEvent) -> GateAnswerResult: ...
def post_gate_answer(candidate: GateCorrelation, answer: str) -> MulticaCommentResult: ...
def redispatch_leader(issue_id: str, correlation: GateCorrelation) -> DispatchResult: ...
```

### Validation

- Unit test fake Multica blocked gate list and fake Slack adapter: first poll sends one Slack thread.
- Unit test repeated poll does not duplicate an already-correlated gate.
- Unit test Slack thread reply posts one `GATE ANSWER:` comment.
- Unit test answer flow re-dispatches the leader exactly once.
- Unit test candidate scan stops at max scan.
- Manual sandbox if available: raise gate, observe Slack relay, answer in Slack thread, observe Multica answer comment and leader resume.

## Phase 6: Docs + Tunables Polish

**Goal:** Maintainers and operators can configure, run, verify, and troubleshoot the planning queue, feeder, gate contract, Hermes tools, and Slack relay using repository docs.

**Working-state assertion:** After this phase, the v1 planning queue is operator-ready, the docs match implemented defaults, and deferred board-view/core UI items are stated without ambiguity.

**Depends on:** Phase 5.

### Detailed Approach

1. Update the README quick start.
   - Show seed/list/reorder/promote basics.
   - Show feeder invocation.
   - Show the `planning_queue` config block.
   - State that `idea-queue` is label-only v1.

2. Update `docs/operations-guide.md`.
   - Explain operator workflow for queue seeding.
   - Explain watermark feeding.
   - Explain label setup and ID-based attach risk.
   - Explain human gate workflow.
   - Explain Slack relay and leader re-dispatch.
   - Explain troubleshooting for capped scans, missing labels, PAT scope, and Slack correlation.

3. Document exact config defaults.
   - `planning_queue.path: null`
   - `planning_queue.watermark: 3`
   - `planning_queue.consumption_cap_per_tick: 1`
   - `planning_queue.labels.idea_queue: idea-queue`
   - `planning_queue.labels.blocked_for_human: blocked-for-human`
   - `planning_queue.multica.ready_statuses: [ready, in_progress]`
   - `planning_queue.multica.poll_interval_seconds: 5`
   - `planning_queue.multica.max_issue_scan: 200`

4. Document exact gate strings.
   - Required label: `blocked-for-human`
   - Required comment prefix: `@orchestrator GATE:`
   - Answer prefix: `GATE ANSWER:`

5. Document v1 limits.
   - Saved board-view automation deferred.
   - No Multica core UI change.
   - No generic Hermes plugin polling API.
   - No cached kanban depth optimization.
   - No production-scale load testing.
   - Workspace-scoped PAT default remains until scope docs/API are confirmed.

6. Confirm docs against implementation.
   - Match actual command names.
   - Match config keys.
   - Match labels.
   - Match status names.
   - Match relay behavior.

### File Manifest

- Extends-existing `README.md` — planning queue quick start and feeder basics.
- Extends-existing `docs/operations-guide.md` — planning queue operations, gate workflow, relay troubleshooting, and tunables.
- Extends-existing `hive.config.yaml` — final example config if this file is used for root docs.
- Extends-existing `hive/hive.config.yaml` — final example config if this file is used for packaged docs.
- Extends-existing `.pHive/epics/planning-queue/docs/*` only if final planning docs need a pointer to implementation docs.

### Risk Registry

| # | Risk | Severity | Likelihood | Mitigation |
|---|------|----------|------------|------------|
| 1 | Docs imply saved board-view automation exists. | medium | medium | Explicitly state label-only v1 and deferred saved board-view automation. |
| 2 | Docs drift from actual config defaults. | medium | medium | Review docs after implementation and use exact keys from code. |
| 3 | Operators miss PAT/label setup requirements. | medium | medium | Include troubleshooting entries for workspace-scoped PAT and label creation. |
| 4 | Gate examples use noncanonical prefixes. | medium | low | Copy exact strings from `gates.py` tests. |

### Interfaces and Contracts

Docs must publish the same contracts already defined in code:

- `planning-queue.yaml` schema.
- `PlanningQueueConfig` defaults.
- Feeder one-pull-per-tick behavior.
- Multica label ID resolution requirement.
- `@orchestrator GATE:` comment format.
- `GATE ANSWER:` comment format.
- Hermes plugin tool names.
- Gateway relay correlation fields.

### Validation

- Documentation review: README and operations guide use exact config keys.
- Documentation review: examples use `idea-queue`, `blocked-for-human`, `@orchestrator GATE:`, and `GATE ANSWER:`.
- Smoke test: follow quick start in sandbox/local environment through seed and feed.
- Smoke test: follow gate workflow in sandbox if Slack/Hermes credentials are available.

## Part 3: Verification Plan

Phase 1 verification:

- Automated: queue schema parsing, missing queue, malformed queue, monotonic IDs, state history, reorder limits, invalid transitions.
- Manual: append two ideas, list, reorder, promote top item.
- Tools: pytest and local `hive/bin/planning-queue`.
- Platforms: local Hive checkout.

Phase 2 verification:

- Automated: fake Multica client depth at/above watermark, below watermark, cap `1`, duplicate prevention, label resolution, issue creation and label attach.
- Manual: sandbox feeder run creates one labeled issue when depth is below watermark.
- Tools: pytest, fake Multica client, optional Multica sandbox.
- Platforms: local Hive checkout and Multica workspace sandbox if available.

Phase 3 verification:

- Automated: exact GATE prefix, required context/needed-by validation, blocked status update, label attach, answer formatter.
- Manual: create blocked gate candidate and inspect status/label/comment.
- Tools: pytest, optional Multica sandbox.
- Platforms: local Hive checkout and Multica workspace sandbox if available.

Phase 4 verification:

- Automated: mocked PluginContext registration, tool schema validation, fake client tool results, blocked gate filtering, scan cap.
- Manual: Hermes dev plugin load and tool list check if available.
- Tools: Hermes plugin tests, pytest or existing Hermes test harness.
- Platforms: Hermes local/dev environment.

Phase 5 verification:

- Automated: fake Multica blocked gate list, fake Slack adapter, correlation dedupe, answer posting, leader re-dispatch exactly once, scan cap.
- Manual: raise gate, observe Slack relay, answer in thread, observe `GATE ANSWER:` and leader resume.
- Tools: gateway unit tests, fake Slack adapter, optional live Slack sandbox.
- Platforms: Hermes gateway local/dev environment and Multica sandbox.

Phase 6 verification:

- Automated: no specific automated test required beyond possible doc link/config example checks.
- Manual: follow README quick start; follow operations guide gate workflow; confirm docs do not imply board-view automation.
- Tools: documentation review, local smoke commands.
- Platforms: local Hive checkout, optional Multica/Hermes/Slack sandbox.

Verification coverage matrix:

| Acceptance Criterion | Test Type | Tool | Phase |
|---------------------|-----------|------|-------|
| Separate queue file works locally | Unit + manual | pytest + CLI | 1 |
| Typed config resolves queue path/defaults | Unit | pytest | 1 |
| Feeder promotes only below watermark | Unit | pytest fake client | 2 |
| Feeder applies `idea-queue` by ID | Unit + fake integration | pytest fake client | 2 |
| Gate requires blocked status, label, and comment | Unit + fixture | pytest | 3 |
| Hermes registers five Multica tools | Unit | Hermes plugin test harness | 4 |
| Blocked gate listing filters client-side | Unit | fake Multica client | 4 |
| Slack relay deduplicates gate threads | Unit | fake Slack adapter | 5 |
| Slack answer posts `GATE ANSWER:` | Unit + manual | gateway tests + sandbox | 5 |
| Leader re-dispatch happens once | Unit | gateway tests | 5 |
| Docs match final defaults | Manual review | docs review | 6 |

What's not being verified:

- Production-scale Multica load testing, because v1 relies on capped scans and the plan explicitly excludes production load audit.
- Automatic saved board-view creation, because G2 defers it and no Multica API was found.
- Generic Hermes plugin polling, because G1 assigns long-running relay to the gateway.
- PAT scope minimization beyond workspace-scoped default, because exact scope names were not provided by research.

## Part 3b: Cross-Cutting Concerns

Error handling strategy:

- Queue errors are explicit and local: missing, malformed, version mismatch, duplicate ID, invalid transition.
- Multica client errors are structured and redacted: timeout, malformed JSON, forbidden scope, missing issue, missing label support.
- Feeder returns skipped reasons and errors rather than silently doing nothing.
- Relay records correlation state before sending Slack messages to prevent duplicate side effects.

Migration plan:

- No existing queue data migration is required because `planning-queue.yaml` is net-new.
- The queue file is created on first write.
- Config defaults allow existing installs to run without immediate YAML edits.

Rollback plan:

- Phase 1 rollback removes local queue package/CLI/config reader changes and leaves no external side effects unless a queue file was manually written.
- Phase 2 rollback disables feeder invocation and stops new Multica issue promotion; existing promoted issues remain normal Multica issues.
- Phase 3 rollback stops use of the helper; any existing blocked/GATE comments remain human-readable.
- Phase 4 rollback disables Hermes Multica tools.
- Phase 5 rollback disables gateway relay hook; blocked issues remain visible in Multica.
- Phase 6 rollback is documentation-only.

Performance implications:

- Feeder and relay use live issue scans; scan caps are mandatory.
- No cached kanban depth source is used in v1.
- Poll interval defaults to 5 seconds, but operators can tune it.
- Client-side label filtering is acceptable for v1 only because max scan bounds work.

Documentation impact:

- README needs quick start coverage.
- `docs/operations-guide.md` needs operator workflow and troubleshooting.
- Config examples must include `planning_queue`.
- Planning docs should remain aligned with G1-G4 and not reopen decisions.

Security considerations:

- Workspace-scoped PAT is the locked default for comment, assign, label, issue update, and issue mutation.
- PAT and Slack tokens must be redacted in all errors.
- Slack-to-Multica answer content should be posted as maintainer answer text, not executed as commands.
- Correlation metadata should not leak sensitive Slack details beyond the source line required by the answer format.

## Part 4: File Manifest Summary

Create:

- `hive/lib/planning_queue/__init__.py` — package marker and stable imports.
- `hive/lib/planning_queue/schema.py` — planning queue document and item schema.
- `hive/lib/planning_queue/errors.py` — queue-specific error classes.
- `hive/lib/planning_queue/store.py` — queue read/write and state mutation operations.
- `hive/lib/planning_queue/multica_client.py` — Python Multica client for issue, comment, label, and status operations.
- `hive/lib/planning_queue/feeder.py` — watermark feeder service.
- `hive/lib/planning_queue/gates.py` — GATE and GATE ANSWER formatters plus leader helper.
- `hive/bin/planning-queue` — local CLI for queue operations.
- `/Users/don/Code/hermes-agent/plugins/multica/plugin.yaml` — Hermes Multica plugin manifest.
- `/Users/don/Code/hermes-agent/plugins/multica/__init__.py` — plugin registration entry point.
- `/Users/don/Code/hermes-agent/plugins/multica/tools.py` — Multica tool handlers and schemas.
- `/Users/don/Code/hermes-agent/gateway/multica_gate_relay.py` — gateway relay loop and correlation behavior.
- Python tests under the existing test tree for store, config, client, feeder, gates, and Hermes/gateway behavior.

Modify:

- `hive/lib/config.py` — typed `PlanningQueueConfig` and `planning_queue` reader.
- `hive.config.yaml` — example/default planning queue config if this is the canonical root config sample.
- `hive/hive.config.yaml` — example/default planning queue config if this is the packaged config sample.
- `/Users/don/Code/hermes-agent/gateway/run.py` — hook Multica gate relay into gateway lifecycle/polling.
- `/Users/don/Code/hermes-agent/gateway/platforms/slack.py` — only if a small adapter point is required for correlated thread replies.
- `README.md` — planning queue quick start.
- `docs/operations-guide.md` — planning queue operator guide.

Unchanged but affected:

- `skills/triage/run.mjs` — mechanics precedent only; no lifecycle reuse.
- `hive/references/triage-queue-schema.md` — schema precedent only.
- `hive/lib/multica-story-dispatch/index.mjs` — timeout/error/REST precedent only.
- `hive/lib/multica-story-dispatch/episode-sync.mjs` — polling and episode precedent only.
- `hooks/common.sh` — state-dir resolver contract consumed by config/path logic.
- `/Users/don/Code/hermes-agent/hermes_cli/plugins.py` — plugin registration contract consumed by `hermes-multica`.
- `/Users/don/Code/hermes-agent/plugins/spotify/*` — tool plugin pattern.
- `/Users/don/Code/hermes-agent/plugins/teams_pipeline/*` — secondary tool plugin pattern.

Delete:

- None.

## Part 5: Risk Registry

| # | Risk | Severity | Likelihood | Mitigation | Owner |
|---|------|----------|------------|------------|-------|
| 1 | Malformed queue YAML is overwritten. | medium | medium | Treat malformed separately from missing and refuse overwrite. | Phase 1 |
| 2 | State-dir path resolution drifts from `hooks/common.sh`. | medium | medium | Centralize path resolution and default to `.pHive/planning-queue.yaml`. | Phase 1 |
| 3 | Label operations fail because labels are ID-based. | high | medium | Implement `resolve_or_create_label(name)` and attach by ID. | Phase 2 |
| 4 | Label creation is not available in the actual Multica surface. | high | medium | Return explicit setup failure and document manual label provisioning. | Phase 2 |
| 5 | Feeder promotes duplicate issues under repeated or concurrent ticks. | high | medium | State transitions, consumed markers, fake repeated-tick tests, and one-pull cap. | Phase 2 |
| 6 | Gate candidates are missed due to noncanonical comment prefix. | high | medium | Canonical formatter and exact-prefix tests. | Phase 3 |
| 7 | Blocked issues without human gates are relayed. | medium | medium | Require both `blocked-for-human` and `@orchestrator GATE:`. | Phase 3/5 |
| 8 | Hermes plugin is mistaken for a long-running poller. | medium | medium | Keep plugin tools-only and gateway-owned relay explicit. | Phase 4 |
| 9 | Client-side label filtering misses gates because scan cap is too low. | medium | medium | Configurable max scan and scan metadata in results. | Phase 4/5 |
| 10 | Slack answer maps to wrong Multica thread. | high | low | Persist issue ID, GATE comment ID, Slack channel, and Slack thread timestamp. | Phase 5 |
| 11 | Leader is re-dispatched multiple times. | high | medium | Correlation status tracks answered/resumed; repeated reply tests. | Phase 5 |
| 12 | Docs imply deferred board-view automation exists. | medium | medium | State label-only v1 in README and operations guide. | Phase 6 |

High-severity mitigation details:

- Label ID risk: the client must never call label attach with the display name. It first lists labels, creates if needed, caches the returned ID where appropriate, and passes the ID to attachment. Empty label-list behavior is a required test case.
- Duplicate promotion risk: queue mutation and issue creation must be ordered so that repeated ticks cannot create two issues for the same queue item. Tests should run `feed_if_below_watermark` twice on the same queue and verify only one created issue.
- Slack correlation risk: correlation must be keyed before answer handling and include both Multica and Slack identifiers. A thread reply without a matching correlation is ignored or logged, not posted to Multica.
- Re-dispatch risk: leader dispatch must be idempotent per correlation. Once `leader_dispatched_at` is set, repeated polls or repeated Slack events do not dispatch again.

## Part 6: Dependency Map

Internal dependencies:

- Phase 2 depends on Phase 1 because feeder uses queue store, item state machine, typed config, and local path resolution.
- Phase 3 depends on Phase 2 because the Multica client label/comment/status surface exists by then.
- Phase 4 depends on Phase 3 because tool schemas need the blocked/GATE detection and answer contracts.
- Phase 5 depends on Phase 4 because gateway relay needs Multica tools or equivalent helpers and gate candidate shape.
- Phase 6 depends on all prior phases because docs must match implemented commands, config, labels, defaults, and relay behavior.

Layer dependencies:

- Queue store depends on config for resolved path.
- Config feeds queue store, feeder, gate helper, plugin tools, and gateway relay.
- Multica client feeds feeder, gate contract, plugin tools, and gateway relay.
- Watermark feeder depends on queue store and Multica client.
- Gate contract depends on Multica comments, labels, and status mutation.
- Hermes plugin depends on Multica client semantics and gate detection.
- Gateway relay depends on Hermes plugin/shared helpers, Slack adapter, gate contract, and Multica answer posting.
- Docs depend on all other layers.

External dependencies:

- Multica CLI/API issue listing, issue creation, comment posting, status update, assignment/re-dispatch, label list/create, and label attach.
- Hermes plugin system through `PluginContext.register_tool(...)`.
- Hermes gateway polling/run loop.
- Slack adapter in `gateway/platforms/slack.py`.
- Workspace-scoped Multica PAT.
- Slack bot/app tokens in the Hermes gateway environment.
- PyYAML for YAML parsing where Python config/store use YAML.

Blocking questions:

- None block the planned v1 because gate decisions bind the previously open forks.
- Exact PAT scopes remain unknown, but the default is workspace-scoped PAT.
- Saved board-view automation remains unavailable and explicitly deferred.
- Server-side label filtering remains unavailable in the researched CLI and is handled by capped client-side filtering.

## Part 7: Elicitation - Stress-Testing This Plan

### Why Won't This Work?

1. Failure: label creation or label attachment fails before feeder/gate can work.
   - Trigger: Multica only accepts label IDs and the workspace starts with no `idea-queue` or `blocked-for-human` labels.
   - Impact: feeder cannot mark promoted issues; relay cannot detect gates.
   - Signal: fake-client and sandbox tests fail during `resolve_or_create_label`.
   - Our answer: make label resolution a first-class client API, test empty label lists, and treat missing create support as setup failure rather than silent success.

2. Failure: the feeder promotes the same idea twice.
   - Trigger: concurrent ticks or retry after partial issue creation.
   - Impact: duplicate planning issues pollute Multica and the queue state loses trust.
   - Signal: repeated fake-client tests show multiple issue creation calls for one queue ID.
   - Our answer: default cap is one, item state moves through promoted/consumed, and `promoted_issue_id` is recorded. If concurrency is possible in implementation, add file locking or atomic write discipline matching the single-writer posture.

3. Failure: the relay misses a valid blocked gate.
   - Trigger: no label server-side filter, too-low scan cap, or GATE comment hidden in older comments.
   - Impact: leader stays blocked and maintainer never sees the Slack question.
   - Signal: gate fixture appears in fake issue list but not returned by `multica_list_blocked_gates`.
   - Our answer: poll `status=blocked`, client-side filter labels/comments, respect but expose scan cap, and test candidate ordering/comment resolution.

4. Failure: Slack answer resumes the wrong leader or issue.
   - Trigger: correlation uses only Slack thread or only issue ID.
   - Impact: wrong task receives a maintainer answer or re-dispatch.
   - Signal: fake relay tests with two simultaneous gates cross-wire answers.
   - Our answer: correlation stores Multica issue ID, GATE comment ID, Slack channel, and thread timestamp; answer handling ignores unmatched replies.

5. Failure: Hermes plugin cannot run the relay.
   - Trigger: implementer tries to use nonexistent `register_poll` or `register_routine`.
   - Impact: long-running gate relay never starts.
   - Signal: plugin tests pass but no gateway process polls.
   - Our answer: G1 locks the hybrid: plugin tools in Phase 4, gateway relay in Phase 5.

### What Assumptions Are We Making?

- VERIFIED: The planning queue is separate from triage. Source: `design-gate-decisions.md` D2 and `vertical-plan.md` Step 1.
- VERIFIED: V1 visual surface is label-only through `idea-queue`; saved board-view is deferred. Source: `design-gate-decisions.md` G2.
- VERIFIED: Relay is Hermes gateway feature plus plugin tools. Source: `design-gate-decisions.md` G1.
- VERIFIED: Watermark source is live issue-list depth with capped scan. Source: `design-gate-decisions.md` fork defaults.
- VERIFIED: Gate requires both `blocked-for-human` label and `@orchestrator GATE:` comment. Source: `design-gate-decisions.md` fork defaults.
- VERIFIED: Python-primary queue code and small Python Multica client are required. Source: issue brief and `architect-notes.md`.
- VERIFIED: No generic Hermes plugin polling API was found. Source: `research-brief.md` and `architect-notes.md`.
- VERIFIED: Label attachment is ID-based and no label filter was found in CLI. Source: `research-brief.md`.
- ASSUMED: A Python test tree exists or can be extended for planning queue tests. Reason: the plan requires Python-primary modules and pytest is named in verification strategy.
- ASSUMED: Hermes repository changes can be made at `/Users/don/Code/hermes-agent/...`. Reason: source docs name absolute Hermes paths as implementation surfaces.
- ASSUMED: Multica issue creation can accept title/description/priority sufficient for planning ideas. Reason: CLI/API mutation support was found, but exact body mapping is not fully specified.
- RISKY: Label-create support may be absent. If wrong, Phase 2 needs a manual label provisioning setup step.
- RISKY: Slack credentials may be unavailable in dev. If wrong, Phase 5 lands with fake-adapter tests and marks live smoke environment-blocked.

### What's the Simplest Version?

Must have:

- Separate `planning-queue.yaml`, because queue separation is locked.
- Local append/list/reorder/promote, because Step 1 working state depends on human local operation.
- Typed `planning_queue` config, because every later layer depends on shared defaults.
- Live watermark feeder with one-pull-per-tick, because it is the consumption mechanism.
- `idea-queue` label attachment, because label-only v1 is the visual surface.
- Both gate signals, because relay detection requires label plus question payload.
- Hermes Multica tools and gateway relay, because G1 locks the hybrid architecture.
- `GATE ANSWER:` and explicit leader re-dispatch, because fork defaults bind answer routing and resume.

Should have:

- Local CLI help text, because it makes Step 1 usable.
- Structured `FeedResult`, because it improves testability and operator diagnosis.
- Scan metadata in blocked gate listing, because label filtering is client-side.
- Correlation timestamps, because they prevent duplicate sends/resumes.
- README and operations guide coverage, because operators need exact labels, prefixes, and config keys.

Could cut:

- Saved board-view automation, already deferred by G2.
- Production-scale load tests, explicitly outside v1.
- Cached kanban depth optimization, deferred by fork default.
- Generic plugin routine API, not present in researched Hermes.
- PAT scope narrowing, deferred until exact scope names are known.

### What Will We Wish We Had Thought Of?

- We may wish the Python Multica client had a clearer shared package boundary. It starts inside `hive/lib/planning_queue` because this epic owns the need; if other Hive features adopt it, it can move later.
- We may wish label filtering existed server-side. The plan keeps max scan configurable and isolates filtering in client/plugin helpers so replacement is localized.
- We may wish Slack answer approval had a richer policy. V1 treats thread reply correlation as enough because the maintainer flow is the target and exact auth policy is not provided.
- We may wish the saved board view existed. G2 explicitly defers it, so docs must be strict about label-only v1.
- We may wish state-dir resolver adoption were complete. The plan targets the resolved path but preserves `.pHive/planning-queue.yaml` fallback.

### Where Are We Over-Engineering?

- The typed config reader may look heavy for one queue path, but feeder, gate, plugin, and relay all need the same defaults. Centralizing it prevents drift.
- The Python Multica client may look like duplication of ESM dispatch helpers, but the implementation is Python-primary and the existing helper is story-dispatch oriented.
- Correlation storage may look heavy for one Slack thread, but without it the relay cannot safely post answers or avoid duplicate leader re-dispatch.
- `resolve_or_create_label` may look like setup code, but label attachment is ID-based and label list was empty in research.
- Client-side blocked gate filtering is not ideal, but no server-side label filter was found and scan caps make v1 bounded.

### Hard Questions and Answers

1. What if a label-create race double-creates `idea-queue`?
   - Answer: `resolve_or_create_label` should list first, attempt create, then list again or handle conflict if the API returns one. The returned label ID is the only value used for attach. If the API cannot de-duplicate, the setup guide should require manual label provisioning.

2. What happens if a `GATE ANSWER:` arrives after the leader task was garbage collected?
   - Answer: Phase 5 still posts the answer to Multica, records `answer_posted_at`, then attempts explicit re-dispatch. If re-dispatch fails, the correlation remains answered but not resumed, giving operators a visible retry/escalation state.

3. How does the feeder avoid promoting the same idea twice under concurrent ticks?
   - Answer: The store must preserve single-writer semantics. If implementation has concurrent invocations, add atomic file writes or a lock around read/promote/write. Tests should cover repeated ticks; concurrency locking is added if the runtime permits simultaneous feeder executions.

4. What if `multica issue list` cannot return labels in its JSON payload?
   - Answer: The blocked gate listing helper must fetch labels per issue or use a REST surface if available. If no label read is possible, Phase 4/5 cannot satisfy the both-signal contract and should stop as setup/API-blocked rather than degrade to comment-only.

5. What if a blocked issue has multiple unresolved `@orchestrator GATE:` comments?
   - Answer: The relay uses the latest unresolved gate comment and keys correlation by issue ID plus gate comment ID. Older gates are not overwritten unless their correlation is still active; this prevents answering an obsolete question.

6. What if Slack thread replies include chatter before the actual answer?
   - Answer: The source docs do not provide an approval policy. V1 should either treat the first maintainer reply as the answer or require a simple answer marker in the gateway policy. If the implementation cannot identify maintainers, document the limitation and keep fake tests aligned with the chosen policy.

7. What if the live watermark scan returns stale or partial data?
   - Answer: The fork default chooses live `issue list` depth with capped scan. `FeedResult` should report observed depth and max scan. If the scan is partial due to cap, the feeder should avoid over-promoting unless implementation can prove enough depth data was observed.

8. What if the maintainer wants prefixed labels like `hive:idea-queue`?
   - Answer: The locked defaults are unprefixed `idea-queue` and `blocked-for-human`, but config makes labels replaceable. The default names are not reopened; operators can override if the workspace convention requires it.

9. What if posting the Multica answer comment already wakes the leader?
   - Answer: The locked default says the relay explicitly re-dispatches the leader. If auto-wake also happens, idempotency must prevent duplicate leader work. The relay should track explicit dispatch and implementation should test repeated events.

10. What if saved board-view automation becomes available midway through implementation?
   - Answer: Do not add it to v1 unless the maintainer changes G2. The outline treats board-view automation as deferred; discovering an API only creates a future option.

## Part 8: Decision Points for Sign-Off

DECISIONS REQUIRING SIGN-OFF:

1. [AFFIRM] Six-slice implementation order — Queue/config, feeder, gate contract, Hermes tools, gateway relay, docs. This matches the vertical plan and preserves working states after every phase.
   - Affirm / Change direction

2. [AFFIRM] Python-primary queue and Multica client — new `hive/lib/planning_queue/*` modules with ESM dispatch code used as precedent only. This is locked by the issue brief and architect notes.
   - Affirm / Change direction

3. [AFFIRM] Label-only visual v1 — `idea-queue` label only; saved board-view automation deferred. This is locked by G2.
   - Affirm / Change direction

4. [AFFIRM] Both-signal gate detection — require `blocked-for-human` label plus `@orchestrator GATE:` comment. This is locked by fork defaults and is necessary for reliable relay plus question payload.
   - Affirm / Change direction

5. [AFFIRM] Gateway-owned relay — `hermes-multica` provides tools, while `/Users/don/Code/hermes-agent/gateway/multica_gate_relay.py` owns polling and Slack correlation. This is locked by G1 and research found no generic plugin polling API.
   - Affirm / Change direction

6. [AFFIRM] Workspace-scoped PAT for v1 — use workspace-scoped token for comment, assign, label, issue update, and issue mutation until exact scope names are confirmed.
   - Affirm / Change direction

No additional design decisions remain genuinely open after G1-G4 and fork defaults. Remaining uncertainties are implementation checks or environment availability items, not planning decisions.
