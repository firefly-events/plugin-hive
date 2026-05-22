# Research Brief — team-cell-execution-mode

**Inputs:** `.pHive/proposals/team-cell-execution-mode.md`, `.pHive/audits/multica-mode-audit-2026-05-22.md`
**Method:** codebase scan + live Multica 0.3.4 CLI probes + daemon log inspection
**Status:** data-gathering only — no design synthesis

---

## 1. Multica primitive inventory (resolves Q1: which of a/b/c hosts a cell)

Probed Multica CLI 0.3.4 (server `http://localhost:8080`, workspace `21c6d282`, project `d23d0d43`).

### 1.1 Top-level command surface

From `multica --help`, CORE commands:
`agent, autopilot, issue, label, project, repo, skill, squad, workspace`.
RUNTIME: `daemon, runtime`. ADDITIONAL: `attachment, auth, config, login, setup, update, user, version`.

**No `session` or `sessions` command exists.** Only `squad` and `issue` are candidate multi-agent collaboration primitives.

### 1.2 Option (a) — Parent issue + child issues per phase

**Status: AVAILABLE.** CLI evidence:

- `multica issue create` exposes `--parent string  Parent issue ID` (single-parent, no array).
- `multica issue update` exposes `--parent string  Parent issue ID (use --parent "" to clear)`.
- Each issue has exactly one `--assignee` (member | agent | squad) and one `--project`.
- Already used in the wild: ABI probe stories used parent linking (proposal §"Why Multica primitives can support this").

Relationships are set by `--parent` on child at create-time; no `--child` flag.

### 1.3 Option (b) — Sequential reassignment across roles

**Status: AVAILABLE.** `multica issue update` exposes mutable `--assignee` / `--assignee-id`. Run history accessible via `multica issue runs <id>`; explicit re-enqueue via `multica issue rerun`.

**Unconfirmed:** whether `--assignee` mutation automatically spawns a fresh task run, or only mutates metadata (would need `issue rerun` to trigger work). Needs live test.

### 1.4 Option (c) — Multica session / squad primitive

**Status: PARTIAL.** `squad` exists; `session` does not.

`multica squad <command>`: `activity, create, delete, get, list, member, update`. Signals:

- Squads are workspace-scoped containers of *members* (humans + agents).
- `issue create --assignee` accepts "member, agent, **or squad**" — so a squad can be the assignee of one issue at a time.
- `squad activity` records "a squad leader evaluation on an issue" — implies a single designated evaluator inside the squad.
- **No CLI primitive observed for "fan out one issue to N agents in a squad concurrently."** Daemon log shows one `provider=claude` task per `agent_id` per `task=<id>` — never multiple agents on one task.

The word "session" inside the dispatch code refers to `resume_session=false` on daemon task-context (agent CLI session resume, not multi-agent collab scope).

### 1.5 Hive-side touch points already present

```
hive/adapters/multica/index.ts            — task-tracking ABI 1.0.0 wrapper around Multica REST
hive/lib/multica-bootstrap/index.mjs      — workspace + agent reconciliation (296 lines)
hive/lib/multica-agents-config/index.mjs  — parseAgentsConfig, resolveAgentInstructions
hive/lib/multica-story-dispatch/index.mjs — serializeStoryBrief, dispatchStoryToAgent, …
hive/lib/multica-story-dispatch/episode-sync.mjs — pollTaskUntilTerminal, writeMulticaRunEpisode (231 lines)
skills/multica-init/SKILL.md              — six-step bootstrap (server/CLI/auth/workspace/daemon/agents)
skills/hive/skills/execute-mode-multica/SKILL.md — current dispatch atomic skill
```

### 1.6 Verdict per option

| Option | Available | Mechanism | Notes |
|---|---|---|---|
| (a) parent + child issues | yes | `issue create --parent <id>` | Strict 1:1 parent-child; per-child assignee. CLI-confirmed. |
| (b) reassign one issue | yes | `issue update --assignee` | Whether mutation alone re-runs task is unconfirmed; explicit re-run via `issue rerun`. |
| (c) native squad collab | partial | `squad` exists, but single-assignee at task time; no daemon-level parallel-multi-agent evidence | Squad-as-assignee likely serializes via "squad leader evaluation"; not a true collab scope. |

---

## 2. Existing multica-mode skill survey

### 2.1 Dispatch flow — `skills/hive/skills/execute-mode-multica/SKILL.md`

Six-step atomic skill, called once per parent workflow when `mode_decision == multica`:

```
Step 0: Precondition gate — load hive_config.execution.multica.*; resolve serverUrl/token/
        workspaceId; call resolveAgentUuidByName('developer')   ← single-agent assumption embedded here
Step 1: Per-story dispatch — for each story: createStory if no tracker_id, ensureIssueBriefMatches,
        moveOutOfBacklogIfNeeded, dispatchStoryToAgent(developerAgentUuid).
        "parallel within current depth; DAG advancement owned by /execute"
Step 2: Poll until terminal — pollTaskUntilTerminal(...) with onStateTransition callback;
        maxWallClockMs from story_timeout_seconds (default 1_800_000);
        pollIntervalMs from poll_interval_seconds (default 5_000)
Step 3: Episode marker per terminal — writeMulticaRunEpisode → multica-run.yaml + multica-run.messages.jsonl
Step 4: Sidecar deferral — v1: NO Multica dispatch for sidecars,
        log "[info] sidecar injection deferred to v2 multi-agent contract"
Step 5: Wait then return — block until all depth-0 terminate, return summary to /execute
```

### 2.2 Dispatch lib exports

`hive/lib/multica-story-dispatch/index.mjs`: `serializeStoryBrief`, `resolveAgentUuidByName`, `ensureIssueBriefMatches`, `dispatchStoryToAgent`, `moveOutOfBacklogIfNeeded`.

`hive/lib/multica-story-dispatch/episode-sync.mjs`:
- `pollTaskUntilTerminal({serverUrl, token, workspaceId, issueUuid, storyId, maxWallClockMs, pollIntervalMs, messagesCaptureMax, onStateTransition})` — line 123
- `writeMulticaRunEpisode({...terminal, hiveStateDir, epicHandle, storyId})` — line 229

Marker paths (from skill step 3):

```
${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/multica-run.yaml
${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/multica-run.messages.jsonl
```

Terminal mapping: Multica `completed` → marker `passed`; `failed` → `failed`; `cancelled` → `cancelled`.

### 2.3 Where a persona split would slot in

Today the skill embeds **"developer is THE agent"** end-to-end:

- step 0 hard-codes `resolveAgentUuidByName(..., 'developer')`.
- step 1 calls `dispatchStoryToAgent(..., developerAgentUuid)` — single assignee per story.
- The `appends_map` (researcher/tester/reviewer beyond developer) is **explicitly deferred to v2** (step 4 logs the deferral rather than dispatching).
- One episode marker per story — schema is whole-story-to-one-agent.

A team-cell split replaces step 1's single-agent dispatch with phase-fanout (a / b / c per §1) and step 3's single marker with one per-phase marker (or a roll-up with per-phase sub-statuses).

### 2.4 Marker contract — `hive/references/episode-schema.md`

Per-step marker at `.pHive/episodes/{epic-id}/{story-id}/{step-id}.yaml`. Required fields: `step_id`, `status` (`completed|failed|escalated`), `timestamp` (ISO 8601), `artifacts` (list, empty if none).

Strong contract: **story-level `status:` is DERIVED from markers, not free-written** (per `feedback_story_status_stale`). Trust `git + .pHive/episodes/` over story YAML status. A team-cell marker contract must preserve this — phase outcome lives in the marker.

### 2.5 Polling lifecycle (`pollTaskUntilTerminal`, lines 123-184)

Polls `GET /api/workspaces/{ws}/issues/{uuid}/task`. Reads `latestTaskRun(body)` → extracts `taskId`, `taskStatus`, `taskTime`, `taskNotes`. Sleeps `Math.min(pollIntervalMs, maxWallClockMs - elapsed)`. Calls `onStateTransition(prev, next)` only on status change. Returns terminal payload.

Phase-aware polling would either (a) poll N child issues independently, (b) watch `runs` history / assignee transitions on one issue, or (c) extend the lib with squad-aware polling.

---

## 3. Persona roster inventory

### 3.1 Repo personas — `hive/agents/*.md` (25 files)

```
accessibility-specialist, analyst, animations-specialist, architect,
backend-developer, developer, frontend-developer, idiomatic-reviewer,
orchestrator, pair-programmer, peer-validator, performance-reviewer,
researcher, reviewer, security-reviewer, team-lead, technical-writer,
test-architect, test-inspector, test-scout, test-sentinel, test-worker,
tester, tpm, ui-designer
```

Tiering from `hive.config.yaml`:
- `opus`: orchestrator, team-lead, architect, analyst, tpm
- `sonnet`: researcher, developer, frontend/backend-developer, tester, reviewer, pair-programmer, peer-validator, ui-designer, technical-writer, test-scout/architect/inspector
- `model_overrides`: `reviewer: opus`, `peer-validator: opus` (cross-LLM verification gate)

### 3.2 Multica workspace agents — `multica agent list`

Workspace `21c6d282` has exactly **4 bootstrapped agents**:

| Name | UUID | Model | Status |
|---|---|---|---|
| spike-claude | 0900af3f-… | claude-sonnet-4-6 | idle (test agent, 2026-05-20) |
| developer | d9946f9a-… | claude-sonnet-4-6 | idle |
| tester | f43c31f2-… | claude-sonnet-4-6 | idle |
| reviewer | 14a6a1ed-… | **claude-opus-4-7** | idle |

All four share `runtime_id=0b8e2f02-bcde-4063-a454-224cc8613944` (single local daemon, `provider=claude`). `max_concurrent_tasks=1` each. `reviewer.model = claude-opus-4-7` honors `feedback_codex_work_opus_review_split`.

The `instructions` field on each Multica agent contains the **full persona file content** (YAML frontmatter + markdown body) from `hive/agents/{name}.md`, fetched at reconciliation time (confirmed by diffing `developer.instructions` against `hive/agents/developer.md`).

### 3.3 Proposal personas NOT in workspace

Proposal references these roles beyond the 4 bootstrapped:

```
plan cell:    researcher, architect, tpm, technical-writer
              + optional: ui-designer, security, analyst, peer-validator
execute cell: researcher, developer, tester, reviewer
              + optional: ui-designer, backend-developer, frontend-developer,
                          security, qa-engineer, peer-validator
review cell:  reviewer, peer-validator, tester
              + optional: security, performance, accessibility
```

**Missing from workspace (need bootstrap):** researcher, architect, tpm, technical-writer, peer-validator, backend-developer, frontend-developer, analyst, ui-designer.

**Naming mismatches** (proposal → on-disk file):
- `security` → `security-reviewer.md` (no plain `security.md`)
- `performance` → `performance-reviewer.md`
- `accessibility` → `accessibility-specialist.md`
- `qa-engineer` → **no matching persona file on disk** (closest: `tester.md`)

### 3.4 Bootstrap mechanism — `hive/lib/multica-bootstrap/index.mjs`

296-line module. Consumes `parseAgentsConfig` / `resolveAgentInstructions` from `hive/lib/multica-agents-config/index.mjs`.

- Reads agents config from YAML path (default expectation: `.pHive/multica/agents.yaml`).
- `buildAgentPayload(agent, runtimeId, instructions)` sends to Multica API. Payload fields: `name, runtime_id, description, model, thinking_level, visibility, max_concurrent_tasks, custom_env, custom_args, mcp_config, instructions`.
- `resolveAgentInstructions(agent, repoRoot)` reads `agent.persona_ref` (e.g., `hive/agents/developer.md`) from `repoRoot` (default `process.cwd()`) and uses that file as the `instructions:` value.
- **No git config / user identity is set by hive bootstrap.** Reconciliation is API-only and idempotent (compares desired vs existing payload fields, patches diffs).

Adding more personas to Multica is a config-file change + re-run of `/multica-init`. No code changes needed for additional personas.

---

## 4. Signal-detection precedent

### 4.1 UI detection in `skills/plan/SKILL.md` step 16

Phase structure: Phase A: Research (L125), Phase B: Design Discussion (L161), Phase C: Story Decomposition (L257), Phase D: Publishing (L615). UI Step Detection section at L860.

Step 16 (L573): "scan each story for UI work indicators … invoke the **design** skill … See the UI Step Detection section below for the detection keywords."

**Keyword list (L862, verbatim, case-insensitive match):**
> screen | view | page | modal | dialog | sheet | drawer | button | form | input | component | widget | card | list item | redesign | layout | visual | UI | UX | mockup | wireframe | marketing | landing page | banner | app store

Pattern: on match, planner writes a `ui-design` step that records a `/design` delegation. **Blocking-gate contract:** stories with `/design` delegation MUST NOT proceed to execution until the design handoff entry exists in `.pHive/design/index.yaml`.

This is the **canonical keyword-list pattern in the repo**: scan(text) → boolean → conditional artifact write. No regex precompilation, no inverted index — just text.includes() against the keyword union.

### 4.2 Planning-routing skill — `skills/hive/skills/planning-routing/SKILL.md`

142-line atomic skill. Step 0.1 "Build Team Composition" is the closest existing analog to the proposal's `core[]` + `optional[]` contract:

```
Core team (always included):    researcher, technical-writer, tpm
Conditional members:
  architect    — "for architecture decisions, multi-system integration, medium/large scale,
                  API design, data model changes, infrastructure, or 'architecture' signals"
  ui-designer  — "for UI work: screens, components, visual design, wireframes,
                  frontend flows, layout, states, or design review"
```

"Signal-detection" here is **prose-rule, not a declarative rule table.** The proposal's `signals{}` block would be a structural codification of what planning-routing already does informally.

### 4.3 Scope-drift emission — `hive/lib/scope_drift.py` (231 lines)

Bucketed score (`none|minor|major|divergent`) via `compute_scope_drift(expected, delivered, delta_reasons)`, emitted by `emit_scope_drift(...)`.

Per memo `feedback_scope_drift_emit_sites`: **three callsites only** (deliberately bounded): `plan:phase-c`, `execute:story`, `review:complete`. Maturity-gated — skips when `project_maturity ∈ {greenfield, early}`. Persists via `hive.lib.metrics.core.append_event`. Same emit-site discipline applies to any team-cell phase-boundary marker.

### 4.4 No hive-lib signal-detection library exists

`grep -l 'signal'` in `hive/` and `skills/` returns hits only in `agents/analyst.md`, `skills/grill/SKILL.md`, `skills/plan/SKILL.md`, `skills/hive/skills/planning-routing/SKILL.md` — all narrative use ("escalation signals", "design-discussion signals"). **No declarative signal table / detector library at the hive lib layer.** The proposal's `signals{}` would be net-new structural ground.

### 4.5 Executor's native routing predicate grammar

From `hive/workflows/steps/meta-team-cycle/step-02-analysis.md` (referenced by `feedback_metric_signal_findings_conflation`):

```
when (run step-03):    "$analysis.output.findings_count > 0 ||
                        $analysis.output.external_candidates_count > 0 ||
                        $analysis.output.metric_signal == true"
when (run step-03b):   "$analysis.output.findings_count == 0 &&
                        $analysis.output.external_candidates_count == 0 &&
                        $analysis.output.metric_signal == false"
```

Declarative, named-field bindings, AND-of-empty gates. A team-cell `signals{}` could plausibly compile into this same grammar (`hive/references/predicate-grammar.md`).

---

## 5. Workspace repo binding (audit F1)

### 5.1 Workspace state

```
multica workspace list:
[{"id":"21c6d282-d6b4-4b25-8d0d-a85e96038416","name":"plugin-hive","slug":"plugin-hive"}]
```

`multica workspace update --help` flags: `--context, --description, --issue-prefix, --name` — **NO `--repo` / `--bind-repo` flag.** Workspace-level repo binding is not settable via CLI today. The s3 research findings flagged this as UNANSWERED ("Repo allowlist: No HTTP endpoint found").

### 5.2 Project-level binding (the fix path)

```
multica project list:
[{"id":"d23d0d43-…","title":"plugin-hive","workspace_id":"21c6d282-…","resource_count":1,"issue_count":5}]
```

The audit's fix used `multica project create --repo <url>` — PROJECT scope, not workspace scope.

### 5.3 Daemon log — repo readiness lookup

Before fix (repeated):
```
ERR repo checkout readiness failed component=daemon
    workspace_id=21c6d282-… url=https://github.com/Nova36/plugin-hive
    error="repo is not configured for this workspace"
```

After fix (all tasks 2026-05-22 10:15+):
```
INF repo checkout: worktree created component=daemon
    url=https://github.com/firefly-events/plugin-hive
    path=…/workdir/plugin-hive branch=agent/developer/<task_id>
    base=refs/remotes/origin/feat/story-loop-closure
```

Each task line includes `project_id=d23d0d43-…` — **the daemon resolves the repo binding via the project, not the workspace.** A task without a configured project re-introduces the gap (audit F1's "Open" point).

### 5.4 Workspace default project

No CLI command observed for setting a default project on a workspace. `workspace switch` switches default *workspace*, not *project*. `multica config list` exposes `server_url`, `app_url`, `workspace_id` — **no `project_id` config key.** Project resolution per task likely needs explicit `--project` on `issue create`, or comes from issue metadata. Unconfirmed.

---

## 6. Token scope (audit F5)

### 6.1 Source of credential

Daemon log shows `provider=claude` tasks with `workdir=…/plugin-hive` and `branch=agent/developer/<task>`. The git push credential lives **inside the daemon's task environment**, not the hive-side bootstrap.

`hive/lib/multica-bootstrap/index.mjs` does NOT configure any git push credential — it only mints a *Multica* PAT (`/api/tokens` → `mul_secret…`) via `ensureAuth`. The git push credential is established by Multica's daemon when cloning the workspace project's repo (the `repo checkout: worktree created` line). The credential source is the daemon's GH OAuth flow.

### 6.2 OAuth scope

Audit F5 symptom: pushes fail on `.github/workflows/**` files — `workflow` OAuth scope absent on the daemon's GH token. Recovery requires re-auth with `workflow` scope added.

### 6.3 Refresh path

`multica auth --help` returns only the top description ("Authenticate multica with Multica"); no subcommands surfaced. Compare top-level `multica login` and `multica setup` ("Configure the CLI, authenticate, and start the daemon" — likely refresh path).

**Important distinction:** The s3 auth flow (`/auth/send-code`, `/auth/verify-code`, `/api/tokens`) mints the *Multica account* PAT — NOT the GH OAuth used inside the daemon for git push. The GH OAuth flow is a separate concern, owned by the daemon's task runner. CLI command for re-authenticating the daemon's GH OAuth was not surfaced (`multica daemon --help` not probed in this run).

### 6.4 Env-variable surface

`multica agent create` exposes `--custom-env` and `--custom-env-stdin` ("treated as secret material — never logged"). Could carry a stricter-scope PAT, but `custom_env` is per-agent, not per-workspace, and risks shell-history leakage if not using `-stdin`.

---

## 7. Agent identity drift (audit F6)

### 7.1 Audit evidence

Salvaged commit `9856fe5` (s1-2 from the multica-mode run) has author `Nova36 <don.matthews.iii@gmail.com>` — neither the firefly-events bot (`hive-worker <hive-worker@noreply.github.com>`) nor the agent's name. Daemon log line from an earlier task: `text="Found it: \`Nova36/plugin-hive\`. Let me check out the epic branch."`

The agent's git environment inherits `user.name` / `user.email` from either (a) the cloned repo's pre-existing `.git/config` (carryover from pre-OSS Nova36/* era) or (b) the OS-level git config of the host user (`~/.gitconfig` of `don`).

### 7.2 What hive controls

`hive/agents/{name}.md` `domain:` blocks declare file path access constraints — NOT git identity. None of the persona files set `user.name` / `user.email`.

`hive/lib/multica-bootstrap/index.mjs` `buildAgentPayload` payload fields: `name, runtime_id, description, model, thinking_level, visibility, max_concurrent_tasks, custom_env, custom_args, mcp_config, instructions`. **None of these set git identity.** `custom_env` could carry `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL`, but no current agents-config sets them.

### 7.3 Daemon-side identity

The daemon log does NOT show any `git config user.name|user.email` setup commands. The agent inherits whatever the workdir's git configuration provides. Workdir layout: `/Users/don/multica_workspaces/{workspace_id}/{task_id}/workdir/plugin-hive`. Each task gets a fresh worktree (`repo checkout: worktree created`) which inherits from the parent clone's config. The parent clone's identity setup is owned by the daemon at clone-time, not visible in the captured log.

### 7.4 Fix-surface candidates (data only, no recommendation)

- `custom_env` per agent (`GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_*`).
- A post-checkout hook inside the daemon's worktree creation.
- A workspace-level git config injected by the daemon.

Audit F6 §4 names "multica-init" as the fix location, implying a future bootstrap step would set identity via `custom_env` injection. **No such code exists today.**

---

## 8. inconsistency_risk_signals

- **"session"** | Where: proposal title + body | Detail: proposal says "Multica session = team cell" but Multica 0.3.4 has no `session` command — `session` appears in code only as `resume_session=false` on daemon task context. Term also overloads Hive workflow session and Claude conversation session.
- **"team cell"** | Where: proposal + audit only | Detail: net-new term, no prior repo usage. Adjacent existing concepts: "team" (orchestrator TeamCreate persona team), "planning team" (planning-routing Step 0.1), "agent" (Multica workspace agent). No prior reuse to anchor against.
- **"phase"** | Where: proposal `plan|execute|review` cells vs `skills/plan/SKILL.md` Phase A/B/C/D vs episode-marker `step_id` vs workflow phase | Detail: proposal's "plan cell" ≠ /plan Phase A; proposal's "execute cell" is one *story's* worth of work, not the entire /execute run. Same word, three scopes.
- **"core team" / `core[]`** | Where: proposal `core[]` per cell vs `skills/hive/skills/planning-routing/SKILL.md` Step 0.1 "Core team (always included)" | Detail: planning-routing's "core team" is the *planning-team* roster (researcher, technical-writer, tpm) — single static list. Proposal's `core[]` is per-cell-type (different membership per plan/execute/review). Collision: a reader sees "core team" and binds to the wrong roster.
- **"agent"** | Where: proposal "team comp" vs Multica `agent` primitive vs hive persona file vs Claude SDK Agent tool | Detail: a Multica agent is a long-lived API record (UUID + persona injected as `instructions`); a hive persona is the source-file template; the SDK `Agent` tool spawns a transient subagent. Proposal uses "agent" loosely across all three. Risk: "spawn 4 agents per cell" could mean 4 Multica agents (need bootstrap), 4 ephemeral SDK Agent spawns, or 4 personas dispatched to existing Multica agents.

---

## VALIDATION NOTE

```
Checked:    Multica CLI 0.3.4 (bespoke server, not on context7)
Source:     CLI live probes + daemon log inspection + filesystem reads
Confidence: high for §1 options (a)/(b) — direct CLI evidence;
            medium for §1.4 option (c) — squad multi-agent semantics unconfirmed,
              needs live multi-agent dispatch test;
            high for §2–§4 — codebase-grounded;
            medium for §5–§7 — CLI surface clear, but daemon-side git-config
              and GH OAuth setup not directly observed.
Findings:   Multica 0.3.4 surface matches proposal assumptions EXCEPT
            for the `session` primitive (absent at CLI; `squad` exists
            but is a member-grouping primitive, not a parallel-multi-agent
            collab scope).
```

---

## UNANSWERED QUESTIONS (out of brief scope, surfaced for grill)

1. Does `multica issue update --assignee` trigger a fresh task run, or only mutate metadata? (Option b viability hinges on this.)
2. Squad-as-assignee — when a squad with N agents is assigned to one issue, does the daemon parallelize, serialize, or pick a single member? (Option c viability.)
3. Workspace default project — is there a daemon-side resolution path when an issue has no `--project` set?
4. Where does the daemon establish `user.name` / `user.email` for the per-task worktree? (CLI does not expose; suspect daemon config or OS-level git config inheritance.)
5. `multica setup` flow — does re-running with `workflow` scope added refresh the GH OAuth, or is that a separate `multica auth refresh` (command not surfaced)?
