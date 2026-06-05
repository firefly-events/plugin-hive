# Proposal — Substrate Coverage + Test Cleanup (Part 2 epic)

**Status:** OUTLINE — not yet planned. Source material for a future `/plan` run.
**Author:** orchestrator (session 2026-06-05)
**Disposition:** real ship work, follow-on to PR #241 (cc-workflows-first-party).
**Plan-via:** cc-workflows substrate (eat own dogfood once PR #241 merges).

## Goal

Every dispatching slash skill — `/plan`, `/execute`, `/test`, `/design`, `/design-review`, `/review` — has full **Multica + cc-workflows mode coverage**, plus three semantic alignments surfaced this session:

1. `/test` architecture aligned with the multi-role-pipeline + bounce-on-real-bug vision (fold simulated-manual into the swarm; hard-rip the `--simulated-manual` flag; flip story tracker state back to `needs-rework` when triage categorises a failure as `story-issue`).
2. `/design` expanded to a 3-persona pipeline (accessibility-specialist + animations-specialist constraint pass, then ui-designer wireframes ONCE with those constraints baked in — Pattern B / constraint-injection-upfront). The expansion is at the SKILL level above the dispatch layer, so the multi-persona shape runs regardless of mode (default direct, Multica, cc-workflows, future).
3. `/design-review` keeps its original intent — audit of EXISTING project design (not in-flight wireframes). The skill already supports both via `--artifact-target {design|implementation}`; the audit-shipped-product use case is the canonical one. Substrate parity adds Multica + cc-workflows modes without changing semantics.

## Constraints (carried forward from PR #241 substrate validation)

- **No Codex `agentType` in cc-workflows mode skills, ever** (substrate finding `codex-rescue-forwards-not-executes`, fix 8c41671). Every Workflow tool `agent()` call uses the default workflow subagent regardless of `agent_backends[persona]` routing for other dispatch modes. Codex routing lives in the OTHER planning paths (`planning-routing` `codex-invoke` via cmux panes).
- **Defensive args parse contract** in every assembled Workflow script: `const a = typeof args === 'string' ? JSON.parse(args) : args;` (substrate finding `workflow-tool-args-string-vs-object`).
- **Gate ownership invariant:** Mode skills produce/revise artifacts but never advance user-facing review/sign-off gates. /plan owns design-discussion + H/V + structured-outline gates. /design-review owns its verdict gate. Etc.

## Pre-plan answers (from session)

- **Bounce-back ABI shape (Q1):** New state value on existing `updateStatus`, NOT a new method. Working name: `needs-rework`. Both Multica + GitHub adapters implement.
- **/design semantic change (Q2):** Multi-persona, applied at skill level above the dispatch layer so it works across ALL modes (default direct, Multica, cc-workflows, any future). Pattern B (constraint-injection-upfront) preferred; can be challenged at the real /plan design-discussion gate.
- **/review (Q3):** Verified solo (one `reviewer` persona today per `skills/review/SKILL.md`).
- **`--simulated-manual` flag (Q4):** Hard-rip, no backward-compat.

## Slices

Five slices, mostly independent. Slice E reads from all four others and runs last.

### Slice A — `/test` cleanup + bounce-back (3 stories)

| Story | Touch |
|---|---|
| `t-1-fold-simulated-manual-into-swarm` | `skills/test/SKILL.md` — remove `--simulated-manual` exclusive flag handling. New step file `hive/workflows/steps/test/step-04b-scenario-replay.md` inserted between worker (step 3) and inspector (step 4). test-architect (step 2) authors scenario YAMLs alongside scripts. test-mode-multica simulated-manual contract becomes a phase, not a mode. Hard rip — no `--simulated-manual` flag survives. |
| `t-2-bounce-on-real-bug` | `hive/lib/task-tracking-dispatch/index.ts` ABI: `updateStatus` accepts new state value `needs-rework`. Multica adapter implements (resolve to canonical Multica state). GitHub adapter implements (label + state transition). `hive/agents/test-sentinel.md` triage step 6: emit `updateStatus({state: 'needs-rework'})` when triage category equals `story-issue` (NOT `transient` or `human-blocker`). |
| `t-3-test-mode-cc-workflows` | New atomic skill `skills/hive/skills/test-mode-cc-workflows/SKILL.md` mirroring test-mode-multica shape. Workflow tool dispatch, default subagent only (no Codex agentType), defensive args parse contract, episode markers under `${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/cc-workflows-run.yaml`. Test-dispatch resolver (whatever lives in `/test` Phase 0c equivalent) gains a cc-workflows branch. |

### Slice B — `/design` expansion + substrate (5 stories)

| Story | Touch |
|---|---|
| `d-1-design-multi-persona-pipeline` | `skills/design/SKILL.md` — Phase A assembles `[accessibility-specialist, animations-specialist, ui-designer]` (Pattern B). Sequenced: accessibility-specialist + animations-specialist write constraint notes → ui-designer reads both → ui-designer wireframes ONCE with constraints baked in + brief mentions constraints used. Affects ALL dispatch modes (default direct spawn, Multica, cc-workflows). `wireframe-protocol` touchpoints still apply for the ui-designer step. |
| `d-2-design-dispatch-router` | New atomic skill `skills/hive/skills/design-dispatch/SKILL.md` mirroring `execute-dispatch` + `planning-routing` shape. Resolves `HIVE_DESIGN_MODE` env + root `design.mode` config → `mode_decision ∈ {default, multica, cc-workflows}`. /design Phase 0 step ?: invoke design-dispatch with the 3-persona team. |
| `d-3-design-mode-multica` | New atomic skill mirroring plan-mode-multica. Per-persona Multica dispatch (3 personas serial within team). Episode markers per persona. Multica issue creation for ui-designer alone or all 3? — open Q for the real /plan. |
| `d-4-design-mode-cc-workflows` | New atomic skill via Workflow tool, default subagent only. Sibling shape to plan-mode-cc-workflows. Phase 1 per-persona serial dispatch within team. |
| `d-5-wireframe-artifact-handoff` | Per-persona file-list payload includes wireframe PNG paths + Frame0 `.f0` files. Orchestrator-attributed commit on integration branch (PNGs + design index.yaml updated). Constraint notes from accessibility-specialist + animations-specialist land as separate doc files referenced from ui-designer brief. |

### Slice C — `/design-review` substrate (3 stories)

| Story | Touch |
|---|---|
| `dr-1-design-review-dispatch-router` | New atomic skill `skills/hive/skills/design-review-dispatch/SKILL.md`. `HIVE_DESIGN_REVIEW_MODE` env + `design_review.mode` config resolver. `/design-review` Phase 0 wiring. |
| `dr-2-design-review-mode-multica` | New atomic skill. Multi-persona dispatch (accessibility-specialist, animations-specialist, ui-designer per existing design-review.workflow.yaml). Episode markers per persona. |
| `dr-3-design-review-mode-cc-workflows` | New atomic skill via Workflow tool, default subagent only. Sibling shape to plan-mode-cc-workflows + design-mode-cc-workflows. |

### Slice D — `/review` substrate (3 stories)

| Story | Touch |
|---|---|
| `r-1-review-dispatch-router` | New atomic skill `skills/hive/skills/review-dispatch/SKILL.md`. `HIVE_REVIEW_MODE` env + `review.mode` config resolver. `/review` Phase 0 wiring. |
| `r-2-review-mode-multica` | New atomic skill. Solo reviewer dispatch. Episode marker per reviewer persona. |
| `r-3-review-mode-cc-workflows` | New atomic skill via Workflow tool, default subagent only. Solo reviewer. Sibling shape to plan-mode-cc-workflows. |

### Slice E — Symmetry + audit (3 stories)

| Story | Touch |
|---|---|
| `s-1-dispatch-parity-table` | `hive/references/dispatch-parity.md` — canonical matrix of `{plan, execute, test, design, design-review, review} × {default, multica, cc-workflows}` marking ship state per cell, with a row at the bottom for any future substrate. Lives as the "what's wired" reference doc. |
| `s-2-mode-resolver-shared-helper` | Extract the 5-tier resolver (env > root config > shipped baseline > skill override > default) into `hive/lib/mode-resolver.mjs` so the 6 dispatch routers (plan / execute / test / design / design-review / review) don't duplicate resolver prose. Each Phase 0c calls the shared helper. |
| `s-3-cc-workflows-no-codex-lint` | CI/test step that greps cc-workflows mode skills for `agentType:` declarations and fails the test if found. Locks in the substrate finding from PR #241. Tests: `npm test` step, or a dedicated `hive/scripts/lint-cc-workflows-no-codex.mjs`. |

## Dependency graph

```
A1 ──┐
A2 ──┼─── Slice A — independent
A3 ──┘

D1 ──> D2,D3,D4 ──> D5     Slice B — D1 unlocks the substrate stories
DR1 ──> DR2,DR3            Slice C — independent
R1 ──> R2,R3               Slice D — independent

S1 ──── reads from A,B,C,D ; runs last
S2 ──── refactor, independent
S3 ──── lint, independent
```

A / B / C / D are independent → parallel-eligible if substrate proves planning-routing handles concurrent dispatches.

## Open questions (for the real /plan run)

1. **/design Pattern A vs B vs C?** Outline picks B (constraint-injection-upfront). Real /plan can revisit at design-discussion gate.
2. **needs-rework state — Multica state name?** What's the canonical Multica state value the adapter maps to (e.g., `in-progress` vs `backlog` vs a dedicated `rework` state)?
3. **needs-rework state — GitHub adapter behaviour?** Label-only (`hive:needs-rework`) or also reopen the issue / flip closed → open?
4. **design-mode-multica issue creation surface?** Does ui-designer alone create the issue, or do accessibility + animations specialists each get their own issue? (Persona-per-issue is the multica pattern but may over-pollute the workspace for design.)
5. **Wireframe-artifact handoff payload shape?** PNG paths + `.f0` paths only, or also include sketched-design-discussion-with-constraints-baked-in as a doc?
6. **/review multi-reviewer panel?** Today solo per `skills/review/SKILL.md` Key References. Should this epic extend /review to security-reviewer + performance-reviewer + reviewer panel? (Would balloon Slice D to 5+ stories.) Recommend keeping solo for this epic; panel = separate follow-on.
7. **Substrate naming for the resolver:** `HIVE_TEST_MODE` already exists. `HIVE_DESIGN_MODE` and `HIVE_REVIEW_MODE` new. Consistent prefix `HIVE_<SKILL>_MODE` good enough?
8. **Should the design-mode-multica + design-review-mode-multica share the multi-persona dispatch surface, or each implement their own?** (DRY vs over-coupling.)
9. **`/test` step-04b-scenario-replay positioning:** Insert between current step 3 (worker) and step 4 (inspector)? Or after step 4 (inspector) to give scenario-replay coverage analysis to feed off?

## Out of scope

- Hermes-side prompt/policy/Slack-bot edit-message loop (ships on Hermes repo, separate from Hive).
- `/triage`, `/standup`, `/kickoff`, `/metrics-check`, `/polish-audit`, `/visual-qa`, `/find-skills`, `/write-skill`, `/multica-init`, `/sandcastle-gh-init`, `/brand-system`, `/design-system`, `/logo-exploration` — these are not multi-persona-dispatch skills; don't need substrate mode coverage.
- Cross-process `HIVE_RUN_ID` propagation (hermes-guardrails-mvp epic open Q from this session).
- Action-log rotation (hermes-guardrails-mvp epic open Q from this session).

## Substrate findings catalogue (carry-forward reference)

See PR #241 audit files:
- `.pHive/audits/post-run/cc-workflows-smoke-1780516800.yaml` — execute substrate verdict, 4 findings (dispatch-dead-runtime-branch [FIX], workflow-tool-args-string-vs-object [WORKAROUND], tracker-skipped-throwaway [DELIBERATE], workflow-step-shape-deviation [SUBSTRATE-QUESTION]).
- `.pHive/audits/post-run/cc-workflows-first-party-plan-mode-validation-2026-06-05.yaml` — plan substrate verdict, 3 findings (codex-rescue-forwards-not-executes [FIX], branch-cwd-mismatch [CLEARED], args-parse-contract [VALIDATED]).

Both audits live on `feat/cc-workflows-first-party` (PR #241).

## Estimated counts

- 17 stories, 5 slices.
- Slice A: 3 (low + medium + medium)
- Slice B: 5 (medium + medium + medium + medium + low)
- Slice C: 3 (low + medium + medium)
- Slice D: 3 (low + low + low)
- Slice E: 3 (low + low + low)

Methodology: classic. Branch: `feat/substrate-coverage-and-test-cleanup` off develop. Tracker: Multica per current `task_tracking.adapter` (or override per root config at plan time).
