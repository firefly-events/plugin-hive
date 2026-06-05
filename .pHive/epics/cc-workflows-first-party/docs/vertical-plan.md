# Vertical Plan — cc-workflows-first-party

**Epic id:** `cc-workflows-first-party`
**Base branch:** `develop`
**Branch strategy:** per-epic (`feat/cc-workflows-first-party`)
**Author:** technical-writer (Phase B2 step 6, 2026-05-31)
**Status:** authored from horizontal-plan.md + design-discussion v2 + cycle-state gate_decisions

Vertical slices overlay the horizontal layer map (sibling doc) with execution order. Every slice leaves the product in a verifiable working state. Issues caught at slice they were introduced, not after unknowns pile up.

---

## 1. Slicing Strategy

```
STRATEGY:
  Total horizontal items (across 9 layers): ~50-90 file touches
  Planned slices: 6
  First slice goal: Phase 0 spike — verify the load-bearing /workflows unknown
                    BEFORE any production code lands. Maintainer gate at end.
  Final slice goal: README + CONTEXT.md repositioned so the canonical North Star
                    reflects first-party CC workflows; vocab disambiguated;
                    composability posture (i) durable in CONTEXT.md.

  Slicing rationale:
    - Slice 1 = thinnest PoC because the public spec for /workflows is ONE
      CHANGELOG sentence (research brief §risk-1 HIGH). All design claims about
      workflow definition syntax, integration-branch honoring, persona-to-step
      mapping, fan-out semantics, completion signal, and plugin-shipped skill
      auto-load are unverified. The spike resolves them with first-hand evidence.
      Maintainer-gated at end; no Phase 1+ build until criteria (a)-(d) have verdicts.
    - Slice 2 collapses design's Phase 1 + 2 + 3 into one MVP because they share
      a runtime substrate (the new adapter skill, the new config knob, the
      integration-branch contract) and ONLY become demo-able together. Cutting
      them apart would land an unrunnable middle state.
    - Slice 3 (persona re-classification) needs first-hand evidence from Slices 1+2
      to verdict accurately. Read-only doc, low risk, but posture-regression
      risk if 22/3 cut wrong (feedback_no_team_lead_intermediary preserved).
    - Slice 4 (disposition AUDIT, read-only) is parallel-eligible to Slices 2-3.
      Zero coupling. Can start as soon as Slice 1 gate clears.
    - Slice 5 (disposition APPLY) must sequence AFTER Q3 resolution (already
      maintainer-confirmed at gate 1: keep-as-second-party for first release)
      AND AFTER Slice 4 audit candidates exist. Writes per-epic-override entries
      to cycle-state — these are read by Slice 2's resolver.
    - Slice 6 (README + CONTEXT.md) lands LAST so language reflects shipped
      behavior, not aspiration. Defended in design-discussion §10 vs grill C3.

  Phase 4 autopilot split: DESCOPED at gate 1 by maintainer (Q5). Skipped entirely
  from this vertical plan — see §4 Deferred Items.
```

---

## 2. Vertical Slice Plan

### Slice 1 — Phase 0 capability spike

```
WHAT WORKS AFTER THIS SLICE:
  /workflows has been run end-to-end against one real ≤5-story hive epic (a small
  existing epic or a synthetic one), with at least one Codex-routed creator
  persona in the team. spike-findings.md carries explicit PASS / FAIL verdicts
  for criteria (a)-(d):
    (a) integration-branch contract honored
    (b) Codex creators return file lists AND adapter commits serially (architect
        tightened from "no parallel-Codex race")
    (c) completion signal + failure modes recoverable
    (d) plugin-shipped .claude/skills/ auto-load under CLI-interactive 2.1.157

LAYERS TOUCHED:
  Layer 9 (Phase 0 spike artifact) — PRIMARY
    - .pHive/epics/cc-workflows-first-party/docs/spike-findings.md (NEW)
  Layer 1 (executor seam) — EPHEMERAL (no production code lands)
    - Spike harness may scaffold a draft execute-mode-cc-workflows skill but
      doesn't land it in marketplace plugin tree until Slice 2
  Layer 3 (integration-branch contract) — EPHEMERAL
    - Manual / scripted attempt to inject shell-snippet contract into agent
      prompts; result recorded as criterion (a) verdict

NOT YET:
  - Production execute-mode-cc-workflows/SKILL.md in skills/hive/skills/
  - execution.runtime config knob in either hive.config.yaml
  - mode_decision enum extension
  - field_sources changes
  - Persona re-classification
  - Disposition audit or apply
  - README rewrite

VERIFIED BY:
  - spike-findings.md exists with explicit PASS / FAIL per criterion (a)-(d)
  - At least one Codex-routed creator persona was in the test team (per TPM +
    architect — without this, spike pass is hollow)
  - Maintainer reads spike-findings.md and signs the gate
  - Cycle-state .pHive/cycle-state/cc-workflows-first-party.yaml updated with
    spike outcome + Plan B branch selections (Q2 (a) / (b) / (c); Q5
    auto-load PASS / FAIL → Layer 5 Plan B branch)

COMMIT REPRESENTS:
  "Phase 0 capability spike — /workflows verified against criteria (a)-(d)
   with Codex-routed creator. Maintainer-gated."

HARD GATE:
  Maintainer-gated. Slices 2-6 carry blockedBy: <slice-1 stories>.

RISK: HIGH — load-bearing unknowns; gate to all downstream. If any criterion
fails, downstream slices reshape (potentially pivot to rescope-memo Option C
"Multica-as-queue, /workflows as constrained executor").
```

---

### Slice 2 — MVP first-party path (Phases 1+2+3 collapsed)

```
BUILDS ON: Slice 1 (gate cleared with verdicts)

WHAT WORKS AFTER THIS SLICE:
  A real hive epic can run via execution.runtime: workflows (env or config
  override) — `mode_decision` enum resolves cc-workflows; new
  execute-mode-cc-workflows skill executes via /workflows; serial-commit gate
  honored (agents return file lists, harness commits per-story to integration
  branch); one persona runs end-to-end (researcher OR developer) producing a
  single correctly-formatted commit on the epic branch.

  Opt-in only: execution.runtime: auto is NOT yet activated by default — the
  shipped baseline ships as auto but real-world use requires explicit env or
  root-config override until Slice 5 lands per-epic-override entries.

LAYERS TOUCHED:
  Layer 1 (executor seam) — PRIMARY
    - skills/execute/SKILL.md: add step 6f cc-workflows branch
    - skills/hive/skills/execute-dispatch/SKILL.md:
        • mode_decision enum: + 'cc-workflows'
        • field_sources.execution_mode: env > root config > shipped baseline >
          skill override > default
        • field_sources.execution_runtime: same precedence chain
        • field_sources.execution_runtime.epic_override: <path> (architect Q2
          tightening — records which per-epic disposition file used)
        • Resolver reads per-epic disposition BEFORE emitting mode_decision
    - skills/hive/skills/execute-mode-cc-workflows/SKILL.md (NEW)
        • Step 0: precondition gate
        • Step 1: workflow_assembly substep (outer seam invariant)
        • Step 2: /workflows dispatch
        • Step 3: serial-commit gate (Layer 3 mechanism)
        • Step 4: episode marker write
        • Step 5: summary return
  Layer 2 (config schema) — PRIMARY
    - hive.config.yaml: execution.runtime: workflows | multica | auto (default auto)
    - hive/hive.config.yaml: execution.runtime: auto (shipped baseline)
    - hive.config.yaml schema_version bump (cross-cutting versioning concern)
  Layer 3 (integration-branch contract) — PRIMARY
    - serial-commit gate at integration-branch push layer (architect Q3+Q4 unified)
    - Q2 (a) path IF Phase 0 (a) PASS: shell-snippet contract injection into agent
      prompts (mirror multica-story-dispatch:192-262)
    - Plan B branch IF Phase 0 (a) FAIL: Slice 2 implements either:
        (b) per-unit PR — bends git_flow.branch_strategy
        (c) worktree-per-story isolation + serialized merge (CC-native primitives)
      maintainer call at Slice 2 entry per Q2
    - Optional shared helper to factor serialization logic from
      multica-story-dispatch:192-262 (decision deferred to implementation)
  Layer 7 (task-tracking-dispatch) — READ-ONLY re-use
    - Step 5 summary return invokes existing ABI; no changes

NOT YET:
  - Persona re-classification (Slice 3)
  - Disposition audit (Slice 4 parallel-eligible — may start mid-Slice 2)
  - Disposition apply (Slice 5)
  - auto heuristic enabled in default flows (deferred until Slice 5 lands
    per-epic-override entries; until then, auto means "explicit override only")
  - README rewrite (Slice 6)

VERIFIED BY:
  - One real epic run on /workflows produces correct integration-branch state:
    one commit per story, integration branch advances fast-forward, no
    parallel-Codex race observed
  - Unit assertion: field_sources.execution_runtime.epic_override resolves
    correctly per precedence chain (env > root config > shipped baseline > skill
    override > default)
  - Unit assertion: execute-dispatch reads per-epic disposition from
    .pHive/cycle-state/<epic-id>.yaml BEFORE emitting mode_decision
  - shellcheck on any new shell-snippet contracts (Q2 (a) path)
  - episode marker exists at ${HIVE_STATE_DIR}/episodes/{epic}/{story}/
    cc-workflows-run.yaml after slice-test run
  - schema_version bump verified in hive.config.yaml + diff against shipped baseline
  - Manual: run an existing tiny epic end-to-end with HIVE_EXECUTION_RUNTIME=workflows
    and observe one commit per story landing on the integration branch

COMMIT REPRESENTS:
  "MVP first-party CC-workflows execution path — opt-in via execution.runtime
   override. mode_decision enum extended, execute-mode-cc-workflows skill added,
   serial-commit gate at integration-branch push layer."

RISK: MEDIUM — depends on Slice 1 verdicts; serial-commit gate is novel mechanism;
Q2 path branches on Phase 0 (a) outcome; precedence chain change must hold against
existing modes.
```

---

### Slice 3 — Persona surface re-classification

```
BUILDS ON: Slices 1 + 2 (need first-hand evidence)

WHAT WORKS AFTER THIS SLICE:
  persona-dispatchability-under-cc-workflows.md exists with verdicts per persona,
  sourced from first-hand evidence in Slices 1 + 2. Each persona classified as:
    - DISPATCHABLE: persona remains a standalone agent invoked by /workflows
    - COLLAPSED: persona's coordination work is fully expressed in workflow
      YAML/spec (ELIMINATION per feedback_no_team_lead_intermediary — NOT
      relocation; this is a load-bearing invariant)
    - REFRAMED: persona's role changes shape (e.g. pair-programmer may become
      a /workflows step pattern)
  The no-team-lead-intermediary posture is preserved — no team-lead-shaped
  surface gets reintroduced. If /workflows cannot fully express a persona's
  coordination work, the persona remains DISPATCHABLE.

LAYERS TOUCHED:
  Layer 4 (persona surface) — PRIMARY
    - .pHive/epics/cc-workflows-first-party/docs/persona-dispatchability-under-cc-workflows.md (NEW)
    - References (read-only) .pHive/epics/multica-substrate-deepen/docs/persona-dispatchability.md
      (the existing 22/3 cut)

NOT YET:
  - Disposition apply (Slice 5; though Slice 4 audit may run parallel)
  - README rewrite (Slice 6)

VERIFIED BY:
  - Doc review against the existing persona-dispatchability.md 22/3 cut
  - Maintainer review confirms no-team-lead-intermediary posture not regressed
    (no persona reclassified into a team-lead-shaped intermediary)
  - Per-persona verdict cites the Slice 1 or Slice 2 evidence used to justify
    (no verdicts sourced from speculation; if first-hand evidence not yet exists
    for a persona, mark UNVERIFIED + defer)
  - Cross-check verdicts against feedback_use_roster_agents — any persona reused
    in workflow YAML must reference the persona file, not improvise inline

COMMIT REPRESENTS:
  "Persona surface re-classified under /workflows-as-harness. 
   {N}/{25} dispatchable, {N}/{25} collapsed (elimination), {N}/{25} reframed."

RISK: LOW — read-only doc; posture-regression risk only if 22/3 cut wrong (and
that risk is mitigated by the no-team-lead-intermediary cross-check).
```

---

### Slice 4 — Disposition AUDIT (read-only)

```
BUILDS ON: Slice 1 gate (NOT BLOCKED on Slices 2 or 3; parallel-eligible to both)

WHAT WORKS AFTER THIS SLICE:
  Per-story candidate dispositions written for all 30 stories across both
  in-flight epics:
    - multica-substrate-deepen: 19 stories (w1-* through w4-* series)
    - multica-plan-test-cycles: 11 stories (mpt-1..mpt-11; all in PR #234)
  Each story carries a candidate verdict:
    - keep-as-second-party
    - park
    - supersede
  Reads git+disk (per feedback_story_status_stale — story YAML status: pending
  LIES for shipped work). NO file mutations to story YAMLs in this slice.

LAYERS TOUCHED:
  Layer 6 (in-flight epic disposition) — PRIMARY (audit half only)
    - .pHive/epics/cc-workflows-first-party/docs/disposition-pass-msd.md (NEW)
    - .pHive/epics/cc-workflows-first-party/docs/disposition-pass-mpt.md (NEW)

NOT YET:
  - Apply the dispositions (Slice 5)
  - Per-epic-override entries to cycle-state (Slice 5)
  - README rewrite (Slice 6)

VERIFIED BY:
  - disposition-pass-msd.md exists with per-story candidate (keep-as-second-party
    / park / supersede) for all 19 stories
  - disposition-pass-mpt.md exists with per-story candidate for all 11 stories
  - Spot-check against actual git state for 3 sample stories per epic: candidate
    verdict matches what git log + disk + PR refs show shipped vs not
  - W3.2 w3-2-autopilots-yaml verdict: park (architect Q5 descope; autopilot
    work not part of this epic)
  - Audit method explicitly notes the use of git+disk over YAML status (per
    feedback_story_status_stale)

COMMIT REPRESENTS:
  "Phase 5a audit — disposition candidates for multica-substrate-deepen (19) and
   multica-plan-test-cycles (11). Read-only; no story-YAML mutations."

PARALLEL-OK: zero coupling with Slices 2-3. Can run alongside.
RISK: LOW — read-only audit; risk is misclassifying a shipped story as pending
or vice versa (mitigated by trust-git+disk method).
```

---

### Slice 5 — Disposition APPLY

```
BUILDS ON: Slice 4 audit candidates + Q3 resolution (maintainer-confirmed at
gate 1: keep-as-second-party for first release) + Slice 2 (per-epic-override
mechanism in execute-dispatch resolver must exist before this slice writes
override entries)

WHAT WORKS AFTER THIS SLICE:
  Story YAML mutations applied per Slice 4 audit verdicts. Project memory
  entries updated for project_multica_substrate_adoption +
  project_multica_plan_test_cycles. For epics whose /plan + /test
  --simulated-manual routes remain on Multica (keep-as-second-party verdict),
  per-epic-override entries written to .pHive/cycle-state/<epic-id>.yaml
  execution_runtime block; these are read by Slice 2's execute-dispatch
  resolver, ensuring auto heuristic routes them to Multica.
  
  All disposition commits bundled into THIS epic's PR (single audit trail per
  TPM); <150 file cap per feedback_pr_file_count_limit honored; stack via
  base-branch retargeting if scope bloats.

LAYERS TOUCHED:
  Layer 2 (config schema) — per-epic-override write
    - .pHive/cycle-state/multica-substrate-deepen.yaml: execution_runtime block
      with adapter selection per audit (likely multica for stories shipped on
      Multica + remaining-pending)
    - .pHive/cycle-state/multica-plan-test-cycles.yaml: execution_runtime block
      keep-as-second-party (Q3 maintainer-confirmed)
  Layer 6 (in-flight epic disposition) — PRIMARY (apply half)
    - ~30 story YAML mutations across both epics:
        • disposition: <verdict>
        • disposition_rationale: <brief>
        • disposition_source_slice: cc-workflows-first-party/slice-4
    - W3.2 w3-2-autopilots-yaml: park (Q5 descope)
    - project memory updates (~/.claude/projects/-Users-don-Documents-plugin-hive/
      memory/) — note status changes inline (NOT bulk-overwriting project memos)

NOT YET:
  - README rewrite (Slice 6)

VERIFIED BY:
  - Each story YAML mutation matches Slice 4 audit candidate (no drift between
    audit and apply)
  - cycle-state for both target epics reflects new disposition with the
    execution_runtime block fields
  - Precedence-chain unit assertion: execute-dispatch resolver routing a
    keep-as-second-party epic with execution.runtime: auto produces
    mode_decision: multica with field_sources.execution_runtime.epic_override
    set to the cycle-state file path
  - PR file count check: this slice's commits + Slice 2's commits keep epic PR
    under 150 files (stack via base-branch retargeting if not)
  - Audit-trail check: every disposition mutation is committed with a message
    referencing Slice 4's candidate + Slice 5's apply rationale

COMMIT REPRESENTS:
  "Phase 5b apply — disposition mutations for multica-substrate-deepen (19) and
   multica-plan-test-cycles (11) per Slice 4 audit. cycle-state per-epic-override
   entries written. W3.2 parked (Q5 descope)."

RISK: MEDIUM — writes to two sibling epics' story YAMLs; PR <150 cap risk;
conflict-with-auto precedence rule must hold (mitigated by Slice 2's unit
assertion + the per-epic-override mechanism existing first).
```

---

### Slice 6 — README + CONTEXT.md positioning

```
BUILDS ON: Slices 1-5 (Layers 1-3 must be SHIPPED so README language reflects
shipped behavior, not aspiration — defended in design-discussion §10 against
grill C3)

WHAT WORKS AFTER THIS SLICE:
  README.md hero + Quick Start step 1 rewritten:
    - New positioning: "First-party CC workflows for in-session execution;
      second-party Multica for codex co-mingling, headless webhooks, durable
      queue."
    - Quick Start step 1 no longer leads with /hive:multica-init as "Bootstrap
      Multica as the execution substrate"; instead a CC-workflows-first
      onboarding step (Multica step still present, demoted).
  CONTEXT.md updated:
    - "Composability" posture statement reflects Q9 (i) maintainer-confirmed
      reframe: "Hive composes ON Claude Code" — Hive is the composition layer
      on top of first-party CC workflows; CC IS the substrate; Hive composes
      on top.
    - Vocab section disambiguates hive-workflow (YAML at hive/workflows/*.workflow.yaml)
      vs CC /workflows (CC native slash command, 2.1.154 GA). Resolves grill V1.

LAYERS TOUCHED:
  Layer 8 (README + posture) — PRIMARY
    - README.md (hero + Quick Start rewrite; new positioning paragraph)
    - CONTEXT.md (Composability posture statement + vocab disambiguation)

NOT YET:
  Nothing — this is the last slice.

VERIFIED BY:
  - Manual review by maintainer: README positioning matches Q9 (i) reframe
  - Doc-test: any code samples in README (commands, paths) still resolve in
    current worktree state
  - Vocab terms grep: CONTEXT.md's hive-workflow vs CC /workflows distinction
    has no contradictory usage in subsequent skill/agent files touched by this
    epic
  - Vocab terms grep on existing skill/agent files NOT touched by this epic:
    flag any drift but DO NOT fix in this epic (scope creep)
  - Quick Start rewrite: a fresh consumer reading the rewritten README can
    successfully bootstrap CC-workflows-first execution per the new step 1

COMMIT REPRESENTS:
  "README + CONTEXT.md repositioned for first-party CC workflows. Q9 (i) reframe
   durable; vocab disambiguation (V1) added."

RISK: LOW — positioning edits; reversible. Risk is missing a contradictory
vocab usage in untouched files (mitigated by accepting that as out-of-scope
flag-don't-fix).
```

---

## 3. Overlay Diagram

```
VERTICAL SLICE OVERLAY — cc-workflows-first-party
────────────────────────────────────────────────────────────────────────────────────────────────
                  │ Slice 1     │ Slice 2     │ Slice 3   │ Slice 4    │ Slice 5     │ Slice 6 │
                  │ (Spike)     │ (MVP path)  │ (Persona) │ (Audit)    │ (Apply)     │ (README)│
                  │             │             │           │ PARALLEL   │             │         │
                  │             │             │           │ to 2-3     │             │         │
──────────────────┼─────────────┼─────────────┼───────────┼────────────┼─────────────┼─────────┤
L9 Phase 0 spike  │ ★ spike-    │             │           │            │             │         │
                  │ findings.md │             │           │            │             │         │
──────────────────┼─────────────┼─────────────┼───────────┼────────────┼─────────────┼─────────┤
L1 Executor seam  │ ephemeral   │ ★ step 6f + │           │            │             │         │
                  │ scaffolding │ dispatch +  │           │            │             │         │
                  │             │ new skill   │           │            │             │         │
──────────────────┼─────────────┼─────────────┼───────────┼────────────┼─────────────┼─────────┤
L2 Config schema  │             │ ★ exec.run- │           │            │ per-epic-   │         │
                  │             │ time +      │           │            │ override    │         │
                  │             │ field_src + │           │            │ entries     │         │
                  │             │ epic_overr. │           │            │ written     │         │
──────────────────┼─────────────┼─────────────┼───────────┼────────────┼─────────────┼─────────┤
L3 Integ. branch  │ ephemeral   │ ★ serial-   │           │            │             │         │
                  │ test of (a) │ commit gate │           │            │             │         │
                  │             │ + Q2 path   │           │            │             │         │
──────────────────┼─────────────┼─────────────┼───────────┼────────────┼─────────────┼─────────┤
L4 Persona        │             │             │ ★ persona-│            │             │         │
                  │             │             │ disp-     │            │             │         │
                  │             │             │ under-cc- │            │             │         │
                  │             │             │ workflows │            │             │         │
──────────────────┼─────────────┼─────────────┼───────────┼────────────┼─────────────┼─────────┤
L5 Skill distrib  │ (d) verdict │ Plan B      │           │            │             │         │
                  │             │ branch      │           │            │             │         │
                  │             │ selected    │           │            │             │         │
──────────────────┼─────────────┼─────────────┼───────────┼────────────┼─────────────┼─────────┤
L6 Disposition    │             │             │           │ ★ audit    │ ★ apply +   │         │
                  │             │             │           │ msd + mpt  │ memos +     │         │
                  │             │             │           │            │ YAMLs       │         │
──────────────────┼─────────────┼─────────────┼───────────┼────────────┼─────────────┼─────────┤
L7 Task-tracking  │             │ ★ reuse     │           │            │             │         │
                  │             │ ABI         │           │            │             │         │
                  │             │ unchanged   │           │            │             │         │
──────────────────┼─────────────┼─────────────┼───────────┼────────────┼─────────────┼─────────┤
L8 README +       │             │             │           │            │             │ ★ README│
   CONTEXT.md     │             │             │           │            │             │ + ctx + │
                  │             │             │           │            │             │ vocab   │
────────────────────────────────────────────────────────────────────────────────────────────────

★ = primary work in that slice for that layer
ephemeral = used during slice but no production code lands until later slice
PARALLEL = Slice 4 has zero coupling with Slices 2-3; can run alongside them
            once Slice 1 gate clears

Each column = commit-worthy, working state. Per-slice "WHAT WORKS AFTER" invariant.
```

---

## 4. Deferred Items

```
DEFERRED (intentionally NOT in any slice):

- Phase 4 autopilot split (time-based → CC native; webhook-driven → Multica)
  DESCOPED at maintainer gate 1 (Q5; architect-v2 ruling).
  Rationale: autopilot ownership questions are orthogonal to the substrate-rebase
  decision; Q5 decoupling lets this epic ship without expanding scope.
  W3.2 w3-2-autopilots-yaml: PARK under multica-substrate-deepen via Slice 5
  apply. No adapter implication.

- Cost / latency benchmarks beyond Phase 0 snapshot.
  POST-MVP. Cycle-state carries performance:audit minor escalation
  (raised by architect, first-release retrospective scope).

- Multica server-side label-return defect (GET /api/skills omits content_hash
  + visibility).
  OUT OF SCOPE for this epic. Tracked under multica-substrate-deepen W4.x
  (second-party concern; first-party path doesn't depend on label-return).

- W4.4 CI drift guard migration to first-party.
  NOT MIGRATED. Remains second-party-only either way (skill-distribution
  primary path or Plan B). The drift-guard logic is bundled-skill-specific
  and irrelevant once auto-load is in play.

- Multica webhook-autopilot E2E pilot (grill H2).
  OUT OF SCOPE for this epic (followed Q5 descope; see design-discussion §10
  H2 deviation). Whichever future epic owns autopilot work picks this up.

- Full feature parity with Multica adapter on first-party path.
  POST-MVP per Q6 maintainer-confirmed (minimum viable parity for first
  release).

- Pivot to rescope-memo Option C (Multica-as-queue, /workflows as constrained
  executor).
  CONTINGENT — only activates if Slice 1 reveals integration-branch coercion
  too costly (Q7 maintainer-confirmed: A for first release, C as fallback).

RATIONALE for deferrals:
  Per memory feedback_scope_class_changes, substrate-level changes deserve
  full-planning but NOT scope-creep into adjacent concerns. The autopilot,
  benchmarking, defect-fix, and feature-parity items are all real concerns
  but ARE NOT load-bearing for "first-party CC workflows ships and works".
  Slice scope discipline (per slice = thinnest commit-worthy state) excludes
  them from this epic; whichever future epic owns each picks it up cleanly.
```

---

## 5. Risk by Slice

```
RISK PER SLICE:

Slice 1 — HIGH
  Load-bearing unknowns (research brief §risk-1 HIGH + §risk-2 HIGH both gated
  here). Pass-bar criteria (a)-(d) must each get explicit PASS / FAIL verdict
  with first-hand evidence. If any criterion fails:
    - (a) FAIL → Slice 2 Q2 path branches to Plan B (b/c)
    - (b) FAIL → potentially blocks epic; pivot to rescope-memo Option C
    - (c) FAIL → adapter completion-signal wiring becomes Slice 2 risk
    - (d) FAIL → Slice 2 includes Mode D-a on first-party path (collapses
      simplification narrative)
  Maintainer-gated at end.

Slice 2 — MEDIUM
  Depends on Slice 1 verdicts (Q2 path + Plan B branch resolved at entry).
  Serial-commit gate is a NOVEL MECHANISM — first time the adapter owns the
  commit step rather than the agent. Risks:
    - Precedence-chain change must hold against existing modes (env > config >
      shipped baseline > skill override > default) — regression risk on other
      modes
    - field_sources.execution_runtime.epic_override path must resolve correctly
      from .pHive/cycle-state/<epic-id>.yaml — if the file doesn't exist yet
      (Slice 5 writes it), the resolver must gracefully fall through to auto
    - schema_version bump must not break existing skill consumers
  Mitigated by unit assertions + the precedence-chain test.

Slice 3 — LOW
  Read-only doc. Posture-regression risk if 22/3 cut wrong (mitigated by
  no-team-lead-intermediary cross-check). UNVERIFIED-defer policy for any
  persona without first-hand evidence prevents speculation.

Slice 4 — LOW
  Read-only audit. Risk is misclassifying a shipped story as pending or vice
  versa (mitigated by trust-git+disk method per feedback_story_status_stale).
  Spot-check of 3 sample stories per epic catches systemic misreads.

Slice 5 — MEDIUM
  Writes to two sibling epics' story YAMLs (~30 mutations). Risks:
    - PR file count <150 cap risk per feedback_pr_file_count_limit — disposition
      commits + Slice 2 commits combined may push the cap; stack via
      base-branch retargeting if so
    - conflict-with-auto precedence rule must hold (mitigated by Slice 2 unit
      assertion + per-epic-override mechanism existing first)
    - Drift between Slice 4 audit candidate and Slice 5 apply verdict — catch
      via 1:1 match check

Slice 6 — LOW
  Positioning edits; reversible. Risk is missing contradictory vocab usage in
  untouched files (mitigated by accepting as out-of-scope flag-don't-fix).
```

---

## 6. Moldability Notes

```
WHAT CAN CHANGE WITHOUT INVALIDATING THE PLAN:

REORDERING:
  - Slice 4 (disposition AUDIT) can start as soon as Slice 1's maintainer gate
    clears. Runs parallel to Slices 2-3 with zero coupling. If parallelism
    isn't viable (single-maintainer pipeline), Slice 4 can sequence after
    Slice 3 with no plan damage.
  - Slices 2 and 3 cannot be reordered: Slice 3 verdicts need first-hand
    evidence from Slice 2's MVP path running real personas. Reordering them
    would force Slice 3 to speculate.
  - Slice 5 cannot precede Slice 4 (apply requires audit candidates) or Slice 2
    (per-epic-override mechanism in resolver must exist before override entries
    written).
  - Slice 6 cannot precede Slices 1-5 (defended in design-discussion §10 vs
    grill C3 — README is output, not anchor).

DROPPABLE IF SCOPE SHRINKS:
  - Slice 6 (README + CONTEXT.md) could defer to a follow-on micro-epic if
    epic PR file cap is breached and stack-retargeting unavailable. Doc-only,
    reversible, low-risk to defer.
  - Slice 3 (persona re-classification) is doc-only; could defer if Slice 1's
    spike reveals that /workflows doesn't change persona surface materially.
    However, this is the slice that resolves grill P1 (no-team-lead-intermediary
    invariant) — if dropped, P1 risk re-opens and must be addressed elsewhere.
  - Slice 4 + Slice 5 (audit + apply) could collapse into one slice if 30
    stories audited quickly + maintainer happy to review audit+apply together.
    Risks losing the audit-only safety net for slow review.

UNEXPECTED-DISCOVERY ADAPTATIONS:
  - Slice 1 fails criterion (a) /workflows rejects free-form prompt injection:
    Slice 2 Q2 path branches to (b) per-unit PR (bend convention) or (c)
    CC-native worktree-per-story isolation. Plan adapts at Slice 2 entry;
    Slices 3-6 unchanged in structure.
  - Slice 1 fails criterion (d) plugin-shipped skills don't auto-load under
    CLI-interactive 2.1.157: Slice 2 includes Mode D-a on first-party path
    (Plan B). Adds ~5-10 file touches to Slice 2; doesn't change other slices.
  - Slice 1 fails criterion (b) Codex-creator-returns-file-list-and-adapter-
    commits-serially: harder failure — may force pivot to rescope-memo Option C
    (Multica-as-queue, /workflows as constrained executor). Slices 2-5
    reshape; Slice 6 absorbs the language change.
  - Slice 3 reveals orchestrator OR team-lead collapses into workflow-definition
    syntax (elimination per feedback_no_team_lead_intermediary): Slice 5's
    disposition for any story whose orchestrator step is load-bearing may need
    a different disposition class (e.g. supersede instead of keep-as-second-party).
    Slice 5 adapts based on Slice 3 evidence.
  - Q4 default flips during build (e.g. maintainer picks workflows or multica
    instead of auto): Slice 2's hive/hive.config.yaml shipped baseline absorbs
    the change; Slice 6's README language absorbs the change. Plan structure
    unchanged.

CROSS-EPIC RIPPLES:
  - If Slice 5's disposition for multica-plan-test-cycles concludes supersede
    (not keep-as-second-party as Q3 currently confirmed), the per-epic-override
    entry for mpt is omitted and auto routes /plan + /test --simulated-manual
    to /workflows. This would require revisiting Q3 with the maintainer mid-
    epic — flag-don't-act.
  - If multica-substrate-deepen ships further stories on its own branch during
    this epic's build (drift), Slice 4 audit must re-run for those new
    stories. Add a "drift check" precondition to Slice 5 entry.
```

---

_End of vertical plan. Phase B2 step 7 collaborative review on H/V plans next, then USER GATE 2._
