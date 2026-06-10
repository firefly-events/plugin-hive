# Raw research findings — multica-plan-test-cycles (scratch input for writer)

> Source: researcher persona pass, 2026-05-28. Ground truth for the research brief + design discussion. Verify paths as you format.

## Q1. How /execute reaches Multica (the pattern to mirror)
Path: `skills/execute/SKILL.md` step 5 → `skills/hive/skills/execute-dispatch/SKILL.md` (the single dispatch point). Dispatch Step 0 resolves the run mode: if `env.HIVE_EXECUTION_MODE == "multica"` (source env) OR root `hive.config.yaml execution.mode: multica` (source config), it sets `mode_decision=multica`, `mode_reason=execution-mode-override-{source}`, skipping Step 1 (env wins over config). The dispatch outputs the enum `mode_decision: sessions|team|team-cmux|sequential|sandcastle|multica`.

On `multica`, `skills/hive/skills/execute-mode-multica/SKILL.md` runs once per parent workflow.
- Inputs: `workflow_path`, `unblocked_stories[]`, `appends_map` (DEFERRED v1), `epic_handle`, `hive_config`.
- Outputs: per-story episode marker `${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/multica-run.yaml` + `.messages.jsonl` sidecar; summary back to the caller.
- Reuses `hive/lib/multica-story-dispatch/index.mjs` (5 helpers: `resolveAgentUuidByName`, `serializeStoryBrief`, `ensureIssueBriefMatches`, `dispatchStoryToAgent`, `moveOutOfBacklogIfNeeded`) and `episode-sync.mjs` (`pollTaskUntilTerminal`, `writeMulticaRunEpisode`).
- Dispatch = `dispatchStoryToAgent → PUT(assignee_type/assignee_id) → Multica enqueues`. Serial within depth; the caller owns DAG advancement.

## Q2. How /plan executes today
`skills/plan/SKILL.md` Phase 0 → `skills/hive/skills/planning-routing/SKILL.md`. Step 0.1 builds the team (researcher/technical-writer/tpm always; architect/ui-designer conditional). Step 0.3 spawns across TWO paths only: direct `TeamCreate` and Codex `agent-spawn → codex-invoke` (mixed teams valid; Step 0.5 falls back codex→TeamCreate). NO Multica touch in planning-routing.
Phases: A research (research-brief), B design discussion, A2 grill (`grill-record.md`), B2 H/V, B3 structured-outline (large only), C story decomposition, D publishing (Phase D step 19).
Phase D is the ONLY existing Multica seam in the planning skill: `TaskTrackingDispatch.invoke("createStory")` routes through the adapter (github|linear|multica) — but this publishes story RECORDS, not team dispatch.
Plausible "plan via Multica" seam = Phase 0 / planning-routing's spawn step (a new third spawn path beside direct/codex).

## Q3. How /test executes today (--simulated-manual)
`skills/test/SKILL.md`. Default = 9-step swarm pipeline (test-scout/architect/worker/inspector/sentinel) via step files `hive/workflows/steps/test/step-0N-*.md` — local orchestration, no Multica.
`--simulated-manual <story-id|scenario-file>` skips steps 0–8 and runs `hive/workflows/steps/test/simulated-manual.md`: resolve scenario (story `manual_verdict.scenario_ref` OR direct path via `hive/lib/scenarios/load.mjs` `loadScenario`) → eval `preconditions` → walk `steps[]` (`spec-walk`|`implementation-walk`) → eval `postconditions` → verdict `pass|fail|inconclusive`, written to the story `manual_verdict` block (schema §8). Scenarios authored at plan-time (the planning skill's Phase C injects a `scenario` step, `agent: tester`).
Seam: the scenario-executor step (or the swarm `test-worker`) could dispatch to a Multica `tester`.

## Q4. Multica substrate primitives
`.pHive/multica/agents.yaml`: one agent per role — creators (developer/backend/frontend/researcher/architect/technical-writer) `provider: codex`; verifiers (reviewer/peer-validator/tester/tpm) `provider: claude, model: claude-opus-4-7`, `max_concurrent_tasks: 1`.
`.pHive/multica/squads.yaml`: three squads — planning-team-squad (leader tpm; researcher/architect/technical-writer/tpm), dev-team-squad, verify-team-squad (tester/test-architect/test-scout/peer-validator/security-reviewer). A squad DOES represent a multi-role cell (name/leader/members).
Autopilots are agent-bound, not squad-bound. `hive/lib/multica-bootstrap/index.mjs` seeds agents.
Caveat: squads.yaml lists test-architect/test-scout/security-reviewer — confirm these exist in agents.yaml before assuming squad-as-cell is dispatchable.

## Q5. Integration invariant
`.pHive/epics/multica-substrate-deepen/docs/integration-principle.md`:
- All work commits to ONE shared epic branch `feat/<epic-id>`; the daemon per-task worktree branch is overridden in the brief.
- Invariant = execution-serialness against latest trunk, NOT dispatch sequencing.
- Fresh-checkout at start (`fetch+checkout+reset --hard origin/<branch>`); rebase-then-push at end (retry 3×, STOP on conflict).
- Parallel dispatch safe ONLY while one agent per role; re-tightens when multi-agent runtimes land (dispatch parallelism→run parallelism; non-overlap gate must hold: `parallel_allowed` + `read-only|bounded-slice`).
- Plan/test differ from the code path: the /execute contract is code-mutation push (rebase/push SHA). The planning skill produces DOCS under `.pHive/epics/{id}/docs/` (annotated `parallel_rationale: read-only`, no production writes); test produces VERDICTS/scenarios. Neither pushes source — the rebase-push/SHA-comment contract is largely inapplicable. The "done signal" for a doc/verdict task must be defined differently (artifacts committed + episode marker), not a code-push SHA.

## inconsistency_risk_signals (carry verbatim into the research brief; grill consumes these)
- Verdict-agent vocab clash: test/SKILL.md writes `manual_verdict.agent` as `test-worker`; the planning skill Phase C seeds `agent: tester`; the Multica roster names `tester`, not `test-worker`/`test-architect`/`test-scout`.
- Scenario-schema drift: `hive/references/test-scenario-schema.md` uses `invocation`/`pre_conditions`/`expectations`/`sandcastle_mode_override`; the SKILL + loader (`loadScenario`) use `mode`(`spec-walk`|`implementation-walk`)/`steps[{action,expected}]`/`preconditions`/`postconditions`. Two divergent scenario shapes.
- Mode-enum scope: the `mode_decision` enum is code-path-specific (carries story + parallel-gate semantics); the planning and test skills have no equivalent dispatch atom — mirroring needs a new seam, not reuse.
- Spawn-path duality: planning-routing models only direct vs codex; a Multica path would be a third spawn mode with no current fallback wiring.
- Squad↔roster mismatch: squads.yaml references test-architect/test-scout/security-reviewer; confirm in agents.yaml before assuming squad-as-cell is dispatchable.
