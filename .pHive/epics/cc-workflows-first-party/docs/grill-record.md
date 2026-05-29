# Grill Record — cc-workflows-first-party

**Source draft:** `.pHive/epics/cc-workflows-first-party/docs/design-discussion.md` (131 lines)
**CONTEXT.md substrate:** present
**inconsistency_risk_signals:** present (research-brief §7, 8 signals)
**Generated:** 2026-05-29T23:20:00Z

## Summary

- Vocabulary mismatches: 3 findings
- Hidden assumptions: 3 findings
- Unresolved tensions: 3 findings
- Convention violations: 3 findings
- Posture mismatches: 2 findings

13 findings total. Adversarial pass focused on the draft's load-bearing claims about `/workflows` behavior, the new `execution.runtime` key, the Mode D-a + auto-load equivalence claim, and the persona-surface reclassification.

## Vocabulary mismatches

Findings where draft terminology contradicts CONTEXT.md or shifts meaning mid-document.

- **V1** — "workflow" is overloaded with two distinct meanings without disambiguation.
  - Draft location: line 11+ uses `/workflows` (CC native — the GA feature); CONTEXT.md "Workflow" entry establishes hive's existing meaning: "a YAML at `hive/workflows/*.workflow.yaml` defining ordered steps with persona, step file, and methodology dependencies."
  - Reference: `.pHive/CONTEXT.md` Terminology — "Workflow"
  - Question for planner: How does the draft disambiguate hive-workflow (YAML, persona-step-methodology) from CC-`/workflows` (native slash command, dynamic background fan-out) — proposed naming convention for the body of the design + downstream stories?

- **V2** — Draft introduces `execution.runtime` (line 38) as the new config knob, but CONTEXT.md's "Substrate (Messages-API)" entry establishes `execution.substrate: sessions-cloud` as the existing key for the conceptually-adjacent axis.
  - Draft location: line 38 ("Add `execution.runtime: workflows | multica | auto` knob to `hive.config.yaml`")
  - Reference: `.pHive/CONTEXT.md` Terminology — "Substrate (Messages-API)"
  - Question for planner: Why `execution.runtime` instead of extending `execution.substrate`? Are runtime + substrate orthogonal axes (e.g., substrate = caller-side loop variant, runtime = executor seam), or is `execution.runtime` a redundant key for what `execution.substrate` already names?

- **V3** — Draft equates plugin-shipped skill discovery with CC `.claude/skills/` auto-load.
  - Draft location: line 44 ("first-party path relies on CC 2.1.157 `.claude/skills/` auto-load"); §2 line 28 ("CC 2.1.157 auto-loads from `.claude/skills/`")
  - Reference: `.pHive/CONTEXT.md` Key paths — "skills/{name}/SKILL.md — user-invocable skills"; plus CC 2.1.157 changelog line: "Plugins in `.claude/skills` directories are now automatically loaded, no marketplace required" — note this is for `.claude/skills/` (consumer-side install), not plugin-shipped via marketplace
  - Question for planner: Does plugin-hive (shipped via marketplace) get auto-loaded into a consumer's session via the 2.1.157 mechanism, or does that mechanism only apply to consumer-installed `.claude/skills/`? If the latter, Mode D-a's "skip on first-party" simplification (line 44) collapses.

## Hidden assumptions

Claims made without grounding (architectural, behavioral, performance, etc.).

- **H1** — Draft assumes `/workflows` accepts shell-snippet prompts to agents and honors them.
  - Draft location: line 40 ("`execute-mode-cc-workflows` emits the same shell-snippet contract into agent prompts so all units land on one shared epic branch")
  - Why this matters: The integration-branch contract (`multica-story-dispatch/index.mjs:192-262`) injects shell snippets into the Multica issue body — Multica then passes them to the dispatched Claude Code session as part of the prompt. `/workflows` may or may not have an equivalent injection point. If workflow definitions are structured (YAML / spec) rather than free-form prompt, shell-snippet injection isn't a thing.
  - Question for planner: What evidence does the design carry that `/workflows` honors free-form agent prompts vs structured workflow definitions? The Phase 0 spike must answer this before §3 Phase 2's "(a) preserve hive convention" recommendation can be committed to.

- **H2** — Draft assumes Multica's webhook autopilot path is production-ready for headless triggers.
  - Draft location: line 44 ("Headless webhook autopilots → Multica (second-party)"); line 80 (Q5 recommendation echoes)
  - Why this matters: `.pHive/epics/multica-substrate-deepen/docs/pilot-roundtrip-validation.md` PARTIAL PASS revealed a server-side defect in the Mode D-a skill export warm path. The webhook-autopilot path shares the same server. The "Multica handles webhooks" survival case may have analogous unverified gaps.
  - Question for planner: Has the Multica webhook-autopilot path been pilot-tested end-to-end (GitHub merge → webhook → autopilot fires → skill runs)? If not, "headless webhook autopilots → Multica" is a hopeful split, not a confirmed capability.

- **H3** — Draft assumes CC 2.1.157 auto-load applies to plugin-hive skills under CLI-interactive.
  - Draft location: line 44 ("first-party path relies on CC 2.1.157 `.claude/skills/` auto-load"); §4 HIGH risk (line 53) acknowledges it as unverified but §3 still builds on it
  - Why this matters: If auto-load only applies to consumer-side `.claude/skills/` and not to marketplace-installed plugins under interactive mode, the entire "skip Mode D-a on first-party" simplification fails — first-party path needs its own skill-distribution mechanism.
  - Question for planner: What's the fallback if Phase 0 reveals plugin-shipped skills don't auto-load under CLI-interactive 2.1.157? Does the design carry an explicit Path B (e.g., first-party also uses Mode D-a, downgrading the simplification narrative)?

## Unresolved tensions

Competing requirements or constraints the draft acknowledges but does not reconcile.

- **U1** — Q2 recommendation (a) precedes the evidence that (a) is feasible.
  - Draft location: line 40 (Phase 2 recommends (a)); line 54 (§4 MEDIUM risk acknowledges (a) may not work if `/workflows` rejects integration-branch coercion); line 77 (Q2 recommends (a))
  - Tension: The Phase 0 spike is supposed to determine whether (a) is feasible; the design simultaneously recommends (a) before the spike runs.
  - Question for planner: Should Q2's recommendation be deferred to "post-Phase-0-spike" rather than presented as current recommendation? Or is the recommendation conditional ("recommend (a) IF Phase 0 confirms /workflows honors shell-snippet integration-branch contract; else fall back to discussion")?

- **U2** — §3 Phase 4 first-party path drops Mode D-a; no explicit fallback if H3 fails.
  - Draft location: line 44 ("first-party path relies on CC 2.1.157 `.claude/skills/` auto-load")
  - Tension: If Phase 0 reveals plugin-shipped skills don't auto-load, "first-party drops Mode D-a" can't hold. Phase 4 as written has no Plan B.
  - Question for planner: What's the explicit Plan B for skills distribution if Phase 0 disproves the auto-load assumption — first-party also uses Mode D-a (collapsing the simplification), OR first-party requires consumer to manually copy skills to `.claude/skills/` (UX regression), OR Phase 0 failure invalidates the first-party path entirely?

- **U3** — Q4 (`execution.runtime: auto`) and Q7 (Option A) recommendations may conflict with §3 Phase 5's conservative disposition.
  - Draft location: line 79 (Q4 recommends `auto`); line 82 (Q7 recommends Option A); line 46 (Phase 5 implies keep-as-second-party for multica-plan-test-cycles `/plan` + `/test --simulated-manual` routes)
  - Tension: `auto` + Option A together imply aggressive routing TO first-party with Multica narrowed to webhook/codex moats. But Phase 5's "keep-as-second-party" for multica-plan-test-cycles' Multica-routed `/plan` + `/test` is the OPPOSITE — Multica retains a substantial in-session surface. Either Q4/Q7 recommendations are too aggressive for the Phase 5 conservatism, or Phase 5 disposition isn't conservative enough.
  - Question for planner: Reconcile Q4 + Q7 + Phase 5: does `auto` route the multica-plan-test-cycles flows back to first-party (Option A), OR does it preserve them on Multica (Phase 5)? Which wins when `auto` heuristic and explicit per-epic disposition disagree?

## Convention violations

Design choices that contradict project memory feedback memos or established conventions.

- **C1** — Draft does not address parallel Codex dispatch under `/workflows` fan-out.
  - Draft location: line 11 ("tens to hundreds of agents in the background") + line 38 (`agent_backends` preserves codex routing for creators) — but no integration discussion
  - Convention: `feedback_codex_parallel_race` — "Agent(isolation:worktree) does NOT isolate codex-rescue subagents; default to SERIAL Codex dispatch"; CONTEXT.md Conventions echoes "Serial Codex dispatch"
  - Question for planner: How does `/workflows` honor the serial-Codex constraint when it fans out to tens-to-hundreds of agents and a subset of those are Codex-routed creators? Does the design carry an explicit gate (e.g., per-runtime fan-out cap when codex agents are in the team), or does it accept parallel-Codex race risk?

- **C2** — Draft does not address the Codex sandbox commit-block under `/workflows` fan-out.
  - Draft location: line 38 (agent_backends preserves codex routing) + line 40 (integration-branch contract via shell snippets) — but no discussion of who commits
  - Convention: `feedback_codex_sandbox_commit_block` — "codex:codex-rescue can't write .git/index.lock; orchestrator commits manually after Codex returns file list"; CONTEXT.md Conventions echoes "Codex returns file lists; the orchestrator commits"
  - Question for planner: Under `/workflows` orchestration, who plays the orchestrator-commits role when a Codex-routed agent returns a file list? Does `/workflows` natively handle "agent returns artifacts, harness commits," or does the first-party adapter need to interpose a commit step between agent completion and integration-branch push?

- **C3** — Draft defers README rewrite to Phase 6 last, but `feedback_check_readme_first` implies the README anchors strategy work.
  - Draft location: line 48 (Phase 6) + line 58 (§4 LOW risk treating positioning as editable)
  - Convention: `feedback_check_readme_first` — "pHive README has canonical North Star; read it before drafting vision/positioning/strategy"
  - Question for planner: Should the README rewrite move earlier (Phase 1 or 2) so the canonical North Star is updated before story-level commitments lock in language, OR is Phase 6 last appropriate because README is an output of the design rather than an input that anchors it?

## Posture mismatches

Design choices that depart from project posture without explicit justification.

- **P1** — Draft §3 Phase 3 floats "orchestrator and team-lead may collapse into workflow-definition syntax" but does not reconcile with the no-team-lead-intermediary posture.
  - Draft location: line 42 ("orchestrator and team-lead may collapse into workflow-definition syntax; pair-programmer may be reframed")
  - Posture reference: `feedback_no_team_lead_intermediary` (CONTEXT.md Terminology — "Roster" + "feedback_use_roster_agents") — team-lead persona deliberately has no Agent-spawn tools; orchestrator coordinates directly; visibility-vs-trust north-star is self-contained autonomous SDLC phases
  - Question for planner: If `/workflows` reintroduces a team-lead-shaped role inside its workflow-definition syntax, does that regress the explicit no-intermediary posture? Or does the persona "collapse" mean elimination (team-lead disappears entirely under /workflows), not relocation into a different surface?

- **P2** — §4 LOW-risk treatment of "Claude Code becomes the substrate" understates the composability posture conflict.
  - Draft location: line 58 ("Adopting CC `/workflows` as first-party makes the substrate Claude Code itself, not 'composable substrate'. Memory `project_hive_2_0_milestone` framing is 'composable-substrate, user-directed'. Reframe in Phase 6 README rewrite. Low risk because positioning is editable.")
  - Posture reference: CONTEXT.md "Composability — the 2.0 north star. Substrate that the user directs vs a director-chair workflow that hard-blocks."
  - Question for planner: Is the 2.0 composability north-star the load-bearing posture statement for this project (in which case downgrading to "Claude Code itself is the substrate" is a major posture realignment, not a LOW-risk positioning edit), or has the 2.0 north-star been quietly superseded by a "compose ON Claude Code" reframe that should be made explicit and durable in CONTEXT.md before stories lock in the new language?

## Notes

Three meta-observations that don't fit the five categories:

- **Phase 0 spike framing is sound.** The draft correctly treats `/workflows` API opacity as the load-bearing risk and gates all build on a spike. This is exactly what `feedback_test_offtheshelf_before_rewriting` calls for. No grill finding here — flagging for downstream design-discussion revision: keep this framing intact.

- **The draft's Open Questions are well-numbered for the user gate.** Seven questions, each with a recommendation + rationale + room for maintainer override. Downstream collaborative-review can use these verbatim.

- **Disposition pass for in-flight epics is the under-specified phase.** Phase 5 is sketched but lighter than the other phases. Two epics × ~30 stories total, each needing per-story classification. Worth noting that Phase 5 may be larger than Phase 1 in story-count even if smaller in code change. This is a sequencing observation for TPM Phase B2 — not a grill finding.

## Out of scope (this pass)

Grill does NOT propose solutions, score quality, gate work, or prioritize findings. Each finding ends with a question for the planner; the planner's job is to revise the draft (or document accepted deviations) before stories are written.
