# Structured Outline — cc-workflows-first-party

**Epic id:** `cc-workflows-first-party`
**Base branch:** `develop`
**Branch strategy:** per-epic (`feat/cc-workflows-first-party`)
**Author:** technical-writer (Phase B3 step 9, 2026-05-31)
**Status:** authored from H/V plans + design-discussion v2 + grill-record + cycle-state (gate_decisions Q1-Q9 + 2 escalations); maintainer gate 2 cleared

This outline consumes the design discussion and the horizontal/vertical plans. Each Phase below maps 1:1 to the corresponding vertical slice. Story decomposition (Phase C of `/plan`) becomes mechanical against this.

---

## Part 1 — Executive Summary

**What we're building.** Re-base plugin-hive's `/execute` substrate on Claude Code `/workflows` (CC 2.1.154 GA — "dynamic workflows… tens to hundreds of agents in the background") as **first-party**. Demote the existing Multica-in-Sandcastle substrate to **second-party**, retained-but-opt-in for three real moats: heterogeneous-provider co-mingling, headless webhook autopilots, and durable cross-session issue queue. A new `execution.runtime` knob in `hive.config.yaml` (values: `workflows | multica | auto`, default `auto`) toggles between them, with a hard rule that per-epic disposition overrides the `auto` heuristic.

**Why.** CC 2.1.154 ships native multi-agent fan-out + dynamic workflows that subsume most of what Multica's deepening epic was building. Per memory `feedback_test_offtheshelf_before_rewriting`, "rebuild subset of X inside hive" must trigger "spike X first." This epic is the rebase; Phase 0 is the spike that makes the rebase responsible.

**How user feedback shaped the plan.** Maintainer cleared **gate 1** (design-discussion v2) confirming: Scale Large, Q2 conditional (a) PR-flow preservation, Q5 autopilot split DESCOPED, posture (i) "Hive composes ON Claude Code", `execution.runtime: auto` with per-epic-override rule, A-for-first-release vs C-as-fallback if Phase 0 reveals coercion cost. Maintainer cleared **gate 2** (H/V plans) confirming the 6-slice decomposition (autopilot phase absent). Architect-v2 unified grill C1+C2 into a **serial-commit gate at the integration-branch push layer** — load-bearing MVP mechanism, agents return file lists, adapter commits serially. Architect tightened Q2 traceability via `field_sources.execution_runtime.epic_override: <path>`. TPM split Phase 5 into 5a audit (read-only, parallel) + 5b apply (sequenced).

**Locked decisions (cited).** Q1 spike pass criteria (a)-(d) → architect+TPM extension Codex creator required; Q2 (a) conditional on Phase 0 (a) → architect serial-commit gate; Q3 `multica-plan-test-cycles` keep-as-second-party for first release → maintainer gate 1; Q4 `execution.runtime: auto` + per-epic-override → architect+TPM unified rule; Q5 DESCOPED → architect-v2 ruling; Q6 minimum-viable parity → maintainer gate 1; Q7 Option A for first release → maintainer gate 1; Q8 `execution.runtime` orthogonal to `execution.substrate` → maintainer gate 1; Q9 posture (i) → maintainer gate 1.

**Strategy in 5 sentences.** (1) Phase 0 spike runs `/workflows` end-to-end against one ≤5-story epic with at least one Codex-routed creator, captures pass/fail verdicts for criteria (a)-(d), and gates everything downstream. (2) Phase 2 MVP collapses adapter scaffolding + serial-commit gate + (a)-conditional integration-branch contract + persona-classification scaffold into one slice that proves the path opt-in. (3) Phase 3 produces the persona-dispatchability re-cut from first-hand evidence. (4) Phases 4a/4b audit and apply dispositions for ~30 stories across two in-flight epics, bundled into this epic's PR for single audit trail. (5) Phase 6 (V Slice 6) rewrites README + CONTEXT.md last so the canonical North Star reflects shipped behavior, not aspiration.

**Optional product goals omitted.** This is internal substrate work for a single-maintainer plugin; success metrics + stakeholders + non-goals are captured in §5 Risk Registry and §6 Dependency Map without producing empty boilerplate.

---

## Part 2 — Detailed Approach (per phase, 1:1 to V slices)

### Phase 1 ↔ V Slice 1 — Phase 0 capability spike (HARD GATE)

**Goal:** Produce `spike-findings.md` with explicit PASS/FAIL verdicts for criteria (a)-(d). No production code lands. Maintainer-gates the rest of the epic.

**Depends on:** Nothing in this epic. Reads design-discussion v2, research-brief, grill-record, cycle-state.

**Changes:**

1. **`.pHive/epics/cc-workflows-first-party/docs/spike-findings.md`** *(NEW)*
   - Sections (mandatory): Spike setup; Criterion (a)-(d) verdicts; Verdict block (gates downstream); Recommendations for Plan B branch activations
   - Spike setup names the test epic (existing small epic or synthetic), the persona team composition (must include ≥1 Codex-routed creator per architect-v2 unified C1/C2 mitigation), the CC version verified locally (2.1.154+), the agent team's `/workflows` invocation pattern
   - Criterion (a): integration-branch contract — does `/workflows` accept free-form prompt injection of the shell-snippet contract (mirror of `multica-story-dispatch/index.mjs:192-262`)? Did the integration branch advance with one commit per story?
   - Criterion (b) [architect-tightened]: Codex creators return file lists AND the adapter commits serially against the integration branch — no agent makes `.git` writes under `/workflows` fan-out; harness serializes
   - Criterion (c): completion signal + failure modes — `/workflows` surfaces clean completion event; partial failures recoverable (resume vs restart distinguishable)
   - Criterion (d): plugin-shipped skill auto-load under CLI-interactive 2.1.157 — does `plugin-hive` (marketplace-installed) auto-load in a fresh CC session, or is the 2.1.157 changelog language (consumer-side `.claude/skills/`) the only path?
   - Verdict block: a single table of (a)-(d) PASS/FAIL with one-line evidence cite per row; downstream Plan B activation log

2. **`.pHive/cycle-state/cc-workflows-first-party.yaml`** *(MODIFY)*
   - Append `spike_outcome` block: criterion verdicts mirrored + Plan B branch selections recorded (Q2 (a) / (b) / (c); Layer-5 auto-load PASS → primary path / FAIL → Plan B Mode D-a on first-party)
   - Preserve `gate_decisions` block from gate 1
   - Preserve `escalations` block (security:plan-audit moderate, performance:audit minor)

**Interfaces (none lands as production this phase).** Spike harness may scaffold a draft `execute-mode-cc-workflows/SKILL.md` for invocation testing, but it does NOT land in `skills/hive/skills/`. The contract under test:

```
INPUT (during spike):
  /workflows <invocation pattern under test>
  agent prompt corpus including shell-snippet contract (if criterion (a) test path)

OBSERVED OUTPUT (recorded in spike-findings.md):
  integration branch state (single commit per story? format honored?)
  completion event (clean? partial? recoverable?)
  agent return shape (file list? direct .git writes? both?)
  skill auto-load (plugin-hive skills visible to dispatched agents?)
```

**Validation:**
- `spike-findings.md` exists with explicit PASS/FAIL per (a)-(d) — no "TBD" or "needs more investigation" allowed; maintainer accepts only verdicts
- Codex-routed creator in test team — without it, spike pass is hollow per architect-v2
- Maintainer reads and signs gate at end of phase; signature recorded in cycle-state
- Silent risk: spike "passes" but with caveats not surfaced as verdict downgrades. Mitigation: criterion verdict template forces evidence cite per row

**Cross-cutting concerns this phase:**
- **documentation:** spike-findings.md IS the primary deliverable; gates everything downstream
- **versioning:** none this phase (no schema lands)
- **metrics:** scope-drift emit ONLY at `plan:phase-c` per memory `feedback_scope_drift_emit_sites` — Phase 0 does not re-emit
- **simulated-manual:** none this phase

---

### Phase 2 ↔ V Slice 2 — MVP first-party path (architect-unified serial-commit gate)

**Goal:** A real hive epic runs via `execution.runtime: workflows` (env or root-config override). `mode_decision` resolves `cc-workflows`; `execute-mode-cc-workflows` skill executes via `/workflows`; serial-commit gate honored (agents return file lists, harness commits per-story on integration branch); one persona runs end-to-end producing a single correctly-formatted commit. Opt-in only — `auto` heuristic not yet activated by default flows (Slice 5 lands per-epic-override entries).

**Depends on:** Phase 1 maintainer gate cleared with verdicts. Q2 path branch selected at entry (per Phase 0 (a) verdict). Layer-5 path branch selected at entry (per Phase 0 (d) verdict).

**Changes:**

1. **`skills/execute/SKILL.md`** *(MODIFY)*
   - Add Process step `6f` cc-workflows branch
   - Mirror the contract of `6e` multica: when `mode_decision == 'cc-workflows'`, invoke `execute-mode-cc-workflows` skill
   - Edge: single-isolation-layer rule preserved — `6f` does not recursively spawn `/workflows`

2. **`skills/hive/skills/execute-dispatch/SKILL.md`** *(MODIFY)*
   - Extend `mode_decision` enum: add `'cc-workflows'` value (additive; preserves existing values `sessions | team | team-cmux | sequential | sandcastle | multica`)
   - Add `field_sources.execution_mode` source entry following the existing field_sources convention; chain `env > root config > shipped baseline > skill override > default`
   - Add `field_sources.execution_runtime`: same precedence chain
   - Add `field_sources.execution_runtime.epic_override: <path>` (architect Q2 tightening) — records which per-epic disposition file overrode the `auto` heuristic for traceability
   - Add resolver logic: BEFORE emitting `mode_decision`, read `.pHive/cycle-state/<epic-id>.yaml` `execution_runtime` block (if present); if `execution.runtime == auto` and per-epic override present, force `mode_decision` to the override value AND set `epic_override` path
   - If per-epic-override cycle-state file is missing for an unknown epic, resolver gracefully falls through to the `auto` heuristic — no hard error (gates against bootstrap chicken-and-egg)

3. **`skills/hive/skills/execute-mode-cc-workflows/SKILL.md`** *(NEW)*
   - Mirror the shape of `execute-mode-multica/SKILL.md`
   - Step 0: precondition gate — verify CC runtime >= 2.1.154; verify `execution.runtime` resolves to `cc-workflows` (or env override `HIVE_EXECUTION_RUNTIME=workflows`); reject otherwise with field_sources cite
   - Step 1: `workflow_assembly` substep — prompt construction, persona-to-step mapping (from persona files per `feedback_use_roster_agents`), `/workflows` invocation, completion-signal wiring. **Internal logic gated by Phase 0 (a) verdict; outer seam invariant.**
   - Step 2: `/workflows` dispatch — invoke via CC native primitives; capture run handle
   - Step 3: **serial-commit gate** (Layer 3 mechanism) — receive file lists from agents; adapter applies serially against integration branch; fast-forward enforced; rebase-and-push 3-retry (mirrors `multica-story-dispatch/index.mjs:192-262`). Either factor common serialization into a shared helper OR copy with attribution; decision deferred to implementation (both honor "single committer" invariant)
   - Step 4: episode marker write — `${HIVE_STATE_DIR}/episodes/{epic}/{story}/cc-workflows-run.yaml`
   - Step 5: summary return — surface completion, scope-drift signal, episode path; calls `task-tracking-dispatch` ABI for status updates (unchanged)
   - "Replaces respawn skill for its stories" (mirrors session-mode pattern per `skills/hive/skills/execute-mode-session/SKILL.md`)
   - Honors single-isolation-layer rule

4. **`hive.config.yaml`** *(MODIFY)*
   - Add `execution.runtime: workflows | multica | auto` knob (default `auto`)
   - Document precedence chain in inline comment
   - Document per-epic-override rule in inline comment
   - Bump `hive.config.yaml` schema_version (cross-cutting versioning concern; semver minor for additive enum)

5. **`hive/hive.config.yaml`** *(MODIFY)*
   - Shipped baseline: add `execution.runtime: auto`
   - Schema version mirror

6. **`hive/lib/multica-story-dispatch/index.mjs`** *(READ-ONLY reference)*
   - Lines 192-262 are the integration-branch shell-snippet template the new adapter mirrors. NOT modified this phase. Optionally factored into a shared helper used by both `multica-story-dispatch` and the new `cc-workflows` adapter; that refactor is in-scope IF the diff stays cleanly inside the <150 file cap; otherwise copy-with-attribution
   - If shared helper path: extract `formatStoryCommitContract(story, integrationBranch, retryPolicy)` → new utility in `hive/lib/integration-branch-contract/index.mjs` *(NEW utility)*

7. **`hive/lib/task-tracking-dispatch/index.ts`** *(READ-ONLY re-use; no fork)*
   - Step 5 of new adapter invokes existing ABI; no modifications

**Interfaces:**

```
NEW: execute-mode-cc-workflows skill contract

INVOCATION (from execute-dispatch when mode_decision == 'cc-workflows'):
  inputs:
    epic_id: string
    story_id: string
    integration_branch: string
    persona_team: string[]  // persona names from hive/agents/
    agent_backends_map: object  // per-persona codex|claude routing
  outputs:
    completion_status: 'success' | 'partial' | 'failure'
    episode_path: string
    scope_drift_signal: object | null
    field_sources: object  // including execution_runtime + epic_override

EXTENDED: execute-dispatch resolver contract

INPUTS:
  env: object  // process.env subset
  config: { root, shipped_baseline, skill_override, default }
  epic_id: string  // for per-epic disposition lookup

PRECEDENCE CHAIN (load order):
  1. env.HIVE_EXECUTION_RUNTIME (if set)
  2. root config (hive.config.yaml in cwd)
  3. shipped baseline (hive/hive.config.yaml in plugin)
  4. skill override (per-skill execution.runtime if declared)
  5. default ('auto')

PER-EPIC-OVERRIDE RULE:
  IF execution.runtime resolves to 'auto':
    Look up .pHive/cycle-state/<epic_id>.yaml execution_runtime block
    IF present, force mode_decision to that block's value
    Record path in field_sources.execution_runtime.epic_override
  IF execution.runtime resolves to explicit 'workflows' or 'multica':
    Per-epic disposition does NOT override (preserves maintainer intent)
  IF .pHive/cycle-state/<epic_id>.yaml absent:
    Fall through to auto heuristic; no hard error

AUTO HEURISTIC (when no per-epic-override):
  Prefer 'cc-workflows' IF CC version >= 2.1.154 detected
                         AND no second-party trigger present
                            (codex on dispatched persona AND that mode supports it,
                             webhook autopilot context [n/a after Q5 descope],
                             durable-queue requirement)
  ELSE prefer 'multica'
```

**Validation:**
- Unit assertion: precedence chain resolves correctly across env / root config / shipped baseline / skill override / default; existing modes don't regress
- Unit assertion: `field_sources.execution_runtime.epic_override` set ONLY when `auto` + cycle-state present; not set for explicit `workflows` or `multica`
- Unit assertion: missing cycle-state file falls through to auto heuristic gracefully
- shellcheck on any new shell-snippet contracts (Q2 (a) path)
- Episode marker exists at `${HIVE_STATE_DIR}/episodes/{epic}/{story}/cc-workflows-run.yaml` after slice-test run
- Manual: run an existing tiny epic end-to-end with `HIVE_EXECUTION_RUNTIME=workflows`; observe one commit per story landing on integration branch via the serial-commit gate
- Manual: run with explicit `execution.runtime: multica` in root config to verify per-epic-override does NOT route around explicit choice
- Silent risk: schema_version bump breaks existing skill consumers downstream (e.g. `/plan` reads it). Mitigation: `git grep schema_version skills/` before commit to enumerate readers; update any version-range check

**Cross-cutting concerns this phase:**
- **documentation:** new SKILL.md is doc; new fields documented in `hive.config.yaml` comments + execute-dispatch SKILL.md; CONTEXT.md untouched this phase (lands in Phase 6)
- **versioning:** schema_version bump on `hive.config.yaml` (semver minor — additive enum + additive field_sources entries)
- **metrics:** Phase 2 is the **first end-to-end measurement opportunity**; scope-drift emit at `execute:story` (per memory `feedback_scope_drift_emit_sites` — 3 emit sites only, do NOT add per-phase emits); story-level metric evaluation deferred to `/plan` Phase C step 14
- **simulated-manual:** none direct; flag for Phase 5 (`/test --simulated-manual` route disposition)

---

### Phase 3 ↔ V Slice 3 — Persona surface re-classification

**Goal:** Produce `persona-dispatchability-under-cc-workflows.md` with per-persona verdicts (DISPATCHABLE / COLLAPSED-elimination / REFRAMED), sourced from first-hand evidence in Phases 1+2. No team-lead-shaped intermediary surface reintroduced (preserves `feedback_no_team_lead_intermediary`). If `/workflows` cannot fully express a persona's coordination work, persona remains DISPATCHABLE.

**Depends on:** Phase 1 verdicts + Phase 2 MVP path running real personas with first-hand evidence captured.

**Changes:**

1. **`.pHive/epics/cc-workflows-first-party/docs/persona-dispatchability-under-cc-workflows.md`** *(NEW)*
   - Source comparison: read existing `.pHive/epics/multica-substrate-deepen/docs/persona-dispatchability.md:15-65` (the 22 dispatchable / 3 harness-only cut on Multica)
   - For each of the 25 personas in `hive/agents/`: verdict + evidence cite (Phase 1 or 2)
     - **DISPATCHABLE:** persona remains standalone agent invoked by `/workflows`
     - **COLLAPSED:** persona's coordination work fully expressed in workflow YAML/spec — ELIMINATION (not relocation per `feedback_no_team_lead_intermediary` posture); evidence required
     - **REFRAMED:** persona's role changes shape (e.g., pair-programmer may become a `/workflows` step pattern)
   - Posture invariants section: `feedback_no_team_lead_intermediary` cross-check (no persona reclassified into team-lead-shaped intermediary); `feedback_use_roster_agents` cross-check (any persona reused in workflow YAML references the persona file, not improvised inline)
   - UNVERIFIED-defer policy: any persona without first-hand evidence marked UNVERIFIED + deferred — do NOT speculate

2. Read-only reference: `.pHive/epics/multica-substrate-deepen/docs/persona-dispatchability.md`. Not modified this phase (cross-epic disposition tracked separately in Phases 4a/4b).

**Interfaces (doc-only).** No code interfaces change. Downstream consumer is human readers + future skill authors deciding which persona to reference in workflow YAML.

**Validation:**
- Doc review against existing 22/3 cut: every persona has a verdict OR an explicit UNVERIFIED-defer with reason
- Maintainer review confirms posture not regressed (no team-lead-shaped intermediary reintroduced)
- Per-persona verdict cites the Phase 1 or Phase 2 evidence justifying it
- Silent risk: speculation slips in as "evidence" without first-hand corroboration. Mitigation: UNVERIFIED-defer is acceptable; speculation is not

**Cross-cutting concerns this phase:**
- **documentation:** new persona doc IS the deliverable
- **versioning:** none
- **metrics:** none (per-persona evaluation is implementation concern not metric)
- **simulated-manual:** none

---

### Phase 4 ↔ V Slice 4 — Disposition AUDIT (read-only, parallel-eligible)

**Goal:** Per-story candidate dispositions written for all 30 stories across both in-flight epics: `multica-substrate-deepen` (19 stories) + `multica-plan-test-cycles` (11 stories). Read git+disk per `feedback_story_status_stale` — YAML `status: pending` lies for shipped work. No file mutations to story YAMLs this phase.

**Depends on:** Phase 1 gate cleared (so spike outcome is known when classifying stories that depend on first-party path). NOT blocked on Phases 2 or 3 — zero coupling — can run parallel.

**Changes:**

1. **`.pHive/epics/cc-workflows-first-party/docs/disposition-pass-msd.md`** *(NEW)*
   - For each of 19 stories in `.pHive/epics/multica-substrate-deepen/stories/`: candidate verdict (keep-as-second-party / park / supersede) + rationale + git+disk evidence
   - W3.2 `w3-2-autopilots-yaml` candidate: **park** (architect-v2 Q5 descope ruling — autopilot work not in this epic)
   - Audit method explicitly notes git+disk over YAML status (per `feedback_story_status_stale`)

2. **`.pHive/epics/cc-workflows-first-party/docs/disposition-pass-mpt.md`** *(NEW)*
   - For each of 11 stories `mpt-1..mpt-11` in `.pHive/epics/multica-plan-test-cycles/stories/`: candidate verdict + rationale + git+disk evidence
   - All 11 currently shipped via PR #234 (merged 2026-05-28). Default candidate verdict per Q3 (maintainer-confirmed at gate 1): **keep-as-second-party for first release** — Multica still routes `/plan` + `/test --simulated-manual` when user opts in
   - Per-story drilldown can override the default if evidence supports it; deviation rationale required

**Interfaces (doc-only).** Audit consumes git log, PR refs, story YAMLs, project memory snapshots. No code touched.

**Validation:**
- `disposition-pass-msd.md` exists with per-story candidate for all 19 stories
- `disposition-pass-mpt.md` exists with per-story candidate for all 11 stories
- Spot-check 3 sample stories per epic: candidate verdict matches what git log + disk + PR refs actually show shipped vs not
- W3.2 candidate verdict = park (recorded explicitly)
- Audit method line in each doc states git+disk method
- Silent risk: classifying a shipped story as `pending` because YAML status says so. Mitigation: spot-check sample + audit method discipline + trust-git+disk explicit

**Cross-cutting concerns this phase:**
- **documentation:** both disposition docs are deliverables
- **versioning:** none
- **metrics:** none direct; cross-epic story counts inform Phase 5 scope
- **simulated-manual:** the central Q3 decision (`/test --simulated-manual` keep-as-second-party) shows up in disposition-pass-mpt.md candidate verdicts

---

### Phase 5 ↔ V Slice 5 — Disposition APPLY (sequenced after Q3 + Phases 2 + 4)

**Goal:** Apply audit verdicts as YAML mutations + project memory updates + per-epic-override entries to cycle-state. Bundle commits into THIS epic's PR for single audit trail per TPM. Watch <150 file cap per `feedback_pr_file_count_limit`; stack via base-branch retargeting if needed.

**Depends on:** Phase 4 audit candidates exist; Phase 2's per-epic-override mechanism exists in the execute-dispatch resolver (override entries written this phase are READ by Phase 2's resolver — chicken-and-egg avoided because Phase 2 ships first); Q3 resolution from gate 1 (keep-as-second-party for first release).

**Changes:**

1. **`.pHive/cycle-state/multica-substrate-deepen.yaml`** *(MODIFY or NEW)*
   - Add `execution_runtime` block with adapter selection per audit verdict (likely `multica` for stories shipped on Multica + remaining pending stories that depend on Multica primitives)
   - File may not exist yet for some epics; create if absent

2. **`.pHive/cycle-state/multica-plan-test-cycles.yaml`** *(MODIFY or NEW)*
   - Add `execution_runtime` block: `multica` (Q3 maintainer-confirmed keep-as-second-party); this routes `/plan` + `/test --simulated-manual` through Multica via the per-epic-override mechanism

3. **~30 story YAML files across both epics** *(MODIFY)*
   - `.pHive/epics/multica-substrate-deepen/stories/*.yaml`: each gets `disposition: <verdict>`, `disposition_rationale: <brief>`, `disposition_source_slice: cc-workflows-first-party/slice-4` fields
   - `.pHive/epics/multica-plan-test-cycles/stories/*.yaml`: same fields
   - W3.2 `w3-2-autopilots-yaml.yaml`: disposition = `park` (Q5 descope)

4. **Project memory updates** *(MODIFY)*
   - `~/.claude/projects/-Users-don-Documents-plugin-hive/memory/project_multica_substrate_adoption.md`: note disposition decisions inline (not bulk-overwriting)
   - `~/.claude/projects/-Users-don-Documents-plugin-hive/memory/project_multica_plan_test_cycles.md`: same
   - Both files preserve historical context; disposition update is an additive note

**Interfaces (data shape):**

```
NEW: per-epic cycle-state execution_runtime block

.pHive/cycle-state/<epic_id>.yaml
  execution_runtime:
    adapter: 'multica' | 'cc-workflows'
    rationale: string                # one-line "why this adapter for this epic"
    decided_by: 'cc-workflows-first-party/slice-5'  # provenance
    decided_at: '2026-...'           # ISO timestamp

NEW: per-story YAML disposition fields

stories/<story-id>.yaml (additive)
  disposition: 'keep-as-second-party' | 'park' | 'supersede'
  disposition_rationale: string
  disposition_source_slice: 'cc-workflows-first-party/slice-4'
```

**Validation:**
- Each story YAML mutation matches Phase 4 audit candidate (1:1 — no drift between audit and apply); diff against `disposition-pass-msd.md` + `disposition-pass-mpt.md`
- Cycle-state for both target epics reflects new disposition with `execution_runtime` block
- Precedence-chain assertion (unit-test against Phase 2's resolver): a `keep-as-second-party` epic with `execution.runtime: auto` produces `mode_decision: multica` with `field_sources.execution_runtime.epic_override` set to the cycle-state file path
- Same assertion with explicit `execution.runtime: workflows` produces `mode_decision: cc-workflows` (per-epic-override does NOT override explicit choice — Q4 invariant)
- PR file count check: this phase's commits + Phase 2's commits keep epic PR under 150 files; stack via base-branch retargeting if exceeded
- W3.2 = park (verified in `multica-substrate-deepen/stories/w3-2-autopilots-yaml.yaml`)
- Silent risk: bulk-overwriting a project memory file. Mitigation: additive note discipline; Read-then-Edit per file

**Cross-cutting concerns this phase:**
- **documentation:** project memory updates are doc; commit messages reference Phase 4 audit candidates
- **versioning:** none (cycle-state + story YAMLs don't carry schema_version)
- **metrics:** none direct; per-epic-override traceability via `field_sources.execution_runtime.epic_override` is the audit surface for future routing analysis
- **simulated-manual:** **CENTRAL** — Q3 keep-as-second-party for `multica-plan-test-cycles` means `/test --simulated-manual` flows route through Multica via this phase's `execution_runtime` block; verify by running the precedence-chain assertion above

---

### Phase 6 ↔ V Slice 6 — README + CONTEXT.md positioning

**Goal:** Rewrite README hero + Quick Start step 1 per Q9 (i) "Hive composes ON Claude Code". Update CONTEXT.md "Composability" posture statement + add vocab section disambiguating hive-workflow vs CC `/workflows`. Lands LAST so language reflects shipped behavior, not aspiration (defended in design-discussion §10 vs grill C3).

**Depends on:** Phases 1-5 shipped — README cannot truthfully claim behavior that isn't merged.

**Changes:**

1. **`README.md`** *(MODIFY)*
   - Hero (lines 1-20): rewrite per Q9 (i) reframe
     - Old: "Composable substrate for the agentic SDLC — user-directed, disciplined, kickoff to ship" + "Claude Code plugin that turns your project into a coordinated swarm of AI specialists…"
     - New (sketch — exact wording in implementation): "Hive composes ON Claude Code: first-party CC workflows for in-session execution; second-party Multica for codex co-mingling, headless webhooks, and durable cross-session issue queue." + adapter framing keeping "composable substrate" intact but anchored on CC as the substrate
   - Quick Start step 1: NO LONGER `/hive:multica-init` as "Bootstrap Multica as the execution substrate"
     - New step 1: CC-workflows-first onboarding (verify CC 2.1.154+; opt-in via `execution.runtime: workflows` or default `auto`)
     - Multica step demoted to step 2 (or later): "Optional: bootstrap Multica for codex co-mingling / headless webhooks / durable queue"
   - Preserve all Multica references (don't deprecate — demote)

2. **`CONTEXT.md`** *(MODIFY)*
   - "Composability" posture statement: durable placement of Q9 (i) reframe so downstream skills/agents reference consistent posture
     - Old: "Composability — the 2.0 north star. Substrate that the user directs vs a director-chair workflow that hard-blocks."
     - New (sketch): "Composability — Hive composes ON Claude Code. CC workflows is the first-party substrate; Hive provides the composition layer (personas, skills, plan/execute discipline) on top. Multica is second-party for codex co-mingling, webhooks, and durable queue. User directs through `execution.runtime` selection and per-epic disposition."
   - Vocab section: new subsection (or expanded existing) disambiguating
     - **hive-workflow** — YAML at `hive/workflows/*.workflow.yaml` defining ordered steps with persona / step-file / methodology dependencies (existing primitive)
     - **CC `/workflows`** — Claude Code native slash command (2.1.154 GA) for dynamic background multi-agent fan-out
   - Resolves grill V1 (vocabulary overload) + grill P2 (composability posture)

**Interfaces (doc-only).** No code interfaces change. Downstream consumers are human readers (maintainer + plugin consumers) + future skill/agent authors.

**Validation:**
- Manual review by maintainer: README positioning matches Q9 (i) reframe
- Doc-test: any code samples in README (commands, paths) still resolve in current worktree
- Vocab grep: CONTEXT.md's hive-workflow vs CC `/workflows` distinction has no contradictory usage in skill/agent files touched by this epic
- Vocab grep on UNTOUCHED files: flag contradictory usage but do NOT fix in this epic (scope creep). File a follow-on `chore/vocab-disambiguation` epic if drift is substantial
- Fresh-consumer test: a reader unfamiliar with the project can bootstrap CC-workflows-first execution per the rewritten Quick Start
- Silent risk: README ships positioning ahead of behavior that subtly regresses post-merge. Mitigation: Phase 6 lands LAST so all behavior is verified

**Cross-cutting concerns this phase:**
- **documentation:** **HOTSPOT** — README + CONTEXT.md are both canonical North Star docs
- **versioning:** none (no schema)
- **metrics:** none direct
- **simulated-manual:** README must accurately describe how Q3-resolved `/plan` + `/test --simulated-manual` keep-as-second-party flows work under `auto`

---

## Part 3 — Verification Plan (per-phase)

### Phase 1 verification

```
Automated:
  - None (spike phase — no code lands)

Manual:
  - spike-findings.md criterion (a)-(d) verdicts present with evidence cites
  - Codex-routed creator confirmed in test-team composition (architect-v2 requirement)
  - Test epic identified (existing or synthetic) + run completed end-to-end via /workflows
  - Cycle-state spike_outcome block populated; Plan B branch selections recorded
  - Maintainer gate signature recorded in cycle-state

Tools: manual /workflows invocation, git log, direct artifact inspection
Platforms: macOS dev workstation (Darwin 25.3.0+), CC 2.1.154+
```

### Phase 2 verification

```
Automated:
  - Unit: mode_decision enum extension does not regress existing modes (parameterized over enum values)
  - Unit: precedence-chain resolver produces correct mode_decision for {env, root, baseline, skill, default} permutations
  - Unit: field_sources.execution_runtime.epic_override populated ONLY when auto + cycle-state present
  - Unit: missing cycle-state file falls through to auto gracefully (no hard error)
  - shellcheck: any new shell-snippet contracts (Q2 (a) path)
  - Schema: hive.config.yaml schema_version bump verified; diff against shipped baseline
  - Episode marker: ${HIVE_STATE_DIR}/episodes/{epic}/{story}/cc-workflows-run.yaml exists after slice-test run

Manual:
  - Run tiny existing epic with HIVE_EXECUTION_RUNTIME=workflows; observe one-commit-per-story on integration branch
  - Run with explicit execution.runtime: multica in root config; verify per-epic-override does NOT route around explicit choice
  - Verify single-isolation-layer rule preserved (no recursive /workflows spawn from within a /workflows-dispatched agent)

Tools: jest or equivalent JS unit framework for hive/lib if shared helper extracted; bash/git for integration-branch tests; shellcheck for shell-snippet contracts; Python pytest if any hive/lib changes are Python
Platforms: macOS dev workstation, CC 2.1.154+
```

### Phase 3 verification

```
Automated:
  - None (read-only doc deliverable)

Manual:
  - persona-dispatchability-under-cc-workflows.md exists with verdict per persona OR explicit UNVERIFIED-defer
  - Per-persona verdict cites Phase 1 or Phase 2 evidence
  - Maintainer review confirms no team-lead-shaped intermediary reintroduced
  - feedback_use_roster_agents cross-check: any persona referenced in workflow YAML cites persona file

Tools: doc grep against hive/agents/ + cross-reference vs existing persona-dispatchability.md
Platforms: n/a (doc work)
```

### Phase 4 verification

```
Automated:
  - None (read-only audit)

Manual:
  - disposition-pass-msd.md exists with per-story candidate for all 19 stories
  - disposition-pass-mpt.md exists with per-story candidate for all 11 stories
  - Spot-check 3 sample stories per epic against actual git state + PR refs
  - W3.2 candidate = park (recorded explicitly)
  - Audit method line: git+disk over YAML status (per feedback_story_status_stale)

Tools: git log, gh pr view (for PR #230, #231, #234, post-#234 merges), direct YAML inspection
Platforms: n/a (doc work)
```

### Phase 5 verification

```
Automated:
  - Unit: precedence-chain assertion against Phase 2 resolver — keep-as-second-party epic + auto → multica + epic_override set
  - Unit: same epic + explicit workflows → cc-workflows (no override of explicit choice)
  - Audit-trail check: every disposition mutation has commit message referencing Phase 4 audit candidate
  - PR file count: this phase + Phase 2 combined < 150; stack via base-branch retargeting if exceeded

Manual:
  - Each story YAML mutation matches Phase 4 audit candidate (1:1 diff against disposition-pass-*.md)
  - cycle-state for multica-substrate-deepen + multica-plan-test-cycles reflects new disposition with execution_runtime block
  - W3.2 = park verified in story YAML
  - Project memory files updated additively (not bulk-overwritten); Read-then-Edit per file

Tools: jest or equivalent for the precedence-chain assertions; gh pr diff for file count; manual diff for YAML mutations
Platforms: n/a
```

### Phase 6 verification

```
Automated:
  - Doc-test: code samples in README resolve in current worktree (e.g. cited paths exist; cited commands are valid)
  - Vocab grep: hive-workflow vs CC /workflows usage consistency in TOUCHED files (this epic's deliverables)

Manual:
  - Maintainer review of README hero + Quick Start
  - Maintainer review of CONTEXT.md Composability posture statement
  - Fresh-consumer test: bootstrap CC-workflows-first execution per rewritten Quick Start
  - Vocab grep on UNTOUCHED files: flag drift; do NOT fix here (scope creep)

Tools: manual + grep + maintainer review
Platforms: n/a
```

### Verification coverage matrix

| Acceptance criterion (from design-discussion §3) | Test type | Tool | Phase |
|---|---|---|---|
| Phase 0 spike criteria (a)-(d) verdicts | Manual + spike artifact | manual /workflows run | 1 |
| `mode_decision` enum extension correct | Unit | jest | 2 |
| `execution.runtime` precedence chain | Unit (param) | jest | 2 |
| `field_sources.execution_runtime.epic_override` populated correctly | Unit | jest | 2 |
| Serial-commit gate: file lists in, single commit per story out | Manual + integration | bash/git | 2 |
| Episode marker exists | Unit + manual | jest + ls | 2 |
| Persona surface re-classified with evidence | Doc review | manual | 3 |
| Disposition candidates exist for 30 stories | Doc + spot-check | grep + git | 4 |
| Story YAML mutations match audit candidates | Diff | manual | 5 |
| Per-epic-override routes auto-runtime to multica | Unit + integration | jest + manual | 5 |
| README + CONTEXT.md reflect shipped behavior | Doc review + fresh-consumer test | manual | 6 |

### What's NOT being verified (and why)

- **Cost / latency benchmarks beyond Phase 0 snapshot** — POST-MVP per Q6 minimum-viable parity; performance:audit minor escalation captures first-release retrospective scope
- **Multica server-side label-return defect (GET /api/skills omits content_hash + visibility)** — second-party-only; tracked under multica-substrate-deepen W4.x; first-party path does not depend on label-return
- **W4.4 CI drift guard migration to first-party** — bundled-skill-specific; irrelevant once auto-load is in play; second-party-only either way
- **Multica webhook-autopilot E2E pilot (grill H2)** — Q5 descope; out-of-scope; future autopilot-owner epic
- **Full feature parity with Multica adapter on first-party path** — Q6 minimum-viable
- **Vocab drift in untouched files** — scope creep; followed-up via `chore/vocab-disambiguation` only if Phase 6 grep reveals substantial drift

---

## Part 3b — Cross-Cutting Concerns

**Error handling strategy.** Adapter (`execute-mode-cc-workflows` Step 3 serial-commit gate) catches: agent-side failures (file list malformed, agent timeout); integration-branch failures (rebase conflict, push rejection). Adapter retries push 3x with rebase per existing convention (mirrors `multica-story-dispatch:192-262`); if all 3 fail, raises to `task-tracking-dispatch` for status update + surfaces in episode marker for `/plan` Phase D to triage. Single-isolation-layer rule: no recursive `/workflows` spawn — if a dispatched agent attempts to spawn `/workflows`, the inner invocation falls back to TeamCreate or sandcastle per existing precedence.

**Migration plan.** No data migration (no DB); only schema-additive changes:
- `hive.config.yaml` schema_version bump (semver minor) for additive enum + additive field_sources entries
- Existing consumers reading `execution.mode` continue to work unchanged
- New `execution.runtime` default `auto` is a no-op until Phase 5 lands per-epic-override entries; explicit `workflows` opt-in requires env or root config override
- Per-epic override is BACKWARDS-COMPATIBLE: missing cycle-state file falls through to auto gracefully

**Rollback plan.** Two-tier rollback:
- **Soft rollback:** flip `hive.config.yaml` `execution.runtime` to `multica`. All execution routes back through second-party path. Per-epic-override entries persist but become inert. Zero data loss.
- **Hard rollback:** revert this epic's PR (single PR per `feedback_git_flow_per_epic`). `execution.runtime` knob disappears; per-epic-override entries become dangling but harmless (Phase 5 cycle-state files are read-only by Phase 2's resolver; if Phase 2 reverts, the reads stop happening). `execute-mode-cc-workflows` skill removed from disk; `mode_decision` enum restored to 6 values.

**Performance implications.** Phase 2's resolver adds one cycle-state file read per `/execute` invocation when `execution.runtime == auto`. File is small (<1KB); cost is negligible. The serial-commit gate at integration-branch push layer is SLOWER than parallel-commit-per-unit (architect-acknowledged trade-off), but the serialization is required to preserve `feedback_codex_sandbox_commit_block` + `feedback_codex_parallel_race`. Performance:audit minor escalation captures first-release retrospective measurement.

**Documentation impact.** Will require updates to:
- README.md (Phase 6 — hero + Quick Start)
- CONTEXT.md (Phase 6 — Composability posture + vocab)
- `hive.config.yaml` inline comments (Phase 2 — execution.runtime + per-epic-override rule)
- `execute-dispatch/SKILL.md` field_sources documentation (Phase 2 — execution_mode + execution_runtime + epic_override)
- `execute-mode-cc-workflows/SKILL.md` (Phase 2 — NEW file)
- persona-dispatchability-under-cc-workflows.md (Phase 3)
- disposition-pass-msd.md + disposition-pass-mpt.md (Phase 4)
- Project memory files (Phase 5 — additive notes)

**Security considerations.** New attack surface: Phase 2's resolver reads from `.pHive/cycle-state/<epic-id>.yaml` — these files are inside the repo, version-controlled, no external input. cycle-state escalations block (security:plan-audit moderate raised by tpm + architect) captures the pre-exec audit on Phase 1+Phase 2 — drives the serial-commit-gate unified mechanism. No new auth surfaces, no new external API exposure, no PII or token handling changes.

---

## Part 4 — File Change Manifest

### CREATE (NEW files)

**Phase 1:**
- `.pHive/epics/cc-workflows-first-party/docs/spike-findings.md` — Phase 0 capability spike verdicts (criteria a-d), gates downstream

**Phase 2:**
- `skills/hive/skills/execute-mode-cc-workflows/SKILL.md` — atomic execute-mode skill; mirrors execute-mode-multica shape; contains workflow_assembly substep + serial-commit gate
- `hive/lib/integration-branch-contract/index.mjs` *(OPTIONAL)* — shared helper factored from `multica-story-dispatch/index.mjs:192-262` IF the refactor keeps PR under 150 files; otherwise copy-with-attribution and skip this file

**Phase 3:**
- `.pHive/epics/cc-workflows-first-party/docs/persona-dispatchability-under-cc-workflows.md` — per-persona verdict (dispatchable / collapsed / reframed) sourced from Phase 1+2 evidence

**Phase 4:**
- `.pHive/epics/cc-workflows-first-party/docs/disposition-pass-msd.md` — per-story disposition candidates for multica-substrate-deepen (19 stories)
- `.pHive/epics/cc-workflows-first-party/docs/disposition-pass-mpt.md` — per-story disposition candidates for multica-plan-test-cycles (11 stories)

**Phase 5 (conditional):**
- `.pHive/cycle-state/multica-substrate-deepen.yaml` *(NEW if absent; MODIFY if present)* — execution_runtime block per disposition
- `.pHive/cycle-state/multica-plan-test-cycles.yaml` *(NEW if absent; MODIFY if present)* — execution_runtime block per Q3 keep-as-second-party

### MODIFY (existing files)

**Phase 1:**
- `.pHive/cycle-state/cc-workflows-first-party.yaml` — append spike_outcome block; preserve gate_decisions + escalations

**Phase 2:**
- `skills/execute/SKILL.md` — add Process step 6f cc-workflows branch
- `skills/hive/skills/execute-dispatch/SKILL.md` — extend mode_decision enum; add field_sources.execution_mode + execution_runtime + execution_runtime.epic_override; add per-epic-override resolver logic
- `hive.config.yaml` — add execution.runtime knob (default auto); schema_version bump; inline-comment precedence chain + per-epic-override rule
- `hive/hive.config.yaml` — shipped baseline execution.runtime: auto; schema_version mirror

**Phase 5:**
- `.pHive/epics/multica-substrate-deepen/stories/*.yaml` — 19 files, additive disposition + disposition_rationale + disposition_source_slice fields
- `.pHive/epics/multica-plan-test-cycles/stories/*.yaml` — 11 files, same fields
- `~/.claude/projects/-Users-don-Documents-plugin-hive/memory/project_multica_substrate_adoption.md` — additive note on disposition outcomes
- `~/.claude/projects/-Users-don-Documents-plugin-hive/memory/project_multica_plan_test_cycles.md` — additive note on disposition outcomes

**Phase 6:**
- `README.md` — hero + Quick Start step 1 rewrite per Q9 (i)
- `CONTEXT.md` — Composability posture statement + vocab disambiguation (hive-workflow vs CC /workflows)

### DELETE

- None this epic. Multica is demoted, not deprecated.

### UNCHANGED (but affected)

- `hive/lib/task-tracking-dispatch/index.ts` — vendor-neutral ABI; consumed unchanged by Phase 2's new skill
- `hive/lib/multica-story-dispatch/index.mjs:192-262` — source of integration-branch contract; mirror IF shared helper extracted, else read-only reference
- `skills/hive/skills/execute-mode-multica/SKILL.md` — second-party path; unchanged
- `skills/hive/skills/execute-mode-sandcastle/SKILL.md` — second-party path; unchanged
- `skills/hive/skills/execute-mode-session/SKILL.md` — read-only reference for "replaces respawn skill" pattern
- `.pHive/epics/multica-substrate-deepen/docs/persona-dispatchability.md` — read-only reference for Phase 3 re-cut
- `.pHive/multica/skills-export.yaml` — Mode D-a export config; second-party-only, unchanged unless Phase 0 (d) FAIL activates Plan B (then this file gains first-party readers too)

### Summary counts

| Phase | NEW | MODIFY | Total |
|---|---|---|---|
| 1 | 1 | 1 | 2 |
| 2 | 1-2 | 4 | 5-6 |
| 3 | 1 | 0 | 1 |
| 4 | 2 | 0 | 2 |
| 5 | 0-2 | 32 | 32-34 |
| 6 | 0 | 2 | 2 |
| **Total** | **5-8** | **39** | **44-47** |

Well under the <150 PR file cap per `feedback_pr_file_count_limit`. Phase 5's 30 story-YAML mutations are the biggest single contributor; if combined-PR file count climbs above ~120, stack via base-branch retargeting Phase 5 onto a separate PR.

---

## Part 5 — Risk Registry

| # | Risk | Severity | Likelihood | Mitigation | Owner |
|---|---|---|---|---|---|
| 1 | `/workflows` public spec is one CHANGELOG sentence; all design claims unverified | HIGH | n/a (always present) | Phase 0 spike is non-negotiable; criteria (a)-(d) explicit verdicts; maintainer gate | Phase 1 |
| 2 | CC 2.1.157 `.claude/skills/` auto-load unverified for plugin-shipped under CLI-interactive | HIGH | MED | Phase 0 criterion (d) verifies; Plan B (first-party also uses Mode D-a) catches failure | Phase 1 → Phase 2 |
| 3 | Codex parallel race + sandbox commit-block under `/workflows` fan-out (UNIFIED grill C1+C2) | MED | MED | Architect-unified serial-commit gate: agents return file lists, adapter commits serially; Phase 0 (b) tightened pass-bar verifies | Phase 2 |
| 4 | Convention conflict: per-unit-PR (CC `/batch` style) vs per-epic-PR (hive convention) | MED | MED | Q2 conditional (a) preserves convention via shell-snippet injection IF Phase 0 (a) passes; else Plan B (b) or (c) | Phase 2 |
| 5 | Persona-classification regression — re-cut without first-hand evidence | MED | LOW | Phase 1+2 first-hand evidence required; UNVERIFIED-defer policy; `feedback_no_team_lead_intermediary` cross-check | Phase 3 |
| 6 | Fresh-merge churn from PR #234 (multica-plan-test-cycles merged 2026-05-28) | MED | n/a (already happened) | Phase 4 audit + Phase 5 per-epic-override entries; Q3 keep-as-second-party at gate 1 | Phase 4 → Phase 5 |
| 7 | Integration-principle rule 5 under parallel writers | MED | LOW | Serial-commit gate at integration-branch push preserves rule 5 (harness owns serialization) | Phase 2 |
| 8 | PR file count <150 cap exceeded by Phase 5's 30-story disposition mutations | MED | MED | Bundle into this epic's PR for single audit trail; stack via base-branch retargeting if exceeded (target: keep Phase 2 + 5 combined under 120) | Phase 5 |
| 9 | Schema_version bump on `hive.config.yaml` breaks downstream consumers | LOW | MED | `git grep schema_version skills/` before Phase 2 commit; update version-range checks; semver minor (additive) shouldn't break range-based consumers | Phase 2 |
| 10 | Per-epic-override resolver bootstrap chicken-and-egg (Phase 2 needs cycle-state files; Phase 5 writes them) | LOW | LOW | Resolver falls through gracefully when cycle-state file absent (Phase 2 unit assertion) — no hard error; safe to ship Phase 2 before Phase 5 | Phase 2 |
| 11 | Composability narrative posture | LOW | n/a | Q9 (i) maintainer-confirmed; Phase 6 README + CONTEXT.md durable placement | Phase 6 |
| 12 | Vocab drift in untouched files (hive-workflow vs CC /workflows) | LOW | MED | Phase 6 grep flags but does NOT fix; follow-on `chore/vocab-disambiguation` if drift substantial | Phase 6 |
| 13 | Project memory bulk-overwrite during Phase 5 | LOW | LOW | Additive-note discipline; Read-then-Edit per file | Phase 5 |
| 14 | Performance regression from serial-commit gate vs parallel | LOW | MED | Architect-acknowledged trade-off; performance:audit minor escalation captures first-release retrospective | Phase 2 |

### Detailed mitigation for HIGH-severity risks

**Risk 1 — `/workflows` public spec gap.** Spike is bounded (≤5 stories, one test epic). Spike-findings template forces evidence cites per criterion. Plan B branches pre-defined for each criterion failure mode. If criterion (b) fails (Codex creators can't return file lists / adapter can't serialize), pivot to rescope-memo Option C per Q7 fallback. Maintainer-gated — no pressure to "make it pass."

**Risk 2 — 2.1.157 auto-load.** Plan B is concrete: first-party path retains Mode D-a substrate bundling (`.pHive/multica/skills-export.yaml` gains first-party readers). README rewrite (Phase 6) carries the caveat. Adds ~5-10 file touches to Phase 2 if Plan B activates; no architectural pivot.

---

## Part 6 — Dependency Map

```
INTERNAL DEPENDENCIES:

Phase 1 (spike + gate)
  ↓ gates ALL downstream
Phase 2 (MVP path; depends on Phase 1 verdicts + Plan B branch selections)
  ↓ Phase 2 mechanism (resolver + per-epic-override field) is READ by Phase 5
Phase 3 (persona re-cut; depends on Phase 1+2 first-hand evidence)
Phase 4 (disposition AUDIT; depends on Phase 1 gate; PARALLEL to Phase 2+3)
  ↓ audit candidates ARE READ by Phase 5
Phase 5 (disposition APPLY; depends on Phase 4 candidates + Phase 2 mechanism + Q3 from gate 1)
  ↓ writes cycle-state files that Phase 2's resolver reads
Phase 6 (README + CONTEXT.md; depends on Phases 1-5 shipped — README reflects behavior, not aspiration)

EXTERNAL DEPENDENCIES:

CC runtime: 2.1.154+ for /workflows (GA — confirmed locally)
CC runtime: 2.1.157 for .claude/skills/ auto-load (CLI-interactive behavior for plugin-shipped — unverified; Phase 0 (d))
context7: NOT a runtime dependency for production; was a research-pass source — already exhausted on /workflows public spec

NO new external libraries. Phase 2 may extract a shared helper to hive/lib/integration-branch-contract/ but that's internal code reorganization.

BLOCKING QUESTIONS (none currently — all gate-1 questions Q1-Q9 maintainer-confirmed):

  - Phase 5 entry pre-condition: Phase 4 audit candidates exist AND Phase 2's per-epic-override resolver is live
  - Phase 6 entry pre-condition: Phases 1-5 merged so README rewrites truth, not aspiration
  - Phase 0 (a) FAIL path: Q2 branch decision (b per-unit PR vs c worktree-per-story) — surfaces at Phase 2 entry, not blocking the epic
```

---

## Part 7 — Elicitation (Stress-Testing This Plan)

This section is the team's adversarial self-critique. Each persona stress-tests its area; answers are agreed-on or escalated to user.

### 7.1 — Why Won't This Work?

#### Failure 1 — Phase 0 spike passes but with caveats not surfaced as verdict downgrades

- **Failure:** spike-findings.md records "PASS" for criterion (a) but the test actually only verified shell-snippet injection in 1 of 5 stories due to test-epic configuration drift; remaining 4 stories used CC-native defaults; PASS verdict is hollow but maintainer signs gate based on the verdict line
- **Trigger:** test epic uses mixed dispatch shapes; spike author records "PASS" without per-story breakdown
- **Impact:** Phase 2 builds on a Phase 0 verdict that doesn't actually hold; serial-commit gate works in spike but fails in production on stories the spike never tested
- **Signal:** spike-findings.md template should force per-story evidence under each criterion, not just per-criterion summary
- **Our answer (researcher):** add to Phase 1 spike-findings template — criterion (a)-(d) verdicts MUST include per-story evidence breakdown (1 row per story), with overall verdict being the AND of per-story verdicts. Hollow PASS becomes structurally impossible. Locked.

#### Failure 2 — Architect's serial-commit gate breaks under stories that need multi-commit changes

- **Failure:** the "single commit per story" invariant assumes stories ship as one logical change. Some stories (e.g., test setup + implementation + test cleanup) naturally span multiple commits. Adapter's serial gate squashes them, losing reviewability
- **Trigger:** any story whose work decomposes into 2+ atomic commits
- **Impact:** review-time UX degrades; revertability suffers; commit hygiene declines
- **Signal:** Phase 2 manual test should include a multi-step story (researcher → developer handoff) and verify the resulting commit history matches the intent
- **Our answer (architect):** the serial-commit gate is about **commit-per-story**, not commit-per-action-within-story. Adapter applies file lists as ONE commit per story-completion-event, but if `/workflows` surfaces multiple completion events per story (e.g., one per persona handoff), adapter commits each as a separate `[story-id]` commit. Phase 2 Step 3 must accept variable-length commit sequences per story. Architect acknowledges this nuance and bakes it into the Phase 2 unit assertion: commit count >= 1 per story; integration branch advances fast-forward regardless. Locked.

#### Failure 3 — Phase 5 PR file count breach forces base-branch retargeting late

- **Failure:** Phase 2 ships ~10 files; Phase 5 adds ~32 files (30 story YAMLs + 2 cycle-state); combined PR is ~42 files, well under 150. BUT a follow-on Phase 5 amendment (e.g., disposition revision) adds another wave; we approach the cap mid-review
- **Trigger:** scope creep on Phase 5 (e.g., maintainer requests more granular disposition rationale per story → 60-line additions × 30 stories)
- **Impact:** mid-review PR retarget is disruptive; CodeRabbit review state may reset; review history fragmented
- **Signal:** TPM should monitor PR file count proactively; stack pre-emptively at 100 files, not at 150
- **Our answer (TPM):** Phase 5 entry includes a pre-flight `gh pr diff --name-only | wc -l` check against the in-flight epic PR; if >100, stack via base-branch retargeting BEFORE Phase 5 commits land. This is the proactive guard. Locked.

#### Failure 4 — `auto` heuristic + per-epic-override interaction surprises consumers

- **Failure:** a consumer (or future epic) reads `execution.runtime: auto` in `hive.config.yaml` and expects `cc-workflows` routing; in practice the per-epic-override mechanism quietly routes their epic to `multica` because a cycle-state file says so; they debug for hours
- **Trigger:** cycle-state files outlive the epic they were written for; or get inherited from forks
- **Impact:** dispatching-runtime surprise; broken expectation; debugging time
- **Signal:** field_sources.execution_runtime.epic_override traceability surfaces the path; but only on careful inspection
- **Our answer (architect):** epic_override traceability is the answer — it's already in the design. Strengthen by adding a one-line log at `execute-dispatch` resolver: "execution.runtime resolved to {mode} ({source})" where source is `env | root | baseline | skill | default | auto+epic_override:<path>`. Log lands in episode marker for forensic recovery. Phase 2 implementation note. Locked.

#### Failure 5 — Phase 6 README rewrite ships positioning before downstream skills/agents pick up the new vocab

- **Failure:** Phase 6 commits CONTEXT.md vocab "hive-workflow vs CC /workflows" but downstream skill files / agent files in this epic (or other in-flight branches) still use the bare word "workflow" ambiguously; vocab discipline starts inconsistent
- **Trigger:** vocab is durable for THIS epic; not yet enforced repo-wide
- **Impact:** new readers / agents see contradictory usage; vocab discipline degrades
- **Signal:** Phase 6 vocab grep on untouched files (currently flagged as out-of-scope flag-don't-fix)
- **Our answer (writer):** accepted as known limitation per design-discussion §10 grill C3 reasoning extension. Phase 6 grep produces a follow-on epic candidate (`chore/vocab-disambiguation`) if drift is substantial; do NOT fix in this epic. Vocab discipline takes time to propagate; durable placement in CONTEXT.md is the seed. Locked as accepted scope.

### 7.2 — What Assumptions Are We Making?

- **VERIFIED — CC 2.1.154 ships `/workflows`.** Source: `/anthropics/claude-code` CHANGELOG entry, confirmed locally. Research brief §2 §risk-1 acknowledges the spec gap but presence is verified.
- **VERIFIED — `task-tracking-dispatch/index.ts` is vendor-neutral.** Source: research brief §3 + direct code read at `hive/lib/task-tracking-dispatch/index.ts:1-100`. No fork needed.
- **VERIFIED — `mode_decision` enum extension is additive.** Source: research brief §3 + `execute-dispatch/SKILL.md` field_sources mechanism. Existing modes don't regress.
- **VERIFIED — Maintainer gate-1 answers Q1-Q9.** Source: cycle-state gate_decisions block. All recommendations confirmed; Q5 descoped; posture (i) confirmed.
- **VERIFIED — Per-epic-PR + per-story-commit convention.** Source: `feedback_git_flow_per_epic` memory + `multica-story-dispatch/index.mjs:192-262`. First-party adapter mirrors via serial-commit gate.
- **VERIFIED — Architect's serial-commit gate unifies grill C1+C2.** Source: architect-v2 review delivered at design-discussion v2 §0 prelude. Unified mechanism replaces per-runtime fan-out cap; cleaner invariant.
- **ASSUMED — `/workflows` accepts free-form prompt injection.** Source: nearest analog `/batch` documented at `/websites/code_claude`; Multica's shell-snippet injection works because Multica passes to a Claude Code session inside a task. If `/workflows` is structured workflow YAML rather than free-form, criterion (a) FAIL → Plan B (b/c). Reasonable to proceed because the fallback paths are pre-defined.
- **ASSUMED — Phase 0 spike runs on a real existing tiny epic.** Source: design-discussion §3. If no existing epic fits ≤5-story bound, a synthetic one is acceptable; finding a real one is preferable for evidence quality.
- **RISKY — CC 2.1.157 `.claude/skills/` auto-load works for plugin-shipped under CLI-interactive.** Source: 2.1.157 changelog refers to consumer-side `.claude/skills/` only; SDK auto-load confirmed; CLI-interactive plugin-marketplace path NOT confirmed. If risky-wrong: Plan B in Phase 2 (first-party also uses Mode D-a); ~5-10 file delta; narrative simplification collapses.
- **RISKY — Codex creators can return file lists under `/workflows` fan-out.** Source: `feedback_codex_sandbox_commit_block` + `feedback_codex_parallel_race`; the mechanism works in current Multica dispatch. If risky-wrong (Codex requires direct .git writes that conflict under fan-out): pivot to rescope-memo Option C per Q7 fallback; Slices 2-5 reshape.
- **RISKY — `/workflows` honors a custom integrationBranch instruction in agent prompts.** Source: research brief §6 Q5 (now Q3 after Q5 descope renumbering — wait, Q5 was tombstoned not renumbered; correct ref: research brief Q5). If `/workflows` imposes its own per-unit-PR branch model and rejects integrationBranch coercion: criterion (a) FAIL → Plan B (b) per-unit PR (bend convention) or (c) worktree-per-story isolation + serialized merge.

### 7.3 — What's the Simplest Version?

**Must have (defines "done"):**
- Phase 0 spike with verdicts (a)-(d) — without this, deep build is irresponsible per `feedback_test_offtheshelf_before_rewriting`
- Phase 2 MVP path (adapter skill + config knob + serial-commit gate) — without this, first-party doesn't exist
- Phase 5 per-epic-override entries — without this, `auto` heuristic silently routes mpt away from Multica (Q3 invariant)
- Phase 6 README + CONTEXT.md — without this, the canonical North Star contradicts shipped behavior

**Should have (improves quality):**
- Phase 3 persona re-classification — without this, downstream skill authors guess persona-vs-workflow-YAML boundary; grill P1 risk re-opens
- Phase 4 disposition audit before apply — without this, Phase 5 is a "trust me" mass mutation; spot-check + audit trail makes review survivable

**Could cut (would lose value but not capability):**
- Phase 2 shared helper extraction (`hive/lib/integration-branch-contract/`) — copy-with-attribution path also works; refactor cost-vs-DRY trade-off
- Phase 3 detailed evidence per persona — could ship with "best-effort verdict per persona, mark UNVERIFIED for any without first-hand evidence"; loses some completeness
- Phase 6 vocab grep on untouched files — already accepted as out-of-scope flag-don't-fix; lowest cost to defer

**Cannot cut:**
- Phase 0 spike (load-bearing per `feedback_test_offtheshelf_before_rewriting`)
- Per-epic-override mechanism (architect Q2 + TPM U3 unified rule; Q3 invariant)
- Serial-commit gate (architect C1+C2 unified)

### 7.4 — What Will We Wish We Had Thought Of?

- **Technical debt knowingly taken:** Phase 2's serial-commit gate is slower than parallel-commit-per-unit. Trade-off acceptable because `feedback_codex_sandbox_commit_block` + `feedback_codex_parallel_race` are load-bearing safety constraints. performance:audit minor escalation captures first-release retrospective measurement to revisit.
- **Edge cases deferred:**
  - Phase 0 (d) FAIL → Plan B retains Mode D-a on first-party; collapses simplification narrative but doesn't lose capability. Safe to defer fix-the-changelog discovery.
  - Multi-commit-per-story (failure 2 above) — accepted as nuance baked into Phase 2 Step 3.
  - Vocab drift in untouched files — deferred to follow-on epic if Phase 6 grep flags substantial drift.
- **Integration points not fully validated:**
  - `/workflows` ↔ `task-tracking-dispatch` ABI — adapter calls existing ABI in Step 5 but hasn't been spike-tested under `/workflows` fan-out. Mitigation: Phase 0 criterion (c) "completion signal recoverable" implicitly tests this; explicit add a sub-bullet "verify Step 5 summary return invokes task-tracking-dispatch successfully."
  - `/workflows` ↔ `feedback_use_roster_agents` — does `/workflows` accept persona file references, or does it require inline agent definitions? Phase 1 spike should probe.
- **User workflows not considered:**
  - Maintainer overrides `auto` mid-epic (e.g., sets `execution.runtime: multica` for one story only) — current design supports env override per `/execute` invocation; document in Phase 6 README.
  - Cross-system consumer that doesn't have a `.pHive/cycle-state/<epic-id>.yaml` because they don't use cycle-state — resolver fall-through-to-auto handles; verified in Phase 2 unit assertion.

### 7.5 — Where Are We Over-Engineering?

- **`field_sources.execution_runtime.epic_override` path traceability.** Adds traceability field; only consumer is forensic debugging + future routing analysis. Honest evaluation: keep — architect explicitly tightened Q2 for this, and the cost is one field write per resolve. Cheap.
- **Shared helper at `hive/lib/integration-branch-contract/`.** Architecturally clean but adds a new module. Honest evaluation: OPTIONAL per Phase 2 manifest — decision at implementation time based on file-count budget. If PR fits without it, defer to a `chore/integration-branch-contract-shared` follow-on epic.
- **Per-story `disposition_source_slice` field.** Provenance is nice; one more field per story YAML. Honest evaluation: keep — audit trail value is real, and it's one line.
- **Phase 6 vocab-grep on untouched files.** Already flagged as out-of-scope flag-don't-fix. Honest evaluation: keep the grep as a discovery step; don't act on findings unless substantial.

### 7.6 — Stress-test routing by stress-tester

| Stress-tester | Mechanism stress-tested | Failure surfaced | Resolution |
|---|---|---|---|
| Researcher | Phase 0 spike completeness | Hollow PASS without per-story evidence | per-story breakdown forced in spike-findings template |
| Architect | Serial-commit gate handling of multi-commit-per-story | Squashes multi-step stories | adapter accepts variable-length commit sequence; commit count >= 1 invariant |
| Architect | Q2 epic_override traceability | Silent surprise routing | one-line log at resolver "execution.runtime resolved to {mode} ({source})" |
| TPM | Phase 5a/5b coupling + PR file count | Late retarget breach | proactive `gh pr diff --name-only \| wc -l` pre-flight at >100 |
| TPM | Cross-epic disposition commits in single PR | Mass mutation review survivability | Phase 4 audit produces 1:1 diff-against; Phase 5 commits reference candidate file |
| Writer | Phase 6 README rewrite scope | Vocab discipline lag | grep on untouched files → follow-on chore epic; don't fix in this epic |

---

## Part 8 — Decision Points for Sign-Off

These are NEW decision items that emerged DURING structured-outlining — distinct from the locked Open Questions Q1-Q9 (those are gate-1 confirmed; not re-opened here).

```
DECISIONS REQUIRING SIGN-OFF (numbered for user response):

1. [SCOPE — shared helper extraction] 
   Phase 2 manifest lists `hive/lib/integration-branch-contract/index.mjs` as OPTIONAL.
   Option A: extract during Phase 2 (cleaner architecture; +1 NEW file; potential <150 cap impact if other slices grow)
   Option B: copy-with-attribution during Phase 2; defer extraction to follow-on `chore/integration-branch-contract-shared` epic
   Writer recommendation: Option B for first release — keeps Phase 2 PR file count lean; refactor is reversible and follow-on is small-scope.
   → Affirm B / Change to A / Defer decision to implementation discretion

2. [VERIFICATION — Phase 0 spike-findings template forced per-story evidence breakdown]
   Risk Registry #1 mitigation + Elicitation 7.1 Failure 1 propose forcing per-story evidence under each criterion (a)-(d), not just per-criterion summary, to prevent hollow PASS verdicts.
   Adds ~50% to spike-findings.md length but structurally eliminates the hollow-PASS failure mode.
   Writer recommendation: include forced per-story breakdown.
   → Affirm / Skip (accept hollow-PASS risk) / Compromise: forced per-story breakdown ONLY for criteria (a) and (b)

3. [SCOPE — Phase 6 vocab-grep follow-on]
   Phase 6 runs vocab grep on UNTOUCHED files; current plan flags drift but does NOT fix.
   Option A: ship Phase 6 as designed; follow-on `chore/vocab-disambiguation` epic if grep flags drift
   Option B: include vocab fixes in Phase 6 only if affected files are < ~10 (keeps scope creep bounded)
   Writer recommendation: Option A — discipline of "flag don't fix" preserves epic scope.
   → Affirm A / Change to B / Other

4. [RISK ACCEPTANCE — serial-commit gate performance trade-off]
   Phase 2's serial-commit gate is SLOWER than parallel-commit-per-unit (architect-acknowledged). performance:audit minor escalation captures retrospective measurement. No active mitigation this epic.
   → Accept (per Risk Registry #14 + architect ruling) / Require active mitigation (e.g. batch-commit optimization)

5. [SCOPE — Phase 5 project memory updates]
   Phase 5 updates `project_multica_substrate_adoption.md` + `project_multica_plan_test_cycles.md` with additive notes on disposition outcomes.
   These are technical-writer-author-direct project memories; updating them from this epic is correct, but it's also a cross-cutting touch on ~/.claude/projects/ memory tree.
   → Affirm additive-only updates in Phase 5 / Defer memory updates to a separate slice / Require maintainer review of each update before merge

6. [SCOPE — Phase 0 spike test-epic selection]
   Phase 0 spike runs against a real existing tiny epic OR a synthetic one. No specific test-epic identified yet; spike author chooses.
   Writer recommendation: prefer a real existing tiny epic for evidence quality. If none fits ≤5-story bound, synthetic is acceptable.
   → Affirm / Specify a particular epic (e.g. "use existing `chore/X` epic as spike substrate") / Other
```

---

_End of structured outline. Phase C of /plan consumes this for mechanical story decomposition. Decision points 1-6 surface at user gate 3 (incoming after this); Open Questions Q1-Q9 are locked at gate 1 and NOT re-opened here._
