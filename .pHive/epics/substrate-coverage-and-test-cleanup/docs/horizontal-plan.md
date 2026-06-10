# Horizontal Planning Scan — substrate-coverage-and-test-cleanup

**Epic:** substrate-coverage-and-test-cleanup (Part 2 of cc-workflows-first-party)
**Phase:** B — Horizontal Plan (TPM)
**Author:** tpm
**Date:** 2026-06-05
**Inputs:** design-discussion.md (rev. 1), research-brief.md, grill-record.md, collab-review-record.md
**Sibling artifact:** vertical-plan.md (in this directory)

---

## 1. Layer Inventory

Substrate-coverage is dispatcher work. The architecture is layered as orchestrator → router → mode atom → ABI → step files → docs/governance. Seven layers participate; each one is touched by 1-8 net-new or modified artifacts.

| # | Layer | What it does today | How this epic affects it |
|---|---|---|---|
| L1 | **Orchestrator slash skills** (`skills/{test,design,design-review,review}/SKILL.md`) | Top-level user-invoked dispatchers; today inline-resolve and inline-dispatch | `/test` gets `--simulated-manual` ripped + scenario-replay folded; `/design` gets a structural Phase A persona-assembly insert with `--include-constraints` toggle; all four learn to delegate substrate selection to a router. |
| L2 | **Dispatch routers** (`skills/hive/skills/{test,design,design-review,review}-dispatch/SKILL.md` + `hive/lib/mode-resolver.mjs`) | `plan-dispatch` + `execute-dispatch` exist; the new 4 do not | 4 net-new router skills + 1 shared 5-tier resolver helper extracted from `execute-dispatch` Step 0 (lines 46-101). |
| L3 | **Mode atoms — Multica side** (`skills/hive/skills/*-mode-multica/SKILL.md`) | `plan-mode-multica`, `execute-mode-multica`, `test-mode-multica` exist | 4 net-new mode skills: `test-mode-multica` already exists so it's `design-mode-multica`, `design-review-mode-multica`, `review-mode-multica` (3 net-new). Wait — outline counts 4 multica atoms; only 3 are net-new because `test-mode-multica` is already shipped. **Net-new Multica atoms = 3.** |
| L4 | **Mode atoms — cc-workflows side** (`skills/hive/skills/*-mode-cc-workflows/SKILL.md` + `hive/lib/cc-workflows-preconditions.mjs` + lint) | `plan-mode-cc-workflows` + `execute-mode-cc-workflows` exist | 4 net-new mode skills (`test-mode-cc-workflows`, `design-mode-cc-workflows`, `design-review-mode-cc-workflows`, `review-mode-cc-workflows`) + 1 shared worktree-isolation precondition helper + lint asserting every atom imports it. |
| L5 | **ABI surface** (`hive/lib/task-tracking-dispatch/index.ts` + `hive/adapters/{multica,github}/index.ts`) | Routes everything through `invoke(method, params)`; capabilities via `capability('supported_states')`. `updateStatus` on GitHub takes `open\|closed`; Multica exposes `updateStory({status})` | Adds **new ABI method `markNeedsRework({id, reason})`** (per user decision); Multica adapter implements as `updateStory({status:'in_review'}) + 'hive:needs-rework' label`; GitHub adapter implements as `reopen + 'hive:needs-rework' label`. NO extend-updateStatus, NO rename-updateStory. |
| L6 | **Workflow step files + personas + cross-cutting concerns** (`hive/workflows/steps/`, `hive/agents/`, `.pHive/cross-cutting-concerns.yaml`) | `test-swarm.workflow.yaml` runs 9 steps via step_file convention; `design-review.workflow.yaml` runs 4 steps via step_file refs; `test-sentinel` persona prose-documents triage but execution lives in `step-06-triage.md` | 1 net-new step file (`test-swarm/step-04b-scenario-replay.md`); 1 modified step file (`test-swarm/step-06-triage.md` — emits `markNeedsRework` when triage classifies a `story-issue`); 1 modified persona (`test-sentinel.md` prose update only — no executable change); 1 modified cross-cutting-concerns entry (simulated-manual is retired). |
| L7 | **Docs + governance** (`hive/references/dispatch-parity.md`, `/design` prose, lint scripts) | `dispatch-parity.md` does not exist; lint scripts cover no-codex but not multi-surface | 1 net-new reference doc (6×3 parity matrix); 1 net-new lint script (`lint-cc-workflows-no-codex.mjs` — AST + 2 grep passes); 1 modified prose section in `skills/design/SKILL.md` documenting Pattern B + `--include-constraints` toggle. |

---

## 2. Per-Layer Requirements

### Layer L1 — Orchestrator slash skills (`skills/{test,design,design-review,review}/SKILL.md`)

ORCHESTRATOR CHANGES — `/test`:
  - Rip `--simulated-manual` flag handling (lines 14-93 of `skills/test/SKILL.md`)
  - Rip `HIVE_TEST_MODE` inline resolver (lines 37-51) — delegate to `test-dispatch`
  - Fold scenario-replay into swarm pipeline (between step 3 worker and step 4 inspector) — see L6 new step file
  - Update pipeline table (lines 109-119) to reflect swarm-only flow
  - Update Phase 0 to invoke `test-dispatch`

ORCHESTRATOR CHANGES — `/design`:
  - **NET-NEW Phase A insert** above existing step 3 (`skills/design/SKILL.md:55-64`)
    - Phase A assembles `[accessibility-specialist, animations-specialist, ui-designer]` when `--include-constraints` is passed (default: ui-designer only, single dispatch)
    - When toggle ON: serial dispatch accessibility → animations to produce constraint notes; then ui-designer dispatched ONCE with constraints baked into prompt
    - When toggle OFF: legacy single-ui-designer behavior preserved
    - Phase A AC MUST cite `hive/workflows/design-review.workflow.yaml:8-81` as the orchestration template
  - Add Phase 0 to invoke `design-dispatch` and resolve substrate before persona phase
  - Update prose to document Pattern B + toggle semantics

ORCHESTRATOR CHANGES — `/design-review`:
  - Add Phase 0 invocation of `design-review-dispatch`
  - Preserve `--skip` + `--artifact-target` semantics (no semantic change)
  - Reaffirm 3-persona pipeline contract referenced by L3/L4 atoms

ORCHESTRATOR CHANGES — `/review`:
  - Add Phase 0 invocation of `review-dispatch`
  - Preserve solo reviewer pattern (lines 39-49) — no panel-mode expansion in this epic
  - Preserve `scope_drift` emit call when wrapping reviewer dispatch (utility from `hive/lib/scope_drift.py`)

### Layer L2 — Dispatch routers + shared resolver helper

NEW ROUTER SKILLS (4):
  - `skills/hive/skills/test-dispatch/SKILL.md` (~200-250 lines, mirrors `execute-dispatch`)
  - `skills/hive/skills/design-dispatch/SKILL.md`
  - `skills/hive/skills/design-review-dispatch/SKILL.md`
  - `skills/hive/skills/review-dispatch/SKILL.md`

ROUTER STRUCTURE (all 4 identical):
  - Step 0: invoke shared resolver `hive/lib/mode-resolver.mjs` to resolve `mode_decision`
  - Step 1: dispatch to chosen mode atom (`{skill}-mode-{multica,cc-workflows,github,inline}`)
  - Step 2: return `{mode_decision, sources}` so callers can audit provenance

NEW SHARED HELPER:
  - `hive/lib/mode-resolver.mjs` — extracted from `execute-dispatch/SKILL.md:46-101` Step 0
  - Canonical 5-tier resolution: env > root config > shipped baseline > skill override > default
  - **Signature returns `{decision, sources}`** (per architect ESCALATION — preserves field-source telemetry that execute-dispatch emits today)
  - Resolver name vars: `HIVE_TEST_MODE`, `HIVE_DESIGN_MODE`, `HIVE_DESIGN_REVIEW_MODE`, `HIVE_REVIEW_MODE`

CO-EVOLUTION:
  - `execute-dispatch` Step 0 refactored to consume the new helper (eliminates duplication; preserves emit semantics)

### Layer L3 — Mode atoms (Multica side)

NEW SKILLS (3 net-new; `test-mode-multica` already exists and is unchanged):
  - `skills/hive/skills/design-mode-multica/SKILL.md` (~400-450 lines, mirrors `execute-mode-multica`)
  - `skills/hive/skills/design-review-mode-multica/SKILL.md`
  - `skills/hive/skills/review-mode-multica/SKILL.md`

ATOM STRUCTURE (Multica side):
  - Per-persona dispatch within a team-cell; episode markers per persona
  - Serial within team-cell
  - Multica issue creation surface — pending Q10 resolution (default: one issue per persona for design-mode-multica, mirroring execute-mode-multica)

EPISODE MARKER FAMILY:
  - `${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/multica-run.yaml`

### Layer L4 — Mode atoms (cc-workflows side) + worktree-isolation helper + lint

NEW SKILLS (4 net-new):
  - `skills/hive/skills/test-mode-cc-workflows/SKILL.md` (~330-360 lines, mirrors `plan-mode-cc-workflows`)
    - **Dispatch granularity: per-scenario** (architect-resolved; mirrors test-mode-multica)
  - `skills/hive/skills/design-mode-cc-workflows/SKILL.md`
  - `skills/hive/skills/design-review-mode-cc-workflows/SKILL.md`
  - `skills/hive/skills/review-mode-cc-workflows/SKILL.md`

ATOM STRUCTURE (cc-workflows side):
  - Step 0: precondition gate calling `hive/lib/cc-workflows-preconditions.mjs` (asserts worktree-isolation)
  - Step 0: defensive args parse contract — `const a = typeof args === 'string' ? JSON.parse(args) : args;`
  - Step 1: per-persona (or per-scenario for test) serial dispatch via default workflow subagent — NO Codex routing
  - Step 2: poll-to-terminal
  - Step 3: episode marker write to `${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/cc-workflows-run.yaml`
  - Step 4: sidecar no-op
  - Step 5: aggregate return

NEW SHARED HELPER:
  - `hive/lib/cc-workflows-preconditions.mjs` — exports `assertWorktreeIsolation()` (and any sibling preconditions)
  - Asserts `*-mode-cc-workflows` runs are on a dedicated worktree, not the main checkout
  - Reasoning: DRY (single invariant, single maintenance site); dispatch-time vs body-time (check belongs in precondition contract); aligns with `feedback_codex_parallel_race` discipline

NEW LINT SCRIPT (consumed in L7):
  - `hive/scripts/lint-cc-workflows-no-codex.mjs` (multi-surface scope):
    1. AST check for `agentType:` literal in `*-mode-cc-workflows/` skill files
    2. Grep for `codex:codex-rescue` skill references inside those paths
    3. Grep for `agent_backends` config keys inside those paths
  - Additional lint pass: every `*-mode-cc-workflows/SKILL.md` imports `cc-workflows-preconditions.mjs` at Step 0
  - Wired into `npm test`

### Layer L5 — ABI surface (`task-tracking-dispatch` + adapters)

NEW ABI METHOD:
  - `markNeedsRework({id, reason})` added to `hive/lib/task-tracking-dispatch/index.ts`
  - Routes through `invoke('markNeedsRework', {id, reason})` (consistent with existing dispatch shape at lines 205-282)
  - **NOT** an extension of `updateStatus`; **NOT** a rename of Multica's `updateStory`
  - Domain verb cleanly sidesteps GitHub's `supported_states = [open, closed]` limitation
  - Capability advertised via `capability('supports_needs_rework')` (defensive opt-in mirroring existing `supported_states` gate at 285-288)

ADAPTER IMPLEMENTATIONS:
  - `hive/adapters/multica/index.ts:335-348` area — implement `markNeedsRework` as `updateStory({status:'in_review'})` followed by adding `hive:needs-rework` label
    - Mid-state choice `in_review` per user decision (canonical Multica state per Q7)
  - `hive/adapters/github/index.ts:291-309` area — implement `markNeedsRework` as `reopen issue` followed by adding `hive:needs-rework` label
    - State machine restriction (open/closed only) is respected; semantic carried by label

TEST SCAFFOLDING:
  - `__resetHandleCache` + `__resetNoAdapterWarningForTests` already exist for adapter tests
  - TDD methodology applies to `t-2`: adapter contract test first, two implementations second

### Layer L6 — Workflow step files + personas + cross-cutting concerns

NEW STEP FILE:
  - `hive/workflows/steps/test-swarm/step-04b-scenario-replay.md`
  - Sits between step-03-worker and step-04-inspector
  - Consumes existing `loadScenario` from `hive/lib/scenarios/load.mjs`
  - Replaces the legacy `hive/workflows/steps/test/simulated-manual.md` execution

MODIFIED STEP FILE:
  - `hive/workflows/steps/test-swarm/step-06-triage.md`
  - When triage classifies a failure as `story-issue` (line 16 categories), emit `markNeedsRework({id, reason})` via `TaskTrackingDispatch`
  - Transient or human-blocker classifications: no emit (preserves existing semantics)
  - Summary block (111-114) extended to record `needs_rework_emitted: true/false`

MODIFIED PERSONA (prose only):
  - `hive/agents/test-sentinel.md` — prose mention of the new bounce-back behavior; persona has NO executable change (executable contract lives in step file per CONTEXT.md step-vs-persona discipline)

MODIFIED CROSS-CUTTING CONCERNS:
  - `.pHive/cross-cutting-concerns.yaml:99-126` — remove the simulated-manual implementation_checklist (it's being retired); replace with a `scenario-replay-folded` historical note

WIREFRAME HANDOFF (Slice B `d-5`):
  - Final shape pending Q9 (PNG + `.f0` only, or include constraint doc)
  - Default if unresolved at story-writing: include constraint doc (richer payload; reversible)

### Layer L7 — Docs + governance

NEW REFERENCE DOC:
  - `hive/references/dispatch-parity.md` — 6×3 matrix
    - Rows: `/plan`, `/execute`, `/test`, `/design`, `/design-review`, `/review`
    - Cols: `multica`, `cc-workflows`, `inline` (or `github` where applicable per skill)
    - Each cell either lists the mode skill path or marks `N/A` with rationale
    - Reads from all L2/L3/L4 artifacts — runs last in slice order

MODIFIED PROSE:
  - `skills/design/SKILL.md` — prose section documenting Pattern B + `--include-constraints` toggle semantics, default behavior, escape hatches
  - References specialist-triggers integration (toggle routes through specialist-triggers to add accessibility-specialist + animations-specialist)

LINT WIRING:
  - `hive/scripts/lint-cc-workflows-no-codex.mjs` (defined in L4) wired into `npm test` script section of `package.json`

---

## 3. Cross-Layer Dependencies

```
DEPENDENCIES:

L2 helper (s-2 mode-resolver.mjs) → L2 routers (test, design, design-review, review-dispatch)
  RATIONALE: routers consume the helper; if routers ship first they inline-resolve
             and s-2 becomes post-hoc rewrite of 4 fresh files.
             TPM-raised (resolved via Slice 1 ordering — see vertical plan).

L2 helper (s-2 mode-resolver.mjs) → L3 + L4 mode atoms (all 7 net-new atoms)
  RATIONALE: atoms emit field_sources in their precondition gates; the helper
             surfaces {decision, sources} that atoms re-emit.

L4 worktree-isolation helper (s-4 cc-workflows-preconditions.mjs) → L4 mode atoms (4 cc-workflows atoms)
  RATIONALE: each atom imports the helper at Step 0 precondition gate.
             If atoms ship first, each re-derives the isolation contract.
             Architect ESCALATION + grill H1/C1.

L5 ABI markNeedsRework method → L6 step-06-triage.md emit + L6 persona prose
  RATIONALE: emit call cannot exist before the ABI method exists.
             Within Slice 2 (Slice A in source outline), TDD ordering:
             (a) ABI contract test, (b) two adapter implementations,
             (c) step file emit, (d) persona prose.

L1 /design Phase A insert (d-1) ↔ L4 design-mode-cc-workflows (d-4) ↔ L3 design-mode-multica (d-3)
  RATIONALE: Phase A is a structural insert in the orchestrator; the mode atoms
             receive personas resolved by Phase A. If Phase A AC moves
             (Pattern B-with-toggle vs always-on), atom dispatch shape moves too.
             Couples Slice 3 stories d-1 ↔ d-2 ↔ d-3 ↔ d-4 ↔ d-5.

L2 design-dispatch (d-2) → L1 /design Phase A (d-1)
  RATIONALE: Phase A invokes the router at Phase 0; router must exist or
             /design has no substrate resolution path.

L7 dispatch-parity.md (s-1) → all of L2 + L3 + L4
  RATIONALE: matrix references every router + every mode atom path.
             Must run last so no cell is empty.

L7 /design prose update → L1 d-1 + L4 d-4
  RATIONALE: prose documents toggle semantics that the orchestrator + atom enforce.
             Land in the same slice (Slice 3) as the implementation.

L6 cross-cutting-concerns.yaml update → L1 /test --simulated-manual rip (t-1)
  RATIONALE: implementation_checklist references the flag being removed.
             Slice 2 closes both in lockstep.

L4 lint (s-3) → L4 mode atoms (4 cc-workflows atoms)
  RATIONALE: atoms must exist for lint to assert against. Lint can ship in
             Slice 1 (foundation) with stub atoms, OR ship in Slice 6 (governance)
             after all atoms exist. Slice 1 chosen so lint guards every atom
             from its first commit; lint asserts on empty path until atoms arrive.

L7 lint script wiring → all L4 atoms (4 cc-workflows atoms)
  RATIONALE: wiring into npm test should happen once atoms can pass the check.

CROSS-LAYER COUNT (flagged): 10
```

---

## 4. Layer Map Diagram

```
HORIZONTAL LAYER MAP
────────────────────────────────────────────────────────────────────────────────────────
              │ /test          │ /design         │ /design-review │ /review        │ shared infra
              │ surface        │ surface         │ surface         │ surface        │
──────────────┼────────────────┼─────────────────┼─────────────────┼────────────────┼─────────────
L1 Orchestrator│ rip simulated  │ Phase A insert  │ Phase 0 wire    │ Phase 0 wire   │
   slash       │ -manual; fold  │ + toggle prose; │ to dispatch;    │ to dispatch;   │
              │ scenario-      │ Phase 0 wire    │ preserve --skip │ preserve solo  │
              │ replay; Phase 0│ to dispatch     │ + artifact-     │ + scope_drift  │
              │ wire           │                 │ target          │ emit           │
──────────────┼────────────────┼─────────────────┼─────────────────┼────────────────┼─────────────
L2 Dispatch   │ test-dispatch  │ design-dispatch │ design-review-  │ review-        │ mode-
   routers    │ (new)          │ (new)           │ dispatch (new)  │ dispatch (new) │ resolver.mjs
              │                │                 │                 │                │ (new helper)
──────────────┼────────────────┼─────────────────┼─────────────────┼────────────────┼─────────────
L3 Multica    │ test-mode-     │ design-mode-    │ design-review-  │ review-mode-   │
   atoms      │ multica        │ multica (new)   │ mode-multica    │ multica (new)  │
              │ (existing)     │                 │ (new)           │                │
──────────────┼────────────────┼─────────────────┼─────────────────┼────────────────┼─────────────
L4 cc-        │ test-mode-     │ design-mode-    │ design-review-  │ review-mode-   │ cc-workflows-
   workflows  │ cc-workflows   │ cc-workflows    │ mode-cc-        │ cc-workflows   │ preconditions
   atoms      │ (new,          │ (new)           │ workflows (new) │ (new)          │ .mjs (new
              │ per-scenario)  │                 │                 │                │ helper) + lint
──────────────┼────────────────┼─────────────────┼─────────────────┼────────────────┼─────────────
L5 ABI        │ markNeedsRework│                 │                 │                │ TTD method +
              │ + adapter      │                 │                 │                │ both adapters
              │ wires          │                 │                 │                │ (multica +
              │                │                 │                 │                │ github)
──────────────┼────────────────┼─────────────────┼─────────────────┼────────────────┼─────────────
L6 Step files │ step-04b-      │ wireframe       │ (workflow.yaml  │                │ cross-
   + personas │ scenario-      │ handoff payload │ already encodes │                │ cutting-
              │ replay (new);  │ (d-5)           │ 3-persona       │                │ concerns
              │ step-06-triage │                 │ pipeline)       │                │ .yaml update
              │ emit;          │                 │                 │                │
              │ test-sentinel  │                 │                 │                │
              │ prose          │                 │                 │                │
──────────────┼────────────────┼─────────────────┼─────────────────┼────────────────┼─────────────
L7 Docs +     │                │ Pattern B +     │                 │                │ dispatch-
   governance │                │ toggle prose    │                 │                │ parity.md
              │                │ in /design      │                 │                │ matrix (new);
              │                │ SKILL.md        │                 │                │ lint wired
              │                │                 │                 │                │ to npm test
────────────────────────────────────────────────────────────────────────────────────────
```

---

## 5. Scope Summary

```
HORIZONTAL SCOPE:
  Layers affected: 7
  Total items: ~37
    - L1: 4 modified orchestrator skills
    - L2: 4 new router skills + 1 new shared helper = 5
    - L3: 3 new Multica mode atoms (test-mode-multica unchanged)
    - L4: 4 new cc-workflows mode atoms + 1 new helper + 1 new lint = 6
    - L5: 1 new ABI method on TTD + 2 modified adapters = 3
    - L6: 1 new step file + 1 modified step file + 1 modified persona + 1 modified cross-cutting = 4
    - L7: 1 new reference doc + 1 modified prose section + lint wiring = 3
    - Spike (Slice 0): 1 audit recovery (cc-workflows-smoke-1780516800.yaml)
  New vs modified: 14 new artifacts, 13 modified, 1 spike
  Estimated total effort: large

  LARGEST LAYER: L4 (cc-workflows side) — 4 net-new atoms + helper + lint;
                 carries worktree-isolation invariant and no-Codex lint scope
  RISKIEST LAYER: L5 (ABI surface) — net-new method `markNeedsRework`,
                  two adapter implementations with non-symmetric backing
                  state machines (Multica 5-state vs GitHub 2-state);
                  TDD methodology required per tpm ESCALATION;
                  downstream L6 emit cannot proceed until L5 contract lands
```

---

**Cross-references for downstream:** Vertical plan (sibling document) consumes Section 3 (cross-layer dependencies) to determine slice ordering — specifically, the L2-helper-before-routers, L4-helper-before-atoms, L5-ABI-before-L6-emit, and L7-dispatch-parity-last dependencies. Section 4 layer map becomes the canvas the vertical overlay diagram draws on.
