# Design Discussion — meta-hive-discipline-may2026

**Epic:** Execution-quality + skill-ergonomics meta-improvements
**Date:** 2026-05-17
**Source issues:** [#131](https://github.com/firefly-events/plugin-hive/issues/131), [#132](https://github.com/firefly-events/plugin-hive/issues/132), [#133](https://github.com/firefly-events/plugin-hive/issues/133), [#134](https://github.com/firefly-events/plugin-hive/issues/134)

## §0 — PRIOR DECISIONS (from KG pre-flight)

Three prior decisions surfaced by `/hive:why` are directly relevant constraints on this plan:

- **structural-refactor-and-gate-lift, 2026-05-11** — Codex parallel-dispatch race documented (`feedback_codex_parallel_race.md`); default-serial pattern already validated in earlier epics. **#132 honors this — does not supersede.**
- **structural-refactor-and-gate-lift, 2026-05-11** — `agent_backends` routing established 2026-05-01: researcher/developer/writer/architect → Codex; reviewer/tester/peer-validator → Claude. **Both #132 (orchestrator gate) and #133 (detection skill) must respect this routing.**
- **hive-composability-audit, 2026-05-09** — sandcastles substrate adoption pattern explored. **#133 may mine sandcastle event streams as a signal source.**

## §1 — Goal

Ship four substrate improvements to plugin-hive that the maintainer flagged from lived experience in recent /plan and /execute cycles:

1. **Quantitative drift signal** at every phase boundary so we can measure (not just feel) when scope diverges from plan. Track over time as a quality metric.
2. **Strict parallelization contract** — default serial; parallel only when explicitly justified (variation, read-only, proven-no-overlap). Stops divergent-architecture rework that's been the source of recent correction debt.
3. **Skill-candidate detection** — mine session events / git / KG for recurring patterns, surface candidates, hand off to skill-authoring.
4. **`/design` promoted to top-level command** — callable outside `/plan` for ad-hoc, mid-execution, or polish-pass use.

North star: substrate that *measures its own discipline* (drift score) and *enforces its own contracts* (parallel gate, skill-detect), reducing the orchestrator's reliance on lived-experience vibes.

## §2 — Proposed Approach

### Slice 1: Execution Discipline (#131 + #132)

**Why bundled:** Both expand cycle-state schema. Planning together avoids correction debt from divergent schema versions.

**#131 drift score:**
- Extend handoff schema in `hive/references/cross-swarm-handoff.md` with `expected_scope`, `delivered_scope`, `delta_reasons[]`.
- Register `drift_score` metric type in `hive/lib/metrics/core.py:EVENT_METRIC_TYPES`. Bucketed first (`none|minor|major|divergent`), normalized 0-1 deferred.
- Emit at every phase boundary in `/plan`, `/execute`, `/review`, `/standup`. Single shared helper in `hive/lib/drift.py` so emit logic stays atomic.
- Surface in `/hive:status` (trend over recent runs) + new section in `/standup`.

**#132 parallelization rules:**
- Add `parallel_allowed: bool` (default `false`) + `parallel_rationale: variation|read-only|bounded-slice` to story YAML schema (`hive/references/story-yaml-schema.md`).
- `/plan` Phase C step 13 emits the fields per story. Default behavior is omit → serial.
- `/execute` dispatch (`skills/execute-dispatch/SKILL.md`) refuses fan-out unless both fields present with allowed rationale.
- For `parallel_rationale: bounded-slice`, lint declared `files_to_modify` touch-sets disjoint across sibling stories before dispatch.
- Existing parallel call sites (research swarms, parallel team reviews) get explicit `parallel_rationale: read-only` so they pass the new gate cleanly. Audit pass during story decomposition.

### Slice 2: Skill Ergonomics (#133 + #134)

**Why bundled:** Both touch the skill catalog surface. Independent of slice 1 internals, but #133 mines #131's drift metric, so external sequencing: slice 1 → slice 2.

**#133 skill-candidate detection:**
- New skill `skills/skill-candidate-detect/SKILL.md` (or compose into existing `/meta-optimize`).
- Mine: `.pHive/metrics/events/*.jsonl` (recurring event patterns), `.pHive/kg.sqlite` (recurring decision shapes), `git log` (recurring commit subject patterns), `.pHive/cycle-state/*.yaml` (recurring escalation/decision shapes).
- Rank candidates by (occurrence count × recency × distinctness). Output: `.pHive/meta/skill-candidates.yaml`.
- Hand off to `write-skill`. **Open question:** verify `write-skill` exists or include authoring story.
- Brownfield gate — skip-with-message on `project_maturity: greenfield|early` (matches #80 pattern).

**#134 `/design` top-level:**
- New `skills/design/SKILL.md` with `name: design` frontmatter, mirroring `/plan`, `/execute` shape.
- Extract design-discussion authoring from `/plan` Phase B into the new skill.
- `/plan` Phase B invokes external `/design` skill (atomic boundary — same pattern as planning-routing, grill).
- Accept `--artifact-target {design|implementation}` for parity with `design-review`.
- Disambiguate from `design-review` / `design-system` in skill description triggers.

## §3 — Risks

| ID | Severity | Risk | Mitigation |
|----|----------|------|------------|
| R1 | High | `#132`'s "proven-no-overlap" gate assumes planning emits *accurate* touch-sets; today `files_to_modify` is often aspirational | Add post-implement verification hook that re-checks declared vs actual touch-sets; flag mismatches as a story-level drift signal (#131) |
| R2 | Medium | `write-skill` may not exist in repo; #133 produces dead-end output | Pre-plan verification: grep skills tree before story decomposition. If missing, add authoring story (or out-of-scope) before drafting #133 |
| R3 | Medium | "Drift" overloaded vocabulary — scope-drift here vs context-drift elsewhere | Explicit naming in code: `scope_drift_score` not `drift_score`; reserve "drift" for context drift |
| R4 | Medium | `#134` `/design` collides with existing `design-review` / `design-system` skill descriptions; trigger ambiguity | Skill description must be unambiguous; add disambiguation note in design-review/SKILL.md |
| R5 | Low | New parallel gate (#132) breaks existing research-swarm parallel calls | Audit pass during decomposition; tag all existing parallel call sites with `parallel_rationale: read-only` |
| R6 | Low | Drift-score emit performance — extra JSONL writes at every phase boundary | Phase boundaries are O(10) per run, not hot path; shared helper in `hive/lib/drift.py` keeps cost flat |

## §4 — Dependencies

- **Internal:**
  - Slice 2 depends on Slice 1 shipping first (detection mines drift metric).
  - All work depends on `hive/references/cycle-state-schema.md` and `hive/references/cross-swarm-handoff.md` stability — no concurrent epic should be expanding those.
  - #133 has soft dependency on #80 (brownfield-maturity-metrics) — both want a maturity gate.
- **External:**
  - None — all changes are in-repo, no library/SDK additions.

## §5 — Open Questions for User

1. **`write-skill` existence:** Is this an external Claude Code marketplace skill, or do we add authoring as part of this epic?
2. **Drift-score model:** Confirm bucketed (`none|minor|major|divergent`) for v1, normalized 0-1 deferred?
3. **`#80` interaction:** Should #133 hard-block on #80 landing, or replicate the maturity gate inline?
4. **`/design` scope:** Promote *just* design-discussion authoring? Or bundle wireframe + design-review under one umbrella?
5. **Single epic vs split:** Slice 1 + Slice 2 in one epic, or two separate epics (`exec-discipline-may2026`, `skill-ergo-may2026`)? One epic argued in §2; user may prefer split for parallel /execute runs.

## §6 — Scale Assessment

**Recommendation: MEDIUM**

Reasoning:

- Cross-stack work — touches `hive/lib/` (drift.py, metrics/core.py), `hive/references/` (schema docs), `skills/plan/`, `skills/execute/`, `skills/standup/`, `skills/design/` (new), `skills/skill-candidate-detect/` (new). Multi-layer.
- ~8-12 stories expected across 2 slices.
- Not large: no novel external integration, no data migration, no UI surface, no long-horizon migration.
- Not small: more than 3 files, more than one skill, contract changes.
- Run H/V planning to slice correctly. **Recommend default path (no `--gate-hv`), no `--fast`** — collaborative review covers the H/V gate without a user pause.

## §7 — Inconsistency-Risk Signals (for grill skill)

```yaml
inconsistency_risk_signals:
  - signal: vocabulary-overloaded
    severity: medium
    detail: |
      "Drift" is used here for scope drift (expected vs delivered), but the
      memory system uses "drift" for context drift (cache, session). Need
      explicit naming disambiguation. Recommend `scope_drift_score`.

  - signal: hidden-assumption
    severity: high
    detail: |
      #132's bounded-slice gate assumes planning emits accurate touch-sets.
      Today `files_to_modify` is often aspirational. Gate-passes-but-reality-
      diverges hazard. Needs verification hook (R1).

  - signal: convention-violation-risk
    severity: medium
    detail: |
      Top-level `/design` interacts with existing `design-review` and
      `design-system` skills. Description trigger ambiguity will route
      user `/design` invocations to wrong skill.

  - signal: posture-mismatch
    severity: high
    detail: |
      #133 framing assumes write-skill exists. Detection without authoring
      = dead-end output. Verify before story decomposition or expand scope.

  - signal: unresolved-tension
    severity: low
    detail: |
      #133 wants brownfield gate but #80 (mhg-1-brownfield-maturity-metrics)
      is hive:failed and stale. Either #133 inherits the gap or replicates
      inline. Sequencing question.
```

## §8 — North-Star Alignment Check

- **Audit-trail (NS2):** drift-score emission directly extends the audit-trail (per-phase records to JSONL + KG). ✓
- **Composable substrate (NS1):** new `/design` skill increases composability; #132's gate adds discipline without removing flexibility. ✓
- **Self-improving meta-loop (NS3):** #133 is direct support for the meta-loop — substrate detects what to skillify. ✓
- **Brownfield-maturity gating (NS4 implicit):** #133 explicitly respects greenfield/early skip; #131 drift signal is most useful on established projects. ✓

— End design discussion —
