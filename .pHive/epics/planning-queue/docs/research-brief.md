# Research brief - planning-queue epic

## Summary

The research covered the eight planning-queue surfaces requested for Cluster B: the existing triage queue, Multica dispatch and CLI seams, Hermes plugin and Slack relay patterns, state-dir resolution, configuration tunables, and label/board conventions. The headline finding is that the locked design is viable as a separate `planning-queue.yaml` plus Multica/Hermes glue, but several parts are net-new: planning queue schema and operations, label ID resolution, blocked/GATE polling, and the `hermes-multica` routine surface. The four maintainer-locked decisions remain inputs, not risks: separate `planning-queue.yaml`, `idea-queue` label plus saved board view, event-driven watermark, and `hermes-multica` plugin.

## Key files & surfaces

- Surface 1 / Triage queue: `hive/references/triage-queue-schema.md:7-91` defines the existing triage schema, and `skills/triage/run.mjs:20-28,138-158,430-463` implements the single-writer queue mechanics. Reuse the mechanics, not the lifecycle semantics, because planning ideas need their own schema, statuses, reorder/promote operations, and state-dir path.
- Surface 2 / Multica dispatch infra: `hive/lib/multica-story-dispatch/index.mjs:42-95,239-390,466-470` contains the direct REST helper and `dispatchStoryToPersonas(...)`; `hive/lib/multica-story-dispatch/episode-sync.mjs:37-80,127-210,291-352` contains task polling and episode marker writing. These are reuse seams for feeder dispatch and relay resume flows.
- Surface 3 / Multica CLI surfaces: `multica issue list --help` supports status, priority, assignee, assignee-id, project, limit, and offset filters, with JSON shape `{has_more, issues, limit, offset, total}`. `multica issue update`, `issue status`, `issue assign`, `issue comment add`, and `issue label add/remove` cover mutation; label attachment requires a label ID, and `multica label list --output json` returned `[]`.
- Surface 4 / Hermes plugin template: `/Users/don/Code/hermes-agent/plugins/kanban/dashboard/manifest.json:1-14` provides the kanban dashboard manifest shape, while `/Users/don/Code/hermes-agent/hermes_cli/plugins.py:1-31,55-65,230-267,287-355,645-700` documents directory plugin discovery and `PluginContext` registration APIs. Tool plugin examples are `/Users/don/Code/hermes-agent/plugins/spotify/plugin.yaml:1-13`, `/Users/don/Code/hermes-agent/plugins/spotify/__init__.py:56-66`, `/Users/don/Code/hermes-agent/plugins/teams_pipeline/plugin.yaml:1-9`, and `/Users/don/Code/hermes-agent/plugins/teams_pipeline/__init__.py:12-23`.
- Surface 4 / Hermes routine pattern: `/Users/don/Code/hermes-agent/gateway/run.py:4495-4750,4994-5400,17654-17745,18097-18119` shows gateway-owned kanban notifier, dispatcher, and cron polling patterns. No generic plugin `register_routine` or `register_poll` API was found in the inspected `PluginContext`.
- Surface 5 / Hermes Slack relay: `/Users/don/Code/hermes-agent/gateway/platforms/slack.py:1-9,21-25,289-350,506-690,758-830,1767-2238,2580-2643,2757-2841` owns Slack auth, outbound posts, inbound thread reply ingest, thread context fetch, and slash command handling. Slack uses `SLACK_BOT_TOKEN` for API calls and `SLACK_APP_TOKEN` for Socket Mode.
- Surface 6 / State-dir resolver: `hooks/common.sh:4-17,64-149` contains the live `state_dir` and `target_project` resolver contract; `hive/references/state-relocation.md:1-49` documents the relocation direction and current hardcoded `.pHive` gap. The planning queue path should be `<resolved state_dir>/planning-queue.yaml`; current default resolves to `.pHive/planning-queue.yaml`.
- Surface 7 / Config tunables: `hive.config.yaml:111-129,256-261,263-285` and `hive/hive.config.yaml:6-22,105-140,319-335` show task-tracking labels, label prefix examples, and nested Multica polling/timeouts/caps. `hive/lib/config.py:20-50,76-96` is currently narrow and only reads lifecycle emission timing, not general planning queue config.
- Surface 8 / Label and board convention: `.pHive/proposals/cluster-b-planning-queue-brief.md:21-27` locks the visual surface as an unprefixed `idea-queue` label plus saved Multica board view, with no core UI tab. `hive.config.yaml:129` and `hive/hive.config.yaml:122-126` show an existing `task_tracking.label_prefix: "hive"` convention, creating a naming tension but not reopening the locked label choice.

## Patterns & conventions

- The existing triage queue uses top-level `version: 1` and `items: []`; item fields include id, state, kind, title, description, reporter, reported_at, priority, severity, assignee, linked_epic, linked_story, closed_reason, closed_at, and state_history (`hive/references/triage-queue-schema.md:15-37`). Planning queue work can reuse single-writer file discipline while defining a separate idea-feed schema.
- The triage runner hardcodes `.pHive/triage/queue.yaml` unless `HIVE_TRIAGE_QUEUE_DIR` is set, and provides ensure-create, monotonic IDs, state_history append, and JSON command-envelope mechanics (`skills/triage/run.mjs:20-28,138-158`). Planning queue code needs equivalent mechanics for a different path and lifecycle.
- `dispatchStoryToPersonas(serverUrl, token, workspaceId, story, personaIssues, options = {})` returns `{ carrier: 'per-persona-fan-out', dispatches }` and uses direct REST `fetch`, not the Multica CLI (`hive/lib/multica-story-dispatch/index.mjs:302-368`).
- `pollTaskUntilTerminal(opts)` accepts serverUrl, token, workspaceId, issueUuid, maxWallClockMs, pollIntervalMs, messagesCaptureMax, and onStateTransition; terminal statuses are `completed`, `failed`, and `cancelled` (`hive/lib/multica-story-dispatch/episode-sync.mjs:127-210`).
- `writeMulticaRunEpisode(opts)` writes `<hiveStateDir>/episodes/<epicHandle>/<storyId>/multica-run.yaml` plus `.messages.jsonl`; the marker records Multica issue, task, agent, and work_dir metadata (`hive/lib/multica-story-dispatch/episode-sync.mjs:291-352`).
- Multica CLI mutation vocabulary is `issue update`, `issue status`, `issue assign`, `issue comment add`, and `issue label add/remove`; no `issue edit` command was found in the CLI surface observed by the researcher.
- The Hermes dashboard plugin manifest uses `name`, `label`, `description`, `icon`, `version`, `tab.path`, `tab.position`, `entry`, `css`, and `api` (`/Users/don/Code/hermes-agent/plugins/kanban/dashboard/manifest.json:1-14`). This is a dashboard plugin schema, not a model-tool schema.
- A Hermes directory plugin must contain `plugin.yaml` and `__init__.py register(ctx)`; manifests support name, version, description, author, requires_env, provides_tools, provides_hooks, kind, and key. Plugin sources include bundled, user, project, and pip entry point (`/Users/don/Code/hermes-agent/hermes_cli/plugins.py:1-31,230-267`).
- Hermes tool registration uses `ctx.register_tool(name, toolset, schema, handler, check_fn=None, requires_env=None, is_async=False, description='', emoji='', override=False)` (`/Users/don/Code/hermes-agent/hermes_cli/plugins.py:317-355`), with a concrete spotify tool example in `/Users/don/Code/hermes-agent/plugins/spotify/__init__.py:56-66`.
- Active kanban dispatch is gateway-embedded and gated by `kanban.dispatch_in_gateway`; the standalone systemd dispatcher at `/Users/don/Code/hermes-agent/plugins/kanban/systemd/hermes-kanban-dispatcher.service:1-23` is deprecated.
- Hermes Slack outbound posts go through `async def send(self, chat_id: str, content: str, reply_to: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None) -> SendResult`, which calls `chat_postMessage(**kwargs)` and can pass `thread_ts` (`/Users/don/Code/hermes-agent/gateway/platforms/slack.py:758-830`).
- Hermes Slack inbound `message` and `app_mention` Socket Mode events call `_handle_slack_message(event)`; thread replies become `MessageEvent` instances and enter `await self.handle_message(msg_event)` (`/Users/don/Code/hermes-agent/gateway/platforms/slack.py:594-608,1767-2238,2757-2841`).
- State-dir resolution currently reads root `hive.config.yaml` `paths.*`; `_resolve_state_dir()` accepts absolute `state_dir` as-is and resolves relative `state_dir` under `_resolve_target_project()`, defaulting to `.pHive` (`hooks/common.sh:64-149`).
- The closest existing numeric tunable pattern is `planning.multica.poll_interval_seconds`, `persona_timeout_seconds`, and `messages_capture_max` (`hive.config.yaml:256-261`).
- Existing label namespace configuration uses `task_tracking.label_prefix: "hive"` for labels such as `hive:ready` and `hive:blocked-by:<id>` (`hive.config.yaml:129`, `hive/hive.config.yaml:122-126`), while the locked design uses unprefixed `idea-queue` and `blocked-for-human`.
- External validation matched the codebase seams for Slack and YAML: Slack Socket Mode uses `AsyncSocketModeHandler(app, os.environ["SLACK_APP_TOKEN"])`; `chat.postMessage` is the Slack outbound method; PyYAML `safe_load` is appropriate for YAML parsing. The repository pins `js-yaml` 4.2.0 in `package.json:8-15`, and Python YAML support is optional via PyYAML import in `hive/lib/config.py`.

## Constraints

- Do not reopen the locked design decisions in `.pHive/proposals/cluster-b-planning-queue-brief.md:14-24`: `planning-queue.yaml` is separate from triage, the visual surface is label plus saved board view, the watermark is event-driven, and `hermes-multica` is the plugin seam.
- Multica issue listing can filter by status, but no label filter was found in `multica issue list --help`; kanban depth and blocked/GATE polling must either client-side filter labels/comments or use an API surface not documented in the research.
- Multica label attachment requires a label ID, not a name, and the current label list was empty; feeder and relay work need label lookup, creation, persistence, or caching before applying `idea-queue` or `blocked-for-human`.
- No generic Hermes plugin routine registration API was found in `/Users/don/Code/hermes-agent/hermes_cli/plugins.py:317-700`; long-running blocked issue relay likely needs gateway watcher integration, cron integration, or an explicit CLI/daemon path.
- `hive/lib/config.py:20-50,76-96` is not a general config accessor; adding `planning_queue` or watermark keys to YAML alone is insufficient for Python code unless a new reader path is implemented or another resolver is used.
- State-dir resolver adoption is incomplete (`hive/references/state-relocation.md:43-49`); planning queue code should use resolved `state_dir` where possible while accounting for existing hardcoded `.pHive` consumers.
- New B code is expected to follow the Python-primary direction from the locked brief, but the existing Multica dispatch helper seam is ESM (`hive/lib/multica-story-dispatch/*.mjs`).

## Risks

- Severity: high | Relay poll by `blocked-for-human` label cannot be server-side through the current CLI. Evidence: `multica issue list --help` has no label filter, though it does support status filtering.
- Severity: high | `blocked-for-human` and `idea-queue` apply-by-name flows will fail unless label ID resolution exists. Evidence: `issue label add` requires a label ID, and `multica label list --output json` returned `[]`.
- Severity: medium | Hermes kanban is not a direct standalone plugin template for Multica tools. Evidence: `/Users/don/Code/hermes-agent/plugins/kanban/` contains a dashboard manifest/API and gateway dispatcher pattern, while tool plugin examples are spotify/google_meet and the CLI example is teams_pipeline.
- Severity: medium | Polling may require Hermes gateway code changes despite the plugin wording. Evidence: `PluginContext` supports tools, commands, hooks, and platforms, but no `register_poll` or `register_routine` API was found; existing long-running watchers live in `/Users/don/Code/hermes-agent/gateway/run.py`.
- Severity: medium | Python-primary implementation cannot directly import existing JS dispatch helpers. Evidence: the dispatch seam is ESM in `hive/lib/multica-story-dispatch/*.mjs`, while the locked brief says new B code follows Python-primary.
- Severity: medium | Config can split if new YAML keys are added without a Python resolver. Evidence: `hive/lib/config.py` only reads `emit_lifecycle_at` today.
- Severity: low | Locked unprefixed labels differ from existing label namespace examples. Evidence: `task_tracking.label_prefix: "hive"` examples coexist with locked `idea-queue` and `blocked-for-human` names.

## inconsistency_risk_signals

- Signal: hidden assumption | Where: research-task.md surface 3 vs Multica CLI | Detail: requested status/label filtering is only half-supported; status yes, label no.
- Signal: vocabulary mismatch | Where: research-task.md surface 3 | Detail: brief says `issue edit`; current CLI uses `issue update`.
- Signal: hidden setup dependency | Where: Multica labels | Detail: current workspace has no labels, and label attachment is ID-based.
- Signal: template mismatch | Where: Hermes `plugins/kanban/` | Detail: kanban is dashboard + gateway watcher template, not a model-tool plugin/routine template.
- Signal: unresolved tension | Where: `hermes-multica` plugin routine | Detail: PluginContext supports tools/commands/hooks/platforms, but no poll/routine registration API found.
- Signal: posture mismatch | Where: Python-primary brief vs JS dispatch infra | Detail: requested reuse seam is ESM; new B code is supposed to be Python-primary.
- Signal: convention tension | Where: label naming | Detail: locked unprefixed labels differ from existing `task_tracking.label_prefix: "hive"` convention.
- Signal: resolver adoption gap | Where: state-dir relocation | Detail: `<state_dir>/planning-queue.yaml` should use resolver, but broad resolver is planned-not-shipped.

## Open questions

- Which Multica API, if any, can create or manage saved board views? No CLI surface was found.
- What exact Multica PAT scopes are required for issue comment, update, label, assign, and squad operations? CLI help did not expose scope names.
- Should `blocked-for-human` and `idea-queue` remain strictly unprefixed, or should they be configurable defaults that may include a namespace? The brief locks names, but existing Hive examples use `hive:`.
- Should `hermes-multica` live as a Hermes bundled plugin, a gateway watcher patch, a cron job, or a hybrid? `PluginContext` has no generic poll registration.
- Does posting a Multica answer comment auto-trigger the blocked leader, or must the relay explicitly re-dispatch or resume? The brief leaves this as an open fork.

## GAPS_REMAINING

- No saved board-view CLI/API surface located.
- No exact Multica PAT scope list located.
- No generic Hermes plugin `register_routine`/`register_poll` API located.
- No existing `kanban-low-watermark`/`planning_queue` config key located; this is new config surface.
- No context7/firecrawl MCP tools were exposed in this session; used codebase + official web fallback.

## Recommendation

Use the triage queue only as an implementation pattern for single-writer YAML mechanics, not as a shared store or lifecycle. Plan the first slice around a new resolved-state-dir `planning-queue.yaml`, explicit label ID management, and a feeder path that can fall back to client-side filtering until a Multica board-view or label-filter API is identified. Treat `hermes-multica` as a tool plugin plus gateway/cron-style routine integration candidate, because the researched Hermes plugin API did not expose a generic long-running poll registration surface.
