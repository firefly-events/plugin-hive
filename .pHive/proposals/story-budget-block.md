# Proposal — Add `budget:` block to story spec

**Status:** draft (pre-/plan)
**Author:** Don Matthews + co-pilot
**Date:** 2026-05-25
**Source:** spike `~/Code/spikes/claude-workflows/findings.md` + conversation 2026-05-24 ("we should be measuring token spend")
**Scope:** schema add + executor enforcement

## Problem

Stories declare `metric:` blocks for outcome measurement (post-merge verdict) but have no **per-step token-spend gate**. Meta-improvement cycles have been "random little fixes" without metric anchoring (user feedback 2026-05-24). Token spend is the obvious lever; we don't measure it per-story.

Claude Code Workflows ships a tested API for exactly this:

```js
budget = {
  total,         // user-set output-token target
  spent(),       // tokens spent this run
  remaining(),   // max(0, total - spent())
}
```

Hard ceiling — once `spent()` reaches `total`, further dispatch throws.

## Target

Add `budget:` block to story spec YAML:

```yaml
budget:
  output_tokens: 200000   # hard ceiling for the story's leaf agents
  warn_at: 150000         # narrator log when crossed
```

Executor enforcement:
- Track output-token spend across all leaf agent dispatches for the story
- Block new dispatch once `output_tokens` exceeded
- Log warning at `warn_at` threshold
- Surface remaining budget in standup + status

Story spec authoring rule:
- Stories without `budget:` opt out (no enforcement)
- Stories with `budget:` opt in (enforced, surfaced)
- Default budget per story type (low/medium/high) lands in hive.config.yaml

## Rationale

- Steals tested API verbatim from Workflows — `{ total, spent(), remaining() }`
- Fills the gap user flagged 2026-05-24: meta cycles must declare a metric each proposal moves
- Provides the carrier for the metric ("reduce /execute token spend per story by X%")
- Forward-compatible with Workflows GA — when leaf agents become Workflow `agent()` calls, the budget primitive composes

## Out of scope

- Per-epic and per-cycle budgets (followup proposal if per-story lands well)
- Auto-pricing (USD cost) — output tokens only, keep simple
- Input-token budget (Workflows ships output-only; match)

## Estimated cost

MEDIUM. Story spec schema change + executor token tracker + standup surface. New tests. Single epic, 3-4 stories.
