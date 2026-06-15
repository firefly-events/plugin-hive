# Design Discussion — `actual-manual` test tier (vision-cursor flow runner)

> Streamlined plan: the design is **settled by the spike** (`~/Code/spikes/actual-manual-cursor`,
> Arm D commit `7b0ff06`, KEEP). This doc is the design *record*, not a re-derivation. Decisions
> below are locked; the epic is a build-out, not an exploration.

## §0 Prelude
- Spike writeup: `~/Code/spikes/actual-manual-cursor/results/RESULT.md` (Arms A–D).
- Project memory: `project-actual-manual-test-mode` (integration-seam + all findings).
- git_flow: base `develop`, per-epic branch `feat/actual-manual-tier`.

## §1 Goal
Add an `actual-manual` test tier: a **vision-cursor that drives a full flow like a human and
verifies the result of each action** (trust through validation). NOT a visibility checker —
Playwright/Appium/Maestro already assert presence. The tier earns its place by (a) clicking
real coordinates grounded from pixels (catches render-fidelity failures the DOM lies about)
and (b) per-step outcome verification (did the action actually do what it should).

## §2 Settled architecture — PARENT, not sibling
The vision-cursor **parents** the platform's native runner:
- Native runner (Playwright web / Maestro mobile) executes mechanical primitives
  (fill / tap-by-selector / goto / scroll) — deterministic, cheap.
- Vision does only what native can't: (a) selectorless clicks grounded by pixels + real
  pointer; (b) per-step result verification.
Selective, not total — vision activates only at the gaps. Reuses mature native primitives.

## §3 Locked decisions (do not re-litigate)
1. **Model = local Qwen2.5-VL-7B via Apple MLX** (free / on-device / private). Grounds ~10px;
   lands honest clicks with DOM-snap OFF. Cloud rejected (cost/privacy at tier scale; vanilla
   GPT-4o/Claude weak at grounding anyway).
2. **Decouple LOCATE from "visible".** Grounding asks coords-only; the model self-reports
   visibility unreliably (grounded Post Now to 6px yet flagged `visible:false`). "Did it work"
   is the outcome-based verify, not a self-reported flag.
3. **Per-step verify is HYBRID.** Vision verify + an authoritative truth-signal where the step
   declares one (`cta_enabled`=DOM not-disabled, `posted`=network request). Truth-signal
   authoritative; vision recorded alongside; divergence is itself signal. Proven necessary:
   vision can't read enabled-state, and ephemeral toasts vanish before the screenshot.
4. **Two-pass grounding** (fullPage glance → scroll target to viewport center → precise
   viewport ground → click), retry ≤3 for reflow-happy SPAs. DOM-snap OFF by default
   (`SNAP_R=0`) to stay true-manual.
5. **Zero new scenario schema.** Existing Hive scenario already has `action`+`expected` per
   step; `expected` IS the verify checkpoint. A thin native-dialect overlay
   (`flow-bindings.json`) maps each step → native|vision + setup primitives + truth-signal.
   Scenario gains a `live-walk` mode value.

## §4 Integration seam
Registers like multica/sandcastle: `mode_decision: actual` via `HIVE_TEST_MODE=actual` (env) or
`hive.config.yaml test.mode: actual` (config), env-over-config. New atomic skill
`skills/hive/skills/test-mode-actual/` mirroring `test-mode-multica`. The vision-cursor parent =
a new executor wrapping the existing Maestro/Playwright runners (test-swarm already routes
mobile=Maestro, web=Playwright per `hive/references/test-swarm-architecture.md`). test-architect
authors the native script + the `verify:`/`vision_tap` overlay; test-worker drives it. Purely
additive — simulated-manual and existing runners untouched. Verdict stays story-YAML
`manual_verdict`.

## §5 Language policy
The runner is a **named bridge surface** (Node: Playwright + MLX HTTP client) — must be declared
in the charter (`CLAUDE.md`) and root `package.json` dep-scoped (playwright). The MLX Qwen
sidecar lifecycle is Python (canonical) where it can be; the in-runner MLX call stays Node.
Grounding/verify *logic* that can be Python (parsing, truth-signal evaluation helpers) should be.

## §6 Scope (this epic — web-first)
1. Bridge-surface charter declaration + dep scoping.
2. Flow-bindings overlay schema + reference doc.
3. Scenario `live-walk` mode in `hive/lib/scenarios/load.mjs`.
4. Flow-runner bridge (port spike runner: locate/verify/truth split, two-pass grounding).
5. MLX Qwen sidecar lifecycle/readiness.
6. `mode_decision: actual` registration in test-dispatch.
7. `test-mode-actual` atomic skill.
8. test-architect authoring guidance (overlay).
9. User docs (README Quick Start + operations-guide).

## §7 Open items (flagged, NOT in this epic)
- **MLX server provisioning on CI/headless** — the tier needs a running MLX Qwen server;
  CI/headless provisioning is unsolved. am-5 handles local lifecycle only; CI is a follow-on.
- **Cross-runner (Maestro/mobile) binding** — not yet spiked; spike is web/Playwright n=1.
  Mobile binding is an explicit follow-on slice, NOT this epic.
- **B1 overlay bug class dropped** — a transparent overlay is epistemically invisible to vision
  too; it was an unfair test. Excluded from fixtures; redesign before citing.

## §8 Scale
**Medium.** 9 stories, multi-file, one new bridge surface + one atomic skill + schema + load.mjs
change + docs. No migration, no multi-system. H/V + structured outline skipped (design pre-settled).
