# Vertical Plan — autonomous-cycle-loop

Minimum cross-stack increments. Each slice leaves the product in a working state.

## Slice S0 — Schema + config bump (cross-cut foundation)

Ships once before A/B/C/D so slices don't fight over the same files.

- `hive.config.yaml` (shipped baseline) — append the four new knobs from horizontal-plan §L1 with their defaults. Documented in commentary.
- `hive/references/story-yaml-schema.md` — add `terminal_handoff:`, `visibility:`, `manual_verdict:` sections (forward-compatible; absence = today's behavior).
- `hive/references/cycle-state-schema.md` — add `handoff_log:` + `routing_decisions:` blocks.
- `hive/references/sandcastle-mode.md` — NEW, documents the env-var contract.
- `hive/references/test-scenario-schema.md` — NEW.

Working state after S0: existing skills/workflows continue to read the new schemas as additive; no behavior changes.

## Slice A — Interactive Standup

Goal: `/standup --interactive` lets the operator route open queue items.

- A1: `skills/standup/SKILL.md` — add Phase 1.5 (Interactive Routing) + `--interactive` flag parsing + config knob plumb.
- A2: `hive/workflows/steps/daily-ceremony/interactive-routing.md` — NEW step file describing the per-item routing prompt + the visibility heuristic.
- A3: `hive/lib/external/github-issues-adapter.js` — add `labelExistingIssue` helper; reuse `publishStoriesToIssues` for the "migrate local story → GH issue" path.
- A4: Cycle-state writeback — append `routing_decisions[]` after the routing pass.

Working state after A: operator can run `/standup --interactive` and route open items to GH (autonomous), keep-local (human-observed), or defer.

## Slice B — Sandcastle Planning

Goal: a maintainer labels a GH issue `hive:plan`, sandcastle runs `/plan`, opens a planning PR.

- B1: `hive/references/sandcastle-mode.md` already in S0; `skills/plan/SKILL.md` — detect `HIVE_SANDCASTLE_MODE=1`; all "present to user" steps switch to artifact-write + log.
- B2: `.github/workflows/hive-dispatch.yml` — extend trigger to `hive:plan`; `derive` emits `mode_decision`; `run` branches.
- B3: bridge (`.github/scripts/sandcastle-hive-bridge.mts`) — when `mode_decision: plan`, invoke `/plan` against issue body, open `[plan] <epic-id>` PR carrying only the epic dir + gitignore allowlist edit.
- B4: integration validation — fixture issue labeled `hive:plan` produces expected PR artifacts.

Working state after B: a maintainer can dispatch planning into sandcastle; the human review surface is the resulting PR.

## Slice C — Simulated Manual Testing

Goal: `/test --simulated-manual <story-id|scenario-file>` walks a natural-language scenario and writes a verdict.

- C1: `hive/lib/scenarios/load.mjs` — NEW. Validates against schema in S0.
- C2: `hive/workflows/steps/test/simulated-manual.md` — NEW step file describing executor protocol (spec-walk vs implementation-walk; per-step pass/fail; overall verdict; cycle-state writeback).
- C3: `skills/test/SKILL.md` — add `--simulated-manual` argument parsing + dispatch to the new step.
- C4: `.pHive/cross-cutting-concerns.yaml` — add `simulated-manual` concern definition (applies_when, planning_prompt, implementation_checklist).
- C5: `skills/plan/SKILL.md` step 14 wiring — when concern fires, inject the optional `scenario` step into the story's workflow YAML.

Working state after C: operator (or sandcastle bridge) can run `/test --simulated-manual <story-id>` against any story carrying the simulated-manual concern.

## Slice D — Execute → Test/Review Handoff

Goal: `/execute` reads `terminal_handoff.next` on each story and chains into `/test` and/or `/review` automatically.

- D1: `hive/lib/handoff/dispatch.mjs` — NEW. Spawns the named skill with the story branch / PR as `$ARGUMENTS`; enforces timeout; returns verdict summary; emits `phase_handoff` triple.
- D2: `skills/execute/SKILL.md` — add post-integrate handoff step reading `story.terminal_handoff.next` (or `epic.execution.terminal_handoff_default`).
- D3: `hive/references/story-yaml-schema.md` already covers `terminal_handoff:` in S0; `epic.yaml` schema picks up `execution.terminal_handoff_default:` here.
- D4: cycle-state writeback to `handoff_log[]`.

Working state after D: operator can mark a story or epic for auto-test-then-review; /execute fires the handoffs at story boundary.

## Dependency edges

```
S0 → A
S0 → B
S0 → C
S0 → D
A, B, C, D run independently after S0.
```

S0 must merge first. A/B/C/D can land in any order or in parallel (with discipline — same-file conflicts are minimal because slice ownership is clean).

## Vertical invariant

Each slice ships an end-to-end usable feature:

- After S0: schema bump, no behavior change.
- After A: interactive standup works without B/C/D.
- After B: sandcastle planning works without A/C/D.
- After C: simulated manual testing works without A/B/D.
- After D: execute handoff works without A/B/C.

No half-wired states between slices.
