# Horizontal Plan — Meta-Improvement Reset

**Epic:** `meta-improvement-reset`
**Source:** `design-discussion.md` §3.1–3.6 + Q1-Q4 locked decisions (§6)
**Date:** 2026-05-25

## 1. Layer Inventory

| Layer | Current role | Affected by |
|---|---|---|
| **Workflow step files** (`hive/workflows/steps/meta-team-cycle/*.md`) | Markdown specs consumed by /meta-meta-optimize runtime | §3.1 (step-02b), §3.2 (step-03), §3.3 (step-03c) |
| **Workflow YAML** (`hive/workflows/*.workflow.yaml`) | Composes step sequences into named workflows | §3.4 (new meta-shotgun), §3.5 (modify meta-team-cycle for tier filter) |
| **Skills** (`skills/hive/skills/*` + `maintainer-skills/`) | User-invocable entry points | §3.4 (new `/meta-shotgun`) |
| **Config** (`hive.config.yaml`, `hive/hive.config.yaml`) | Knob layer for runtime behavior | §3.2 (`meta_optimize.signal_weights`), §3.3 (`meta_optimize.metric_gate`) |
| **Backlog schema** (`.pHive/meta-team/queue-meta-meta-optimize.yaml`) | Maintainer backlog candidates | §3.5 (`tier` field) |
| **GitHub Actions** (`.github/workflows/*.yml`) | CI/CD + autonomous PR creation | §3.6 (retarget meta-meta nightly PRs to develop) |
| **Cross-cutting concerns** (`.pHive/cross-cutting-concerns.yaml`) | Per-story concern catalog | §3.3 (verify metrics concern alignment with blocking gate) |
| **Tests** (per-module `*.test.{mjs,sh}`) | Unit + integration coverage | All — §3.1 fetch mocks, §3.2 weight mult, §3.3 gate decisions, §3.4 shotgun e2e |
| **Docs** (`hive/references/*`, `hive/GUIDE.md`, `CHANGELOG.md`) | Maintainer + consumer reference | All — new knobs, schema fields, skill |

## 2. Per-Layer Requirements

### Layer: Workflow step files

**step-02b-external-research.md changes:**
- Add `claude_code_release` subprovider section (GH releases endpoint, fetch shape, tag rule)
- Add `anthropic_blog` subprovider section (news feed endpoint, filter rule, tag rule)
- Update YOUR TASK section to mention both subsources
- Update researcher filter guidance (distinguish "Anthropic shipped X" from "Hive should adopt X")
- Update guaranteed-output contract: list per subsource is empty-on-failure, not error

**step-03-proposal.md changes:**
- Add ranking-weight section that reads `meta_optimize.signal_weights` from config
- Apply weight multiplier to existing priority score per signal source
- Defaults: all `1.0` (no behavior change); config override carries non-defaults
- Document precedence: `discovery_source` → weight lookup → multiplier on score
- PRECONDITION: verify step-03 has a multiplier surface (grill H2). If absent, add scoring before knob.

**step-03c-metric-declaration.md changes:**
- Add `metric_gate` config read (default `blocking`; `advisory` is the escape hatch)
- Flip default behavior: gate failures → block proposal from entering step-04
- Per-proposal scope: passing proposals still flow; failed proposals → `enriched_proposals[*].status: rejected_metric_gate`
- Surface rejections in PR body section
- Cycle-level failure only when zero proposals pass gate
- Cross-reference `/plan §14a` to flag drift risk

**step files for meta-team-cycle:**
- Add tier filter step (or modify step-02-analysis) to exclude `tier: little-fix` candidates from proposal pool when source = backlog

### Layer: Workflow YAML

**Modify `meta-team-cycle.workflow.yaml`:**
- Wire `meta_optimize.signal_weights` config read into step-03 inputs
- Wire `meta_optimize.metric_gate` config read into step-03c inputs
- Add tier filter (delegation per locked Q3+U2)

**New `meta-shotgun.workflow.yaml`:**
- Steps: filter tier:little-fix from backlog → exclude recent-touch (30-day) → apply changes → validate → commit + push PR → mark candidates done
- Single-PR output (no grouping per locked Q6 + grill H4)
- Sections per dir within PR

### Layer: Skills

**New `skills/hive/skills/meta-shotgun/SKILL.md`:**
- Maintainer-skill posture (lives under `maintainer-skills/` if signed decision applies; verify path)
- NOT in plugin.json public manifest (per `meta-meta-optimize-ships: no`)
- Frontmatter: name, description, args (none for v1), trigger phrases
- Process section: invokes meta-shotgun.workflow.yaml
- Preconditions: backlog has ≥1 pending tier:little-fix candidate
- Out of scope: structural/strategic candidates (those go through /meta-meta-optimize)

### Layer: Config

**hive/hive.config.yaml (shipped baseline):**
- Add commented example block for `meta_optimize.signal_weights` (defaults all 1.0)
- Add commented example block for `meta_optimize.metric_gate` (default `blocking`)
- No active changes — baseline preserves current behavior per locked Q2

**hive.config.yaml (root maintainer override):**
- Add `meta_optimize.signal_weights:` block with plugin-hive maintainer weights (per §3.2 example)
- Add `meta_optimize.metric_gate: blocking` explicit (matches new default; documents intent)
- Per `feedback_orchestrator_must_honor_backend_routing`: explicit overrides land here

### Layer: Backlog schema

**queue-meta-meta-optimize.yaml:**
- Add `tier:` field to schema (enum: `little-fix | structural | strategic`)
- Default: `structural` (treat missing field as `structural` per §4 low risk mitigation)
- Update file header comment with definition: `little-fix` = <50 lines diff + no schema/skill change
- Existing candidates: no migration needed (default fills in)

### Layer: GitHub Actions

**Locate + modify meta-meta-nightly PR creation:**
- Current default: `${{ github.event.repository.default_branch }}` = main (per PR #217)
- Change: explicit `--base develop`
- File candidates: `.github/workflows/hive-dispatch.yml:155` OR a separate `meta-meta-nightly.yml`. Story research step confirms.
- Validate: next nightly PR `baseRefName: develop`

### Layer: Cross-cutting concerns

**.pHive/cross-cutting-concerns.yaml:**
- Verify `metrics` concern (id: metrics) is consistent with blocking-gate semantics
- No schema change expected — concern already drives step-03c behavior
- Audit only

### Layer: Tests

- `step-02b/external-research-providers.test.mjs` — mock both subprovider fetches; verify candidate shape + tag + subtype
- `step-03/signal-weights.test.mjs` — weight multiplier math; defaults preserve current order
- `step-03c/metric-gate.test.mjs` — blocking mode rejects thin metric; advisory bypasses; per-proposal scope
- `meta-shotgun/integration.test.mjs` — stub backlog with 3 tier:little-fix → single PR opened
- `nightly-filter.test.mjs` — meta-team-cycle excludes tier:little-fix candidates

### Layer: Docs

- `CHANGELOG.md` — entries per surface change
- `hive/GUIDE.md` — update meta-optimize section with signal weights + metric gate references
- `hive/references/meta-optimize-maintainer.md` — extend with /meta-shotgun reference
- New: `hive/references/meta-shotgun-runbook.md` (or inline in SKILL.md references)

## 3. Cross-Layer Dependencies

```
GH Actions (3.6 retarget) ──independent── (lands first)
                                 │
                                 ▼ (provides develop-as-base flow)
External research feeds (3.1) ──independent── (lands next)
                                 │
                                 ▼ (signal source for weighting)
Backlog tier field (3.5) ──┐
                            ├── must land before
Nightly tier exclusion ────┘    meta-shotgun ships
                                 │
                                 ▼
meta-shotgun skill (3.4) ── consumes tier:little-fix from backlog
                                 │
                                 ▼ (delegation complete)
Signal weights knob (3.2) ──┐
                              │  parallel — both target step-03/step-03c
Metric gate flip (3.3) ─────┘    but flip last to avoid blocking in-flight work
```

**Critical orderings:**
- 3.6 lands first (cheap, unblocks PR flow)
- 3.5 + nightly exclusion before 3.4 (clean delegation surface)
- 3.3 LAST (per design §8 — flipping gate blocks any in-flight proposals that
  predate it; safest to ship after the new signals are producing candidates and
  the shotgun has absorbed the little-fix delegation)
- 3.2 alongside 3.3 (both modify step-03/03c; review them together)

## 4. Scope Confirmation

In scope:
- All 6 surface changes per §3.1-3.6
- Cross-cutting metrics concern verification
- Tests + docs per change

Out of scope (deferred):
- KG signal repair (separate epic per §5)
- Workflows GA adoption (separate spike outputs)
- Public meta-optimize swarm changes
- /plan §14a gate flip (follow-on after step-03c blocking proven over 2-3 cycles)
- Ecosystem feeds (Karpathy, arXiv) beyond CC releases + Anthropic blog
