# Research raw findings — substrate-coverage-and-test-cleanup

**Phase:** A (Research)
**Persona:** researcher (cc-workflows substrate)
**Run ID:** wf_3e745ff7-962
**Generated:** 2026-06-05T12:00:00Z
**Workflow stats:** 41 tool uses, 153866 subagent tokens, 207s

Raw findings from researcher persona. Downstream technical-writer composes the formatted research-brief from this.

---

FINDINGS:

FILES_EXAMINED:
- .pHive/proposals/substrate-coverage-and-test-cleanup-outline.md:1-129 — source outline; 5 slices, 17 stories, goal/constraints/open questions
- skills/test/SKILL.md:1-142 — /test dispatcher; --simulated-manual flag handling at lines 14-93; HIVE_TEST_MODE resolver inline at lines 37-51; pipeline table at 109-119
- skills/design/SKILL.md:1-156 — /design dispatcher; single ui-designer dispatch at step 3 (lines 55-64); touchpoint protocol step 4 (lines 66-71); index.yaml handoff step 6 (87-104); NO Phase 0c mode resolver, NO dispatch router
- skills/design-review/SKILL.md:1-181 — /design-review dispatcher; loads 3 personas (accessibility, animations, ui-designer) per design-review.workflow.yaml (lines 87-92); --skip flags + --artifact-target supported; NO Phase 0c mode resolver, NO dispatch router
- skills/review/SKILL.md:1-115 — /review dispatcher; solo reviewer pattern (lines 39-49); workflow at hive/workflows/code-review.workflow.yaml; NO Phase 0c mode resolver, NO dispatch router
- skills/hive/skills/plan-mode-cc-workflows/SKILL.md:1-336 (336 lines) — REFERENCE SHAPE for *-mode-cc-workflows atoms
- skills/hive/skills/execute-mode-cc-workflows/SKILL.md (358 lines) — sibling substrate reference
- skills/hive/skills/plan-mode-multica/SKILL.md (337 lines) — multica plan reference
- skills/hive/skills/execute-mode-multica/SKILL.md (472 lines) — multica execute reference
- skills/hive/skills/test-mode-multica/SKILL.md:1-100+ (415 lines) — test-mode-multica reference; resolver pattern at lines 36-43 + 89-99; per-persona/scenario dispatch
- skills/hive/skills/planning-routing/SKILL.md:1-265 — router reference; Step 0.1 team composition, 0.2 routing decisions, 0.3 spawn (lines 30-100+)
- skills/hive/skills/execute-dispatch/SKILL.md:1-219 — router reference; Step 0 field-source-tracking resolver at lines 46-101; canonical 5-tier (env > root config > shipped baseline > skill override > default) at 50
- hive/lib/task-tracking-dispatch/index.ts:1-527 — adapter ABI; updateStatus method dispatched via invoke('updateStatus', {id, state}) at lines 205-282; capabilities → supported_states at 285-288
- hive/adapters/github/index.ts:291-309 — updateStatus({id, state}); only "open"/"closed" supported; throws OPERATION_UNSUPPORTED for other states (line 299-302)
- hive/adapters/multica/index.ts:20-26, 335-348 — STATUS_VALUES = Set([todo, in_progress, in_review, done, cancelled]); updateStory({id, status}) NOT updateStatus (different name); dispatch handlers at 372-383 expose: capabilities/createStory/updateStory/addComment/getStory — no `updateStatus` export
- hive/agents/test-sentinel.md:1-125 — triage persona; bug filing protocol; routes by severity (auto/escalate); no `updateStatus` emit today
- hive/workflows/steps/test-swarm/step-06-triage.md:1-129 — triage step file; categories at line 16 (transient, story issue, human blocker); summary block at 111-114
- hive/workflows/steps/test/simulated-manual.md:1-50 — current simulated-manual executor step file (separate from test-swarm/ steps)
- hive/workflows/steps/test/ — contains only simulated-manual.md (no step-04b-scenario-replay.md)
- hive/workflows/steps/ui-design/ — 7 existing step files (read-story/discover-tools/plan-screens/create-project/build-wireframe/export/design-brief)
- hive/workflows/design-review.workflow.yaml:8-81 — 4 steps (accessibility:8, animations:28, ui-designer-critique:55, ui-designer-synthesis:80) with step_file references
- hive/workflows/test-swarm.workflow.yaml — 9 steps with step_file convention
- skills/plan/SKILL.md:115-141 — Phase 0c canonical 5-tier resolver shape (cc-workflows-or-multica selection); reference for adding HIVE_TEST_MODE/HIVE_DESIGN_MODE/HIVE_REVIEW_MODE resolvers
- hive/agents/ui-designer.md (223 lines), accessibility-specialist.md (95 lines), animations-specialist.md (85 lines) — ALL three personas present and ready
- hive/references/wireframe-protocol.md:1-50 — Touchpoint 1 (rendition approval via AskUserQuestion) + Touchpoint 2 (brief sign-off); applies to ui-designer step only
- .pHive/cross-cutting-concerns.yaml:1-125 — concern IDs: documentation, versioning, metrics, simulated-manual (4 concerns)
- .pHive/audits/post-run/cc-workflows-first-party-plan-mode-validation-2026-06-05.yaml:1-146 — plan substrate verdict; 3 findings (codex-rescue-forwards-not-executes [FIX 8c41671], branch-cwd-mismatch [CLEARED], cc-workflows-smoke-args-string-vs-object [contract-validated])

PATTERNS_OBSERVED:
- Pattern: Mode resolver inline at Phase 0c | File: skills/plan/SKILL.md:115-141 | Detail: env-over-config 5-tier selector returns mode_decision string; pattern to replicate in skills/test/, skills/design/, skills/design-review/, skills/review/
- Pattern: Atomic *-mode-cc-workflows skill shape | File: skills/hive/skills/plan-mode-cc-workflows/SKILL.md | Detail: Step 0 precondition gate with field_sources, Step 1 per-persona serial dispatch, Step 2 poll-to-terminal, Step 3 episode marker `cc-workflows-run.yaml`, Step 4 sidecar no-op, Step 5 aggregate return; ~330-360 line target
- Pattern: Atomic *-dispatch router shape | File: skills/hive/skills/execute-dispatch/SKILL.md:46-101 | Detail: Step 0 field-source resolution with sane defaults block; canonical 5-tier env > root config > shipped baseline > skill override > default
- Pattern: workflow.yaml steps with step_file references | File: hive/workflows/design-review.workflow.yaml:8-81 | Detail: each step has agent + step_file path; design-review already runs 3-persona pipeline (accessibility-specialist → animations-specialist → ui-designer critique → ui-designer synthesis)
- Pattern: Defensive args parse contract | File: skills/hive/skills/plan-mode-cc-workflows/SKILL.md:146 | Detail: `const a = typeof args === 'string' ? JSON.parse(args) : args;` mandatory at top of every assembled Workflow script
- Pattern: NO Codex agentType in cc-workflows mode | File: skills/hive/skills/plan-mode-cc-workflows/SKILL.md:144 + 327 | Detail: every agent() uses default workflow subagent; codex:codex-rescue forbidden — persona behavior injected via prompt body; ENFORCEABLE via grep lint
- Pattern: Episode marker file family | File: skills/hive/skills/plan-mode-cc-workflows/SKILL.md:190-219 | Detail: `${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/cc-workflows-run.yaml` + adjacent `.messages.jsonl` sidecar; reused across all cc-workflows mode skills

CONSTRAINTS:
- Constraint: `updateStatus` method does NOT exist on the multica adapter | Source: hive/adapters/multica/index.ts:335 (updateStory) vs hive/adapters/github/index.ts:291 (updateStatus) | Impact: Slice A story t-2 (bounce-on-real-bug) must ALSO rename multica's updateStory→updateStatus OR add an updateStatus alias OR test-sentinel uses updateStory (vendor-skewed). The dispatch ABI is currently inconsistent between adapters
- Constraint: GitHub adapter only supports state=open|closed | Source: hive/adapters/github/index.ts:296-302 | Impact: t-2 "needs-rework" state on GitHub maps to either a label-only ABI extension OR reopen-and-label. Pure state-flip is impossible.
- Constraint: Multica supported_states are todo|in_progress|in_review|done|cancelled | Source: hive/adapters/multica/index.ts:20-26 | Impact: "needs-rework" requires either (a) a new Multica state value (server-side change), (b) re-mapping to existing state like `in_progress` + label, or (c) ABI virtual state mapping in the adapter. Open question 2 in the outline is real
- Constraint: cc-workflows substrate runs INLINE Claude (no Codex routing) | Source: skills/hive/skills/plan-mode-cc-workflows/SKILL.md:144 + cc-workflows-first-party-plan-mode-validation-2026-06-05.yaml:62-83 | Impact: All 4 new *-mode-cc-workflows skills (test, design, design-review, review) MUST mirror the no-Codex constraint; lint story s-3 enforces this
- Constraint: Gate ownership invariant — mode skills produce/revise artifacts but never advance review/sign-off gates | Source: substrate-coverage outline lines 20, plan-mode-cc-workflows SKILL.md:26 + 80 | Impact: All new mode skills inherit this rule; e.g., design-mode-* skills cannot advance Touchpoint 1/2 rendition gate
- Constraint: /test pipeline currently has a NON-test-swarm step dir `hive/workflows/steps/test/` (1 file) AND a `test-swarm/` step dir (9 files) | Source: ls output | Impact: Slice A story t-1 (insert step-04b-scenario-replay.md) must clarify WHICH dir gets the file; the test-swarm pipeline runs through `hive/workflows/steps/test-swarm/` per test-swarm.workflow.yaml, but the outline names path `hive/workflows/steps/test/step-04b-scenario-replay.md` (test/ not test-swarm/). Path-naming inconsistency to surface

RISKS:
- Severity: high | Risk: updateStatus ABI is inconsistent between GitHub (uses `state`) and Multica (uses `status` via `updateStory` not `updateStatus`) | Evidence: hive/adapters/github/index.ts:291 vs hive/adapters/multica/index.ts:335 — different method names AND different parameter keys
- Severity: high | Risk: cc-workflows-smoke-1780516800.yaml audit file referenced in outline (lines 115) DOES NOT EXIST on disk | Evidence: ls /Users/don/Documents/plugin-hive/.pHive/audits/post-run/ shows only the plan-mode-validation file; smoke audit was either not committed or lives under a different name. Outline cites it as a constraint reference
- Severity: medium | Risk: /design Phase A persona-assembly block does NOT exist yet | Evidence: skills/design/SKILL.md step 3 (lines 55-64) dispatches ONLY ui-designer; Slice B story d-1 is a structural insertion, NOT a modification of an existing block
- Severity: medium | Risk: test-sentinel persona file has NO step 6 marker today | Evidence: hive/agents/test-sentinel.md is the PERSONA file (lines 1-125); the actual step 6 entry point is hive/workflows/steps/test-swarm/step-06-triage.md. Outline's "test-sentinel.md triage step 6" reference conflates persona and step file
- Severity: medium | Risk: /test has TWO different step directories (`test/` for simulated-manual, `test-swarm/` for pipeline) | Evidence: ls; the outline's proposed path `hive/workflows/steps/test/step-04b-scenario-replay.md` puts the new step in the simulated-manual dir, NOT the swarm dir — but the swarm pipeline is what runs steps 0-8. The fold-in semantics need clarification: is scenario-replay part of swarm pipeline or simulated-manual flow?
- Severity: low | Risk: design-mode-multica per-persona issue creation surface | Evidence: outline open Q 4 (line 98); existing test-mode-multica creates one Multica issue per scenario, not per persona. design-mode-* extends to 3 personas — three issues per design call or one?
- Severity: low | Risk: --simulated-manual hard-rip removes a publicly-documented flag | Evidence: skills/test/SKILL.md lines 16-93 + .pHive/cross-cutting-concerns.yaml lines 99-126 simulated-manual concern references /test --simulated-manual; removal breaks the cross-cutting-concern's implementation_checklist line 124

UTILITIES_AVAILABLE:
- Utility: TaskTrackingDispatch.invoke(method, params, {skill_context}) | File: hive/lib/task-tracking-dispatch/index.ts:205-282 | Relevance: vendor-neutral entry point for t-2 bounce-back; new state value passes through invoke('updateStatus', {state: 'needs-rework'}) without dispatch-layer changes once adapter signatures align
- Utility: capability('supported_states') gate | File: hive/lib/task-tracking-dispatch/index.ts:285-288 | Relevance: caller can refuse to dispatch needs-rework if adapter capabilities don't advertise it — defensive opt-in
- Utility: scenario loader `hive/lib/scenarios/load.mjs` (loadScenario) | File: skills/test/SKILL.md:33-34 references it | Relevance: Slice A scenario-replay step reuses this; test-architect just authors `.yaml` and existing loader validates
- Utility: 5-tier resolver pattern in execute-dispatch | File: skills/hive/skills/execute-dispatch/SKILL.md:46-101 | Relevance: Slice E story s-2 candidate to extract into hive/lib/mode-resolver.mjs
- Utility: design-review.workflow.yaml 3-persona orchestration | File: hive/workflows/design-review.workflow.yaml | Relevance: Slice B can copy the 3-persona dispatch shape from design-review.workflow.yaml into a parallel ui-design.workflow.yaml (or extend ui-design.workflow.yaml) — accessibility + animations + ui-designer pipeline pattern already proven for design-review
- Utility: __resetHandleCache + __resetNoAdapterWarningForTests | File: hive/lib/task-tracking-dispatch/index.ts:92, 521 | Relevance: testing scaffold available for Slice A t-2 + Slice E s-3 lint tests
- Utility: scope_drift emit helper | File: skills/review/SKILL.md:88-103 references hive/lib/scope_drift.py | Relevance: review-mode-* skills must preserve the scope_drift emit call when wrapping the reviewer dispatch

EXTERNAL_REFERENCES:
- Source: skills/hive/skills/execute-mode-multica/SKILL.md (472 lines) | Relevance: largest reference shape; pattern source for design-mode-multica and design-review-mode-multica (multi-persona sub-dispatch) | Key takeaway: per-persona dispatch within team; episode markers per persona; serial within team-cell
- Source: .pHive/episodes/ directory convention | Relevance: episode markers for all new mode skills go under ${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/<mode>-run.yaml | Key takeaway: file family already canonical (multica-run.yaml, cc-workflows-run.yaml)
- Source: hive/references/dispatch-parity.md | Relevance: outline story s-1 says CREATE this file; verified does not exist yet | Key takeaway: net-new artifact, not a modify

UNANSWERED_QUESTIONS:
- Where should `hive/workflows/steps/test/step-04b-scenario-replay.md` live — under `steps/test/` (matches outline) or `steps/test-swarm/` (matches pipeline numbering convention)? The outline naming may conflict with the test-swarm.workflow.yaml step_file paths.
- For t-2 needs-rework: does the ABI add a new method `markNeedsRework({id, reason})` (cleaner contract, no GitHub state-mapping gymnastics) or stick with the outline's `updateStatus({state: 'needs-rework'})`? GitHub adapter currently throws OPERATION_UNSUPPORTED for non-open/closed states (hive/adapters/github/index.ts:299)
- Does t-3 test-mode-cc-workflows dispatch per-scenario (mirroring test-mode-multica) or per-persona (mirroring plan/execute-mode-cc-workflows)? Outline says "mirroring test-mode-multica shape" which is per-scenario, but cc-workflows mode skills elsewhere are per-persona
- Where does the cc-workflows-smoke-1780516800.yaml audit referenced in outline line 115 actually live? Only the plan-mode-validation file exists in .pHive/audits/post-run/
- Should review-dispatch router also gate on solo-vs-panel mode (outline open Q 6)? If panel work is deferred, the router is trivial; if extended now Slice D balloons

INCONSISTENCY_RISK_SIGNALS:
- Signal: vocabulary mismatch — Multica adapter exposes `updateStory` (param `status`); GitHub adapter exposes `updateStatus` (param `state`); outline writes "updateStatus" assuming GitHub-style | Where: hive/adapters/multica/index.ts:335 vs hive/adapters/github/index.ts:291 + outline line 38 | Detail: t-2 cannot land without ABI unification; outline assumes alignment that does not exist on disk
- Signal: hidden assumption — outline cites "hive/agents/test-sentinel.md triage step 6" as the wire-in point, but the persona file (.md) has no executable triage step; the executable contract lives in hive/workflows/steps/test-swarm/step-06-triage.md | Where: outline line 38 vs hive/workflows/steps/test-swarm/step-06-triage.md | Detail: wiring lands in step file, not persona — clarify in story spec
- Signal: convention violation — outline path `hive/workflows/steps/test/step-04b-scenario-replay.md` puts step under `test/` (currently houses only simulated-manual.md), but all swarm pipeline step files live under `test-swarm/`; folding simulated-manual into swarm pipeline likely requires moving the file to `test-swarm/step-04b-…` or renaming the dir | Where: outline line 37 vs ls of both step dirs | Detail: directory ambiguity must be resolved before story authoring
- Signal: unresolved tension — outline's d-1 assumes /design Phase A "persona-assembly block" exists to extend; in fact /design has a single dispatch step (step 3) with NO assembly phase, so d-1 is a STRUCTURAL insert (new Phase A) not a modification | Where: outline line 45 vs skills/design/SKILL.md:55-64 | Detail: d-1 scope is larger than the outline's table cell suggests — net-new Phase A precedes existing step 3
- Signal: convention violation — outline's "/design-review keeps original intent" is correct but adding *-mode-multica and *-mode-cc-workflows wraps the entire 3-persona workflow; the existing design-review.workflow.yaml has per-step `step_file` references that DO NOT translate trivially to a single-shot Workflow tool script | Where: outline lines 56-57 vs hive/workflows/design-review.workflow.yaml structure | Detail: design-review-mode-cc-workflows must either preserve the workflow.yaml 4-step model (4 agent() calls) OR collapse it; design choice matters for substrate parity
- Signal: missing artifact — outline cross-references `.pHive/audits/post-run/cc-workflows-smoke-1780516800.yaml` as a constraint source but file is not present on disk; only the plan-mode-validation file exists | Where: outline lines 115 vs ls .pHive/audits/post-run/ | Detail: either the smoke audit was never written, lives elsewhere, or referenced by a different name

VALIDATION NOTE:
  Checked: no third-party libraries — internal Hive substrate only (Workflow tool, Multica adapter, GitHub adapter, episode markers, step files)
  Source: codebase-only
  Confidence: high
  Findings: all 4 dispatching slash skills exist; none of the new *-dispatch routers exist yet; none of the new *-mode-cc-workflows atoms exist; only test-mode-multica exists among the multica *-mode atoms; the ABI unification (updateStory vs updateStatus, status vs state) is a real cross-cutting blocker for t-2; the cc-workflows reference shape (plan-mode-cc-workflows, 336 lines) is the canonical mirror target; supporting personas (accessibility-specialist, animations-specialist, ui-designer) all present; cc-workflows-smoke audit referenced in outline does not exist on disk
