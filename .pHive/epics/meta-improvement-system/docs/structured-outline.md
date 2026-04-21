---
title: Structured Outline — Meta-Improvement System
epic: meta-improvement-system
phase: B3 (structured outline)
author: technical-writer (codex-backed)
date: 2026-04-20
inputs:
  - design-discussion.md (rev 1)
  - horizontal-plan.md (rev 1)
  - vertical-plan.md (rev 1)
  - user-decisions-dd.md
  - architect-memo.md
  - architect-hv-review.md
  - research-brief.md
  - tpm-sequencing-memo.md
  - codex-audit-memo.md
status: ready for collaborative review
revision: 1
review_summary:
  - researcher: GAP_FILLED with stop-hook owner correction
  - tpm: approve-with-flags on dependency, naming, and config-ownership precision
  - architect: approve-with-escalation on rollback realism, manifest ownership, and closure evidence shape
escalation_resolutions:
  rollback-realism-proof-ambiguity:
    status: resolved
    addressed_by: [Fix #5]
  manifest-ownership-under-specification:
    status: resolved
    addressed_by: [Fix #1, Fix #6, Fix #7]
  closure-evidence-shape-mismatch:
    status: resolved
    addressed_by: [Fix #9, Fix #11]
slice_count: 10
milestones: MVL=S9, MVS=S10
---

# Structured Outline: Meta-Improvement System

## Part 1. Goal and Success Criteria

### 1.1 Goal

This outline translates the approved horizontal and vertical plans into an implementation-ready blueprint for Phase C story authoring and execution. It does not redesign the system. It maps each approved vertical slice `S1-S10` to a delivery phase, expands the slice into file-level and review-level detail, and records the remaining decisions the user must explicitly affirm before story YAMLs are written (per `structured-outline-phase-invariants.md`; per `vertical-plan.md` §2).

The build target is the signed two-swarm meta-improvement system:
- one local-only maintainer tool, `/meta-meta-optimize`, outside the shipped skill root and absent from `plugin.json` (per `user-decisions-dd.md` Q-new-A; per `horizontal-plan.md` L9);
- one shipped user-facing tool, `/meta-optimize`, registered in `plugin.json` and constrained to PR-only promotion (per `user-decisions-dd.md` Q5, Q6; per `vertical-plan.md` S10);
- one shared lifecycle library under `hive/lib/meta-experiment/`, not modeled as a skill (per `architect-hv-review.md` NEW QUESTION 1; per `horizontal-plan.md` L8);
- one dual-schema metrics carrier under `.pHive/metrics/`, opt-in at kickoff and default-off (per `user-decisions-dd.md` Q1, Q-new-B; per `vertical-plan.md` S2, S5, S6).

### 1.2 What This Document Must Accomplish

By the end of this outline, Phase C story writing should be mostly mechanical rather than creative because:
- every slice has a bounded goal, rough story set, file manifest, acceptance criteria, dependency list, and doc-impact list (per `structured-outline/SKILL.md`; per `vertical-plan.md` §2);
- the execution split is already embedded in the step sequencing: implementation work routes to Codex-backed developer/tester/pair-programmer roles, while review and peer-validation route to Claude Opus reviewer roles (per `user-decisions-dd.md` Q-new-C);
- the stop-hook slot conflict is surfaced as a real B3 decision instead of being left as a latent integration surprise (per `horizontal-plan.md` PUNT LIST; per `vertical-plan.md` S5 note);
- the merged risk registry carries forward the architect, audit, research, and H-plan punt items so Phase C does not silently drop known hazards (per `architect-memo.md` §5; per `research-brief.md` §6; per `horizontal-plan.md` PUNT LIST).

### 1.3 Locked Decisions This Outline Must Preserve

The following are frozen inputs, not B3 design space:
- Metrics storage is dual-schema under `.pHive/metrics/`: JSONL events plus experiment envelopes (per `user-decisions-dd.md` Q1).
- Experiments are serial by default; parallel mode is deferred (per `user-decisions-dd.md` Q2; per `horizontal-plan.md` deferred scope).
- The experiment envelope stays lean; no threshold-class expansion and no multi-mode delayed-regression policy in MVP (per `user-decisions-dd.md` Q3).
- Delayed regression handling is `auto-revert`, not recommendation-only or human-confirmed branching (per `user-decisions-dd.md` Q3; this intentionally narrows the earlier architect recommendation).
- `meta-meta-optimize` uses worktree isolation by default (per `user-decisions-dd.md` Q4).
- `meta-optimize` promotes via PR artifact only (per `user-decisions-dd.md` Q5).
- The operator surface is one shipped public entrypoint plus one local-only maintainer entrypoint (per `user-decisions-dd.md` Q6, Q-new-A).
- Backlog support is in scope, but backlog auto-surfacing is deferred; MVP backlog is human-edit-only (per `user-decisions-dd.md` Q7 extension, Q-new-D).
- `meta_team.github_forwarding` migrates into `meta_optimize.github_forwarding` during the rewrite (per `user-decisions-dd.md` Q-new-D).
- The historical `commit: TBD` integrity break is preserved and flagged through an optional archive audit-note story, not rewritten out of history (per `user-decisions-dd.md` Q-new-D; per `vertical-plan.md` S3 optional A1.6).

### 1.4 Success Criteria

This outline is successful if all of the following are true:
- Part 4 contains exactly 10 phase sections, one for each approved slice `S1-S10`, with no added or merged slices (per `structured-outline-phase-invariants.md`; per `vertical-plan.md` §2).
- Each phase is specific enough that a TPM can decompose it into story YAML without inventing new architecture (per `planning-doc-workflow.md`).
- Each phase names all touched files and the purpose of each touch, including create/modify/archive/delete intent where applicable (per `structured-outline/SKILL.md`; per `structured-outline-production-patterns.md`).
- Each phase includes explicit documentation cross-cutting triggers because the `documentation` concern applies to every story in this epic (per `.pHive/cross-cutting-concerns.yaml`).
- Part 7 red-teams the plan with concrete “what if” questions and answers from the agent team; any unresolved planning gap is marked `**GAP:**` rather than silently patched over (per `structured-outline-phase-invariants.md`).
- Part 8 lets the user sign off with decision-by-decision responses without rereading the full document (per `structured-outline-phase-invariants.md`; per `structured-outline-production-patterns.md`).

### 1.5 Milestone Interpretation

This outline preserves the approved milestone split:
- `MVL = S9`: the internal loop is proven only when `/meta-meta-optimize` completes a real worktree-isolated cycle and a real commit-then-revert observation-window proof, not just a synthetic close (per `vertical-plan.md` §4; per `architect-hv-review.md` concern 2).
- `MVS = S10`: the public feature ships only when `/meta-optimize` is registered, exercised end-to-end, and constrained to PR-only promotion (per `vertical-plan.md` §4; per `user-decisions-dd.md` Q5, Q6).

## Part 2. Constraints and Out-of-Scope

### 2.1 B3 Scope Discipline

This document is Phase B3 only:
- It does not author story YAMLs; that is Phase C output (per `structured-outline-phase-invariants.md`).
- It does not revise `design-discussion.md`, `horizontal-plan.md`, or `vertical-plan.md`; those are upstream inputs and remain authoritative (per `structured-outline-phase-invariants.md`).
- It does not reopen user-signed decisions unless elicitation surfaces a genuine gap or contradiction in the approved plan (per task instructions; per `user-decisions-dd.md`).

### 2.2 Hard Constraints

The outline must stay inside these boundaries:
- Use the 10 approved slices and the sequencing already reviewed and approved (per `user-decisions-dd.md` H/V gate; per `vertical-plan.md` §2).
- Keep the metrics envelope lean and minimal; do not add threshold classes, extra rollback modes, or extra closure fields beyond the approved set unless a gap is explicitly flagged (per `user-decisions-dd.md` Q3).
- Treat the state-dir resolver epic as out of scope even though many paths remain hardcoded to `.pHive/` (per planning brief “Known follow-up”; per `horizontal-plan.md` PUNT LIST; per `research-brief.md` §6).
- Treat scheduler wiring as out of scope even though manual and scheduled runs must use identical artifacts (per `design-discussion.md` §4; per `horizontal-plan.md` PUNT LIST).
- Preserve the local-only packaging boundary for `maintainer-skills/` structurally, not procedurally (per `architect-hv-review.md` NEW QUESTION 2; per `vertical-plan.md` S8).

### 2.3 Naming Conventions

The outline commits to `hive/lib/` as the repo's shared-runtime-module root. Submodules under it are scope-specific rather than skill-shaped:
- `hive/lib/metrics/` is the non-skill runtime module for metrics JSONL and envelope I/O primitives (per `vertical-plan.md` S2).
- `hive/lib/meta-experiment/` is the non-skill runtime module for experiment lifecycle logic shared by both swarms (per `vertical-plan.md` S7; per `architect-hv-review.md` NEW QUESTION 1).

### 2.4 Deferred Scope From the Horizontal Plan Punt List

The following remain explicitly out of MVP scope and should not be smuggled into Phase C story authoring:
- `paths.state_dir` resolver work across hardcoded `.pHive/` sites (per `horizontal-plan.md` PUNT LIST).
- Scheduler/cron trigger integration (per `horizontal-plan.md` PUNT LIST; per `design-discussion.md` §4).
- Long-tail metrics beyond the five-MVP set, including cache hit rate, CodeRabbit fixes, memory wiki hit rate, trust trajectory, and skill invocation coverage (per `horizontal-plan.md` PUNT LIST; per `vertical-plan.md` S5).
- Parallel experiment execution mode for either swarm (per `user-decisions-dd.md` Q2; per `horizontal-plan.md` PUNT LIST).
- Per-metric asymmetric threshold classes (per `user-decisions-dd.md` Q3; per `horizontal-plan.md` PUNT LIST).
- Three-class delayed regression handling (per `user-decisions-dd.md` Q3; per `horizontal-plan.md` PUNT LIST).
- Backlog auto-surfacing from qualitative signals (per `user-decisions-dd.md` Q-new-D; per `horizontal-plan.md` PUNT LIST).

### 2.5 Open But Bounded B3 Resolution Items

Only one material implementation-shape question remains open at B3:
- Stop-hook slot conflict: combined dispatch in the existing Stop hook versus a separate metrics mechanism such as session-end marker or `SessionEnd`/`PostToolUse` path (per `horizontal-plan.md` “Stop-hook slot conflict”; per `vertical-plan.md` S5 note).

Everything else named as “open” in H-plan is already closed by `user-decisions-dd.md`:
- NEW Q3 `github_forwarding` migration is affirmed as move into `meta_optimize.github_forwarding` (per `user-decisions-dd.md` Q-new-D).
- NEW Q4 backlog auto-surfacing is affirmed as deferred; human-edit-only MVP (per `user-decisions-dd.md` Q-new-D).
- NEW Q5 historical `commit: TBD` handling is affirmed as optional A1.6 audit-note story during archive (per `user-decisions-dd.md` Q-new-D).

### 2.6 Out-of-Scope Failure Modes That Must Still Be Documented

Even where scope is deferred, Phase C stories must acknowledge:
- token capture may degrade for some agent paths if the SDK does not surface enough information; that can force metric #1 into a follow-on story without invalidating the rest of Epic C (per `tpm-sequencing-memo.md` §2; per `research-brief.md` §6);
- scheduled execution is not proven in-repo, so run artifacts must be scheduler-agnostic but scheduler integration itself stays out of scope (per `design-discussion.md` §4; per `research-brief.md` §7);
- documentation updates are mandatory for every story even though doc completeness is not itself a separate slice (per `.pHive/cross-cutting-concerns.yaml`).

## Part 3. Approach Summary

### 3.1 Core Strategy

The approved design is a contract-first, control-plane-rewrite, shared-lifecycle build:
1. Draft a thin B0 consumer contract before metrics schema freeze so Epic C hardens around real experiment queries rather than guessed telemetry (per `design-discussion.md` §2, §3; per `tpm-sequencing-memo.md` §1).
2. Build the metrics carrier in two stages: schema/storage first, emitters second, all gated behind a kickoff-time opt-in that defaults off (per `vertical-plan.md` S2, S5, S6; per `user-decisions-dd.md` Q-new-B).
3. Retire the contradictory legacy meta-team authority model before any new swarm tries to orchestrate it (per `design-discussion.md` §2; per `architect-memo.md` §1, §3; per `codex-audit-memo.md` TL;DR).
4. Introduce a shared lifecycle library once the carrier and control plane exist, then consume that library first in the local maintainer loop and second in the shipped user loop (per `design-discussion.md` §2; per `vertical-plan.md` S7-S10).

### 3.2 Why This Shape Holds

The plan is intentionally not “metrics first, then everything else” in the naive sense. It is “consumer contract first, then metrics and control plane in parallel, then lifecycle, then swarm consumers” because:
- Epic C needs B’s query shape to avoid freezing the wrong schema (per `design-discussion.md` §3; per `architect-memo.md` §2 recommendation 1; per `tpm-sequencing-memo.md` §1).
- Epic A and Epic C touch mostly disjoint surfaces once B0 lands, so they can run in parallel without hidden file overlap (per `horizontal-plan.md` §3; per `tpm-sequencing-memo.md` §5).
- The old meta-team’s issue is not absent files but contradictory invariants, so archive/reset must precede any claim that the new loop is trustworthy (per `design-discussion.md` §4, §5; per `codex-audit-memo.md` §3).
- The lower-blast-radius but higher-integrity-pressure local loop is the correct proving ground for the shared library before the public skill ships (per `design-discussion.md` §3; per `vertical-plan.md` S9-S10; per `architect-hv-review.md` §2, §4).

### 3.3 Execution Model

The implementation and review split is locked into the plan:
- Drafting, implementation, test harness work, orchestration wiring, and fix loops use Codex-backed roles (`developer`, `backend-developer`, `frontend-developer`, `tester`, `pair-programmer`) (per `user-decisions-dd.md` Q-new-C).
- Review steps, architecture-sensitive peer validation, and sign-off reviews route to Claude Opus reviewer/peer-validator roles (per `user-decisions-dd.md` Q-new-C).
- This means every Phase C story should be expressible as “Codex executes, Opus reviews,” with only mechanical test-worker exceptions remaining on the Claude side if the repo convention still requires them (per `user-decisions-dd.md` Q-new-C).

### 3.4 Implementation Rhythm

The delivery rhythm implied by the approved plans is:
- `S1` defines the contract.
- `S2` and `S3` can proceed with limited parallelism.
- `S4` and `S5` can proceed with limited parallelism after their prerequisites clear.
- `S6` and `S7` can proceed with limited parallelism after `S5`/`S2` respectively.
- `S8` introduces the local-only scaffold without destructive capability.
- `S9` proves the maintainer loop with real closure and real revert.
- `S10` ships the public loop.

That rhythm preserves both pragmatic working-state discipline and milestone honesty: every slice leaves a coherent state, but only `S9` proves the internal loop and only `S10` fulfills the shipping promise (per `vertical-plan.md` §4, §6; per `architect-hv-review.md` §2, §4).

## Part 4. Phased Breakdown

### Phase S1. B0 — Consumer Contract Sliver

**Slice goal**

Define the approved experiment-envelope and query contract that Epic C will build against, without introducing code or runtime changes (per `vertical-plan.md` S1; per `design-discussion.md` §2, §3).

**Story list**

- `B0.1` Experiment envelope outline.
- `B0.2` Query shape doc for baseline vs candidate, run-over-run, and delayed-regression watch.
- `B0.3` Lean threshold plus rollback policy-ref contract.

**File manifest**

- Create `.pHive/epics/meta-improvement-system/docs/b0-consumer-contract.md` — canonical B0 contract doc with field list, query names, and cost classification (per `vertical-plan.md` S1).
- Reference `.pHive/epics/meta-improvement-system/docs/design-discussion.md` — source for approach summary and B0 rationale; no edit planned in this slice.
- Reference `.pHive/epics/meta-improvement-system/docs/vertical-plan.md` — slice authority; no edit planned in this slice.

**Agent step sequence**

1. `developer` on Codex drafts the contract doc from the signed envelope fields and query intents (per `user-decisions-dd.md` Q3; per `user-decisions-dd.md` Q-new-C).
2. `pair-programmer` on Codex checks that each required envelope field is consumed by at least one named query and that no extra classes or rollback branches slipped in (per `vertical-plan.md` S1; per `user-decisions-dd.md` Q3).
3. `reviewer` on Claude Opus performs architecture review for schema sufficiency and drift against Epic C needs (per `vertical-plan.md` S1 VERIFIED BY; per `user-decisions-dd.md` Q-new-C).
4. `peer-validator` on Claude Opus confirms the doc is B3-safe: no story YAML, no new slice design, no re-opened user decisions (per `structured-outline-phase-invariants.md`).

**Acceptance criteria**

- The contract enumerates every Q3-required envelope field with purpose, data shape, and consumer query usage (per `user-decisions-dd.md` Q3).
- Three named queries exist: baseline-vs-candidate, run-over-run, delayed-regression-watch, each with explicit cost expectations (per `vertical-plan.md` S1).
- Threshold semantics remain one lean knob and rollback semantics remain unconditional auto-revert; no per-metric classes or mode trees appear (per `user-decisions-dd.md` Q3).
- An architect can review the doc in isolation and assess whether `S2` will answer Epic B’s questions (per `vertical-plan.md` S1).

**Dependencies**

- None. This is the first slice and must land before C1 schema freeze (per `vertical-plan.md` S1; per `tpm-sequencing-memo.md` §1).

**Cross-cutting concern triggers**

- `documentation`:
  - `.pHive/epics/meta-improvement-system/docs/b0-consumer-contract.md` — new contract doc.
  - `hive/hive.config.yaml` docs are not yet touched in this slice.
  - Schema references named here must later align with `.pHive/metrics/*.schema.md` in `S2`.

### Phase S2. C1 — Metrics Substrate (Schema + Storage Primitives)

**Slice goal**

Create the dual-schema carrier, example-valid schema docs, and inert writer/reader primitives with no live emitters yet (per `vertical-plan.md` S2; per `user-decisions-dd.md` Q1).

**Story list**

- `C1.1` Metrics directory and carrier README.
- `C1.2` Event JSONL schema.
- `C1.3` Experiment envelope schema.
- `C1.4` Writer and reader primitives.

**File manifest**

- Create `.pHive/metrics/README.md` — carrier conventions, retention notes, and directory purpose (per `vertical-plan.md` S2).
- Create `.pHive/metrics/events/README.md` — JSONL event storage contract and examples (per `vertical-plan.md` S2).
- Create `.pHive/metrics/experiments/README.md` — envelope storage contract and mutation rules (per `vertical-plan.md` S2).
- Create `.pHive/metrics/metrics-event.schema.md` — sparse append-only event schema (per `horizontal-plan.md` L3; per `architect-memo.md` §2 recommendation 3).
- Create `.pHive/metrics/experiment-envelope.schema.md` — lean envelope schema with approved fields only (per `horizontal-plan.md` L3; per `user-decisions-dd.md` Q3).
- Create `hive/lib/metrics/` — non-skill runtime module for append-only writer, envelope writer, baseline reader, and delta compare helper (per `vertical-plan.md` S2; per Part 2.3 naming convention).
- Create primitive unit tests under the repo’s normal test location for `hive/lib/metrics/` — round-trip and side-effect boundary tests (per `vertical-plan.md` S2 VERIFIED BY).

**Agent step sequence**

1. `developer` on Codex creates the carrier directories and schema docs from the B0 contract (per `vertical-plan.md` S2; per `user-decisions-dd.md` Q-new-C).
2. `backend-developer` on Codex implements the inert primitives and example fixtures that validate the schemas (per `vertical-plan.md` S2).
3. `tester` on Codex adds round-trip tests proving append-only writes, envelope updates limited to decision/rollback fields, and no side effects outside `.pHive/metrics/` (per `vertical-plan.md` S2 VERIFIED BY).
4. `reviewer` on Claude Opus checks schema drift against the B0 consumer contract and against the anti-over-engineering signal from Q3 (per `user-decisions-dd.md` Q3; per `vertical-plan.md` S2).

**Acceptance criteria**

- `.pHive/metrics/events/` and `.pHive/metrics/experiments/` exist and are documented (per `vertical-plan.md` S2).
- Example records validate against the event schema and example envelopes validate against the envelope schema (per `vertical-plan.md` S2).
- The writer primitive can append an event and the reader primitive can retrieve a run-scoped range without any emitter integration (per `vertical-plan.md` S2).
- The envelope writer only supports update-in-place for decision and rollback fields, not arbitrary mutation (per `vertical-plan.md` S2).
- Baseline and delta-read helpers produce structured fixture diffs that later slices can consume (per `vertical-plan.md` S2).

**Dependencies**

- Requires `S1` because the consumer contract shapes the schema freeze (per `vertical-plan.md` S2; per `tpm-sequencing-memo.md` §1).

**Cross-cutting concern triggers**

- `documentation`:
  - `.pHive/metrics/README.md`, `.pHive/metrics/events/README.md`, `.pHive/metrics/experiments/README.md`.
  - New schema references for event JSONL and experiment envelopes.
  - Any primitive-module README or inline usage docs introduced with the code path.

### Phase S3. A1 — Historical Archive + Authority Reset

**Slice goal**

Archive legacy meta-team state, demote or replace historical references, extract reusable safety constraints, and remove the pretense that the contradictory old control plane is still live (per `vertical-plan.md` S3; per `design-discussion.md` §2; per `codex-audit-memo.md` TL;DR).

**Story list**

- `A1.1` Archive cycle-state, ledger, and queue under dated archive path with manifest.
- `A1.2` Extract shared safety constraints.
- `A1.3` Demote nightly-cycle reference to historical/operator narrative.
- `A1.4` Replace sandbox reference with worktree-centric isolation reference.
- `A1.5` Zero or remove active state files.
- `A1.6` Optional audit note for historical `commit: TBD` integrity break.

**File manifest**

- Archive `.pHive/meta-team/cycle-state.yaml` to `.pHive/meta-team/archive/2026-04-19/cycle-state.yaml` — preserve prior live state for audit context (per `vertical-plan.md` S3).
- Archive `.pHive/meta-team/ledger.yaml` to `.pHive/meta-team/archive/2026-04-19/ledger.yaml` — preserve historical cycles including integrity break (per `vertical-plan.md` S3; per `codex-audit-memo.md` §3.6).
- Archive `.pHive/meta-team/queue.yaml` to `.pHive/meta-team/archive/2026-04-19/queue.yaml` — preserve proto-hypothesis history before split queues land (per `vertical-plan.md` S3; per `research-brief.md` §5.1).
- Create `.pHive/meta-team/archive/2026-04-19/MANIFEST.md` — explain preserved files, archive rationale, and integrity caveats (per `vertical-plan.md` S3).
- Modify or delete `.pHive/meta-team/cycle-state.yaml` — clear active contradictory state (per `vertical-plan.md` S3).
- Modify or delete `.pHive/meta-team/ledger.yaml` — clear active contradictory state (per `vertical-plan.md` S3).
- Modify or delete `.pHive/meta-team/queue.yaml` — clear active single-swarm queue before new split queues land (per `vertical-plan.md` S3).
- Create `hive/references/meta-safety-constraints.md` — extracted safety constraints reused by both future charters (per `vertical-plan.md` S3; per `horizontal-plan.md` L7).
- Modify `hive/references/meta-team-nightly-cycle.md` — add historical/operator-narrative header and remove authoritative posture (per `vertical-plan.md` S3).
- Replace `hive/references/meta-team-sandbox.md` with `hive/references/meta-experiment-isolation.md` — authoritative worktree-centric isolation doc (per `vertical-plan.md` S3; per `user-decisions-dd.md` Q4).
- Optionally create an audit-note subsection in `MANIFEST.md` or a sibling note documenting the `commit: TBD` issue — preserve history while flagging integrity break (per `user-decisions-dd.md` Q-new-D).

**Agent step sequence**

1. `developer` on Codex archives the legacy files and writes the manifest without altering historical content semantics (per `vertical-plan.md` S3; per `user-decisions-dd.md` Q-new-C).
2. `pair-programmer` on Codex extracts shared safety text into the reusable reference and updates cross-links from surviving docs (per `horizontal-plan.md` L7).
3. `developer` on Codex demotes the nightly-cycle doc and replaces sandbox guidance with the new isolation reference (per `vertical-plan.md` S3; per `user-decisions-dd.md` Q4).
4. `reviewer` on Claude Opus verifies that the archive preserves evidence while clearly severing authority, and that the optional A1.6 handling does not rewrite history (per `user-decisions-dd.md` Q-new-D).

**Acceptance criteria**

- The dated archive contains prior `cycle-state.yaml`, `ledger.yaml`, and `queue.yaml` plus a manifest explaining scope and integrity caveats (per `vertical-plan.md` S3).
- Active state files are absent or empty enough that no tooling can mistake them for authoritative live meta-team state (per `vertical-plan.md` S3).
- `meta-safety-constraints.md` exists and can be imported or referenced by both future charters (per `vertical-plan.md` S3; per `horizontal-plan.md` L7).
- `meta-team-nightly-cycle.md` is explicitly historical and operator-narrative only (per `vertical-plan.md` S3).
- `meta-experiment-isolation.md` is the authoritative isolation reference and cross-links to the old sandbox doc no longer remain live (per `vertical-plan.md` S3).

**Dependencies**

- Requires `S1` for overall plan alignment.
- Can proceed in parallel with `S2` because archive/reference work and metrics-substrate work do not share file sets (per `vertical-plan.md` S3; per `horizontal-plan.md` §3).

**Cross-cutting concern triggers**

- `documentation`:
  - `hive/references/meta-team-nightly-cycle.md`.
  - `hive/references/meta-experiment-isolation.md`.
  - `hive/references/meta-safety-constraints.md`.
  - Any surviving references to the old sandbox or single-swarm authority model.

### Phase S4. A2 — Control-Plane Rewrite (Step Files + Teams + New Charters)

**Slice goal**

Replace the contradictory legacy authority model with a coherent control plane whose step obligations, team grants, isolation semantics, and close semantics line up before any new swarm invokes it (per `vertical-plan.md` S4; per `architect-memo.md` §3; per `codex-audit-memo.md` §3).

**Story list**

- `A2.1` Rewrite implementation step.
- `A2.2` Rewrite testing step around orchestrator-mediated writes or equivalent aligned grants.
- `A2.3` Rewrite evaluation step.
- `A2.4` Rewrite promotion step with unambiguous revert semantics.
- `A2.5` Rewrite close step and add closure validator.
- `A2.6` Split `meta-team.yaml` into two swarm-specific team files.
- `A2.7` Write two new charters.
- `A2.8` Audit step-write obligations against team grants.

**File manifest**

- Modify `hive/workflows/meta-team-cycle.workflow.yaml` — align workflow orchestration with rewritten step semantics and split-swarm control plane (per `vertical-plan.md` S4).
- Reference `hive/workflows/steps/meta-team-cycle/step-01-boot.md` — baseline-capture and kickoff-precondition surface consumed later by `S8-S10`; no rewrite expected in this slice unless step sequencing references must be aligned (per `horizontal-plan.md` L5; per `vertical-plan.md` S4/S9).
- Reference `hive/workflows/steps/meta-team-cycle/step-02-analysis.md` — analysis-stage surface that must remain consistent with rewritten downstream step semantics; no rewrite expected in this slice unless cross-step wording drifts (per upstream step ownership noted in architect review).
- Reference `hive/workflows/steps/meta-team-cycle/step-03-proposal.md` — proposal-stage surface checked for consistency with the new promotion and close semantics; no rewrite expected unless downstream references require it (inference from upstream step naming pattern).
- Reference `hive/workflows/steps/meta-team-cycle/step-03b-backlog-fallback.md` — backlog-fallback owner surface later consumed by `S8`; this slice should keep terminology aligned even if the main logic lands later (per `horizontal-plan.md` L5 and L11).
- Modify `hive/workflows/steps/meta-team-cycle/step-04-implementation.md` — remove cross-role write violations (per `vertical-plan.md` S4; per `codex-audit-memo.md` §3.3).
- Modify `hive/workflows/steps/meta-team-cycle/step-05-testing.md` — resolve read-only contradiction through orchestrator-mediated writes or narrowed grants (per `vertical-plan.md` S4; per `codex-audit-memo.md` TL;DR).
- Modify `hive/workflows/steps/meta-team-cycle/step-06-evaluation.md` — align reviewer write behavior with actual grants (per `vertical-plan.md` S4).
- Modify `hive/workflows/steps/meta-team-cycle/step-07-promotion.md` — define clean revert path under worktree-native or delete-on-fail semantics (per `vertical-plan.md` S4; per `user-decisions-dd.md` Q4).
- Modify `hive/workflows/steps/meta-team-cycle/step-08-close.md` — make closure validator non-bypassable and require real commit/ref plus metrics snapshot plus rollback target (per `vertical-plan.md` S4; per `user-decisions-dd.md` Q3).
- Archive or replace `.pHive/teams/meta-team.yaml` — retire single-swarm team file (per `vertical-plan.md` S4; per `horizontal-plan.md` L6).
- Create `.pHive/teams/meta-optimize.yaml` — user-project swarm team roster and grants (per `vertical-plan.md` S4).
- Create `.pHive/teams/meta-meta-optimize.yaml` — plugin-hive swarm team roster and grants (per `vertical-plan.md` S4).
- Create `.pHive/meta-team/charter-meta-optimize.md` — public swarm charter importing shared constraints (per `vertical-plan.md` S4).
- Create `.pHive/meta-team/charter-meta-meta-optimize.md` — maintainer swarm charter importing shared constraints (per `vertical-plan.md` S4).
- Optionally add or create a closure-property audit test file in the repo’s test suite — proves step writes are a subset of team grants (inference from `vertical-plan.md` S4 VERIFIED BY because the slice requires a closure property test).
- Reference `hive/hive.config.yaml` only — `agent_backends` is already materialized there per Q-new-C sign-off dated 2026-04-20; this slice consumes the existing config and does not need further backend materialization (per `.pHive/cycle-state/meta-improvement-system.yaml`; per `user-decisions-dd.md` Q-new-C).

**Agent step sequence**

1. `developer` on Codex rewrites workflow and step files 04-08 against the signed control-plane semantics (per `vertical-plan.md` S4; per `user-decisions-dd.md` Q-new-C).
2. `backend-developer` on Codex splits the team files and aligns grants to actual step-write obligations (per `horizontal-plan.md` L6).
3. `developer` on Codex writes the two charters using the extracted shared constraints reference rather than duplicating safety prose (per `horizontal-plan.md` L7).
4. `tester` on Codex adds the closure-property audit and negative tests for incomplete close attempts (per `vertical-plan.md` S4 VERIFIED BY).
5. `reviewer` on Claude Opus performs the control-plane review because this slice retires the highest-density contradictions from the audit (per `codex-audit-memo.md` §3; per `user-decisions-dd.md` Q-new-C).
6. `peer-validator` on Claude Opus checks that no single-swarm assumptions remain live in charters or team grants (per `design-discussion.md` §3; per `vertical-plan.md` S4).

**Acceptance criteria**

- Step files 04-08 and the workflow file are internally consistent and do not ask any role to write a path outside its grants (per `vertical-plan.md` S4).
- The Step-05 self-contradiction is removed; read-only claims and actual writes are no longer in conflict (per `codex-audit-memo.md` TL;DR; per `vertical-plan.md` S4).
- The Step-07 revert semantics are explicit and reversible under the worktree model (per `vertical-plan.md` S4; per `user-decisions-dd.md` Q4).
- Step-08 rejects closes missing commit/ref, metrics snapshot, or rollback target, and that rejection is non-bypassable (per `user-decisions-dd.md` Q3; per `vertical-plan.md` S4).
- `.pHive/teams/meta-optimize.yaml` and `.pHive/teams/meta-meta-optimize.yaml` exist and match the rewritten steps (per `vertical-plan.md` S4).
- Both charters exist, are swarm-specific, and import shared safety constraints instead of re-copying legacy single-swarm text (per `vertical-plan.md` S4).

**Dependencies**

- Requires `S3` because archive/reset should land before the new authority surface (per `vertical-plan.md` S4; per `horizontal-plan.md` soft dependency).
- Can proceed in parallel with `S5` because control-plane rewrites and hook emission work do not share the same main file set, though both are later consumed together by `S9` (per `vertical-plan.md` S4, S5; per `horizontal-plan.md` §3).

**Cross-cutting concern triggers**

- `documentation`:
  - `CLAUDE.md` if workflow-wide agent behavior or review semantics are documented there.
  - `hive/references/meta-team-*.md` that still describe legacy behavior.
  - Agent persona files if permissions or domain write expectations are codified outside team YAML.
  - `.pHive/meta-team/charter-meta-optimize.md`.
  - `.pHive/meta-team/charter-meta-meta-optimize.md`.
  - `hive/hive.config.yaml` docs for agent backend mapping if materialized here.

### Phase S5. C2 — Event Emission Hooks (5 MVP Metrics, Opt-In)

**Slice goal**

Add the five MVP metric emitters under a default-off config gate, keeping the system silent unless `metrics.enabled` is true and resolving the stop-hook collision in a way that does not regress the interrupt sentinel (per `vertical-plan.md` S5; per `user-decisions-dd.md` Q-new-B).

**Story list**

- `C2.1` Add metrics config keys.
- `C2.2` Stop-hook or equivalent session-end metric emission for story-end totals.
- `C2.3` Per-agent token capture path with fallback.
- `C2.4` Agent-spawn reporting emission.
- `C2.5` Fix-loop iteration and first-attempt pass emission at execute boundaries.
- `C2.6` Human escalation emission.
- `C2.7` Token-capture feasibility spike if needed.

**File manifest**

- Modify `hive/hive.config.yaml` — add `metrics.enabled: false` and `metrics.dir: .pHive/metrics` plus any documentation comments used in this repo (per `vertical-plan.md` S5; per `user-decisions-dd.md` Q-new-B).
- Modify `.claude-plugin/plugin.json` — this is the current Stop-hook owner surface and currently contains the inline bash dispatch that writes `.pHive/interrupts/{ts}.yaml`; `S5` modifies this file directly to add metrics emission without violating the maintainer-skill boundary (per `.pHive/cycle-state/meta-improvement-system.yaml`; verified in current repo state).
- Modify the existing `.claude-plugin/plugin.json` Stop hook to support either combined dispatch or a separate adjacent entry, depending on the final decision, while preserving the interrupt-sentinel write to `.pHive/interrupts/{ts}.yaml` (per `horizontal-plan.md` stop-hook conflict; per `vertical-plan.md` S5 note).
- Modify any concrete hook helper files introduced by the chosen `.claude-plugin/plugin.json` strategy for agent-spawn or Task/PostToolUse reporting — exact helper path is implementation-defined, but the hook entrypoint owner is now explicit (per `vertical-plan.md` S5).
- Create or modify tests covering flag-off no-write behavior, flag-on event writes, schema validation, and graceful degradation when the metrics substrate is missing (per `vertical-plan.md` S5 VERIFIED BY).
- Possibly create a small hook README or operator note documenting the stop-hook integration choice if the implementation is non-obvious (recommended by `documentation` concern; inference from `.pHive/cross-cutting-concerns.yaml`).

**Agent step sequence**

1. `backend-developer` on Codex adds the config keys and plumbing for write-time gating (per `vertical-plan.md` S5; per `user-decisions-dd.md` Q-new-B).
2. `developer` on Codex implements the chosen hook strategy for session-end metrics while preserving the existing interrupt-sentinel behavior (per `horizontal-plan.md` stop-hook conflict).
3. `developer` on Codex wires the remaining emission sites: Task/PostToolUse, agent-spawn reporting, execute boundaries, and escalation path (per `vertical-plan.md` S5).
4. `tester` on Codex adds integration tests for flag-off silence, flag-on emission, schema validity, and graceful degradation when `.pHive/metrics/` is missing (per `vertical-plan.md` S5 VERIFIED BY).
5. `reviewer` on Claude Opus reviews specifically for hidden blast radius in hook composition and for accidental writes when the flag is off (per `user-decisions-dd.md` Q-new-C; per `architect-hv-review.md` concern 1).

**Acceptance criteria**

- `hive/hive.config.yaml` contains `metrics.enabled: false` and `metrics.dir: .pHive/metrics` and those values govern all hook writes (per `vertical-plan.md` S5).
- With the flag off, no `.pHive/metrics/events/*.jsonl` writes occur during a run (per `vertical-plan.md` S5).
- With the flag on, the run emits the five approved MVP metrics: tokens, wall-clock, fix-loop iterations, first-attempt pass flag, and human escalation (per `vertical-plan.md` S5; per `tpm-sequencing-memo.md` §2).
- Event records validate against the C1 schema and missing substrate paths do not crash the workflow (per `vertical-plan.md` S5).
- The pre-existing Stop-hook consumer behavior is preserved across whichever integration shape is chosen for metrics (per `vertical-plan.md` S5 note; per `horizontal-plan.md` stop-hook conflict).

**Dependencies**

- Requires `S2` because schema and primitives must exist before emitters can write (per `vertical-plan.md` S5; per `horizontal-plan.md` §3).
- Can proceed in parallel with `S4` after `S2` lands (per `vertical-plan.md` S4, S5; per `horizontal-plan.md` §3).

**Cross-cutting concern triggers**

- `documentation`:
  - `hive/hive.config.yaml` key documentation for `metrics.enabled` and `metrics.dir`.
  - Any hook documentation or operator note for the chosen stop-hook strategy.
  - New metrics JSONL schema references in docs that describe event capture.
  - `CLAUDE.md` if hook behavior changes affect operator expectations.

### Phase S6. Kickoff Opt-In Integration

**Slice goal**

Expose the signed metrics opt-in decision at `/hive:kickoff`, preserve brownfield values, and make the consequences of opting out explicit before any user-facing meta skill exists (per `vertical-plan.md` S6; per `user-decisions-dd.md` Q-new-B).

**Story list**

- `K.1` Fresh-workspace metrics opt-in question.
- `K.2` Brownfield preservation and change prompt.
- `K.3` Kickoff docs update.

**File manifest**

- Modify `skills/kickoff/SKILL.md` — primary kickoff skill owner for elicitation flow and user-facing copy (per current repo layout; per `vertical-plan.md` S6).
- Modify `hive/references/kickoff-protocol.md` — primary kickoff protocol owner for persisted config writes and brownfield re-kickoff behavior (per current repo layout; per `vertical-plan.md` S6).
- Modify `hive/hive.config.yaml` write path logic if kickoff needs helper changes to persist `metrics.enabled` cleanly (per `vertical-plan.md` S6).
- Modify kickoff-facing docs in `skills/kickoff/SKILL.md` and `hive/references/kickoff-protocol.md` so users understand that opting out forces backlog-fallback-only mode for meta loops (per `vertical-plan.md` S6; per `user-decisions-dd.md` Q-new-B).
- Add tests for fresh kickoff and re-kickoff preservation behavior in the repo’s normal test location (per `vertical-plan.md` S6 VERIFIED BY).

**Agent step sequence**

1. `developer` on Codex updates the kickoff elicitation flow with a clear, default-no metrics question and explanatory copy (per `vertical-plan.md` S6; per `user-decisions-dd.md` Q-new-B).
2. `backend-developer` on Codex ensures the brownfield re-kickoff path reads and offers to change the existing `metrics.enabled` value rather than resetting it (per `vertical-plan.md` S6).
3. `tester` on Codex adds fresh and brownfield kickoff tests proving the persisted config value matches user intent (per `vertical-plan.md` S6 VERIFIED BY).
4. `reviewer` on Claude Opus checks the UX wording for policy accuracy: opt-in is meaningful, default is off, and backlog fallback is explained without overselling metric-driven capability before later slices exist (per `user-decisions-dd.md` Q-new-B).

**Acceptance criteria**

- Fresh kickoff asks “Enable metrics tracking?” or equivalent with a clear trade-off explanation and default-off semantics (per `vertical-plan.md` S6; per `user-decisions-dd.md` Q-new-B).
- The selected value is written to `hive/hive.config.yaml` under `metrics.enabled` (per `vertical-plan.md` S6).
- Re-kickoff reads the existing value and offers a change without silently resetting it (per `vertical-plan.md` S6).
- Kickoff docs explicitly say that opting out means future meta runs use backlog fallback only, not metric-driven optimization (per `vertical-plan.md` S6; per `user-decisions-dd.md` Q-new-B).

**Dependencies**

- Requires `S5` because kickoff should write into the real config surface that already governs hook behavior (per `vertical-plan.md` S6; per `horizontal-plan.md` §3).
- Can proceed in parallel with `S7` because kickoff UX and lifecycle-library build touch disjoint surfaces (per `vertical-plan.md` S6, S7).

**Cross-cutting concern triggers**

- `documentation`:
  - Kickoff skill docs under `skills/kickoff/`.
  - `hive/hive.config.yaml` key documentation for `metrics.enabled`.
  - Any user-facing README or GUIDE section that explains meta-optimize prerequisites.

### Phase S7. B-L1 — Shared Lifecycle Library

**Slice goal**

Create the shared lifecycle runtime in `hive/lib/meta-experiment/` so both swarms consume the same envelope, baseline, compare, rollback-watch, and closure-validator logic without modeling that runtime as a skill (per `vertical-plan.md` S7; per `architect-hv-review.md` NEW QUESTION 1).

**Story list**

- `L1.1` Scaffold `hive/lib/meta-experiment/`.
- `L1.2` Envelope loader/writer.
- `L1.3` Baseline capture primitive.
- `L1.4` Delta compare primitive.
- `L1.5` Promotion adapter interface.
- `L1.6` Rollback watch and auto-revert trigger.
- `L1.7` Closure validator.

**File manifest**

- Create `hive/lib/meta-experiment/` — shared runtime module root (per `vertical-plan.md` S7; per `horizontal-plan.md` L8).
- Create `hive/lib/meta-experiment/envelope.*` — envelope loader/writer implementation for the C1 schema (inference from `horizontal-plan.md` L8 interface and `vertical-plan.md` S7).
- Create `hive/lib/meta-experiment/baseline.*` — baseline capture primitive (per `vertical-plan.md` S7).
- Create `hive/lib/meta-experiment/compare.*` — delta-compare primitive (per `vertical-plan.md` S7).
- Create `hive/lib/meta-experiment/promotion-adapter.*` — abstract adapter interface, intentionally no concrete adapter yet (per `vertical-plan.md` S7).
- Create `hive/lib/meta-experiment/rollback-watch.*` — watch-window and auto-revert trigger logic (per `vertical-plan.md` S7; per `user-decisions-dd.md` Q3).
- Create `hive/lib/meta-experiment/closure-validator.*` — non-bypassable envelope validation helpers (per `vertical-plan.md` S7).
- Create tests for round-trip envelope behavior, compare decisions, validator failures, and rollback watch callbacks in the repo’s normal test location (per `vertical-plan.md` S7 VERIFIED BY).
- Optionally create `hive/lib/meta-experiment/README.md` if the runtime needs discovery documentation distinct from inline docs (recommended by `documentation` concern; inference from new-module addition).

**Agent step sequence**

1. `backend-developer` on Codex scaffolds the runtime module under the approved `hive/lib/` location (per `architect-hv-review.md` NEW QUESTION 1; per `user-decisions-dd.md` Q-new-C).
2. `developer` on Codex implements the envelope, baseline, compare, interface, rollback-watch, and closure-validator primitives against the C1 contract (per `vertical-plan.md` S7).
3. `tester` on Codex adds unit tests for the three incomplete-envelope failure modes and rollback-watch callback firing (per `vertical-plan.md` S7 VERIFIED BY).
4. `reviewer` on Claude Opus verifies the library remains shared runtime code, not hidden swarm policy, and that it preserves Q3’s lean envelope and auto-revert semantics (per `user-decisions-dd.md` Q3).

**Acceptance criteria**

- `hive/lib/meta-experiment/` exists and is importable by future skill code (per `vertical-plan.md` S7).
- Envelope round-trip tests pass against the C1 schema (per `vertical-plan.md` S7).
- Baseline-to-compare fixture flow yields a structured decision object suitable for later promotion logic (per `vertical-plan.md` S7).
- Closure validator rejects missing commit, missing metrics snapshot, and missing rollback target as distinct failures (per `vertical-plan.md` S7; per `user-decisions-dd.md` Q3).
- Rollback watch triggers auto-revert callback on regression with no alternate mode branching (per `vertical-plan.md` S7; per `user-decisions-dd.md` Q3).

**Dependencies**

- Requires `S2` because the runtime depends on the dual-schema substrate (per `vertical-plan.md` S7; per `horizontal-plan.md` §3).
- `L1.3` baseline-capture integration tests depend on `S5` if they use real events rather than fixtures, but the library scaffold and most unit tests do not (per `vertical-plan.md` S7).
- Can proceed in parallel with `S6` (per `vertical-plan.md` S6, S7).

**Cross-cutting concern triggers**

- `documentation`:
  - `hive/lib/meta-experiment/README.md` if introduced.
  - New schema references for envelopes and metric snapshots.
  - Charters or skill docs that describe shared lifecycle behavior in later slices.

### Phase S8. B-L2 Intro — Meta-Backlog + `/meta-meta-optimize` Scaffold

**Slice goal**

Introduce the local-only maintainer skill and split backlog substrate without giving the system destructive capability yet, proving that the local-only boundary and backlog-fallback mechanics are structurally real (per `vertical-plan.md` S8; per `user-decisions-dd.md` Q7 extension, Q-new-A).

**Story list**

- `BL2i.1` Meta-meta backlog schema and seeded trivial candidates.
- `BL2i.2` Meta-optimize backlog template.
- `BL2i.3` Local-only maintainer skill scaffold under `maintainer-skills/`.
- `BL2i.4` Step-03b backlog-fallback logic.
- `BL2i.5` Regression test proving `plugin.json` excludes `maintainer-skills/`.

**File manifest**

- Create `.pHive/meta-team/queue-meta-meta-optimize.yaml` — maintainer backlog with seeded trivial proving-run candidates (per `vertical-plan.md` S8; per `horizontal-plan.md` L11).
- Create `.pHive/meta-team/queue-meta-optimize.yaml` — consumer backlog template, initially empty (per `vertical-plan.md` S8).
- Create `maintainer-skills/meta-meta-optimize/SKILL.md` — local-only skill scaffold outside the shipped skill root (per `vertical-plan.md` S8; per `architect-hv-review.md` NEW QUESTION 2).
- Possibly create additional files under `maintainer-skills/meta-meta-optimize/` needed for prompt fragments or execution helpers, following the skill-shaped repo convention if present (inference from the skill scaffold requirement).
- Modify `hive/workflows/steps/meta-team-cycle/step-03b-backlog-fallback.md` if backlog-fallback logic remains step-owned rather than fully skill-owned — this is the explicit reusable step surface for the fallback branch (per upstream step naming; per `horizontal-plan.md` L5 and L11).
- Modify or add tests that assert `.claude-plugin/plugin.json` contains `/meta-optimize` only when that slice lands later and contains no `maintainer-skills/` references now (per `vertical-plan.md` S8 BL2i.5).

**Agent step sequence**

1. `developer` on Codex creates the two backlog YAML files, preserving source-attribution concepts while adding experiment semantics and swarm scope (per `research-brief.md` §5.1; per `horizontal-plan.md` L11).
2. `developer` on Codex scaffolds `maintainer-skills/meta-meta-optimize/SKILL.md` and dry-run backlog loading with no side effects (per `vertical-plan.md` S8; per `user-decisions-dd.md` Q-new-A).
3. `pair-programmer` on Codex wires the backlog-fallback branch so the skill can say “no metric signal; would use backlog” and import the shared library without running an experiment yet (per `vertical-plan.md` S8).
4. `tester` on Codex adds the structural-bundling regression test that asserts `plugin.json` does not reference `maintainer-skills/` (per `vertical-plan.md` S8 BL2i.5).
5. `reviewer` on Claude Opus verifies that the scaffold remains non-destructive and that the local-only boundary is structural rather than convention-based (per `architect-hv-review.md` NEW QUESTION 2).

**Acceptance criteria**

- `maintainer-skills/meta-meta-optimize/SKILL.md` exists and is outside the shipped skill root (per `vertical-plan.md` S8; per `user-decisions-dd.md` Q-new-A).
- `.pHive/meta-team/queue-meta-meta-optimize.yaml` exists with 2-3 trivial candidates suitable for a proving run and `.pHive/meta-team/queue-meta-optimize.yaml` exists as an empty consumer template (per `vertical-plan.md` S8).
- A dry-run invocation loads backlog state and reports backlog-fallback intent without mutating files or invoking the control plane (per `vertical-plan.md` S8).
- Regression testing proves `plugin.json` does not register `maintainer-skills/` (per `vertical-plan.md` S8 BL2i.5).

**Dependencies**

- Requires `S4` for the control plane and `S7` for shared-library imports (per `vertical-plan.md` S8).

**Cross-cutting concern triggers**

- `documentation`:
  - `maintainer-skills/meta-meta-optimize/SKILL.md`.
  - `.claude-plugin/plugin.json` packaging assumptions and regression notes.
  - Queue schema references for `.pHive/meta-team/queue-meta-meta-optimize.yaml` and `.pHive/meta-team/queue-meta-optimize.yaml`.
  - Any maintainer-only operator docs that explain local invocation.

### Phase S9. B-L2 Cycle — First End-to-End `/meta-meta-optimize` Run

**Slice goal**

Prove the internal loop end-to-end on a trivial backlog candidate in a worktree, including a real close with real artifact references and a real commit-then-revert observation-window test. This is the MVL gate (per `vertical-plan.md` S9; per `architect-hv-review.md` concern 2).

**Story list**

- `BL2.1` Direct-commit promotion adapter.
- `BL2.2` Orchestrate the rewritten control plane from the maintainer skill.
- `BL2.3` Integrate baseline capture, metric emission, compare, and close validation.
- `BL2.4` Activate rollback watch on a real committed experiment.
- `BL2.5` Execute first live no-op cycle and write verification doc.
- `BL2.6` Real commit-then-revert proof during observation window.

**File manifest**

- Modify `maintainer-skills/meta-meta-optimize/SKILL.md` — wire actual execution rather than dry-run scaffold (per `vertical-plan.md` S9).
- Create or modify maintainer-skill helper files under `maintainer-skills/meta-meta-optimize/` for orchestration, adapter binding, and reporting as needed by the repo convention (inference from `vertical-plan.md` S9).
- Create concrete direct-commit adapter implementation under `hive/lib/meta-experiment/` or a sibling adapter path — internal-repo promotion path for the maintainer swarm (per `vertical-plan.md` S9; per `horizontal-plan.md` L9/L8 boundary).
- Modify `hive/workflows/steps/meta-team-cycle/step-01-boot.md` only as needed to bind baseline capture at the boot surface consumed by the maintainer run (per `vertical-plan.md` S9; per architect review Gap C).
- Modify `hive/workflows/steps/meta-team-cycle/step-02-analysis.md` only as needed if analysis-stage artifact handoff must be named for the proving run (per architect review Gap C).
- Modify `hive/workflows/steps/meta-team-cycle/step-03b-backlog-fallback.md` only as needed if the live maintainer run still traverses the fallback branch during no-metric cases (per `vertical-plan.md` S8-S9; per architect review Gap C).
- Modify `hive/workflows/steps/meta-team-cycle/step-06-evaluation.md` only as needed to bind compare and regression-watch evidence into the proving run (per `vertical-plan.md` S9).
- Modify `hive/workflows/steps/meta-team-cycle/step-08-close.md` only as needed to bind non-bypassable close validation and proof-artifact recording (per `vertical-plan.md` S9).
- Create `.pHive/audits/mvl-proof/{iso-ts}/proof.yaml` — canonical MVL proof artifact for the first live cycle, with durable artifact references and closure evidence (per architect recommendation for `S9` proof destination).
- Create or update `.pHive/audits/mvl-proof/latest.yaml` — latest-pointer file following the `.pHive/audits/{audit-type}/latest.yaml` convention for operator discovery (per architect recommendation; per orchestrator audit-path convention cited in review).
- Create or update tests covering fabricated `commit: TBD` rejection, worktree discard on failure, and rollback-watch activation with real revert path (per `vertical-plan.md` S9 VERIFIED BY).
- Create real envelope and event artifacts in `.pHive/metrics/` during the proving run, then preserve representative examples or references for inspection (per `vertical-plan.md` S9).

**Agent step sequence**

1. `backend-developer` on Codex implements the direct-commit adapter and binds it into the shared lifecycle library without changing the public-skill path (per `vertical-plan.md` S9; per `user-decisions-dd.md` Q-new-C).
2. `developer` on Codex wires `/meta-meta-optimize` to the `S4` control plane, `S5` metrics, and `S7` lifecycle runtime inside a worktree by default (per `vertical-plan.md` S9; per `user-decisions-dd.md` Q4).
3. `tester` on Codex adds negative and integration tests for fabricated commit rejection, worktree discard-on-fail, and real rollback-watch activation (per `vertical-plan.md` S9 VERIFIED BY).
4. `developer` on Codex executes the first trivial proving run and captures a verification doc with artifact references, not just narrative claims (per `vertical-plan.md` S9 BL2.5).
5. `reviewer` on Claude Opus performs milestone review, focusing on whether rollback realism is truly end-to-end and whether closure integrity is now evidence-backed instead of performative (per `architect-hv-review.md` concern 2; per `codex-audit-memo.md` §3.6).

**Acceptance criteria**

- `/meta-meta-optimize` runs one complete cycle against a trivial backlog target inside a worktree, not in the main tree (per `vertical-plan.md` S9; per `user-decisions-dd.md` Q4).
- The resulting close record contains a real commit SHA, a metrics snapshot reference, and a rollback target reference (per `vertical-plan.md` S9; per `user-decisions-dd.md` Q3).
- A fabricated `commit: TBD` close attempt is rejected (per `vertical-plan.md` S9; per `codex-audit-memo.md` §3.6).
- The experiment includes a committed delta that will trigger `regression_watch`, for example by deliberately regressing a tracked metric beyond threshold during the proving run (per architect escalation `rollback-realism-proof-ambiguity`).
- Auto-revert fires via the `regression_watch` -> closure gate -> auto-revert path, not via manual intervention (per architect escalation `rollback-realism-proof-ambiguity`).
- The MVL proof artifact records the trigger event, the auto-revert commit, and evidence that `regression_watch` fired the revert rather than an operator (per architect escalation `rollback-realism-proof-ambiguity`).
- Failure mode remains clean: on failed promotion or failed validation, the worktree is discarded and the main tree stays free of partial promotion residue (per `vertical-plan.md` S9).

**Dependencies**

- Requires `S4`, `S5`, `S7`, and `S8` because this slice is the first full composition point (per `vertical-plan.md` S9; per `horizontal-plan.md` §3).

**Cross-cutting concern triggers**

- `documentation`:
  - `maintainer-skills/meta-meta-optimize/SKILL.md`.
  - `hive/references/meta-experiment-isolation.md` if the real proving run tightens worktree procedure details.
  - New experiment-envelope and metrics artifact references used in the verification doc.
  - Maintainer-facing verification/runbook docs for the first cycle.

### Phase S10. B-L3 — `/meta-optimize` Ships

**Slice goal**

Ship the public skill, wire it to the shared lifecycle and rewritten control plane for a user-project target, constrain promotion to PR artifacts only, and prove the end-to-end public path from kickoff opt-in through PR output. This is the MVS gate (per `vertical-plan.md` S10; per `user-decisions-dd.md` Q5, Q6).

**Story list**

- `BL3.1` Public skill scaffold and plugin registration.
- `BL3.2` PR-artifact promotion adapter.
- `BL3.3` Public-skill orchestration against user-project targets.
- `BL3.4` Unknown-dimension tolerance in metric registry.
- `BL3.5` Backlog-fallback mode for consumer backlog template.
- `BL3.6` First end-to-end public fixture run.
- `BL3.7` User-facing docs.

**File manifest**

- Create `skills/hive/skills/meta-optimize/SKILL.md` — shipped public skill (per `vertical-plan.md` S10).
- Modify `.claude-plugin/plugin.json` — register `/meta-optimize` while preserving the invariant that `maintainer-skills/` is still absent (per `vertical-plan.md` S10; per `user-decisions-dd.md` Q6).
- Create concrete PR-artifact promotion adapter under `hive/lib/meta-experiment/` or a sibling adapter path — user-project promotion path that produces PR output only (per `vertical-plan.md` S10; per `user-decisions-dd.md` Q5).
- Modify public-skill helper files under `skills/hive/skills/meta-optimize/` as needed for orchestration, metric-registry handling, and backlog fallback (per `vertical-plan.md` S10).
- Modify `.pHive/meta-team/queue-meta-optimize.yaml` template or its schema docs if the public skill needs final field clarifications for consumer use (per `vertical-plan.md` S10; per `horizontal-plan.md` L11).
- Create or modify tests proving `plugin.json` registration, PR-only promotion compliance, unknown-dimension tolerance, and full kickoff-to-PR integration (per `vertical-plan.md` S10 VERIFIED BY).
- Modify user-facing docs such as README, GUIDE, or skill references to explain kickoff opt-in, required metrics/backlog inputs, and PR-only behavior (per `vertical-plan.md` S10 BL3.7; per `.pHive/cross-cutting-concerns.yaml`).

**Agent step sequence**

1. `developer` on Codex scaffolds `skills/hive/skills/meta-optimize/SKILL.md` and registers it in `plugin.json` (per `vertical-plan.md` S10; per `user-decisions-dd.md` Q-new-C).
2. `backend-developer` on Codex implements the PR-artifact promotion adapter and binds it into the shared lifecycle path without enabling direct mutation (per `vertical-plan.md` S10; per `user-decisions-dd.md` Q5).
3. `developer` on Codex wires the public skill to worktree/equivalent isolation, the metric registry, and backlog-fallback behavior using the consumer template queue (per `vertical-plan.md` S10).
4. `tester` on Codex adds integration tests for kickoff-to-opt-in-to-run-to-PR flow and unknown metric dimensions (per `vertical-plan.md` S10 VERIFIED BY).
5. `reviewer` on Claude Opus performs ship review, focusing on packaging boundary preservation, PR-only semantics, and whether public docs explain prerequisites without leaking maintainer-only assumptions (per `user-decisions-dd.md` Q6; per `architect-hv-review.md` §1).

**Acceptance criteria**

- `/meta-optimize` is registered in `.claude-plugin/plugin.json` and visible in the shipped command surface (per `vertical-plan.md` S10).
- `.claude-plugin/plugin.json` still contains no `maintainer-skills/` references (per `vertical-plan.md` S10; per `vertical-plan.md` S8 BL2i.5).
- The first fixture run produces a PR artifact and never promotes via direct repo mutation (per `vertical-plan.md` S10; per `user-decisions-dd.md` Q5).
- The closure validator accepts PR-based close records and still rejects incomplete records (per `vertical-plan.md` S10).
- End-to-end integration works: kickoff opt-in -> metrics enabled -> public skill run -> PR description includes baseline vs candidate metrics (per `vertical-plan.md` S10).
- Unknown consumer-supplied metric dimensions do not crash the skill or the registry path (per `vertical-plan.md` S10; per `horizontal-plan.md` L10).

**Dependencies**

- Requires `S9` because public ship follows proven maintainer-loop validation (per `vertical-plan.md` S10; per `vertical-plan.md` §4).
- Requires `S6` because the MVS acceptance test exercises the full kickoff-opt-in -> metrics-flowing -> public-run path (per TPM review flag on `S10` dependency precision).

**Cross-cutting concern triggers**

- `documentation`:
  - `skills/hive/skills/meta-optimize/SKILL.md`.
  - `.claude-plugin/plugin.json` registration notes.
  - README/GUIDE/skill references for the public command.
  - `hive/hive.config.yaml` docs for metrics opt-in and `meta_optimize:` block, including migrated `meta_optimize.github_forwarding`.
  - Queue schema references and experiment-envelope references exposed to consumers.

## Part 5. File Manifest Master List

The list below deduplicates all file paths named across phases. Paths are grouped by create/modify/archive intent, but some files may move categories during execution depending on whether implementation chooses replace-versus-edit.

### 5.1 Create

- `.pHive/epics/meta-improvement-system/docs/b0-consumer-contract.md` — B0 contract that defines the experiment and query surface for Epic C and later lifecycle code (per `vertical-plan.md` S1).
- `.pHive/metrics/README.md` — shared carrier conventions and retention notes (per `vertical-plan.md` S2).
- `.pHive/metrics/events/README.md` — event-stream storage contract (per `vertical-plan.md` S2).
- `.pHive/metrics/experiments/README.md` — envelope storage contract and mutability rules (per `vertical-plan.md` S2).
- `.pHive/metrics/metrics-event.schema.md` — sparse append-only event schema (per `horizontal-plan.md` L3).
- `.pHive/metrics/experiment-envelope.schema.md` — lean experiment envelope schema (per `user-decisions-dd.md` Q3).
- `hive/lib/metrics/` — shared runtime module root for metrics I/O primitives (per `vertical-plan.md` S2; per Part 2.3 naming convention).
- `hive/references/meta-safety-constraints.md` — shared safety reference extracted from the old charter (per `vertical-plan.md` S3).
- `hive/references/meta-experiment-isolation.md` — authoritative worktree-centric isolation doc (per `vertical-plan.md` S3; per `user-decisions-dd.md` Q4).
- `.pHive/meta-team/archive/2026-04-19/MANIFEST.md` — archive manifest and integrity caveat note (per `vertical-plan.md` S3).
- `.pHive/teams/meta-optimize.yaml` — user-project swarm grants (per `vertical-plan.md` S4).
- `.pHive/teams/meta-meta-optimize.yaml` — maintainer swarm grants (per `vertical-plan.md` S4).
- `.pHive/meta-team/charter-meta-optimize.md` — public swarm charter (per `vertical-plan.md` S4).
- `.pHive/meta-team/charter-meta-meta-optimize.md` — maintainer swarm charter (per `vertical-plan.md` S4).
- `hive/lib/meta-experiment/` — shared lifecycle module root (per `vertical-plan.md` S7; per `architect-hv-review.md` NEW QUESTION 1).
- `hive/lib/meta-experiment/envelope.*` — envelope runtime implementation (per `vertical-plan.md` S7).
- `hive/lib/meta-experiment/baseline.*` — baseline-capture runtime (per `vertical-plan.md` S7).
- `hive/lib/meta-experiment/compare.*` — delta-compare runtime (per `vertical-plan.md` S7).
- `hive/lib/meta-experiment/promotion-adapter.*` — shared adapter interface (per `vertical-plan.md` S7).
- `hive/lib/meta-experiment/rollback-watch.*` — observation-window and auto-revert logic (per `vertical-plan.md` S7).
- `hive/lib/meta-experiment/closure-validator.*` — closure invariant enforcement (per `vertical-plan.md` S7).
- `hive/lib/meta-experiment/README.md` if implementation chooses explicit module docs — shared runtime discovery surface (inference from new module addition).
- `.pHive/meta-team/queue-meta-meta-optimize.yaml` — seeded maintainer backlog (per `vertical-plan.md` S8).
- `.pHive/meta-team/queue-meta-optimize.yaml` — consumer backlog template (per `vertical-plan.md` S8).
- `maintainer-skills/meta-meta-optimize/SKILL.md` — local-only maintainer skill (per `vertical-plan.md` S8; per `user-decisions-dd.md` Q-new-A).
- `skills/hive/skills/meta-optimize/SKILL.md` — shipped public skill (per `vertical-plan.md` S10).
- `.pHive/audits/mvl-proof/{iso-ts}/proof.yaml` — canonical MVL proof artifact for the first live maintainer run (per `vertical-plan.md` S9 BL2.5; per architect review Gap D).
- `.pHive/audits/mvl-proof/latest.yaml` — pointer to the most recent MVL proof artifact (per architect review Gap D).

### 5.2 Modify

- `hive/hive.config.yaml` — add `metrics.enabled`, `metrics.dir`, and later `meta_optimize:`-block documentation including migrated `meta_optimize.github_forwarding` (per `vertical-plan.md` S5; per `user-decisions-dd.md` Q-new-B, Q-new-D).
- `hive/workflows/meta-team-cycle.workflow.yaml` — align rewritten steps and two-swarm semantics (per `vertical-plan.md` S4).
- `hive/workflows/steps/meta-team-cycle/step-01-boot.md` — baseline-capture and kickoff-precondition surface referenced by later proving runs (per architect review Gap C).
- `hive/workflows/steps/meta-team-cycle/step-02-analysis.md` — analysis-stage artifact surface checked for cross-step consistency (per architect review Gap C).
- `hive/workflows/steps/meta-team-cycle/step-03-proposal.md` — proposal-stage surface checked for downstream promotion/close consistency (per architect review Gap C).
- `hive/workflows/steps/meta-team-cycle/step-03b-backlog-fallback.md` — explicit backlog-fallback owner surface (per architect review Gap C).
- `hive/workflows/steps/meta-team-cycle/step-04-implementation.md` — authority-aligned implementation step (per `vertical-plan.md` S4).
- `hive/workflows/steps/meta-team-cycle/step-05-testing.md` — contradiction-free testing step (per `vertical-plan.md` S4).
- `hive/workflows/steps/meta-team-cycle/step-06-evaluation.md` — reviewer-aligned evaluation step (per `vertical-plan.md` S4).
- `hive/workflows/steps/meta-team-cycle/step-07-promotion.md` — unambiguous promotion and revert semantics (per `vertical-plan.md` S4).
- `hive/workflows/steps/meta-team-cycle/step-08-close.md` — closure-validator integration (per `vertical-plan.md` S4).
- `hive/references/meta-team-nightly-cycle.md` — demote to historical/operator narrative (per `vertical-plan.md` S3).
- `.pHive/meta-team/cycle-state.yaml` — clear/reset active state in `S3`, then potentially reintroduce under new schema via later stories (per `vertical-plan.md` S3).
- `.pHive/meta-team/ledger.yaml` — clear/reset active ledger in `S3`, then reintroduce under new schema via later stories (per `vertical-plan.md` S3).
- `.pHive/meta-team/queue.yaml` — clear/reset or replace after archive; legacy single-swarm queue should not remain authoritative (per `vertical-plan.md` S3).
- `.claude-plugin/plugin.json` — prove `maintainer-skills/` exclusion in `S8`, then register `/meta-optimize` in `S10` while preserving exclusion (per `vertical-plan.md` S8, S10).
- `skills/kickoff/SKILL.md` — add metrics opt-in question and brownfield behavior (per `vertical-plan.md` S6; verified present).
- `hive/references/kickoff-protocol.md` — align kickoff persistence and brownfield behavior with the skill prompt (per `vertical-plan.md` S6; verified present).
- `.claude-plugin/plugin.json` — explicit Stop-hook owner file for metrics emission plumbing while preserving interrupt-sentinel behavior (per researcher correction; verified in current repo state).
- Hook helper files introduced by the chosen `.claude-plugin/plugin.json` strategy for agent-spawn, PostToolUse, or session-end metric emission — helper path remains implementation-defined, but not the hook owner surface (per `vertical-plan.md` S5).
- `maintainer-skills/meta-meta-optimize/` helper files — turn scaffold into executable maintainer loop in `S9` (per `vertical-plan.md` S9).
- `skills/hive/skills/meta-optimize/` helper files — complete public orchestration and docs in `S10` (per `vertical-plan.md` S10).
- README/GUIDE/reference docs that explain kickoff, meta skills, metrics, and packaging boundaries — exact doc set implementation-defined but mandatory under the documentation concern (per `.pHive/cross-cutting-concerns.yaml`).

### 5.3 Archive or Replace

- `.pHive/meta-team/archive/2026-04-19/cycle-state.yaml` — archived historical live state (per `vertical-plan.md` S3).
- `.pHive/meta-team/archive/2026-04-19/ledger.yaml` — archived historical ledger (per `vertical-plan.md` S3).
- `.pHive/meta-team/archive/2026-04-19/queue.yaml` — archived historical queue (per `vertical-plan.md` S3).
- `.pHive/teams/meta-team.yaml` — retired single-swarm team file, either archived or deleted after split (per `vertical-plan.md` S4).
- `hive/references/meta-team-sandbox.md` — replaced by `meta-experiment-isolation.md` (per `vertical-plan.md` S3).

### 5.4 Unchanged But Operationally Affected

- `skills/status/SKILL.md` — existing status integration remains relevant and should be verified against the new swarm outputs even if untouched (per `research-brief.md` §2.1; per `architect-memo.md` §1).
- Daily-ceremony step files that present meta-team state — not necessarily edited in MVP, but they consume operator-facing outcomes and should be checked for stale references (per `research-brief.md` §2.1).
- Any tests or tooling that assume `.pHive/meta-team/queue.yaml` is singular — must be checked when split queues land (inference from `horizontal-plan.md` L11).

## Part 6. Risk Registry

The registry below merges the architect memo, design discussion risks, research constraints, audit findings, vertical-plan slice risks, and H-plan punt items. Severity reflects combined blast radius and likelihood for MVP delivery, not long-term strategic importance.

| ID | Description | Severity | Affected Slices | Mitigation |
|---|---|---|---|---|
| R1 | Control-plane self-corruption in `meta-meta-optimize` degrades the optimizer itself. | High | S4, S8, S9 | Worktree default, immutable baseline refs, non-bypassable closure validator, trivial first target, and real revert proof before public ship (per `architect-memo.md` §5; per `vertical-plan.md` S9). |
| R2 | Metrics schema freezes before Epic B query shape is explicit, leading to the wrong carrier. | High | S1, S2 | Keep B0 contract first and require S1 before S2 schema freeze (per `architect-memo.md` §5; per `tpm-sequencing-memo.md` §1). |
| R3 | Token capture surface may be incomplete in the SDK, weakening metric #1 or forcing fallback parsing. | Medium-High | S5 | Treat token capture as feasibility-sensitive; allow `C2.7` spike and follow-on demotion without blocking the rest of MVP metrics (per `research-brief.md` §6; per `tpm-sequencing-memo.md` §2). |
| R4 | Parallel experimentation creates attribution ambiguity. | Deferred / Medium | Post-MVP | Keep serial-by-default and defer parallel mode entirely from MVP (per `user-decisions-dd.md` Q2; per `horizontal-plan.md` PUNT LIST). |
| R5 | One shared policy layer could erase the real asymmetry between maintainer and public swarms. | High | S4, S7, S8, S9, S10 | Share lifecycle runtime only; keep separate charters, teams, promotion adapters, and packaging boundaries (per `architect-memo.md` §5; per `design-discussion.md` §3). |
| R6 | Delayed-regression rollback becomes performative if the revert path is only mocked. | High | S7, S9 | Require `rollback_ref` in envelope and prove a real commit-then-revert in `S9` (per `architect-memo.md` §5; per `architect-hv-review.md` concern 2). |
| R7 | Legacy authority contradictions survive into the rewrite through incomplete step/team alignment. | High | S3, S4 | Archive/reset first, split teams, run closure-property tests, and require Opus review of the rewritten control plane (per `codex-audit-memo.md` TL;DR; per `vertical-plan.md` S4). |
| R8 | Stop-hook slot conflict breaks the interrupt sentinel or yields duplicate/missed metrics at session end. | High | S5 | Decide B3 integration strategy explicitly; prefer one dispatching Stop hook with test coverage for both behaviors, or use a separate mechanism if the Stop-hook contract proves too brittle (per `horizontal-plan.md` stop-hook conflict). |
| R9 | Default-off metrics plus hooks landing before kickoff UX causes operator confusion in brownfield repos. | Medium | S5, S6 | Keep default off, document manual config reality between slices, and land kickoff integration immediately after hooks (per `architect-hv-review.md` concern 1; per `vertical-plan.md` S5-S6). |
| R10 | State-dir hardcodes remain and tempt teams to silently fold resolver work into this epic. | Medium | S2-S10 | Keep state-dir work explicitly out of scope and mark any future incompatibility as a blocker from the resolver epic, not as hidden work here (per planning brief “Known follow-up”; per `horizontal-plan.md` PUNT LIST). |
| R11 | Scheduler boundary is partly external, so scheduled execution assumptions could drift from manual runs. | Medium | S9, S10 | Keep run artifacts scheduler-agnostic and defer scheduler wiring itself (per `design-discussion.md` §4; per `research-brief.md` §6). |
| R12 | Historical `commit: TBD` entry gets lost or silently “fixed,” weakening audit integrity. | Medium | S3 | Preserve the record in archive, add an audit note, and reject the same pattern in the new closure validator (per `user-decisions-dd.md` Q-new-D; per `codex-audit-memo.md` §3.6). |
| R13 | Accidental bundling exposes `meta-meta-optimize` publicly. | High | S8, S10 | Keep the skill under `maintainer-skills/`, add a regression test that `plugin.json` never references it, and preserve that invariant when `/meta-optimize` ships (per `architect-hv-review.md` NEW QUESTION 2; per `vertical-plan.md` S8, S10). |
| R14 | Backlog auto-surfacing scope creeps into MVP because qualitative-signal plumbing exists elsewhere. | Medium | S8, S10 | Keep backlog human-edit-only in MVP and defer auto-surfacing to a follow-on epic (per `user-decisions-dd.md` Q-new-D; per `horizontal-plan.md` PUNT LIST). |
| R15 | Documentation drift leaves operators with stale single-swarm, sandbox, or packaging guidance. | Medium-High | S3-S10 | Apply the `documentation` concern to every story and require per-slice doc targets in story authoring (per `.pHive/cross-cutting-concerns.yaml`). |
| R16 | The public skill’s unknown-dimension tolerance could turn into under-validated input acceptance. | Medium | S10 | Accept unknown dimensions at the registry boundary but still validate required envelope fields and PR-close invariants (per `horizontal-plan.md` L10; per `vertical-plan.md` S10). |
| R17 | A thin verification doc for `S9` would overstate the MVL milestone without enough artifact evidence. | Medium-High | S9 | Require artifact references in the verification doc: commit SHA, metrics snapshot ref, rollback ref, and revert evidence (per `vertical-plan.md` S9; per `structured-outline-production-patterns.md`). |
| R18 | Updating `meta_team.github_forwarding` could be forgotten because it was originally tracked as a “new question” rather than core slice work. | Low-Medium | S4, S10 | Carry the migration into the `meta_optimize:` block in whichever slice touches config documentation and ship-surface docs (per `user-decisions-dd.md` Q-new-D). |
| R19 | Shared closure validator (Epic B L1 lifecycle lib) may overfit to direct-commit evidence shape and reject valid PR-only close records from `/meta-optimize`. Discovered only when L3 first runs. | Moderate | S9, S10 | Closure validator must accept two evidence shapes from the start: (a) `commit_ref` for direct-commit meta-meta runs and (b) `pr_ref` + `pr_state` for PR-only meta-optimize runs. Both satisfy closure only if the corresponding ref is present, a metrics snapshot is persisted, and a rollback target is recorded. |

## Part 7. Elicitation (Team Stress-Test)

### Q1. What happens if metrics capture fails mid-story after the hooks are wired?

The plan treats metrics as evidence-bearing but non-fatal infrastructure for most of MVP. `S5` requires graceful degradation when the substrate is missing, and write-time gating means the hooks should no-op rather than crash the workflow when `metrics.enabled` is false or the carrier path is absent (per `vertical-plan.md` S5). For actual enabled runs, the failure should surface as missing event evidence that blocks close only when the closure invariant depends on the metrics snapshot in later slices, not as a blanket crash at every hook site (inference from `vertical-plan.md` S5, S7, S9).

### Q2. What if the worktree isolation leaks and the maintainer run dirties the main tree?

The plan’s answer is not “be careful”; it is “MVL is not reached unless failure mode is clean.” `S9` acceptance criteria explicitly require worktree-discard cleanliness on failure and a real revert path on regression (per `vertical-plan.md` S9). If the main tree is dirtied by a failed run, that is a slice failure, not an acceptable operator cost, because `meta-meta-optimize` is exactly where control-plane self-corruption risk is highest (per `architect-memo.md` §5 risk 1).

### Q3. What if the token metric cannot be captured reliably from the SDK?

The plans already anticipated that. `S5` includes `C2.7` as a feasibility spike, and the TPM memo explicitly says token capture may need to fall into a follow-on if the current surface is too weak while still allowing the rest of Epic C to land (per `vertical-plan.md` S5; per `tpm-sequencing-memo.md` §2). The MVP is still coherent if the four remaining metric families land and the token metric is demoted with explicit documentation, but the story must say so rather than pretend full coverage.

### Q4. What if the stop-hook slot conflict cannot be resolved cleanly without destabilizing the interrupt sentinel?

Then the plan should fall back to a separate mechanism for metrics rather than break the sentinel, because preserving the existing interrupt behavior is a hard compatibility requirement in `S5` (per `vertical-plan.md` S5 note). The recommended path is still a combined dispatching Stop hook because one authoritative session-end capture point is easier to reason about, but the decision stays open in Part 8 precisely because B3 must force that tradeoff into the open (per `horizontal-plan.md` stop-hook conflict).

### Q5. What happens if the archive/reset slice removes the old live files and some downstream operator surface still expects them?

That is why `S3` archives with manifest instead of hard-deleting history and why the nightly-cycle reference is demoted rather than removed. The research brief found real status and ceremony integration points, so story authoring must verify those surfaces for stale single-file assumptions even if the code path is not rewritten yet (per `research-brief.md` §2.1; per `vertical-plan.md` S3). If a surface truly requires the old active files, that is a valid `S3` blocker, not a reason to leave contradictory active state in place.

### Q6. What if the closure validator is too strict and blocks legitimate public-skill closes because PRs do not look like direct commits?

The plan already expects that asymmetry. `S10` explicitly says the closure validator must accept PR-based close records while still rejecting missing PR references and missing artifact fields (per `vertical-plan.md` S10). The shared runtime owns the invariant shape, but the concrete promotion adapter determines whether the “commit/ref” evidence is a direct commit SHA or a PR head commit plus PR reference (inference from `vertical-plan.md` S9-S10 and `horizontal-plan.md` L8-L10).

### Q7. What if backlog-fallback becomes the permanent happy path because users never enable metrics?

That is acceptable for MVP, but it must be explicit. `Q-new-B` says the user must be told that opting out leaves meta-team runs in qualitative/backlog-driven mode only, and `S6` makes that visible at kickoff (per `user-decisions-dd.md` Q-new-B; per `vertical-plan.md` S6). The system still works in that mode because `Q7` extended the design to include a curated backlog; it just does not deliver metric-driven optimization until the user opts in (per `user-decisions-dd.md` Q7 extension).

### Q8. What if the local-only packaging boundary erodes later and someone registers `maintainer-skills/` accidentally during unrelated plugin work?

The plan defends against that structurally and with regression coverage. `S8` adds the structural placement under `maintainer-skills/` plus a test asserting `plugin.json` contains no such reference, and `S10` preserves that invariant when the public skill is registered (per `vertical-plan.md` S8, S10; per `architect-hv-review.md` NEW QUESTION 2). If that test fails later, the public packaging boundary has regressed in a visible way rather than by convention drift.

### Q9. What if a maintainer asks why we are building a shared lifecycle library before the public skill exists?

Because the shared lifecycle is the real abstraction and the two swarms only differ in policy, promotion, and packaging. The design discussion explicitly argues for one abstract lifecycle and two swarm policies, and the H/V review approved placing the shared runtime before either consumer so the public skill does not fork semantics on day one (per `design-discussion.md` §2, §3; per `architect-hv-review.md` §1, §2). Building `/meta-optimize` first would skip the lower-blast-radius proving step the plan intentionally uses to retire risk.

### Q10. What if the archive audit note for `commit: TBD` creates pressure to “repair” historical records during the rewrite?

The answer is no; the note is a preservation mechanism, not a cleanup task. `Q-new-D` affirmed the optional A1.6 story exactly so the history stays intact while the new closure validator prevents the same failure from recurring (per `user-decisions-dd.md` Q-new-D). Rewriting the old ledger would erase evidence of the control-plane flaw the new system is specifically designed to retire.

### Q11. What if unknown consumer-defined metric dimensions are used to smuggle bad data into the public skill?

The plan only makes unknown dimensions tolerant, not unconstrained. `S10` allows the metric registry to accept consumer-supplied dimensions without crashing, but required envelope fields, close invariants, and PR promotion rules still remain validated by the shared lifecycle and public adapter (per `vertical-plan.md` S10; per `horizontal-plan.md` L10). The tolerance is about schema evolution at the metric edge, not about weakening control-plane invariants.

### Q12. What will we regret two weeks after shipping if we are not explicit now?

The most likely regret is under-specifying the stop-hook decision and letting `S5` discover it live. The second most likely regret is allowing documentation updates to become “best effort” even though the epic rewires charters, step files, queues, schemas, config keys, and public skill surface. `RESOLVED:` the concrete Stop-hook owner file is `.claude-plugin/plugin.json`, whose current inline bash dispatch writes `.pHive/interrupts/{ts}.yaml`; Phase C can author `S5` against that file directly rather than adding a discovery step (per `.pHive/cycle-state/meta-improvement-system.yaml`; verified in current repo state).

## Part 8. Decision Points

The entries below are the sign-off surface for B3. Items already answered by the user are restated here so the outline can be reviewed as a self-contained document. Only `D4` remains materially open.

### D1. [CONFIRM] `meta_team.github_forwarding` migration target

Decision:
- Move the legacy root key into the new `meta_optimize:` block as `meta_optimize.github_forwarding`.

Options:
- Option A: migrate into `meta_optimize.github_forwarding`.
- Option B: leave the key at the root for backward compatibility.

Recommendation:
- Keep Option A. It matches the control-plane rewrite and the signed H/V decision, and it prevents a root-level legacy key from surviving into the new two-swarm surface (per `user-decisions-dd.md` Q-new-D).

User sign-off:
- Already answered as `Affirm / A`.

### D2. [SCOPE] Backlog auto-surfacing in MVP

Decision:
- Backlog exists in MVP, but auto-surfacing from qualitative signals does not.

Options:
- Option A: human-edit-only backlog in MVP, defer auto-surfacing.
- Option B: include auto-surfacing infrastructure now.

Recommendation:
- Keep Option A. It preserves the Q7 extension without turning MVP into an insight-pipeline integration epic (per `user-decisions-dd.md` Q-new-D; per `horizontal-plan.md` PUNT LIST).

User sign-off:
- Already answered as `Affirm / A`.

### D3. [RISK ACCEPTANCE] Historical `commit: TBD` handling

Decision:
- Preserve the broken historical record in archive and add an audit note rather than repairing or deleting it.

Options:
- Option A: archive plus explicit audit note.
- Option B: silently archive without note.
- Option C: rewrite or “fix” the history.

Recommendation:
- Keep Option A. It preserves evidence of the old integrity failure while cleanly separating it from the new closure invariant (per `user-decisions-dd.md` Q-new-D; per `codex-audit-memo.md` §3.6).

User sign-off:
- Already answered as `Affirm / A`.

### D4. [APPROACH] Stop-hook slot conflict resolution

Decision:
- Choose the integration pattern for session-end metrics in `S5`.

Options:
- Option A: combined Stop-hook dispatcher.
  - Modify the existing `.claude-plugin/plugin.json` Stop hook so it becomes a thin dispatcher that invokes both the interrupt sentinel and metrics emission handlers.
  - Pros: one session-end truth point, fewer timing ambiguities, easier to prove “story-end totals” line up with actual stop semantics, preserves current hook slot ownership structurally.
  - Cons: more care needed in handler ordering, idempotency, and failure isolation; a bug in the dispatcher could affect both consumers.
- Option B: separate metrics mechanism.
  - Leave the existing `.claude-plugin/plugin.json` Stop hook sentinel behavior alone and emit story-end metrics via a separate hook entry or adjacent session-end marker / `SessionEnd` / `PostToolUse` flow.
  - Pros: isolates the interrupt sentinel from new code; easier local reasoning if alternate hook semantics are stable.
  - Cons: risks split-brain session-end semantics, duplicate or missing totals, and more complexity correlating “story end” versus “metrics end.”

Recommendation:
- Recommend Option A: combined Stop-hook dispatcher.
- Reasoning: the metric set in `S5` includes story-end wall-clock and token totals, which naturally belong at the same authoritative session-end boundary already occupied by the sentinel. A dispatcher keeps one place for end-of-session semantics, lets tests assert both behaviors in one harness, and avoids inventing a second notion of “run end” that later slices must correlate manually (per `vertical-plan.md` S5 note; per `horizontal-plan.md` stop-hook conflict).
- Guardrails required if Option A is chosen:
  - handler isolation so a metrics failure cannot suppress the sentinel;
  - explicit ordering and idempotency tests;
  - flag-off no-op behavior verified independently from sentinel behavior.

User sign-off:
- Required in B3.

### D5. [CONFIRM] Execution split for Phase C stories

Decision:
- Codex executes implementation and testing work; Claude Opus reviews and peer-validates.

Options:
- Option A: preserve the signed execution split.
- Option B: collapse implementation and review onto one backend.

Recommendation:
- Keep Option A. The user already approved it, and this outline encodes each phase accordingly so story `steps:` authoring will resolve agents to the intended backends without drift (per `user-decisions-dd.md` Q-new-C).

User sign-off:
- Already answered as `Affirm`.

### D6. [SCOPE] Public versus local command surface

Decision:
- Ship `/meta-optimize` only; keep `/meta-meta-optimize` local-only under `maintainer-skills/`.

Options:
- Option A: one shipped + one local.
- Option B: ship both.
- Option C: hide both until later.

Recommendation:
- Keep Option A. It preserves the public boundary while still proving the maintainer loop internally first (per `user-decisions-dd.md` Q6, Q-new-A; per `vertical-plan.md` S8-S10).

User sign-off:
- Already answered as `Affirm`.

### D7. [RISK ACCEPTANCE] Metric #1 feasibility contingency

Decision:
- If SDK limitations block reliable token capture, allow the token metric to fall into a documented follow-on without blocking the rest of MVP.

Options:
- Option A: allow contingency, document reduced MVP coverage.
- Option B: block all of Epic C until token capture is perfect.

Recommendation:
- Recommend Option A. The design discussion and TPM memo both treat token capture as a real risk, but not one that should freeze the entire carrier and hook system if the rest of the MVP metrics are available (per `design-discussion.md` §4; per `tpm-sequencing-memo.md` §2).

User sign-off:
- New sign-off requested only if the user wants stricter blocking behavior than the current plan implies.
