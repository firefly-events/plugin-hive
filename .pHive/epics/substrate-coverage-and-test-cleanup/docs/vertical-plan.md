# Vertical Planning — Slice Plan for substrate-coverage-and-test-cleanup

**Epic:** substrate-coverage-and-test-cleanup (Part 2 of cc-workflows-first-party)
**Phase:** B — Vertical Plan (TPM)
**Author:** tpm
**Date:** 2026-06-05
**Inputs:** horizontal-plan.md (sibling), design-discussion.md (rev. 1), research-brief.md
**Branch:** `feat/substrate-coverage-and-test-cleanup` off `develop`. One commit per story.

---

## 1. Slicing Strategy

The horizontal plan inventories 7 layers and ~37 items. The 10 flagged cross-layer dependencies cluster around four invariants:

1. **L2 mode-resolver helper before L2 routers / L3 / L4 atoms** — else routers + atoms inline the resolver and the extract becomes a 7-file rewrite.
2. **L4 worktree-isolation helper before L4 cc-workflows atoms** — else each atom re-derives the isolation contract.
3. **L5 ABI `markNeedsRework` before L6 step-06-triage emit + L6 persona prose** — emit cannot exist before the method does.
4. **L7 `dispatch-parity.md` last** — it reads every router + every atom; runs after L2/L3/L4 are in place.

The remaining work decomposes by **substrate surface** (/test, /design, /design-review, /review). Once foundation lands, each surface ships end-to-end through L2 + L3 + L4 + (where relevant) L1, L5, L6 in one slice. This produces four substrate-coverage slices that are *parallel-eligible after Slice 1* (per design-discussion §5 parallel-eligibility caveat) and serialize cleanly with +3-5 days schedule cost as a documented fallback.

Slice 0 is a pre-flight 0.5-day spike to resolve the missing `cc-workflows-smoke-1780516800.yaml` audit before any story writing — a substrate-hygiene preconditon per user decision.

```
STRATEGY:
  Total horizontal items: ~37 (14 new, 13 modified, 1 spike)
  Planned slices: 7 (Slice 0 pre-flight + Slices 1-6)
  Total stories: 19 (a-0 + 3 foundation + 3 test + 5 design + 3 design-review + 3 review + 1 governance)
  First slice goal (Slice 0): missing audit recovered or single-citation risk explicitly accepted
  Second slice goal (Slice 1): mode-resolver helper + cc-workflows-preconditions helper + no-codex lint exist and pass against existing skills
  Final slice goal (Slice 6): dispatch-parity.md matrix marks every cell green; lint wired into npm test

  Slicing rationale: dependency-driven. Foundation (Slice 1) lands BEFORE per-substrate slices
  to avoid the post-hoc rewrite that the s-2-ordering escalation flagged. After Slice 1, each
  substrate slice is structurally independent — they can run in parallel (preferred) or serial
  (fallback). Governance (Slice 6) reads from all prior slices.
```

---

## 2. Vertical Slice Plan

### Slice 0 (pre-flight) — Audit recovery / single-citation acceptance

**Stories:** `a-0-audit-recovery` (1 story, 0.5 day spike)

WHAT WORKS AFTER THIS STEP:
  The cc-workflows-smoke audit (`cc-workflows-smoke-1780516800.yaml`) is either (a) located and copied into `.pHive/audits/post-run/`, (b) re-run and a fresh audit produced under a new ISO timestamp, or (c) explicitly accepted as a single-citation risk for Constraint 5 (gate-ownership invariant), with the decision documented in `.pHive/epics/substrate-coverage-and-test-cleanup/docs/audit-recovery-decision.md`.

LAYERS TOUCHED:
  Pre-flight only — no L1-L7 production code.
  Owner: tpm or test-architect.

NOT YET:
  - Any L1-L7 story authoring (Slice 1 onward gates on this slice's outcome)
  - The substrate-coverage epic itself begins after this spike lands

VERIFIED BY:
  - `ls .pHive/audits/post-run/` shows either the recovered/regenerated audit OR `audit-recovery-decision.md` exists in the docs directory
  - If accepted-risk path chosen: design-discussion §5 Constraint 5 updated to read "single-citation accepted; recovery rationale at `audit-recovery-decision.md`"

COMMIT REPRESENTS: Pre-flight audit recovery spike — substrate hygiene preconditon for substrate-coverage epic

---

### Slice 1 (foundation) — Shared helpers + lint

**Stories:** `s-2-mode-resolver`, `s-4-cc-workflows-preconditions`, `s-3-no-codex-lint` (3 stories)

BUILDS ON: Slice 0
WHAT WORKS AFTER THIS STEP:
  Three foundation artifacts exist and pass their tests against the EXISTING skill set (plan-mode-cc-workflows, execute-mode-cc-workflows, plan-dispatch, execute-dispatch). The helpers are importable and lint passes "green" against the current tree. Foundation is unconsumed by net-new artifacts (those land in Slices 2-5) but is ready for them.

LAYERS TOUCHED:
  L2:
    - `hive/lib/mode-resolver.mjs` — net-new shared helper extracted from `execute-dispatch/SKILL.md:46-101`
    - Signature returns `{decision, sources}` per architect ESCALATION
    - `execute-dispatch` Step 0 refactored to consume the helper (regression-tested against existing `mode_decision` outputs)
  L4:
    - `hive/lib/cc-workflows-preconditions.mjs` — net-new helper exporting `assertWorktreeIsolation()`
    - Lint sub-step verifying every `*-mode-cc-workflows/SKILL.md` imports the helper at Step 0
    - For Slice 1, this asserts against the EXISTING `plan-mode-cc-workflows` + `execute-mode-cc-workflows` (back-fitted as a same-slice safe modification: add the import + Step 0 helper call to both)
  L7:
    - `hive/scripts/lint-cc-workflows-no-codex.mjs` — net-new multi-surface lint
    - Three checks: (i) AST for `agentType:` literal, (ii) grep for `codex:codex-rescue` references, (iii) grep for `agent_backends` keys
    - Wired into `npm test`

NOT YET:
  - Net-new router skills (Slices 2-5)
  - Net-new mode atoms (Slices 2-5)
  - ABI `markNeedsRework` (Slice 2)
  - dispatch-parity.md matrix (Slice 6)

VERIFIED BY:
  - Vitest: `hive/lib/mode-resolver.mjs` returns `{decision, sources}` for all 5 tiers (env / root config / shipped baseline / skill override / default)
  - Vitest: `execute-dispatch` refactor produces identical outputs to pre-refactor snapshots
  - Vitest: `cc-workflows-preconditions.mjs#assertWorktreeIsolation()` throws on main-checkout cwd; passes on `.claude/worktrees/<name>/`
  - Lint: `npm test` runs `lint-cc-workflows-no-codex.mjs` against the existing 2 cc-workflows atoms — green
  - Lint: helper-import lint asserts both existing cc-workflows atoms import `cc-workflows-preconditions.mjs` at Step 0 — green after back-fit

COMMIT REPRESENTS: Shared foundation — mode-resolver + cc-workflows preconditions + multi-surface no-codex lint; existing skills upgraded; no net-new substrate work yet

---

### Slice 2 (/test) — Swarm-only pipeline + bounce-back + cc-workflows atom

**Stories:** `t-1-fold-simulated-manual`, `t-2-mark-needs-rework-abi`, `t-3-test-mode-cc-workflows` (3 stories)

BUILDS ON: Slice 1
WHAT WORKS AFTER THIS STEP:
  `/test` runs end-to-end across both Multica and cc-workflows substrates as a swarm-only pipeline. The `--simulated-manual` flag is removed; scenario-replay runs as `step-04b` inside the swarm. When triage classifies a failure as a real `story-issue`, `markNeedsRework` fires through whichever adapter is active — Multica gets `updateStory({status:'in_review'}) + 'hive:needs-rework' label`, GitHub gets `reopen + 'hive:needs-rework' label`. A user can verify on a known story-issue scenario: the swarm runs, scenario-replay happens, triage classifies, bounce-back fires.

LAYERS TOUCHED:
  L1:
    - `skills/test/SKILL.md` — rip `--simulated-manual` flag handling (14-93), rip inline `HIVE_TEST_MODE` resolver (37-51), add Phase 0 `test-dispatch` invocation, update pipeline table (109-119)
  L2:
    - `skills/hive/skills/test-dispatch/SKILL.md` — net-new router (consumes `mode-resolver.mjs` from Slice 1)
  L4:
    - `skills/hive/skills/test-mode-cc-workflows/SKILL.md` — net-new atom, per-scenario dispatch granularity (consumes `cc-workflows-preconditions.mjs` from Slice 1)
  L5 (TDD methodology — adapter contract first):
    - `hive/lib/task-tracking-dispatch/index.ts` — net-new `markNeedsRework({id, reason})` method routed via `invoke`
    - `hive/lib/task-tracking-dispatch/index.ts` — `capability('supports_needs_rework')` advertised
    - `hive/adapters/multica/index.ts` — `markNeedsRework` implementation = `updateStory({status:'in_review'}) + label`
    - `hive/adapters/github/index.ts` — `markNeedsRework` implementation = `reopen + label`
  L6:
    - `hive/workflows/steps/test-swarm/step-04b-scenario-replay.md` — net-new step file consuming `loadScenario`
    - `hive/workflows/steps/test-swarm/step-06-triage.md` — emit `markNeedsRework` when classification == `story-issue`; summary block extended
    - `hive/agents/test-sentinel.md` — prose-only update describing bounce-back behavior
    - `.pHive/cross-cutting-concerns.yaml:99-126` — retire simulated-manual checklist; replace with `scenario-replay-folded` historical note

NOT YET:
  - `/design`, `/design-review`, `/review` substrate coverage (Slices 3-5)
  - dispatch-parity.md (Slice 6)

VERIFIED BY:
  - Vitest: adapter contract test for `markNeedsRework` (TDD contract-first) — must fail before implementation, pass after
  - Vitest: Multica adapter test — `markNeedsRework` produces correct `updateStory` + label call sequence
  - Vitest: GitHub adapter test — `markNeedsRework` produces correct reopen + label call sequence
  - Vitest: skill resolution test — `test-mode-cc-workflows` Phase 0c resolver returns expected mode_decision
  - Lint: `lint-cc-workflows-no-codex.mjs` green for `test-mode-cc-workflows`
  - Lint: helper-import lint green for `test-mode-cc-workflows`
  - Manual: `/test` run on a known story-issue scenario shows scenario-replay step executes and bounce-back fires (both substrates)
  - Manual: `/test --simulated-manual` returns "unknown flag" (hard-rip confirmed)

COMMIT REPRESENTS: `/test` end-to-end working on both substrates — swarm-only pipeline, scenario-replay folded, real-bug bounce-back ABI live in both adapters

---

### Slice 3 (/design) — Phase A persona pipeline + substrate parity + handoff

**Stories:** `d-1-phase-a-pattern-b-with-toggle`, `d-2-design-dispatch`, `d-3-design-mode-multica`, `d-4-design-mode-cc-workflows`, `d-5-wireframe-handoff` (5 stories)

BUILDS ON: Slice 1 (foundation). Independent of Slice 2.
WHAT WORKS AFTER THIS STEP:
  `/design` runs end-to-end across both Multica and cc-workflows substrates. Default invocation dispatches `ui-designer` once (legacy behavior preserved). `/design --include-constraints` routes through specialist-triggers to add accessibility-specialist + animations-specialist as a constraint pass, then dispatches ui-designer ONCE with constraints baked into the prompt. Wireframe handoff payload arrives at downstream consumers in the agreed shape.

LAYERS TOUCHED:
  L1:
    - `skills/design/SKILL.md` — net-new Phase A insert above existing step 3 (single story `d-1` per architect recommendation; AC MUST cite `hive/workflows/design-review.workflow.yaml:8-81` as orchestration template); `--include-constraints` toggle routed through specialist-triggers; default-off keeps simple case behaviorally identical to today
    - Phase 0 invocation of `design-dispatch`
  L2:
    - `skills/hive/skills/design-dispatch/SKILL.md` — net-new router (consumes `mode-resolver.mjs`)
  L3:
    - `skills/hive/skills/design-mode-multica/SKILL.md` — net-new atom (mirrors `execute-mode-multica`); per-persona dispatch; episode markers per persona
  L4:
    - `skills/hive/skills/design-mode-cc-workflows/SKILL.md` — net-new atom (consumes `cc-workflows-preconditions.mjs`)
  L6:
    - Wireframe-artifact handoff payload (`d-5`): PNG + `.f0` + constraint notes (default shape; Q9 resolution may adjust)
  L7:
    - `skills/design/SKILL.md` prose — documents Pattern B + toggle semantics, default behavior, escape hatch

NOT YET:
  - `/design-review`, `/review` substrate coverage (Slices 4-5)
  - dispatch-parity.md (Slice 6)

VERIFIED BY:
  - Vitest: skill resolution test — `design-mode-cc-workflows` Phase 0c resolver returns expected mode_decision
  - Vitest: skill resolution test — `design-mode-multica`
  - Vitest: Phase A toggle behavior — `--include-constraints` flag routes through specialist-triggers; default off invokes single ui-designer dispatch
  - Lint: `lint-cc-workflows-no-codex.mjs` green for `design-mode-cc-workflows`
  - Lint: helper-import lint green for `design-mode-cc-workflows`
  - Manual: `/design` with toggle OFF produces single ui-designer dispatch (legacy behavior preserved)
  - Manual: `/design --include-constraints` produces 2 constraint files (accessibility, animations) before single ui-designer dispatch with constraints baked in
  - Manual: wireframe handoff payload arrives at downstream consumer in expected shape

COMMIT REPRESENTS: `/design` end-to-end working on both substrates — Pattern B with toggle (composable-substrate-aligned), wireframe handoff in agreed shape

NOTE ON `d-1` SIZING: per architect recommendation, `d-1` stays a single story (carries Phase A structural insert + Pattern B-with-toggle posture + 3-persona handoff payload). AC must cite `design-review.workflow.yaml:8-81` as the orchestration template to mirror — this is the architectural anchor that prevents `d-1` from drifting into a re-invention. Splitting into "phase-a-structural-insert" + "persona-pipeline-wiring" would push the epic from 19 to 20 stories and create an artificial seam — the structural insert and persona wiring are the same change. **Recommendation: keep as one story.**

---

### Slice 4 (/design-review) — Substrate parity

**Stories:** `dr-1-design-review-dispatch`, `dr-2-design-review-mode-multica`, `dr-3-design-review-mode-cc-workflows` (3 stories)

BUILDS ON: Slice 1 (foundation). Independent of Slices 2-3.
WHAT WORKS AFTER THIS STEP:
  `/design-review` runs end-to-end across both Multica and cc-workflows substrates with NO semantic change. The existing 3-persona pipeline (accessibility → animations → ui-designer critique → ui-designer synthesis) preserved; `--skip` and `--artifact-target` flags continue to work; substrate selection happens at Phase 0 via `design-review-dispatch`.

LAYERS TOUCHED:
  L1:
    - `skills/design-review/SKILL.md` — add Phase 0 invocation of `design-review-dispatch`
  L2:
    - `skills/hive/skills/design-review-dispatch/SKILL.md` — net-new router (consumes `mode-resolver.mjs`)
  L3:
    - `skills/hive/skills/design-review-mode-multica/SKILL.md` — net-new atom; preserves 4-step workflow.yaml model with 4 `agent()` calls (substrate parity with workflow.yaml structure)
  L4:
    - `skills/hive/skills/design-review-mode-cc-workflows/SKILL.md` — net-new atom (consumes `cc-workflows-preconditions.mjs`); same 4-step model

NOT YET:
  - `/review` substrate coverage (Slice 5)
  - dispatch-parity.md (Slice 6)

VERIFIED BY:
  - Vitest: skill resolution test — `design-review-mode-cc-workflows` Phase 0c resolver
  - Vitest: skill resolution test — `design-review-mode-multica`
  - Lint: `lint-cc-workflows-no-codex.mjs` green for `design-review-mode-cc-workflows`
  - Lint: helper-import lint green for `design-review-mode-cc-workflows`
  - Manual: `/design-review` runs on both substrates produces identical artifact set to pre-epic behavior (no semantic change)

COMMIT REPRESENTS: `/design-review` end-to-end working on both substrates — substrate parity, semantic preserved

---

### Slice 5 (/review) — Substrate parity

**Stories:** `r-1-review-dispatch`, `r-2-review-mode-multica`, `r-3-review-mode-cc-workflows` (3 stories)

BUILDS ON: Slice 1 (foundation). Independent of Slices 2-4.
WHAT WORKS AFTER THIS STEP:
  `/review` runs end-to-end across both Multica and cc-workflows substrates as solo reviewer (no panel-mode expansion in this epic). The `scope_drift` emit call preserved when wrapping reviewer dispatch.

LAYERS TOUCHED:
  L1:
    - `skills/review/SKILL.md` — add Phase 0 invocation of `review-dispatch`; preserve solo reviewer pattern + `scope_drift` emit
  L2:
    - `skills/hive/skills/review-dispatch/SKILL.md` — net-new router (consumes `mode-resolver.mjs`)
  L3:
    - `skills/hive/skills/review-mode-multica/SKILL.md` — net-new atom
  L4:
    - `skills/hive/skills/review-mode-cc-workflows/SKILL.md` — net-new atom (consumes `cc-workflows-preconditions.mjs`)

NOT YET:
  - dispatch-parity.md (Slice 6)
  - Panel-mode `/review` (out of scope; future epic)

VERIFIED BY:
  - Vitest: skill resolution test — `review-mode-cc-workflows` Phase 0c resolver
  - Vitest: skill resolution test — `review-mode-multica`
  - Vitest: `scope_drift` emit call preserved through router wrapping
  - Lint: `lint-cc-workflows-no-codex.mjs` green for `review-mode-cc-workflows`
  - Lint: helper-import lint green for `review-mode-cc-workflows`
  - Manual: `/review` runs on both substrates produces identical artifact set + scope_drift emit to pre-epic behavior

COMMIT REPRESENTS: `/review` end-to-end working on both substrates — substrate parity, scope_drift emit preserved

NOTE ON `r-1` + `r-2` MERGE: per TPM ESCALATION (collab review) the wrappers are thin enough that `r-1` (router) + `r-2` (multica wrapper) could collapse. **Recommendation: keep separate for parity symmetry with Slices 2-4 (/test, /design, /design-review).** Each substrate slice has the same three-story shape (router + multica atom + cc-workflows atom). Merging in Slice 5 would create a one-off slice shape that complicates the dispatch-parity matrix (Slice 6) and makes future panel-mode extension messier. The marginal cost of one extra story is much smaller than the cost of structural asymmetry across substrate slices.

---

### Slice 6 (governance) — Dispatch-parity matrix

**Stories:** `s-1-dispatch-parity-md` (1 story)

BUILDS ON: Slices 1-5. Runs last.
WHAT WORKS AFTER THIS STEP:
  `hive/references/dispatch-parity.md` exists as a 6×3 matrix marking every cell green for the surfaces in scope. Reads cleanly across all four substrate slices; serves as the canonical reference for future epics adding more substrates (or more dispatching skills).

LAYERS TOUCHED:
  L7:
    - `hive/references/dispatch-parity.md` — net-new reference doc
    - Rows: `/plan`, `/execute`, `/test`, `/design`, `/design-review`, `/review`
    - Cols: `multica`, `cc-workflows`, `inline` (or `github` where applicable)
    - Each cell lists the mode skill path or marks N/A with rationale

NOT YET:
  - Nothing — this is the closer

VERIFIED BY:
  - Manual: every row × col cell either points at a real file path in the repo OR has an N/A with a one-sentence rationale
  - Manual: every path cited resolves (no 404s)
  - Optional CI assertion (future): a smoke script that walks the matrix and asserts each cited path exists

COMMIT REPRESENTS: Dispatch parity reference — 6×3 matrix; every cell green for surfaces in scope; epic closer

---

## 3. Overlay Diagram

```
VERTICAL SLICE OVERLAY
────────────────────────────────────────────────────────────────────────────────────────────────
              │ Slice 0 │ Slice 1     │ Slice 2     │ Slice 3        │ Slice 4         │ Slice 5     │ Slice 6
              │ pre-    │ foundation  │ /test       │ /design        │ /design-review  │ /review     │ governance
              │ flight  │             │             │                │                 │             │
──────────────┼─────────┼─────────────┼─────────────┼────────────────┼─────────────────┼─────────────┼────────────
L1 Orchestr   │         │             │ rip flag;   │ Phase A insert │ Phase 0 wire    │ Phase 0     │
              │         │             │ Phase 0     │ + toggle prose │                 │ wire        │
──────────────┼─────────┼─────────────┼─────────────┼────────────────┼─────────────────┼─────────────┼────────────
L2 Routers    │         │ mode-       │ test-       │ design-        │ design-review-  │ review-     │
   + helper   │         │ resolver    │ dispatch    │ dispatch       │ dispatch        │ dispatch    │
              │         │ .mjs        │ (s-2 user)  │ (s-2 user)     │ (s-2 user)      │ (s-2 user)  │
──────────────┼─────────┼─────────────┼─────────────┼────────────────┼─────────────────┼─────────────┼────────────
L3 Multica    │         │             │ (existing)  │ design-mode-   │ design-review-  │ review-     │
   atoms      │         │             │             │ multica        │ mode-multica    │ mode-       │
              │         │             │             │                │                 │ multica     │
──────────────┼─────────┼─────────────┼─────────────┼────────────────┼─────────────────┼─────────────┼────────────
L4 cc-        │         │ cc-         │ test-mode-  │ design-mode-   │ design-review-  │ review-     │
   workflows  │         │ workflows-  │ cc-         │ cc-workflows   │ mode-cc-        │ mode-cc-    │
   atoms +    │         │ precondit.  │ workflows   │                │ workflows       │ workflows   │
   helpers    │         │ .mjs + lint │ (per scen.) │                │                 │             │
──────────────┼─────────┼─────────────┼─────────────┼────────────────┼─────────────────┼─────────────┼────────────
L5 ABI        │         │             │ markNeeds   │                │                 │             │
              │         │             │ Rework +    │                │                 │             │
              │         │             │ adapters    │                │                 │             │
──────────────┼─────────┼─────────────┼─────────────┼────────────────┼─────────────────┼─────────────┼────────────
L6 Steps +    │         │             │ step-04b    │ wireframe      │                 │             │
   personas + │         │             │ + step-06   │ handoff (d-5)  │                 │             │
   cross-cut  │         │             │ + sentinel  │                │                 │             │
              │         │             │ + cross-cut │                │                 │             │
──────────────┼─────────┼─────────────┼─────────────┼────────────────┼─────────────────┼─────────────┼────────────
L7 Docs +     │         │ lint to     │             │ /design prose  │                 │             │ dispatch-
   governance │         │ npm test    │             │ (Pattern B+    │                 │             │ parity.md
              │         │             │             │ toggle)        │                 │             │ matrix
──────────────┼─────────┼─────────────┼─────────────┼────────────────┼─────────────────┼─────────────┼────────────
Spike         │ audit   │             │             │                │                 │             │
              │ recover │             │             │                │                 │             │
────────────────────────────────────────────────────────────────────────────────────────────────

Stories:        1         3            3              5                3                 3            1     = 19 total
Working state:  spike     foundation    /test e2e      /design e2e      /design-rev e2e  /review e2e   matrix
                resolved  helpers+lint  both subs      both subs        both subs        both subs    green
                          green                                                                       cell-by-cell

Each column is a commit-worthy, working state.
```

**Parallel-eligibility footnote.** Slices 2, 3, 4, and 5 are **parallel-eligible after Slice 1 lands** — they share no L2/L3/L4/L5/L6/L7 surfaces in conflict, and the foundation in Slice 1 is the only cross-slice prerequisite they share. **Serial fallback** (per design-discussion §5 caveat): if parallel execution surfaces problems during planning-routing concurrent dispatch, serialize Slice 2 → Slice 3 → Slice 4 → Slice 5. Estimated schedule cost of serial fallback: **+3-5 days** (4 slices × ~1 day average serial overhead). Slice 6 always runs last regardless of mode.

---

## 4. Deferred Items

```
DEFERRED (not in current slice plan):
  - Panel-mode /review (Slice 5 keeps solo reviewer; panel mode is a future epic) — design-discussion §6 Q5 deferred
  - Wireframe handoff "constraint doc only" variant (Slice 3 default ships richer PNG + .f0 + constraints; trim to PNG + .f0 only is a one-line config change post-ship) — Q9
  - design-mode-multica "one issue per persona" vs "one issue per call" — defaulted to one-per-persona in Slice 3 per execute-mode-multica precedent; Q10 explicitly resolved by-default rather than gated
  - Cross-substrate mid-run switching — out of scope per design-discussion §7; mode resolves once at Phase 0c
  - Hermes-side integration — out of scope per source outline
  - CI assertion smoke-test for dispatch-parity.md (manual check in Slice 6; CI assertion deferred to follow-up)

RATIONALE: Each deferred item is either (a) explicitly future scope (panel mode, Hermes), (b) reversible
post-ship configuration (handoff payload trim, multica issue surface), or (c) hardening that doesn't
block the substrate coverage closure (CI assertion for parity matrix). None are silent — each one is
listed with a forward path.
```

---

## 5. Risk by Slice

```
RISK PER SLICE:
  Slice 0: Low — pure recovery/decision spike; if accept-risk path chosen, slice closes immediately.

  Slice 1: Medium — mode-resolver extraction is a behavioral refactor of execute-dispatch Step 0.
                    Snapshot tests against pre-refactor outputs are mandatory. Back-fitting the
                    cc-workflows-preconditions helper into existing plan/execute mode-cc-workflows
                    atoms adds blast radius; helper-import lint catches missed imports.

  Slice 2: HIGH — Three risk vectors: (a) TDD methodology for `markNeedsRework` adapter contract
                  with two implementations of non-symmetric backing state machines (Multica 5-state,
                  GitHub 2-state); (b) `--simulated-manual` hard-rip is a breaking flag removal
                  affecting cross-cutting-concerns.yaml; (c) step-06-triage classification-emit
                  has to ONLY fire for `story-issue` and NOT for transient or human-blocker.
                  Manual end-to-end smoke on a known story-issue scenario is non-negotiable.

  Slice 3: HIGH — Phase A is a structural insert into /design (NOT a modification). Toggle adds
                  branching complexity. d-1 carries Pattern B posture + toggle wiring + 3-persona
                  handoff payload — three-in-one story. Mitigation: AC MUST cite design-review.
                  workflow.yaml:8-81 as the architectural anchor to prevent re-invention.

  Slice 4: Low — substrate parity slice; semantic explicitly preserved. The architectural template
                 (design-review.workflow.yaml 4-step model) is already proven. Lowest-risk substrate
                 slice.

  Slice 5: Low — solo reviewer; thinnest wrappers in the epic. Main risk: forgetting to preserve
                 the scope_drift emit call when wrapping. Test covers.

  Slice 6: Low — pure documentation slice; verification is manual (cell-by-cell path check).
```

---

## 6. Moldability Notes

The plan is moldable in several directions, each preserving the working-state invariant:

- **Slice ordering between 2-5 can change.** After Slice 1, any of /test, /design, /design-review, /review can ship first. If, mid-execution, a substrate slice surfaces an unexpected L5 ABI gap or L6 step-file ambiguity, the remaining slices can be reordered without invalidating completed work. Recommended starting order is 2 → 3 → 4 → 5 (most-risk-first) but the converse 5 → 4 → 3 → 2 (lowest-risk-first to seed confidence) is equally valid.

- **Slice 3 d-5 wireframe handoff can split.** If Q9 resolution lands richer than expected (e.g., includes constraint doc + rendition transcript), `d-5` can split into `d-5a` wireframe-payload and `d-5b` constraint-doc-emit. Adds 1 story (epic grows to 20); does not invalidate `d-1` through `d-4`.

- **Slice 5 r-1/r-2 merge remains available if asymmetry becomes acceptable.** Recommendation above is keep-separate for parity symmetry, but if mid-execution it becomes clear that Slice 6's dispatch-parity matrix is robust to one-off shapes, r-1 + r-2 can collapse to a single story. Saves 1 story (epic shrinks to 18).

- **Slice 6 can extend mid-execution.** If a planned substrate slice (2-5) discovers a new dispatching skill that should also be covered (e.g., `/test-architect` if it materializes), Slice 6's matrix can grow rows without changing column structure. The reference doc is naturally extensible.

- **Slice 0 outcome shapes downstream verification rigor.** If audit is recovered, design-discussion §5 Constraint 5 is dual-cited (full robustness). If accept-risk path chosen, Slice 2's manual smoke on the bounce-back becomes the carrier for Constraint 5's gate-ownership assertion (single-cited but verified end-to-end at story time).

- **What CANNOT change without re-planning:** Slice 1 must precede 2-5 (foundation invariant). Slice 5 ABI must precede Slice 2 step-06 emit within Slice 2 (TDD invariant). Slice 6 must run last (matrix-reads-from-all-prior invariant). These three sequencing constraints are baked into the dependency graph.

---

**Cross-references for downstream:** Structured outline (Phase C) consumes Section 2 slice-by-slice story enumeration, Section 5 risk-by-slice, and Section 6 moldability notes. Story authoring (Phase C step 4) gates per the design-discussion §5 pre-plan blockers — Q2 (ABI), Q4 (audit), Q6 (Pattern B posture) — all resolved by user decision and baked into this plan; Q12 (s-2 ordering) resolved via Slice 1 foundation-first; Q13 (d-1 split) recommendation: keep one; Q14 (r-1/r-2 merge) recommendation: keep separate.
