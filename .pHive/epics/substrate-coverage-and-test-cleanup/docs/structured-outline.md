# Structured Outline — substrate-coverage-and-test-cleanup

**Epic:** substrate-coverage-and-test-cleanup (Part 2 of cc-workflows-first-party)
**Phase:** B3 — Structured Outline (technical-writer)
**Author:** technical-writer
**Date:** 2026-06-05
**Inputs consumed:** vertical-plan.md, horizontal-plan.md, design-discussion.md (rev. 1), research-brief.md, grill-record.md, collab-review-record.md, hv-collab-review-record.md
**Branch:** `feat/substrate-coverage-and-test-cleanup` off `develop` — one commit per story.

---

## Part 1: Executive Summary

### What we are building and why

Every dispatching slash skill in Hive — `/plan`, `/execute`, `/test`, `/design`, `/design-review`, `/review` — must reach full **Multica + cc-workflows mode coverage**. Today only `/plan` and `/execute` ship both substrate variants. `/test` has Multica only. `/design`, `/design-review`, and `/review` have neither. This epic closes the dispatch parity matrix while folding three semantic alignments surfaced during cc-workflows-first-party (Part 1) into the same drop:

1. `/test` becomes a swarm-only pipeline — the `--simulated-manual` exclusive flag is **hard-ripped**, scenario-replay folds in as a step inside the swarm (`step-04b`), and the `step-06-triage` step file bounces a story tracker to `needs-rework` when triage classifies a failure as a real `story-issue` (not transient, not human-blocker).
2. `/design` grows from a single `ui-designer` dispatch into a 3-persona pipeline. **Pattern B + `--include-constraints` toggle** is now the locked posture (user decision): default invocation preserves legacy single-persona behavior; the toggle routes through specialist-triggers to add accessibility-specialist + animations-specialist as a constraint pass before a single ui-designer dispatch with constraints baked into the prompt.
3. `/design-review` keeps its original intent (audit shipped designs); substrate parity adds Multica + cc-workflows variants with **no semantic change**.

### How the user's feedback changed or confirmed the approach

User-locked decisions (binding inputs to this outline) reshaped four points relative to the draft design-discussion:

- **ABI shape (Q2):** new method `markNeedsRework({id, reason})` on `TaskTrackingDispatch`. NOT extending `updateStatus`. NOT renaming Multica's `updateStory`. Architect's option (c) wins.
- **/design posture (Q6):** Pattern B + `--include-constraints` toggle. Default-off keeps the simple case behaviorally identical to today; the toggle is the composable substrate escape hatch.
- **Audit recovery (Q4):** 0.5-day spike as **Slice 0**, BEFORE Phase C story-writing. Three-branch decision (locate / re-run / accept single-citation risk) closes the constraint.
- **Worktree isolation (Slice E split):** absorbed into the foundation slice (now Slice 1) as `s-4 cc-workflows-preconditions` shared helper plus a lint sub-step. Slice 1 within-slice commit order is **locked**: s-2 → s-4 → s-3.

The H/V collab review surfaced two further locks now binding on this outline:

- Slice 1 within-slice commit order: s-2 (mode-resolver + execute-dispatch refactor) → s-4 (cc-workflows-preconditions + back-fit to existing 2 atoms) → s-3 (lint). Reverse order causes lint to fail on missing imports.
- Slice 3 d-1 acceptance criteria must split into **3 named subsections** (Phase A structural insert / Pattern B toggle semantics / 3-persona handoff payload) inside a single story.

### Key decisions now locked

| # | Decision | Source | Effect |
|---|---|---|---|
| 1 | New `markNeedsRework({id, reason})` ABI method | User decision; architect ESCALATION; Q2 resolved | t-2 AC writes against a stable contract |
| 2 | Pattern B + `--include-constraints` toggle | User decision; Q6 resolved; posture-mismatch P1 resolved | d-1 AC carries toggle semantics; default-off preserves legacy single-dispatch |
| 3 | Audit recovery is Slice 0 (0.5d spike before story writing) | User decision; Q4 resolved | Slice 0 closes before Phase C; three-branch outcome documented |
| 4 | Slice E → Slice 1 (foundation) + Slice 6 (governance) | User decision; H/V plan reorganization | Foundation lands first; governance closes last; substrate slices 2–5 are parallel-eligible between them |
| 5 | Slice 1 commit order: s-2 → s-4 → s-3 | hv-collab-review architect | Helper extracts land before lint asserts on missing imports |
| 6 | d-1 AC splits into 3 named subsections | hv-collab-review architect | Three-in-one verification drift prevented |
| 7 | Wireframe handoff payload = PNG + .f0 + bundled constraint doc | User decision; Q9 resolved | d-5 AC bakes this in; downstream consumers know what to expect |

### Overall implementation strategy (5 sentences)

Land Slice 0 first as a 0.5-day audit recovery spike that closes Constraint 5 dual-citation or accepts single-citation explicitly. Then ship Slice 1 (foundation: shared mode-resolver helper, shared cc-workflows-preconditions helper, multi-surface no-codex lint) in a locked commit order so existing skills become helper-consumers in lockstep with the helpers shipping. Run Slices 2–5 (per-substrate end-to-end coverage of /test, /design, /design-review, /review) in parallel where the planning runtime permits; serialize as +3–5 days schedule cost if parallel dispatch surfaces issues. Slice 6 closes with the dispatch-parity matrix that reads paths from Slices 1–5 and asserts every cell green. The whole epic ships behind one branch (`feat/substrate-coverage-and-test-cleanup` off develop) as 19 commits — one per story.

---

## Part 2: Detailed Approach

Each phase below corresponds 1:1 to a V-plan slice. Phases describe the work; the file manifest in Part 4 enumerates every touch.

### Phase 0 — Audit recovery (= Slice 0)

**Goal:** Close the missing `cc-workflows-smoke-1780516800.yaml` audit blocker so Constraint 5 (gate-ownership invariant) either re-attains its dual-citation grounding or is explicitly accepted as a single-citation risk with the rationale captured.

**Stories:** `a-0-audit-recovery` (1 story)

**Depends on:** Nothing. Pre-flight only.

**What works after this step:** Either (a) `cc-workflows-smoke-1780516800.yaml` is located and copied into `.pHive/audits/post-run/`, (b) a fresh smoke run produces a new audit under an ISO timestamp, or (c) `audit-recovery-decision.md` documents an explicit single-citation acceptance with the rationale written down. In all three branches, design-discussion §5 Constraint 5 is reconciled with reality before Phase C story authoring begins.

**Key activity:**
- Re-walk the audit artifact directory and any sibling locations the smoke may have been written to.
- If not found, run the cc-workflows smoke locally and produce a fresh audit using the existing `.pHive/audits/post-run/` naming convention.
- If neither (a) nor (b) is feasible within the 0.5-day budget, write `audit-recovery-decision.md` accepting the single-citation risk and update the design-discussion §5 Constraint 5 narrative to point at the decision doc.

**Why this is its own slice:** Constraint 5 is the gate-ownership invariant for the whole epic. If it rests on a single citation, the substrate-coverage slices proceed without one of two corroborating sources. Either resolution is acceptable; an unsurfaced single-citation is not.

**Acceptance signal:** `ls .pHive/audits/post-run/` shows either the recovered or freshly-generated audit OR `.pHive/epics/substrate-coverage-and-test-cleanup/docs/audit-recovery-decision.md` exists with the accept-risk rationale.

---

### Phase 1 — Foundation: shared helpers + lint (= Slice 1)

**Goal:** Three foundation artifacts exist, pass tests against the EXISTING skill set (plan-mode-cc-workflows, execute-mode-cc-workflows, plan-dispatch, execute-dispatch), and are importable by the net-new substrate slices that follow. Foundation is unconsumed by net-new artifacts in this slice; those land in Slices 2–5.

**Stories (within-slice commit order LOCKED):** `s-2-mode-resolver` → `s-4-cc-workflows-preconditions` → `s-3-no-codex-lint` (3 stories)

**Depends on:** Slice 0.

**Within-slice commit ordering rationale (hv-collab-review architect):**
1. `s-2` (mode-resolver helper + execute-dispatch refactor) must land first because `s-4` and `s-3` are downstream of having helpers in place.
2. `s-4` (cc-workflows-preconditions helper + back-fit to existing 2 atoms) lands second so that when `s-3`'s lint runs against the tree, the existing 2 atoms (plan-mode-cc-workflows, execute-mode-cc-workflows) are already importing the helper.
3. `s-3` (lint script + npm test wiring) lands last so that its assertions are green from commit-time. Reverse order would cause the lint to fail on missing imports.

#### s-2: mode-resolver helper

Extract the 5-tier resolver currently inlined at `execute-dispatch/SKILL.md:46-101` into `hive/lib/mode-resolver.mjs`. Helper signature returns `{decision, sources}` — the second value preserves the field-source telemetry execute-dispatch emits today; without it, callers lose per-tier provenance (architect ESCALATION).

Refactor `execute-dispatch` Step 0 to consume the helper. Snapshot tests against pre-refactor outputs are mandatory because the refactor is behavior-preserving.

Resolver name vars (used by downstream slices, not this story): `HIVE_TEST_MODE`, `HIVE_DESIGN_MODE`, `HIVE_DESIGN_REVIEW_MODE`, `HIVE_REVIEW_MODE`.

#### s-4: cc-workflows-preconditions helper

Create `hive/lib/cc-workflows-preconditions.mjs` exporting `assertWorktreeIsolation()`. The helper asserts `*-mode-cc-workflows` runs are on a dedicated worktree (under `.claude/worktrees/<name>/`), not the main checkout. Throws on main-checkout cwd; passes on isolated worktree.

Back-fit: add helper import + Step 0 helper call to BOTH existing cc-workflows atoms (`plan-mode-cc-workflows`, `execute-mode-cc-workflows`). This is a same-slice modification and the back-fit is mandatory so that `s-3`'s helper-import lint asserts green on the existing tree.

#### s-3: no-codex lint (multi-surface)

Create `hive/scripts/lint-cc-workflows-no-codex.mjs` with three checks:
1. AST-level scan for `agentType:` literal in `skills/hive/skills/*-mode-cc-workflows/SKILL.md` files.
2. Grep for `codex:codex-rescue` skill references inside those paths.
3. Grep for `agent_backends` config keys inside those paths.

Plus a fourth lint sub-step (helper-import): every `*-mode-cc-workflows/SKILL.md` imports `cc-workflows-preconditions.mjs` at Step 0.

Wire the lint into `npm test` via `package.json`.

**Acceptance signal:** Helpers exist; vitest covers the 5-tier resolution and isolation precondition; lint passes "green" against the existing 2 cc-workflows atoms (back-fit confirmed by re-running plan-mode + execute-mode dry-cycle); `npm test` runs lint as part of the suite.

---

### Phase 2 — /test substrate: swarm-only pipeline + bounce-back + cc-workflows atom (= Slice 2)

**Goal:** `/test` runs end-to-end across both Multica and cc-workflows substrates as a swarm-only pipeline. `--simulated-manual` is hard-ripped, scenario-replay runs as `step-04b` inside the swarm, and `markNeedsRework` bounces a real-bug story to needs-rework through whichever adapter is active.

**Stories:** `t-1-fold-simulated-manual`, `t-2-mark-needs-rework-abi` (TDD methodology), `t-3-test-mode-cc-workflows` (3 stories)

**Depends on:** Slice 1 (foundation).

#### t-1: fold simulated-manual into the swarm

`skills/test/SKILL.md` changes:
- Rip `--simulated-manual` flag handling (lines 14-93).
- Rip the inline `HIVE_TEST_MODE` resolver (lines 37-51) and delegate substrate selection to `test-dispatch` (router lands in this slice as part of t-3's L2 surface, see below).
- Add a Phase 0 invocation of `test-dispatch`.
- Update the pipeline table (lines 109-119) to reflect the swarm-only flow.

Create `hive/workflows/steps/test-swarm/step-04b-scenario-replay.md` (NEW step file in the `test-swarm/` convention, per Q1 resolution) that consumes existing `loadScenario` from `hive/lib/scenarios/load.mjs` and sits between step-03-worker and step-04-inspector.

Retire `.pHive/cross-cutting-concerns.yaml` simulated-manual implementation_checklist (lines 99-126) and replace with a `scenario-replay-folded` historical note.

#### t-2: markNeedsRework ABI (TDD methodology)

This is the only TDD-methodology story in the epic per TPM escalation. Order is enforced inside the story:
1. **Adapter contract test first** (`__resetHandleCache` already exists at `task-tracking-dispatch/index.ts:92` for test scaffolding) — defines what `markNeedsRework({id, reason})` returns and what side effects it triggers on each adapter.
2. **Multica adapter implementation:** `markNeedsRework` = `updateStory({status:'in_review'}) + 'hive:needs-rework' label` (canonical Multica state per Q7).
3. **GitHub adapter implementation:** `markNeedsRework` = `reopen issue + 'hive:needs-rework' label` (state machine restriction respected; semantic carried by label).
4. **Dispatch surface:** `hive/lib/task-tracking-dispatch/index.ts` exposes `markNeedsRework` routed via `invoke`; `capability('supports_needs_rework')` advertised so callers can defensive-opt-in.

The TDD ordering is non-negotiable for this story: the two non-symmetric backing state machines (Multica 5-state vs GitHub 2-state) cannot be silently bridged. The contract test forces the symmetry that the adapters must individually deliver.

Step file emit: `hive/workflows/steps/test-swarm/step-06-triage.md` emits `markNeedsRework({id, reason})` when the classification at line 16 is `story-issue`. Transient + human-blocker classifications do NOT emit (preserves existing semantics). Summary block (111-114) extended with `needs_rework_emitted: true/false`.

Persona prose: `hive/agents/test-sentinel.md` describes the bounce-back behavior. No executable change in the persona file (CONTEXT.md step-vs-persona discipline; the contract is in the step file).

#### t-3: test-mode-cc-workflows

Create `skills/hive/skills/test-mode-cc-workflows/SKILL.md` (~330-360 lines, mirrors `plan-mode-cc-workflows`). Dispatch granularity is **per-scenario**, mirroring `test-mode-multica` (architect-resolved Q3). Imports `cc-workflows-preconditions.mjs` at Step 0 (helper from Slice 1).

Also create `skills/hive/skills/test-dispatch/SKILL.md` (~200-250 lines, router consuming `mode-resolver.mjs` from Slice 1). Step 0: invoke shared resolver; Step 1: dispatch to chosen mode atom; Step 2: return `{mode_decision, sources}` so callers can audit provenance.

**Acceptance signal:** `/test` runs on both substrates against a known story-issue scenario; scenario-replay step executes; bounce-back fires; `/test --simulated-manual` returns "unknown flag" (hard-rip confirmed); lint stays green for the new cc-workflows atom; vitest covers adapter contract + scenario-replay loading + resolver outputs.

---

### Phase 3 — /design substrate: Phase A persona pipeline + substrate parity + handoff (= Slice 3)

**Goal:** `/design` runs end-to-end across both Multica and cc-workflows substrates. Default invocation dispatches `ui-designer` once (legacy behavior preserved). `/design --include-constraints` routes through specialist-triggers to add accessibility-specialist + animations-specialist as a constraint pass, then dispatches ui-designer ONCE with constraints baked into the prompt. Wireframe handoff payload arrives at downstream consumers in the bundled shape (PNG + .f0 + constraint doc).

**Stories:** `d-1-phase-a-pattern-b-with-toggle`, `d-2-design-dispatch`, `d-3-design-mode-multica`, `d-4-design-mode-cc-workflows`, `d-5-wireframe-handoff` (5 stories)

**Depends on:** Slice 1 (foundation). Independent of Slice 2.

#### d-1: Phase A insert + Pattern B + toggle (3 AC subsections, single story)

Per hv-collab-review architect lock, d-1's acceptance criteria split into **three named subsections** inside a single story:

##### AC subsection 1: Phase A structural insert

`skills/design/SKILL.md` gains a net-new Phase A above existing step 3 (the current single-dispatch step at lines 55-64). Phase A is a NET-NEW block — `/design` today has no persona-assembly phase to extend.

Phase A AC MUST cite `hive/workflows/design-review.workflow.yaml:8-81` as the orchestration template to mirror. The 4-step assembly+serial-dispatch shape there (accessibility → animations → ui-designer critique → ui-designer synthesis) is the architectural anchor that prevents d-1 from drifting into a re-invention.

Also add Phase 0 to invoke `design-dispatch` and resolve substrate before persona phase.

##### AC subsection 2: Pattern B toggle semantics

Default invocation (no `--include-constraints` flag) preserves legacy behavior: single ui-designer dispatch, no Phase A specialists. This keeps the simple case behaviorally identical to today.

`--include-constraints` flag routes through specialist-triggers to add accessibility-specialist + animations-specialist. When toggle ON: serial dispatch accessibility → animations to produce constraint notes; then ui-designer dispatched ONCE with constraints baked into the prompt.

Toggle off is the composable-substrate-aligned default; toggle on is the escape hatch for screens where accessibility/animation constraints are known relevant up front.

##### AC subsection 3: 3-persona handoff payload

When the toggle is on, the constraint notes produced by accessibility-specialist + animations-specialist are bundled with the ui-designer's PNG + .f0 outputs as the wireframe handoff payload (see d-5 for the payload contract).

#### d-2: design-dispatch router

Create `skills/hive/skills/design-dispatch/SKILL.md` (~200-250 lines). Consumes `mode-resolver.mjs` from Slice 1. Returns `{mode_decision, sources}` to callers.

#### d-3: design-mode-multica

Create `skills/hive/skills/design-mode-multica/SKILL.md` (~400-450 lines, mirrors `execute-mode-multica`). Per-persona dispatch within a team-cell; serial within team-cell; episode markers per persona at `${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/multica-run.yaml`. Multica issue creation surface defaults to one issue per persona (mirrors execute-mode-multica precedent; Q10 explicitly resolved by-default rather than gated).

#### d-4: design-mode-cc-workflows

Create `skills/hive/skills/design-mode-cc-workflows/SKILL.md` (~330-360 lines, mirrors `plan-mode-cc-workflows`). Imports `cc-workflows-preconditions.mjs` at Step 0. No Codex routing (lint from Slice 1 enforces).

#### d-5: wireframe handoff payload

Wireframe handoff at the L6 step layer for downstream consumers. Payload shape **LOCKED (Q9 resolved by user):** PNG + `.f0` + bundled constraint doc. The constraint doc is whatever accessibility-specialist + animations-specialist produced in Phase A when the toggle was on; when the toggle is off, the constraint doc field is empty/absent but the PNG + .f0 always ship.

Documents the payload contract for downstream consumers (design-review, manual review). Bake into d-5 AC.

**Acceptance signal:** Vitest covers skill resolution for both mode atoms; `--include-constraints` flag routes through specialist-triggers; default off invokes single ui-designer dispatch; default on invokes accessibility + animations + ui-designer with constraints baked in; manual: `/design` with toggle OFF produces single ui-designer dispatch (legacy behavior preserved); `/design --include-constraints` produces 2 constraint files (accessibility, animations) before single ui-designer dispatch with constraints baked in; wireframe handoff payload contains PNG + .f0 + constraint doc when toggle on; lint green; helper-import lint green.

---

### Phase 4 — /design-review substrate parity (= Slice 4)

**Goal:** `/design-review` runs end-to-end across both Multica and cc-workflows substrates with NO semantic change. The existing 3-persona pipeline (accessibility → animations → ui-designer critique → ui-designer synthesis) is preserved; `--skip` and `--artifact-target` flags continue to work; substrate selection happens at Phase 0 via `design-review-dispatch`.

**Stories:** `dr-1-design-review-dispatch`, `dr-2-design-review-mode-multica`, `dr-3-design-review-mode-cc-workflows` (3 stories)

**Depends on:** Slice 1 (foundation). Independent of Slices 2 and 3.

#### dr-1: design-review-dispatch router

Create `skills/hive/skills/design-review-dispatch/SKILL.md` (router; consumes `mode-resolver.mjs`). Add Phase 0 invocation of the router to `skills/design-review/SKILL.md`. Reaffirm 3-persona pipeline contract referenced by L3/L4 atoms.

#### dr-2: design-review-mode-multica

Create `skills/hive/skills/design-review-mode-multica/SKILL.md`. Preserves the 4-step workflow.yaml model with 4 `agent()` calls (substrate parity with workflow.yaml structure; Q11 resolved by preferring workflow.yaml-shape parity here for Multica side).

#### dr-3: design-review-mode-cc-workflows

Create `skills/hive/skills/design-review-mode-cc-workflows/SKILL.md`. Same 4-step model. Imports `cc-workflows-preconditions.mjs` at Step 0.

**Acceptance signal:** Vitest covers skill resolution for both mode atoms; lint green; manual: `/design-review` runs on both substrates produce identical artifact set to pre-epic behavior (no semantic change); `--skip` and `--artifact-target` continue to work.

---

### Phase 5 — /review substrate parity (= Slice 5)

**Goal:** `/review` runs end-to-end across both Multica and cc-workflows substrates as solo reviewer (no panel-mode expansion in this epic). The `scope_drift` emit call is preserved when wrapping reviewer dispatch.

**Stories:** `r-1-review-dispatch`, `r-2-review-mode-multica`, `r-3-review-mode-cc-workflows` (3 stories)

**Depends on:** Slice 1 (foundation). Independent of Slices 2, 3, 4.

#### r-1: review-dispatch router

Create `skills/hive/skills/review-dispatch/SKILL.md` (router; consumes `mode-resolver.mjs`). Add Phase 0 invocation of the router to `skills/review/SKILL.md`. Preserve solo reviewer pattern (lines 39-49); preserve `scope_drift` emit call (from `hive/lib/scope_drift.py`) when wrapping.

#### r-2: review-mode-multica

Create `skills/hive/skills/review-mode-multica/SKILL.md`. Thin wrapper for solo reviewer dispatch.

#### r-3: review-mode-cc-workflows

Create `skills/hive/skills/review-mode-cc-workflows/SKILL.md`. Imports `cc-workflows-preconditions.mjs` at Step 0. No Codex routing.

**Recommendation (Q14): KEEP r-1 + r-2 SEPARATE.** Per parity symmetry with Slices 2–4: each substrate slice has the same three-story shape (router + multica atom + cc-workflows atom). Merging in Slice 5 would create a one-off slice shape that complicates the dispatch-parity matrix (Slice 6) and makes future panel-mode extension messier. The marginal cost of one extra story is much smaller than the cost of structural asymmetry.

**Acceptance signal:** Vitest covers skill resolution for both mode atoms; `scope_drift` emit call preserved through router wrapping; lint green; manual: `/review` runs on both substrates produce identical artifact set + scope_drift emit to pre-epic behavior.

---

### Phase 6 — Governance: dispatch-parity matrix (= Slice 6)

**Goal:** `hive/references/dispatch-parity.md` exists as a 6×3 matrix marking every cell green for the surfaces in scope. Reads cleanly across all four substrate slices; serves as the canonical reference for future epics adding more substrates or more dispatching skills.

**Stories:** `s-1-dispatch-parity-md` (1 story)

**Depends on:** Slices 1–5. Runs last.

#### s-1: dispatch-parity.md

Create `hive/references/dispatch-parity.md`:
- Rows: `/plan`, `/execute`, `/test`, `/design`, `/design-review`, `/review`.
- Cols: `multica`, `cc-workflows`, `inline` (or `github` where applicable).
- Each cell either lists the mode skill path (relative to repo root) or marks `N/A` with a one-sentence rationale.

Reads from every router + every atom shipped in Slices 1–5. The verification is "every cited path resolves" — pure summary work; no upstream authoring lives in this slice.

**Acceptance signal:** Every row × col cell either points at a real file path in the repo OR has an N/A with a one-sentence rationale; every path cited resolves (no 404s); optional CI assertion is deferred (manual check in this slice).

---

## Part 3: Verification Plan

### Per-phase verification

#### Phase 0 (audit recovery)
- Manual: `ls .pHive/audits/post-run/` shows the recovered/regenerated audit, OR `.pHive/epics/substrate-coverage-and-test-cleanup/docs/audit-recovery-decision.md` exists with explicit accept-risk rationale.
- Manual: design-discussion §5 Constraint 5 narrative updated to reflect outcome.

#### Phase 1 (foundation)
- Automated (s-2): Vitest — `hive/lib/mode-resolver.mjs` returns `{decision, sources}` for all 5 tiers (env / root config / shipped baseline / skill override / default).
- Automated (s-2): Vitest snapshot — `execute-dispatch` refactor produces identical outputs to pre-refactor for representative inputs.
- Automated (s-4): Vitest — `cc-workflows-preconditions.mjs#assertWorktreeIsolation()` throws on main-checkout cwd; passes on `.claude/worktrees/<name>/`.
- Automated (s-3): Lint — `npm test` runs `lint-cc-workflows-no-codex.mjs`; green against the existing 2 cc-workflows atoms.
- Automated (s-3): Lint — helper-import check asserts both existing cc-workflows atoms import `cc-workflows-preconditions.mjs` at Step 0; green after back-fit.

#### Phase 2 (/test substrate)
- Automated (t-2 TDD): Adapter contract test for `markNeedsRework` (must fail before implementation, pass after).
- Automated (t-2): Multica adapter test — produces correct `updateStory` + label call sequence.
- Automated (t-2): GitHub adapter test — produces correct reopen + label call sequence.
- Automated (t-3): Skill resolution test — `test-mode-cc-workflows` Phase 0c resolver returns expected `mode_decision`.
- Automated (t-1): Vitest for scenario-replay step file loading via existing `loadScenario` (gated by H3 verification — see Risk Registry).
- Lint: `lint-cc-workflows-no-codex.mjs` green for `test-mode-cc-workflows`; helper-import lint green.
- Manual: `/test` run on a known story-issue scenario shows scenario-replay step executes and bounce-back fires (both substrates).
- Manual: `/test --simulated-manual` returns "unknown flag" (hard-rip confirmed).

#### Phase 3 (/design substrate)
- Automated (d-2/d-3/d-4): Skill resolution tests — Phase 0c resolver returns expected `mode_decision` for both mode atoms.
- Automated (d-1): Phase A toggle behavior — `--include-constraints` flag routes through specialist-triggers; default off invokes single ui-designer dispatch.
- Lint: `lint-cc-workflows-no-codex.mjs` green for `design-mode-cc-workflows`; helper-import lint green.
- Manual: `/design` with toggle OFF produces single ui-designer dispatch (legacy behavior preserved).
- Manual: `/design --include-constraints` produces 2 constraint files (accessibility, animations) before single ui-designer dispatch with constraints baked in.
- Manual: wireframe handoff payload arrives at downstream consumer in PNG + .f0 + constraint doc shape (d-5).

#### Phase 4 (/design-review substrate)
- Automated (dr-1/dr-2/dr-3): Skill resolution tests — Phase 0c resolver for both mode atoms.
- Lint: `lint-cc-workflows-no-codex.mjs` green for `design-review-mode-cc-workflows`; helper-import lint green.
- Manual: `/design-review` runs on both substrates produce identical artifact set to pre-epic behavior (no semantic change).
- Manual: `--skip` and `--artifact-target` flags continue to work.

#### Phase 5 (/review substrate)
- Automated (r-1/r-2/r-3): Skill resolution tests — Phase 0c resolver for both mode atoms.
- Automated: `scope_drift` emit call preserved through router wrapping.
- Lint: `lint-cc-workflows-no-codex.mjs` green for `review-mode-cc-workflows`; helper-import lint green.
- Manual: `/review` runs on both substrates produce identical artifact set + `scope_drift` emit to pre-epic behavior.

#### Phase 6 (governance)
- Manual: Every row × col cell in `dispatch-parity.md` either points at a real file path in the repo OR has an N/A with a one-sentence rationale.
- Manual: Every path cited resolves (no 404s).

### Verification coverage matrix

| Acceptance Criterion | Test Type | Tool | Phase |
|---|---|---|---|
| mode-resolver returns `{decision, sources}` for 5 tiers | Unit | vitest | 1 |
| execute-dispatch refactor preserves outputs | Snapshot | vitest | 1 |
| assertWorktreeIsolation throws on main checkout | Unit | vitest | 1 |
| no-codex lint green against existing 2 atoms | Lint | custom (s-3) | 1 |
| helper-import lint green against existing 2 atoms | Lint | custom (s-3) | 1 |
| markNeedsRework adapter contract symmetric | Unit (TDD) | vitest | 2 |
| Multica markNeedsRework = updateStory + label | Unit | vitest | 2 |
| GitHub markNeedsRework = reopen + label | Unit | vitest | 2 |
| test-mode-cc-workflows resolver returns mode_decision | Unit | vitest | 2 |
| /test --simulated-manual returns unknown flag | Manual | shell | 2 |
| scenario-replay step executes between worker + inspector | Manual | /test run | 2 |
| bounce-back fires on known story-issue scenario | Manual | /test run | 2 |
| --include-constraints routes through specialist-triggers | Unit | vitest | 3 |
| default /design = single ui-designer dispatch | Manual | /design run | 3 |
| --include-constraints = constraints + ui-designer | Manual | /design run | 3 |
| wireframe handoff = PNG + .f0 + constraint doc | Manual | downstream consumer | 3 |
| design-review preserves 3-persona pipeline | Manual | /design-review run | 4 |
| --skip and --artifact-target preserved | Manual | /design-review run | 4 |
| /review preserves scope_drift emit | Unit | vitest | 5 |
| /review preserves solo reviewer pattern | Manual | /review run | 5 |
| dispatch-parity.md cell paths all resolve | Manual | grep + ls | 6 |

### What is NOT being verified and why

- **Cross-substrate switching mid-run** — out of scope per design-discussion §7. Mode resolves once at Phase 0c; switching mid-run is a separate epic.
- **Performance** — none of these changes are hot-path. Dispatch routing adds at most one function call per slash invocation.
- **Hermes-side integration** — out of scope per source outline.
- **Panel-mode /review** — explicitly deferred (Q5). Slice 5 keeps solo reviewer.
- **CI assertion for dispatch-parity.md** — manual check in Slice 6; CI assertion deferred to follow-up. Optional smoke script that walks the matrix and asserts each cited path exists is parked.

---

## Part 3b: Cross-Cutting Concerns

### Error handling strategy

- **Adapter dispatch errors:** `markNeedsRework` is routed through `TaskTrackingDispatch.invoke`. Adapter-specific failures (Multica API, GitHub API) surface as exceptions caught at the dispatch layer and re-thrown with adapter context. The `capability('supports_needs_rework')` gate gives callers a defensive opt-in path.
- **Worktree isolation precondition:** `assertWorktreeIsolation()` throws synchronously at Step 0 of every cc-workflows mode skill. Throwing at Step 0 ensures the failure surfaces BEFORE any state mutation; the operator sees a clear "this skill must run on an isolated worktree" message.
- **Resolver fallback:** `mode-resolver.mjs` returns a default `mode_decision` if all 5 tiers are empty; the `sources` map records which tier resolved.
- **Lint failures:** `lint-cc-workflows-no-codex.mjs` exits non-zero with a per-finding error message listing the file:line that violated each check.

### Migration plan

- **No data migration.** All adapter changes are method additions; no schema or stored-data shape changes.
- **One breaking flag removal (`--simulated-manual`).** Documented in `cross-cutting-concerns.yaml` change (line 99-126 retired and replaced with `scenario-replay-folded` historical note). Users on this flag must remove it; replacement (scenario-replay inside swarm) requires no flag.

### Rollback plan

- **Per-story revert:** Branch is `feat/substrate-coverage-and-test-cleanup` off develop. One commit per story. Reverting a single story is a single-commit revert.
- **Foundation rollback:** If Slice 1 lands and downstream slices stall, the foundation is safe to keep — helpers are unconsumed by net-new artifacts until Slice 2+. Existing skills (plan-mode-cc-workflows, execute-mode-cc-workflows) continue to function because the back-fit is additive.
- **markNeedsRework rollback:** Removing the new ABI method requires reverting the step-06-triage emit, both adapter implementations, and the dispatch surface. Three commits to roll back.

### Performance implications

None expected. Dispatch routing adds at most one function call per slash invocation. Mode resolution is O(5) tier checks at Phase 0c (negligible). cc-workflows precondition is a single cwd check.

### Documentation impact

- `skills/test/SKILL.md` — flag handling table updates.
- `skills/design/SKILL.md` — Pattern B + toggle prose.
- `hive/references/dispatch-parity.md` — NEW reference doc.
- `hive/references/wireframe-protocol.md` — possibly updated for d-5 handoff shape (verify during d-5 authoring).
- `.pHive/cross-cutting-concerns.yaml` — simulated-manual entry retired.

### Security considerations

No new attack surfaces. No auth changes. No data exposure changes. The `hive:needs-rework` label is added to existing issues; the operator who runs `/test` already has issue-write permissions on the active tracker.

---

## Part 4: File Change Manifest

Citations reference research-brief file:line refs where existing files are touched; net-new files are marked NEW.

### CREATE (14 new artifacts + 1 doc)

Slice 0 (audit recovery):
- `.pHive/epics/substrate-coverage-and-test-cleanup/docs/audit-recovery-decision.md` — NEW (conditional; created only on accept-risk branch)
- `.pHive/audits/post-run/cc-workflows-smoke-<iso-timestamp>.yaml` — NEW (conditional; created only on re-run branch)

Slice 1 (foundation):
- `hive/lib/mode-resolver.mjs` — NEW (extracted from `execute-dispatch/SKILL.md:46-101`; research-brief §2 + §8)
- `hive/lib/cc-workflows-preconditions.mjs` — NEW (per architect ESCALATION; supports Constraint 7)
- `hive/scripts/lint-cc-workflows-no-codex.mjs` — NEW (multi-surface lint per architect ESCALATION + grill U1)

Slice 2 (/test):
- `hive/workflows/steps/test-swarm/step-04b-scenario-replay.md` — NEW (research-brief §2 + §8; folds `simulated-manual.md` execution; Q1 resolved to `test-swarm/`)
- `skills/hive/skills/test-dispatch/SKILL.md` — NEW (router per H-plan §L2)
- `skills/hive/skills/test-mode-cc-workflows/SKILL.md` — NEW (~330-360 lines, mirrors `plan-mode-cc-workflows/SKILL.md`)

Slice 3 (/design):
- `skills/hive/skills/design-dispatch/SKILL.md` — NEW
- `skills/hive/skills/design-mode-multica/SKILL.md` — NEW (~400-450 lines, mirrors `execute-mode-multica/SKILL.md`)
- `skills/hive/skills/design-mode-cc-workflows/SKILL.md` — NEW

Slice 4 (/design-review):
- `skills/hive/skills/design-review-dispatch/SKILL.md` — NEW
- `skills/hive/skills/design-review-mode-multica/SKILL.md` — NEW
- `skills/hive/skills/design-review-mode-cc-workflows/SKILL.md` — NEW

Slice 5 (/review):
- `skills/hive/skills/review-dispatch/SKILL.md` — NEW
- `skills/hive/skills/review-mode-multica/SKILL.md` — NEW
- `skills/hive/skills/review-mode-cc-workflows/SKILL.md` — NEW

Slice 6 (governance):
- `hive/references/dispatch-parity.md` — NEW (6×3 matrix; research-brief §9 confirms not present today)

### MODIFY (existing files with citation refs)

Slice 1 (foundation):
- `skills/hive/skills/execute-dispatch/SKILL.md` — refactor Step 0 to consume `mode-resolver.mjs`; preserves `{decision, sources}` emission (research-brief §2 cites lines 46-101).
- `skills/hive/skills/plan-mode-cc-workflows/SKILL.md` — back-fit: import `cc-workflows-preconditions.mjs` + add Step 0 helper call (research-brief §2 cites 336-line skill).
- `skills/hive/skills/execute-mode-cc-workflows/SKILL.md` — back-fit: import `cc-workflows-preconditions.mjs` + add Step 0 helper call (research-brief §2 cites 358-line skill).
- `package.json` — wire `lint-cc-workflows-no-codex.mjs` into `npm test`.

Slice 2 (/test):
- `skills/test/SKILL.md` — rip `--simulated-manual` flag handling (research-brief §2 cites lines 14-93); rip inline `HIVE_TEST_MODE` resolver (research-brief §2 cites lines 37-51); update pipeline table (research-brief §2 cites lines 109-119); add Phase 0 invocation of `test-dispatch`.
- `hive/workflows/steps/test-swarm/step-06-triage.md` — emit `markNeedsRework` when classification at line 16 is `story-issue` (research-brief §2 cites lines 1-129); extend summary block (research-brief §2 cites 111-114) with `needs_rework_emitted`.
- `hive/agents/test-sentinel.md` — prose-only update; no executable change (research-brief §2 cites 1-125; CONTEXT.md step-vs-persona discipline; grill C2 resolved).
- `.pHive/cross-cutting-concerns.yaml` — retire simulated-manual implementation_checklist (research-brief §2 cites 99-126); replace with `scenario-replay-folded` historical note.
- `hive/lib/task-tracking-dispatch/index.ts` — add `markNeedsRework({id, reason})` method routed via `invoke` (research-brief §2 cites 205-282); advertise `capability('supports_needs_rework')` (research-brief §2 cites 285-288).
- `hive/adapters/multica/index.ts` — implement `markNeedsRework` as `updateStory({status:'in_review'})` + add `hive:needs-rework` label (research-brief §2 cites 335-348; STATUS_VALUES at 20-26).
- `hive/adapters/github/index.ts` — implement `markNeedsRework` as `reopen issue` + add `hive:needs-rework` label (research-brief §2 cites 291-309; state-machine restriction at 296-302).

Slice 3 (/design):
- `skills/design/SKILL.md` — net-new Phase A insert above existing step 3 (research-brief §2 cites 55-64 for current single-dispatch step); add Phase 0 invocation of `design-dispatch`; document Pattern B + `--include-constraints` toggle semantics in prose.

Slice 4 (/design-review):
- `skills/design-review/SKILL.md` — add Phase 0 invocation of `design-review-dispatch`; preserve `--skip` + `--artifact-target` semantics (research-brief §2 cites 1-181).

Slice 5 (/review):
- `skills/review/SKILL.md` — add Phase 0 invocation of `review-dispatch`; preserve solo reviewer pattern (research-brief §2 cites lines 39-49); preserve `scope_drift` emit call when wrapping reviewer dispatch.

### DELETE

- None. The `simulated-manual.md` step file at `hive/workflows/steps/test/simulated-manual.md` is **superseded but not deleted in this epic** — Slice 2 t-1 retires the cross-cutting-concerns.yaml reference and folds the execution into the swarm at `step-04b-scenario-replay.md`. Whether to physically delete the legacy file is a follow-up cleanup task (not blocking).

### UNCHANGED (but affected — downstream verify)

- `hive/workflows/test-swarm.workflow.yaml` — 9 steps with `step_file` convention (research-brief §2). Adding `step-04b` may require step-numbering adjustment depending on how the workflow.yaml references step files; verify during t-1 implementation.
- `hive/lib/scenarios/load.mjs` — `loadScenario` consumed by `step-04b-scenario-replay.md`. H3 risk: verify schema covers swarm step-04b needs (post-worker, pre-inspector state shape).
- `hive/workflows/design-review.workflow.yaml` — 4 steps with `step_file` references (research-brief §2 cites lines 8-81). Unchanged; cited as orchestration template for d-1 Phase A.
- `hive/agents/ui-designer.md`, `accessibility-specialist.md`, `animations-specialist.md` — personas referenced from /design Phase A when toggle is on. Unchanged; pre-existing.
- `hive/lib/scope_drift.py` — `scope_drift` emit helper preserved by r-1 router wrapping.
- `skills/plan/SKILL.md` — Phase 0c resolver pattern (research-brief §2 cites 115-141). Pattern reference only; not modified.

---

## Part 5: Risk Registry

Pulled from research-brief §5 risks, grill-record findings, collab-review escalations, and hv-collab-review escalations.

| # | Risk | Severity | Likelihood | Mitigation | Owner |
|---|---|---|---|---|---|
| 1 | ABI inconsistency between GitHub `updateStatus` and Multica `updateStory` makes t-2 unauthorable | High | High (already real) | RESOLVED by user decision (Q2): introduce new `markNeedsRework({id, reason})` ABI method (architect option c). t-2 TDD ordering (contract first, two implementations second) absorbs remaining asymmetry. | Slice 2 / t-2 |
| 2 | Missing `cc-workflows-smoke-1780516800.yaml` audit reduces Constraint 5 to single citation | High | Medium | Slice 0 spike (0.5d) with three-branch resolution: locate / re-run / accept single-citation explicitly. Either path closes the constraint. | Slice 0 / a-0 |
| 3 | /design Phase A persona-assembly block does NOT exist today — d-1 is a structural insert, not modification | Medium | High (confirmed) | d-1 AC cites `design-review.workflow.yaml:8-81` as architectural anchor (architect ESCALATION). AC splits into 3 named subsections per hv-collab-review architect to prevent three-in-one verification drift. | Slice 3 / d-1 |
| 4 | `test-sentinel` persona vs step file conflation in outline | Medium | Resolved | t-2 AC points uniquely at `hive/workflows/steps/test-swarm/step-06-triage.md` for the emit contract; persona file gets prose-only update. CONTEXT.md step-vs-persona discipline preserved. | Slice 2 / t-2 |
| 5 | /design Pattern B always-on departs from composable-substrate posture | Medium | Resolved | User-locked Pattern B + `--include-constraints` toggle. Default-off preserves legacy single-dispatch behavior; toggle routes through specialist-triggers. Posture mismatch P1 closed by user decision. | Slice 3 / d-1 |
| 6 | cc-workflows substrate runs without worktree-isolation can mutate working tree across concurrent dispatchers | Medium | Medium | s-4 introduces `cc-workflows-preconditions.mjs#assertWorktreeIsolation()` at Step 0 of every `*-mode-cc-workflows` skill. Lint sub-step asserts every atom imports the helper. Back-fit absorbs existing 2 atoms inside Slice 1. | Slice 1 / s-4 |
| 7 | `loadScenario` schema may not cover swarm step-04b's post-worker pre-inspector state shape | Medium | Unknown | H3 (grill): verify schema BEFORE finalizing t-1. If gap found, t-1 grows to "add step file + extend loader" — story can split. Verification step required before t-1 AC freeze. | Slice 2 / t-1 |
| 8 | s-3 lint as drafted (single grep on `agentType:`) misses indirect Codex routings | Medium | Confirmed (architect ESCALATION) | Widened scope: AST check + `codex:codex-rescue` grep + `agent_backends` grep. Three independent checks. Helper-import lint as fourth check. | Slice 1 / s-3 |
| 9 | Parallel execution of Slices 2-5 unverified (planning-runtime concurrent dispatch assumption) | Medium | Unknown | Documented serial fallback in V-plan §5 (A→B→C→D, +3-5 days schedule cost). Decision belongs at planning gate, not here. | Planning gate |
| 10 | s-2 (mode-resolver) shipped post-hoc would force rewrite of 3-4 freshly-written routers | Medium | Resolved | User decision: Slice E split into Slice 1 (foundation) + Slice 6 (governance). s-2 lands first in Slice 1 with locked commit order. Q12 resolved. | Slice 1 / s-2 |
| 11 | d-1 carries two stories' worth of risk (structural Phase A + Pattern B toggle + handoff payload) | Medium | High | Resolved by hv-collab-review architect: keep d-1 as single story but split AC into 3 named subsections. Q13 resolved. | Slice 3 / d-1 |
| 12 | r-1 + r-2 collapse risk creates asymmetric slice shape | Low | Low | Recommendation: keep separate for parity symmetry with Slices 2-4. Q14 carried as Decision Point 3 for user sign-off. | Slice 5 |
| 13 | `--simulated-manual` hard-rip breaks `cross-cutting-concerns.yaml:99-126` | Low | Confirmed | Replace simulated-manual implementation_checklist with `scenario-replay-folded` historical note as part of t-1. Bookkeeping cleanup. | Slice 2 / t-1 |
| 14 | design-review.workflow.yaml 4-step model vs single-shot script substrate parity question | Low | Resolved | Q11 resolved: preserve 4-step model with 4 `agent()` calls in dr-2/dr-3 (substrate parity with workflow.yaml structure). | Slice 4 |
| 15 | `design-mode-multica` per-persona issue creation surface (one issue or three) | Low | Resolved | Q10 resolved by default: one issue per persona for design-mode-multica (mirrors execute-mode-multica precedent). | Slice 3 / d-3 |
| 16 | Vocabulary V1 (slice vs wave) departs from CONTEXT.md preference | Low | Resolved | Explicitly retained "slice" for paired-epic continuity with Part 1 (cc-workflows-first-party). Grill V1 noted but accepted. | All |
| 17 | TeamDelete-style task-list reset during execution | Low | Unknown | Per `feedback_team_delete_resets_task_list`: avoid TeamDelete during epic execution; if needed, re-stamp task IDs. Operator discipline. | Execution |

### Detailed mitigation for high-severity risks

**Risk 1 (ABI inconsistency):** The mitigation is t-2's TDD methodology override. Adapter contract test lands first, defining what `markNeedsRework({id, reason})` must do: terminal-state on the underlying tracker plus add the `hive:needs-rework` label. Multica resolves to `updateStory({status:'in_review'}) + label`; GitHub resolves to `reopen + label`. The contract test forces both adapters to land on the same external observable (terminal state + label) even though the internal mechanism differs. test-sentinel never branches on adapter — calls `markNeedsRework` and trusts the dispatch surface.

**Risk 2 (missing audit):** Slice 0 owns this with a 0.5-day budget. Three resolution branches, all acceptable:
- (a) Locate: search the audit directory and any sibling locations the smoke may have been written to. If found, copy into `.pHive/audits/post-run/` and confirm the file:line citation in design-discussion §5 Constraint 5 resolves.
- (b) Re-run: execute the cc-workflows smoke locally and produce a fresh audit under a new ISO timestamp. Update design-discussion §5 Constraint 5 citation to the new timestamp.
- (c) Accept-risk: write `.pHive/epics/substrate-coverage-and-test-cleanup/docs/audit-recovery-decision.md` documenting why the missing audit doesn't materially change the design (e.g., plan-mode-validation audit is sufficient corroboration for the gate-ownership claim). Update design-discussion §5 Constraint 5 to "single-citation accepted; recovery rationale at audit-recovery-decision.md".

In branch (c), Slice 2's manual smoke on the bounce-back becomes the runtime carrier for Constraint 5's gate-ownership assertion — single-cited but verified end-to-end at story time.

---

## Part 6: Dependency Map

```
INTERNAL DEPENDENCIES:
  Slice 0 (audit recovery)
    → Slice 1 (foundation) — gating: audit resolved or accepted before story authoring
  Slice 1 (foundation) within-slice commit order LOCKED:
    s-2 (mode-resolver) → s-4 (cc-workflows-preconditions) → s-3 (lint)
  Slice 1
    → Slices 2, 3, 4, 5 (parallel-eligible) — all consume mode-resolver.mjs and cc-workflows-preconditions.mjs
  Slice 2 (/test) within-slice
    t-2 ABI contract (TDD) → step-06 emit (in same story) → t-1 fold + t-3 cc-workflows atom
  Slice 3 (/design) within-slice
    d-2 (router) → d-1 (Phase 0 invocation in /design SKILL.md)
    d-1 (Phase A structural insert + toggle) → d-3, d-4 (atoms receive Phase A output)
    d-5 (handoff payload) — depends on d-1 toggle output shape
  Slices 1-5
    → Slice 6 (governance) — matrix reads paths from every prior slice

CROSS-SLICE PARALLEL-ELIGIBILITY:
  Slices 2, 3, 4, 5 are parallel-eligible after Slice 1 lands.
  No shared L2/L3/L4/L5/L6/L7 surfaces in conflict.
  Documented serial fallback: A→B→C→D, +3-5 days schedule cost.

EXTERNAL DEPENDENCIES:
  Library: vitest (existing in tree; no version pin change)
  Library: Multica adapter (already in tree; no API change required)
  Service: Workflow tool (already exercised by plan + execute mode-cc-workflows skills; no schema change required)
  No new libraries.
  No API changes.

BLOCKING QUESTIONS:
  Q2 (markNeedsRework ABI shape) — RESOLVED by user.
  Q4 (missing audit) — RESOLVED by Slice 0 spike.
  Q6 (/design posture) — RESOLVED by user (Pattern B + toggle).
  Q9 (wireframe handoff payload) — RESOLVED by user (PNG + .f0 + bundled constraint doc).
  Q12 (s-2 ordering) — RESOLVED by Slice 1 foundation-first.
  Q13 (d-1 split) — RESOLVED by hv-collab-review architect (single story, 3 AC subsections).
  Q14 (r-1/r-2 merge) — Decision Point 3 below; recommend KEEP SEPARATE.

NON-BLOCKING DEFERRED QUESTIONS (carry to follow-up):
  Q5 (/review panel mode) — deferred to future epic.
  Q11 (design-review-mode-cc-workflows shape) — resolved to preserve 4-step model.
  Cross-substrate switching — out of scope (mode resolves once at Phase 0c).
  Hermes-side integration — out of scope per source outline.
  CI assertion for dispatch-parity.md — deferred to follow-up after manual check.
```

---

## Part 7: Elicitation — Stress-Testing This Plan

This is the planning team's adversarial self-critique. The questions below are what the team would push back on if reviewing this plan cold. Each carries the team's best answer, confidence level, and what we'd want to verify before story authoring.

### E1. Will the parallel-eligibility assumption hold up under real planning-runtime concurrent dispatch?

**Failure:** Slices 2-5 run in parallel and the planning-runtime concurrent dispatch surfaces races (shared `.pHive/cross-cutting-concerns.yaml`, conflicting tracker state, episode-marker collisions).

**Trigger:** Concurrent dispatch of multiple substrate slices touching overlapping L6 files.

**Impact:** Mid-execution rollback of at least one slice; +3-5 days schedule cost as documented serial fallback kicks in.

**Signal during implementation:** If two parallel slices both touch `.pHive/cross-cutting-concerns.yaml` (currently only Slice 2 plans to), the parallel mode fails fast. We'd see this in the first integration of any two slices that surface L6 changes.

**Our answer (confidence: MEDIUM):** Documented serial fallback is the contingency. Slice 2 is the only slice currently touching cross-cutting-concerns.yaml — no other slice has a planned L6 cross-coupling. The L6 file map shows clean separation (architect hv-collab-review confirms this). If parallel surfaces issues, serialize A→B→C→D for +3-5 days; epic still ships. We would want to **verify the planning-runtime parallel-dispatch capability with a Phase 0 spike** if budget allows, but the fallback makes this non-blocking.

**Would want to check before story authoring:** Whether any L6 file other than `cross-cutting-concerns.yaml` is touched by more than one slice. Audit during story authoring; should be zero. If non-zero, sequence those slices.

---

### E2. Does t-2's TDD adapter contract actually capture the symmetry we need?

**Failure:** The contract test passes for both Multica and GitHub implementations, but in practice the external observables differ enough that test-sentinel branches on adapter or the bounce-back behaves inconsistently across substrates.

**Trigger:** Multica's `in_review` is a workflow state that may trigger automation; GitHub's `reopen` is an issue-state change that triggers different notifications. The label is the only symmetric signal.

**Impact:** Operators see different downstream effects on the two substrates after t-2 ships; the "bounce-back" semantics drift.

**Signal during implementation:** Manual smoke on a known story-issue scenario on both substrates. If the observable bounce-back differs in a way an operator would notice (notification cascade, state-machine downstream effect), the contract is under-specified.

**Our answer (confidence: HIGH for the contract; MEDIUM for downstream effects):** The contract test asserts: (a) the underlying tracker entity reaches a state-flag equivalent to "needs human attention" (Multica `in_review`, GitHub `open`), (b) the entity carries the `hive:needs-rework` label. test-sentinel never branches on adapter. Downstream notification effects ARE adapter-specific and intentional — the operator chose their tracker; respecting tracker conventions is the point. We would want to **manual-smoke on both substrates** at the close of t-2.

**Would want to check before story authoring:** That the contract test specification names exactly the observables we care about, not implementation details.

---

### E3. Is the Slice 1 within-slice commit order LOCKED enough to survive a story being skipped or reordered?

**Failure:** During execution, s-2 ships but s-4 is delayed (e.g., flagged for review); s-3 lint cannot land without s-4's back-fit, so s-3 also stalls. Slices 2-5 are theoretically unblocked because Slice 1 partially lands, but s-3's lint guard is missing.

**Trigger:** A reviewer raises a question on s-4 that blocks for a day.

**Impact:** Either downstream slices proceed without lint enforcement (drift risk) or the whole foundation stalls behind s-4 review.

**Signal during implementation:** Foundation slice review takes longer than expected.

**Our answer (confidence: HIGH):** The Slice 1 within-slice commit order is the safe sequence — s-2 first, s-4 second, s-3 last. Each is a separate commit. The 3 stories can be reviewed independently as PRs against the epic branch. If s-4 stalls, s-3 stalls — that is the correct behavior because s-3's lint requires s-4's back-fit. We would NOT proceed to Slices 2-5 with partial foundation; foundation is foundation. Practical mitigation: keep Slice 1 stories small and atomic to minimize review surface.

**Would want to check before story authoring:** That s-2 has no behavioral changes (snapshot tests against pre-refactor outputs are pure regression coverage).

---

### E4. Does the d-1 single-story-with-3-AC-subsections approach actually prevent three-in-one verification drift?

**Failure:** Implementer treats the 3 AC subsections as conjoined and a single test failure in any subsection blocks the entire story. Story sits in review for days while subsections are individually fixed.

**Trigger:** Each subsection tests differently (structural-insert AC needs orchestration template check; toggle semantics AC needs flag-routing check; handoff payload AC needs downstream consumer check). One can fail without the others being broken.

**Impact:** d-1 churn lengthens; Slice 3 ships late.

**Signal during implementation:** d-1 PR review surfaces subsection-specific issues that aren't actually coupled.

**Our answer (confidence: MEDIUM):** Single story with 3 AC subsections is the architect's recommendation to prevent the alternative (split into 2 stories, which creates an artificial seam between Phase A structural insert and persona-pipeline wiring). The 3 subsections are tested independently within the same story; any one failing blocks the story but not the other AC subsections individually. We would want the **story AC to make the test-independence explicit** — each subsection has its own test set, no cross-subsection test coupling.

**Would want to check before story authoring:** That the three AC subsections truly have independent verification paths (structural-insert: orchestration template citation present; toggle: `--include-constraints` flag routes through specialist-triggers; handoff: payload shape PNG + .f0 + constraint doc when toggle on).

---

### E5. What if Slice 6's dispatch-parity matrix exposes a missing cell after Slices 1-5 close?

**Failure:** Slice 6 surfaces a cell that should exist but no slice owns it (e.g., `/review × inline` was assumed N/A but the matrix surfaces it as required).

**Trigger:** The matrix is a fresh top-down view that the substrate slices didn't have.

**Impact:** Either Slice 6 takes a longer than 1-story scope, or a Slice 7 emerges, or the cell is marked N/A with weak rationale.

**Signal during implementation:** During Slice 6 cell-by-cell verification, a cell points at no file and the N/A rationale is contrived.

**Our answer (confidence: HIGH for the matrix as built; LOW for the missing-cell discovery):** The H-plan §1 + V-plan overlay diagram already enumerate every L2/L3/L4 cell touched by Slices 1-5. The matrix in Slice 6 should be mechanical reading from the artifacts in place. If a missing cell surfaces, the response is to mark N/A with an honest rationale (e.g., "/review × inline N/A — `/review` operates on a single branch context; no inline-mode equivalent exists today; future panel-mode epic may extend"). We would want to **dry-run the matrix during Slice 5 close** so any surprises surface before Slice 6 starts.

**Would want to check before story authoring:** That every row × col combination is enumerated and either mapped to a slice deliverable or pre-marked N/A with rationale.

---

### E6. Is the lint scope (s-3) truly comprehensive enough to catch indirect Codex routings?

**Failure:** A future cc-workflows skill imports a helper that itself spawns a `codex:codex-rescue` subagent two levels deep; s-3 lint's grep doesn't catch the transitive import; Codex leaks into cc-workflows mode.

**Trigger:** A helper-of-a-helper pattern emerges.

**Impact:** Constraint 4 (no Codex routing in cc-workflows mode) silently violated; substrate parity claim is wrong.

**Signal during implementation:** No automated signal; would surface only when a Codex-style behavior shows up in a cc-workflows run.

**Our answer (confidence: MEDIUM):** The widened lint scope (AST `agentType:` + `codex:codex-rescue` grep + `agent_backends` grep + helper-import lint) covers the three known direct surfaces and the helper-import surface. Transitive imports beyond one level deep are NOT covered. Mitigation: code review discipline. The lint is a guardrail, not a proof. We would want to **document the lint's limits explicitly** in the s-3 story so future contributors know transitive-routing escapes the lint.

**Would want to check before story authoring:** That the s-3 implementation includes a comment block documenting the four checks and their limits (specifically: transitive helper imports beyond depth 1 are NOT checked).

---

### E7. What if the wireframe handoff payload shape (Q9 resolved: PNG + .f0 + constraint doc) doesn't match what downstream consumers actually need?

**Failure:** A downstream consumer (design-review, manual review, future Hermes integration) needs additional fields the bundled payload doesn't carry (e.g., scenario-mapping notes, version metadata, originating ticket ID).

**Trigger:** d-5 ships the payload; downstream consumer surfaces a needed field; payload reshape is a follow-up.

**Impact:** d-5 ships under-spec'd; follow-up adds fields (reversible).

**Signal during implementation:** Manual exercise of the handoff with a real downstream consumer (design-review running on a /design output).

**Our answer (confidence: MEDIUM):** PNG + .f0 + bundled constraint doc covers the known consumers (design-review needs the wireframe artifact; constraint doc enables traceability for accessibility/animation decisions). Additional fields like scenario-mapping, version metadata, ticket ID are reversible follow-ups — the payload shape is moldable post-ship without breaking existing consumers (add-only). We would want to **manual-exercise the handoff with design-review during Slice 4** to surface any missing fields before they become deferred-debt.

**Would want to check before story authoring:** That d-5 AC includes the manual exercise step (run /design with toggle on; pass payload to /design-review; observe).

---

## Part 8: Decision Points for Sign-Off

Numbered for the user to respond with "1: affirm, 2: adjust to X, 3: accept …".

```
DECISIONS REQUIRING SIGN-OFF:

1. [APPROACH] r-1 + r-2 merge — KEEP SEPARATE for parity symmetry with Slices 2-4.
   Options considered:
     (a) Merge r-1 (router) + r-2 (multica wrapper) into a single story (saves 1 story; epic shrinks to 18).
     (b) Keep separate (current plan; preserves parity symmetry with Slices 2-4).
   Recommendation: (b). Each substrate slice has the same three-story shape (router + multica atom + cc-workflows atom). Merging in Slice 5 creates a one-off slice shape that complicates dispatch-parity matrix consumption and makes future panel-mode extension messier.
   Marginal cost of one extra story is much smaller than cost of structural asymmetry.
   → Affirm KEEP SEPARATE / Adjust to merge r-1 + r-2

2. [SCOPE] /review panel-mode deferred — Slice 5 keeps solo reviewer only.
   Options considered:
     (a) Extend Slice 5 to gate on solo-vs-panel mode now (Slice 5 balloons; affects router shape).
     (b) Defer panel-mode to a future epic (current plan; Slice 5 stays small).
   Recommendation: (b). Panel mode is out of scope for substrate-coverage; introducing it in this epic widens the router contract and risks blocking the substrate-parity goal.
   → Affirm DEFER / Require inclusion

3. [RISK ACCEPTANCE] s-3 lint transitive-helper-import escape — accepted as a documented limit.
   Mitigation: lint covers direct + first-level helper imports; transitive (depth-2+) helper imports are NOT checked. Code review discipline + comment block documenting the limit in s-3 implementation.
   → Accept documented limit / Require transitive checking (would expand s-3 scope materially)

4. [TRADE-OFF] Slice 1 within-slice commit order LOCKED: s-2 → s-4 → s-3.
   Rationale: lint (s-3) cannot land green before s-4's back-fit; s-4 cannot land before s-2's helper exists. Reverse order causes lint failures.
   → Affirm locked order / Reconsider

5. [APPROACH] d-1 single story with 3 AC subsections (Phase A structural insert / Pattern B toggle semantics / 3-persona handoff payload).
   Options considered:
     (a) Split into 2 stories (phase-a-structural-insert + persona-pipeline-wiring) — pushes epic to 20 stories; creates artificial seam.
     (b) Keep as single story with 3 AC subsections (current plan; hv-collab-review architect recommendation).
   Recommendation: (b). Structural insert and persona wiring are the same change. Three independent AC subsections prevent three-in-one verification drift.
   → Affirm single story / Split into 2 stories

6. [RISK ACCEPTANCE] H3: `loadScenario` schema coverage for swarm step-04b — verification step required BEFORE t-1 AC freeze, not implicit in story authoring.
   Mitigation: schema-verify step lands at the top of t-1; if gap found, story splits into "add step file + extend loader".
   → Accept verification gate / Defer verification to implementation

7. [SCOPE] Audit recovery (Slice 0) acceptable resolution branches:
   Three branches all acceptable: (a) locate, (b) re-run + fresh audit, (c) accept single-citation risk + write decision doc.
   Recommendation: try (a), then (b); fall back to (c) only if 0.5d budget exhausted.
   → Affirm 3-branch resolution / Require specific branch
```

---

## Part 9 (omitted)

Single-epic plan. No cross-epic coordination beyond the natural relationship to Part 1 (cc-workflows-first-party, already shipped in PR #241). No Part 9.

---

**Cross-references for downstream:** Story authoring (Phase C step 4) consumes Part 2 phases (V-slice mapping) + Part 4 file manifest (per-story touch sets) + Part 5 risk registry (per-story mitigation owners). Decision Points 1-7 in Part 8 must be acknowledged at the user gate before story YAML authoring begins. Slice 0 spike outcome shapes downstream verification rigor for Constraint 5 carrier (see Part 5 Risk 2 detailed mitigation).
