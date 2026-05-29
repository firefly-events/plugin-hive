# Design Discussion — cc-workflows-first-party (REVISED)

**Epic id:** `cc-workflows-first-party`
**Base branch:** `develop`
**Branch strategy:** per-epic (`feat/cc-workflows-first-party`)
**Author:** technical-writer
**Status:** REVISED — collaborative review applied; user gate next (Phase B step 5)
**Revision pass:** 2026-05-29 — addresses grill-record (`.pHive/epics/cc-workflows-first-party/docs/grill-record.md`, 13 findings) + researcher / TPM / architect collaborative review

## 0. Prelude — collaborative review state

- **Researcher:** approve-with-escalation; memo presence verified (commit `90098ea`, 5605 bytes); Phase 0 spike pass criterion (d) added (plugin-shipped skill auto-load under CLI-interactive 2.1.157).
- **TPM:** approve-with-escalation; scale = Large + structured outline. Phase 0 carved as own story-set with maintainer gate before Phase 1+; Phase 5 split 5a (audit, parallel to 1-2) / 5b (apply, after Q3); MVP slice collapses Phases 1+2+3; new rule "per-epic disposition overrides `auto`" added; Phase 0 spike must include a Codex-routed creator; cross-epic disposition commits land in this epic's PR under the <150 file cap.
- **Architect:** BYPASSED — no response after 2 nudges from team-lead. Flagged for re-review at Phase B2 H/V gate.
- **Cycle-state escalation:** `.pHive/cycle-state/cc-workflows-first-party.yaml` carries a moderate security:plan-audit pre-exec (raised by TPM, drives C1 / C2 risk additions).

## 1. What Are We Doing?

Re-base plugin-hive's `/execute` substrate on Claude Code `/workflows` (CC 2.1.154 GA — "dynamic workflows… tens to hundreds of agents in the background") as the **first-party** path, and demote the existing Multica-in-Sandcastle substrate to **second-party** retained-but-opt-in. The user's framing is explicit: `execution.runtime` toggles between them; Multica is preserved for three real moats it still earns — (a) heterogeneous-provider co-mingling, (b) headless webhook autopilots, (c) durable cross-session issue queue — and for maintainer personal-usage. **Don't deprecate Multica. Demote it from default to opt-in.**

**Vocabulary disambiguation (grill V1).** Two distinct things share the word "workflow." For the rest of this document and every downstream story:

- **hive-workflow** — a YAML at `hive/workflows/*.workflow.yaml` defining ordered steps with persona / step-file / methodology dependencies (existing hive primitive per CONTEXT.md).
- **CC `/workflows`** — the Claude Code native slash command (GA at 2.1.154) for dynamic background multi-agent fan-out.

Use these terms consistently. Where ambiguity is unavoidable, prefer the longer form.

**Posture realignment (grill P2; surfaced as Open Question Q9).** Adopting CC `/workflows` as first-party makes the substrate **Claude Code itself**. CONTEXT.md's 2.0 north-star ("Composability — substrate that the user directs vs a director-chair workflow that hard-blocks") is the load-bearing posture statement; the user gate must explicitly confirm whether the reframe is "Hive composes ON Claude Code" (compatible with CC-as-substrate) or whether 2.0 composability remains substrate-agnostic (in which case Multica + CC are coequal alternative substrates and `auto` selects between them). The README rewrite (Phase 6) carries whichever the user chooses; the posture statement gets durable placement in CONTEXT.md so downstream story language locks consistently.

"Done" looks like: a new atomic `execute-mode-cc-workflows` skill slots into `mode_decision`; a new `execution.runtime` knob in `hive.config.yaml` drives selection; the README and Quick Start no longer position Multica as THE substrate; and every shipped + in-flight Multica-substrate-deepen / multica-plan-test-cycles story has an explicit disposition (keep-as-second-party / park / supersede), with disposition commits bundled into this epic's PR for a single audit trail.

What "done" does **not** look like: deep first-party build before Phase 0 has spiked `/workflows` against a real hive epic. The motivating doc is the re-scope memo at `.pHive/epics/multica-substrate-deepen/docs/rescope-vs-cc-dynamic-workflows.md` — 6-dim overlap drill, S0.1 (codex-on-Multica) swing factor still open, 4 decision options (A / B / C / D), recommended sequence **D → resolve S0.1 → A or C**. This design implements D as Phase 0 and surfaces the A/B/C choice as Q7.

## 2. What I Found

Per research brief (`.pHive/epics/cc-workflows-first-party/docs/research-brief.md`, 137 lines):

- **Clean extension seam.** `skills/execute/SKILL.md` Process step 6 has five mode branches today (`6a` TeamCreate, `6b` cmux, `6c` sessions, `6d` sandcastle, `6e` multica). Adding `6f` cc-workflows is additive. `skills/hive/skills/execute-dispatch/SKILL.md` `mode_decision` enum is the single extension point. Four atomic execute-mode skills (`multica`, `sandcastle`, `session`, `team-cmux`) give the contract shape: Step 0 precondition gate → execution → episode marker at `${HIVE_STATE_DIR}/episodes/{epic}/{story}/cc-workflows-run.yaml` → summary return. Per memory `feedback_scope_class_changes`, this is a "new skill/atom" scope-class change.
- **Vendor-neutral story dispatch already exists.** `hive/lib/task-tracking-dispatch/index.ts:1-100` is the ABI; no fork needed.
- **Integration-branch contract is the load-bearing convention.** `hive/lib/multica-story-dispatch/index.mjs:192-262` injects per-story shell snippets — fetch/checkout/reset, commit `[{story-id}] <type>(<scope>): <description>`, rebase-and-push with 3-retry — into the Multica issue body. Whether `/workflows` accepts free-form agent prompts (so the same shell snippets can be injected) is **assumed, not verified** (grill H1). Phase 0 answers it.
- **Per-persona provider routing survives substrate change.** `hive.config.yaml` `agent_backends` map per memory `feedback_codex_general_backend`: codex on researcher / developer(s) / technical-writer / architect; claude on reviewer / tester / QA / specialists.
- **Persona dispatchability boundary weakens.** `.pHive/epics/multica-substrate-deepen/docs/persona-dispatchability.md:15-65` classified 22/25 dispatchable / 3 harness-only (orchestrator, team-lead, pair-programmer) under Multica. CC `/workflows` IS the harness — re-cut required (§3 Phase 3).
- **Mode D-a skill bundling premise is unverified for plugin-shipped skills.** CC 2.1.157 changelog says "Plugins in `.claude/skills` directories are now automatically loaded, no marketplace required" — this refers to consumer-side `.claude/skills/` (consumer-installed). **Whether plugin-hive shipped via marketplace auto-loads into a consumer's interactive CLI session under 2.1.157 is NOT verified** (grill V3 + H3). Phase 0 verifies via spike-pass criterion (d).
- **Fresh-merge churn is real.** PR #234 (multica-plan-test-cycles, 11 stories) merged 2026-05-28; routed `/plan` + `/test --simulated-manual` through Multica. Disposition pass non-negotiable. Trust git+disk per memory `feedback_story_status_stale`.
- **README leads with Multica.** `README.md:1-20` positions Multica as THE substrate. Per memory `feedback_check_readme_first`, README is canonical North Star. Rewrite in scope (Phase 6; defended placement in §4 C3-deviation note).

## 3. My Proposed Approach

Implement the rescope memo's recommended sequence: **Phase 0 spike first → resolve S0.1 → then commit to A or C.** Phases below are logical sequencing; Phase C of `/plan` writes stories from this. **TPM-required slice boundaries:** Phase 0 is its own story-set ending in a maintainer gate; Phase 1 stories carry `blockedBy: <phase-0-stories>`; Phases 1+2+3 collapse into one MVP slice; Phase 4 own slice; Phase 5a (audit) runs parallel to Phase 1-2; Phase 5b (apply) sequences after Q3 resolution; Phase 6 README own slice.

**Phase 0 — Bounded `/workflows` capability spike (NON-NEGOTIABLE, OWN STORY-SET, MAINTAINER-GATED).** Per memory `feedback_test_offtheshelf_before_rewriting`. The spike runs one real hive epic (small, ≤5 stories) end-to-end via CC `/workflows`, **with at least one Codex-routed creator persona in the team** (per TPM, addresses grill C1/C2 — without this the spike-pass is hollow). Spike-pass criteria:

- **(a)** integration-branch contract honored — `/workflows` either accepts injected shell-snippet prompts OR is structurally compatible via CC-native worktree primitives that respect a shared-branch single-commit-per-story discipline (grill H1).
- **(b)** heterogeneous-provider co-mingling works OR is acceptably absent — at least one Codex creator + Claude reviewers in the same workflow, no parallel-Codex race (memory `feedback_codex_parallel_race`), Codex-returns-file-list / harness-commits pattern preserved (memory `feedback_codex_sandbox_commit_block`) (grill C1, C2).
- **(c)** completion signal + failure modes are recoverable.
- **(d)** plugin-shipped skill auto-load verified for `plugin-hive` under CLI-interactive 2.1.157 — either auto-load works for marketplace-installed plugins, OR a documented workaround exists (consumer-side mirror to `.claude/skills/`, or first-party retains Mode D-a) (grill H3, V3 — researcher escalation).

Output: `.pHive/epics/cc-workflows-first-party/docs/spike-findings.md` with pass/fail per criterion. **Maintainer gate after Phase 0.** No Phase 1+ build until criteria (a)-(d) have explicit verdicts.

**Phase 1 — Adapter scaffolding (MVP SLICE with Phase 2 + Phase 3, post-Phase-0 gate).** Add `skills/hive/skills/execute-mode-cc-workflows/SKILL.md` mirroring `execute-mode-multica` shape. Extend `mode_decision` enum in `execute-dispatch/SKILL.md`; add `field_sources.execution_mode` entry. Add `execution.runtime: workflows | multica | auto` knob to `hive.config.yaml` + shipped baseline `hive/hive.config.yaml`. Preserve `agent_backends` routing.

**Phase 2 — Integration-branch contract under `/workflows` (MVP SLICE).** Per grill U1, Phase 2 carries a Phase-0-conditional recommendation: lean **(a)** preserve hive convention by injecting equivalent shell-snippet contract into agent prompts — **conditional on Phase 0 confirming `/workflows` honors free-form integration-branch prompts**; otherwise maintainer decision between (b) bend `git_flow.branch_strategy` to per-unit PR OR (c) restructure as CC-native worktree primitives that preserve single-branch / single-commit-per-story discipline. Surfaced as Q2.

**Phase 3 — Persona surface re-classification (MVP SLICE).** Re-cut the 22/3 from `persona-dispatchability.md` under `/workflows`-as-harness. Output `persona-dispatchability-under-cc-workflows.md`. **Clarification (grill P1):** "collapse into workflow-definition syntax" means **elimination** under `/workflows` — orchestrator and team-lead disappear as personas if their coordination work is fully expressed in workflow YAML/spec, NOT relocation to a different intermediation surface. This preserves memory `feedback_no_team_lead_intermediary`. If `/workflows` cannot fully express their coordination, they remain as personas — no team-lead-shaped surface gets reintroduced.

**Phase 4 — Autopilot split + skills distribution (OWN SLICE).** Time-based in-session autopilots → CC native (`/loop`, cron, `/goal`). Headless webhook autopilots → Multica (second-party). The W3.2 `w3-2-autopilots-yaml` story routes to the second-party owner.

Skills distribution carries an **explicit Plan B (grill U2):** first-party path PREFERS CC 2.1.157 auto-load of `.claude/skills/`; if Phase 0 criterion (d) fails (plugin-shipped skills don't auto-load under CLI-interactive), first-party path also uses Mode D-a — collapsing the "no skill export needed" simplification narrative and requiring the README + Quick Start revision (Phase 6) to carry the caveat. The W4.4 CI drift guard remains second-party-only either way.

**Rule (TPM, addresses grill U3 + Q3 delivery safety):** per-epic disposition (Phase 5b) **overrides** `execution.runtime: auto` heuristic. `auto` MUST NOT silently route `/plan` + `/test --simulated-manual` away from Multica until Phase 5b applies disposition for `multica-plan-test-cycles`. Codified as a precedence rule in the `execution.runtime` schema.

**Phase 5a — Disposition AUDIT (READ-ONLY, runs PARALLEL to Phase 1-2).** Per TPM split: 5a classifies each story in `multica-substrate-deepen/` (19 stories) + `multica-plan-test-cycles/` (11 stories) via git + disk cross-check (per memory `feedback_story_status_stale`, YAML `status: pending` lies for shipped work). Output per-story candidate disposition: keep-as-second-party / park / supersede. **No file mutations in 5a.** Read-only audit unblocks design discussion's Q3 + Q7.

**Phase 5b — Disposition APPLY (sequenced AFTER Q3 resolution).** Apply audit verdicts as YAML mutations + project memory updates. Commits bundled into this epic's PR per TPM for single audit trail; watch <150 file cap per memory `feedback_pr_file_count_limit`; stack via base-branch retargeting if scope bloats.

**Phase 6 — README + positioning (OWN SLICE).** Rewrite README hero + Quick Start step 1 per Q9's resolved posture. **Defense of late placement (grill C3 — accepted as written):** memory `feedback_check_readme_first` says "read README before drafting vision/positioning" — we did, the rescope memo IS that vision drill informed by the existing README. The README is an OUTPUT of this design (carries the resolved Q9 posture statement); making it an INPUT-anchor for Phase 1 stories risks language drift if Q1-Q9 resolutions shift the posture. Phase 6 placement protects against that drift.

## 4. What Could Go Wrong

- **HIGH — `/workflows` public spec is one CHANGELOG sentence.** Context7 returns zero further API surface. Every design claim about workflow definition syntax, fan-out semantics, persona-to-step mapping, branch/PR discipline, and integration-branch honoring is unverified against Anthropic docs. **This is the load-bearing risk and the reason Phase 0 is non-negotiable.** Maps to grill H1.
- **HIGH — CC 2.1.157 `.claude/skills/` auto-load is unverified for plugin-shipped skills under CLI-interactive.** SDK auto-load confirmed; CHANGELOG language refers to consumer-side `.claude/skills/`. Plugin-hive ships via marketplace; whether 2.1.157 auto-loads it into a consumer's interactive CLI session is **not verified**. Phase 0 criterion (d) verifies. Plan B in Phase 4 catches failure. Maps to grill V3 / H3 / U2.
- **MEDIUM — Convention conflict: per-unit-PR vs per-epic-PR.** If `/workflows` follows `/batch`'s per-unit pattern and rejects integrationBranch coercion, the choice is bending `git_flow.branch_strategy: per-epic` OR running `/workflows` outside its native model. Open as Q2. Recommendation conditional on Phase 0 (grill U1).
- **MEDIUM — Codex parallel-dispatch race under `/workflows` fan-out.** Memory `feedback_codex_parallel_race` ("Agent(isolation:worktree) does NOT isolate codex-rescue subagents; default to SERIAL Codex dispatch"). `/workflows` advertises "tens to hundreds of agents in the background." If multiple Codex-routed creators land in the same workflow without explicit serialization, race risk. Mitigation: Phase 0 spike includes Codex creator + measures isolation. First-party adapter may need a per-runtime fan-out cap when codex agents are in the team. Cycle-state escalation reference: `.pHive/cycle-state/cc-workflows-first-party.yaml` security:plan-audit moderate. Maps to grill C1.
- **MEDIUM — Codex sandbox commit-block under `/workflows` fan-out.** Memory `feedback_codex_sandbox_commit_block` ("codex:codex-rescue can't write `.git/index.lock`; orchestrator commits manually after Codex returns file list"). Under `/workflows`, "who plays the orchestrator-commits role" is open. First-party adapter may need to interpose a commit step between agent completion and integration-branch push. Phase 0 spike must validate Codex-returns-file-list → harness-commits flow under `/workflows`. Maps to grill C2.
- **MEDIUM — Persona-classification regression.** Re-cutting 22/3 without first-hand evidence risks misclassifying orchestrator or team-lead. Phase 0 spike must surface a worked example before Phase 3 commits. Maps to grill P1.
- **MEDIUM — Fresh-merge churn from PR #234.** Day-old multica-plan-test-cycles merge means `/plan` + `/test --simulated-manual` currently route through Multica. Demoting before disposition risks orphaning a working code path. Phase 5a audit + Q3 guard this; per-epic-disposition-overrides-`auto` rule protects the runtime layer.
- **MEDIUM — Integration-principle rule 5 under parallel writers.** Integration-principle (single shared branch + serial discipline) holds because Multica dispatches 1 agent/role serial. `/workflows` claims parallel — breaks rule 5. First-party adapter needs an explicit non-overlap gate (per-story commit ordering, fast-forward enforcement) OR `/workflows` must support a serial-execution mode. Phase 0 must answer.
- **MEDIUM — Multica webhook-autopilot path is not pilot-tested end-to-end (grill H2).** Pilot-roundtrip-validation PARTIAL PASS revealed a server-side defect in the Mode D-a skill export warm path. The webhook-autopilot survival case shares the same server and has analogous unverified gaps. Mitigation: a second-party webhook-autopilot E2E pilot belongs in Phase 4 scope (GitHub merge → webhook → autopilot fires → skill runs). Surfaces as part of Q5.
- **LOW — Composability narrative posture.** Resolved by explicit Q9 surfacing (§1 + §6). No longer a quiet downgrade.
- **LOW — develop staging push policy.** Per memory `feedback_seek_direct_push_auth`, develop is the staging trunk; epic lands via PR. No deviation.

## 5. Dependencies and Constraints

- **External — CC 2.1.154 (`/workflows`) is GA locally.** Confirmed.
- **External — CC 2.1.157 `.claude/skills/` auto-load behavior for plugin-shipped skills under CLI-interactive.** Unverified; Phase 0 criterion (d).
- **External — `/workflows` API stability.** Undocumented internals may shift.
- **Internal — `task-tracking-dispatch/index.ts` ABI.** Vendor-neutral; reuse.
- **Internal — `mode_decision` precedence chain.** Env > config > default; `field_sources` records source.
- **Internal — `git_flow.branch_strategy: per-epic` + per-story-commit convention.** Memory `feedback_git_flow_per_epic`. First-party adapter must honor or bend (Q2).
- **Internal — `agent_backends` map.** Memory `feedback_codex_general_backend`. Survives.
- **Internal — Per-epic disposition overrides `execution.runtime: auto`.** New precedence rule from TPM revision; protects in-flight Multica routes until 5b applies.
- **Internal — PR file count <150** per memory `feedback_pr_file_count_limit`. Disposition commits + skill scaffold + config + docs + README — watch the cap, stack if needed.
- **In-flight — `multica-substrate-deepen` (19 stories).** Disposition via Phase 5a/5b.
- **In-flight — `multica-plan-test-cycles` (11 stories, PR #234 merged 2026-05-28).** Disposition via Phase 5a/5b; Q3 explicit.

## 6. Open Questions

1. **Phase 0 spike scope.** Pass = criteria (a)-(d) under §3 Phase 0 each have an explicit verdict. Spike runs a 5-story epic with at least one Codex-routed creator. Maintainer override on the pass bar.
2. **PR-flow under `/workflows` — preserve (a) or bend (b)?** **Conditional recommendation (grill U1):** (a) IF Phase 0 confirms `/workflows` honors shell-snippet integration-branch contract injected into agent prompts; ELSE maintainer decision between (b) per-unit PR or (c) CC-native worktree primitives preserving single-branch / single-commit-per-story discipline.
3. **`multica-plan-test-cycles` disposition.** Keep-as-second-party (Multica still routes `/plan` + `/test --simulated-manual` when user opts in), OR supersede (first-party path replaces those routes). Recommendation: keep-as-second-party for first release, revisit after first-party PR-flow + persona surface settle. Per-epic disposition overrides `auto` until resolved.
4. **`execution.runtime` default for first release.** `workflows` (aggressive demotion), `auto` with per-skill heuristic (gradual demotion), or `multica` (publish but don't switch). Recommendation: `auto` with the **explicit precedence rule that per-epic disposition (Q3 for mpt; Phase 5b for msd) overrides the heuristic.** This addresses grill U3 — `auto` cannot silently divert mpt routes from Multica before 5b applies.
5. **Autopilot owner split.** Time-based → CC native (`/loop`/cron/`/goal`); webhook-driven → Multica. Phase 4 scope includes a Multica webhook-autopilot E2E pilot (grill H2). W3.2 disposition depends on the answer.
6. **First-party `/workflows` adapter parity scope.** Minimum viable (story dispatch + integration-branch contract + completion signal) vs full feature match. Recommendation: minimum viable.
7. **Rescope memo Option A vs C.** A (narrow Multica to moats) vs C (pivot — `/workflows` as executor, Multica as durable queue + external-trigger). Recommendation: A for first release; C if Phase 0 reveals `/workflows` integration-branch coercion is too costly.
8. **NEW — `execution.runtime` vs `execution.substrate` key choice (grill V2).** CONTEXT.md already establishes `execution.substrate: sessions-cloud` for the conceptually-adjacent axis. **Are they orthogonal?** Writer's read: `substrate` names the caller-side loop variant (sessions-cloud / sandcastle-container / etc.); `runtime` names the executor seam (workflows / multica / auto). If maintainer confirms orthogonality, both keys exist. If maintainer sees overlap, extend `execution.substrate` with `workflows` / `multica` values rather than adding `execution.runtime`. **Recommendation: orthogonal — keep both.**
9. **NEW — Composability posture realignment (grill P2).** 2.0 north-star is "Composability — substrate that the user directs vs director-chair workflow that hard-blocks" (CONTEXT.md). Adopting CC `/workflows` as first-party substrate is a major posture change. Two reframes possible: (i) "Hive composes ON Claude Code" (CC-as-substrate compatible, Hive is the composition layer on top), (ii) substrate-agnostic Hive with CC + Multica as coequal alternative substrates selected by `auto`. **Recommendation: (i)** — cleaner narrative, matches "first-party CC / second-party Multica" framing; the chosen posture gets durable placement in CONTEXT.md before story language locks in Phase C.

## 7. Verification Strategy

```
VERIFICATION PLAN:
  Tools: Phase 0 spike (manual run of /workflows on real epic with Codex-routed creator),
         bash/git for integration-branch tests, pytest for hive/lib changes, shellcheck for shell-snippet contracts
  Platforms: macOS dev workstation (Darwin 25.3.0 in this worktree), CC 2.1.154+ runtime
  Automated:
    - mode_decision enum extension (unit assertion in execute-dispatch contract)
    - execution.runtime config precedence (env > config > default; per-epic-disposition-overrides-auto rule)
    - episode-marker contract for execute-mode-cc-workflows
    - integration-branch shell-snippet equivalence (diff against multica-story-dispatch snippets)
  Manual:
    - Phase 0 spike criteria (a)-(d) — each gets an explicit pass/fail in spike-findings.md
    - persona-dispatchability re-classification (first-hand evidence required)
    - in-flight epic disposition (Phase 5a audit read-only; 5b apply after Q3)
    - README rewrite review (positioning correctness per resolved Q9)
    - Multica webhook-autopilot E2E pilot (Phase 4; grill H2)
  Not verifying:
    - Multica server-side label-return defect (out of scope; second-party W4.x)
    - W4.4 CI drift guard (second-party-only; not migrated to first-party)
    - cost/latency benchmarks beyond Phase 0 spike snapshot
```

## 8. Scale Assessment

```
SCALE ASSESSMENT:
  Files affected: ~50-90
    - skills/execute/SKILL.md (step 6 extension)
    - skills/hive/skills/execute-dispatch/SKILL.md (enum + field_sources + per-epic-override rule)
    - skills/hive/skills/execute-mode-cc-workflows/SKILL.md (NEW)
    - hive.config.yaml + hive/hive.config.yaml (execution.runtime schema + override rule)
    - README.md (hero + Quick Start rewrite — Phase 6 per resolved Q9)
    - CONTEXT.md (posture statement per resolved Q9; vocab disambiguation per V1)
    - .pHive/epics/cc-workflows-first-party/docs/ (spike-findings, persona-dispatchability-under-cc-workflows, disposition-pass-msd, disposition-pass-mpt)
    - Story YAMLs across two in-flight epics (disposition annotations from Phase 5b)
    - Possibly hive/lib/ adapter scaffold for cc-workflows runtime (size depends on Phase 0)
  Subsystems: executor seam, persona surface, skill distribution, autopilots, config schema,
              README/positioning, CONTEXT.md posture, in-flight epic disposition (2 epics), integration-branch contract
  Migration required: yes — Multica demotion is a substrate migration; per-epic disposition overrides `auto` until 5b
  Cross-team coordination: no (single-maintainer plugin); cross-epic disposition for ~30 stories is in scope
  Unknowns: 9 open questions, 2 HIGH risks both gated on Phase 0 spike
  
  RECOMMENDATION: Needs structured outline (Large)
  RATIONALE: 9 subsystems + 2 HIGH-risk unknowns gated on Phase 0 + cross-stack work (skills + lib + config + docs + tracker integration + cross-epic disposition for 30 stories) + memory `feedback_scope_class_changes` flags substrate-level as full-planning. Phase B2 H/V → Phase B3 structured outline → Phase C stories → maintainer gate at each. Phase 0 spike is first deliverable; can be scoped after structured outline locks the nine Open Questions. Architect bypass at this gate flagged for Phase B2 re-review.
```

## 9. Architect bypass note

The collaborative review gate did not receive architect response after two nudges from team-lead. This design discussion proceeds to user gate without architect sign-off; the bypass is flagged here and in §0 prelude for re-review at Phase B2 (H/V planning) gate. Architect-flagged grill findings V2 + P2 are surfaced as Q8 + Q9 for explicit user resolution rather than writer-decided defaults.

## 10. Accepted deviations from grill / review findings

- **C3 (README rewrite Phase 6 placement)** — accepted as written. Rationale: README is an OUTPUT of this design, not its anchor; the rescope memo + research brief + this design discussion ARE the upstream reading-the-README step memory `feedback_check_readme_first` calls for. Anchoring Phase 1 stories on a pre-resolution README risks language drift if Q1-Q9 resolutions shift the posture. Phase 6 placement is a conscious bet that the design tail-end is the safest moment to lock the canonical North Star to the resolved posture.

All other grill findings (V1, V2, V3, H1, H2, H3, U1, U2, U3, C1, C2, P1, P2) addressed inline in §1-§8 or surfaced as Open Questions (Q8 ← V2; Q9 ← P2). No silent skips.

---

_End of revised draft. Next: user gate (Phase B step 5). Architect re-review flagged for Phase B2._
