# Research Findings — multica-execute-routing Phase A

Date: 2026-05-21
Workspace: `plugin-hive`
Multica base URL: `http://127.0.0.1:8080`

Evidence classes:
- Observed-from-API: actual curl probes against local Multica v0.3.4 using the PAT from `~/.multica/config.json` via shell variable substitution only.
- Inferred-from-source-code: local Multica source under `/Users/don/Code/spikes/multica`.
- Assumed: implementation assumptions for the follow-on `/execute` mode.

## HEALTH

Observed-from-API:

```http
GET /healthz
HTTP/1.1 200 OK
Content-Type: application/json

{"status":"ok","checks":{"db":"ok","migrations":"ok"}}
```

Verdict: health OK.

## AGENT_DISPATCH

Verdict: ENDPOINT_FOUND.

The dispatch path is not a dedicated `/runs` or `/assignments` endpoint. The working endpoint is:

```http
PUT /api/issues/{issue_uuid}?workspace_id={workspace_uuid}
Content-Type: application/json

{"assignee_type":"agent","assignee_id":"{agent_uuid}"}
```

Observed working probe against PLU-10 (`9dc10c01-0f96-42b3-a32d-d67bd5acf51c`) and `spike-claude` (`0900af3f-1e20-4c9e-9046-60dbb25795a0`):

```http
PUT /api/issues/9dc10c01-0f96-42b3-a32d-d67bd5acf51c?workspace_id=21c6d282-d6b4-4b25-8d0d-a85e96038416
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"9dc10c01-0f96-42b3-a32d-d67bd5acf51c","workspace_id":"21c6d282-d6b4-4b25-8d0d-a85e96038416","number":10,"identifier":"PLU-10","title":"fix-verify smoke","description":"verify identifier field present","status":"todo","priority":"none","assignee_type":"agent","assignee_id":"0900af3f-1e20-4c9e-9046-60dbb25795a0","creator_type":"member","creator_id":"1bc5a076-6383-4905-877d-aadc66884e37","parent_issue_id":null,"project_id":null,"position":0,"start_date":null,"due_date":null,"created_at":"2026-05-21T03:13:44Z","updated_at":"2026-05-21T06:17:02Z"}
```

Required candidate probes:

```http
POST /api/issues/9dc10c01-0f96-42b3-a32d-d67bd5acf51c/assignments?workspace_id=21c6d282-d6b4-4b25-8d0d-a85e96038416
Body: {"agent_id":"0900af3f-1e20-4c9e-9046-60dbb25795a0"}
HTTP/1.1 404 Not Found

404 page not found
```

```http
POST /api/issues/9dc10c01-0f96-42b3-a32d-d67bd5acf51c/runs?workspace_id=21c6d282-d6b4-4b25-8d0d-a85e96038416
Body: {"agent_id":"0900af3f-1e20-4c9e-9046-60dbb25795a0","instructions":"probe dispatch"}
HTTP/1.1 404 Not Found

404 page not found
```

```http
POST /api/agents/0900af3f-1e20-4c9e-9046-60dbb25795a0/tasks?workspace_id=21c6d282-d6b4-4b25-8d0d-a85e96038416
Body: {"issue_id":"9dc10c01-0f96-42b3-a32d-d67bd5acf51c","instructions":"probe dispatch"}
HTTP/1.1 405 Method Not Allowed
Allow: GET
```

```http
PUT /api/issues/9dc10c01-0f96-42b3-a32d-d67bd5acf51c?workspace_id=21c6d282-d6b4-4b25-8d0d-a85e96038416
Body: {"assignee_id":"0900af3f-1e20-4c9e-9046-60dbb25795a0"}
HTTP/1.1 400 Bad Request

{"error":"assignee_type and assignee_id must be provided together"}
```

Discovery endpoints:

```http
GET /openapi.json
HTTP/1.1 404 Not Found

404 page not found
```

```http
GET /api/docs
HTTP/1.1 404 Not Found

404 page not found
```

```http
GET /api
HTTP/1.1 404 Not Found

404 page not found
```

Inferred-from-source-code:
- `/Users/don/Code/spikes/multica/server/cmd/server/router.go:381-413` lists issue routes. Present: `PUT /api/issues/{id}`, `GET /active-task`, `POST /tasks/{taskId}/cancel`, `POST /rerun`, `GET /task-runs`. Absent: `/assignments`, `/runs/{runId}/logs`, issue-level `/runs`.
- `/Users/don/Code/spikes/multica/server/cmd/server/router.go:512-529` lists agent routes. Present: `GET /api/agents/{id}/tasks`, `POST /api/agents/{id}/cancel-tasks`; no `POST /api/agents/{id}/tasks`.
- `/Users/don/Code/spikes/multica/server/internal/handler/issue.go:1990-2212` shows `UpdateIssue` validates assignee pair, detects assignee change, cancels existing issue tasks, and calls `EnqueueTaskForIssue`.
- `/Users/don/Code/spikes/multica/server/internal/handler/issue.go:2313-2323` shows backlog suppresses enqueue; non-backlog agent assignment can enqueue.

Important behavior: dispatch has no per-call `instructions` field. The agent receives issue title/description/comments, so `/execute` must encode story instructions into the Multica issue body or comments before assignment.

Cleanup performed after probing:

```http
PUT /api/issues/9dc10c01-0f96-42b3-a32d-d67bd5acf51c?workspace_id=21c6d282-d6b4-4b25-8d0d-a85e96038416
Body: {"status":"todo","assignee_type":null,"assignee_id":null}
HTTP/1.1 200 OK

{"id":"9dc10c01-0f96-42b3-a32d-d67bd5acf51c","workspace_id":"21c6d282-d6b4-4b25-8d0d-a85e96038416","number":10,"identifier":"PLU-10","title":"fix-verify smoke","description":"verify identifier field present","status":"todo","priority":"none","assignee_type":null,"assignee_id":null,"creator_type":"member","creator_id":"1bc5a076-6383-4905-877d-aadc66884e37","parent_issue_id":null,"project_id":null,"position":0,"start_date":null,"due_date":null,"created_at":"2026-05-21T03:13:44Z","updated_at":"2026-05-21T06:17:29Z"}
```

## RUN_STATE_AND_OUTPUT

Run state is task-based, not `run_id`-based. The working active-task endpoint immediately exposed the spawned task:

```http
GET /api/issues/9dc10c01-0f96-42b3-a32d-d67bd5acf51c/active-task?workspace_id=21c6d282-d6b4-4b25-8d0d-a85e96038416
HTTP/1.1 200 OK

{"tasks":[{"id":"2dad7fd3-a6aa-4c65-afa1-dfae4ad99cc1","agent_id":"0900af3f-1e20-4c9e-9046-60dbb25795a0","runtime_id":"0b8e2f02-bcde-4063-a454-224cc8613944","issue_id":"9dc10c01-0f96-42b3-a32d-d67bd5acf51c","workspace_id":"","status":"running","priority":0,"dispatched_at":"2026-05-21T06:17:02Z","started_at":"2026-05-21T06:17:02Z","completed_at":null,"result":null,"error":null,"attempt":1,"max_attempts":2,"created_at":"2026-05-21T06:17:02Z","kind":"direct"}]}
```

History endpoint:

```http
GET /api/issues/9dc10c01-0f96-42b3-a32d-d67bd5acf51c/task-runs?workspace_id=21c6d282-d6b4-4b25-8d0d-a85e96038416
HTTP/1.1 200 OK

[{"id":"2dad7fd3-a6aa-4c65-afa1-dfae4ad99cc1","agent_id":"0900af3f-1e20-4c9e-9046-60dbb25795a0","runtime_id":"0b8e2f02-bcde-4063-a454-224cc8613944","issue_id":"9dc10c01-0f96-42b3-a32d-d67bd5acf51c","workspace_id":"","status":"running","priority":0,"dispatched_at":"2026-05-21T06:17:02Z","started_at":"2026-05-21T06:17:02Z","completed_at":null,"result":null,"error":null,"attempt":1,"max_attempts":2,"created_at":"2026-05-21T06:17:02Z","kind":"direct"}]
```

Output capture endpoint is `GET /api/tasks/{task_id}/messages?workspace_id={workspace_uuid}`. The candidate logs endpoint is absent:

```http
GET /api/issues/9dc10c01-0f96-42b3-a32d-d67bd5acf51c/runs/2dad7fd3-a6aa-4c65-afa1-dfae4ad99cc1/logs?workspace_id=21c6d282-d6b4-4b25-8d0d-a85e96038416
HTTP/1.1 404 Not Found

404 page not found
```

Observed messages shape:

```http
GET /api/tasks/2dad7fd3-a6aa-4c65-afa1-dfae4ad99cc1/messages?workspace_id=21c6d282-d6b4-4b25-8d0d-a85e96038416
HTTP/1.1 200 OK

[{"task_id":"2dad7fd3-a6aa-4c65-afa1-dfae4ad99cc1","issue_id":"9dc10c01-0f96-42b3-a32d-d67bd5acf51c","seq":1,"type":"text","content":"Fetching issue and comment history in parallel."},{"task_id":"2dad7fd3-a6aa-4c65-afa1-dfae4ad99cc1","issue_id":"9dc10c01-0f96-42b3-a32d-d67bd5acf51c","seq":2,"type":"tool_use","tool":"Bash","input":{"command":"multica issue get 9dc10c01-0f96-42b3-a32d-d67bd5acf51c --output json","description":"Get issue details"}},{"task_id":"2dad7fd3-a6aa-4c65-afa1-dfae4ad99cc1","issue_id":"9dc10c01-0f96-42b3-a32d-d67bd5acf51c","seq":3,"type":"tool_result","tool":"Bash","output":"\"{\\n  \\\"assignee_id\\\": \\\"0900af3f-1e20-4c9e-9046-60dbb25795a0\\\",\\n  \\\"assignee_type\\\": \\\"agent\\\",\\n  \\\"created_at\\\": \\\"2026-05-21T03:13:44Z\\\",\\n  \\\"creator_id\\\": \\\"1bc5a076-6383-4905-877d-aadc66884e37\\\",\\n  \\\"creator_type\\\": \\\"member\\\",\\n  \\\"description\\\": \\\"verify identifier field present\\\",\\n  \\\"due_date\\\": null,\\n  \\\"id\\\": \\\"9dc10c01-0f96-42b3-a32d-d67bd5acf51c\\\",\\n  \\\"identifier\\\": \\\"PLU-10\\\",\\n  \\\"labels\\\": [],\\n  \\\"number\\\": 10,\\n  \\\"parent_issue_id\\\": null,\\n  \\\"position\\\": 0,\\n  \\\"priority\\\": \\\"none\\\",\\n  \\\"project_id\\\": null,\\n  \\\"start_date\\\": null,\\n  \\\"status\\\": \\\"todo\\\",\\n  \\\"title\\\": \\\"fix-verify smoke\\\",\\n  \\\"updated_at\\\": \\\"2026-05-21T06:17:02Z\\\",\\n  \\\"workspace_id\\\": \\\"21c6d282-d6b4-4b25-8d0d-a85e96038416\\\"\\n}\""}]
```

Cancellation endpoint:

```http
POST /api/issues/9dc10c01-0f96-42b3-a32d-d67bd5acf51c/tasks/2dad7fd3-a6aa-4c65-afa1-dfae4ad99cc1/cancel?workspace_id=21c6d282-d6b4-4b25-8d0d-a85e96038416
HTTP/1.1 200 OK

{"id":"2dad7fd3-a6aa-4c65-afa1-dfae4ad99cc1","agent_id":"0900af3f-1e20-4c9e-9046-60dbb25795a0","runtime_id":"0b8e2f02-bcde-4063-a454-224cc8613944","issue_id":"9dc10c01-0f96-42b3-a32d-d67bd5acf51c","workspace_id":"","status":"cancelled","priority":0,"dispatched_at":"2026-05-21T06:17:02Z","started_at":"2026-05-21T06:17:02Z","completed_at":"2026-05-21T06:17:19Z","result":null,"error":null,"attempt":1,"max_attempts":2,"created_at":"2026-05-21T06:17:02Z","work_dir":"/Users/don/multica_workspaces/21c6d282-d6b4-4b25-8d0d-a85e96038416/2dad7fd3/workdir","kind":"direct"}
```

After cancellation:

```http
GET /api/issues/9dc10c01-0f96-42b3-a32d-d67bd5acf51c/active-task?workspace_id=21c6d282-d6b4-4b25-8d0d-a85e96038416
HTTP/1.1 200 OK

{"tasks":[]}
```

Completion signal:
- Sufficient API signal: poll `/api/issues/{id}/task-runs` or `/active-task` and inspect task `status`.
- Terminal states observed/source-backed: `completed`, `failed`, `cancelled`; active states observed/source-backed: `queued`, `dispatched`, `running`.
- Completed task example from `GET /api/agent-task-snapshot?workspace_id=...`:

```json
{"id":"1ebcc87f-68da-4e72-9a64-b01bec9fc3a7","agent_id":"0900af3f-1e20-4c9e-9046-60dbb25795a0","runtime_id":"0b8e2f02-bcde-4063-a454-224cc8613944","issue_id":"09b2deee-35b3-4f9d-8762-e5b9fc5fb43d","workspace_id":"","status":"completed","priority":0,"dispatched_at":"2026-05-20T22:54:44Z","started_at":"2026-05-20T22:54:44Z","completed_at":"2026-05-20T22:55:18Z","result":{"output":"Done. Skill resolved and ran cleanly — `plugin-hive:status` found, warned about missing `.pHive/`, reported no active workflows. PLU-3 → in_review.","pr_url":"","session_id":"d5c2393d-50c7-45ea-9bb6-4b76a4031207","work_dir":"/Users/don/multica_workspaces/21c6d282-d6b4-4b25-8d0d-a85e96038416/1ebcc87f/workdir"},"error":null,"attempt":1,"max_attempts":2,"created_at":"2026-05-20T22:54:44Z","work_dir":"/Users/don/multica_workspaces/21c6d282-d6b4-4b25-8d0d-a85e96038416/1ebcc87f/workdir","kind":"direct"}
```

Inferred-from-source-code:
- `/Users/don/Code/spikes/multica/server/internal/handler/agent.go:142-194` defines `AgentTaskResponse`.
- `/Users/don/Code/spikes/multica/server/internal/handler/agent.go:222-261` maps DB task fields to response fields.
- `/Users/don/Code/spikes/multica/server/internal/handler/daemon.go:1935-1955` implements active-task listing.
- `/Users/don/Code/spikes/multica/server/internal/handler/daemon.go:1957-1984` implements issue-scoped task cancellation.
- `/Users/don/Code/spikes/multica/server/internal/handler/daemon.go:1986-2005` implements issue task-run history.
- `/Users/don/Code/spikes/multica/server/internal/handler/daemon.go:2008-2045` implements task message listing for user auth.
- `/Users/don/Code/spikes/multica/server/pkg/db/queries/agent.sql:86-97` creates queued issue tasks.
- `/Users/don/Code/spikes/multica/server/pkg/db/queries/agent.sql:146-176` cancels active tasks by issue/agent.
- `/Users/don/Code/spikes/multica/server/pkg/db/queries/agent.sql:396-400` cancels a single active task.

Sufficiency for new mode: yes for dispatch, poll, output, and cancellation. Missing: a dedicated explicit run endpoint with per-run `instructions`.

## EXISTING_RUN_MODE_PATTERNS

Sandcastle interface contract:
- `skills/hive/skills/execute-mode-sandcastle/SKILL.md:90-104` invocation contract: called once when `mode_decision == sandcastle`; inputs are `workflow_path`, `unblocked_stories[]`, `epic_handle`, and `hive_config`; outputs are episode markers, per-story commits, and closed worktrees.
- `skills/hive/skills/execute-mode-sandcastle/SKILL.md:107-125` process: check preconditions, run provider preflight, create one worktree per story, invoke Codex, teardown on all exit paths.
- `skills/hive/skills/execute-mode-sandcastle/SKILL.md:21-27` requires Sandcastle version preflight before auth/hooks/provider setup.
- `skills/hive/skills/execute-mode-sandcastle/SKILL.md:53-67` owns only Sandcastle-created worktrees and must close them.
- `skills/hive/skills/execute-mode-sandcastle/SKILL.md:69-88` distinguishes Sandcastle lifecycle hooks from Hive tool hooks.

Team-cmux interface contract:
- `skills/hive/skills/execute-mode-team-cmux/SKILL.md:12-25` called once when `mode_decision == team-cmux` and terminal mux is cmux; inputs include `workflow_path`, `unblocked_stories[]`, `appends_map`, `epic_handle`; outputs episode markers, per-story commits, and closed cmux surfaces.
- `skills/hive/skills/execute-mode-team-cmux/SKILL.md:29-49` spawns unblocked stories, polls every 10 seconds for `[STORY-COMPLETE:{story-id}]`, and advances the DAG.
- `skills/hive/skills/execute-mode-team-cmux/SKILL.md:52-64` injects sidecar reviewers into active panes using fixed wording.
- `skills/hive/skills/execute-mode-team-cmux/SKILL.md:66-72` closes every tracked surface on both success and failure.

Session interface contract:
- `skills/hive/skills/execute-mode-session/SKILL.md:12-27` called once when `mode_decision == sessions`; inputs include `workflow_path`, `unblocked_stories[]`, `appends_map`, `epic_handle`, `hive_config`; outputs session registry records, per-story commits, and SSE activity updates.
- `skills/hive/skills/execute-mode-session/SKILL.md:30-45` bootstraps a session registry, creates pending records, opens sessions by dependency order, and marks records active.
- `skills/hive/skills/execute-mode-session/SKILL.md:47-57` injects sidecar reviewers with the same fixed wording as team-cmux.
- `skills/hive/skills/execute-mode-session/SKILL.md:59-65` monitors SSE updates and closes sessions as completed/failed.
- `skills/hive/skills/execute-mode-session/SKILL.md:71-73` detects staleness via `sse_last_event_at` and retries up to configured max.

Implication for multica mode:
- Mirror the atomic skill pattern: one `execute-mode-multica` sub-skill called by dispatch.
- Inputs should match sandcastle/session where possible: `workflow_path`, `unblocked_stories[]`, `appends_map`, `epic_handle`, `hive_config`, plus Multica workspace/server/agent mapping if not derivable from config.
- Outputs should include episode markers plus Multica issue/task ids for traceability.
- Completion monitoring should poll task state/messages rather than screen text or SSE.

## DISPATCH_SUBSKILL_MODIFICATION_POINTS

Primary dispatch file: `skills/hive/skills/execute-dispatch/SKILL.md`.

Current mode enum and outputs:
- `skills/hive/skills/execute-dispatch/SKILL.md:14-18` input/output contract currently includes env `HIVE_EXECUTION_MODE`, enum `sessions | team | team-cmux | sequential | sandcastle`, and `execution_mode` source tracking for sandcastle only.
- Touch this range to add `multica` to the enum and document env/config source attribution.

Current precedence:
- `skills/hive/skills/execute-dispatch/SKILL.md:24-31` says sessions wins over every team/sequential input; cmux is selected after all team checks pass.
- `skills/hive/skills/execute-dispatch/SKILL.md:64-69` is where `execution_mode` recognizes exactly `sandcastle` from env/config and immediately sets `mode_decision=sandcastle`, skipping Step 1. This is the top modification point for additive opt-in `multica`.
- `skills/hive/skills/execute-dispatch/SKILL.md:83-97` Step 1 is the standard fallback chain and should remain reached only when no explicit `execution_mode` override fires.

Parallel gate:
- `skills/hive/skills/execute-dispatch/SKILL.md:99-127` Step 1.5 currently gates `{team, team-cmux, sessions, sandcastle}` and explains sandcastle fans out one container per depth-0 story.
- Add `multica` to this gate if Multica mode fans out multiple agent issue assignments at the same depth. The check belongs here because all parallel fan-out surfaces must pass through this dispatch point.

Runner path remains separate:
- `skills/hive/skills/execute-dispatch/SKILL.md:129-145` runner selection controls `hive-dag` vs `orchestrator-narrated`; do not conflate Multica mode selection with runner cutover.
- `skills/hive/skills/execute-dispatch/SKILL.md:147-151` names this skill as the single dispatch point and requires future fan-out modes to route through it.

Recommended precedence for multica:
- Treat `HIVE_EXECUTION_MODE=multica` and root `hive.config.yaml execution.mode: multica` like the existing sandcastle override.
- Because this is additive opt-in, explicit execution mode should keep current override precedence over sessions/team/sequential.
- Add a distinct `field_sources.execution_mode` token value path for `multica`, not a new independent source field.

## BOOTSTRAP_PRECONDITION_CHECK

Observed local Multica state:

```http
GET /api/agents?workspace_id=21c6d282-d6b4-4b25-8d0d-a85e96038416
HTTP/1.1 200 OK

[{"id":"0900af3f-1e20-4c9e-9046-60dbb25795a0","workspace_id":"21c6d282-d6b4-4b25-8d0d-a85e96038416","runtime_id":"0b8e2f02-bcde-4063-a454-224cc8613944","name":"spike-claude","description":"","instructions":"You are a test agent. When assigned an issue, do exactly what the issue title and description say. Be brief.","avatar_url":null,"runtime_mode":"local","runtime_config":{},"custom_env":{},"custom_args":[],"mcp_config":null,"custom_env_redacted":false,"mcp_config_redacted":false,"visibility":"workspace","status":"idle","max_concurrent_tasks":1,"model":"claude-sonnet-4-6","thinking_level":"","owner_id":"1bc5a076-6383-4905-877d-aadc66884e37","skills":[],"created_at":"2026-05-20T22:43:02Z","updated_at":"2026-05-21T01:23:17Z","archived_at":null,"archived_by":null}]
```

Fail-loud precondition for new mode:
- Before dispatching, call `GET /api/agents?workspace_id={workspace_uuid}`.
- If the result is not an array or has length 0, abort with a clear bootstrap-required error. Do not silently fall back to local/team execution if `execution.mode: multica` was explicit.
- Also require that the selected agent has `runtime_id`, is not archived, and preferably has `status` not indicating unavailable. The API currently accepted `spike-claude` with `status":"idle"` and `runtime_id`.

Desired local config:
- `.pHive/multica/agents.yaml:1-32` declares `developer`, `tester`, and `reviewer` agent specs with provider/model/persona/runtime fields.

Bootstrap helper source:
- `hive/lib/multica-bootstrap/index.mjs:250-295` implements `reconcileAgents`: requires token/workspace/config path, loads `.pHive/multica/agents.yaml`, lists existing agents via `GET /api/agents?workspace_id=...`, resolves runtime by provider, creates missing agents with `POST /api/agents?workspace_id=...`, patches drifted agents with `PUT /api/agents/{id}?workspace_id=...`, and returns `{created, patched, skipped}`.
- `hive/lib/multica-bootstrap/index.mjs:126-147` resolves runtimes through `GET /api/runtimes?workspace_id=...` and fails if no matching runtime provider exists.
- `skills/multica-init/SKILL.md:128-142` states reconcile loads desired agents, resolves runtime by provider, resolves persona refs, creates missing agents, patches drift, skips unchanged agents, and leaves extras untouched.
- `skills/multica-init/SKILL.md:191-214` states idempotency and desired fields.

Tests:

```text
node --test tests/multica-init/bootstrap.test.mjs
✔ AC1 server-not-running: checkHealth throws structured transport error
✔ AC2 CLI-missing: ensureCli requires consent before brew install
✔ AC3 auth-flow: ensureAuth mints PAT and persists tmp config only
✔ AC4 full idempotency: reconcileAgents skips matching agents with zero POST/PUT
✔ AC5 partial agents: reconcileAgents creates missing and does not PUT existing
✔ AC6 agent drift patch: reconcileAgents PUTs corrected custom_env
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

Relevant test lines:
- `tests/multica-init/bootstrap.test.mjs:173-207` covers full idempotency skip with zero POST/PUT.
- `tests/multica-init/bootstrap.test.mjs:209-250` covers creating a missing agent and avoiding PUT for existing.
- `tests/multica-init/bootstrap.test.mjs:252-291` covers drift patch via PUT.

Bootstrap preconditions sufficient: yes for assuming agents are bootstrapped if `GET /api/agents?workspace_id=...` returns non-empty and selected desired agent names are present. Not sufficient for exact persona mapping unless the mode validates desired names from `.pHive/multica/agents.yaml` against Multica names.

## RISKS

- No dedicated dispatch endpoint accepts per-run instructions. `/execute` must create/update issue content or comment before assigning; otherwise the Multica agent only sees issue title/description/comment history.
- Assignment is stateful and assignee-driven. Reassigning an issue cancels existing active tasks on that issue per source (`UpdateIssue` calls `CancelTasksForIssue` before enqueue), so the mode should create/use one Multica issue per story run rather than repeatedly reassigning shared issues.
- Backlog issues do not enqueue on assignment. New mode must ensure issue status is not `backlog` before assignment, or move out of backlog after assignment.
- `AgentTaskResponse.workspace_id` was `""` in task responses even though the issue has a workspace id. Consumers should rely on the issue/workspace context they already hold, not this field.
- Task output is message-stream style (`/api/tasks/{id}/messages`), not a single log blob. Polling needs `since` support and seq handling.
- Completion semantics are task status-based. Issue status may become `in_review`/`done` due to agent behavior, but task status is the more direct completion signal.

## INCONSISTENCY_RISK_SIGNALS

- Existing `/execute-dispatch` docs only recognize `execution_mode` overrides for sandcastle (`skills/hive/skills/execute-dispatch/SKILL.md:64-69`), while the next mode wants the same opt-in surface for Multica. This is a doc/spec change before implementation.
- `.pHive/multica/agents.yaml` declares `developer`, `tester`, and `reviewer`, but the live local API currently returned only `spike-claude`. That is enough to prove dispatch but not enough to prove desired Hive persona agents are present in this workspace.
- Prior s3 research focused agent CRUD. It did not identify dispatch; Phase A now shows dispatch is via issue assignee update, not agent CRUD.
- Candidate `GET /api/issues?workspace_id=...&identifier=PLU-10` returned a list containing all issues, not only PLU-10. Existing adapter already works around identifier resolution; new mode should not assume server-side identifier filtering is exact unless adapter/source is updated.
- Route source exposes `POST /api/issues/{id}/rerun`, which may enqueue a run for the current assignee, but it is not the primary initial dispatch path and does not accept arbitrary instructions.

## UNANSWERED_QUESTIONS

- Should `/execute` create new Multica issues per story, reuse existing task-tracker issues, or update existing story issues and assign them? Creating per-story run issues is safest for cancellation/isolation.
- What is the canonical mapping from Hive story primary agent (`developer`, `tester`, `reviewer`) to Multica agent name/id when live Multica contains extras or missing desired agents?
- Should the new mode write story-completion episode markers from task status alone, or require a magic output/comment string from the Multica agent?
- How should sidecar reviewers be modeled in Multica: additional comments/mentions, separate issue assignments, or separate Multica issues?
- Does v0.3.4 expose WebSocket/SSE task events stable enough for `/execute`, or should the first implementation poll only?
- Should multica mode invoke `/hive:multica-init` automatically on empty agent list, or fail loud and require a separate bootstrap step?
