---
revision: 1
review_summary: "researcher: flag (citation hygiene); tpm: flag (parallelism + envelope); architect: flag (closure invariant + envelope unification)"
---

# Design Discussion: Meta-Improvement System

## 1. Goal

The goal is to build a real meta-improvement system for plugin-hive rather than extend the current meta-team by assumption. The target behavior is Karpathy's loop: baseline, hypothesize, experiment, measure, keep-if-better, and revert or reject if not (per planning brief Background and Strategic Decisions Already Made).

The user-facing outcome is two sibling swarms:
- `meta-meta-optimize` for plugin-hive itself.
- `meta-optimize` for user projects with project-defined metrics.

This is not a documentation cleanup effort. It is a control-plane and instrumentation redesign that must preserve the useful runtime assets from the old system without inheriting its contradictions.

The old system is real enough to matter:
- workflow files, queue/state/ledger artifacts, and five recorded cycles exist (research brief §2.1),
- and separate design analysis found the control plane internally inconsistent on permissions, sandboxing, promotion, and closure (architect memo §1; audit §§3.2-3.6).

Done, at a high level, looks like:
- Epic C provides measurable baseline/run/promotion data.
- Epic A replaces the old control plane with coherent authority and close semantics.
- Epic B ships one shared experiment lifecycle with two distinct swarm policies.

For this phase, success is narrower:
- decide salvage vs rebuild,
- agree on delivery shape and sequencing,
- surface the binding questions before story authoring.

## 2. Proposed Approach

Recommendation: rebuild the control plane with selective artifact salvage. Do not patch contradictions forward as one unit.

The proposed shape has three parts.

First, add a small B0 design sliver ahead of the main epics. B0 defines the consumer contract for metrics:
- baseline vs candidate query shape,
- run-over-run comparison shape,
- experiment envelope fields,
- threshold and rollback policy references.

This is the TPM's key sequencing correction and should be treated as a hard prerequisite for Epic C schema freeze (TPM memo §1; architect memo §2 recommendation 1).

Second, run Epic C and Epic A in parallel after B0.
- Epic C builds `.pHive/metrics/` as a dual carrier: append-only event telemetry plus experiment envelopes (architect memo §2).
- Epic A rewrites the old meta-team workflow, role permissions, isolation contract, promotion semantics, close semantics, and governing schemas (architect memo §3; audit §§3.2-3.6).

Third, build Epic B on top of both.
Epic B should stay one epic because the shared experiment lifecycle is real, even though the swarm policies are different (architect memo §4; TPM memo §4).
Internal shape:
- Layer 1: shared lifecycle library.
- Layer 2: `meta-meta-optimize` first.
- Layer 3: `meta-optimize` second.

The salvage/rebuild split should be explicit.

Salvage:
- loop vocabulary and broad phase shape,
- queue/source-attribution concepts,
- charter safety instincts,
- the split between active cycle state and historical record,
- existing status-surface integration points (research brief §2.1; TPM memo §3).

Rebuild:
- workflow authority model,
- role write grants,
- sandbox/isolation contract,
- promotion/revert contract,
- close-state invariants,
- schemas that must now carry experiments and metrics rather than qualitative repair logs (architect memo §§1-3; audit §§3.2-3.6).

Recommended delivery order:
1. B0 consumer contract.
2. In parallel: Epic C schema/storage primitives and Epic A rewrite/salvage split.
3. Epic C event emitters and read/query surface after C schema/storage merge.
4. Epic B Layer 1 shared lifecycle after Epic C schema/storage and Epic A merge.
5. Epic B Layer 2 `meta-meta-optimize` on a low-risk proving run first.
6. Epic B Layer 3 `meta-optimize`.

This preserves the planning brief's "C is foundational" intent while accepting the architect and TPM correction that B's query contract must shape C before C is frozen.

## 3. Why This Shape

The main reason is that the current meta-team is operationally exercised but not architecturally trustworthy. The research brief is right about the first half: there is a live-looking workflow, populated runtime state, and five cycles of evidence (research brief §2.1). The audit is right about the second half: that runtime sits on contradictory permissions, conflicting sandbox models, broken promotion semantics, and a close state that can claim success with `commit: TBD` (audit §§3.2-3.6). The architect memo resolves this correctly: salvage artifacts and operator lessons, but rebuild the authority model underneath them (architect memo §1).

The second reason is metrics sequencing. The planning brief correctly treats metrics as foundational, but the architect memo is right that telemetry should be designed against the experiment consumer rather than as a free-standing storage exercise (planning brief Execution order; architect memo §2). The TPM's B0 sliver is therefore not process overhead; it is the mechanism that keeps Epic C from hardening the wrong schema (TPM memo §1).

The third reason is swarm asymmetry. The shared loop is real, but the risk profile is not:
- `meta-optimize` touches user projects, uses project-defined metrics, and should promote through PR-style artifacts.
- `meta-meta-optimize` touches plugin-hive, uses harness metrics, and needs stronger closure-integrity guarantees (architect memo §4).

If the design shares implementation too aggressively, the public swarm becomes under-governed or the internal swarm inherits the wrong defaults. The right abstraction is shared lifecycle plus separate policy surfaces.

The fourth reason is that the old qualitative traces are not enough for the new objective. Episode records, cycle-state, circuit breakers, and insights are useful breadcrumbs, but they do not provide token, cost, wall-clock, timeout, threshold, or delta data (research brief §§3-4). Retrofitting the Karpathy loop onto those artifacts without a new metrics carrier would create a system that sounds quantitative while still deciding qualitatively.

This approach also reconciles the researcher/audit divergence cleanly:
- the researcher is right that repo-transfer breakage is a red herring and that there is useful runtime infrastructure to learn from (research brief Executive Summary and §2.3),
- the audit is right that patching forward as one unit would preserve the wrong abstraction boundary and overstate current integrity (audit TL;DR).

The TPM memo adds the practical delivery constraint: parallelism exists, but only after the real serializations are honored. The real gates are B0 before C1, A rewrite before the first real Layer 2 cycle, and C schema/storage before baseline/compare logic can be trusted (TPM memo §§1, 5, and 7).

## 4. Risks and Unknowns

`High` Control-plane self-corruption in `meta-meta-optimize`.
If the internal swarm can mutate its own workflows, permissions, or close semantics without hard isolation and closure checks, the optimizer can degrade itself while appearing to succeed (architect memo §5 risk #1).
Mitigation:
- worktree-class isolation by default,
- immutable baseline refs,
- commit-verifiable close step,
- non-bypassable closure validator before ledger append.

`High` Epic C schema freeze before B's consumer contract exists.
That would produce telemetry exhaust that does not answer promotion questions (architect memo §5 risk #2; TPM memo §1).
Mitigation:
- B0 before C1,
- dual-schema carrier,
- sparse append-only event records,
- MVP metric set before long-tail metrics.

`High` Researcher vs audit interpretation drift.
Research frames the current system as salvageable infrastructure with missing metrics; audit frames it as a structurally unreliable control plane (research brief §2.3; audit TL;DR).
Mitigation:
- salvage runtime shape and evidence-bearing assets,
- rebuild any file or schema that defines mutation authority, isolation, promotion, or closure.

`Medium` Parallel experiments before isolation is proven.
The repo has worktree support elsewhere and a sandbox reference, but the active meta-team does not enforce one coherent isolation model (research brief §5.2; audit §3.2).
Mitigation:
- serial experiments by default,
- no parallel mode until isolation, baseline refs, and promotion serialization are proven.

`Medium` Token instrumentation may be partially unavailable.
The research brief flags Claude Code SDK token visibility as the biggest Epic C instrumentation risk (research brief §6).
Mitigation:
- treat token capture as an Epic C3 design item,
- do not block all of Epic C on perfect token accounting,
- allow a follow-on if the capture surface is incomplete.

`Medium` Scheduler boundary is partly external.
Phase A could not verify the full nightly trigger path from repo code alone (research brief §6).
Mitigation:
- design identical artifacts for manual and scheduled runs,
- defer scheduler-specific guarantees until the runtime owner confirms that boundary.

`Medium` `paths.state_dir` is a real dependency but remains out of scope.
The planning brief explicitly defers this to a separate resolver epic.
Mitigation:
- keep this design state-dir-aware,
- do not silently absorb resolver work into A/C/B,
- mark any dependent stories as blocked by the resolver epic rather than folding it in.

## 5. Dependencies and Constraints

Cross-epic dependencies:
- B0 consumer contract must land before Epic C schema freeze (TPM memo §1; architect memo §2).
- Epic A rewrite must land before the first real Epic B Layer 2 cycle, because the new swarm cannot run against contradictory step and permission files (TPM memo §4; audit §§3.3-3.6).
- Epic C schema/storage must land before Epic B baseline capture and compare logic can be trusted (architect memo §2; TPM memo §§2 and 4).

Internal dependencies:
- `.pHive/meta-team/queue.yaml` is reusable only after swarm scoping and experiment semantics are added (research brief §5.1; architect memo §3).
- Historical ledger and cycle-state files should be archived or explicitly demoted before new schema assumptions are introduced, otherwise old "closed" records with unresolved invariants will pollute validation (audit §3.6; TPM memo §3).
- The `paths.state_dir` resolver remains deferred and out of scope even though many `.pHive/` variants are hardcoded today (planning brief Known follow-up).

External dependencies:
- Claude Code SDK token visibility may cap first-pass Epic C coverage (research brief §6).
- The actual scheduler/trigger mechanism appears partly external to the repo (research brief §6).

Policy constraints:
- `meta-optimize` and `meta-meta-optimize` should not share write authority or promotion semantics just because they share lifecycle vocabulary (architect memo §4).
- Promotion should remain explicit and reversible; delayed regression detection can be automated, but rollback execution should not default to silent automatic reverts (architect memo §2).

## 6. Open Questions

Q1-Q6 are binding and should be resolved before story authoring. Q7-Q9 can be deferred if needed.

1. `Binding` Where should metrics live: append-only JSONL events plus experiment envelopes under `.pHive/metrics/`, or some materially different carrier? Current recommendation: the architect's dual-schema shared directory (planning brief Q1; architect memo §2).
2. `Binding` Should experiments be serial by default across both swarms, with any parallel mode gated on hardened isolation? Current recommendation: yes (planning brief Q2; architect memo §2).
3. `Binding` Do you agree the experiment envelope contract should define both required fields and lifecycle gates? Sign off on:
   - baseline fields: baseline ref, candidate ref, commit/ref, metrics snapshot, policy ref/class, decision output, rollback target (`rollback_ref`), observation window, and `regression_watch`, plus any additional minimal identifiers the architect memo calls for (planning brief Q3-Q5; architect memo §2 recommendation 5);
   - threshold policy: per-metric policy classes with asymmetric tolerances unless you want a simpler model (planning brief Q4; architect memo §2);
   - delayed-regression handling: whether `regression_watch` produces an auto-open revert recommendation, an explicit human-confirmed revert path, or an auto-revert only for a narrow hard-regression class (planning brief Q5; architect memo §§2 and 6);
   - closure invariant: a cycle cannot declare closed unless commit/ref is present, metrics snapshot is persisted, rollback target is recorded, and a gate blocks ledger append if any are missing;
   - gate failure behavior: what the system records and who must intervene when that closure gate fails (architect memo §6 Q3).
4. `Binding` Should `meta-meta-optimize` require git-worktree isolation by default, or is any file-copy sandbox acceptable for some experiment class? Current recommendation: worktree by default (architect memo §6 Q1; audit §3.2).
5. `Binding` Should `meta-optimize` ever be allowed to promote via direct repo mutation, or must all retained changes leave the system as PR-style artifacts only? Current recommendation: PR-style only (architect memo §6 Q2).
6. `Binding` Do you want one orchestrator entrypoint with two swarm policies beneath it, or two explicit entrypoints sharing a lifecycle library? This changes both implementation and operator surface area (architect memo §6 Q6).
7. `Deferrable` Should the first `meta-meta-optimize` end-to-end cycle be limited to a no-op or nearly no-op experiment as a proving run before real self-modification starts? This is a new synthesis recommendation based on TPM sequencing risk (TPM memo §7).
8. `Deferrable` Which of the planning brief's long-tail metrics are required for Epic C MVP versus follow-on work? Current recommendation: keep MVP to five metrics and defer the rest (planning brief Metrics to Instrument; TPM memo §2).
9. `Deferrable` How should historical `.pHive/meta-team/` assets be presented after rewrite: archived with manifest, preserved read-only in place, or partially migrated into new references? This is a new synthesis question because the rewrite/salvage boundary affects later operator clarity (TPM memo §3).

## 7. Verification Strategy

VERIFICATION PLAN:
  Tools: repo-local workflow/schema validation, targeted path/permission audits, fixture-based metrics write/read checks, and existing markdown/yaml validation already used in this repo.
  Platforms: local plugin-hive workspace first; later one controlled plugin-hive run and one controlled consumer-repo run.
  Automated: event/envelope schema validation, permission-to-obligation consistency checks, close-step invariant checks, and tests around metrics primitives.
  Manual: design review of swarm policy boundaries, first end-to-end no-op `meta-meta-optimize` cycle, and operator review of reporting surfaces.
  Not verifying: production-grade parallel experiment execution in the first pass, and perfect token accounting unless Epic C proves the SDK surface exists.

The first acceptance checks should focus on contract coherence rather than output polish:
- the rewritten workflow must not ask agents to perform writes their team file forbids,
- the close step must not record success without satisfying commit/ledger invariants,
- event and experiment artifacts must correlate by run ID and baseline/candidate refs,
- the two swarms must share lifecycle structure without sharing unsafe policy defaults.

The first live cycle should be a deliberately trivial `meta-meta-optimize` experiment. That gives a way to validate baseline capture, telemetry, promotion, and rollback traceability before any substantive self-modifying change is allowed (TPM memo §7).

## 8. Scale Assessment

This is `Large`.

Why:
- it spans three sub-epics plus a B0 contract sliver with real dependency edges, not one linear patch (TPM memo §§1 and 5),
- it touches multiple subsystems: workflow control plane, team permissions, charter/policy docs, metrics substrate, and two new swarm skills,
- it includes foundational infrastructure, a control-plane rewrite, and a new shared abstraction layer,
- it carries unresolved design questions that change story shapes, not just implementation details,
- and it has at least one external constraint that may force scope adjustment later: token instrumentation through the Claude Code SDK surface (research brief §6).

SCALE ASSESSMENT:
  Files affected: likely dozens across workflow steps, team configs, references, schemas, metrics paths, and new skill surfaces
  Subsystems: meta-team control plane, metrics instrumentation, experiment lifecycle, plugin-hive swarm, user-project swarm
  Migration required: yes
  Cross-team coordination: yes
  Unknowns: 9 open questions, with 6 binding before story authoring

  RECOMMENDATION: Needs structured outline
  RATIONALE: This is a multi-system redesign with phased sequencing, policy forks, historical-asset handling, and control-plane replacement. A structured outline is needed to keep C/A/B boundaries and swarm-specific policy work from collapsing into one oversized implementation epic.
