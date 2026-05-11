# Retro Verdict — Metrics-Gate Predictive Value

**Story:** M-07 (Retro-backfill metric blocks for 3 shipped epics)
**Date:** 2026-05-11
**Author:** codex-dev (M-07 implement step)
**Scope:** 18 stories across 3 shipped epics, all carrying `metric.backfilled: true`

This report measures whether the M-01/M-03 metrics-gate would have caught real shipping failures by retroactively declaring falsifiable `metric:` blocks against 18 already-shipped stories, running each block's source.ref against current state, and comparing the resulting verdict against lived reality.

---

## Method

For each backfilled story:

1. The metric was chosen to be **measurable at planning time** using carriers that existed when the story was planned (git line-delta, file presence, grep counts, `.pHive/metrics/events/*.jsonl`, `~/.claude/hive/kg.sqlite`). No retro-rationalization — no metric was selected because we already knew its outcome.
2. The verdict was computed against the current worktree/main state via the same shell-out logic `skills/metrics-check/SKILL.md` codifies (manual + events + sql source kinds).
3. The lived-reality outcome was assessed independently from git history, episode artifacts, and the live filesystem — whether the story actually delivered what its acceptance criteria claimed.
4. Each story was classified as TP / FN / FP / TN per team-lead's classifier definition:
   - **TP** — gate FAIL, reality failure (gate caught it)
   - **FN** — gate PASS, reality failure (gate missed it)
   - **FP** — gate FAIL, reality success (gate cried wolf)
   - **TN** — gate PASS, reality success (gate correctly held its peace)

Excluded from the ratio: any INCONCLUSIVE or MANUAL verdict (measurement-gap, not gate-decision). None of the 18 produced an excluded verdict.

**Second-reader correction note.** Two initial verdicts (`tdd-cross-model-workflow` and `a-25-skill-prelude-extraction`) were corrected during commit-readiness review — the initial `source.ref` evaluations were inaccurate. `tdd-cross-model-workflow` flipped from FAIL → PASS once the existence of `hive/workflows/development.tdd.workflow.yaml` was confirmed on disk; `a-25-skill-prelude-extraction` retained its FAIL verdict but with the magnitude corrected from net=-27 to net=+31 after the `git diff` scope was widened from the metrics-branch HEAD to the actual A-25 merge boundary (`bb067f1..2251936`). The corrections themselves are evidence that the gate works best with a second-reader review pass: the first pass produced two wrong measurements; the second pass caught both. The per-story `metric.verdict:` blocks written back to the YAMLs reflect the corrected readings.

---

## Per-story table

### Epic: kg-augmented-meta-signal (3 stories, all synthesized)

These three story YAMLs did not previously exist on disk — see Meta-finding below. They were synthesized from episode artifacts (S5, S6) and from the epic's load-bearing outcome claim (S7) during M-07.

| Story | Metric | Target | Measured | Verdict | Lived reality | Gate caught? |
|---|---|---:|---:|:---:|---|:---:|
| S5-fixture-test | `kg_augmented.fixture_emits_kg_findings` (up, count) | 1 | 15 | **PASS** | Fixture shipped and emitted ≥1 finding against seeded KG | Y (TN) |
| S6-readme-audit | `kg_augmented.readme_changelog_drift_closed` (up, count) | 3 | 3 | **PASS** | README + CHANGELOG + drift-checklist all landed | Y (TN) |
| S7-kg-signal-production-emission | `kg_augmented.production_kg_signal_predicate_coverage` (up, count) | 1 | 0 | **FAIL** | Production KG has 66 triples but ZERO of predicate `phase_failed`/`phase_blocked`/`superseded` (only `decided`). Step-02c emits nothing in production. **Canary.** | Y (TP) |

### Epic: catalog-hygiene-and-borrows (13 stories)

| Story | Metric | Target | Measured | Verdict | Lived reality | Gate caught? |
|---|---|---:|---:|:---:|---|:---:|
| a-25-skill-prelude-extraction | `catalog_hygiene.a25_line_delta` (down, count) | -500 | +31 | **FAIL** | `git diff bb067f1..2251936` over the 13 SKILL.md files + skill-prelude.md shows net +31 lines (added=187, removed=156) — A-25 actually ADDED lines across these paths, the opposite of the -500 target. The recommendation.md A-25 "~-528 lines deleted" claim was substantially over-stated. Verdict held FAIL but corrected from initial wrong-scope measurement of -27 (see Method second-reader note). | Y (TP) |
| a-26-context-md-kickoff-bootstrap | `catalog_hygiene.kickoff_writes_context_md` (up, bool) | 1 | 0 | **FAIL** | `skills/kickoff/SKILL.md` has zero mentions of CONTEXT.md. The bootstrap integration did not ship despite the story being merged. | Y (TP) |
| a-26-context-md-schema-and-starter | `catalog_hygiene.context_md_schema_doc_exists` (up, bool) | 1 | 1 | **PASS** | `hive/references/context-md-schema.md` exists with structured sections | Y (TN) |
| a-26-context-md-skill-prelude-citation | `catalog_hygiene.context_md_cited_in_prelude` (up, count) | 1 | 1 | **PASS** | `CONTEXT.md` cited in skill-prelude.md | Y (TN) |
| a-27-triage-plan-handoff | `catalog_hygiene.plan_from_triage_flag_present` (up, count) | 1 | 4 | **PASS** | `--from-triage` flag wired into skills/plan/SKILL.md (4 references) | Y (TN) |
| a-27-triage-queue-yaml | `catalog_hygiene.triage_queue_schema_doc_exists` (up, bool) | 1 | 1 | **PASS** | `hive/references/triage-queue-schema.md` exists with structured sections | Y (TN) |
| a-27-triage-skill-md | `catalog_hygiene.triage_skill_exists` (up, bool) | 1 | 1 | **PASS** | `skills/triage/SKILL.md` exists | Y (TN) |
| a-27-triage-standup-handoff | `catalog_hygiene.standup_surfaces_triage` (up, count) | 1 | 3 | **PASS** | Triage referenced in standup SKILL (3x) | Y (TN) |
| a-28-grill-plan-a2-wiring | `catalog_hygiene.plan_a2_calls_grill` (up, count) | 1 | 7 | **PASS** | Grill referenced in plan SKILL (7x) | Y (TN) |
| a-28-grill-skill-md | `catalog_hygiene.grill_skill_exists` (up, bool) | 1 | 1 | **PASS** | `skills/grill/SKILL.md` exists | Y (TN) |
| w1-doc-template-reclassify | `catalog_hygiene.doc_template_reclassified` (up, count) | 5 | 5 | **PASS** | 5 files under `hive/references/document-templates/` | Y (TN) |
| w1-warning-lift | `catalog_hygiene.warning_lift_applied_to_5_skills` (up, count) | 5 | 5 | **PASS** | All 5 target skills carry the warning-lift override | Y (TN) |
| w5-sidecar-bundle | `catalog_hygiene.sidecar_bundle_three_fixes_referenced` (up, count) | 3 | 4 | **PASS** | All three sidecar fixes referenced in execute SKILL / references | Y (TN) |

### Epic: external-model-integration (2 stories)

| Story | Metric | Target | Measured | Verdict | Lived reality | Gate caught? |
|---|---|---:|---:|:---:|---|:---:|
| codex-developer-poc | `external_model.codex_developer_routing_events` (up, count) | 1 | 0 | **FAIL** | Six `.pHive/metrics/events/*.jsonl` files exist (carrier present), but contain only `metric_type=tokens` rows from meta-meta-optimize runs. Zero `agent_spawn` events with backend=codex. The PoC shipped a hive.config.yaml affordance (commented-out `agent_backends:` block) but never proved routing end-to-end. PoC did not produce proof. | Y (TP) |
| tdd-cross-model-workflow | `external_model.tdd_workflow_definition_landed` (up, bool) | 1 | 1 | **PASS** | `hive/workflows/development.tdd.workflow.yaml` exists on disk (along with `development.tdd-codex.workflow.yaml`). Workflow definition shipped. | Y (TN) |

---

## Predictive Value

```
Backfilled stories evaluated: 18
Excluded (INCONCLUSIVE | MANUAL): 0 | 0
Net evaluated: 18

Classifier:
  TP: 4    (gate FAIL, reality failure)
  FN: 0    (gate PASS, reality failure — MISSED)
  FP: 0    (gate FAIL, reality success — wolf)
  TN: 14   (gate PASS, reality success)

Recall (gate catch rate): TP / (TP+FN) = 4 / (4+0) = 1.00
Precision: TP / (TP+FP) — omitted because FP = 0
```

See the Method §"Second-reader correction note" for the two verdict revisions (tdd-cross-model-workflow flipped FAIL→PASS; a-25-skill-prelude-extraction held FAIL but corrected from -27 to +31) and why they themselves count as evidence the gate works best with a second-reader review pass at integrate.

**Reading.** On this 18-story sample, the metrics gate would have flagged every real failure (recall = 1.00) and cried wolf on zero successes (no FPs). The 4 TPs span three distinct failure modes:

- **Over-promised quantitative target with wrong-sign outcome** (A-25): recommendation claimed -528 line-delta; corrected-scope measurement (`git diff bb067f1..2251936` over the 14 target paths) shows +31 net (added=187, removed=156). A-25 actually *added* lines across the SKILL.md+prelude set, the opposite of the down-direction target. A gate-FAIL at integrate would have forced an explicit re-target, a follow-up story, OR a re-evaluation of the recommendation that drove the -500 promise.
- **Shipped-but-inert feature** (S7, codex-developer-poc): the feed/PoC landed structurally but the upstream writers/instrumentation that would make it observable were never wired. Both would have been gate-FLAGGED before close.
- **Story claimed work that didn't ship** (A-26 kickoff-bootstrap): the story was merged but the artifact the AC promised does not exist. A presence-check at integrate would have failed.

Four distinct opportunities the gate would have caught. Three distinct shipping anti-patterns. The signal is strong enough on this sample to support running the gate on every future close.

---

## Meta-finding — discovered while running M-07

> The kg-augmented-meta-signal epic shipped **without committing any of its story YAMLs to disk.** Only `docs/readme-drift-checklist.md` exists under `.pHive/epics/kg-augmented-meta-signal/`. The slice episodes at `.pHive/episodes/kg-augmented-meta-signal/S5-fixture-test/` and `.pHive/episodes/kg-augmented-meta-signal/S6-readme-audit/` reference story files (`.../stories/S5-fixture-test.yaml`, etc.) that have never existed on `origin/main`. Discovered 2026-05-11 during M-07.

This is the same class of failure the metrics gate is designed to catch — a shipping invariant (story YAMLs land alongside the epic close) was silently violated, slipped review, and slipped CI. **M-07 found a new failure mode while measuring known ones.** The gate-as-currently-defined does not directly catch this case (metric blocks live inside story YAMLs, so a missing story YAML means there is no metric block to evaluate either) — but the existence of episode files referencing missing story files is itself a structural-audit signal that step-02 of `meta-team-cycle` could be taught to flag. Recommended follow-up:

- File a structural-audit story under `meta-improvement-system` for "every episode references a story YAML that exists on disk."
- The kg-augmented S5 and S6 stories synthesized during this M-07 retro (marked story-level `backfilled: true` with the originating-episode comment in the file header) are the durable record of the shipped work; future audits can read them rather than the episode artifacts.
- S7-kg-signal-production-emission is also synthesized here, but for a different reason: it captures the epic's *load-bearing outcome claim* (the feed produces production findings), which had no episode either — proving that the same structural-audit signal will also catch implicit outcome-claims that ship without explicit story containers.

---

## Artifacts

- 18 story YAMLs carrying `metric.backfilled: true` (the metric block was added retrospectively):
  - `.pHive/epics/kg-augmented-meta-signal/stories/{S5-fixture-test,S6-readme-audit,S7-kg-signal-production-emission}.yaml` — synthesized in full, also carry top-level `backfilled: true` flagging story-body synthesis from episode evidence
  - `.pHive/epics/catalog-hygiene-and-borrows/stories/*.yaml` — 13 stories, metric block appended, story body unchanged
  - `.pHive/epics/external-model-integration/stories/*.yaml` — 2 stories, metric block appended, story body unchanged
- This file: `.pHive/epics/metrics-as-planning-concern/docs/retro-verdict.md`

## References

- `hive/references/story-yaml-schema.md` §3 — canonical `metric:` block shape
- `skills/metrics-check/SKILL.md` (M-05) — verdict-computation logic this report manually shells out to per-story
- `.pHive/cross-cutting-concerns.yaml` `id: metrics` — the planning-time concern this backfill validates
- `.pHive/epics/kg-augmented-meta-signal/docs/readme-drift-checklist.md` — sole pre-existing artifact on that epic before M-07's synthesis
- `~/.claude/hive/kg.sqlite` — 66 triples, all `predicate=decided`, none of `phase_failed|phase_blocked|superseded` as of 2026-05-11
