# Research Brief — substrate-coverage-and-test-cleanup

**Epic:** substrate-coverage-and-test-cleanup (Part 2 of cc-workflows-first-party)
**Phase:** A (Research → Brief)
**Source:** `.pHive/epics/substrate-coverage-and-test-cleanup/docs/research-raw.md`
**Outline:** `.pHive/proposals/substrate-coverage-and-test-cleanup-outline.md`
**Author:** technical-writer
**Date:** 2026-06-05

---

## 1. Summary

The epic extends Multica + cc-workflows mode coverage to every dispatching slash skill (`/plan`, `/execute`, `/test`, `/design`, `/design-review`, `/review`) and folds three semantic alignments into the same drop: `/test` bounce-back on real bugs, `/design` 3-persona pipeline (constraint-injection-upfront), `/design-review` substrate parity without semantic change. Investigation confirms all four dispatching slash skills exist today and only `test-mode-multica` exists among the multica `*-mode` atoms; **none** of the new `*-dispatch` routers or `*-mode-cc-workflows` atoms exist on disk yet. The headline blocker is an ABI inconsistency: GitHub adapter exposes `updateStatus({state})` (open/closed only) while Multica adapter exposes `updateStory({status})` (todo/in_progress/in_review/done/cancelled) — the outline's `t-2` story assumes alignment that does not exist.

## 2. Key files & surfaces

### Dispatching slash skills (top-level)

- `skills/test/SKILL.md:1-142` — /test dispatcher; `--simulated-manual` flag handling at lines 14-93; HIVE_TEST_MODE resolver inline at lines 37-51; pipeline table at 109-119.
- `skills/design/SKILL.md:1-156` — /design dispatcher; single `ui-designer` dispatch at step 3 (lines 55-64); touchpoint protocol step 4 (lines 66-71); index.yaml handoff step 6 (87-104). **No Phase 0c mode resolver, no dispatch router today.**
- `skills/design-review/SKILL.md:1-181` — /design-review dispatcher; loads 3 personas (accessibility, animations, ui-designer); `--skip` + `--artifact-target` supported. **No Phase 0c mode resolver, no dispatch router today.**
- `skills/review/SKILL.md:1-115` — /review dispatcher; solo reviewer pattern (lines 39-49); workflow at `hive/workflows/code-review.workflow.yaml`. **No Phase 0c mode resolver, no dispatch router today.**

### Reference shapes (to mirror)

- `skills/hive/skills/plan-mode-cc-workflows/SKILL.md` (336 lines) — canonical mirror target for new `*-mode-cc-workflows` atoms.
- `skills/hive/skills/execute-mode-cc-workflows/SKILL.md` (358 lines) — sibling substrate reference.
- `skills/hive/skills/plan-mode-multica/SKILL.md` (337 lines) — multica plan reference.
- `skills/hive/skills/execute-mode-multica/SKILL.md` (472 lines) — largest reference; pattern source for design-mode-multica + design-review-mode-multica multi-persona dispatch.
- `skills/hive/skills/test-mode-multica/SKILL.md:1-100+` (415 lines) — resolver pattern at lines 36-43 + 89-99; per-persona/scenario dispatch.
- `skills/hive/skills/planning-routing/SKILL.md:1-265` — router reference; Step 0.1 team composition, 0.2 routing decisions, 0.3 spawn.
- `skills/hive/skills/execute-dispatch/SKILL.md:1-219` — router reference; Step 0 field-source-tracking resolver at lines 46-101; **canonical 5-tier (env > root config > shipped baseline > skill override > default) at line 50**.
- `skills/plan/SKILL.md:115-141` — Phase 0c canonical 5-tier resolver shape; reference for adding `HIVE_TEST_MODE` / `HIVE_DESIGN_MODE` / `HIVE_REVIEW_MODE` resolvers.

### Adapter & ABI surfaces (Slice A, t-2)

- `hive/lib/task-tracking-dispatch/index.ts:1-527` — adapter ABI; `updateStatus` method dispatched via `invoke('updateStatus', {id, state})` at lines 205-282; capabilities → `supported_states` at 285-288.
- `hive/adapters/github/index.ts:291-309` — `updateStatus({id, state})`; only `"open"` / `"closed"` supported; throws `OPERATION_UNSUPPORTED` for other states (line 299-302).
- `hive/adapters/multica/index.ts:20-26, 335-348` — `STATUS_VALUES = {todo, in_progress, in_review, done, cancelled}`; method is **`updateStory({id, status})`** (different name from GitHub's `updateStatus`); dispatch handlers at 372-383 expose `capabilities/createStory/updateStory/addComment/getStory` — **no `updateStatus` export**.

### Test pipeline surfaces (Slice A, t-1)

- `hive/agents/test-sentinel.md:1-125` — triage persona; bug filing protocol; routes by severity. No `updateStatus` emit today.
- `hive/workflows/steps/test-swarm/step-06-triage.md:1-129` — actual triage step file; categories at line 16 (transient, story issue, human blocker); summary block at 111-114.
- `hive/workflows/steps/test/simulated-manual.md:1-50` — current simulated-manual executor step (lives under `test/`, NOT `test-swarm/`).
- `hive/workflows/steps/test/` — contains only `simulated-manual.md` (no `step-04b-scenario-replay.md` yet).
- `hive/workflows/test-swarm.workflow.yaml` — 9 steps with `step_file` convention.

### Design pipeline surfaces (Slice B / C)

- `hive/workflows/steps/ui-design/` — 7 existing step files (read-story, discover-tools, plan-screens, create-project, build-wireframe, export, design-brief).
- `hive/workflows/design-review.workflow.yaml:8-81` — 4 steps (accessibility:8, animations:28, ui-designer-critique:55, ui-designer-synthesis:80) with `step_file` references.
- `hive/agents/ui-designer.md` (223 lines), `accessibility-specialist.md` (95 lines), `animations-specialist.md` (85 lines) — all three personas present and ready.
- `hive/references/wireframe-protocol.md:1-50` — Touchpoint 1 (rendition approval via AskUserQuestion) + Touchpoint 2 (brief sign-off); applies to ui-designer step only.

### Cross-cutting + audit

- `.pHive/cross-cutting-concerns.yaml:1-125` — 4 concerns: documentation, versioning, metrics, simulated-manual (lines 99-126 reference `/test --simulated-manual` — affected by t-1 hard-rip).
- `.pHive/audits/post-run/cc-workflows-first-party-plan-mode-validation-2026-06-05.yaml:1-146` — plan substrate verdict; 3 findings (codex-rescue-forwards-not-executes [FIX 8c41671], branch-cwd-mismatch [CLEARED], args-string-vs-object [contract-validated]).

## 3. Patterns & conventions

- **Mode resolver inline at Phase 0c** (`skills/plan/SKILL.md:115-141`) — env-over-config 5-tier selector returns `mode_decision` string; pattern to replicate in `/test`, `/design`, `/design-review`, `/review`.
- **Atomic `*-mode-cc-workflows` skill shape** (`skills/hive/skills/plan-mode-cc-workflows/SKILL.md`) — Step 0 precondition gate with `field_sources`, Step 1 per-persona serial dispatch, Step 2 poll-to-terminal, Step 3 episode marker `cc-workflows-run.yaml`, Step 4 sidecar no-op, Step 5 aggregate return; ~330-360 line target.
- **Atomic `*-dispatch` router shape** (`skills/hive/skills/execute-dispatch/SKILL.md:46-101`) — Step 0 field-source resolution with sane defaults block; canonical 5-tier env > root config > shipped baseline > skill override > default.
- **workflow.yaml steps with step_file references** (`hive/workflows/design-review.workflow.yaml:8-81`) — each step has `agent` + `step_file` path; design-review already runs 3-persona pipeline (accessibility → animations → ui-designer critique → ui-designer synthesis).
- **Defensive args parse contract** (`plan-mode-cc-workflows/SKILL.md:146`) — `const a = typeof args === 'string' ? JSON.parse(args) : args;` mandatory at top of every assembled Workflow script.
- **No Codex `agentType` in cc-workflows mode** (`plan-mode-cc-workflows/SKILL.md:144 + 327`) — every `agent()` uses default workflow subagent; `codex:codex-rescue` forbidden; persona behavior injected via prompt body. Enforceable via grep lint (Slice E s-3).
- **Episode marker file family** (`plan-mode-cc-workflows/SKILL.md:190-219`) — `${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/cc-workflows-run.yaml` + adjacent `.messages.jsonl` sidecar; reused across all cc-workflows mode skills.

## 4. Constraints

1. **`updateStatus` method does not exist on the Multica adapter.** Multica exposes `updateStory` with param `status`; GitHub exposes `updateStatus` with param `state`. *Source:* `hive/adapters/multica/index.ts:335` vs `hive/adapters/github/index.ts:291`. *Impact:* Slice A `t-2` must either rename Multica's `updateStory→updateStatus`, add an `updateStatus` alias, or change `test-sentinel` to use `updateStory` (vendor-skewed). ABI is inconsistent on disk today.
2. **GitHub adapter only supports `state=open|closed`.** *Source:* `hive/adapters/github/index.ts:296-302`. *Impact:* `needs-rework` state on GitHub becomes label-only ABI extension OR reopen-and-label. Pure state-flip is impossible.
3. **Multica `supported_states` are `todo|in_progress|in_review|done|cancelled`.** *Source:* `hive/adapters/multica/index.ts:20-26`. *Impact:* `needs-rework` requires (a) new Multica server-side state value, (b) re-mapping to existing state (e.g., `in_progress` + label), or (c) ABI virtual-state mapping in adapter. Outline open Q2 is real.
4. **cc-workflows substrate runs INLINE Claude — no Codex routing.** *Source:* `plan-mode-cc-workflows/SKILL.md:144` + plan-mode-validation audit lines 62-83. *Impact:* All 4 new `*-mode-cc-workflows` skills must mirror this; Slice E `s-3` lint story enforces.
5. **Gate ownership invariant** — mode skills produce/revise artifacts but never advance review/sign-off gates. *Source:* outline line 20, `plan-mode-cc-workflows/SKILL.md:26 + 80`. *Impact:* All new mode skills inherit; e.g., `design-mode-*` skills cannot advance Touchpoint 1/2 rendition gate.
6. **`/test` pipeline has TWO step dirs**: `hive/workflows/steps/test/` (1 file, simulated-manual) and `hive/workflows/steps/test-swarm/` (9 files, pipeline). *Source:* `ls`. *Impact:* Outline's path `hive/workflows/steps/test/step-04b-scenario-replay.md` is ambiguous — swarm pipeline runs through `test-swarm/`, not `test/`. Path-naming inconsistency must be resolved before story authoring.

## 5. Risks

| Severity | Risk | Evidence |
|---|---|---|
| **high** | `updateStatus` ABI is inconsistent between GitHub (`updateStatus`, param `state`) and Multica (`updateStory`, param `status`) — different method names AND different param keys. | `hive/adapters/github/index.ts:291` vs `hive/adapters/multica/index.ts:335` |
| **high** | `cc-workflows-smoke-1780516800.yaml` audit referenced in outline line 115 **does not exist on disk**. Only the plan-mode-validation file is present. | `ls .pHive/audits/post-run/` |
| **medium** | `/design` Phase A persona-assembly block does NOT exist yet — Slice B `d-1` is a structural insertion (net-new Phase A), not a modification of an existing block. | `skills/design/SKILL.md:55-64` (single ui-designer dispatch at step 3) |
| **medium** | `test-sentinel` persona file has no step-6 marker; the actual triage step entry lives at `hive/workflows/steps/test-swarm/step-06-triage.md`. Outline conflates persona and step file. | `hive/agents/test-sentinel.md:1-125` vs `hive/workflows/steps/test-swarm/step-06-triage.md` |
| **medium** | `/test` has two different step dirs (`test/` for simulated-manual, `test-swarm/` for pipeline); outline's proposed path puts new step in the simulated-manual dir, but the swarm pipeline is what runs steps 0-8. Fold-in semantics need clarification. | `ls hive/workflows/steps/test/ vs test-swarm/` |
| **low** | design-mode-multica per-persona issue creation surface — existing test-mode-multica creates one Multica issue per scenario; design-mode-* extends to 3 personas. Three issues per design call or one? | Outline open Q4 |
| **low** | `--simulated-manual` hard-rip removes a publicly-documented flag and breaks `cross-cutting-concerns.yaml` line 124 implementation_checklist reference. | `skills/test/SKILL.md:16-93` + `.pHive/cross-cutting-concerns.yaml:99-126` |

## 6. Open questions

Carry-forward for design-discussion phase. These map directly to the researcher's `UNANSWERED_QUESTIONS` block.

1. **`step-04b-scenario-replay.md` directory placement** — under `hive/workflows/steps/test/` (matches outline) or `hive/workflows/steps/test-swarm/` (matches pipeline numbering convention)? Outline naming may conflict with `test-swarm.workflow.yaml` step_file paths.
2. **`t-2` ABI shape for needs-rework** — add new method `markNeedsRework({id, reason})` (cleaner contract, sidesteps GitHub state-mapping gymnastics) or stick with outline's `updateStatus({state: 'needs-rework'})`? GitHub currently throws `OPERATION_UNSUPPORTED` for non-open/closed states.
3. **`t-3` test-mode-cc-workflows dispatch granularity** — per-scenario (mirroring test-mode-multica) or per-persona (mirroring plan/execute-mode-cc-workflows)? Outline says "mirroring test-mode-multica shape" which is per-scenario, but cc-workflows mode skills elsewhere are per-persona.
4. **Missing `cc-workflows-smoke-1780516800.yaml` audit** — referenced in outline line 115 but not on disk. Was it never written, lives elsewhere, or named differently?
5. **`/review` panel mode in router** — should `review-dispatch` router also gate on solo-vs-panel mode (outline open Q6)? If panel deferred, router is trivial; if extended now Slice D balloons.

### Additional questions surfaced by outline itself (carry into design-discussion)

- /design Pattern A vs B vs C (outline picks B, constraint-injection-upfront).
- needs-rework canonical Multica state name (`in_progress`, `backlog`, dedicated `rework`?).
- needs-rework GitHub adapter behaviour (label-only `hive:needs-rework`, or reopen + label?).
- Wireframe-artifact handoff payload (PNG + `.f0` only, or include constraint doc?).
- Resolver naming convention — `HIVE_<SKILL>_MODE` prefix.
- DRY vs over-coupling on design-mode-multica + design-review-mode-multica shared dispatch surface.

## 7. Inconsistency-risk signals (feed Phase A2 grill)

The researcher flagged six signals where the outline encodes hidden assumptions or conventions in tension. These must be surfaced to the grill agent.

1. **Vocabulary mismatch** — Multica adapter exposes `updateStory` (param `status`); GitHub adapter exposes `updateStatus` (param `state`); outline writes "updateStatus" assuming GitHub-style. *Where:* `hive/adapters/multica/index.ts:335` vs `hive/adapters/github/index.ts:291` + outline line 38. *Detail:* `t-2` cannot land without ABI unification; outline assumes alignment that does not exist on disk.
2. **Hidden assumption** — outline cites "`hive/agents/test-sentinel.md` triage step 6" as the wire-in point, but the persona `.md` has no executable triage step; the executable contract lives in `hive/workflows/steps/test-swarm/step-06-triage.md`. *Where:* outline line 38 vs `test-swarm/step-06-triage.md`. *Detail:* wiring lands in step file, not persona — clarify in story spec.
3. **Convention violation** — outline path `hive/workflows/steps/test/step-04b-scenario-replay.md` puts step under `test/` (currently houses only `simulated-manual.md`), but all swarm pipeline step files live under `test-swarm/`; folding simulated-manual into swarm pipeline likely requires moving the file to `test-swarm/step-04b-…` or renaming the dir. *Where:* outline line 37 vs `ls` of both step dirs. *Detail:* directory ambiguity must be resolved before story authoring.
4. **Unresolved tension** — outline's `d-1` assumes `/design` Phase A "persona-assembly block" exists to extend; in fact `/design` has a single dispatch step (step 3) with NO assembly phase, so `d-1` is a STRUCTURAL insert (new Phase A) not a modification. *Where:* outline line 45 vs `skills/design/SKILL.md:55-64`. *Detail:* `d-1` scope is larger than the outline's table cell suggests — net-new Phase A precedes existing step 3.
5. **Convention violation** — outline's "/design-review keeps original intent" is correct, but adding `*-mode-multica` and `*-mode-cc-workflows` wraps the entire 3-persona workflow; the existing `design-review.workflow.yaml` has per-step `step_file` references that DO NOT translate trivially to a single-shot Workflow tool script. *Where:* outline lines 56-57 vs `design-review.workflow.yaml` structure. *Detail:* `design-review-mode-cc-workflows` must either preserve the workflow.yaml 4-step model (4 `agent()` calls) OR collapse it; design choice matters for substrate parity.
6. **Missing artifact** — outline cross-references `.pHive/audits/post-run/cc-workflows-smoke-1780516800.yaml` as a constraint source but file is not present on disk; only the plan-mode-validation file exists. *Where:* outline line 115 vs `ls .pHive/audits/post-run/`. *Detail:* either the smoke audit was never written, lives elsewhere, or is referenced by a different name.

## 8. Utilities available

- **`TaskTrackingDispatch.invoke(method, params, {skill_context})`** (`hive/lib/task-tracking-dispatch/index.ts:205-282`) — vendor-neutral entry point for `t-2` bounce-back; new state value passes through `invoke('updateStatus', {state: 'needs-rework'})` without dispatch-layer changes once adapter signatures align.
- **`capability('supported_states')` gate** (`hive/lib/task-tracking-dispatch/index.ts:285-288`) — caller can refuse to dispatch `needs-rework` if adapter capabilities don't advertise it — defensive opt-in.
- **Scenario loader `hive/lib/scenarios/load.mjs`** (`loadScenario`, referenced from `skills/test/SKILL.md:33-34`) — Slice A scenario-replay step reuses this; test-architect just authors `.yaml` and existing loader validates.
- **5-tier resolver pattern in execute-dispatch** (`skills/hive/skills/execute-dispatch/SKILL.md:46-101`) — Slice E `s-2` candidate to extract into `hive/lib/mode-resolver.mjs`.
- **`design-review.workflow.yaml` 3-persona orchestration** — Slice B can copy the 3-persona dispatch shape into a parallel `ui-design.workflow.yaml` (or extend existing); accessibility + animations + ui-designer pipeline pattern already proven for design-review.
- **`__resetHandleCache` + `__resetNoAdapterWarningForTests`** (`hive/lib/task-tracking-dispatch/index.ts:92, 521`) — testing scaffold for Slice A `t-2` + Slice E `s-3` lint tests.
- **`scope_drift` emit helper** (`skills/review/SKILL.md:88-103` references `hive/lib/scope_drift.py`) — `review-mode-*` skills must preserve the scope_drift emit call when wrapping the reviewer dispatch.

## 9. External references

- `skills/hive/skills/execute-mode-multica/SKILL.md` (472 lines) — largest reference shape; pattern source for `design-mode-multica` and `design-review-mode-multica` (multi-persona sub-dispatch). Key takeaway: per-persona dispatch within team; episode markers per persona; serial within team-cell.
- `.pHive/episodes/` directory convention — episode markers for all new mode skills go under `${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/<mode>-run.yaml`; file family already canonical (`multica-run.yaml`, `cc-workflows-run.yaml`).
- `hive/references/dispatch-parity.md` — outline story `s-1` says CREATE this file; verified does not exist yet. Net-new artifact, not a modify.

## 10. Recommendation (synthesis)

The epic is shippable as outlined but **two pre-plan resolutions** would de-risk significantly before /plan Phase A2:

1. **Resolve the ABI mismatch (Constraint 1, Risk #1, Signal #1)** at the design-discussion gate — pick exactly one of: rename Multica `updateStory→updateStatus`, add `updateStatus` alias to Multica, or change `test-sentinel` emit to dispatch-agnostic `invoke()`. The story `t-2` AC cannot be authored against a moving ABI.
2. **Resolve the `test/` vs `test-swarm/` directory ambiguity (Constraint 6, Risk #5, Signal #3)** — the outline's path picks the wrong dir for the swarm pipeline; storyline `t-1` needs a directory decision before file paths land in AC.

The other 4 signals (hidden assumption on test-sentinel step 6, d-1 structural insert vs modification, design-review.workflow.yaml step collapse, missing smoke audit) are surfaceable at A2 without blocking story authoring — but the missing audit (Risk #2) means Constraint 5 (gate-ownership) loses one of its two cited sources; carry forward as a known doc-debt.

---

**Cross-references for downstream:** Phase A2 grill consumes Section 7 (6 signals). Design-discussion consumes Sections 4 (constraints), 5 (risks), 6 (open questions). Structured-outline consumes Sections 2 (key files), 8 (utilities), 9 (external refs).
