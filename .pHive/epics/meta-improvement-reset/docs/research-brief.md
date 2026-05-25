# Research Brief — Meta-Improvement Reset

**Epic:** `meta-improvement-reset`
**Date:** 2026-05-25
**Validation:** context7 not consulted (no library/API surface in scope); internal-only research

## 1. Diagnostic context

Three meta-meta nightly PRs (#214, #216, #217) prompted user reflection 2026-05-24: "meta-improvement without a loss function — motion without measurable convergence." Three reframes proposed:

1. Re-weight signals — release notes / ecosystem shifts dominant
2. Cycle-proposal metric blocks — proposals declare metric they move
3. **Monthly** shotgun for little fixes (revised from quarterly per user 2026-05-25)

## 2. Recent meta-team output (PRs #214/216/217)

| PR | Date | Verdict | Promoted | Notes |
|---|---|---|---|---|
| #214 | 2026-05-22 | passed | 1 | GUIDE.md Planning Agents tier fix part 1 |
| #216 | 2026-05-23 | passed | 1 | GUIDE.md tier fix continuation (residual inconsistency) |
| #217 | 2026-05-24 | discard | 0 | 3 STUB_DOC findings, all `out_of_scope` |

Every PR carries `kg-signal: findings=0 proposals=0 hit_rate_5cycle=0 miss_reason=empty_kg`. **KG signal source is dead** despite kg-signal-revival epic shipping 2026-05-15.

Recent ledger pattern: most landed changes come from `queue-meta-meta-optimize.yaml` backlog candidates (`mmo-2026-04-21-*`), not from signal-driven step-03. The "intentional, metric-anchored" cycle the user wants is structurally available but practically not firing.

## 3. Current architecture state

### 3.1 Step-02b external research — EXISTS, EMPTY

`hive/workflows/steps/meta-team-cycle/step-02b-external-research.md`:
- Providers: WebSearch + WebFetch + Context7 MCP. Firecrawl deferred per PR #43.
- Tagged `discovery_source: external_research`, ID prefix `external-proposal-{N}`
- Wired into step-03 §2b merge as eligible-pool input alongside internal findings
- No release-notes-specific provider; generic "research external sources" scope
- Last 3 cycles produced 0 external candidates

### 3.2 Step-03c metric declaration — EXISTS, NON-BLOCKING

`hive/workflows/steps/meta-team-cycle/step-03c-metric-declaration.md`:
- Applies `metrics` cross-cutting concern to each `approved_proposal`
- Produces `enriched_proposals` with `metric:` block per /plan §3 schema
- Same review-gate rules as /plan step 14/14a (rejects one-word justifications + `eventually`)
- **Gate failures NON-blocking** — orchestrator/user decides whether to proceed
- Tag: reframe #2 partially shipped; missing tightening to blocking gate

### 3.3 Step-03 routing precedence — SIGNAL-FIRST

Already implemented:
```
metrics → external_research (02b) → kg_signal (02c) → dreaming_replay (02d) → backlog (03b)
```

User reframe #1 ("release notes dominant") would re-weight within this precedence. Mechanical surface: extend step-02b providers + add release-notes-specific subprovider.

### 3.4 Two-swarm split (relevant, do not re-litigate)

- **meta-optimize** (public, consumer-targeting, PR-artifact promotion)
- **meta-meta-optimize** (maintainer, plugin-hive self-optimization, direct-commit promotion)

Both shipped under meta-improvement-system epic (10 slices). All reframes target meta-meta-optimize (plugin-hive's own loop). Public swarm handled by separate consumer config; not in scope for this reset.

### 3.5 No batch-cleanup / shotgun skill

`find skills/ -name SKILL.md | xargs grep -l shotgun|batch.fix|sweep` → empty. Reframe #3 is greenfield.

## 4. Gap analysis (reframe → state → work)

| Reframe | Disk state | Gap | Effort |
|---|---|---|---|
| **#1 release-notes-dominant signal** | step-02b empty; no RN provider | release-notes-specific provider (Claude Code changelog feed); priority knob to boost `discovery_source: external_research` in step-03 ranking; KG signal source repair (separate concern) | medium |
| **#2 cycle-proposal metric blocks** | step-03c ships; non-blocking | flip gate to blocking; surface failures in PR body; reject patterns identical to /plan §14a | low |
| **#3 monthly shotgun for little fixes** | no skill | new `/meta-shotgun` skill; "little-fix" tag on backlog candidates; monthly cron / triggered by maintainer; batches accepted candidates into one PR | medium-high |

## 5. Outstanding questions surface

- Why is KG signal `empty_kg` in PR bodies despite kg-signal-revival shipping? (Out of scope for this epic, but blocks reframe #1 confidence)
- Should external_research provider list expand or stay current with explicit Claude Code changelog source added?
- Monthly shotgun cadence: cron (autonomous) or manual trigger?
- "Little fix" definition: file count, line count, or risk-tier?

## 6. File / surface inventory (for planning)

Modify:
- `hive/workflows/steps/meta-team-cycle/step-02b-external-research.md` — providers + RN subprovider
- `hive/workflows/steps/meta-team-cycle/step-03-proposal.md` — ranking weight knob
- `hive/workflows/steps/meta-team-cycle/step-03c-metric-declaration.md` — blocking gate flip
- `hive.config.yaml` — add weight tuning knobs (`meta_optimize.signal_weights.*`)
- New: `skills/hive/skills/meta-shotgun/SKILL.md`
- New: `hive/workflows/meta-shotgun.workflow.yaml`
- Touch: `.pHive/meta-team/queue-meta-meta-optimize.yaml` (add `tier: little-fix` field)

Read-only verify:
- `.pHive/meta-team/ledger.yaml` (post-implementation, watch source mix shift)
- KG db state (separate epic; not in this scope)

## 7. Inconsistency-risk signals (for /grill consumption)

- **Vocabulary**: "cycle-proposal metric block" overlaps with shipped step-03c `enriched_proposals.metric:` — same shape, different name. Risk that planner spec re-invents shipped surface.
- **Hidden assumption**: "release notes dominant" assumes Claude Code release notes are the highest-signal upstream input. May not be: ecosystem-wide shifts (Karpathy, arXiv) could dominate when CC stable.
- **Convention tension**: "monthly shotgun" cadence + meta-meta nightly cadence — risk of overlap (nightly catches small fix → shotgun also targets it → duplicate work).
- **Posture mismatch**: Reframes are control-plane changes to meta-meta-optimize but inherit `Codex-for-work / Opus-for-review` backend split. Verify backends route correctly for new skill.

## 8. References

- `~/Code/spikes/claude-workflows/findings.md` — Workflows budget API study (companion to reframe #2)
- `.pHive/proposals/dag-executor-workflows-vocabulary.md`
- `.pHive/proposals/story-budget-block.md` (downstream of reframe #2)
- `.pHive/meta-team/charter-meta-optimize.md`, `charter-meta-meta-optimize.md`
- `hive/references/story-yaml-schema.md` §3 metric field group
- `.pHive/cross-cutting-concerns.yaml` §metrics
- `hive/references/meta-safety-constraints.md`
