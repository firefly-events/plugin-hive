# Design Discussion — wire /execute through Multica + Codex routing (revised)

> **Revision:** revised 2026-05-25T17:15:00Z to address grill findings P1 (Phase 1/2 conflation) and C1+U1 (per-story PR vs serial dispatch). Five grill findings resolved into draft changes; three (H1, H2, H3+H4) carry forward as accepted-deviation flags or in-story checks.

## 1. What Are We Doing?

Close the gap between the `/execute` skill machinery and what actually runs when a Hive epic ships through the Multica runtime. Today the orchestrator can resolve `mode_decision=multica` from `execute-dispatch` but the `/execute` skill text has no routing case for it — so `execute-mode-multica` never gets invoked, and the orchestrator falls through to inline HTTP+git scripting (as it did for meta-improvement-reset on 2026-05-25, bypassing the dispatch lib, episode-sync, tracker dispatch, scope-drift emit, and Codex backend routing). Done looks like: a fresh 2-story dummy epic starts with `/execute <id>`, fires `execute-dispatch`, routes through `execute-mode-multica`, dispatches the existing Claude-runtime developer agent serially per story, the inner Claude Code session invokes `/codex:rescue` against the story spec (instructed by an updated brief), commits land one-per-story on the epic branch, episode markers write via `writeMulticaRunEpisode`, and `scope_drift` emits once per story close — all without orchestrator-side cherry-pick rescue.

## 2. What I Found

The substrate-half is built. `skills/hive/skills/execute-mode-multica/SKILL.md` exists with a coherent Step 0/1/2/3 contract. `hive/lib/multica-story-dispatch/index.mjs` exports `serializeStoryBrief` (line 140), `resolveAgentUuidByName` (170), `ensureIssueBriefMatches` (200), `dispatchStoryToAgent` (211), `moveOutOfBacklogIfNeeded` (219). `hive/lib/multica-story-dispatch/episode-sync.mjs` exports `pollTaskUntilTerminal` (123) and `writeMulticaRunEpisode` (229). `hive/lib/scope_drift.py` exposes `emit_scope_drift`. `execute-dispatch/SKILL.md` already returns `multica` as a valid `mode_decision`.

The plugin-half has a one-line gap (no `multica` routing case in `/execute` step 5) plus a half-finished `execute-mode-multica` skill text whose Step 2 still says "s4 not yet implemented" even though `episode-sync.mjs` shipped. The `serializeStoryBrief` brief lacks any signal that would tell the inner Claude Code session to use `/codex:rescue` for code work — required for Phase 1 routing per the locked alignment.

**Phase 1 routing semantics** (locked 2026-05-25, confirmed against grill P1): `agent_backends[role] = codex` means "dispatch the existing Claude-runtime `<role>` agent AND inject a `/codex:rescue` instruction into the brief." It does NOT mean "swap to a separate Codex-runtime agent variant" — that's Phase 2 (native Codex agents in Multica), split as a follow-on epic and out of scope here. The implication is that Phase 1 needs zero new Multica agent bootstrapping, zero new agent-resolution helper logic, and zero changes to `dispatchStoryToAgent`'s signature; the routing decision is brief-level only.

**Serial dispatch within DAG depth** (resolved against grill C1+U1): the meta-improvement-reset push race was a self-inflicted bug — the orchestrator dispatched three depth-0 stories concurrently to a workspace with one developer agent. Multica serialized them internally anyway, but the parallel dispatch created three concurrent push targets on `feat/<epic>`. `execute-mode-multica` should dispatch stories **serially** (one at a time, even at the same DAG depth) for Phase 1. This preserves the `feedback_git_flow_per_epic` convention (one branch per epic, one commit per story) with no PR-per-story machinery and no cherry-pick rescue. Future epics with multiple parallel agent variants (Phase 2 territory) can revisit.

## 3. My Proposed Approach

Five stories, serial chain (s1 BLOCKER → s2 skill rewire → s3 brief injection → s4 telemetry → s5 smoke test).

**s1 — Add `multica` routing case to `/execute`.** Append one entry to step 5's dispatch enum (`multica`) and one block to step 6 (call it 6e for parity with sandcastle's 6d). The block invokes `execute-mode-multica` with the standard inputs: `workflow_path`, `unblocked_stories[]`, `appends_map`, `epic_handle`, `hive_config`. Single-skill change, ~15 lines added.

**s2 — Refit `execute-mode-multica` skill text + add serial dispatch + wire episode-sync.** Drop the "s4 not yet implemented" stub (lines 167-170). Replace Step 1's per-story dispatch description so it explicitly serializes — "dispatch one story at a time; await terminal before next dispatch within the same DAG depth." Replace Step 2's stub with the real `pollTaskUntilTerminal({serverUrl, token, workspaceId, issueUuid, storyId, maxWallClockMs, pollIntervalMs, messagesCaptureMax, onStateTransition})` call shape. Replace Step 3's prose with the `writeMulticaRunEpisode({epicHandle, storyId, terminalStatus, issueMetadata, dispatchedAt, terminalAt, ...})` call. Mark sidecar v2 as DEFERRED (already noted at lines 22, 206, 209, 310 — preserve as-is).

**s3 — Brief injection for `/codex:rescue` instruction.** Extend `serializeStoryBrief` (index.mjs:140) to accept an optional `codexInstruction: boolean` argument (named-options object form to avoid positional-arg ripple). When true, inject a section after Goal: `## Use /codex:rescue\nThis story is routed through the Codex backend. Invoke /codex:rescue with the story spec for implementation work.` Caller (execute-mode-multica Step 1) reads `agent_backends[role]` and passes `codexInstruction: true` when the configured backend is `codex`.

**s4 — Wire `scope_drift` emit at story close.** Inside `execute-mode-multica` Step 3 (after `writeMulticaRunEpisode` returns), call `emit_scope_drift(run_id, phase_label='execute:story', expected_scope, delivered_scope, delta_reasons, story_id, skill='execute')`. Inputs source from the story's cycle-state phase_records or the brief acceptance criteria.

**s5 — Smoke test 2-story dummy epic end-to-end.** Hand-roll a dummy epic at `.pHive/epics/smoke-test-execute-multica-codex/` with two trivial stories (s1 creates `.pHive/smoke/marker.txt`, s2 appends one line). Invoke `/execute smoke-test-execute-multica-codex`. Verify: telemetry line emitted, `execute-mode-multica` skill text reached, brief includes `/codex:rescue` section, episode markers land via `writeMulticaRunEpisode`, two `scope_drift_score` events fire, two commits land one-per-story on `feat/smoke-test-execute-multica-codex` with no manual cherry-pick.

## 4. What Could Go Wrong

**[high] Inner Claude Code session may not have codex plugin loaded** (grill H2, carry-forward). Phase 1 hinges on `/codex:rescue` being available inside the Multica-spawned Claude Code. If the codex plugin loads from user-level config rather than project workdir, the inner session may have a different plugin set than the orchestrator. Mitigation: s5 smoke test must include a pre-flight check that lists available skills inside the inner session BEFORE dispatching the first dummy story. If the check fails, the smoke test reports the gap and stops — the production wiring is correct, the precondition just isn't met yet (operator fix: install codex plugin in the Claude Code config Multica uses).

**[high] `gh pr merge --auto` queue characteristics — N/A under serial dispatch** (grill H1 resolved by the serial-dispatch decision; no PR-per-story machinery means no queue at all).

**[medium] `/execute` step 6e numbering convention** (grill V1 partial). Adding "6e" matches the alphabetical-after-semantic pattern set by 6c/6b/6d. Doesn't change behavior; flagged in case a future reader prefers a dispatch-table refactor.

**[medium] serializeStoryBrief signature evolution** (grill H4 / brief signal #3). Using a named-options object for `codexInstruction` keeps the call site backward-compatible. New callers opt-in by passing the option; old callers continue to receive the brief without the injection. Risk surface is minimal.

**[medium] Sidecar v2 stays DEFERRED** (grill notes). The execute-mode-multica skill already flags sidecar v1 as a log-only path. s2 preserves that posture — no sidecar dispatch is added.

**[low] meta-improvement-reset commits (10 of them on `feat/meta-improvement-reset`)** are NOT migrated here. This epic is on its own `feat/wire-execute-multica-codex` branch off `develop`. Meta-improvement-reset will land via its own PR to develop independently.

## 5. Dependencies and Constraints

External: none. All changes local to plugin-hive's own skills + lib. `gh` CLI required for the s5 smoke test (already a hard dep). `multica` CLI required for talking to the workspace (already installed at `/opt/homebrew/bin/multica`).

Internal: nothing blocking. Phase 1 routing is intentionally orthogonal to `codex-invoke` PoC graduation work — the `/codex:rescue` invocation happens inside the inner Claude Code session, not from the orchestrator.

Time-sensitive: nothing. `develop` is staging-trunk per `feedback_seek_direct_push_auth`; merges go via `feat/wire-execute-multica-codex` → `develop` PR after epic completes.

Phase 2 follow-on (deferred, NOT scoped here): native Codex agents in Multica without the Claude wrapper. Would require Multica bootstrap extension, `<role>-codex` agent variants, `resolveAgentForRole` helper, agent-variant dispatch routing. Planned as a separate epic when Phase 1 is shipped + validated.

## 6. Open Questions

1. **Inner-session plugin presence check** — should the precondition land in `execute-mode-multica` Step 0 (gate every multica run) or only in the s5 smoke test (one-time validation)? Leaning Step 0 — small surface, catches operator misconfiguration early. Confirm during s2.
2. **TaskTrackingDispatch step 7b for multica adapter** — when adapter is multica, `updateStatus` round-trips to the same daemon that already manages issue lifecycle. Probably no-op or pass-through. Verify in s2 + document explicitly. Not blocking.
3. **scope_drift expected/delivered scope source** (s4 detail) — pull from story's `acceptance_criteria` (the planning intent) and the episode marker's `notes` field (the developer's delivered description)? Or require structured `delivered_scope` capture in the brief response? Leaning the former for s4 simplicity; refine in a follow-on if signal quality is low.

## 7. Verification Strategy

VERIFICATION PLAN:
  Tools: node:test for lib changes (serializeStoryBrief signature + brief output assertions); manual end-to-end via s5 smoke test for the full pipeline
  Platforms: macOS dev (no cross-platform concerns)
  Automated: serializeStoryBrief unit tests in `hive/lib/multica-story-dispatch/__tests__/` covering both injection-on and injection-off paths; skill text changes get no automated coverage (markdown)
  Manual: s5 end-to-end run — invoke `/execute smoke-test-execute-multica-codex`, verify telemetry line, verify two stories dispatched serially (not parallel), verify briefs include `/codex:rescue` section, verify episode markers land via `writeMulticaRunEpisode`, verify two `scope_drift_score` events, verify two commits on `feat/smoke-test-execute-multica-codex`, verify zero orchestrator-side cherry-pick rescue
  Not verifying: Phase 2 native-codex flow (out of scope); load testing (single-machine scope); cross-runtime fallback (no codex runtime variant in scope)

## 8. Scale Assessment

SCALE ASSESSMENT:
  Files affected: ~6 (3 SKILL.md updates [/execute, execute-mode-multica, possibly multica/index.mjs's brief test], 1 lib edit [serializeStoryBrief signature], 2 smoke epic YAMLs)
  Subsystems: /execute skill machinery, execute-mode-multica skill, serializeStoryBrief brief template, scope_drift wiring
  Migration required: no — additive routing case, additive brief injection (default-off), additive scope_drift call
  Cross-team coordination: no
  Unknowns: 1 (whether the inner Claude Code spawned by Multica has codex plugin loaded — gated in s5)

  RECOMMENDATION: Proceed to stories (SMALL scope)
  RATIONALE: 5 stories, serial chain, ~6 files touched, single subsystem cluster. No H/V planning needed — there are no horizontal layers to coordinate beyond skill/lib/test. No structured outline needed — the story descriptions plus their methodology steps carry all required detail. The one remaining unknown (inner plugin presence) is checkable inside the smoke test rather than upfront.
