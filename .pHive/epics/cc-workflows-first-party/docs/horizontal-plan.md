# Horizontal Plan — cc-workflows-first-party

**Epic id:** `cc-workflows-first-party`
**Base branch:** `develop`
**Branch strategy:** per-epic (`feat/cc-workflows-first-party`)
**Author:** technical-writer (Phase B2 step 6, 2026-05-31)
**Status:** authored from design-discussion v2 + research brief + grill record + cycle-state (Q1-Q9 + escalations)

This is the **breadth-first map** — what each architectural layer needs OVERALL. The vertical plan (sibling doc) overlays slice boundaries. No execution order here.

---

## 1. Layer Inventory

The epic touches **nine architectural layers**. Three are config / schema layers, two are doc / posture layers, two are skill / lib layers, one is a read-only ABI re-use, and one is a one-shot spike artifact.

1. **Executor seam** — `/execute` mode selection + new atomic execute-mode skill. Currently five mode branches (`6a`-`6e`) in `skills/execute/SKILL.md` step 6; this epic adds `6f` cc-workflows. The `mode_decision` enum in `skills/hive/skills/execute-dispatch/SKILL.md` is the single extension point.
2. **Config schema** — `execution.runtime` knob in `hive.config.yaml` (root maintainer override) + `hive/hive.config.yaml` (shipped baseline). New precedence chain (architect Q2) + per-epic-disposition-override rule (TPM + architect U3).
3. **Integration-branch contract** — serial-commit gate at the integration-branch push layer (architect Q3+Q4 unified mechanism). Adapter owns the commit step; agents return file lists; harness serializes the merge.
4. **Persona surface** — re-classification of the existing 22/3 dispatchability cut under `/workflows`-as-harness.
5. **Skill distribution** — first-party prefers CC 2.1.157 `.claude/skills/` auto-load; Plan B retains Mode D-a if auto-load fails for plugin-shipped under CLI-interactive.
6. **In-flight epic disposition** — `multica-substrate-deepen` (19 stories) + `multica-plan-test-cycles` (11 stories) classified keep-as-second-party / park / supersede.
7. **Vendor-neutral story dispatch** — `hive/lib/task-tracking-dispatch/index.ts` ABI. **READ-ONLY; re-use unchanged.** No fork.
8. **README / positioning / CONTEXT.md posture** — `README.md:1-20` hero + Quick Start step 1; CONTEXT.md "Composability" posture statement (Q9 maintainer-confirmed (i) "Hive composes ON Claude Code"); vocab disambiguation hive-workflow vs CC-`/workflows` (V1).
9. **Phase 0 spike artifact** — `spike-findings.md` carrying explicit pass/fail verdicts for criteria (a)-(d). One-shot deliverable, gates everything downstream.

---

## 2. Per-Layer Requirements

### Layer 1 — Executor seam

```
FILES MODIFIED:
  - skills/execute/SKILL.md
      • Process step 6: add 6f cc-workflows branch
      • Mirror the contract of 6e multica (mode_decision == 'cc-workflows' → invoke execute-mode-cc-workflows)
  - skills/hive/skills/execute-dispatch/SKILL.md
      • Extend mode_decision enum: + 'cc-workflows'
      • Add field_sources.execution_mode: env > root config > shipped baseline > skill override > default
      • Add field_sources.execution_runtime: same precedence chain
      • Add field_sources.execution_runtime.epic_override: <path> — records which per-epic disposition file
        overrode the auto heuristic (architect Q2 tightening)
      • Add resolver logic: execute-dispatch reads per-epic disposition BEFORE emitting mode_decision

FILES NEW:
  - skills/hive/skills/execute-mode-cc-workflows/SKILL.md
      • Step 0: precondition gate — verifies CC 2.1.154+ runtime + execution.runtime resolves to cc-workflows
        (or env override CC_WORKFLOWS=1)
      • Step 1: workflow_assembly substep — prompt construction, persona-to-step mapping,
        /workflows invocation, completion-signal wiring (outer seam invariant; internal logic gated
        by Phase 0 (a) verdict)
      • Step 2: dispatch — invokes /workflows via CC native primitives
      • Step 3: serial-commit gate — agents return file lists; harness commits per-story to integration
        branch (see Layer 3)
      • Step 4: episode marker write — ${HIVE_STATE_DIR}/episodes/{epic}/{story}/cc-workflows-run.yaml
      • Step 5: summary return — surfaces completion, scope-drift signal, episode path
      • Replaces respawn skill for its stories (per session-mode pattern in execute-mode-session)
      • Honors single-isolation-layer rule (no recursive /workflows spawn)
```

### Layer 2 — Config schema

```
FILES MODIFIED:
  - hive.config.yaml (root, maintainer override)
      • execution.runtime: workflows | multica | auto    (NEW)
        - workflows: always route through execute-mode-cc-workflows
        - multica: always route through execute-mode-multica
        - auto: heuristic — prefer workflows when CC 2.1.154+ detected + no second-party trigger
          (codex on dispatched persona, webhook autopilot context, durable queue requirement)
          UNLESS a per-epic disposition overrides
      • execution.runtime defaults to "auto" for first release (Q4 maintainer-confirmed)
  - hive/hive.config.yaml (shipped baseline, fall-through default)
      • execution.runtime: auto    (shipped default; consumer overrides via root config)

PRECEDENCE CHAIN (architect Q2):
  env (HIVE_EXECUTION_RUNTIME) > root config > shipped baseline > skill override > default

PER-EPIC OVERRIDE RULE (TPM + architect U3):
  - Codified as: per-epic disposition trumps the auto heuristic
  - Enforcement: execute-dispatch's resolver loads .pHive/cycle-state/<epic-id>.yaml execution_runtime block
    (if present) BEFORE emitting mode_decision
  - field_sources.execution_runtime.epic_override: <path> records the disposition file used
  - 'workflows' and 'multica' explicit values are NOT overridden by per-epic disposition; only 'auto' is

SCHEMA VERSION:
  - Bump hive.config.yaml schema_version (cross-cutting versioning concern)
  - field_sources schema doc updated
```

### Layer 3 — Integration-branch contract

```
MECHANISM (architect Q3+Q4 unified — load-bearing):
  - Serial-commit gate at integration-branch push layer
  - /workflows agents return file lists; harness commits per-story to integration branch
  - Single committer: the adapter (execute-mode-cc-workflows Step 3), not /workflows itself
  - Preserves feedback_codex_sandbox_commit_block (Codex agents make no .git writes)
  - Preserves feedback_codex_parallel_race (serialization eliminates race surface)
  - Fast-forward enforced; rebase-and-push 3-retry (mirrors multica-story-dispatch/index.mjs:192-262)

Q2 RESOLUTION (maintainer-confirmed (a) conditional):
  - IF Phase 0 (a) passes (/workflows honors free-form prompt injection):
      execute-mode-cc-workflows Step 1 injects shell-snippet contract into agent prompts
      (mirrors serializeStoryBrief integrationBranch section in multica-story-dispatch:192-262)
  - IF Phase 0 (a) fails:
      Plan B options for maintainer call (Q2 surfaces):
        (b) bend git_flow.branch_strategy: per-epic to per-unit PR
        (c) restructure as CC-native worktree primitives that preserve single-branch /
            single-commit-per-story discipline (worktree-per-story isolation + serialized merge)

COMMIT FORMAT (preserved from existing convention):
  [{story-id}] <type>(<scope>): <description>

NEW SHELL-SNIPPET CONTRACT (if Q2 (a) path):
  - fetch + checkout + reset integration branch
  - apply file list from /workflows agent
  - commit with story-id format
  - rebase-and-push with 3-retry

REUSE:
  - Mirror multica-story-dispatch:192-262 logic; do NOT fork. Either:
    - factor common serialization into a shared helper, OR
    - copy with attribution to multica-story-dispatch as source-of-truth
  - Decision deferred to Slice 2 implementation; both honor "single committer" invariant
```

### Layer 4 — Persona surface

```
INPUT:
  - .pHive/epics/multica-substrate-deepen/docs/persona-dispatchability.md
    • 22 dispatchable / 3 harness-only (orchestrator, team-lead, pair-programmer)
    • Harness-only cited Multica-specific lack of TeamCreate + SendMessage

OUTPUT:
  - .pHive/epics/cc-workflows-first-party/docs/persona-dispatchability-under-cc-workflows.md
    • Per-persona verdict under /workflows-as-harness:
        - DISPATCHABLE: persona remains a standalone agent invoked by /workflows
        - COLLAPSED: persona's coordination work is fully expressed in workflow YAML/spec
          (ELIMINATION per feedback_no_team_lead_intermediary — not relocation)
        - REFRAMED: persona's role changes shape; e.g. pair-programmer may become
          a /workflows step pattern rather than a standalone agent
    • Source first-hand evidence from Phase 0 spike (Slice 1) + MVP path (Slice 2)
    • If /workflows cannot fully express a persona's coordination work, persona remains
      DISPATCHABLE; no team-lead-shaped surface gets reintroduced

POSTURE INVARIANTS:
  - feedback_no_team_lead_intermediary: team-lead has no Agent-spawn tools; persona either
    eliminates entirely under /workflows OR remains dispatchable; no third option
  - feedback_use_roster_agents: orchestrator must use existing persona files; new
    workflow YAML must reference persona files, not improvise inline personas
```

### Layer 5 — Skill distribution

```
PRIMARY PATH (Phase 0 (d) PASS):
  - CC 2.1.157 auto-loads .claude/skills/ for plugin-hive (marketplace-installed) under
    CLI-interactive — verified in Phase 0
  - No Mode D-a substrate bundling needed on first-party path
  - Plugin ships skills/ tree as-is; CC discovers them

PLAN B (Phase 0 (d) FAIL):
  - First-party path also uses Mode D-a (collapses "no skill export needed" simplification)
  - Bundling logic in hive/lib/multica-bootstrap/ reconcileSkills remains shared
  - README rewrite (Layer 8) carries the caveat: skills require Mode D-a even on first-party
  - .pHive/multica/skills-export.yaml continues to drive bundling
  - Alternative: consumer-side mirror to .claude/skills/ (documented workaround)

W4.4 CI DRIFT GUARD:
  - Remains second-party-only either way
  - Not migrated to first-party path (deferred — see vertical-plan §4)
```

### Layer 6 — In-flight epic disposition

```
SOURCES:
  - .pHive/epics/multica-substrate-deepen/ (19 stories)
    • w1-1..w4-5 series across 4 waves
    • Shipped commits across PR #230, PR #231 + later
    • Story YAML status fields STALE per feedback_story_status_stale
  - .pHive/epics/multica-plan-test-cycles/ (11 stories: mpt-1..mpt-11)
    • All shipped via PR #234 (merged 2026-05-28)
    • Story YAML status: pending — STALE per feedback_story_status_stale
    • Particularly thorny: routes /plan + /test --simulated-manual through Multica

CLASSIFICATION (per story, both epics):
  - keep-as-second-party: story remains valid under second-party Multica; no demotion impact
  - park: story is not yet shipped + no longer load-bearing; pause without supersede
  - supersede: story is functionally replaced by first-party CC workflows path

AUDIT METHOD (Phase 5a → Slice 4):
  - Read git+disk (per feedback_story_status_stale; YAML status lies for shipped work)
  - Cross-check against PR refs (PR #230, PR #231, PR #234, plus any post-#234 merges)
  - NO mutations to story YAMLs in audit phase
  - Output:
    - .pHive/epics/cc-workflows-first-party/docs/disposition-pass-msd.md
    - .pHive/epics/cc-workflows-first-party/docs/disposition-pass-mpt.md

APPLY METHOD (Phase 5b → Slice 5; sequenced AFTER Q3 resolution):
  - Mutate story YAMLs: add disposition: <verdict> field + disposition_rationale
  - Update project memory entries for project_multica_substrate_adoption +
    project_multica_plan_test_cycles
  - For epics that remain on Multica (keep-as-second-party): write per-epic-override entry
    to .pHive/cycle-state/<epic-id>.yaml execution_runtime block so auto heuristic
    routes them to Multica
  - Commits bundled into THIS epic's PR (single audit trail) per feedback_pr_file_count_limit
    <150 cap; stack via base-branch retargeting if scope bloats

W3.2 SPECIAL CASE:
  - w3-2-autopilots-yaml in multica-substrate-deepen: park
  - Architect-v2 Q5 descope: autopilot work not part of this epic
```

### Layer 7 — Vendor-neutral story dispatch (READ-ONLY)

```
FILE: hive/lib/task-tracking-dispatch/index.ts (1-100)
ABI: dispatch(req: {method, params}) → result | throw AdapterError
ADAPTERS: github | linear | multica + custom paths
NO FORK. NO MODIFICATIONS THIS EPIC.

ROLE:
  - Already vendor-neutral; used by /plan Phase D + /execute status updates
  - CC-workflows runtime inherits this surface unchanged
  - execute-mode-cc-workflows Step 5 (summary return) calls dispatch for status updates
    via the same ABI as execute-mode-multica
```

### Layer 8 — README / positioning / CONTEXT.md posture

```
FILES MODIFIED:
  - README.md
      • Hero (line 1-20): rewrite per Q9 maintainer-confirmed posture (i)
        "Hive composes ON Claude Code" — Hive is the composition layer on first-party CC workflows
      • Quick Start step 1: NO LONGER /hive:multica-init as "Bootstrap Multica as the execution
        substrate"; instead a CC-workflows-first onboarding step
      • New positioning paragraph: "First-party CC workflows for in-session execution;
        second-party Multica for codex co-mingling, headless webhooks, durable queue"
      • Multica references preserved but demoted from default to opt-in path
  - CONTEXT.md
      • "Composability" posture statement updated to reflect Q9 (i) — Hive composes ON CC,
        not parallel-to CC; durable placement so downstream skills/agents reference consistent posture
      • Vocab section (or new subsection) disambiguates:
        - hive-workflow — YAML at hive/workflows/*.workflow.yaml (existing primitive)
        - CC /workflows — CC native slash command (2.1.154 GA)
      • Resolves grill V1 (vocabulary overload)
      • Resolves grill P2 (composability posture mismatch)
```

### Layer 9 — Phase 0 spike artifact

```
FILE NEW:
  - .pHive/epics/cc-workflows-first-party/docs/spike-findings.md
    Sections (mandatory):
      • Spike setup — which existing or synthetic epic was run; persona team composition;
        Codex-routed creator details
      • Criterion (a): integration-branch contract — PASS / FAIL + evidence
        • Did /workflows accept free-form prompt injection?
        • Did shell-snippet contract survive into agent context?
        • Did the integration branch advance with single commit per story?
      • Criterion (b): heterogeneous-provider co-mingling — PASS / FAIL + evidence
        • Codex creator returned file list (no .git writes)?
        • Adapter committed serially against integration branch?
        • Any parallel-Codex race detected?
      • Criterion (c): completion signal + failure modes — PASS / FAIL + evidence
        • Did /workflows surface a clean completion event?
        • Are partial failures recoverable (resume vs restart)?
      • Criterion (d): plugin-shipped .claude/skills/ auto-load under CLI-interactive 2.1.157
        — PASS / FAIL + evidence
        • Did plugin-hive skills auto-load in a fresh CC session?
        • Documented workaround if FAIL
      • Verdict block: gates ALL downstream slices
      • Recommendations: which Plan B paths activate for failed criteria

GATE:
  - Maintainer reads and signs at end of Slice 1
  - Slices 2-6 carry blockedBy: <slice-1 stories>
```

---

## 3. Cross-Layer Dependencies

```
DEPENDENCIES:

Layer 1 (executor seam: execute-dispatch resolver) READS Layer 2 (execution.runtime
  precedence chain + per-epic-override rule from .pHive/cycle-state/<epic-id>.yaml)
  → Layer 1 must complete Layer 2's resolver in the same slice as the schema knob ships
    (Slice 2 collapses both)

Layer 1 (execute-mode-cc-workflows skill) EMITS Layer 3 (serial-commit gate mechanism)
  → Layer 3 logic lives inside Layer 1's Step 3; cannot ship Layer 3 without Layer 1's
    adapter skill existing

Layer 3 (Q2 (a) shell-snippet injection vs Plan B fallback) DEPENDS ON Layer 9 (Phase 0
  spike criterion (a) verdict)
  → Layer 3's implementation branch chosen at Slice 2 entry; gated on Slice 1 verdict

Layer 4 (persona re-classification verdicts) DEPENDS ON Layer 9 (Phase 0 spike) + Layer 1
  (MVP path producing first-hand evidence)
  → Layer 4 cannot ship in Slice 1; needs Slice 2 evidence for persona-by-persona verdicts;
    lands in Slice 3

Layer 5 (skill distribution Plan B branch) DEPENDS ON Layer 9 (Phase 0 spike criterion (d)
  verdict)
  → Layer 5's path chosen at Slice 2 entry; gated on Slice 1 verdict

Layer 6 (disposition audit then apply) IS INTERNALLY SEQUENCED:
  - 6-audit (read-only) can run parallel to Layers 1-4 (Slice 4 parallel-eligible to 2-3)
  - 6-apply (write) sequenced AFTER Q3 resolution + must not silently route around Layer 2's
    per-epic-override rule
  → Slice 5 (apply) blockedBy Slice 4 (audit) + Q3 user-confirmed at gate 1 (already done)

Layer 6 (apply) WRITES Layer 2 (per-epic-override entries to cycle-state) for any epic
  whose /plan + /test --simulated-manual routes remain on Multica
  → Slice 5 touches Layer 2 to register the override path; resolver in Layer 1 honors it

Layer 7 (task-tracking-dispatch ABI) READ-ONLY — no dependencies in either direction
  → Reused as-is by Layer 1 Step 5; no slice work required

Layer 8 (README + CONTEXT.md) DEPENDS ON Layers 1-3 SHIPPING + Q9 maintainer-confirmed
  posture (i) (already done at gate 1)
  → Lands in Slice 6; later than Layers 4-5-6 so language reflects shipped behavior, not
    aspiration (defended in design-discussion §10 against grill C3)

Layer 9 (Phase 0 spike artifact) IS THE GATE
  → No downstream slice begins production work until Layer 9 has explicit verdicts
  → Slice 1 produces Layer 9 entirely; Slices 2-6 carry blockedBy: <slice-1 stories>
```

---

## 4. Layer Map Diagram

```
HORIZONTAL LAYER MAP — cc-workflows-first-party
────────────────────────────────────────────────────────────────────────────────────

L9 Phase 0  │ spike-findings.md (PASS/FAIL per criterion a,b,c,d)                  │
   spike    │ MAINTAINER GATE — blocks all downstream                              │
────────────┼──────────────────────────────────────────────────────────────────────┤
L1 Exec     │ skills/execute   │ execute-dispatch  │ execute-mode-cc-workflows     │
   seam     │ step 6f branch   │ mode_decision +   │ NEW atomic skill: workflow_   │
            │                  │ field_sources +   │ assembly + serial-commit gate │
            │                  │ epic_override     │ + episode marker              │
────────────┼──────────────────┼───────────────────┼───────────────────────────────┤
L2 Config   │ hive.config.yaml │ shipped baseline  │ precedence chain + per-epic   │
   schema   │ execution.runtime│ default: auto     │ override rule                 │
            │ + version bump   │                   │                               │
────────────┼──────────────────┼───────────────────┼───────────────────────────────┤
L3 Integ.   │ serial-commit    │ Q2 (a) shell-     │ Plan B: per-unit PR /         │
   branch   │ gate (adapter    │ snippet injection │ worktree-per-story            │
            │ commits)         │ (Phase 0(a) PASS) │ (Phase 0(a) FAIL)             │
────────────┼──────────────────┼───────────────────┼───────────────────────────────┤
L4 Persona  │ persona-disp-    │ collapse =        │ first-hand evidence from      │
   surface  │ under-cc-        │ ELIMINATION       │ Slices 1-2                    │
            │ workflows.md     │ (not relocation)  │                               │
────────────┼──────────────────┼───────────────────┼───────────────────────────────┤
L5 Skill    │ CC 2.1.157       │ Plan B: Mode D-a  │ W4.4 CI drift guard           │
   distrib  │ auto-load (d)    │ on first-party    │ second-party-only             │
            │ PASS             │ (d) FAIL          │                               │
────────────┼──────────────────┼───────────────────┼───────────────────────────────┤
L6 Dispo-   │ disposition-     │ disposition-     │ apply: YAML mutations + per-   │
   sition   │ pass-msd.md      │ pass-mpt.md      │ epic-override entries to       │
            │ (19 stories)     │ (11 stories)     │ cycle-state                    │
────────────┼──────────────────┼───────────────────┼───────────────────────────────┤
L7 Story    │ task-tracking-   │ READ-ONLY        │ NO FORK                        │
   dispatch │ dispatch ABI     │                  │                                │
────────────┼──────────────────┼───────────────────┼───────────────────────────────┤
L8 README + │ README.md hero + │ CONTEXT.md       │ vocab disambiguation:          │
   posture  │ Quick Start      │ Composability    │ hive-workflow vs               │
            │ rewrite          │ posture (i)      │ CC /workflows                  │
────────────────────────────────────────────────────────────────────────────────────
```

---

## 5. Scope Summary

```
HORIZONTAL SCOPE:
  Layers affected: 9
    - 5 modify-heavy: 1, 2, 3, 6, 8
    - 1 new-creation: 1 (execute-mode-cc-workflows skill); 6 (disposition docs); 9 (spike artifact)
    - 1 read-only re-use: 7
    - 2 doc-only: 4 (persona doc), 8 (README + CONTEXT.md)
  Total items: ~50-90 file touches across all layers
    - executor seam: 3 files (step 6f + dispatch + new skill)
    - config: 2 files + schema_version bump
    - integration-branch: 1 mechanism encoded inside new skill + possible shared helper
    - persona: 1 new doc + read of existing 22/3 cut
    - skill distribution: 0-1 (Plan B only ships if Phase 0 (d) FAIL)
    - disposition: 2 new docs (audit) + ~30 story YAML mutations (apply)
    - story dispatch: 0 (read-only re-use)
    - README + CONTEXT.md: 2 files
    - spike artifact: 1 new doc
  New vs modified:
    - 6 new files (execute-mode-cc-workflows/SKILL.md, persona-dispatchability-under-cc-workflows.md,
      disposition-pass-msd.md, disposition-pass-mpt.md, spike-findings.md, optional shared helper)
    - ~10-15 modified files (skills/execute, execute-dispatch, hive.config.yaml,
      hive/hive.config.yaml, README.md, CONTEXT.md, ~30 story YAMLs in 2 epics
      [counted as modified, not new])
  Estimated total effort: large
    - Driven by Layer 1's new skill + Layer 2's precedence-chain + per-epic-override rule +
      Layer 3's serial-commit gate (novel mechanism) + Layer 6's 30-story disposition

  LARGEST LAYER: Layer 1 (executor seam) — new atomic skill + dispatch resolver changes;
                  Layer 6 (disposition) by story-count
  RISKIEST LAYER: Layer 9 (Phase 0 spike) — load-bearing unknowns + 2 HIGH risks both gated here
                  Layer 3 (integration-branch) — novel mechanism, Plan B fork point
```

---

## 6. Cross-cutting concerns touchpoints (loaded Phase A step 3)

```
DOCUMENTATION  applies-globally across Layers 4, 6, 8, 9 — every doc-bearing layer
               produces or revises a doc; vertical plan §6 references this map per slice

VERSIONING     touches Layer 2 — hive.config.yaml schema_version bump; field_sources
               schema doc update; record additive enum extension under semver minor

METRICS        touches Layer 1 (execute-dispatch enum change is a metric-bearing surface);
               per-story metric evaluation happens at Phase C step 14 (out of horizontal scope)

SIMULATED-     touches Layer 6 (disposition for /test --simulated-manual routes through Multica
MANUAL         is the central decision for multica-plan-test-cycles); the Q3 resolution
               keep-as-second-party for first release means the route stays on Multica until
               revisited
```

---

_End of horizontal plan. Vertical plan (sibling doc) overlays slice boundaries on this map; no execution order suggested here._
