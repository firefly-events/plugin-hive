---
title: Research Brief — Meta-Improvement System
epic: meta-improvement-system
phase: Phase A (research)
date: 2026-04-19
sources:
  - researcher-findings.md (Claude-backed researcher)
  - codex-audit-memo.md (Codex-rescue adversarial audit)
status: ready for design discussion
---

# Research Brief: Meta-Improvement System

## 1. Executive Summary

- The suspected repo-transfer breakage is a false alarm: the researcher found zero `hom-hq` and zero `firefly-events` path hits in `hive/` and `skills/`, and the Codex audit independently confirmed zero repo-wide `hom-hq` matches on 2026-04-19.
- The current meta-team is not empty vaporware. Verified live assets exist under `.pHive/meta-team/`, the nightly workflow is present as an 8-step pipeline, status integration exists, and five cycles are recorded in ledger/state artifacts.
- The main disagreement is interpretation, not raw observation. The researcher concludes the system is salvageable because the workflow is complete and has five successful runs; the Codex audit concludes structural contradictions are severe enough that patching forward as one unit is the wrong move.
- The objective-metrics layer the planning brief wants does not currently exist. Episode records, cycle state, circuit breakers, insights, and spawn reporting provide at most partial qualitative traces; cost, speed, friction, reuse, and most quality metrics are full gaps.
- Karpathy-loop feasibility is mixed: there is a queue structure that can act as a hypothesis backlog and there is worktree support elsewhere in the repo, but the live meta-team cycle lacks baseline capture, numeric measurement, a coherent isolation contract, and any instrumentation hooks.

## 2. Current Meta-Team State

### 2.1 What exists and works

- Workflow definition exists: `hive/workflows/meta-team-cycle.workflow.yaml`
  - Researcher inventory: 8-step nightly cycle with orchestrator, researcher, architect, developer, tester, reviewer.
- Step files exist and are wired:
  - `hive/workflows/steps/meta-team-cycle/step-01-boot.md`
  - `hive/workflows/steps/meta-team-cycle/step-02-analysis.md`
  - `hive/workflows/steps/meta-team-cycle/step-03-proposal.md`
  - `hive/workflows/steps/meta-team-cycle/step-04-implementation.md`
  - `hive/workflows/steps/meta-team-cycle/step-05-testing.md`
  - `hive/workflows/steps/meta-team-cycle/step-06-evaluation.md`
  - `hive/workflows/steps/meta-team-cycle/step-07-promotion.md`
  - `hive/workflows/steps/meta-team-cycle/step-08-close.md`
- Daily-ceremony integration exists:
  - `hive/workflows/steps/daily-ceremony/step-01-load-state.md`
  - `hive/workflows/steps/daily-ceremony/step-03-present-standup.md`
  - Researcher finding: overnight `[meta-team]` commits are surfaced in standup when remote state is available.
- Reference docs exist under `hive/references/`:
  - `meta-team-nightly-cycle.md`
  - `meta-team-sandbox.md`
  - `meta-team-ux.md`
  - `meta-team-memory-targeting.md`
  - `meta-team-external-research.md`
- Runtime state exists under `.pHive/meta-team/`:
  - `.pHive/meta-team/charter.md`
  - `.pHive/meta-team/cycle-state.yaml`
  - `.pHive/meta-team/ledger.yaml`
  - `.pHive/meta-team/queue.yaml`
- Status-surface integration exists:
  - `skills/status/SKILL.md` §8 references the meta-team morning summary flow.
- Researcher-verified continuity evidence:
  - `.pHive/meta-team/ledger.yaml` has 5 recorded cycles.
  - `.pHive/meta-team/cycle-state.yaml` is populated for multiple phases/cycles.
  - `.pHive/meta-team/queue.yaml` exists and is currently clear (`status: completed` on all 3 items).

### 2.2 What's broken or contradictory

| Area | Source-backed contradiction | Evidence |
|---|---|---|
| Path model | Historical design artifacts still describe `state/meta-team/`, while the live runtime uses `.pHive/meta-team/`. | Codex audit cites `.pHive/design-discussion-meta-team.md:78-79`, `.pHive/design-discussion-meta-team.md:116-124`, `.pHive/research-brief-meta-team.md:140-143` versus `.pHive/meta-team/charter.md:32`, `.pHive/meta-team/charter.md:87-91`, `hive/references/meta-team-nightly-cycle.md:29-34`. |
| Sandbox contract | Design doc promises git worktrees; sandbox reference promises file-copy isolation; implementation step uses neither as an enforced contract. | Codex audit cites `.pHive/design-discussion-meta-team.md:46-54`, `.pHive/design-discussion-meta-team.md:196-213`, `hive/references/meta-team-sandbox.md:23-69`, `hive/workflows/steps/meta-team-cycle/step-04-implementation.md:45-73`. |
| Developer write scope | Step 4 tells `developer` to append to `.pHive/meta-team/cycle-state.yaml`, but the team file does not grant that path. | `hive/workflows/steps/meta-team-cycle/step-04-implementation.md:64-73`; `.pHive/teams/meta-team.yaml:38-65` per Codex audit. |
| Tester write scope | Step 5 tells `tester` to append `test_results` to `.pHive/meta-team/cycle-state.yaml`, but tester is read-only across `.pHive/**`. | `hive/workflows/steps/meta-team-cycle/step-05-testing.md:95-102`; `.pHive/teams/meta-team.yaml:66-80` per Codex audit. |
| Reviewer write scope | Step 6 tells `reviewer` to append evaluations to `.pHive/meta-team/cycle-state.yaml`, but reviewer has no `.pHive/**` write scope. | `hive/workflows/steps/meta-team-cycle/step-06-evaluation.md:78-88`; `.pHive/teams/meta-team.yaml:82-93` per Codex audit. |
| Step 5 self-contradiction | Testing step forbids any writes, then requires a write to cycle state. | `hive/workflows/steps/meta-team-cycle/step-05-testing.md:7`, `:24-26`, `:95-102` per Codex audit. |
| Promotion semantics | Step 7 says `needs_revision` changes must be reverted, but also allows a newly created bad file to remain in place as "incomplete." | `hive/workflows/steps/meta-team-cycle/step-07-promotion.md:5-10`, `:35-39` per Codex audit. |
| Close-state integrity | The close step requires commit-before-ledger with a real hash, but the latest ledger entry is `commit: TBD` while cycle state says closed/passed. | `.pHive/meta-team/ledger.yaml:52-70`, `.pHive/meta-team/cycle-state.yaml:1-5`, `.pHive/meta-team/cycle-state.yaml:455-486`, `hive/workflows/steps/meta-team-cycle/step-08-close.md:8-9`, `:81-97` per Codex audit. |

Additional verified gaps:

- `hive/hive.config.yaml` contains only `meta_team.github_forwarding: false`; no enabled flag, no schedule, no metrics configuration.
- `.claude-plugin/plugin.json` registers no metrics hooks.
- `~/.claude/settings.json` contains a Stop hook and a Firecrawl PostToolUse hook, but neither writes metrics or episode records.
- No `meta-optimize` or `meta-meta-optimize` skills exist yet.

### 2.3 Divergence to resolve

| Question | Researcher view | Codex audit view | Shared raw observation |
|---|---|---|---|
| Is the current meta-team real? | Yes. The workflow, state files, daily ceremony integration, and five recorded cycles indicate an operating system. | Partially. Runtime artifacts exist, but the control contract is internally inconsistent. | Both sources agree active files and historical runs exist. |
| Is the repo-transfer bug the main issue? | No. `hom-hq` / `firefly-events` path breakage is a false alarm. | No. `hom-hq` is a red herring; deeper structural drift is the real issue. | Full agreement. |
| Can the current system be patched forward? | Likely yes, because the 8-step workflow is present and has exercised successfully; fill the metrics and experiment gaps. | Not as one unit. Rebuild the control plane for the two-swarm Karpathy loop and salvage only selected assets. | Both agree metrics/experiment support is missing. |
| What is the core deficiency? | No objective metrics; no baseline/measure loop; evaluation is qualitative-only. | Same, plus fatal contradictions in path model, sandbox model, permission model, promotion semantics, and close-state integrity. | Agreement on missing measurement; disagreement on severity threshold. |

This divergence is the main design-discussion handoff:

- The researcher frames the current system as salvageable infrastructure with instrumentation missing.
- The Codex audit frames it as a materially different legacy system whose contradictions make rebuild the safer default.
- This brief does not choose a winner; it preserves both interpretations for the architect memo and user decision.

## 3. Existing Instrumentation Surface

### 3.1 Episode records

Observed schema surface from researcher findings:

| Field group | Observed state |
|---|---|
| Declared schema fields | `step_id`, `status`, `timestamp`, `artifacts` |
| Actual observed extra fields | Some YAML files also include `conclusions`, `decisions_made`, `context_for_next_phase`, and other context fields |
| Explicit exclusions | Token usage and duration are explicitly excluded from episode state; story/epic IDs are treated as derivable from path |
| Storage location cited by researcher | `.pHive/episodes/ui-designer-step-files/` |

Key finding:

- Episode records are qualitative execution breadcrumbs, not a metrics ledger.
- The schema explicitly excludes the two most obvious cost/speed fields: tokens and duration.
- No observed episode file contains token, cost, wall-clock, fix-loop, or cache metrics.

Implication:

- Episode records can support partial quality inference at the "did this step complete/fail/escalate" level.
- They cannot currently support the planning brief's requested cost, speed, or friction instrumentation without schema or sidecar changes.

### 3.2 Cycle state

Observed required and optional fields from researcher findings:

| Field class | Fields observed |
|---|---|
| Required | `epic_id`, `created`, `updated`, `decisions` |
| Optional | `product_name`, `constraints`, `naming`, `scope_boundaries`, `technology`, `linear`, `escalations` |
| Missing metrics surface | No timing, token, cost, quality-score, baseline, delta, or experiment-result fields |

Key finding:

- `cycle-state.yaml` is a coordination and audit log, not a measurement record.
- The live file shows multi-phase detail and proposal/test/evaluation records, but those records track structural progress, not quantitative outcomes.

### 3.3 Circuit breakers (limits, not measurements)

The closest thing to instrumentation config today is a set of limits:

| Breaker | Value |
|---|---:|
| `step_timeout_minutes` | 10 |
| `fix_loop_timeout_minutes` | 20 |
| `story_timeout_minutes` | 45 |
| `ceremony_timeout_hours` | 4 |
| `max_step_retries` | 2 |
| `max_fix_iterations` | 3 |
| `max_same_error_repeats` | 3 |

Interpretation:

- These express guardrails, not telemetry.
- There is no persisted counter for timeout hits, retries consumed, or fix loops actually used.
- The system knows the ceiling, not the observed value.

### 3.4 Insight pipeline (qualitative, not numeric)

Observed insight staging fields:

| Field | Notes |
|---|---|
| `agent` | Source actor |
| `type` | `pattern`, `pitfall`, `override`, `codebase`, `reference` |
| `summary` | Short qualitative takeaway |
| `detail` | Longer explanation |
| `scope` | Surface or area affected |
| `related_files` | Concrete traceability |

Key finding:

- Insights are useful for behavior learning and memory curation.
- They do not carry cost, timing, score, delta, or experiment-result fields.
- The insight pipeline is the closest structural analog to "learn from outcome," but today it is entirely qualitative.

### 3.5 Hooks

Current state:

- Researcher finding: no instrumentation hooks exist anywhere for the meta-team cycle.
- `.claude-plugin/plugin.json` has no hooks registered.
- `~/.claude/settings.json` hooks do not write metrics or episode records.

Importance:

- Hook absence is a major instrumentation blocker for Epic C.
- If metrics need passive collection across steps, agents, or tools, hooks are the most obvious capture point and currently do not exist.

## 4. Metrics Gap Analysis

The researcher provided the core gap table below. It is the clearest snapshot of current instrumentation coverage versus the planning brief's asks.

| Metric Category | Brief Wants | Currently Exists | Gap |
|---|---|---|---|
| Cost: tokens per story | input/output/cache by agent | NOTHING | Full gap |
| Cost: $$ per story | cost_usd | NOTHING | Full gap |
| Cost: cache hit rate | cache_hits/total | NOTHING | Full gap |
| Quality: first-attempt pass rate | no-fix-loop count | episode status exists, not aggregated | Partial |
| Quality: fix-loop iterations | count/story | max_fix_iterations limit only | Full gap |
| Quality: respawn rate | count/agent | reported but not persisted | Full gap |
| Quality: test pass rate (first commit) | pass/fail | episode status per step, no first-commit flag | Partial |
| Quality: CodeRabbit fixes/PR | count | NOTHING | Full gap |
| Speed: wall-clock/phase | sec/step/story | NOTHING persisted | Full gap |
| Speed: step timeout hits | count | breaker limit, no counter | Full gap |
| Speed: gate pass rate | per gate type | NOTHING | Full gap |
| Friction: human escalations | count/epic | NOTHING | Full gap |
| Friction: permission prompts | count/story | NOTHING (PR #7 reduced, didn't count) | Full gap |
| Friction: clarification Qs | count | NOTHING | Full gap |
| Friction: manual overrides | count | NOTHING | Full gap |
| Reuse: memory wiki hit rate | hits/session | NOTHING | Full gap |
| Reuse: skill invocation coverage | declared vs fired | NOTHING | Full gap |
| Reuse: trust score trajectory | per agent-pair | NOTHING | Full gap |

Category-level synthesis:

| Category | Current state | Assessment |
|---|---|---|
| Cost | No token, dollar, or cache metrics anywhere in the observed runtime | Full gap |
| Quality | Only thin indirect signals exist via episode status and step outcomes | Mostly full gap |
| Speed | Limits exist; measurements do not | Full gap |
| Friction | No counters for escalations, permission prompts, clarification, or overrides | Full gap |
| Reuse | No instrumentation for memory hits, skill fire rate, or trust trajectories | Full gap |

## 5. Karpathy Auto-Improvement Loop — Feasibility Analysis

### 5.1 Hypothesis structure

Best existing analog:

- `.pHive/meta-team/queue.yaml` already stores prioritized optimization targets with:
  - target
  - type
  - description
  - source / source attribution / source evidence
  - priority score
  - attempted count
  - completion note
  - status

Researcher synthesis:

- Queue entries already look like proto-hypotheses.
- Natural extension fields would be:
  - `baseline_metric`
  - `target_delta`
  - `result_metric`
  - experiment owner / PR state if needed

Codex-audit caution:

- Existing queue semantics assume one plugin-only swarm and do not encode experiment thresholds, owners, or promotion semantics.
- If the system splits into `meta-optimize` and `meta-meta-optimize`, one queue shape may no longer be sufficient without swarm scoping.

### 5.2 Experiment isolation

What exists:

- Researcher finding: worktree support exists elsewhere via `EnterWorktree`; each story can get its own branch under `.claude/worktrees/`.
- Researcher finding: `codex-invoke` auto-detects worktree context.

What the current meta-team uses:

- The sandbox reference describes file-copy isolation under `.pHive/meta-team/sandbox/{cycle-id}/{change-id}/`.
- The Codex audit found the live filesystem does not currently contain `.pHive/meta-team/sandbox/`.
- The implementation step does not clearly enforce either the worktree model or the file-copy model.

Assessment:

| Isolation question | Current answer |
|---|---|
| Is there any isolation concept? | Yes, in docs and references |
| Is there one coherent enforced contract? | No |
| Is worktree infrastructure available in the repo? | Yes |
| Is worktree isolation wired into the live meta-team cycle? | No |
| Is file-copy sandboxing active and evidenced on disk? | Not currently |

### 5.3 Baseline capture

Current state:

- No baseline persistence mechanism exists in the live cycle.
- Ledger records counts like `changes_promoted` / `changes_reverted`, not metric snapshots.
- Cycle state carries phase decisions and outcomes, not before/after measurements.

Researcher proposal anchor:

- `hive/workflows/steps/meta-team-cycle/step-01-boot.md` already reads prior ledger state.
- If Epic C provides a metrics store, boot is the natural place to snapshot current metrics into cycle state before the experiment begins.

Feasibility reading:

- Baseline capture is conceptually easy to place.
- It is blocked on instrumentation existing first.

### 5.4 A/B prior art

Direct prior art:

- None found by the researcher.
- No A/B framework, no feature-flag discipline, no comparative experiment records.

Closest structural analogs:

- Binary toggles like `collaborative_review` exist elsewhere as configuration switches, but not as a formal experiment framework.
- The insight pipeline has the stage/evaluate/promote-or-discard rhythm, but it operates on qualitative observations rather than measured deltas.

Interpretation:

- The repo has loop-shaped behavior.
- It does not yet have A/B-shaped measurement discipline.

## 6. Key Constraints and Risks

| Constraint / risk | Why it matters | Source |
|---|---|---|
| `paths.state_dir` resolver is explicitly out of scope | Many repo paths are still hardcoded to `.pHive/`; this is a separate epic and should not be silently folded into meta-improvement design | Planning brief "Known follow-up"; researcher constraints |
| Nightly schedule is not in repo | The trigger/control-plane boundary is partly external, so Phase A cannot verify actual scheduler behavior from code alone | Researcher unanswered questions |
| Claude Code SDK token-count limitation | Researcher flags this as the top instrumentation risk because per-agent token usage is not surfaced through current TeamCreate results | Researcher constraints |
| Path-only cleanup is a review trap | Replacing `state/meta-team` strings would make docs look aligned while preserving the wrong single-swarm model | Codex audit risk register |
| "Successful run" history may overstate actual integrity | Ledger shows five cycles, but the latest closed cycle still has `commit: TBD`, so visible execution history is not the same as invariant satisfaction | Researcher runtime evidence plus Codex close-state finding |
| Sandbox review can produce false confidence | Different docs promise different isolation models, and implementation enforces neither clearly | Codex audit |
| Current objective function is qualitative doc hygiene, not measurable improvement | The live cycle mostly hunts for missing memories, missing sections, and schema completeness | Codex audit reading of `cycle-state.yaml` |

Risk prioritization for design discussion:

1. Token instrumentation feasibility is the primary blocker for the "cost" metric family.
2. Control-plane contradictions determine whether salvage is practical or whether rebuild is lower-risk.
3. Baseline capture and isolation design cannot be finalized until instrumentation storage and experiment contract are defined.

## 7. Unresolved Questions (for design discussion)

1. Is the existing meta-team best treated as salvageable infrastructure with missing metrics, or as a legacy single-swarm system whose contradictions justify rebuilding the control plane?
2. Where should the metrics layer live: embedded into existing episode/cycle records, or in a separate append-only metrics store such as `.pHive/metrics/`?
3. How will per-agent token and cost data be captured if the current Claude Code SDK surface does not expose it directly through team results?
4. Should hypothesis tracking extend `.pHive/meta-team/queue.yaml`, or should the new system create explicit experiment records with before/after metrics and PR state?
5. What isolation model is authoritative for experiments: worktrees, file-copy sandboxes, direct writes for low-risk changes, or a hybrid policy?
6. If parallel experiments are allowed, how are side effects isolated and how is baseline contamination prevented?
7. Where should baseline snapshots be captured in the runtime, and is `step-01-boot` the correct anchor once metrics exist?
8. What promotion threshold counts as a meaningful positive delta, and is that threshold shared or per metric family?
9. How should rollback work when an experiment improves one metric but regresses another later?
10. Where is the nightly cycle actually scheduled, and does that scheduler belong inside the repo's design scope or remain an external dependency?
11. Does `step-02-analysis` derive history from live git data, from the ledger, or both, and does that matter for baseline trustworthiness?
12. Are there any meaningful historical research artifacts under `.pHive/meta-team/research-notes/`, or is that surface effectively unused today?
13. How should the existing charter be split or rewritten so that `meta-optimize` and `meta-meta-optimize` have distinct scope boundaries and success metrics?
14. What minimum integrity invariants must be restored before any "salvage" path can be considered credible: permission alignment, sandbox enforcement, commit-before-close, or all of them?

## 8. Sources

| Path | Purpose |
|---|---|
| `/Users/don/Documents/plugin-hive/.pHive/planning-briefs/meta-improvement-system.md` | Planning context: desired two-swarm model, metric families, out-of-scope state-dir resolver, and design-discussion questions |
| `/Users/don/Documents/plugin-hive/.pHive/epics/meta-improvement-system/research-drafts/researcher-findings.md` | Phase A raw findings: wiring inventory, instrumentation surface, metrics gap table, feasibility notes, constraints, and unanswered questions |
| `/Users/don/Documents/plugin-hive/.pHive/epics/meta-improvement-system/docs/codex-audit-memo.md` | Phase A adversarial audit: path-model split, sandbox mismatch, permission contradictions, promotion inconsistency, close-state integrity issue, and rebuild recommendation |
| `/Users/don/Documents/plugin-hive/hive/agents/technical-writer.md` | Persona/source-of-truth for writer scope discipline and research-brief output path |
| `/Users/don/.claude/hive/memories/technical-writer/research-brief-pattern.md` | Memory on research-brief structure; reinforced leading with current-state and blocker tables |
| `/Users/don/.claude/hive/memories/technical-writer/planning-doc-workflow.md` | Memory reinforcing faithful rendering from upstream analysis rather than silent reinterpretation |
| `/Users/don/.claude/hive/memories/technical-writer/wait-for-all-inputs.md` | Memory enforcing "all inputs must exist before drafting" |
| `/Users/don/.claude/hive/memories/technical-writer/design-discussion-length-discipline.md` | Loaded per assignment note; not applied to brief structure, but retained for later design-discussion work |
