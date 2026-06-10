# Collaborative review record — substrate-coverage-and-test-cleanup

**Phase:** B (collab review gate)
**Run ID:** wf_9cddc036-4d2
**Generated:** 2026-06-05T12:18:00Z
**Reviewers:** researcher, tpm, architect
**Inputs reviewed:**
- `.pHive/epics/substrate-coverage-and-test-cleanup/docs/design-discussion.md` (draft)
- `.pHive/epics/substrate-coverage-and-test-cleanup/docs/grill-record.md` (grill-record)
- `.pHive/epics/substrate-coverage-and-test-cleanup/docs/research-brief.md` (cross-reference)

All three reviewers returned `approve-with-escalation`. Writer revision cycle below consumes this record + grill-record + each reviewer's escalation flags to revise the draft.

---

## Researcher review

REVIEW: researcher
VERDICT: approve-with-escalation
COMMENTS:
  - Findings from research-brief §4 (constraints) are accurately carried forward to design-discussion §5 — all 6 constraints transcribed verbatim with file:line citations preserved (`hive/adapters/multica/index.ts:335`, `hive/adapters/github/index.ts:291`, `hive/adapters/github/index.ts:296-302`, `hive/adapters/multica/index.ts:20-26`, `plan-mode-cc-workflows/SKILL.md:144`).
  - Risks from brief §5 carried into §4 cleanly: high-severity ABI mismatch + missing audit, medium-severity test-dir ambiguity, design Phase A structural insert, design-review.workflow.yaml collapse question, and test-sentinel persona/step file conflation all preserved with original evidence citations.
  - Open questions Q1-Q5 in design-discussion §6 map 1:1 to brief §6 unanswered-questions; Q6-Q11 correctly attributed to outline-surfaced additions.
  - Inconsistency-risk signals (brief §7, 6 signals) all flow downstream — verified each appears in grill-record findings (V2, H1-H4, U1-U3, C1-C2, P1).
  - File:line references preserved with high fidelity throughout — spot-checked `skills/plan/SKILL.md:115-141`, `skills/hive/skills/execute-dispatch/SKILL.md:46-101`, `hive/adapters/github/index.ts:291-309`, `hive/adapters/multica/index.ts:20-26, 335-348`, `design-review.workflow.yaml` lines 8-81 — all match brief.
  - Utilities from brief §8 carried into §3 last paragraph (TaskTrackingDispatch.invoke, loadScenario, design-review.workflow.yaml template, __resetHandleCache) — no silent drops.
  - One MINOR fabrication-adjacent claim flagged for escalation: design-discussion §3 line 41 states "extend `updateStatus` to accept `needs-rework`, implement on both adapters" — this paraphrases the outline's assumed alignment but the brief explicitly says this alignment "does not exist on disk" (brief §1, Constraint #1). Draft does acknowledge the mismatch in §4 high-severity #1 but the §3 prose temporarily writes as if the verb is uniform. Grill V2 captures this — note flagged for traceability, not fabrication.
  - One inconsistency between §3 and §8: §3 line 41 implies `test/step-04b-scenario-replay.md` (outline path); §8 line 134 writes `test-swarm/step-04b-scenario-replay.md`. Grill U2 captures this internal contradiction; surfacing here because it affects which path readers cite downstream.
  - Brief §10 Recommendation cites "two pre-plan resolutions" (ABI mismatch + dir ambiguity). Draft §8 correctly identifies these as "2 pre-plan blockers (Q1 dir placement, Q2 ABI shape)" — synthesis preserved.
  - Brief §5 low-severity risk on `--simulated-manual` hard-rip breaking `.pHive/cross-cutting-concerns.yaml:99-126` preserved in draft §4 low-severity (note: draft writes `cross-cutting-concerns.yaml:99-126` — file:line preserved).
  - No FABRICATED claims traceable to outside the brief detected. The draft's only NEW synthesis beyond the brief is the slice-ordering recommendation (Slice A first) and the "one commit per story" git-flow assertion — both consistent with project memory `feedback_git_flow_per_epic`, not fabricated from training data.
  - Brief §2 catalogues `skills/test/SKILL.md:1-142`, `skills/design/SKILL.md:1-156`, `skills/design-review/SKILL.md:1-181`, `skills/review/SKILL.md:1-115` — draft §2 carries the substance ("every dispatcher exists today") without re-citing each file:line. Acceptable summarization, not silent drop.
ESCALATION_FLAGS:
  - §3 line 41 prose ("extend `updateStatus` to accept `needs-rework`, implement on both adapters") writes as if ABI alignment exists when brief §1+§4 explicitly state it does not — recommend rewriting after Q2 resolves to avoid downstream story authoring against false-uniform verb.
  - §3 vs §8 internal path contradiction on `test-swarm/step-04b…` vs `test/step-04b…` — pick one before structured-outline consumes §3.

---

## TPM review

REVIEW: tpm
VERDICT: approve-with-escalation
COMMENTS:
  - Dependency graph holds at the slice level (A/C/D truly independent; B has internal D1→D2-D5 chain; E reads from all). But A→B/C/D is NOT a hard sequence the draft promises ("Slice A lands first"); writer says "mostly parallel" then ranks A as "first" without graph-level reason — pick one. If A genuinely must land first, encode it; if not, drop the assertion to avoid a false serial gate.
  - Slice E s-2 (mode-resolver-shared-helper) is a refactor that REPLACES resolver prose in all 6 dispatch routers, four of which are net-new in Slices B/C/D. As drafted ("runs last, reads from all"), s-2 retrofits into freshly written code that already inlined the resolver, doubling churn. Either pull s-2 earlier (land BEFORE B/C/D so new routers consume the helper from day 1) or accept the post-hoc rewrite cost and call it out. This is a missed cross-slice dependency.
  - 17-story count is plausible but slice sizing is uneven: Slice B has 5 stories where d-1 alone is structural (net-new Phase A in /design) + Pattern B posture call (grill P1) + 3-persona handoff payload. d-1 is two stories' worth of risk. Slice D has 3 thin wrappers that could collapse to 2 (router + multica + cc-workflows is parity boilerplate). Recommend rebalancing: split d-1 into "phase-a-structural-insert" + "persona-pipeline-wiring", consider merging r-1+r-2 if review is truly solo.
  - "Parallel-eligibility if planning-routing handles concurrent dispatches" is an unverified delivery assumption stated as a footnote. This needs a Phase 0 spike or an explicit fallback ("if parallel fails, serialize A→B→C→D, adds N days"). Right now the schedule has no contingency.
  - Two pre-plan blockers (Q1 dir placement, Q2 ABI shape) are correctly flagged but NOT sequenced — both must resolve before t-1 and t-2 story authoring, yet the slice ordering ("Slice A lands first") implies stories are already AC-ready. Grill U2 (§8 contradicts §3 on the path) confirms the doc itself doesn't know. Resolution gate belongs before Phase B story-writing, not during.
  - Grill H1/C1 worktree-isolation precondition is a genuine missed dependency — it's a 4th Slice E story (s-4) OR a per-skill Step-0 contract carried across all 4 cc-workflows mode skills (t-3, d-4, dr-3, r-3). The latter is a cross-cutting AC, not a separate slice — but it must be sequenced before those 4 stories are written or it becomes a rework wave.
  - Classic methodology call is defensible — 8 of 17 stories are substrate-mirror boilerplate (predictable shape from plan-mode-multica + execute-mode-cc-workflows precedents) where TDD/BDD adds ceremony without yield. BUT t-2 (bounce-on-real-bug with ABI inconsistency across adapters) is a TDD-shaped story: adapter contract first, two implementations second. Recommend story-level methodology override on t-2 (TDD), keep classic for the rest.
  - Missing audit `cc-workflows-smoke-1780516800.yaml` (§4 high-sev #2, grill H4) is a delivery risk that's not on the dependency graph. If it was never written, Constraint 5 rests on a single citation and a substrate finding may be undocumented. Recommend a 0.5-day recovery/rewrite spike BEFORE Phase B story-writing, owned by tpm or test-architect.
  - Risk sequencing: writer surfaced 8 risks (2 high, 4 medium, 2 low) but did NOT sequence them against the dependency graph. Q1+Q2+ABI alignment must land at Phase A2/B; H1 worktree gate must land before cc-workflows skills are authored; P1 Pattern B posture call must land before d-1. Recommend a "blockers before story-writing" pre-flight in §6.
ESCALATION_FLAGS:
  - Pre-plan blockers Q1 (test step dir) + Q2 (updateStatus ABI shape) must resolve at design-discussion gate, NOT during story authoring — escalate to architect for ABI decision and to test-architect for swarm-step dir convention.
  - s-2 (mode-resolver helper) sequencing: ship BEFORE Slices B/C/D rather than as a Slice E "last" pass, or accept double-implementation cost — escalate to team-lead for slice-ordering decision.
  - Worktree-isolation precondition for cc-workflows mode skills (grill H1/C1) is an unsequenced cross-cutting dependency — escalate to architect: add s-4 OR make it a Step-0 contract in t-3/d-4/dr-3/r-3 before those stories are written.
  - Parallel-eligibility ("if planning-routing handles concurrent dispatches") is an unverified premise the schedule rides on — escalate to team-lead for a Phase 0 spike or an explicit serial fallback.
  - 17-story count is plausible but d-1 is under-sized (structural insert + posture call) and Slice D is over-sized for thin wrappers — escalate to writer/team-lead for Slice B/D rebalance before story authoring.

---

## Architect review

REVIEW: architect
VERDICT: approve-with-escalation
COMMENTS:
  - Slice E s-2 (5-tier resolver extraction) is architecturally sound — both call sites (plan/SKILL.md:115-141 and execute-dispatch/SKILL.md:46-101) already share the same precedence order (env > root config > shipped baseline > skill override > default). Risk: execute-dispatch's "field-source-tracking" emits a provenance object the helper must return as a second value (resolved decision + per-tier source map) or callers will lose telemetry. Helper signature must be `{decision, sources}`, not just `decision`. Surface in s-2 AC.
  - The updateStatus/updateStory ABI inconsistency (Risk §4 high-sev #1) is the headline architectural decision and the draft correctly identifies it but does NOT lean. Architecturally correct resolution: option (c) from §6 Q2 — introduce a new method `markNeedsRework({id, reason})` on TaskTrackingDispatch ABI, implemented as: Multica → updateStory({status:'in_review'}) + label; GitHub → reopen + label `hive:needs-rework`. Reasoning: (i) `needs-rework` is a domain verb, not a state; conflating it with `updateStatus` forces virtual-state mapping that leaks adapter capability differences upward (violates the `capability('supported_states')` contract at adapters/index.ts:285-288); (ii) renaming Multica updateStory→updateStatus breaks the existing Multica adapter convention for trivial unification; (iii) `invoke('updateStatus',…)` from test-sentinel is dispatch-agnostic but pushes adapter-specific knowledge into the step file. Pre-plan blocker — must be resolved before t-2 story authoring.
  - The "no Codex agentType in cc-workflows mode" lint (s-3) is INSUFFICIENT as drafted. Grep for `agentType:` catches only the direct surface. Indirect routings that would pass the lint but violate the constraint: (i) a cc-workflows skill that calls `Skill('codex:codex-rescue', …)` via skill-invoke, (ii) `agent_backends` config keys that resolve to codex at runtime, (iii) helper imports that themselves spawn codex subagents (transitive). Lint scope must be widened per U1 finding — minimum coverage: AST-level check for `agentType:` literal + grep for `codex:codex-rescue` skill references + grep for `agent_backends` keys inside *-mode-cc-workflows/ paths. Single grep is too narrow.
  - /design Pattern B (constraint-injection-upfront) architecturally couples /design into a fixed 3-persona always-on pipeline. This locks composition at the skill body level rather than the dispatch layer. For trivial UI work (e.g., a single button color tweak), accessibility-specialist + animations-specialist still run serially before ui-designer wireframes — three Workflow agent() calls minimum regardless of need. The posture-mismatch finding P1 is correct: this is director-chair, not composable substrate. Recommended architectural shape: Pattern B as the DEFAULT body BUT with operator-toggle escalation (e.g., `--include-constraints` flag) routing through specialist-triggers, OR Pattern C (constraint-as-review-pass) which keeps /design single-dispatch and adds a post-wireframe review gate. Either is more substrate-aligned than always-on Pattern B.
  - The worktree-isolation precondition (H1/C1) should live as a Slice E story (`s-4`), NOT as a per-skill Step 0 gate. Reasoning: (i) DRY — duplicating the check inside each of 4 *-mode-cc-workflows skills creates 4 places to maintain a single invariant; (ii) the check is dispatch-time, not body-time — by the time a *-mode-cc-workflows skill runs, the dispatcher has already routed and a contaminated tree is already at risk; the check belongs in the dispatch router OR a shared precondition helper that mode skills import; (iii) wiring it through `hive/lib/cc-workflows-preconditions.mjs` mirrors the s-2 mode-resolver extraction pattern and gives s-3 lint a single import to assert presence of. Add as Slice E s-4: shared precondition helper + lint that *-mode-cc-workflows skills import it.
  - Slice B d-1 structural insertion (net-new Phase A in /design) is feasible but the persona-assembly block has no precedent in /design today. Architectural concern: the assembly+serial-dispatch shape exists in design-review.workflow.yaml (per draft §2) — d-1 should EXPLICITLY reuse that orchestration template rather than re-invent it. If d-1 invents a parallel structure, Slice C (design-review parity) and Slice B (design parity) diverge architecturally for no reason. AC should reference design-review.workflow.yaml:8-81 as the shape source.
  - Dispatch granularity Q3 (t-3 per-scenario vs per-persona) has an architectural answer: per-scenario, mirroring test-mode-multica. Reasoning: scenarios are the natural episode-marker unit for /test (one marker per scenario outcome); personas in /test are uniform (test-worker per scenario). Per-persona would force fake persona splits. Resolves Q3 with low risk.
ESCALATION_FLAGS:
  - ABI shape for needs-rework (Q2) is a pre-plan blocker that requires maintainer sign-off before t-2 story authoring — recommend new `markNeedsRework` method on TaskTrackingDispatch ABI, not extending updateStatus.
  - Worktree-isolation belongs as Slice E s-4 (shared helper + lint), not per-skill Step 0 — adds 1 story to Slice E, raising total from 17 to 18.
  - Slice E s-3 lint scope must be widened beyond `agentType:` grep to cover indirect codex routings (skill-invoke, agent_backends, transitive imports) — raises s-3 implementation cost.
  - /design Pattern B should be revisited against composable-substrate posture before d-1 story authoring; recommend Pattern C or Pattern B + operator-toggle.
