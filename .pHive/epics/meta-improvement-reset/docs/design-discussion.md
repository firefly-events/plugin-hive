# Design Discussion — Meta-Improvement Reset

**Epic:** `meta-improvement-reset`
**Status:** draft (pre-grill, pre-collaborative-review)
**Date:** 2026-05-25

## 1. What Are We Doing?

User flagged 2026-05-24: meta-improvement cycles have become "motion without measurable convergence." Three open meta-meta nightly PRs (#214/216/217) prompted reflection. Diagnosis correct — last 3 cycles: two GUIDE.md tier-table touch-ups (1 line each) and one discard cycle. KG signal dead. External research signal empty. Backlog-driven proposing dominates over signal-driven proposing.

Three coupled reframes from conversation:

1. **Release-notes-weighted signals** — Claude Code release notes + ecosystem shifts (Karpathy-style "what moved upstream") become a first-class external_research subsource, with step-03 weighting that surfaces them above default. KG drops to confirming evidence (separate epic for repair).
2. **Metric gate on `enriched_proposals`** — flip shipped step-03c gate from non-blocking to blocking (with config-knob escape hatch). Every approved proposal that enters step-04 must declare the metric it moves. Failed metric → reject, surface in PR.
3. **Monthly shotgun for little fixes** (revised from quarterly 2026-05-25) — "shotgun" = dedicated batch-cleanup cycle that scoops accumulated `tier: little-fix` backlog candidates into a single PR with sections per dir. Maintainer-triggered, not auto.

Done state: next meta-meta cycle either rejects-with-reason or ships a proposal whose metric makes the win measurable, and small-fix dribble routes elsewhere.

## 2. What I Found

The infrastructure for reframes #1 and #2 mostly ALREADY EXISTS but isn't wired right.

**Step-02b external research exists** (`hive/workflows/steps/meta-team-cycle/step-02b-external-research.md`). Providers: WebSearch, WebFetch, Context7 MCP. Firecrawl deferred per PR #43. Tagged `discovery_source: external_research`, ID prefix `external-proposal-{N}`. Wired into step-03 §2b merge. Last 3 cycles: 0 external candidates. So either (a) step-02b isn't being invoked, (b) the research agent runs but returns empty, or (c) workflow YAML routes around it. Need to verify which.

**Step-03c metric declaration exists** (`hive/workflows/steps/meta-team-cycle/step-03c-metric-declaration.md`). Applies metrics cross-cutting concern to `approved_proposals` → produces `enriched_proposals` with `metric:` block. Reuses /plan §14a gate rules verbatim (rejects one-word justifications, `eventually` window). Gate is **non-blocking** — orchestrator/user decides whether to proceed with gaps. Reframe #2 wants this BLOCKING.

**Step-03 routing precedence is signal-first**: `metrics → external_research → kg_signal → dreaming_replay → backlog`. External research already second. KG signal third. Re-weighting in reframe #1 is therefore not about reordering — it's about ensuring external_research actually produces candidates and weighting *within* the merged eligible pool when rankings happen at step-03 §4.

**Two swarms exist**, both shipped: meta-optimize (public, consumer-facing, PR adapter) and meta-meta-optimize (maintainer, plugin-hive self-optimization, direct-commit). All reframes target meta-meta-optimize. Public swarm out of scope.

**No /meta-shotgun skill** — `find skills/ -name SKILL.md | grep -i shotgun|batch.fix|sweep` empty. Reframe #3 greenfield.

**Recent ledger pattern**: meta-2026-05-01 expanded a 5-line stub doc to 65 lines. meta-2026-05-13 fixed 2 GUIDE.md issues. meta-2026-05-22/23 fixed the Planning Agents tier table over two PRs (residual inconsistency). meta-2026-05-24 discard (3 STUB_DOC out_of_scope). Common: small content fixes, doc cleanup, schema-reference fixes. **None** are upstream-signal-driven product improvements.

## 3. My Proposed Approach

Five concrete surface changes, sequenced so each lands measurable:

### 3.1 Extend step-02b providers with Claude Code release-notes + Anthropic blog feeds

Add two explicit subproviders to `step-02b-external-research.md`:

**Claude Code release notes**
- Source: `https://github.com/anthropics/claude-code/releases` (GH API or RSS)
- Tag: `discovery_source: external_research` + `signal_subtype: claude_code_release`

**Anthropic blog**
- Source: `https://www.anthropic.com/news` (RSS / feed; verify endpoint at story time)
- Tag: `discovery_source: external_research` + `signal_subtype: anthropic_blog`
- Filter: model releases, capability announcements, agent SDK changes (skip company / business / policy posts)

Shared mechanics:
- Trigger: every cycle (cheap fetch per source)
- Failure handling: empty list per source, not error (treat fetch failure as zero candidates)
- Researcher persona filter (per grill H1): distinguish "Anthropic shipped X" from "Hive should adopt X"

Optional follow-on (not in scope): ecosystem feeds (Karpathy YouTube transcripts, arXiv ML systems search). Defer to second epic or backlog.

### 3.2 Add ranking weight knob to step-03

`hive.config.yaml → meta_optimize.signal_weights:`
```yaml
signal_weights:
  metrics: 1.0
  external_research: 0.9     # was implicit ~0.5; bump
  kg_signal: 0.4             # was implicit ~0.8; demote pending KG repair
  dreaming_replay: 0.5
  backlog: 0.2
```
Step-03 ranking applies the weight as multiplier on its existing priority score. Default values in shipped baseline match current behavior — weighting only activates when consumer / maintainer config overrides.

### 3.3 Flip step-03c gate to blocking

Currently non-blocking. Change:
- Gate failures (missing/thin metric, `eventually` window, one-word justification) → **block proposal from entering step-04**
- Failed proposals roll to `enriched_proposals[*].status: rejected_metric_gate` with the failing field named
- Cycle continues with passing proposals; rejected proposals surface in PR body
- Escape hatch via `hive.config.yaml → meta_optimize.metric_gate: blocking | advisory` (default: blocking). Matches existing `paths.gate_mode: warning|hard` convention. NOT a CLI flag — step-03c is a workflow step file, not a CLI surface (grill H3 resolution).

### 3.4 Build /meta-shotgun skill

`skills/hive/skills/meta-shotgun/SKILL.md` + `hive/workflows/meta-shotgun.workflow.yaml`. Maintainer-triggered.

Workflow shape:
1. Read `queue-meta-meta-optimize.yaml`, filter `tier: little-fix` AND `status: pending`
2. Apply changes in single worktree (no grouping — single PR with sections per dir)
3. Validate (test suite + lint)
4. Commit per file-or-group; push single PR titled `meta-shotgun YYYY-MM`
5. Mark candidates `status: done` in queue

Companion change: nightly meta-meta-optimize cycles add a filter step that **excludes** `tier: little-fix` candidates from their proposal pool (clean delegation per grill U2). Little-fix surface = shotgun-only.

Cadence: monthly, maintainer cron (not in plugin manifest — local-only per meta-meta charter).

### 3.5 Add `tier:` field to queue-meta-meta-optimize.yaml

Enum: `little-fix | structural | strategic`. Optional with default `structural`.

`little-fix` definition: <50 lines diff, no schema change, no skill behavior change, dormant-target rule still applies.

Stories #4 (skill) and #5 (queue field) tightly coupled — same PR likely.

### 3.6 Retarget meta-meta nightly PRs from `main` to `develop`

PR #217 confirms `baseRefName: main`. Default base comes from
`${{ github.event.repository.default_branch }}` in `.github/workflows/hive-dispatch.yml:155`
(or wherever the meta-meta-nightly workflow opens its PR — verify at execute time).

Per repo flow (`feedback_seek_direct_push_auth` memory 2026-05-21): develop is staging-trunk,
direct push permitted after feature merge; only main is gated. Meta-meta PRs targeting main
violate this convention — they bypass the develop integration layer and land on main directly
when merged. Should target develop, get exercised in staging-trunk integration, then ride a
develop→main release PR like every other feature.

Surface change:
- Locate the GH workflow that opens `meta-meta/nightly-*` PRs (likely a scheduled workflow
  that fires `/meta-meta-optimize` then `gh pr create`)
- Override `--base develop` explicitly (not via `default_branch` lookup, which still says `main`)
- Verify by running next nightly and checking `gh pr view --json baseRefName`

If the PR-create call lives inside step-07-promotion.md instead of a GH workflow, adjust there.
Either way, single-line fix once located.

## 4. What Could Go Wrong

- **High**: step-03c flip to blocking rejects proposals the maintainer would've shipped anyway (`applies:false` with thin justification). Mitigation: add the `--metric-gate=advisory` escape hatch; surface rejected proposals in PR body so they're visible not lost.

- **High**: KG signal is empty (`empty_kg` in 3/3 recent PRs) but reframes don't fix it. We're reducing KG's weight (3.2) without repairing it. Risk: KG-revival effort gets shelved. **Decision**: NOT in this epic's scope. Document as known-divergence; separate epic.

- **Medium**: release-notes feed runs every cycle but returns no actionable candidates (release notes describe bug fixes, not Hive improvements). Filter logic in step-02b must distinguish "Anthropic shipped X" from "Hive should adopt X." Researcher persona judgment required; not pure mechanical.

- **Medium**: monthly shotgun + nightly cycles overlap on same target (nightly catches small fix → shotgun also targets it). Mitigation: shotgun excludes candidates touched in last 30 days via `git log` check before grouping.

- **Medium**: weighting knob in shipped baseline = config drift risk between maintainer override and shipped defaults. Mitigation: lock shipped defaults to `1.0` for everything (preserves current behavior); only plugin-hive root `hive.config.yaml` carries non-default weights.

- **Low**: `tier:` field added to queue schema is backward-incompatible if `meta-shotgun` strictly requires it. Mitigation: default to `structural`, treat missing field as `structural`.

- **Low**: Workflows GA is on the horizon (per ~/Code/spikes/claude-workflows/findings.md). Building meta-shotgun as a classic workflow might be re-platform-able to a Workflow primitive later. Acceptable cost — meta-shotgun is small enough to swap.

## 5. Dependencies and Constraints

**Internal**:
- step-03c metric-declaration already shipped (S4 of meta-improvement-system). Modifying its gate semantics. Verify no consumer depends on non-blocking behavior.
- Backlog candidate schema in `queue-meta-meta-optimize.yaml` adds `tier:` — must update validator if one exists.
- ed-3 scope-drift emit at `plan:phase-c` — this /plan run emits on save; no schema change needed.

**External**:
- WebSearch/WebFetch tool grants must be active in agent session running step-02b. Already wired per PR #43.
- Anthropic Claude Code release feed shape — GH releases API stable; minimal risk.

**Out of scope**:
- KG signal repair (separate epic; document divergence)
- Public meta-optimize swarm changes
- Workflows GA adoption (separate spike outputs in proposals/)

**Constraints**:
- `hive/hive.config.yaml` (shipped baseline) requires human-confirmation to change per meta-safety-constraints. Will need explicit user nod on weight knob defaults.
- meta-meta-optimize is LOCAL-ONLY per signed decision `meta-meta-optimize-ships: no`. New /meta-shotgun skill must NOT appear in plugin.json public manifest. Lives under `maintainer-skills/`.

## 6. Open Questions

**Questions 1-4 locked by user 2026-05-25 at Phase B step 5 gate:**

1. **Release-notes feed scope** — ✅ **LOCKED: Claude Code releases + Anthropic blog.** Both subsources land in v1. Ecosystem feeds (Karpathy, arXiv) deferred to follow-on. Reflected in §3.1.

2. **Weight defaults** — ✅ **LOCKED: all-`1.0` baseline.** Shipped baseline preserves current behavior. Plugin-hive root `hive.config.yaml` carries maintainer-specific weights. Reframe #1 is maintainer-side first; baseline weights may flip in a follow-on epic if it wins.

3. **Step-03c gate scope** — ✅ **LOCKED: per-proposal block.** Proposal-A passes, proposal-B blocked; cycle continues with passing subset. Cycle-level failure only when zero proposals pass the gate.

4. **Monthly shotgun cadence** — ✅ **LOCKED: maintainer-triggered.** No calendar cron. Maintainer fires `/meta-shotgun` monthly. Idempotency: skip candidates touched in last 30 days via `git log`.

**Questions 5-8 carry defaults (no user redirect):**

5. **"Little-fix" threshold** — Default: <50 lines diff + no schema/skill behavior change.

6. **`/meta-shotgun` grouping heuristic** — Default per grill H4 + §3.4 simplification: single PR, sections per dir, no in-skill grouping.

7. **Escape hatch mechanism name** — Default per grill H3: `hive.config.yaml → meta_optimize.metric_gate: blocking | advisory` (config knob, not CLI flag). Matches `paths.gate_mode: warning | hard` convention.

8. **Should reframe #2 spawn a follow-on for /plan?** — Default: no. /plan's §14a gate stays unchanged this epic. If step-03c blocking + advisory escape works empirically over 2-3 cycles, follow-on can mirror to /plan.

## 7. Verification Strategy

- **Unit tests** (`node --test`):
  - step-02b: mock release-notes fetch, verify candidate shape + tag
  - step-03 ranking: weight knob applies multiplicatively; defaults preserve current order
  - step-03c gate: blocking mode rejects thin metric, passing mode preserves current behavior, escape-hatch flag bypasses
  - /meta-shotgun: filter, group, batch, exclude-recent-touch

- **Integration**:
  - Synthetic cycle with mocked external_research candidates → confirm they appear in `enriched_proposals`
  - End-to-end /meta-shotgun on stub backlog with 3 little-fix candidates → single PR opened

- **Manual**:
  - Run real /meta-meta-optimize cycle after reframes land; observe PR body mentions Claude Code release-notes candidates
  - First /meta-shotgun run on real accumulated backlog (after 30 days of cycle history)

- **Metric verification**:
  - Each story declares its metric per step-03c contract
  - Epic-level: % of cycles in next 8 producing signal-driven (not backlog) proposals; baseline 0/3 → target ≥6/8

## 8. Scale Assessment

**Medium**. Multi-file, cross-stack (step files + skill files + config + workflow YAML + GH Actions config). 6-9 stories estimated. No new orchestration substrate, no migrations. Each surface bounded.

Recommended path: Phase B2 H/V planning (default), Phase C decomposition. `--fast` would also work — the work isn't deeply cross-stack — but H/V will help sequence the step-03c flip (must come last to avoid blocking work-in-flight).

## Notes — known posture / convention deviations

- KG signal weight drop in 3.2 is deliberate divergence from `meta-meta-optimize-ships` charter intent. Documenting here per writer guidance — not a regression.
- Reframe #2 reuses /plan §14a gate semantics verbatim. Risk that step-03c spec evolves independently and the two drift. Mitigation: explicit cross-reference in step-03c.md.
- `/meta-shotgun` is the FIRST batch-cleanup skill. No prior art to follow. Will set the pattern.

## 9. Grill Pass Resolutions

Grill record: `.pHive/epics/meta-improvement-reset/docs/grill-record.md` (12 findings: 3 vocab, 4 hidden assumption, 3 tension, 0 convention, 2 posture).

| ID | Category | Resolution |
|---|---|---|
| V1 | vocabulary | **Revised inline §1 reframe #2.** "Metric gate on `enriched_proposals`" maps directly to shipped step-03c surface. Drops "cycle-proposal metric block" — was informal restatement of shipped concept. |
| V2 | vocabulary | **Revised inline §1 reframe #3.** "Shotgun" defined parenthetically as monthly batch-cleanup over `tier: little-fix` backlog → single PR. |
| V3 | vocabulary | **Revised inline §1 reframe #1.** "Release-notes-weighted" replaces "dominant" — matches §3.2 weight choice (external_research 0.9 < metrics 1.0). Rhetorical alignment with actual mechanism. |
| H1 | hidden assumption | **Accepted as known limitation.** Researcher persona judgment required to filter "Anthropic shipped X" from "Hive should adopt X." V1 noise expected. Tune via cycle-output observation after first 4 cycles. Added to §6 open question 1. |
| H2 | hidden assumption | **Accepted as story precondition.** Story implementing 3.2 weight knob must read `step-03-proposal.md` ranking mechanism in its research step before writing — if no multiplier surface exists, story scope expands to add scoring. Added to §5 dependencies. |
| H3 | hidden assumption | **Revised inline §3.3.** Mechanism is `hive.config.yaml → meta_optimize.metric_gate: blocking | advisory`. NOT a CLI flag. Matches `paths.gate_mode` convention. |
| H4 | hidden assumption | **Accepted: single PR, sections per dir.** Removes grouping heuristic complexity. Per §6 open question 6 default. |
| U1 | unresolved tension | **Resolved: metrics stay dominant.** Reframe #1 wires + weights RN as primary external_research subsource. "Release-notes-weighted" framing in V3 resolution captures this. Metrics signal (when present) still outranks RN. |
| U2 | unresolved tension | **Resolved: clean delegation.** Nightly cycles exclude `tier: little-fix` candidates after reframe #3 lands. Single-source-of-truth for little-fix backlog = shotgun. Added to §3.4. |
| U3 | unresolved tension | **Resolved: maintainer-only scope explicit.** Shipped baseline all-1.0; root `hive.config.yaml` carries plugin-hive maintainer weights. Reframe #1 is maintainer-side first; if it wins, baseline weights flip in a follow-on epic. Acknowledged in §4 medium risk. |
| P1 | posture | **Deliberate authority shift, with escape hatch.** Default flips to blocking (convergence wins over latitude); `metric_gate: advisory` opt-in preserves the orchestrator/user posture per old step-03c semantics. Combines with H3 resolution — single config knob covers both. Documented as deliberate deviation. |
| P2 | posture | **Resolved: skill is the entry point.** `/meta-shotgun` is user-invocable (maintainer-triggered cadence per reframe #3) so SKILL.md is the right surface. Workflow YAML carries step sequence — composable substrate stays intact. |

### Additional inline revisions

§3.4 step 2 grouping logic → simplified to "single PR with sections per dir" (H4 + V2). §3.4 mitigation in §4 → "nightly cycles exclude `tier: little-fix`" replaces 30-day touch dedupe (U2 cleaner). Risk listing in §4 updated.
