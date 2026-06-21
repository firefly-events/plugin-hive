# dag-flows-multica — Research Deepen

Two fuzzy areas resolved for accurate story decomposition. Facts only.

## Area 1 — Multica dispatch surface (MulticaAgentSpawn binding)

All paths under `hive/lib/multica-story-dispatch/`.

### Signatures & required identifiers (`index.mjs`)
- `serializeStoryBrief(story, options={})` → string. `index.mjs:161`. Pure; renders Markdown brief from `description/acceptance_criteria/files_to_modify/code_examples/references`.
- `resolveAgentUuidByName(serverUrl, token, workspaceId, agentName)` → `Promise<uuid>`. `index.mjs:240`. GET `/api/agents?workspace_id=` (`agentsUrl` `index.mjs:99`). Throws `BOOTSTRAP_REQUIRED` if no agents / name absent.
- `ensureIssueBriefMatches(serverUrl, token, workspaceId, issueUuid, brief)` → `{was_updated, current_brief}`. `index.mjs:270`. PUT only if drifted.
- `dispatchStoryToAgent(serverUrl, token, workspaceId, issueUuid, agentUuid)` → full issue object. `index.mjs:281`. PUT `{assignee_type:'agent', assignee_id:agentUuid}`.
- `dispatchStoryToSquad(...issueUuid, squadUuid)` `index.mjs:387`; `resolveSquadUuidByName` `index.mjs:375`.
- `moveOutOfBacklogIfNeeded(serverUrl, token, workspaceId, issueUuid)` → `{was_moved}`. Reads issue status; moves `backlog`→`todo` only.
- **Caller must already hold:** `serverUrl`, `token`, `workspaceId`, `issueUuid` (issue MUST pre-exist), and the agent/squad *name* (UUID is resolved for you). `issueUrl` `index.mjs:95`.

### CAN a DAG node CREATE an issue from a brief? **NO.**
No issue-creation function exists in the bridge. All writes are PUT-to-update an existing issue (`dispatchStoryToAgent`, `ensureIssueBriefMatches`). The only `POST /api/issues...`-shaped calls in the tree are in `multica-bootstrap/index.mjs` and target `/api/autopilots/.../triggers` and `/api/agents` — not issues. `serializeStoryBrief` produces the brief text, but the issue carrying `step_file_content` must be minted out-of-band (bootstrap/CLI of Multica proper, or a new helper this epic adds). **Decision point:** MulticaAgentSpawn needs a create-issue helper or must rely on pre-seeded issue UUIDs.

### pollTaskUntilTerminal return shape (`episode-sync.mjs`)
Returns: `{ status:'completed'|'failed'|'cancelled', notes:string, messages:[…lastN], task_id, agent_id, agent_name, work_dir, attempts, started_at, completed_at }`. Also surfaces `terminal.code_push_sha`/`code_push_sha`, `terminal.artifacts[]`, `artifacts_committed` (consumed by `deriveCompletion`). Timeout → `status:'cancelled'`.
- `writeMulticaRunEpisode(opts)` (`episode-sync.mjs`) writes `<hiveStateDir>/episodes/<epicHandle>/<storyId>/multica-run.yaml`. Args: `{hiveStateDir, epicHandle, storyId, issueUuid, identifier, terminal, messagesCaptureMax, distill, squad_evaluation}`.

### Branch landing + reconcile
Agent commits land on `agent/<persona>/<run-short>` (NOT epic branch). **No ff-merge helper exists in code** — reconciliation is an orchestrator-side git recipe documented in `skills/execute/.../execute-mode-multica`: `git fetch origin agent/<persona>/<short>` then cherry-pick (subset) or `rebase`+`merge --ff-only` (clean linear). MulticaAgentSpawn must own this git step itself.

### cli.mjs bridge contract (Python→Node; stdout = `JSON.stringify(data)+'\n'`, errors → stderr JSON `{code,message}` + exit 1)
Subcommands (`switch` in `main`): `dispatch | status | poll | episode | cancel | epic-status | comment | write-state`.
- `dispatch --issue <uuid> --agent|--squad <name>` → `{status:'dispatched'|'already_dispatched', issue_id, task_id?}`.
- `status --issue` → full task snapshot (`readTaskSnapshot`).
- `poll --issue [--timeout-ms]` → the terminal object above (default 1_800_000ms).
- `episode --issue …` → writes episode marker, prints path/result.
- `cancel --issue` → `{cancelled:true, task_id}`.
- `epic-status` (NO_CONFIG) → `{epic, gate_state, current_phase, in_flight_story_id, in_flight_task_id, dispatched_at, stories[]}`.
- `comment --issue --body` → `{comment_id}`. `write-state` (NO_CONFIG) local state writer.

## Area 2 — Skill flows → DAG node sequences

Sequence = (phase → agent role → artifact). Files under `skills/<name>/SKILL.md`.

### /plan
- Phase 0 → orchestrator → assembled planning team (classify→spine+specialists)
- Phase A → researcher → research brief (`.pHive/epics/{id}/docs/`)
- Phase B → technical-writer (`design-discussion` skill) → `docs/design-discussion.md` (draft)
- Phase A2 (Grill) → grill skill → grill-record artifact
- Phase B2 (med/large) → TPM + technical-writer → horizontal-plan.md + vertical-plan.md
- Phase B3 (large) → technical-writer → structured outline
- Phase C → orchestrator → story YAMLs under `epics/{id}/stories/` (+ scope_drift emit after step 14)
- Phase D (only if `task_tracking.adapter`) → publish stories to tracker (`external_id`)

### /execute (TDD/BDD per-story loop)
Per story, ordered: research→researcher; (test-spec/behavior-spec)→tester; implement→developer; (test→tester for BDD); review→reviewer; integrate→developer (one commit/story, prefix `[story-id]`, worktree per epic). Emits scope_drift per-story. This loop IS the development.*.workflow.yaml graph.

### /test (test-swarm pipeline)
0 Rebuild→test-scout; 1 Scout→test-scout; 2 Architect→test-architect (AC→test map, scripts); 3 Worker→test-worker (execute, `test-artifacts/`); 4b Scenario-replay→test-inspector; 4 Inspector→test-inspector (coverage); 5 Sentinel→test-sentinel (file bugs); 6 Triage→test-sentinel; 7 Report→test-inspector; 8 Promote→test-architect. Mirrors `test-swarm.workflow.yaml`.

### /review
Phase 0 resolve dispatch mode; Phase 1 (default) loads `code-review.workflow.yaml` and runs steps sequentially: researcher (scope/complexity)→reviewer (correctness/security/conventions verdict passed|needs_optimization|needs_revision). Writes story `in_review` on entry; emits scope_drift on completion.

### Existing workflow YAMLs (`hive/workflows/`)
- `development.bdd.workflow.yaml` (name `development-bdd`): nodes `research(researcher)→behavior-spec(tester)→implement(developer)→test(tester)→review(reviewer)→optimize(developer)→integrate`. Full inputs/outputs/`depends_on` wiring present. Siblings: `development.tdd`, `development.classic`, `development.tdd-codex`.
- `design-review.workflow.yaml`: `accessibility-critique(accessibility-specialist)→animations-critique(animations-specialist)→design-critique(ui-designer)→synthesis(ui-designer)`; inputs from `context.design_artifacts` + prior `step_output`; critiques `optional:true`.
- `daily-ceremony.workflow.yaml`: flat `steps:` (standup-*/planning-*/execution-* prefixes), agents mostly `orchestrator` (+ `analyst` validate, `pause` node `plan-approval`). NOT a dev graph.
- Also present: `code-review`, `test-swarm`, `ui-design`, `security-audit`, `performance-audit`, `meta-team-cycle`, `meta-shotgun`. Schema: `steps:[{id, agent, task|step_file, depends_on:[], inputs:[{name,source,…}], outputs:[{name,type}], optional, timeout_ms}]`.
