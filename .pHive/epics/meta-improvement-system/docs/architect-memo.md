---
title: Architect stress-test memo — Meta-Improvement System
author: architect (codex-backed)
date: 2026-04-19
epic: meta-improvement-system
phase: Phase A → design discussion prep
inputs:
  - .pHive/planning-briefs/meta-improvement-system.md
  - .pHive/epics/meta-improvement-system/docs/codex-audit-memo.md
  - .pHive/epics/meta-improvement-system/research-drafts/researcher-findings.md
---

# Architect Stress-Test Memo: Meta-Improvement System

## 1. Reconciling the Phase A divergence
Both Phase A inputs are observing something real, but they are talking about different layers.
The researcher is correct at the artifact-existence layer: there is a runnable-looking nightly cycle, the expected files exist under `.pHive/meta-team/`, the ledger and cycle-state are populated, and the workflow has been exercised enough to leave five-cycle-class evidence in the repo. That is enough to call the old system "operationally exercised."
The Codex audit is correct at the control-plane layer: the exercised system is not architecturally coherent enough to serve as the substrate for the new two-swarm model. It contains contradictions in authority, isolation, and closure semantics that matter more than the fact that some runs completed.
Architectural verdict: the nightly cycle is salvageable as a source of reusable artifacts and loop shape, but not as a trustworthy control plane.
What is genuinely salvageable:
- The coarse loop shape is useful: analyze → propose → implement → test → evaluate → promote → close is a recognizable precursor to baseline → hypothesize → experiment → measure → promote.
- The queue concept is useful as a carrier for candidate experiments, especially its source-attribution fields.
- The charter contains reusable safety instincts: no destructive operations, additive schema bias, bounded runtime, explicit human-confirmation boundaries.
- The ledger/cycle-state pair proves there is value in separating "running state" from "historical record."
- The nightly-cycle reference is useful as an operator-facing narrative skeleton for one swarm, once rewritten around experiments instead of document repair.
What is not salvageable as-is:
- The permission model. Step obligations and domain grants disagree on who may write `.pHive/meta-team/cycle-state.yaml`.
- The testing step contract. A step cannot be read-only and also require writes to cycle-state.
- The sandbox contract. Design discussion says worktrees; sandbox reference says file-copy; implementation step uses neither as a first-class invariant.
- The promotion contract. "needs_revision must be reverted" is incompatible with "new file remains but should be treated as incomplete."
- The close-state contract. A cycle cannot be both `status: closed` and `commit: TBD` if commit-before-ledger is mandatory.
The right reconciliation is not "researcher was too optimistic" or "audit was too harsh." The correct statement is:
- The old meta-team can be mined for runtime assets and empirical operator lessons.
- The old meta-team cannot be promoted into the new meta-improvement control model without rebuilding the authority model underneath it.
In practice, that means:
- Salvage artifacts, not invariants.
- Preserve loop vocabulary where it still maps.
- Rebuild permission, isolation, baseline, promotion, and closure semantics around the two-swarm system rather than inheriting the old ones by default.

## 2. Epic C (metrics) architectural decisions
The brief treats Epic C as foundational. That is directionally right, but freezing storage before sketching the consumer contract for Epic B is a sequencing mistake. Epic B is the primary consumer of Epic C, so Epic C must be designed against B's query shape first.
Recommendation 1: produce a thin consumer contract before Epic C schema freeze.
That contract should answer:
- What query compares baseline vs experiment for one swarm run?
- What query compares agent-pair or workflow-version performance across runs?
- What query detects post-promotion regression after a delayed observation window?
- What query is allowed to be expensive, and what must be cheap enough for routine gating?
Recommendation 2: use a dual-schema carrier under a shared metrics directory.
Use `.pHive/metrics/` as the shared carrier, but do not force one schema to serve both hot-path event capture and decision-time experiment summaries.
Inside that directory:
- `events/` should hold append-only JSONL telemetry at fine grain.
- `experiments/` should hold one envelope document per experiment/promotion decision.
This follows the shared-directory / dual-schema pattern:
- One carrier directory keeps audit and tooling simple.
- Distinct filename conventions keep event ingestion and experiment decisions internally coherent.
- Avoid embedding all metrics directly into episode records; the brief already notes episode records were not designed for operational telemetry.
Recommendation 3: event schema should be append-only, sparse, and correlation-first.
Minimum event fields:
- `event_id`
- `timestamp`
- `run_id`
- `swarm_id`
- `story_id` or `proposal_id` when applicable
- `phase`
- `agent`
- `metric_type`
- `value`
- `unit`
- `dimensions` map
- `source`
Rationale:
- Correlation IDs matter more than trying to predict every future metric column.
- Sparse dimensions avoid schema churn while Epic B is still taking shape.
- JSONL append-only storage keeps write paths simple and migration cost low.
Recommendation 4: experiment framework should be serial by default, parallel only inside hardened isolation.
For both swarms, the decision engine should assume one experiment envelope in flight per target branch unless explicit isolation is available.
Reason:
- The current system does not have reliable side-effect isolation.
- Parallel experimentation without hard isolation makes attribution ambiguous.
- Metrics noise is manageable; attribution ambiguity is not.
If parallel execution is later enabled, the contract must require:
- isolated worktree or equivalent branch sandbox per experiment
- distinct run IDs and baseline refs
- no shared mutable state except append-only metrics sink
- explicit merge/promotion serialization
Recommendation 5: baseline capture, promotion threshold, and rollback belong in one experiment envelope.
Do not answer those as separate design questions. Use a single envelope schema:
- `experiment_id`
- `swarm_id`
- `target_ref`
- `baseline_ref`
- `baseline_metrics_ref`
- `candidate_ref`
- `candidate_metrics_ref`
- `threshold_policy_ref`
- `decision`
- `observation_window`
- `rollback_ref`
- `regression_watch`
This makes promotion and delayed rollback part of the same object lifecycle.
Recommendation 6: promotion thresholds must be per-metric, policy-backed, and asymmetrical.
Do not use one global "meaningful improvement" number.
Use policy classes:
- hard-regression metrics: must not worsen beyond tolerance
- primary objective metrics: must improve by configured delta
- observational metrics: recorded but non-blocking until confidence grows
Example architectural rule:
- meta-optimize may require improvement in project objective metrics while holding friction/cost within tolerance.
- meta-meta-optimize may require improvement in harness metrics while holding safety and closure-integrity at zero regression tolerance.
Recommendation 7: rollback detection should be delayed and automated, but rollback execution should remain explicit.
The system should automatically detect regression against the envelope's watch list during the observation window.
The system should not silently revert on first anomaly.
It should mark the promotion as regressing and require an explicit revert action or human confirmation based on swarm risk class.

## 3. Epic A (audit/rebuild) scope recommendation
Epic A should be framed as a control-plane rewrite with selective artifact salvage, not as a contradiction patch pass.
Why "patch the contradictions" is too small:
- The contradictions are not isolated typos. They span state paths, permissions, sandbox design, promotion semantics, and close invariants.
- Those contradictions all touch the same architectural question: what object is authoritative at each phase, and who is allowed to mutate it?
- The new two-swarm model increases, not decreases, the penalty for getting those answers wrong.
Rewrite bucket: rebuild these components conceptually, even if some text is reused.
- `hive/workflows/meta-team-cycle.workflow.yaml`
- `hive/workflows/steps/meta-team-cycle/step-04-implementation.md`
- `hive/workflows/steps/meta-team-cycle/step-05-testing.md`
- `hive/workflows/steps/meta-team-cycle/step-06-evaluation.md`
- `hive/workflows/steps/meta-team-cycle/step-07-promotion.md`
- `hive/workflows/steps/meta-team-cycle/step-08-close.md`
- `hive/references/meta-team-sandbox.md`
- `.pHive/teams/meta-team.yaml`
- `.pHive/meta-team/charter.md` if it is expected to govern both swarms or any experiment-first flow
- `.pHive/meta-team/cycle-state.yaml` schema
- `.pHive/meta-team/ledger.yaml` schema
Patch-or-salvage bucket: keep concepts, rewrite wording/fields around the new model.
- `.pHive/meta-team/queue.yaml` as source-backed candidate registry, but split by swarm and add experiment semantics
- `hive/references/meta-team-nightly-cycle.md` as operator guide skeleton
- historical design docs as non-authoritative rationale sources
Historical-only bucket: preserve for audit context, not forward design.
- old cycle-state contents
- old ledger entries
- design-discussion assumptions tied to `state/meta-team/`
- qualitative evaluation rules that lack measurement semantics
A useful test for Epic A scope:
- If a component defines authority, mutation rights, isolation, promotion, or closure, it belongs in the rewrite bucket.
- If a component merely stores candidate ideas or explains operator flow, it can be salvaged structurally.

## 4. Epic B (two meta swarms) architectural seams
The brief is right that both swarms share the loop. It is incomplete because loop-shape similarity hides major risk asymmetry.
Shared seam: what they should share
- experiment envelope lifecycle
- metrics event carrier conventions
- candidate queue concept
- baseline / measure / compare / promote vocabulary
- common reporting surfaces for run history and decision traceability
- a common orchestrator-facing contract for "what counts as an experiment run"
Hard boundary: what they must not share
- write authority
- isolation policy
- promotion semantics
- rollback trigger policy
- success metrics
- default autonomy level
`meta-optimize` should be treated as external-target optimization.
It acts on user projects.
Its metrics are project-defined and often business-facing.
Its write surface may touch production code.
Its regressions can escape the plugin boundary.
Architectural implications:
- stricter permission model
- target-repo isolation by default
- promotion through PR-style artifacts, not silent direct mutation
- rollback must align to repo-native reversibility, not internal file replacement
- metric definitions are consumer-supplied, so schema contracts must tolerate unknown dimensions
`meta-meta-optimize` should be treated as internal control-plane optimization.
It acts on plugin-hive itself.
Its metrics are harness-defined.
Its change surface is lower cost, but uniquely dangerous because it can degrade the optimizer itself.
Architectural implications:
- strongest closure-integrity requirements
- no tolerance for authority contradictions in the control plane
- delayed regression monitoring must focus on scheduler health, run completion, permission prompts, quality gates, and state integrity
- direct writes may be acceptable inside controlled worktree isolation, but promotion must still preserve clean revertibility
The biggest seam mistake to avoid is "shared implementation because shared loop."
The correct design is:
- one abstract experiment lifecycle
- two swarm policies
- separate authority profiles
- separate metric policy registries
- separate promotion adapters
That gives reuse where the semantics are real, without pretending the risk profile is the same.

## 5. Cross-cutting risks (top 5)
1. Risk: control-plane self-corruption in `meta-meta-optimize`
Likelihood: high
Blast-radius: total; the optimizer can degrade its own scheduling, permissions, or closure invariants
Mitigation: require worktree-class isolation, immutable baseline refs, commit-verifiable close step, and a non-bypassable closure validator before ledger append
2. Risk: telemetry schema frozen before experiment queries are known
Likelihood: high
Blast-radius: high; Epic C becomes either noisy exhaust or insufficient evidence
Mitigation: define Epic B thin consumer contract before Epic C schema freeze; keep event schema append-only and experiment schema separate
3. Risk: parallel experiments produce ambiguous attribution
Likelihood: medium
Blast-radius: high; false positives and false negatives in promotion decisions
Mitigation: serial-by-default experimentation; parallel only with isolated worktrees, separate run IDs, and serialized promotion
4. Risk: one shared policy layer erases swarm risk asymmetry
Likelihood: medium
Blast-radius: high; user-project optimization becomes under-governed or plugin-hive optimization becomes over-constrained in the wrong ways
Mitigation: shared lifecycle, separate swarm policy objects for write scope, rollback rules, threshold classes, and autonomy defaults
5. Risk: delayed-regression rollback becomes performative rather than real
Likelihood: medium
Blast-radius: medium to high; promoted changes remain because the system can observe regressions but not act cleanly
Mitigation: make rollback target a first-class field in the experiment envelope and require the promotion path to prove reversibility before marking a run promotable

## 6. Open architectural questions for user sign-off
1. Should `meta-meta-optimize` require git-worktree isolation by default, or is a file-copy sandbox acceptable for any class of plugin-hive experiments?
2. Should `meta-optimize` be allowed to promote via direct repo mutation in any mode, or must all retained changes exit as PR-style artifacts only?
3. What is the minimum closure invariant for a "successful" experiment run: commit hash present, metrics snapshot persisted, and rollback target recorded, or something stricter?
4. Should the shared metrics carrier live inside the target repo (`.pHive/metrics/`) for both swarms, or should `meta-meta-optimize` use a plugin-hive-internal metrics root while `meta-optimize` writes into the consumer repo?
5. For delayed regression handling, should the system auto-open a revert recommendation when the observation window fails, or should it auto-revert for specific hard-regression metric classes?
6. Do you want one scheduler/orchestrator entrypoint that dispatches to two swarm policies, or two explicitly separate entrypoints with only a shared library beneath them?
