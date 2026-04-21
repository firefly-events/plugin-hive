---
title: Vertical Plan — Meta-Improvement System
epic: meta-improvement-system
phase: B2 (H/V planning)
author: tpm (claude-backed)
date: 2026-04-19
revision: 1
review_summary:
  - architect: approve-with-escalation (NEW Q1→Option A, NEW Q2→Option B, Slice 9 rollback-realism verification requirement)
  - researcher: flagged (Stop hook slot conflict w/ in-flight interrupt-sentinel work; meta-team.yaml existence — verified false alarm)
  - writer: flagged (missing explicit WHAT WORKS per slice; MVS vs MVL ambiguity)
inputs:
  - docs/horizontal-plan.md
  - docs/user-decisions-dd.md (authoritative)
  - docs/design-discussion.md
  - docs/architect-memo.md
  - docs/architect-hv-review.md
  - docs/tpm-sequencing-memo.md
---

# Vertical Plan: Meta-Improvement System

Slice plan overlaid on the horizontal layer map. Each slice leaves the system in a coherent, inspectable state (pragmatic working-state reading — this is a control-plane/infra epic, not a runtime-behavior epic). Stories WITHIN a slice can parallelize; slices execute sequentially to honor the stop-ship invariant.

## 1. Slicing Strategy

10 slices across ~45 horizontal items. Rationale: subsystem-seam + risk-class hybrid. Shape = 1 (B0) + 2 (C: C1, C2) + 2 (A: A1, A2) + 3 (B: L1, L2, L3) + 2 micro-slices (kickoff-opt-in, meta-backlog folded into B-L2 intro).

Risk-class split on Epic B: shared-library (LOW) → meta-meta (MED, self-modifying) → meta-optimize (MED, user-facing, ships). Subsystem-seam split on Epic C: schema+storage (LOW) separate from emission hooks (MED, many touch points). Kickoff opt-in gets its own slice (user-visible, crosses epic boundary) rather than folding into C.

Sequence honored: `B0 → (C ∥ A) → B-L1 → B-L2 (local, no-op first) → B-L3 (shipped)`. Stop-ship test per slice (pragmatic reading — infra/config epic).

## 2. Vertical Slice Plan

---

### Slice 1: B0 — Consumer Contract Sliver

GOAL: Define what questions Epic B will ask of Epic C's data, so Epic C schema freezes against real query shapes.

STORIES (2-3):
  - B0.1: Draft experiment envelope schema outline (fields, not syntax spec)
  - B0.2: Draft query shape document (baseline/candidate/delta queries; what's cheap, what's expensive)
  - B0.3: Threshold/rollback policy-ref shape (lean per Q3 — single threshold knob + auto-revert)

LAYERS TOUCHED:
  L8 (interface contract, documented only — no code yet)
  L3 (implied schema — documented only)
  `.pHive/epics/meta-improvement-system/docs/b0-consumer-contract.md` (new doc)

WHAT WORKS AFTER THIS STEP:
  - `b0-consumer-contract.md` exists and is readable as a design document
  - Envelope field list is enumerated with type and purpose for every field
  - Query shape doc describes three named queries (baseline-vs-candidate, run-over-run, delayed-regression-watch) with cost classification
  - Threshold + rollback policy ref shape documented as a single-knob + auto-revert contract (Q3 lean)
  - Architect can read the doc in isolation and assess whether C1's schema will answer every B-layer question

NOT YET: No code, config, hooks, or metric writes.
VERIFIED BY: Architect review of the doc; TPM check that every Q3-required envelope field has a query that consumes it.
COMMIT: "docs(meta-improvement): B0 consumer contract for metrics and experiments"
STOP-SHIP: Coherent — document lands; nothing referenced is broken.
DEPENDENCIES: None (first slice).

---

### Slice 2: C1 — Metrics Substrate (Schema + Storage Primitives)

GOAL: `.pHive/metrics/` exists with schemas and inert writer/reader primitives. Nothing emits yet.

STORIES (3-4):
  - C1.1: Create `.pHive/metrics/` directory + README.md with schema conventions
  - C1.2: Write `metrics-event.schema.md` (JSONL event schema per architect §2 rec 3)
  - C1.3: Write `experiment-envelope.schema.md` (Q3-affirmed fields, lean)
  - C1.4: Implement writer + reader primitives (append-only JSONL writer; envelope YAML writer; baseline-snapshot + delta-compare readers). Primitives are inert — no caller invokes them yet.

LAYERS TOUCHED:
  L3 (new substrate)

WHAT WORKS AFTER THIS STEP:
  - `.pHive/metrics/events/` and `.pHive/metrics/experiments/` directories exist with README.md
  - Event JSONL schema doc validates against example records
  - Experiment envelope schema doc validates against example envelope
  - Writer primitive can append a valid event; reader primitive can load a range of events for a run_id
  - Envelope writer can write a new experiment; update-in-place allowed for decision + rollback fields only
  - Delta-compare primitive produces a structured diff over two baseline snapshots on fixture data

NOT YET: No hook writes; no library consumption; config flag not added yet; primitives callable but no callers.
VERIFIED BY: Schema docs validate; round-trip unit test; primitive contract test (no side effects outside `.pHive/metrics/`).
COMMIT: "feat(metrics): metrics substrate with dual-schema carrier (inert)"
STOP-SHIP: Coherent — substrate exists, no writers, callable no-ops.
DEPENDENCIES: S1.

---

### Slice 3: A1 — Historical Archive + Authority Reset

GOAL: Old meta-team state archived with manifest; old charter/sandbox refs demoted or replaced. No new control plane yet; new swarm skills not built. System has no active meta-team cycle at end of slice, but nothing is broken because the old cycle's contradictions are no longer pretending to work.

STORIES (3-4):
  - A1.1: Archive `.pHive/meta-team/cycle-state.yaml` + `ledger.yaml` under `.pHive/meta-team/archive/2026-04-19/` with MANIFEST.md (includes `commit: TBD` audit note per Codex §3.6)
  - A1.2: Extract safety constraints to `hive/references/meta-safety-constraints.md` (shared by forthcoming charters)
  - A1.3: Demote `hive/references/meta-team-nightly-cycle.md` (add historical/operator-narrative header; do NOT delete yet)
  - A1.4: Replace `hive/references/meta-team-sandbox.md` with `hive/references/meta-experiment-isolation.md` (worktree-centric per Q4)
  - A1.5: Zero out active `cycle-state.yaml` + `ledger.yaml` + `queue.yaml` (or delete; new versions written in A2)
  - (Optional) A1.6: Audit memo for status of 5-cycle history per NEW QUESTION 5 in horizontal-plan — only if user decides it's worth a story

LAYERS TOUCHED:
  L7 (charters + refs + state archive)

WHAT WORKS AFTER THIS STEP:
  - `.pHive/meta-team/archive/2026-04-19/` contains former cycle-state.yaml, ledger.yaml, queue.yaml with MANIFEST.md
  - Active `cycle-state.yaml` + `ledger.yaml` + `queue.yaml` are either empty or absent (no stale inconsistent state)
  - `hive/references/meta-safety-constraints.md` exists and extracts the reusable safety text from the old charter
  - `hive/references/meta-team-nightly-cycle.md` has a historical/operator-narrative header; is no longer authoritative
  - `hive/references/meta-experiment-isolation.md` replaces `meta-team-sandbox.md`; all cross-refs redirected
  - Operator reading `.pHive/meta-team/` sees a clean transition: archive + empty active tree + manifest; no half-wired state
  - No user-facing regression: nothing consumed the old meta-team cycle as a hard dependency

NOT YET: New charters/steps/teams (S4); swarm skills (S8–S10).
VERIFIED BY: Archive+manifest present; demoted docs carry headers; sandbox-ref grep shows zero live cross-links.
COMMIT: "refactor(meta-team): archive historical state and reset authority surface"
STOP-SHIP: Coherent — old contradictions offline, new plane not yet live, operator sees clean transition.
DEPENDENCIES: S1. Parallel to S2.

---

### Slice 4: A2 — Control-Plane Rewrite (Step Files + Teams + New Charters)

GOAL: Meta-team workflow has coherent step authority, team grants match obligations, two charters exist (one per swarm), closure invariant is enforced. Cycle is NOT yet runnable end-to-end because the swarm skills don't exist yet, but the control plane they will orchestrate is internally consistent.

STORIES (5-7):
  - A2.1: Rewrite `step-04-implementation.md` (authority aligned; remove cross-role write violations)
  - A2.2: Rewrite `step-05-testing.md` (resolve read-only-vs-write contradiction via orchestrator-mediated writes)
  - A2.3: Rewrite `step-06-evaluation.md` (reviewer writes aligned to grants)
  - A2.4: Rewrite `step-07-promotion.md` (clean revert on fail — worktree-native or delete-on-fail; matches Q4)
  - A2.5: Rewrite `step-08-close.md` + implement closure validator (Q3 closure invariant — non-bypassable gate)
  - A2.6: Rewrite `.pHive/teams/meta-team.yaml` → split into `.pHive/teams/meta-optimize.yaml` + `.pHive/teams/meta-meta-optimize.yaml`; align grants
  - A2.7: Write `.pHive/meta-team/charter-meta-optimize.md` + `charter-meta-meta-optimize.md` (reuse shared-safety-constraints from A1.2)
  - A2.8: Audit: every step-obligation path → team-grant (closure property test)

LAYERS TOUCHED:
  L5 (workflow + step files)
  L6 (team permission files)
  L7 (new charters)

WHAT WORKS AFTER THIS STEP:
  - Six rewritten step files (04, 05, 06, 07, 08, plus workflow yaml) land with internally consistent authority model
  - `.pHive/teams/meta-optimize.yaml` + `.pHive/teams/meta-meta-optimize.yaml` exist with grants matching step obligations
  - `charter-meta-optimize.md` + `charter-meta-meta-optimize.md` exist, both importing shared `meta-safety-constraints.md`
  - Closure property test passes: every path a step writes is covered by the corresponding team's grant
  - Step-05 no longer contains self-contradictory read-only + append instructions
  - Step-07 revert path is unambiguous (worktree-discard or delete-on-fail)
  - Step-08 closure validator rejects any cycle close lacking commit hash, metrics snapshot, or rollback target
  - Charters are swarm-specific; neither inherits single-swarm assumptions

NOT YET: No skill invokes the workflow; L4 hooks, L8 library, L11 backlogs all still blocked.
VERIFIED BY: Closure property test (step writes ⊆ team grants); step-05 contradiction gone; step-07 revert path unambiguous; step-08 rejects incomplete closes.
COMMIT: "refactor(meta-team): coherent control plane with aligned authority and closure invariant"
STOP-SHIP: Coherent — self-consistent spec, no runtime behavior change; closure property holds and inspectable.
DEPENDENCIES: S3. Parallel to S5.

---

### Slice 5: C2 — Event Emission Hooks (5 MVP Metrics, Opt-In)

GOAL: All 5 MVP hooks exist and are live. They emit to `.pHive/metrics/events/` when `metrics.enabled == true`, and are inert no-ops when false. Default is false, so the system-wide default state is no emission.

STORIES (4-6):
  - C2.1: Add `metrics.enabled: bool` + `metrics.dir: string` to `hive/hive.config.yaml` (default false / `.pHive/metrics`)
  - C2.2: Stop hook: emit story-end wall-clock + token totals (metric #1, #2)
  - C2.3: PostToolUse on Task tool: emit per-agent tokens if SDK surfaces them, else fallback transcript-parse (metric #1 refinement)
  - C2.4: Agent-spawn skill step 8 report: emit spawn-scoped metrics
  - C2.5: Execute skill phase boundaries: emit fix-loop iteration count + first-attempt review-pass flag (metrics #3, #4)
  - C2.6: Orchestrator escalation path: emit human-escalation event (metric #5)
  - C2.7: Token-capture feasibility spike (may land as a separate story if SDK path is uncertain; result can demote metric #1 to follow-on)

LAYERS TOUCHED:
  L1 (config additions)
  L4 (all hook sites)

**SLOT CONFLICT NOTE (researcher flag):** C2.2 assumes Stop-hook availability. An in-flight interrupt-sentinel Stop hook already claims the slot. Structured-outline phase (B3) decides between combined handler (dispatch both) or separate mechanism (PostToolUse session-end marker, or SessionEnd hook). Not an H/V-phase blocker; recorded in horizontal-plan PUNT LIST.

WHAT WORKS AFTER THIS STEP:
  - `hive/hive.config.yaml` contains `metrics.enabled: false` (default) and `metrics.dir: .pHive/metrics`
  - With flag false: workflow runs produce zero `.pHive/metrics/events/*.jsonl` writes
  - With flag true: a workflow run produces events for all 5 MVP metrics (tokens, wall-clock, fix-loop iterations, first-attempt pass flag, human escalation)
  - Event records validate against C1 schema (every field present, no schema drift)
  - No regressions in existing Stop-hook consumers (interrupt sentinel behavior preserved; B3 decides final integration shape)
  - Graceful degrade: hook code does not throw when metrics substrate is missing

NOT YET: No kickoff UX (S6); no library consumes events (S7); no swarm runs against data.
VERIFIED BY: Flag-off → zero `.pHive/metrics/events/` writes; flag-on → 5 metric types in JSONL; records validate; graceful degrade when substrate missing.
COMMIT: "feat(metrics): conditional event emission for 5 MVP metrics"
STOP-SHIP: Coherent — opt-in honored, no surprise writes, JSONL inspectable.
DEPENDENCIES: S2. Parallel to S4.

---

### Slice 6: Kickoff Opt-In Integration

GOAL: Fresh `/hive:kickoff` and brownfield re-kickoff runs surface the metrics opt-in question and write the answer to config. End users have a clear, informed choice.

STORIES (2-3):
  - K.1: Add elicitation question to `skills/kickoff/` — "Enable metrics tracking? [explanation]" with default-no path and default-yes path
  - K.2: Brownfield preservation — re-kickoff reads existing `metrics.enabled` and offers to change (not reset)
  - K.3: Kickoff docs update — explain meta-team implications of disabling (backlog-fallback mode only)

LAYERS TOUCHED:
  L2 (kickoff skill)
  L1 (written to, not modified — already has field from C2.1)

WHAT WORKS AFTER THIS STEP:
  - `/hive:kickoff` on fresh workspace surfaces a clear opt-in question with trade-off explanation
  - User's answer persists to `hive/hive.config.yaml` under `metrics.enabled`
  - Brownfield re-kickoff reads existing value and offers to change without resetting
  - Kickoff docs explain that opting out means meta-team runs in backlog-fallback mode only (no metric-driven experiments)
  - Downstream Slice 5 hooks respect the answer immediately — end-to-end opt-in flow is live

NOT YET: No meta-team skill to experience the difference (S8, S9).
VERIFIED BY: Fresh `/hive:kickoff` → question → config written; brownfield re-kickoff preserves prior value; doc text matches Q-new-B intent.
COMMIT: "feat(kickoff): metrics opt-in elicitation question"
STOP-SHIP: Coherent — opt-in meaningful immediately via S5 hooks.
DEPENDENCIES: S5. Parallel to S7.

---

### Slice 7: B-L1 — Shared Lifecycle Library

GOAL: Experiment lifecycle primitives exist as a reusable module. Callable by L9 and L10. Not wired to any skill yet.

STORIES (4-5):
  - L1.1: Module scaffold at **`hive/lib/meta-experiment/`** (architect NEW Q1 → Option A: non-skill shared runtime library; NOT a `SKILL.md`)
  - L1.2: Envelope loader/writer (reads/writes C1.3 schema)
  - L1.3: Baseline-capture primitive (calls C1 reader, persists snapshot ref into envelope)
  - L1.4: Delta-compare primitive (two snapshots → decision)
  - L1.5: Promotion adapter INTERFACE (abstract — no concrete implementation yet)
  - L1.6: Rollback-watch primitive + auto-revert trigger (Q3 — single behavior)
  - L1.7: Closure validator (gate before ledger append — commit + metrics snapshot + rollback target)

LAYERS TOUCHED:
  L8 (new module at `hive/lib/meta-experiment/`)

WHAT WORKS AFTER THIS STEP:
  - `hive/lib/meta-experiment/` module directory exists with envelope, baseline, compare, adapter-interface, rollback-watch, closure-validator modules
  - Unit tests pass: envelope round-trip (write → read → fields intact); baseline→compare→decision against fixtures
  - Closure validator rejects incomplete envelopes at three distinct failure modes (missing commit, missing metrics snapshot, missing rollback_ref)
  - Rollback watch fires auto-revert callback on fixture regression (Q3 unconditional behavior)
  - No skill consumes the library yet — it's inert from runtime's perspective
  - Library importable from any future skill or hook; nothing shipped yet

NOT YET: No concrete promotion adapter (S9, S10); no skill imports library yet.
VERIFIED BY: Envelope round-trip unit test; closure validator rejects 3 distinct incomplete-envelope failure modes; rollback-watch fires auto-revert on fixture regression.
COMMIT: "feat(meta-experiment): shared experiment lifecycle library"
STOP-SHIP: Coherent — library lands, nothing imports; inert from runtime perspective.
DEPENDENCIES: S2. Parallel to S6. L1.3 baseline-capture integration tests gate on S5 (real events); L1.1/.2/.5/.7 only need S2.

---

### Slice 8: B-L2 Intro — Meta-Backlog + /meta-meta-optimize Scaffold

GOAL: `/meta-meta-optimize` skill exists (LOCAL, not in plugin.json). Meta-backlog YAML exists with schema. First run target defined: a no-op proving experiment (Q7 affirm). Skill doesn't execute real experiments yet — just scaffolds and loads the backlog.

STORIES (3-4):
  - BL2i.1: Write `queue-meta-meta-optimize.yaml` schema + seed with 2-3 trivial candidate experiments (e.g., "rename a comment in a test file")
  - BL2i.2: Write `queue-meta-optimize.yaml` schema + template (seeded empty for consumer projects)
  - BL2i.3: Scaffold **`maintainer-skills/meta-meta-optimize/SKILL.md`** (architect NEW Q2 → Option B: skill-shaped but OUTSIDE shipped `./skills/` root; structural bundling prevention). NOT registered in `.claude-plugin/plugin.json`.
  - BL2i.4: Implement step-03b-backlog-fallback logic in the skill (reads backlog when metric-driven mode can't propose)
  - BL2i.5: Regression test asserting `plugin.json` does NOT reference `maintainer-skills/` (architect review note)

LAYERS TOUCHED:
  L9 (scaffold at `maintainer-skills/meta-meta-optimize/`)
  L11 (new backlog files)

WHAT WORKS AFTER THIS STEP:
  - `maintainer-skills/meta-meta-optimize/SKILL.md` scaffold exists, skill-shaped but outside shipped skill root
  - `.pHive/meta-team/queue-meta-meta-optimize.yaml` exists with 2-3 seeded trivial candidates (rename-a-comment tier)
  - `.pHive/meta-team/queue-meta-optimize.yaml` template exists (empty, for consumer projects)
  - Skill invocation loads backlog and logs "no metric signal; would use backlog" without any side effects
  - Skill imports `hive/lib/meta-experiment/` correctly — library reuse path validated
  - Regression test passes: `.claude-plugin/plugin.json` does NOT reference `maintainer-skills/` (structural accidental-bundling prevention)
  - Shipped plugin install still exposes zero new user surface

NOT YET: No real experiment execution (S9); skill invocable but doesn't orchestrate workflow yet.
VERIFIED BY: Backlog YAML validates; skill invocation logs no-metric-signal dry-run; plugin.json does NOT reference `maintainer-skills/` (regression test); structural bundling prevention proven.
COMMIT: "feat(meta-meta-optimize): skill scaffold at maintainer-skills/ + meta-backlog"
STOP-SHIP: Coherent — scaffold exists, no destructive capability, shipped plugin unaffected.
DEPENDENCIES: S4, S7.

---

### Slice 9: B-L2 Cycle — First End-to-End /meta-meta-optimize Run

GOAL: `/meta-meta-optimize` runs ONE complete cycle against a trivial no-op target from the backlog, in a worktree, with full closure invariant satisfied, metrics emitted, and rollback-watch active. Plugin-hive maintainers can invoke locally and verify the entire lifecycle works before any real self-modification is attempted.

STORIES (3-5):
  - BL2.1: Implement direct-commit promotion adapter for meta-meta swarm (internal repo; commit-based)
  - BL2.2: Wire skill to orchestrate A2 workflow steps against trivial backlog candidate (worktree isolation — Q4)
  - BL2.3: Integrate baseline capture (step-01), metric emission during run, delta compare (step-06), closure validator (step-08)
  - BL2.4: Rollback watch activation on real committed experiment (observation window)
  - BL2.5: First live cycle execution + verification doc — trivial rename/comment-tweak target from seeded backlog
  - BL2.6: **Rollback-realism proof (architect requirement):** execute a REAL committed experiment, then trigger a REAL revert during the observation window. Not a mocked callback — an actual commit-then-revert sequence proving the revert path exists end-to-end. This is the MVL gate.

LAYERS TOUCHED:
  L5 + L6 + L7 + L8 + L9 — full integration point
  L3 + L4 (consumed, not modified)

WHAT WORKS AFTER THIS STEP (MVL — see §4):
  - `/meta-meta-optimize` runs one complete cycle against a trivial backlog target, in a worktree (Q4)
  - Ledger entry has `status: closed` AND real `commit: <sha>` AND `metrics_snapshot_ref` AND `rollback_ref`
  - Closure validator blocks fabricated `commit: TBD` records (Codex §3.6 regression-proof)
  - Real commit-then-revert sequence executes during observation window (not mocked); auto-revert (Q3) fires on regression
  - Failure mode: worktree-discard clean; main tree shows no partial promotion
  - Metrics + envelope complete after run; plugin-hive maintainers have a working loop; shipped plugin untouched

NOT YET: /meta-optimize (S10); parallel mode (Q2 defers); long-tail metrics (Q8).
VERIFIED BY: Full closure (closed + real commit hash + metrics snapshot + rollback_ref); fabricated `commit: TBD` rejected (Codex §3.6 regression); real commit-then-revert executes during observation window (not mocked); worktree discard clean on fail.
COMMIT: "feat(meta-meta-optimize): first end-to-end cycle with worktree isolation, closure gates, and proven rollback"
STOP-SHIP: Coherent and **MVL reached** — plugin-hive maintainers have a working self-improvement loop. Shipped plugin unchanged.
DEPENDENCIES: S4, S5, S7, S8.

---

### Slice 10: B-L3 — /meta-optimize Ships

GOAL: `/meta-optimize` skill exists, is registered in `.claude-plugin/plugin.json`, executes an end-to-end cycle against a user project target, promotes via PR-only adapter (Q5), and produces an inspectable PR artifact. End users have the full public meta-improvement capability.

STORIES (4-6):
  - BL3.1: Scaffold `skills/hive/skills/meta-optimize/SKILL.md` + register in `.claude-plugin/plugin.json`
  - BL3.2: Implement PR-artifact promotion adapter (target-repo `gh pr create` or equivalent)
  - BL3.3: Wire skill to orchestrate A2 workflow against user-project target (target-repo worktree)
  - BL3.4: Metric registry tolerates consumer-supplied unknown dimensions (architect §4)
  - BL3.5: Backlog-fallback mode integration (consumer-populated `queue-meta-optimize.yaml`)
  - BL3.6: First end-to-end cycle against a fixture user-project (plugin-hive itself can serve as the test target via a second worktree, OR a prepared fixture repo)
  - BL3.7: User-facing docs (README section, examples, opt-in flow from kickoff)

LAYERS TOUCHED:
  L10 (new shipped skill)
  L1 (plugin.json registration — effectively config)
  L11 (consumer-backlog template lands)

WHAT WORKS AFTER THIS STEP (MVS — see §4):
  - `/meta-optimize` appears in shipped plugin command list (visible to end users on install)
  - `.claude-plugin/plugin.json` registers `/meta-optimize` AND still does NOT reference `maintainer-skills/` (regression invariant preserved)
  - Fixture run produces a PR artifact (git branch + PR), NOT direct repo mutation — Q5 compliance test passes
  - Closure validator accepts PR-based close records (commit field = PR head commit); rejects records with missing PR ref
  - End-to-end integration: kickoff → opt-in → metrics enabled → `/meta-optimize` run → PR with baseline vs candidate metrics in the description
  - Metric registry tolerates consumer-supplied unknown dimensions (no crash on unknown metric_type)
  - Consumer-facing backlog template lands in user project; consumers can populate `queue-meta-optimize.yaml`
  - Full epic promise delivered: user-facing meta-improvement capability shipped, maintainer loop proven

NOT YET: Parallel mode (Q2); auto-backlog surfacing (NEW Q4); long-tail metrics (Q8).
VERIFIED BY: `/meta-optimize` visible in shipped plugin; fixture run produces PR artifact (not direct mutation, Q5); closure validator accepts PR-ref closes; full kickoff → opt-in → run → PR integration path works.
COMMIT: "feat(meta-optimize): public user-project meta-improvement skill with PR-only promotion"
STOP-SHIP: Coherent and **MVS reached** — epic promise delivered end-to-end to users.
DEPENDENCIES: S9.

---

## 3. Overlay Diagram

```
          S1  S2  S3  S4  S5  S6  S7   S8   S9   S10
          B0  C1  A1  A2  C2  Kck L1   L2i  L2   L3
          ── ─── ─── ─── ─── ─── ─── ─── ─── ───
L1 cfg         ·   ·   ·   ✎   ·   ·    ·    ·    ✎
L2 kickoff     ·   ·   ·   ·   ✎   ·    ·    ·    ·
L3 metrics    ✎   ·   ·   ·   ·   r    ·    ·    ·
L4 hooks       ·   ·   ·   ✎   ·   ·    ·    ·    ·
L5 steps       ·   d   ✎   ·   ·   ·    ·    o    o
L6 teams       ·   ·   ✎   ·   ·   ·    ·    ·    ·
L7 charter     ·   a   ✎   ·   ·   ·    ·    ·    ·
L8 library c   ·   ·   ·   ·   ·   ✎    ·    c    c
L9 meta-meta   ·   ·   ·   ·   ·   ·    s    ✎    ·
L10 meta-opt   ·   ·   ·   ·   ·   ·    ·    ·    ✎
L11 backlogs   ·   ·   ·   ·   ·   ·    s    c    t

  ✎=primary edit  a=archive  d=demote  s=scaffold  c=consumes  o=orchestrated  r=read  t=template
```

PARALLELISM:
  S2 ∥ S3 (both gated on S1); S4 ∥ S5 (both gated on S3+S2); S6 ∥ S7 (gated on S5, S2 resp.); S8 onward sequential.

Each column is a commit-worthy, coherent, inspectable state.

## 4. Milestones: MVL and MVS

Review surfaced that "MVS at Slice 9" conflates two distinct milestones. Per Q-new-A (local-only) and Q6 (one shipped + one local), both are real.

**Min Viable Loop (MVL) = Slice 9.** First e2e `/meta-meta-optimize` run with full closure invariant AND architect-mandated real commit-then-revert (BL2.6). Every abstraction exercised against a real commit. Regression-proofs Codex §3.6 (`commit: TBD`). Internal validation milestone — the abstraction is proven.

**Min Viable Ship (MVS) = Slice 10.** First user-facing shipped artifact: `/meta-optimize` registered in `plugin.json`, exercised e2e with PR-only promotion (Q5). End-user install exposes new surface. Packaging milestone — the epic ships.

**Why distinguish:** MVL gates MVS (S10 starts only after S9's real-revert proof lands, not synthetic closure). S10 is the clean drop point if scope compresses; MVL is retained. Validation risk retires at S9; packaging risk retires at S10.

## 5. Deferred Items

See `horizontal-plan.md` → `## PUNT LIST` for the single consolidated list (deferred layers, deferred scope, resolved/open NEW QUESTIONS, and the Stop-hook slot conflict). All deferrals have explicit user decisions, architect guidance, or concrete follow-on triggers; nothing is silently dropped.

## 6. Risk by Slice

```
S1 LOW (docs) · S2 LOW (inert primitives) · S3 LOW (archive, no consumers)
S4 MED (authority-closure must hold) · S5 MED (wide hook surface + SDK token risk)
S6 LOW (narrow UX) · S7 LOW-MED (new code, unit-heavy) · S8 LOW (scaffold only)
S9 HIGH — first self-modifying run; architect §5 risk #1; mitigated by worktree (Q4) + closure validator (Q3) + trivial target (Q7) + real-revert proof (BL2.6)
S10 MED — public ship; PR-only reduces blast radius; fixture-run mandatory
```

## 7. Moldability Notes

Can change: S6 ↔ S7 order (parallel-safe); S2 ↔ S3 order (parallel-safe); S4 internal story order; S10 can drop (MVL retained via S9); S8+S9 can bundle as one milestone (not recommended — review clarity).

Cannot change: S1→S2 (contract before schema freeze, architect §2 rec 1); S2→S5 (substrate before emitters); S2→S7 (schemas before library); S3→S4 (archive before new plane); S4→S9 (workflow before orchestration); S7→S9 (library before consumers); S9→S10 (MVL before MVS).

## 8. Open Items

See `horizontal-plan.md` → PUNT LIST for the consolidated list. Summary: Q1/Q2 resolved (applied in S7/S8); Q3/Q4/Q5 open (user/outline resolution).
