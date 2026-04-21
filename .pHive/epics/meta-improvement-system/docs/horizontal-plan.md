---
title: Horizontal Plan — Meta-Improvement System
epic: meta-improvement-system
phase: B2 (H/V planning)
author: tpm (claude-backed)
date: 2026-04-19
revision: 1
review_summary:
  - architect: approve-with-escalation (NEW Q1→Option A, NEW Q2→Option B, Slice 9 rollback-realism verification)
  - researcher: flagged (Stop hook slot conflict w/ in-flight interrupt-sentinel work; meta-team.yaml existence — verified false alarm, file present)
  - writer: flagged (missing explicit WHAT WORKS per slice; missing consolidated PUNT LIST; MVS vs MVL ambiguity)
inputs:
  - docs/design-discussion.md
  - docs/user-decisions-dd.md (authoritative)
  - docs/architect-memo.md
  - docs/architect-hv-review.md
  - docs/tpm-sequencing-memo.md
  - docs/research-brief.md
  - docs/codex-audit-memo.md
---

# Horizontal Plan: Meta-Improvement System

This is the breadth-first map. Every layer the epic touches is enumerated with its per-layer requirements and cross-layer dependencies. Vertical planning (sibling file) overlays slice boundaries on this map.

Epic class: **meta-infra + new-subsystem hybrid**. Rewrite of the meta-team control plane, addition of a metrics substrate, and two new swarm skills. Pragmatic working-state reading applies (coherent-increment stop-ship test, not end-to-end runtime-behavior strictness).

## 1. Layer Inventory

Eleven layers are affected. Two are net-new; the rest are modifications to existing subsystems.

| # | Layer | Current role | How affected |
|---|---|---|---|
| L1 | Config substrate (`hive/hive.config.yaml`) | Plugin-wide knobs; has `meta_team.github_forwarding` only | Add `metrics.enabled`, `metrics.dir`, swarm-scoped config blocks |
| L2 | Kickoff skill (`skills/kickoff/`) | Brownfield discovery + greenfield planning entrypoint | New elicitation question for `metrics.enabled` opt-in (Q-new-B) |
| L3 | Metrics substrate (NEW: `.pHive/metrics/`) | Does not exist | Dual-schema carrier: `events/*.jsonl` + `experiments/*.yaml` |
| L4 | Event-emission hooks (hooks registry + agent-spawn report) | No metric hooks exist | Conditional-on-flag writers for 5 MVP metrics |
| L5 | Meta-team workflow + steps (`hive/workflows/meta-team-cycle.workflow.yaml` + `steps/meta-team-cycle/*.md`) | 8-step nightly cycle with contradictory authority + permissions + sandbox + close-state | Rewrite 6 step files + workflow file |
| L6 | Team permission files (`.pHive/teams/meta-team.yaml`) | Single team; write grants contradict step obligations | Split into two team files; align write grants with rewritten steps |
| L7 | Meta-team state + references (`.pHive/meta-team/*`, `hive/references/meta-team-*.md`) | charter.md, cycle-state.yaml, ledger.yaml, queue.yaml + 5 reference docs | Archive historical, rewrite charter x2 (one per swarm), rewrite sandbox ref, demote nightly-cycle ref to operator-narrative-only |
| L8 | Experiment lifecycle library (NEW: `hive/lib/meta-experiment/`) | Does not exist | Shared envelope runtime + baseline capture + compare + promotion adapter interface + rollback watch. **Non-skill module per architect NEW Q1 → Option A** |
| L9 | `/meta-meta-optimize` skill (NEW, LOCAL-ONLY: `maintainer-skills/meta-meta-optimize/`) | Does not exist; NOT in plugin.json (Q-new-A) | Plugin-hive-internal swarm skill; worktree isolation default; direct-commit promotion adapter. **Skill-shaped but outside shipped `./skills/` root per architect NEW Q2 → Option B** |
| L10 | `/meta-optimize` skill (NEW, SHIPPED) | Does not exist; IN plugin.json | User-project swarm skill; PR-only promotion adapter (Q5) |
| L11 | Meta-backlog substrate (NEW: `.pHive/meta-team/meta-backlog.yaml`) | Does not exist | Fallback queue when metric signal insufficient (Q7 extension); consumed by L9/L10 |

Deferred items are consolidated in the `## PUNT LIST` section at the end of this doc.

## 2. Per-Layer Requirements

### L1 — Config substrate

NEW FIELDS:
  - `metrics.enabled: bool` (default `false`; Q-new-B)
  - `metrics.dir: string` (default `.pHive/metrics`; follows `paths.state_dir` convention once resolver epic lands)
  - `meta_optimize:` block — reserved for L10 config (threshold refs, PR target repo, etc.)
  - `meta_meta_optimize:` block — reserved for L9 config (worktree policy, target refs, excluded paths)

MODIFICATIONS:
  - Existing `meta_team.github_forwarding` preserved during migration; may be folded into `meta_optimize` block in final state (TBD in slice)

### L2 — Kickoff skill

NEW ELICITATION:
  - "Enable metrics tracking? [explanation of trade-offs]" — writes `metrics.enabled` to config (Q-new-B)
  - Brownfield path: same question at re-kickoff; preserves prior answer if set
  - Greenfield path: surfaces alongside existing profile questions

DOC TOUCHPOINTS:
  - Kickoff UX docs (explain opt-in implication: without metrics, meta-team runs in backlog-fallback mode only)
  - Cross-link to `/meta-optimize` docs (L10)

### L3 — Metrics substrate (NEW)

STRUCTURE: `.pHive/metrics/events/*.jsonl` (append-only, per run_id or rolling daily) + `.pHive/metrics/experiments/*.yaml` (one envelope per experiment_id) + README.md (conventions + retention).

SCHEMAS (new):
  - `metrics-event.schema.md` — fields: event_id, timestamp, run_id, swarm_id, story_id|proposal_id, phase, agent, metric_type, value, unit, dimensions, source (architect §2 rec 3)
  - `experiment-envelope.schema.md` — fields: experiment_id, swarm_id, target_ref, baseline_ref, baseline_metrics_ref, candidate_ref, candidate_metrics_ref, policy_ref, decision, observation_window, rollback_ref, regression_watch (Q3 lean; no per-metric class system)

PRIMITIVES: append-only JSONL writer (file-rotation); YAML envelope writer (update-in-place for decision+rollback fields only); baseline-snapshot + delta-compare + envelope-lookup readers. All writers gated on `metrics.enabled`.

### L4 — Event-emission hooks

MVP METRIC SET (Q8 provisional, 5 metrics):
  1. Tokens per story (input+output; SDK-best-effort; may force fallback to transcript parsing)
  2. Wall-clock per story (trivially available from episode timestamps)
  3. Fix-loop iteration count per story
  4. First-attempt review-pass rate (aggregated from episode status)
  5. Human escalation count per epic

HOOK SITES:
  - Stop hook (`~/.claude/settings.json`) — emit story-end wall-clock + token totals
    - **SLOT CONFLICT NOTE:** an in-flight interrupt-sentinel Stop hook (adjacent to PR #7 work) is pending. When C2.2 lands, the Stop-hook slot will already be claimed. Structured-outline phase must decide: (a) combined handler that dispatches to both the interrupt sentinel AND metric emit, or (b) separate mechanism for metrics (e.g., PostToolUse on session-end marker). Not an H/V-phase decision; flagged for B3.
  - PostToolUse on Task tool — emit per-agent-invocation tokens if SDK surfaces them
  - Agent-spawn skill step 8 report — hook point already exists; add metric emit
  - Execute skill (`skills/execute/`) phase boundaries — emit fix-loop iterations + review-pass-flag
  - Orchestrator escalation path — emit human-escalation event

EXCLUSIONS (conditional):
  - All hooks check `metrics.enabled` at write-time; disabled = no-op, but hook still runs (preserves contract)
  - Follow-on metrics (cache hit rate, CodeRabbit fixes, memory wiki hit rate, trust trajectory, skill invocation coverage) deferred per Q8 rationale

TOKEN-CAPTURE RISK NODE:
  - If SDK surface doesn't expose per-invocation tokens, fallback path = transcript parsing OR explicit self-report via structured agent completion message. This is a design decision inside L4, not a sequencing decision.

### L5 — Meta-team workflow + steps

REWRITE LIST (authority/isolation/promotion/close contradictions per codex-audit §3):
  - `meta-team-cycle.workflow.yaml` — update agent assignments to match rewritten steps
  - `step-04-implementation.md` — route writes through orchestrator or grant properly
  - `step-05-testing.md` — resolve read-only-vs-write self-contradiction (tester produces artifact, orchestrator persists)
  - `step-06-evaluation.md` — align reviewer writes with team grants
  - `step-07-promotion.md` — clean revert (worktree-discard or delete-on-fail), replacing "file remains incomplete"
  - `step-08-close.md` — non-bypassable closure validator (commit + metrics snapshot + rollback target, Q3)
  - `step-01-boot.md` + `step-02-analysis.md` — extend to snapshot/read metrics baseline when `metrics.enabled`
  - `step-03b-backlog-fallback.md` (NEW) — branch from step-03 on low metric signal, pull from meta-backlog (Q7)

### L6 — Team permission files

STRUCTURAL CHANGE:
  - Existing `.pHive/teams/meta-team.yaml` → split or replace
  - NEW: `.pHive/teams/meta-optimize.yaml` — team roster + permissions for L10 (user-project-target)
  - NEW: `.pHive/teams/meta-meta-optimize.yaml` — team roster + permissions for L9 (plugin-hive-target)

WRITE-GRANT ALIGNMENT:
  - Every role's domain.allow must cover every path the role's step obligations touch
  - Audit: step file writes → team file grants (closure property; catches codex-audit §3.3)
  - Reviewer + tester roles get narrow cycle-state write grant (or orchestrator mediates)

### L7 — Meta-team state + references

CHARTERS: extract shared safety constraints → `hive/references/meta-safety-constraints.md`; NEW `charter-meta-optimize.md` + `charter-meta-meta-optimize.md`; OLD `charter.md` archived (Q9).

STATE FILES: old `cycle-state.yaml` + `ledger.yaml` → `.pHive/meta-team/archive/<date>/` with MANIFEST.md; active files zero'd / recreated under new schema; `queue.yaml` split into `queue-meta-optimize.yaml` + `queue-meta-meta-optimize.yaml` with experiment-semantic fields.

REFERENCE DOCS: `meta-team-nightly-cycle.md` demoted to operator narrative; `meta-team-sandbox.md` → REPLACED by `meta-experiment-isolation.md` (worktree-centric, Q4); remaining meta-team-* refs audited for single-swarm assumptions, patched or archived.

### L8 — Experiment lifecycle library (NEW, SHARED)

LOCATION — **`hive/lib/meta-experiment/` (architect NEW Q1 → Option A).** Shared runtime code, NOT a `SKILL.md`. `/meta-optimize` and local `/meta-meta-optimize` both import; neither registers.

CONTENTS: envelope loader/writer, baseline-capture, delta-compare, promotion-adapter-interface (abstract), rollback-watch (Q3 auto-revert only), closure validator (commit + metrics snapshot + rollback target).

INTERFACE: `start(swarm_id, target_ref, policy_ref)`, `capture_baseline(exp_id)`, `capture_candidate(exp_id)`, `compare(exp_id)`, `promote(exp_id, adapter)`, `watch_regression(exp_id, window)`.

### L9 — `/meta-meta-optimize` skill (NEW, LOCAL-ONLY)

LOCATION — **`maintainer-skills/meta-meta-optimize/SKILL.md`** (Q-new-A + architect NEW Q2 → Option B). Skill-shaped but OUTSIDE shipped `./skills/` root. Accidental-bundling prevention is STRUCTURAL (manifest scope) not procedural. NOT in `plugin.json` — outline adds a regression test asserting this.

WORKFLOW: reads meta-meta charter + queue; runs lifecycle against plugin-hive repo; worktree isolation DEFAULT (Q4); direct-commit promotion adapter (internal repo); backlog fallback when metric signal insufficient (Q7); first live cycle is a no-op proving run (Q7 affirm).

AUTHORITY: team `.pHive/teams/meta-meta-optimize.yaml`; writes plugin-hive repo + `.pHive/metrics/` + meta-meta queue; must pass closure validator.

### L10 — `/meta-optimize` skill (NEW, SHIPPED)

LOCATION: `skills/hive/skills/meta-optimize/SKILL.md`; REGISTERED in `plugin.json`; invoked by end users in their own projects.

WORKFLOW: reads user-project charter + queue; runs lifecycle against user project (worktree/equivalent default); PR-artifact promotion adapter ONLY (Q5 — no direct mutation); backlog fallback; metric registry tolerates unknown consumer-supplied dimensions.

AUTHORITY: team `.pHive/teams/meta-optimize.yaml`; writes user worktree + user `.pHive/metrics/` + PR artifacts; must pass closure validator.

### L11 — Meta-backlog substrate (NEW)

FILES: `queue-meta-meta-optimize.yaml` + `queue-meta-optimize.yaml` (template, consumer-populated). Schema extends old `queue.yaml` (preserves source-attribution) and adds `hypothesis`, `baseline_metric_ref`, `target_delta`, `experiment_owner`, `pr_state`, `swarm_scope` (architect §3).

CONSUMERS: L9/L10 step-03b-backlog-fallback reads when metric-driven mode yields no candidate; step-08-close writes completion_note back.

## 3. Cross-Layer Dependencies

```
L1 (config) ────────────────────────────────┐
    │                                        │
    ├──→ L2 (kickoff) ──────────┐           │
    │                           │           │
    └──→ L4 (hooks)            L3 (metrics) │
         │   (gated on config)  │            │
         │                      │            │
         └──────────────────────┤            │
                                ▼            │
                            L8 (lifecycle lib)
                                │            │
    ┌───────────────────────────┴────┐      │
    │                                │      │
    ▼                                ▼      │
L9 (meta-meta, local)         L10 (meta-optimize, shipped)
    │                                │
    ├──→ L5 (workflow/steps) ────────┤
    ├──→ L6 (teams) ─────────────────┤
    ├──→ L7 (charters/refs) ─────────┤
    └──→ L11 (backlogs) ─────────────┘
```

CRITICAL DEPENDENCIES (hard serializations):
  - L3 schemas must exist before L4 hooks can emit
  - L3 schemas must exist before L8 lifecycle library can load/write envelopes
  - L8 must exist before L9 and L10 can run
  - L5 rewrites (step files) must complete before L9 first cycle (L5 is what L9 orchestrates)
  - L6 team files must match L5 step obligations (closure property)
  - L11 backlog schemas must exist before L9/L10 step-03b-backlog-fallback is implementable
  - L1 `metrics.enabled` config field must exist before L2 elicitation can write it
  - L2 elicitation should exist before L4 hooks are activated (otherwise opt-in flow is silently broken)

SOFT DEPENDENCIES (nice ordering, not required):
  - L7 charter extraction (shared safety constraints) → L9/L10 charters (reuse)
  - Historical-asset archive (L7) before new L7 charters land (avoids co-existence ambiguity per Q9)
  - L4 hooks should land one emission site at a time (risk isolation), but any order within L4 works

INDEPENDENT / PARALLELIZABLE:
  - L1 config additions and L3 schema writing touch disjoint files — can run concurrent
  - L5 step rewrites and L3 schema work touch disjoint files — can run concurrent (Epic A ∥ Epic C)
  - L6 team files depend on L5 step rewrites being drafted (not merged) to know which grants are needed
  - L10 (meta-optimize) development can happen concurrent with L9 validation; only the first-ship gate serializes them

DEFERRED DEPENDENCIES:
  - See `## PUNT LIST` section below — all deferred layers, dependencies, and open items consolidated.

## 4. Layer Map Diagram

```
HORIZONTAL LAYER MAP — Meta-Improvement System
─────────────────────────────────────────────────────────────────────────────

Config       │ L1: metrics.enabled, metrics.dir, swarm config blocks          │
             │ (hive/hive.config.yaml additions)                              │
─────────────┼────────────────────────────────────────────────────────────────┤
Kickoff UX   │ L2: elicitation "Enable metrics tracking?" → writes config     │
             │ (skills/kickoff/ question + brownfield re-kickoff flow)        │
─────────────┼────────────────────────────────────────────────────────────────┤
Metrics      │ L3: .pHive/metrics/events/*.jsonl + experiments/*.yaml         │
substrate    │    schemas + writer/reader primitives (NEW)                   │
─────────────┼────────────────────────────────────────────────────────────────┤
Emission     │ L4: Stop hook, PostToolUse, spawn report, execute phase,      │
hooks        │     escalation — 5 MVP metrics, all conditional on flag       │
─────────────┼────────────────────────────────────────────────────────────────┤
Control      │ L5: rewrite 6 step files + workflow file (authority, sandbox, │
plane        │     promotion, close-state)                                    │
─────────────┼────────────────────────────────────────────────────────────────┤
Authority    │ L6: split team file → meta-optimize.yaml + meta-meta-*.yaml   │
             │     align grants to step obligations                           │
─────────────┼────────────────────────────────────────────────────────────────┤
Charters +   │ L7: shared safety ref + 2 new charters + sandbox→isolation    │
refs         │     ref rewrite + archive historical state                    │
─────────────┼────────────────────────────────────────────────────────────────┤
Lifecycle    │ L8: envelope, baseline, compare, promote adapter, rollback   │
library      │     watch, closure validator (NEW shared module)              │
─────────────┼────────────────────────────────────────────────────────────────┤
Skills       │ L9: /meta-meta-optimize (LOCAL, NOT in plugin.json)           │
(new)        │ L10: /meta-optimize (SHIPPED, IN plugin.json)                 │
─────────────┼────────────────────────────────────────────────────────────────┤
Backlogs     │ L11: queue-meta-optimize.yaml + queue-meta-meta-optimize.yaml │
             │      fallback-mode data source                                │
─────────────────────────────────────────────────────────────────────────────

DEFERRED (separate epic):
  paths.state_dir resolver — affects L1, L3, L5, L6, L7, L9, L10, L11 paths
```

## 5. Scope Summary

```
HORIZONTAL SCOPE:
  Layers affected:       11 (L1–L11); 5 net-new (L3, L8, L9, L10, L11), 6 modified (L1, L2, L4, L5, L6, L7)
  Total items:           ~45 concrete deliverables across schemas, step files, skill files, charters, configs, and hook sites
  New vs modified:       ~25 new files; ~15 modified; ~5 archived with manifest
  Estimated total effort: LARGE

  LARGEST LAYER:   L5 (control-plane rewrite — 7 step files + workflow + paired team-grant audit)
  RISKIEST LAYER:  L9 (meta-meta-optimize — self-modifying swarm; control-plane-corruption risk per architect §5 risk #1)
  HIGHEST-UNCERTAINTY LAYER: L4 (token-capture feasibility via SDK; may force transcript-parsing fallback)
```

## PUNT LIST

All scope items explicitly NOT in this epic are consolidated here. Each item has a rationale and a resolution target.

### Deferred layers

- **`paths.state_dir` resolver** — separate epic (26 hardcode sites flagged by CodeRabbit on PR #8). Every layer touching `.pHive/` will need to honor the resolver once merged. H/V plans designed state-dir-aware but do not absorb the work.
- **Scheduler/cron trigger surface** — external to repo; design artifacts for manual + scheduled runs identically (DD §4 medium risk). Actual scheduler wiring is not in this epic.

### Deferred scope within existing layers

- **Long-tail metrics** (L4) — cache hit rate, CodeRabbit fixes per PR, memory wiki hit rate, trust score trajectory, skill invocation coverage. Out of MVP per Q8; add follow-on epic once MVP 5 prove useful.
- **Parallel experiment execution mode** (L8, L9, L10) — Q2 affirmed serial by default. Parallel mode is a follow-on gated on hardened isolation proof.
- **Per-metric asymmetric threshold classes** (L8) — Q3 anti-over-engineering. Single threshold knob for now; add classes only when a concrete consumer forces it.
- **Three-class delayed-regression handling** (L8) — Q3 auto-revert only. No auto/human/narrow split.
- **Backlog auto-surfacing from qualitative signals** (L11) — MVP is human-edit-only. Auto-surfacing from insight pipeline deferred (see NEW QUESTION 4 below).

### Resolved NEW QUESTIONS (answered during collab review)

- **NEW QUESTION 1 — L8 library location → Option A: `hive/lib/meta-experiment/`** (architect NEW_Q1_VERDICT). Non-skill module; shared runtime code consumed by both swarms.
- **NEW QUESTION 2 — L9 skill location → Option B: `maintainer-skills/meta-meta-optimize/`** (architect NEW_Q2_VERDICT). Skill-shaped but outside shipped `./skills/` root; accidental-bundling prevention is structural via manifest scope. Outline phase adds regression test asserting `plugin.json` does not reference `maintainer-skills/`.

### Open NEW QUESTIONS (pending user/outline resolution)

- **NEW QUESTION 3 — `meta_team.github_forwarding` migration destination.** Does the existing config key migrate into the new `meta_optimize` block, or stay at root for backward compat? Trivial; resolve during outline or A2 slice.
- **NEW QUESTION 4 — Backlog auto-surfacing scope.** Q7 extension mentions "may be auto-surfaced from qualitative signals." Recommendation: human-edit-only MVP; defer surfacing infra. Needs user confirm at outline review.
- **NEW QUESTION 5 — Historical ledger integrity audit.** Codex audit §3.6 flagged `commit: TBD` on meta-2026-04-13. Archive-only handling (Q9 partial migration) moves but doesn't repair. Recommending an optional A1.6 MANIFEST audit-note story; needs user call.

### Stop-hook slot conflict (B3 resolution target)

- **Shared Stop-hook slot** — the existing `~/.claude/settings.json` Stop hook serves an in-flight interrupt-sentinel story (adjacent to PR #7 work). L4's C2.2 metric-emit hook collides with this slot. Structured-outline phase must decide: combined handler with dispatch table, OR separate mechanism (e.g., PostToolUse on session-end marker, or SessionEnd hook). Not an H/V-phase decision.
