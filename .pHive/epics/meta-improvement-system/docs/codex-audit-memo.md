---
title: Meta-team audit — Codex diagnostic memo
author: codex
date: 2026-04-19
epic: meta-improvement-system
phase: Phase A (research)
---

# 1. TL;DR Verdict

The stale `hom-hq` problem is a red herring in the current tree: a repo-wide grep on 2026-04-19 found zero matches for `hom-hq`, so there is no live `hom-hq` string to fix. The actual breakage is deeper: the meta-team design artifacts still describe one system rooted at `state/meta-team/`, while the live workflow, charter, queue, ledger, and status integration run from `.pHive/meta-team/` ([.pHive/design-discussion-meta-team.md:78-79](../design-discussion-meta-team.md), [.pHive/design-discussion-meta-team.md:116-124](../design-discussion-meta-team.md), [.pHive/meta-team/charter.md:32](../../meta-team/charter.md), [.pHive/meta-team/charter.md:87-91](../../meta-team/charter.md), [hive/references/meta-team-nightly-cycle.md:29-34](../../../hive/references/meta-team-nightly-cycle.md), [skills/status/SKILL.md:109-126](../../../skills/status/SKILL.md)).

The active runtime is partially real but internally contradictory. The workflow steps instruct agents to write `cycle-state.yaml` in phases where the team config denies those agents write access, and the testing step explicitly says "Read-only access in this step — do NOT modify any files" while also requiring a write to `.pHive/meta-team/cycle-state.yaml` ([hive/workflows/steps/meta-team-cycle/step-05-testing.md:7](../../../hive/workflows/steps/meta-team-cycle/step-05-testing.md), [hive/workflows/steps/meta-team-cycle/step-05-testing.md:25](../../../hive/workflows/steps/meta-team-cycle/step-05-testing.md), [hive/workflows/steps/meta-team-cycle/step-05-testing.md:95-102](../../../hive/workflows/steps/meta-team-cycle/step-05-testing.md), [.pHive/teams/meta-team.yaml:66-80](../../teams/meta-team.yaml), [.pHive/teams/meta-team.yaml:82-93](../../teams/meta-team.yaml)).

Verdict: do not "patch forward" the whole meta-team as one unit. Rebuild the control model around the new two-swarm Karpathy loop, salvage a few runtime assets as raw material, and treat the April design docs as historical input rather than authoritative implementation guidance.

# 2. Stale hom-hq References

Audit result: `rg -n --hidden --glob '!.git' 'hom-hq' /Users/don/Documents/plugin-hive` returned no matches on 2026-04-19.

| file | line | text | classification |
|---|---:|---|---|
| No matches found | n/a | Repo-wide grep returned zero `hom-hq` hits. | None |

Conclusion: Q1's "stale hom-hq references" list is empty. Any current failure is coming from other structural drift, not from lingering `hom-hq` strings.

# 3. Other Structural Breakage

## 3.1 Path model split: `state/meta-team/` vs `.pHive/meta-team/`

The most important structural break is path bifurcation.

- The design discussion says the ledger lives at `state/meta-team/ledger.yaml` and that "The Meta Team persists all working state to `state/meta-team/`" ([.pHive/design-discussion-meta-team.md:78-79](../design-discussion-meta-team.md), [.pHive/design-discussion-meta-team.md:116-124](../design-discussion-meta-team.md)).
- The research brief frames continuity the same way, listing `state/meta-team/` as the persistence option for D7 ([.pHive/research-brief-meta-team.md:140-143](../research-brief-meta-team.md)).
- The live charter instead authorizes writes under `.pHive/meta-team/` and names `.pHive/meta-team/cycle-state.yaml` and `.pHive/meta-team/ledger.yaml` as the output artifacts ([.pHive/meta-team/charter.md:32](../../meta-team/charter.md), [.pHive/meta-team/charter.md:87-91](../../meta-team/charter.md)).
- The runtime guide also bootstraps from `.pHive/meta-team/...`, not `state/meta-team/...` ([hive/references/meta-team-nightly-cycle.md:29-34](../../../hive/references/meta-team-nightly-cycle.md), [hive/references/meta-team-nightly-cycle.md:51-77](../../../hive/references/meta-team-nightly-cycle.md)).
- Filesystem audit confirms the split is not hypothetical: `.pHive/meta-team/ledger.yaml` exists, while `state/meta-team/ledger.yaml`, `state/meta-team/queue.yaml`, `state/meta-team/cycle-state.yaml`, and `state/meta-team/morning-summary.md` are missing.

Classification: Fatal. This is an active runtime/documentation divergence, not an archived note.

## 3.2 Sandbox design mismatch

Two incompatible sandbox models are documented.

- The design discussion mandates a git-worktree sandbox, one worktree per proposal, with tags and cherry-picks ([.pHive/design-discussion-meta-team.md:46-54](../design-discussion-meta-team.md), [.pHive/design-discussion-meta-team.md:196-213](../design-discussion-meta-team.md)).
- The sandbox reference instead describes a file-copy sandbox rooted at `.pHive/meta-team/sandbox/{proposal_id}/{target_filename}` ([hive/references/meta-team-sandbox.md:23-46](../../../hive/references/meta-team-sandbox.md), [hive/references/meta-team-sandbox.md:56-69](../../../hive/references/meta-team-sandbox.md)).
- The live filesystem currently has no `.pHive/meta-team/sandbox` directory.
- The implementation step does not invoke either sandbox model; it instructs direct writes and immediate logging to `cycle-state.yaml` ([hive/workflows/steps/meta-team-cycle/step-04-implementation.md:17](../../../hive/workflows/steps/meta-team-cycle/step-04-implementation.md), [hive/workflows/steps/meta-team-cycle/step-04-implementation.md:45-73](../../../hive/workflows/steps/meta-team-cycle/step-04-implementation.md)).

Classification: Fatal. The safety story is inconsistent in active docs and absent in the active implementation step.

## 3.3 Team permissions do not match workflow step obligations

The team file and the step files disagree about who can write what.

- Step 4 requires the `developer` to "append to `.pHive/meta-team/cycle-state.yaml`" after each change ([hive/workflows/steps/meta-team-cycle/step-04-implementation.md:64-73](../../../hive/workflows/steps/meta-team-cycle/step-04-implementation.md)).
- The `developer` domain grants write access to `hive/references/**`, `hive/agents/**`, `hive/workflows/**`, `skills/**`, and `.pHive/teams/**`, but not `.pHive/meta-team/**` ([.pHive/teams/meta-team.yaml:38-65](../../teams/meta-team.yaml)).
- Step 5 requires the `tester` to append `test_results` to `.pHive/meta-team/cycle-state.yaml` ([hive/workflows/steps/meta-team-cycle/step-05-testing.md:95-102](../../../hive/workflows/steps/meta-team-cycle/step-05-testing.md)).
- The `tester` domain is read-only across `hive/**`, `skills/**`, and `.pHive/**` ([.pHive/teams/meta-team.yaml:66-80](../../teams/meta-team.yaml)).
- Step 6 requires the `reviewer` to append evaluations to `.pHive/meta-team/cycle-state.yaml` ([hive/workflows/steps/meta-team-cycle/step-06-evaluation.md:78-88](../../../hive/workflows/steps/meta-team-cycle/step-06-evaluation.md)).
- The `reviewer` domain has no `.pHive/**` write access at all ([.pHive/teams/meta-team.yaml:82-93](../../teams/meta-team.yaml)).

Classification: Fatal. The active pipeline cannot be executed as written without violating its own domain controls.

## 3.4 Step 5 contains a direct self-contradiction

The testing step says:

- "Read-only access in this step — do NOT modify any files" ([hive/workflows/steps/meta-team-cycle/step-05-testing.md:7](../../../hive/workflows/steps/meta-team-cycle/step-05-testing.md)).
- "`NOT available:` Write access to any files" ([hive/workflows/steps/meta-team-cycle/step-05-testing.md:24-26](../../../hive/workflows/steps/meta-team-cycle/step-05-testing.md)).
- Then: "Append to `.pHive/meta-team/cycle-state.yaml`" ([hive/workflows/steps/meta-team-cycle/step-05-testing.md:95-102](../../../hive/workflows/steps/meta-team-cycle/step-05-testing.md)).

Classification: Fatal. This is not a judgment call; the step is internally impossible.

## 3.5 Promotion semantics break the stated keep/discard model

Promotion step rules conflict with themselves.

- Mandatory rule: "`needs_revision` changes MUST be reverted" and "Reverting means restoring the prior file content" ([hive/workflows/steps/meta-team-cycle/step-07-promotion.md:5-10](../../../hive/workflows/steps/meta-team-cycle/step-07-promotion.md)).
- Actual procedure for a newly created bad file: "The file will remain but should be treated as incomplete" ([hive/workflows/steps/meta-team-cycle/step-07-promotion.md:35-39](../../../hive/workflows/steps/meta-team-cycle/step-07-promotion.md)).

Classification: Fatal. The step no longer implements a clean baseline → experiment → keep-if-better/discard loop.

## 3.6 The recorded cycle claims closure without a real commit hash

The charter requires: "Commit all changes with descriptive messages prefixed `[meta-team]`" ([.pHive/meta-team/charter.md:44](../../meta-team/charter.md)).

The close step requires:

- "Commit BEFORE writing the ledger entry" ([hive/workflows/steps/meta-team-cycle/step-08-close.md:8-9](../../../hive/workflows/steps/meta-team-cycle/step-08-close.md)).
- The ledger entry must include `commit: {git commit hash}` ([hive/workflows/steps/meta-team-cycle/step-08-close.md:81-97](../../../hive/workflows/steps/meta-team-cycle/step-08-close.md)).

But the latest ledger entry is:

- `commit: TBD` for `meta-2026-04-13` ([.pHive/meta-team/ledger.yaml:52-70](../../meta-team/ledger.yaml)).

At the same time, the cycle state records `status: closed` and `cycle_verdict: passed` for that same run ([.pHive/meta-team/cycle-state.yaml:1-5](../../meta-team/cycle-state.yaml), [.pHive/meta-team/cycle-state.yaml:455-486](../../meta-team/cycle-state.yaml)).

Classification: Fatal. The live records say a cycle was fully promoted and closed while the mandatory commit invariant is unresolved.

## 3.7 The archive exists but carries no historical substance

- The requested archive directory exists.
- Its only file is `.pHive/meta-team/archive/.gitkeep`, and that file is empty.

Classification: Stale-but-harmless. The archive path is not broken, but it contributes no usable historical evidence.

# 4. Artifact-by-Artifact Analysis

## 4.1 `.pHive/meta-team/charter.md`

Evidence:

- Mission is plugin self-optimization, not project optimization: "Self-optimize the Hive plugin" ([.pHive/meta-team/charter.md:9](../../meta-team/charter.md)).
- Scope is plugin-internal domains such as `hive/references/`, `hive/agents/`, `hive/workflows/`, `skills/`, `.pHive/meta-team/`, `.pHive/teams/` ([.pHive/meta-team/charter.md:23-34](../../meta-team/charter.md)).
- It explicitly excludes user project `.pHive/` directories ([.pHive/meta-team/charter.md:48-53](../../meta-team/charter.md)).

Translates cleanly to two-swarm model:

- The hard constraints are reusable: no destructive operations, additive schema changes, budget window, no secrets, explicit human-confirmation boundaries ([.pHive/meta-team/charter.md:37-45](../../meta-team/charter.md)).
- The quality bar is close to a Karpathy loop gate: named issue, no breakage, no functionality loss, reviewer gate ([.pHive/meta-team/charter.md:70-82](../../meta-team/charter.md)).

Fundamentally incompatible:

- It is chartered for one plugin-only swarm, not two sibling swarms. The out-of-scope line for user project `.pHive/` directories directly conflicts with the planned public `meta-optimize` swarm ([.pHive/meta-team/charter.md:48-53](../../meta-team/charter.md)).
- It optimizes "coverage" and "tooling" in a generic quality-doc sense, not the stronger baseline → hypothesize → experiment → measure → keep-if-better → PR protocol ([.pHive/meta-team/charter.md:13-20](../../meta-team/charter.md)).

Path-transfer issues:

- Mostly none inside this file; `.pHive/meta-team/...` is aligned with the live runtime.

Verdict:

- Targeted patch if this file were being kept only for the plugin-hive `meta-meta-optimize` swarm.
- Full rewrite if this file is expected to serve both sibling swarms. The scope model is single-swarm by construction.

## 4.2 `.pHive/meta-team/cycle-state.yaml`

Evidence:

- The live cycle records a complete eight-phase run ending `status: closed` and `cycle_verdict: passed` ([.pHive/meta-team/cycle-state.yaml:1-5](../../meta-team/cycle-state.yaml), [.pHive/meta-team/cycle-state.yaml:455-486](../../meta-team/cycle-state.yaml)).
- Findings and proposals are mostly "missing memory" and persona-doc additions, not measured experiments against baseline metrics ([.pHive/meta-team/cycle-state.yaml:17-134](../../meta-team/cycle-state.yaml), [.pHive/meta-team/cycle-state.yaml:136-246](../../meta-team/cycle-state.yaml)).
- Testing records only structural checks like `cross_reference_integrity`, `schema_compliance`, and `content_safety` ([.pHive/meta-team/cycle-state.yaml:333-380](../../meta-team/cycle-state.yaml)).

Translates cleanly:

- The phase log format is a useful audit trail skeleton.
- Proposal metadata such as `impact_score`, `risk_score`, `effort_score`, and implementation plans can be repurposed as experiment metadata ([.pHive/meta-team/cycle-state.yaml:136-246](../../meta-team/cycle-state.yaml)).

Fundamentally incompatible:

- It records content-production work, not experiment-loop work. There is no explicit hypothesis, no baseline capture, no post-change measurement, and no PR artifact.
- The pass/fail basis is mostly structural compliance, which is insufficient for either `meta-optimize` or `meta-meta-optimize` if the intent is measurable improvement.

Path-transfer issues:

- None; this file already lives under `.pHive/meta-team/`.

Verdict:

- Full rewrite of the schema for the new system.
- Keep only as historical evidence of what the old meta-team actually did.

## 4.3 `.pHive/meta-team/queue.yaml`

Evidence:

- The queue stores prioritized optimization targets with descriptions, source attribution, status, and completion notes ([.pHive/meta-team/queue.yaml:6-84](../../meta-team/queue.yaml)).
- Current targets are single-team plugin maintenance items like `hive/gate-policies/`, `hive/agents/tester.md`, and `hive/agents/technical-writer.md` ([.pHive/meta-team/queue.yaml:7-69](../../meta-team/queue.yaml)).

Translates cleanly:

- A queue of candidate experiments is still useful in a Karpathy loop.
- `source`, `source_attribution`, and `source_evidence` are worth preserving as evidence fields ([.pHive/meta-team/queue.yaml:15-20](../../meta-team/queue.yaml), [.pHive/meta-team/queue.yaml:36-41](../../meta-team/queue.yaml)).

Fundamentally incompatible:

- It has no fields for baseline metric, hypothesis, experiment owner, decision threshold, or PR status.
- It assumes one backlog for one meta-team, not two sibling swarms with different target domains and success metrics.

Path-transfer issues:

- None inside the file.

Verdict:

- Targeted patch is possible only if the queue is narrowed to "candidate experiments" and split by swarm.
- In practice, I would rewrite the schema because the missing experiment semantics are not incidental.

## 4.4 `hive/references/meta-team-nightly-cycle.md`

Evidence:

- It presents the eight-phase runtime as the integration guide ([hive/references/meta-team-nightly-cycle.md:7-20](../../../hive/references/meta-team-nightly-cycle.md)).
- It bootstraps from `.pHive/meta-team/...`, `.pHive/teams/meta-team.yaml`, and `hive/workflows/meta-team-cycle.workflow.yaml` ([hive/references/meta-team-nightly-cycle.md:24-45](../../../hive/references/meta-team-nightly-cycle.md)).
- It tells operators to tune step files and charter scope directly ([hive/references/meta-team-nightly-cycle.md:81-96](../../../hive/references/meta-team-nightly-cycle.md)).

Translates cleanly:

- The separation into boot, analysis, proposal, implementation, testing, evaluation, promotion, close maps loosely to a baseline/hypothesis/experiment/measure/keep loop.
- The monitoring section and the idea of reviewing morning output are still useful ([hive/references/meta-team-nightly-cycle.md:99-108](../../../hive/references/meta-team-nightly-cycle.md)).

Fundamentally incompatible:

- It describes one autonomous nightly system for the plugin itself, not two sibling swarms with different write domains.
- It still treats the cycle as a doc/config repair engine rather than a disciplined experiment engine.

Path-transfer issues:

- This guide is path-consistent with the current runtime and therefore not the main path bug.

Verdict:

- Targeted patch if salvaged as the operator guide for `meta-meta-optimize` only.
- Full rewrite if intended as the umbrella guide for both new swarms.

## 4.5 `hive/references/meta-team-sandbox.md`

Evidence:

- It defines sandbox copies under `.pHive/meta-team/sandbox/{proposal_id}/{target_filename}` ([hive/references/meta-team-sandbox.md:23-32](../../../hive/references/meta-team-sandbox.md)).
- It promotes by copying from sandbox to live path and deleting the sandbox copy on success ([hive/references/meta-team-sandbox.md:43-52](../../../hive/references/meta-team-sandbox.md)).
- It says cleanup happens during close step and all sandbox files are deleted after cycle close ([hive/references/meta-team-sandbox.md:56-69](../../../hive/references/meta-team-sandbox.md)).

Translates cleanly:

- The idea that risky edits need isolation before promotion is valid.
- Risk-based routing (`risk_score ≤ 2` direct, `risk_score ≥ 3` sandbox) is a reusable policy idea ([hive/references/meta-team-sandbox.md:72-83](../../../hive/references/meta-team-sandbox.md)).

Fundamentally incompatible:

- Copy-file sandboxing is too weak for a PR-centered loop that needs reproducible before/after baselines and clean discards.
- It conflicts with the design discussion's worktree-based safety model, so it cannot be trusted as the system's true sandbox contract.

Path-transfer issues:

- The only path issue here is practical: `.pHive/meta-team/sandbox/` is currently absent in the filesystem.

Verdict:

- Full rewrite. The sandbox contract is conceptually unstable and operationally unimplemented.

## 4.6 `.pHive/design-discussion-meta-team.md`

Evidence:

- It explicitly claims Karpathy inspiration and describes a five-agent nightly loop ([.pHive/design-discussion-meta-team.md:11-15](../design-discussion-meta-team.md)).
- It hardcodes a single Meta Team optimizing Hive itself ([.pHive/design-discussion-meta-team.md:25-27](../design-discussion-meta-team.md), [.pHive/design-discussion-meta-team.md:170](../design-discussion-meta-team.md)).
- It centers state under `state/meta-team/` and user review at `state/meta-team/morning-summary.md` ([.pHive/design-discussion-meta-team.md:78-79](../design-discussion-meta-team.md), [.pHive/design-discussion-meta-team.md:116-124](../design-discussion-meta-team.md), [.pHive/design-discussion-meta-team.md:272-274](../design-discussion-meta-team.md)).

Translates cleanly:

- The insistence on independent evaluation is still right ([.pHive/design-discussion-meta-team.md:56-75](../design-discussion-meta-team.md)).
- The idea of a baseline, rollback, and bounded budget remains valuable ([.pHive/design-discussion-meta-team.md:46-54](../design-discussion-meta-team.md), [.pHive/design-discussion-meta-team.md:147-148](../design-discussion-meta-team.md)).

Fundamentally incompatible:

- The entire document assumes one system and one queue. That assumption is wrong for the new two-swarm design.
- It assumes external trend-scanning is integral to the same control loop as internal maintenance, which is likely too coupled for a disciplined baseline/experiment/PR cycle.
- It assumes measurement inputs like episode history and trust scores will be available and meaningful to the same swarm that edits plugin internals ([.pHive/design-discussion-meta-team.md:129-148](../design-discussion-meta-team.md), [.pHive/design-discussion-meta-team.md:247-260](../design-discussion-meta-team.md)).

Path-transfer issues:

- Severe. The repeated `state/meta-team/...` references are not live.

Verdict:

- Full rewrite. This document is valuable as historical rationale only.

## 4.7 `.pHive/research-brief-meta-team.md`

Evidence:

- It says the charter equivalent and results ledger were "To build" or only partially present at the time ([.pHive/research-brief-meta-team.md:23-30](../research-brief-meta-team.md)).
- It treats `state/meta-team/` as the continuity model option ([.pHive/research-brief-meta-team.md:140-143](../research-brief-meta-team.md)).
- It bakes in hard constraints like "No nested teams" and "Roster-only agents" ([.pHive/research-brief-meta-team.md:77-82](../research-brief-meta-team.md)).

Translates cleanly:

- The risk framing is still useful, especially self-modification risk, research sprawl, rollback requirements, and first-consumer scheduling risk ([.pHive/research-brief-meta-team.md:87-114](../research-brief-meta-team.md)).
- The warning that the proposing agent must not evaluate its own change is still correct ([.pHive/research-brief-meta-team.md:124-126](../research-brief-meta-team.md)).

Fundamentally incompatible:

- It is a pre-implementation exploration document, not a current system contract.
- It assumes a single meta-team concept and leaves critical decisions open that the new two-swarm system now needs to settle explicitly.

Path-transfer issues:

- Yes. The `state/meta-team/...` model never became the live runtime.

Verdict:

- Full rewrite or archive. Do not patch this into a living spec.

## 4.8 `.pHive/meta-team/archive/`

Evidence:

- Directory exists.
- Only `.gitkeep` is present, with no archive content.

Translates cleanly:

- Nothing substantive.

Fundamentally incompatible:

- None; it is just empty.

Path-transfer issues:

- None.

Verdict:

- Leave as inert history scaffolding or delete later under a dedicated cleanup effort. It is not worth patching.

# 5. Adversarial Risk Register

1. The easiest bad patch is a path-only patch. Replacing `state/meta-team` with `.pHive/meta-team` in old planning docs would make them look aligned while leaving the single-swarm control model untouched and therefore still wrong for `meta-optimize` plus `meta-meta-optimize` ([.pHive/design-discussion-meta-team.md:116-124](../design-discussion-meta-team.md), [.pHive/meta-team/charter.md:48-53](../../meta-team/charter.md)).

2. The current system silently assumes instrumentation that does not exist in the live runtime. The design discussion talks about baseline tags, objective metric deltas, degradation thresholds, episode metrics, trust scores, and next-cycle behavioral monitoring, but the actual cycle state records only structural checks and content additions ([.pHive/design-discussion-meta-team.md:46-54](../design-discussion-meta-team.md), [.pHive/design-discussion-meta-team.md:129-148](../design-discussion-meta-team.md), [.pHive/design-discussion-meta-team.md:217-223](../design-discussion-meta-team.md), [.pHive/meta-team/cycle-state.yaml:333-380](../../meta-team/cycle-state.yaml)).

3. Claude teammates are likely to rationalize the permission mismatch as "just a config tweak." It is not. The write-actor model is wrong in three phases, which means the pipeline contract itself was never reconciled with the team boundary model ([hive/workflows/steps/meta-team-cycle/step-04-implementation.md:64-73](../../../hive/workflows/steps/meta-team-cycle/step-04-implementation.md), [hive/workflows/steps/meta-team-cycle/step-05-testing.md:95-102](../../../hive/workflows/steps/meta-team-cycle/step-05-testing.md), [hive/workflows/steps/meta-team-cycle/step-06-evaluation.md:78-88](../../../hive/workflows/steps/meta-team-cycle/step-06-evaluation.md), [.pHive/teams/meta-team.yaml:38-93](../../teams/meta-team.yaml)).

4. The "sandbox" can pass review while still being fake. Right now one artifact promises git worktrees, another promises copied files under `.pHive/meta-team/sandbox/`, and the implementation step uses neither. A reviewer who checks only one doc will miss that there is no single enforced isolation mechanism ([.pHive/design-discussion-meta-team.md:46-54](../design-discussion-meta-team.md), [hive/references/meta-team-sandbox.md:23-52](../../../hive/references/meta-team-sandbox.md), [hive/workflows/steps/meta-team-cycle/step-04-implementation.md:45-73](../../../hive/workflows/steps/meta-team-cycle/step-04-implementation.md)).

5. The keep-if-better loop is already compromised. Step 7 explicitly allows bad newly created files to remain in place while being called "reverted," which means failed experiments can pollute baseline state and bias future cycles ([hive/workflows/steps/meta-team-cycle/step-07-promotion.md:5-10](../../../hive/workflows/steps/meta-team-cycle/step-07-promotion.md), [hive/workflows/steps/meta-team-cycle/step-07-promotion.md:35-39](../../../hive/workflows/steps/meta-team-cycle/step-07-promotion.md)).

6. The April cycle history will tempt people to think "the system already works." It does not. The ledger marks the 2026-04-13 cycle as passed while the commit field is literally `TBD`, which violates both the charter and the close step's own sequencing rules ([.pHive/meta-team/ledger.yaml:52-70](../../meta-team/ledger.yaml), [.pHive/meta-team/charter.md:44](../../meta-team/charter.md), [hive/workflows/steps/meta-team-cycle/step-08-close.md:8-9](../../../hive/workflows/steps/meta-team-cycle/step-08-close.md)).

7. The concept is overly coupled to specific roster personas and a five-agent assembly line. The research brief assumes roster-only agents and the design discussion hardcodes researcher → architect → developer → tester → reviewer. That rigidity is likely to break once there are two sibling swarms with different optimization targets and evidence models ([.pHive/research-brief-meta-team.md:77-82](../research-brief-meta-team.md), [.pHive/design-discussion-meta-team.md:56-67](../design-discussion-meta-team.md)).

8. A naive patch will preserve the wrong objective function. The live cycle mostly hunts for missing memory files, missing sections, and schema completeness. That is not the same as improving user-project outcomes or plugin performance under measurable baselines ([.pHive/meta-team/cycle-state.yaml:17-134](../../meta-team/cycle-state.yaml), [.pHive/meta-team/cycle-state.yaml:136-246](../../meta-team/cycle-state.yaml)).

9. The public-vs-plugin split can be lost if people reuse the current charter language. The current charter explicitly forbids changes to user project `.pHive/` directories, so copying it forward would kneecap the planned public `meta-optimize` swarm on day one ([.pHive/meta-team/charter.md:48-53](../../meta-team/charter.md)).

10. There is a real review trap around "historical docs." The design discussion and research brief are not harmless background notes because downstream story docs and planning docs still echo their dead `state/meta-team/...` assumptions. If those historical artifacts stay in circulation as "source truth," broken path assumptions will keep regenerating.

# 6. Recommendation

Do not salvage the current meta-team as a single evolving subsystem. Split the problem immediately:

- `meta-optimize`: public swarm for user-project code. New charter, new queue semantics, explicit PR-oriented experiment record, and metrics tied to user-project baselines.
- `meta-meta-optimize`: plugin-hive internal swarm. Reuse only the hard constraints, evidence discipline, and parts of the existing nightly operator flow.

What to salvage:

- The live charter's hard constraints and quality-gate instincts ([.pHive/meta-team/charter.md:37-45](../../meta-team/charter.md), [.pHive/meta-team/charter.md:70-82](../../meta-team/charter.md)).
- The queue's source attribution pattern ([.pHive/meta-team/queue.yaml:15-20](../../meta-team/queue.yaml)).
- The idea of a morning/status surface ([hive/references/meta-team-nightly-cycle.md:99-105](../../../hive/references/meta-team-nightly-cycle.md), [skills/status/SKILL.md:109-126](../../../skills/status/SKILL.md)).

What to rewrite completely:

- The system spec.
- The state schema.
- The sandbox contract.
- The actor/write-permission model.
- The success metric model.
- The single-swarm assumption.

Final judgment:

The current meta-team is not a broken version of the desired two-swarm Karpathy loop. It is a different system with some useful parts and several hard contradictions. Rebuild the control plane; do not paper over it with find/replace patches.
