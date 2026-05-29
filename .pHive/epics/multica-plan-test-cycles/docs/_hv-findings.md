# TPM delivery findings — scratch input for horizontal-plan + vertical-plan

## A. Horizontal layers (every surface that changes)
1. Dispatch lib — `hive/lib/multica-story-dispatch/index.mjs`: add `dispatchStoryToSquad` sibling (or confirm `dispatchStoryToAgent` covers per-persona fan-out).
2. Episode/poll lib — `hive/lib/multica-story-dispatch/episode-sync.mjs`: extend marker terminal for doc/verdict tasks (no SHA carrier); reuse `pollTaskUntilTerminal` + `writeMulticaRunEpisode`.
3. Plan mode atom (new) — `skills/hive/skills/plan-mode-multica/SKILL.md`, symmetric with `execute-mode-multica`.
4. Test mode atom (new) — `skills/hive/skills/test-mode-multica/SKILL.md`.
5. Planning-routing spawn path — `skills/hive/skills/planning-routing/SKILL.md` Step 0.3: add `multica` as third spawn mode + fallback (multica→codex→direct) + INFO-log vocab.
6. Dispatch mode-decision — `skills/hive/skills/execute-dispatch/SKILL.md` pattern reused; plan/test atoms need their own thin mode-resolve (env `HIVE_*_MODE` / config `execution.mode`).
7. /plan wiring — `skills/plan/SKILL.md` Phase 0 invocation of planning-routing.
8. /test wiring — `skills/test/SKILL.md` execution section + `hive/workflows/steps/test/simulated-manual.md` (executor contract).
9. Scenario schema + loader — `hive/references/test-scenario-schema.md` ↔ `hive/lib/scenarios/load.mjs` (`loadScenario`): reconcile `invocation/expectations/pre_conditions` vs `mode/steps[{action,expected}]/preconditions`.
10. Verdict location — pick canonical home: `.pHive/cycle-state/<id>.yaml` vs story `manual_verdict` block; unify `agent` name (`tester`, not `test-worker`).
11. Done-signal/marker shape — defined in episode-sync marker schema (artifacts-committed + episode-terminal).
12. Substrate confirmation — `.pHive/multica/squads.yaml` + `agents.yaml`: confirm `planning-team-squad` + `verify-team-squad` member roles seeded.
13. Bootstrap — `skills/multica-init/SKILL.md` + `hive/lib/multica-bootstrap/index.mjs` (prerequisite, no change expected).

## B. Vertical slices (ordered, each demoable)

**Slice 1 — Squad-as-cell spike (FORK POINT).**
- goal: prove whether Multica fans a squad task across member-agents or runs leader-only.
- stories: assign throwaway task to `planning-team-squad`; observe agent assignment + provider used; record carrier verdict (squad-as-unit vs per-persona fan-out); confirm squad member roles exist in `agents.yaml`.
- working-state: a documented spike verdict that picks the carrier for Slices 4–6.
- depends_on: — (bootstrap live).

**Slice 2 — Scenario-schema + loader reconciliation.**
- goal: one canonical scenario shape; loader validates it.
- stories: reconcile schema doc ↔ `load.mjs`; migrate existing scenarios; loader tests.
- working-state: `loadScenario` accepts the single shape; `/test` parses without drift.
- depends_on: — (parallel to Slice 1).

**Slice 3 — Verdict-location + done-signal/marker shape.**
- goal: pin verdict home, agent name, and doc/verdict terminal marker.
- stories: choose cycle-state vs story-YAML; unify `agent: tester`; define marker (artifacts + episode-terminal) in `episode-sync.mjs`.
- working-state: a marker a poller can drive to terminal for non-SHA tasks.
- depends_on: Slice 2.

**Slice 4 — Plan-half dispatch (`plan-mode-multica` + routing path).**
- goal: `/plan` dispatches its team via Multica.
- stories: build `plan-mode-multica` atom; add third spawn path + fallback in planning-routing; wire Phase 0; apply backend split per spike carrier.
- working-state: `/plan` produces docs via Multica end-to-end.
- depends_on: Slice 1 (carrier), Slice 3 (marker).

**Slice 5 — Test-half dispatch (`test-mode-multica`).**
- goal: `/test --simulated-manual` dispatches via Multica.
- stories: build `test-mode-multica` atom reusing dispatch+poll; wire `/test` + `simulated-manual.md`; write verdict to canonical home.
- working-state: a Multica `tester` replays a scenario and writes a verdict.
- depends_on: Slices 2+3 (hard gate), Slice 1, Slice 4 (lib glue).

**Slice 6 — Full cycle integration (plan→execute→test).**
- goal: prove the cycle: plan via Multica, /execute, test verifies the build matched the plan.
- stories: run the loop on one demo workstream; enforce single-shared-branch/serial-trunk; capture episodes.
- working-state: one workstream planned, built, and verified through Multica.
- depends_on: Slices 4+5.

## C. Sequencing rationale
- Slice 1 forks the plan: the spike verdict decides squad-as-unit vs per-persona fan-out — every dispatch design in 4–6 inherits it and the Codex/Claude backend split (grill C1/C2). Runs first; blocks 4–6.
- Slices 2+3 are the locked hard gate: schema drift + done-signal gap (grill HIGH) make any test dispatch un-pollable; Slice 5 cannot start until both land.
- Plan-half before test-half mirrors the plan→execute→test cycle and lets Slice 4 exercise the new routing path on read-only docs (lower branch-contention) before test introduces verdict writes.
- Slice 6 last because end-to-end proof needs both halves and a real /execute in the middle.

## D. Per-slice risks
- S1: squad may run leader-only, silently dropping the backend split. Contained: throwaway task, no production wiring; verdict gates 4–6.
- S2: scenario migration breaks existing scenarios. Contained: loader tests + migrate-in-place before any dispatch consumes it.
- S3: wrong canonical verdict home strands a downstream reader. Contained: doc-only decision; nothing dispatches until pinned.
- S4: third spawn path lacks fallback on daemon-down. Contained: multica→codex→direct fallback shipped in the slice; docs read-only so trunk contention low.
- S5: `tester`/`test-worker`/`test-architect` name mismatch breaks `resolveAgentUuidByName`. Contained: S3 unifies the name; S1 confirmed roster.
- S6: parallel plan+test cells contend on one branch. Contained: enforce serial-against-trunk fresh-checkout/rebase-push; single agent per role keeps execution serial.
