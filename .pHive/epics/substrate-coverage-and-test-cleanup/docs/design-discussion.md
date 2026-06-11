# Design Discussion — substrate-coverage-and-test-cleanup

**Epic:** substrate-coverage-and-test-cleanup (Part 2 of cc-workflows-first-party)
**Phase:** B — Design Discussion (REVISED post-grill + collab-review)
**Author:** technical-writer
**Date:** 2026-06-05 (rev. 1)
**Source brief:** `.pHive/epics/substrate-coverage-and-test-cleanup/docs/research-brief.md`
**Source outline:** `.pHive/proposals/substrate-coverage-and-test-cleanup-outline.md`
**Grill record:** `.pHive/epics/substrate-coverage-and-test-cleanup/docs/grill-record.md`
**Collab review:** `.pHive/epics/substrate-coverage-and-test-cleanup/docs/collab-review-record.md`

---

## 1. What Are We Doing?

We want every dispatching slash skill — `/plan`, `/execute`, `/test`, `/design`, `/design-review`, `/review` — to have full **Multica + cc-workflows mode coverage**. Today only `/plan` and `/execute` have both substrate variants; `/test` has Multica only; `/design`, `/design-review`, and `/review` have neither. We're closing the matrix.

While we're in there, we fold in three semantic alignments that surfaced during the cc-workflows-first-party session:

1. `/test` becomes a swarm-only pipeline — the `--simulated-manual` flag is hard-ripped, scenario-replay becomes a step inside the swarm, and `test-sentinel`'s triage step file (NOT the persona — see §4 medium-severity) bounces a story tracker to `needs-rework` when triage categorises a failure as a real `story-issue` (not transient, not human-blocker).
2. `/design` grows from a single `ui-designer` dispatch into a 3-persona pipeline (accessibility-specialist + animations-specialist constraint pass, then ui-designer wireframes ONCE with constraints baked in — proposed default is Pattern B / constraint-injection-upfront, but the posture choice is unresolved; see §6 Q6). Sits ABOVE the dispatch layer so it works in every mode.
3. `/design-review` keeps its original intent (audit-shipped-design); substrate parity adds Multica + cc-workflows without changing semantics.

**Vocabulary:** This doc uses "slice" (A/B/C/D/E) for continuity with Part 1 (cc-workflows-first-party) and the source outline. CONTEXT.md notes new epics prefer "wave", but Part 2 is a paired continuation of Part 1 — preserving the term avoids cross-doc translation cost. [ACCEPTED — justification: paired-epic continuity; grill V1 noted but explicitly retained.]

"Done" looks like: **18 stories** (17 from outline + s-4 worktree-isolation gate added per architect ESCALATION + grill H1/C1; see §3 Slice E) merged behind a single epic branch; every dispatcher resolves a `mode_decision` at Phase 0c via the same 5-tier resolver; `dispatch-parity.md` matrix marks every cell green; cc-workflows lint blocks any future Codex routing (direct or indirect) from leaking into a cc-workflows mode skill.

## 2. What I Found

The research-brief (Section 2) catalogues the surface area cleanly — every dispatcher exists today, but only one of the four new `*-mode-cc-workflows` siblings has a precedent (plan + execute already shipped). Highlights that shape the approach:

- **Canonical 5-tier resolver pattern** lives at `skills/plan/SKILL.md:115-141` (Phase 0c) and `skills/hive/skills/execute-dispatch/SKILL.md:46-101` (Step 0 field-source-tracking). Env > root config > shipped baseline > skill override > default. Every new router should call the SAME helper, which is exactly what Slice E `s-2` proposes (`hive/lib/mode-resolver.mjs`).
- **Atomic `*-mode-cc-workflows` shape** is ~330-360 lines and follows a fixed 6-step structure: precondition gate → per-persona serial dispatch → poll-to-terminal → episode marker write → sidecar no-op → aggregate return (`skills/hive/skills/plan-mode-cc-workflows/SKILL.md`). Defensive args parse contract (`const a = typeof args === 'string' ? JSON.parse(args) : args;`) is mandatory at the top of every assembled Workflow script.
- **No Codex routing in cc-workflows mode, ever** — substrate finding `codex-rescue-forwards-not-executes` (PR #241 fix 8c41671). Every `agent()` uses the default workflow subagent; persona behavior comes from the prompt body, not the runtime. Slice E `s-3` adds a multi-surface lint (AST + grep) to lock this in across direct (`agentType:`), skill-invoke (`codex:codex-rescue`), and config-key (`agent_backends`) routes.
- **`design-review.workflow.yaml`** already runs a 3-persona pipeline (accessibility → animations → ui-designer critique → ui-designer synthesis) via per-step `step_file` references (lines 8-81). The personas are ready; what's new is wrapping them in mode skills. **Slice B `d-1` MUST reuse this orchestration template** — the assembly+serial-dispatch shape is already proven, and re-inventing it would architecturally diverge Slice B from Slice C for no reason (architect ESCALATION).
- **`test-mode-multica`** (415 lines, resolver at lines 36-43 + 89-99) is the closest reference for `test-mode-cc-workflows`. Per-scenario dispatch shape.
- **`execute-mode-multica`** (472 lines) is the closest reference for `design-mode-multica` + `design-review-mode-multica` — per-persona dispatch within a team, episode markers per persona, serial within team-cell.
- **Adapter ABI** (`hive/lib/task-tracking-dispatch/index.ts:205-282`) routes everything through `invoke(method, params)`. Capabilities surface via `capability('supported_states')` (285-288), which gives Slice A `t-2` a defensive opt-in path.
- **Two pieces of audit evidence diverge from the outline:** (a) GitHub `updateStatus({state})` only accepts `open|closed`, throws `OPERATION_UNSUPPORTED` for anything else (`hive/adapters/github/index.ts:296-302`); (b) Multica's analogue is `updateStory({status})`, different method name AND different param key (`hive/adapters/multica/index.ts:335-348`). This is the headline blocker for `t-2` — see §4 and §6 Q2.

## 3. My Proposed Approach

I'd land the epic in five slices, mostly parallel, with Slice E reading from all four others. Branch: `feat/substrate-coverage-and-test-cleanup` off develop. One commit per story.

**Slice ordering & sequencing.** A/B/C/D/E are NOT a hard serial sequence. The dependency graph is: A/B/C/D are mutually independent at the slice level; E reads from all four. Two cross-slice sequencing constraints apply:

- **Slice E `s-2` (mode-resolver helper) should land BEFORE Slices B/C/D net-new routers**, or those routers will inline the resolver and `s-2` becomes a post-hoc rewrite of 3 fresh files. TPM ESCALATION: pick this order or accept the rewrite cost — surfaced as §6 Q12.
- **Slice E `s-4` (worktree-isolation helper) MUST land BEFORE the 4 cc-workflows mode-skill stories** (`t-3`, `d-4`, `dr-3`, `r-3`) so those skills can import the shared precondition. Otherwise each skill body has to re-derive the isolation contract.

The earlier "Slice A first" assertion is dropped — there is no graph-level reason for it. Story-authoring readiness is governed by pre-plan blockers (§6 Q1, Q2 below + missing-audit recovery in §5 Risks), not slice order.

**Slice A (`/test` cleanup + bounce-back, 3 stories).** `t-1` folds `simulated-manual` into the swarm pipeline by adding a new step file for scenario-replay between worker (step 3) and inspector (step 4), then removing the `--simulated-manual` exclusive flag from `skills/test/SKILL.md`. **Directory placement RESOLVED: the new step lives under `hive/workflows/steps/test-swarm/step-04b-scenario-replay.md`** (matches the swarm-pipeline convention; `test/` houses only the legacy simulated-manual file that's being retired). `t-2` is the bounce-back — the ABI shape is unresolved (architect recommends new method `markNeedsRework({id, reason})` on `TaskTrackingDispatch`; see §6 Q2). Wiring lands in `hive/workflows/steps/test-swarm/step-06-triage.md` (the executable step contract), NOT the persona file (CONTEXT.md step-vs-persona discipline; grill C2 resolved). Methodology override: **t-2 takes TDD** (adapter contract first, two implementations second) per tpm ESCALATION — rest of the epic stays classic. `t-3` mirrors `test-mode-multica` into `test-mode-cc-workflows`. **Dispatch granularity for `t-3` RESOLVED: per-scenario, mirroring test-mode-multica** (architect ESCALATION — scenarios are the natural episode-marker unit; personas in /test are uniform `test-worker` per scenario; per-persona would force fake splits).

**Slice B (`/design` expansion + substrate, 5 stories) is structurally the heaviest.** `d-1` is the multi-persona pipeline. The research-brief flags this as a STRUCTURAL insert — `/design` today has a single dispatch step at step 3 with no persona-assembly phase to extend (`skills/design/SKILL.md:55-64`). So `d-1` introduces a net-new Phase A that assembles `[accessibility-specialist, animations-specialist, ui-designer]`, runs the two specialists serial to produce constraint notes, then dispatches ui-designer ONCE with constraints baked in. **AC MUST cite `hive/workflows/design-review.workflow.yaml:8-81` as the orchestration template to mirror** — the 4-step assembly+serial-dispatch shape is already proven, and re-inventing creates architectural drift between Slices B and C (architect ESCALATION).

TPM ESCALATION flagged d-1 as carrying two stories' worth of risk (structural Phase A insert + Pattern B posture call + 3-persona handoff payload). Whether to split d-1 into "phase-a-structural-insert" + "persona-pipeline-wiring" is surfaced as §6 Q13. **Pattern B posture call is itself unresolved** — see §6 Q6 (revised below); the always-on 3-persona pipeline departs from the composable-substrate posture (grill P1 + architect ESCALATION).

`d-2` creates `design-dispatch`. `d-3` and `d-4` mirror `execute-mode-multica` and `plan-mode-cc-workflows` into `design-mode-multica` and `design-mode-cc-workflows` respectively. `d-5` handles the wireframe-artifact handoff payload (PNG + `.f0` + constraint notes; final shape pending Q9).

**Slice C (`/design-review` substrate, 3 stories)** is the cleanest substrate-parity slice — `design-review.workflow.yaml` already encodes the 3-persona pipeline; we wrap it in `design-review-dispatch`, `design-review-mode-multica`, and `design-review-mode-cc-workflows`. The collapse question (preserve 4-step model vs single-shot script) is §6 Q11.

**Slice D (`/review` substrate, 3 stories)** is the smallest — solo reviewer, three thin wrappers. TPM ESCALATION flagged whether `r-1` + `r-2` could collapse to a single router-plus-multica story given how thin the wrappers are; surfaced as §6 Q14.

**Slice E (4 stories — UP FROM 3 PER ARCHITECT ESCALATION) is the symmetry pass.**

- `s-1` writes `hive/references/dispatch-parity.md` as a 6×3 matrix.
- `s-2` extracts the 5-tier resolver into `hive/lib/mode-resolver.mjs`. **Helper signature: returns `{decision, sources}`** — preserves the field-source telemetry that execute-dispatch emits today (architect ESCALATION; without `sources`, callers lose provenance for the per-tier resolution).
- `s-3` adds the no-Codex-in-cc-workflows lint as `hive/scripts/lint-cc-workflows-no-codex.mjs`, wired into `npm test`. **Lint scope widened (architect ESCALATION + grill U1):** (i) AST-level check for `agentType:` literal in `*-mode-cc-workflows/` skill files, (ii) grep for `codex:codex-rescue` skill references inside those paths, (iii) grep for `agent_backends` config keys inside those paths. Single grep on `agentType:` is insufficient — indirect routings via skill-invoke or config keys must also fail the lint.
- **`s-4` worktree-isolation precondition (NEW per architect ESCALATION + grill H1/C1).** Shared helper at `hive/lib/cc-workflows-preconditions.mjs` asserting that `*-mode-cc-workflows` runs are on an isolated worktree (not the main checkout). Lint sub-step asserts every `*-mode-cc-workflows/SKILL.md` imports the helper at Step 0. Reasoning: DRY (single invariant, single maintenance site); dispatch-time vs body-time (check belongs in the precondition contract, not duplicated per skill); aligns with `feedback_codex_parallel_race` worktree-isolation discipline.

Reusable utilities I'd lean on: `TaskTrackingDispatch.invoke` for `t-2` once ABI aligns; `loadScenario` (`hive/lib/scenarios/load.mjs`) for `t-1` scenario-replay (pending the verification step in §5 Risks); `design-review.workflow.yaml:8-81` as the 3-persona orchestration template for Slice B `d-1`; `__resetHandleCache` for adapter tests.

## 4. What Could Go Wrong

**High severity:**

- **`updateStatus` ABI is inconsistent across adapters.** GitHub exposes `updateStatus({id, state})` taking only `open|closed`; Multica exposes `updateStory({id, status})` with a 5-value enum (`todo|in_progress|in_review|done|cancelled`). Different method names, different param keys, different value spaces. The outline's `t-2` story assumes alignment that does not exist on disk. *Evidence:* `hive/adapters/github/index.ts:291-309` vs `hive/adapters/multica/index.ts:20-26, 335-348`. **Architect recommends option (c): new method `markNeedsRework({id, reason})` on TaskTrackingDispatch ABI** (Multica → `updateStory({status:'in_review'}) + label`; GitHub → reopen + label `hive:needs-rework`). Reasoning: `needs-rework` is a domain verb, not a state; conflating with `updateStatus` forces virtual-state mapping that leaks adapter capability differences upward (violates `capability('supported_states')` contract). Decision deferred to user gate — see §6 Q2.
- **`cc-workflows-smoke-1780516800.yaml` audit referenced in outline line 115 does not exist on disk.** Only the plan-mode-validation audit is present. *Evidence:* `ls .pHive/audits/post-run/`. Constraint 5 (gate-ownership invariant) loses one of its two cited sources. **TPM ESCALATION:** recover/rewrite spike (~0.5 day, owned by tpm or test-architect) BEFORE Phase B story-writing. Either locate the audit, re-run the smoke and produce a fresh one, or explicitly accept the single-citation risk. Added to §5 Risks blocker list.

**Medium severity:**

- **`/design` Phase A persona-assembly block does NOT exist yet.** Slice B `d-1` is a STRUCTURAL insertion (net-new Phase A precedes existing step 3), not a modification of an existing block. The outline's table cell understates the scope. *Evidence:* `skills/design/SKILL.md:55-64`.
- **`design-review-mode-cc-workflows` semantic question.** The existing `design-review.workflow.yaml` has 4 steps with per-step `step_file` references. Translating that into a single-shot Workflow tool script either preserves the 4-step model (4 `agent()` calls) or collapses it. Substrate parity matters here. See §6 Q11.
- **`test-sentinel` persona vs step file conflation.** Outline cites "test-sentinel.md triage step 6" as the emit point, but the persona `.md` has no executable triage step; the contract lives in `hive/workflows/steps/test-swarm/step-06-triage.md`. Story AC for `t-2` MUST point at the step file, not the persona (grill C2 resolved).
- **`/design` Pattern B locks in always-on 3-persona pipeline (posture mismatch).** Grill P1 + architect ESCALATION: Pattern B as drafted is director-chair (runs accessibility + animations for every /design call regardless of need), not composable substrate. Alternatives — Pattern B + operator-toggle (e.g., `--include-constraints accessibility,animations`), or Pattern C (constraint-as-review-pass) — are more substrate-aligned. Decision deferred to user gate — see §6 Q6.

**Low severity:**

- **`design-mode-multica` per-persona issue creation surface** — three personas could mean three Multica issues per design call or one. (§6 Q10.)
- **`--simulated-manual` hard-rip breaks `cross-cutting-concerns.yaml:99-126`.** That file's implementation_checklist references the flag we're removing. Bookkeeping cleanup, not a blocker.

## 5. Dependencies and Constraints

From the research-brief Section 4 (constraints), all carried forward as binding:

1. **`updateStatus` ABI inconsistency** (see §4 high-severity #1). *Source:* `hive/adapters/multica/index.ts:335` vs `hive/adapters/github/index.ts:291`. Blocks `t-2` story authoring.
2. **GitHub adapter only supports `state=open|closed`.** *Source:* `hive/adapters/github/index.ts:296-302`. `needs-rework` on GitHub becomes label-only or reopen-and-label — pure state-flip is impossible.
3. **Multica `supported_states` are `todo|in_progress|in_review|done|cancelled`.** *Source:* `hive/adapters/multica/index.ts:20-26`. `needs-rework` needs (a) new server-side state, (b) re-mapping, or (c) virtual-state in adapter.
4. **cc-workflows substrate runs INLINE Claude — no Codex routing (direct or indirect).** *Source:* `plan-mode-cc-workflows/SKILL.md:144` + plan-mode-validation audit. All 4 new `*-mode-cc-workflows` skills mirror this; Slice E `s-3` (widened scope per §3) enforces.
5. **Gate ownership invariant** — mode skills produce artifacts but never advance review/sign-off gates. *Source:* outline line 20, `plan-mode-cc-workflows/SKILL.md:26+80`. Single-citation accepted; recovery rationale at `audit-recovery-decision.md`. Runtime substitute: Slice A `t-3` manual smoke carries the gate-ownership assertion as its first verification point; all four `*-mode-cc-workflows` manual smokes reinforce it.
6. **`/test` pipeline has TWO step dirs** — RESOLVED in §3: new step lives under `hive/workflows/steps/test-swarm/` (swarm pipeline convention). Grill U2 closed.
7. **cc-workflows substrate runs MUST always isolate to a dedicated worktree** (NEW per architect ESCALATION + grill H1/C1). Enforced via Slice E `s-4` shared helper + lint. *Source:* `feedback_codex_parallel_race` worktree-isolation discipline; planner-supplied mid-Phase-A directive.

**Risk-and-blocker sequencing (per tpm ESCALATION).** Story-writing is gated by:

- **Pre-plan blockers (must resolve at design-discussion gate, BEFORE Phase B story-writing):**
  - §6 Q2 (ABI shape for needs-rework) — blocks `t-2` AC.
  - §6 Q6 (/design Pattern B posture call) — blocks `d-1` AC.
  - Missing audit recovery spike (~0.5 day, see Risk #high #2) — owned by tpm or test-architect.
- **Cross-slice ordering decisions (must resolve before slice scheduling):**
  - §6 Q12 (s-2 ships before B/C/D, or post-hoc rewrite accepted).
  - §6 Q13 (split d-1 into two stories, or accept under-sized risk).
- **Pre-cc-workflows-stories blocker:** Slice E `s-4` (worktree-isolation helper) must land before `t-3`, `d-4`, `dr-3`, `r-3` stories are authored, or those skills will re-derive the isolation contract.

**Parallel-eligibility caveat.** "Slices A/B/C/D run mostly parallel" assumes planning-routing handles concurrent dispatches cleanly — an unverified premise (tpm ESCALATION). **Fallback:** if parallel execution surfaces problems during Phase 0 dispatch, serialize as A → B → C → D, estimated +3-5 days schedule cost (4 slices × ~1 day average serial overhead). Decision belongs at planning gate, not here; recording the fallback so the schedule has a contingency.

**External dependencies:** none beyond Multica adapter (already in tree) and Workflow tool (already exercised by plan + execute mode-cc-workflows skills). No new libraries, no API changes.

**Internal dependencies:** PR #241 must be merged (it is, per project memory 2026-06-05). Branch is off develop.

## 6. Open Questions

Numbered for reference. Q1-Q5 are research-brief carry-forward; Q6-Q11 are outline-surfaced; Q12-Q14 are added by collab-review escalation. Pre-plan blockers marked **[BLOCKER]**.

1. **`step-04b-scenario-replay.md` directory placement** — **RESOLVED in §3: `hive/workflows/steps/test-swarm/`**. Grill U2 closed.
2. **[BLOCKER] `t-2` ABI shape for needs-rework** — pick one before `t-2` story authoring. Options: (a) extend `updateStatus` to accept `needs-rework` (forces virtual-state mapping in GitHub adapter; throws `OPERATION_UNSUPPORTED` today; violates `capability('supported_states')` contract); (b) rename Multica `updateStory→updateStatus` (breaks existing Multica adapter convention for trivial unification); (c) **new method `markNeedsRework({id, reason})` on `TaskTrackingDispatch` ABI** — architect recommendation; clean domain verb; sidesteps GitHub state-mapping; Multica → `updateStory({status:'in_review'}) + label`, GitHub → reopen + label `hive:needs-rework`. Grill V2 (vocabulary) resolves once this lands. [Finding refs: V2, architect ESCALATION.]
3. **`t-3` test-mode-cc-workflows dispatch granularity** — **RESOLVED in §3: per-scenario** (architect ESCALATION). Scenarios are the natural episode-marker unit; per-persona would force fake splits.
4. **[BLOCKER — recovery spike] Missing `cc-workflows-smoke-1780516800.yaml` audit** — was it never written, lives elsewhere, or named differently? Recovery spike (~0.5 day, owned by tpm or test-architect) BEFORE Phase B story-writing per tpm ESCALATION. Action set: (a) locate, (b) re-run smoke + produce fresh audit, or (c) accept single-citation risk for Constraint 5. [Finding refs: H4, tpm ESCALATION.]
5. **`/review` panel mode in router** — should `review-dispatch` also gate on solo-vs-panel mode? If panel deferred, router is trivial; if extended now, Slice D balloons.
6. **[BLOCKER] `/design` persona-composition posture** — outline picks Pattern B (constraint-injection-upfront, structural Phase A always-on). Grill P1 + architect ESCALATION flag posture mismatch with composable-substrate. Alternatives: (a) Pattern B as drafted (always-on; structural cost; locks composition); (b) **Pattern B + operator-toggle** via `--include-constraints accessibility,animations` flag routing through specialist-triggers (composition is operator-directable; default-off keeps simple cases cheap); (c) **Pattern C: constraint-as-review-pass** (no Phase A insert; single `/design` dispatch + post-wireframe constraint review pass; lowest structural cost; latency tradeoff). Pick before `d-1` story authoring. [Finding refs: P1, H2, architect ESCALATION.]
7. **needs-rework canonical Multica state name** — `in_progress`, `backlog`, dedicated `rework`, or `in_review` (per architect recommendation in Q2 option c)?
8. **needs-rework GitHub adapter behaviour** — label-only `hive:needs-rework`, or reopen + label (per architect recommendation in Q2 option c)?
9. **Wireframe-artifact handoff payload** — PNG + `.f0` only, or include constraint doc from accessibility + animations?
10. **`design-mode-multica` issue creation surface** — ui-designer alone, or one issue per persona (three issues per design call)?
11. **DRY vs over-coupling on design-mode-multica + design-review-mode-multica** — shared dispatch surface, or each implements its own? Also covers grill U3: preserve 4-step model with 4 `agent()` calls (substrate parity with workflow.yaml), or collapse to single-shot script (substrate parity with other `*-mode-cc-workflows` skills). Pick before `dr-3` authoring.
12. **Slice E `s-2` sequencing** (tpm ESCALATION) — ship BEFORE Slices B/C/D net-new routers (consumes helper from day 1), or run as Slice E "last" pass (3 routers inline resolver, then `s-2` retrofits and rewrites them)? Pick before slice scheduling.
13. **Slice B `d-1` split** (tpm ESCALATION) — keep as single story carrying structural Phase A insert + Pattern B posture call + 3-persona handoff payload, or split into "phase-a-structural-insert" + "persona-pipeline-wiring"? Decision affects story count (would push epic from 18 to 19).
14. **Slice D `r-1` + `r-2` merge** (tpm ESCALATION) — if `/review` is genuinely solo and the dispatch wrappers are pure parity boilerplate, can `r-1` (router) + `r-2` (multica wrapper) collapse to a single story? Decision affects story count and Slice D scope.

**Pre-plan blockers (must resolve at design-discussion gate before story authoring):** Q2, Q4 (recovery spike), Q6. All three flagged by reviewers.

## 7. Verification Strategy

```
VERIFICATION PLAN:
  Tools: vitest (existing hive test suite), grep+AST-based lint script (s-3), manual smoke run of /test --simulated-manual removal
  Platforms: Node 20+ (workflow runtime), local dev, sandcastle, multica
  Automated:
    - t-1: vitest for scenario-replay step file loading via existing loadScenario (PENDING verification per §5 Risks — see H3)
    - t-2: adapter unit tests for the resolved ABI shape (TDD methodology per tpm — contract test first, two implementations second); test scope determined by Q2 resolution
    - t-3, d-3, d-4, dr-2, dr-3, r-2, r-3: skill resolution tests (Phase 0c resolver returns expected mode_decision; helper returns {decision, sources})
    - s-3: lint script asserts zero matches across THREE surfaces — (i) AST-level agentType: literal in *-mode-cc-workflows/, (ii) grep for codex:codex-rescue skill references, (iii) grep for agent_backends keys inside same paths
    - s-4: lint script asserts every *-mode-cc-workflows/SKILL.md imports hive/lib/cc-workflows-preconditions.mjs at Step 0
  Manual:
    - One smoke run per new mode skill (8 new mode skills × 2 substrates = manual exercise of dispatch routers)
    - Visual confirmation that design-mode pipeline produces accessibility + animations constraint files before wireframe brief (composition shape depends on Q6 resolution)
    - `/test` swarm end-to-end on a known story-issue scenario to confirm bounce-back fires
  Not verifying:
    - Cross-substrate switching mid-run (out of scope; mode resolves once at Phase 0c)
    - Performance — none of these changes are hot-path
    - Hermes-side integration (outline out-of-scope #1)
```

## 8. Scale Assessment

```
SCALE ASSESSMENT:
  Files affected: ~32-37
    - 8 new atomic mode skills (~330-360 lines each)
    - 4 new dispatch router skills (~200-250 lines each)
    - 1 new shared resolver helper (hive/lib/mode-resolver.mjs)
    - 1 new shared cc-workflows preconditions helper (hive/lib/cc-workflows-preconditions.mjs) — added per s-4
    - 1 new dispatch-parity.md reference
    - 1 new lint script (lint-cc-workflows-no-codex.mjs, multi-surface scope)
    - 1 new test step file (test-swarm/step-04b-scenario-replay.md — placement RESOLVED to test-swarm/)
    - Modifications: skills/test/SKILL.md, skills/design/SKILL.md, skills/design-review/SKILL.md, skills/review/SKILL.md, hive/adapters/{github,multica}/index.ts (shape depends on Q2), hive/lib/task-tracking-dispatch/index.ts (new method if Q2 option c), hive/workflows/steps/test-swarm/step-06-triage.md
  Subsystems: dispatch routers, mode-skill family, adapter ABI, test pipeline, design pipeline, review pipeline, cc-workflows precondition framework
  Migration required: no data migration; one breaking flag removal (`--simulated-manual`) — documented in cross-cutting-concerns.yaml
  Cross-team coordination: no — single epic, one branch, classic dev process
  Methodology: classic for 16 of 18 stories; TDD override for t-2 (adapter contract first, two implementations second per tpm ESCALATION)
  Unknowns: 14 open questions (5 research-carried + 6 outline-surfaced + 3 escalation-added); 3 are pre-plan blockers (Q2, Q4, Q6) requiring resolution at design-discussion gate; 3 are ordering/sizing decisions (Q12, Q13, Q14) requiring resolution before slice scheduling

  RECOMMENDATION: Large — H/V swimlanes + structured outline justified
  RATIONALE: Five slices, 18 stories (up from 17 per architect ESCALATION s-4 add), six dispatching skills touched,
             two adapter ABIs modified (shape pending Q2), one structural insertion (`d-1`, shape pending Q6),
             one breaking flag removal (`--simulated-manual`), three pre-plan blockers that materially affect
             story AC, and three escalation-added sizing/ordering questions. The work is parallel-eligible
             (A/B/C/D independent; E reads from all) with a documented serial fallback (+3-5 days) per
             tpm ESCALATION. Slice E has cross-slice dependencies (s-2 before B/C/D routers, s-4 before
             cc-workflows mode-skill stories) that demand explicit sequencing. Recommending Large lets
             H/V express the four parallel lanes + the symmetry pass without flattening the slice structure.
```

---

**Cross-references for downstream:** Phase A2 grill consumed §4 (risks) + §6 (open questions) + the inconsistency-risk signals from research-brief §7 (record at `grill-record.md`). Collab review consumed full draft + grill record (record at `collab-review-record.md`). Structured outline (if approved) consumes §3 (approach) + §5 (constraints) + §8 (scale recommendation) and MUST gate on resolution of pre-plan blockers Q2/Q4/Q6 + sizing/ordering Q12/Q13/Q14.

---

## TEAM REVIEW SUMMARY

**Researcher (approve-with-escalation):** Verified findings, constraints, risks, and file:line citations from the research-brief flow forward with high fidelity — all 6 constraints, 6 inconsistency signals, and the §7 risk register transcribed without silent drops. Two escalations: (a) §3 line 41 prose wrote as if `updateStatus` ABI alignment exists when §4 + brief §1 explicitly state it does not — addressed by rewriting §3 `t-2` description to defer to Q2 and naming option (c) inline; (b) §3 vs §8 internal path contradiction on `test-swarm/step-04b…` vs `test/step-04b…` — addressed by resolving Q1 to `test-swarm/` and updating both §3 and §8 to match. No fabrications detected beyond original brief.

**TPM (approve-with-escalation):** Dependency graph holds at slice level but multiple sequencing gaps surfaced. Five escalations: (a) Slice E `s-2` retrofits into freshly-written B/C/D routers as drafted — added §6 Q12 to force sequencing decision; (b) Slice B `d-1` carries two stories' worth of risk — added §6 Q13 to consider split; (c) Slice D thin wrappers could collapse — added §6 Q14; (d) parallel-eligibility unverified — added explicit serial fallback (+3-5 days) in §5; (e) missing audit (Risk #2) needs 0.5-day recovery spike before Phase B — added to §5 Risks blocker list and §6 Q4. Plus: methodology override for `t-2` to TDD (adapter contract first) noted in §3 + §8; "Slice A first" assertion dropped from §3 per request to either justify or remove.

**Architect (approve-with-escalation):** Architectural soundness confirmed for the 5-tier resolver extraction (s-2) and worktree-isolation placement; four escalations forced revisions. (a) ABI shape for needs-rework — added Q2 option (c) `markNeedsRework({id, reason})` on `TaskTrackingDispatch` ABI as recommended option, documented reasoning inline in §4 high-severity #1 and §6 Q2; (b) `s-2` helper signature must return `{decision, sources}` to preserve field-source telemetry — captured in §3 Slice E s-2 description; (c) `s-3` lint scope insufficient as single grep — widened to AST + skill-invoke grep + agent_backends grep in §3 Slice E s-3 + §7 verification block; (d) `s-4` worktree-isolation as new Slice E story rather than per-skill Step 0 — added to §3 Slice E (raises total to 18 stories), captured in §5 Constraint #7. Additional notes incorporated: Q3 resolved to per-scenario in §3; `d-1` AC cites `design-review.workflow.yaml:8-81` as orchestration template. /design Pattern B revisit (alternatives B+toggle or C) deferred to user gate as Q6 BLOCKER.

Files: [{ path: ".pHive/epics/substrate-coverage-and-test-cleanup/docs/design-discussion.md", change: "modified" }]
revision_summary: Revised draft to address all 12 grill findings and all 12 reviewer escalation flags. Resolved Q1 (test-swarm/ path) and Q3 (per-scenario dispatch) inline per architect direction. Added Slice E s-4 (worktree-isolation helper + lint), raising epic from 17 to 18 stories. Widened s-3 lint scope to AST+grep+config-key across three indirect codex-routing surfaces. Specified s-2 helper signature returns {decision, sources}. Added §6 Q12-Q14 for sequencing/sizing escalations (s-2 ordering, d-1 split, r-1+r-2 merge). Pre-plan blockers Q2 (ABI shape, architect recommends new markNeedsRework method), Q4 (missing audit recovery spike, ~0.5 day), Q6 (/design Pattern B vs B+toggle vs C posture) deferred to user gate per finding/escalation chain. Added parallel-eligibility fallback (+3-5 days serial A→B→C→D). Added TDD methodology override for t-2 (adapter contract first). Slice A "lands first" assertion dropped — replaced with dependency-graph rationale. d-1 AC now explicitly cites design-review.workflow.yaml:8-81 as orchestration template. Vocabulary V1 (slice vs wave) explicitly accepted with paired-epic-continuity justification. Persona-vs-step-file conflation (grill C2) resolved to step file. Added TEAM REVIEW SUMMARY section per /plan Phase B step 5.
open_questions_total: 14
unresolved_for_user_gate: 6
scale_recommendation: Large
