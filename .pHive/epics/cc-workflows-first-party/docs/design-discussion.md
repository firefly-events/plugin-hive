# Design Discussion — cc-workflows-first-party (REVISED v2)

**Epic id:** `cc-workflows-first-party`
**Base branch:** `develop`
**Branch strategy:** per-epic (`feat/cc-workflows-first-party`)
**Author:** technical-writer
**Status:** REVISED v2 — architect re-review + Q5 descope + maintainer gate 1 cleared; Phase B2 H/V planning next
**Revision history:** DRAFT 2026-05-29 → REVISED 2026-05-29 (grill + collaborative review v1) → REVISED v2 2026-05-31 (architect-v2 + maintainer gate 1)

## 0. Prelude — review + gate state

- **Researcher:** approve-with-escalation (v1). Memo presence verified (commit `90098ea`, 5605 bytes); Phase 0 spike pass criterion (d) added (plugin-shipped skill auto-load under CLI-interactive 2.1.157).
- **TPM:** approve-with-escalation (v1). Scale = Large + structured outline. Phase 0 carved as own story-set with maintainer gate before Phase 1+; Phase 5 split 5a (audit, parallel to 1-2) / 5b (apply, after Q3); MVP slice collapses Phases 1+2+3; rule "per-epic disposition overrides `auto`" added; Phase 0 spike must include a Codex-routed creator; cross-epic disposition commits land in this epic's PR under the <150 file cap.
- **Architect-v2:** delivered (was bypassed in v1, returned at v2). Confirmed Q1 mirror-shape adapter seam; tightened Q2 precedence chain (execute-dispatch reads per-epic disposition + records `field_sources.execution_runtime.epic_override`); **unified Q3+Q4 grill C1/C2 into a single serial-commit-gate mechanism** at the integration-branch push layer (load-bearing — see §3 Phase 2 + §4 unified risk); cleared Q5 descope (autopilot split removed from this epic entirely); orchestrator-commits role moves into the adapter, not into `/workflows`.
- **Maintainer gate 1:** CLEARED 2026-05-31. Scale: Large confirmed. Q2 conditional (a) confirmed. Q5 DESCOPED. Q1, Q3, Q4, Q6, Q7, Q8, Q9 — maintainer agreed with writer's recommendations; locked as maintainer-confirmed at gate 1.
- **Cycle-state escalations** (`.pHive/cycle-state/cc-workflows-first-party.yaml`):
  - **security:plan-audit** — pre-exec, moderate, raised by tpm + architect; covers phase-1 + phase-2 (drives the unified serial-commit-gate mechanism in §3 Phase 2 + §4 unified risk).
  - **performance:audit** — post-exec, minor, raised by architect; first-release retrospective scope; not gating this epic but documented for downstream tracking.

## 1. What Are We Doing?

Re-base plugin-hive's `/execute` substrate on Claude Code `/workflows` (CC 2.1.154 GA — "dynamic workflows… tens to hundreds of agents in the background") as the **first-party** path, and demote the existing Multica-in-Sandcastle substrate to **second-party** retained-but-opt-in. The user's framing is explicit: `execution.runtime` toggles between them; Multica is preserved for three real moats it still earns — (a) heterogeneous-provider co-mingling, (b) headless webhook autopilots, (c) durable cross-session issue queue — and for maintainer personal-usage. **Don't deprecate Multica. Demote it from default to opt-in.**

**Vocabulary disambiguation (grill V1).** Two distinct things share the word "workflow." For the rest of this document and every downstream story:

- **hive-workflow** — a YAML at `hive/workflows/*.workflow.yaml` defining ordered steps with persona / step-file / methodology dependencies (existing hive primitive per CONTEXT.md).
- **CC `/workflows`** — the Claude Code native slash command (GA at 2.1.154) for dynamic background multi-agent fan-out.

Use these terms consistently. Where ambiguity is unavoidable, prefer the longer form.

**Posture realignment (grill P2; surfaced as Open Question Q9, maintainer-confirmed at gate 1).** Adopting CC `/workflows` as first-party makes the substrate **Claude Code itself**. CONTEXT.md's 2.0 north-star ("Composability — substrate that the user directs vs a director-chair workflow that hard-blocks") is the load-bearing posture statement; maintainer-confirmed reframe is **(i) "Hive composes ON Claude Code"** — CC-as-substrate compatible, Hive is the composition layer on top. The README rewrite (Phase 5, was Phase 6 in v1) carries this; the posture statement gets durable placement in CONTEXT.md so downstream story language locks consistently.

"Done" looks like: a new atomic `execute-mode-cc-workflows` skill slots into `mode_decision`; a new `execution.runtime` knob in `hive.config.yaml` drives selection; the README and Quick Start no longer position Multica as THE substrate; and every shipped + in-flight Multica-substrate-deepen / multica-plan-test-cycles story has an explicit disposition (keep-as-second-party / park / supersede), with disposition commits bundled into this epic's PR for a single audit trail.

What "done" does **not** look like: deep first-party build before Phase 0 has spiked `/workflows` against a real hive epic. The motivating doc is the re-scope memo at `.pHive/epics/multica-substrate-deepen/docs/rescope-vs-cc-dynamic-workflows.md` — 6-dim overlap drill, S0.1 (codex-on-Multica) swing factor still open, 4 decision options (A / B / C / D), recommended sequence **D → resolve S0.1 → A or C**. This design implements D as Phase 0 and surfaces the A/B/C choice as Q7 (maintainer-confirmed at gate 1: A for first release, C if Phase 0 reveals coercion cost).

## 2. What I Found

Per research brief (`.pHive/epics/cc-workflows-first-party/docs/research-brief.md`, 137 lines):

- **Clean extension seam.** `skills/execute/SKILL.md` Process step 6 has five mode branches today (`6a` TeamCreate, `6b` cmux, `6c` sessions, `6d` sandcastle, `6e` multica). Adding `6f` cc-workflows is additive. `skills/hive/skills/execute-dispatch/SKILL.md` `mode_decision` enum is the single extension point. Four atomic execute-mode skills (`multica`, `sandcastle`, `session`, `team-cmux`) give the contract shape: Step 0 precondition gate → execution → episode marker at `${HIVE_STATE_DIR}/episodes/{epic}/{story}/cc-workflows-run.yaml` → summary return. Per memory `feedback_scope_class_changes`, this is a "new skill/atom" scope-class change.
- **Vendor-neutral story dispatch already exists.** `hive/lib/task-tracking-dispatch/index.ts:1-100` is the ABI; no fork needed.
- **Integration-branch contract is the load-bearing convention.** `hive/lib/multica-story-dispatch/index.mjs:192-262` injects per-story shell snippets — fetch/checkout/reset, commit `[{story-id}] <type>(<scope>): <description>`, rebase-and-push with 3-retry — into the Multica issue body. Whether `/workflows` accepts free-form agent prompts (so the same shell snippets can be injected) is **assumed, not verified** (grill H1). Phase 0 answers it. **Architect-v2 update:** if `/workflows` rejects free-form injection, fallback shifts to worktree-per-story isolation (CC-native) + serialized merge to integration branch — the outer adapter seam invariant holds either way (§3 Phase 1).
- **Per-persona provider routing survives substrate change.** `hive.config.yaml` `agent_backends` map per memory `feedback_codex_general_backend`: codex on researcher / developer(s) / technical-writer / architect; claude on reviewer / tester / QA / specialists.
- **Persona dispatchability boundary weakens.** `.pHive/epics/multica-substrate-deepen/docs/persona-dispatchability.md:15-65` classified 22/25 dispatchable / 3 harness-only (orchestrator, team-lead, pair-programmer) under Multica. CC `/workflows` IS the harness — re-cut required (§3 Phase 3).
- **Mode D-a skill bundling premise is unverified for plugin-shipped skills.** CC 2.1.157 changelog says "Plugins in `.claude/skills` directories are now automatically loaded, no marketplace required" — this refers to consumer-side `.claude/skills/` (consumer-installed). **Whether plugin-hive shipped via marketplace auto-loads into a consumer's interactive CLI session under 2.1.157 is NOT verified** (grill V3 + H3). Phase 0 verifies via spike-pass criterion (d).
- **Fresh-merge churn is real.** PR #234 (multica-plan-test-cycles, 11 stories) merged 2026-05-28; routed `/plan` + `/test --simulated-manual` through Multica. Disposition pass non-negotiable. Trust git+disk per memory `feedback_story_status_stale`.
- **README leads with Multica.** `README.md:1-20` positions Multica as THE substrate. Per memory `feedback_check_readme_first`, README is canonical North Star. Rewrite in scope (Phase 5; defended placement in §10 C3-deviation note).

## 3. My Proposed Approach

Implement the rescope memo's recommended sequence: **Phase 0 spike first → resolve S0.1 → then commit to A or C** (A confirmed at gate 1). Phases below are logical sequencing; Phase C of `/plan` writes stories from this. **Phase count: 6 → 5 after Q5 descope** (Phase 4 autopilot-split removed; old Phase 5 disposition → Phase 4; old Phase 6 README → Phase 5). **TPM-required slice boundaries:** Phase 0 own story-set ending in a maintainer gate; Phase 1 stories carry `blockedBy: <phase-0-stories>`; Phases 1+2+3 collapse into one MVP slice; Phase 4a (audit) runs parallel to Phase 1-2; Phase 4b (apply) sequences after Q3 resolution; Phase 5 README own slice.

**Phase 0 — Bounded `/workflows` capability spike (NON-NEGOTIABLE, OWN STORY-SET, MAINTAINER-GATED).** Per memory `feedback_test_offtheshelf_before_rewriting`. The spike runs one real hive epic (small, ≤5 stories) end-to-end via CC `/workflows`, **with at least one Codex-routed creator persona in the team** (per TPM + architect-v2, addresses unified C1/C2 — without this the spike-pass is hollow). Spike-pass criteria:

- **(a)** integration-branch contract honored — `/workflows` either accepts injected shell-snippet prompts OR is structurally compatible via CC-native worktree primitives that respect a shared-branch single-commit-per-story discipline (grill H1).
- **(b)** (architect-v2 tightened) **Codex creators return file lists AND the adapter commits serially against integration branch.** Heterogeneous-provider co-mingling works OR is acceptably absent — at least one Codex creator + Claude reviewers in the same workflow; no agent writes to `.git` directly under `/workflows` fan-out; harness serializes the commit step (memory `feedback_codex_sandbox_commit_block` + `feedback_codex_parallel_race`). UNIFIED with (a) under the serial-commit-gate mechanism (see Phase 2).
- **(c)** completion signal + failure modes are recoverable.
- **(d)** plugin-shipped skill auto-load verified for `plugin-hive` under CLI-interactive 2.1.157 — either auto-load works for marketplace-installed plugins, OR a documented workaround exists (consumer-side mirror to `.claude/skills/`, or first-party retains Mode D-a) (grill H3, V3 — researcher escalation).

Output: `.pHive/epics/cc-workflows-first-party/docs/spike-findings.md` with pass/fail per criterion. **Maintainer gate after Phase 0.** No Phase 1+ build until criteria (a)-(d) have explicit verdicts.

**Phase 1 — Adapter scaffolding (MVP SLICE with Phase 2 + Phase 3, post-Phase-0 gate).** Add `skills/hive/skills/execute-mode-cc-workflows/SKILL.md` mirroring `execute-mode-multica` shape (architect-v2 approved mirror). Extend `mode_decision` enum in `execute-dispatch/SKILL.md`; add `field_sources.execution_mode` entry. Add `execution.runtime: workflows | multica | auto` knob to `hive.config.yaml` + shipped baseline `hive/hive.config.yaml`. Preserve `agent_backends` routing.

- **`workflow_assembly` substep (architect-v2).** Inside `execute-mode-cc-workflows/SKILL.md` body, a `workflow_assembly` substep encapsulates the internal logic: prompt construction, persona-to-step mapping, `/workflows` invocation, completion-signal wiring. This is the outer-seam invariant — Phase 0(a) verdict gates *internal logic*, NOT the seam. If `/workflows` rejects free-form prompt injection, Phase 2 fallback (b/c) changes only what `workflow_assembly` emits, not how `execute-dispatch` calls into `execute-mode-cc-workflows`.
- **`execute-dispatch` reads per-epic disposition BEFORE emitting `mode_decision`** (architect-v2 Q2 tightening). Records `field_sources.execution_runtime.epic_override: <path>` for traceability so any future audit can trace which routing decision was sourced from which per-epic disposition file. This is the mechanism that gives the "per-epic disposition overrides `auto`" rule (§3 below) its enforcement point.

**Phase 2 — Serial-commit gate mechanism (MVP SLICE; ARCHITECT-V2 UNIFIED MOVE).** First-party adapter requires `/workflows` agents to return **file lists**, not direct `.git` writes. Harness applies them **serially** against the integration branch (single committer, fast-forward enforced, rebase-and-push 3-retry — mirroring `multica-story-dispatch:192-262`). This is **the unified design move** that survives:

- grill H1 (integration-branch contract honoring) — the contract is honored by the adapter, not by `/workflows` itself;
- grill U1 (Q2 conditional (a)) — recommendation (a) holds via "shell-snippet injection into agent prompts" IFF Phase 0(a) confirms `/workflows` honors free-form prompts; ELSE fallback is **worktree-per-story isolation (CC-native primitive) + serialized merge** to integration branch — same serial-commit invariant, different agent-side mechanism;
- grill C1 (Codex parallel race) — `/workflows` fan-out is permitted for Codex creators IFF agents return artifacts (no `.git` writes); the harness's serial commit eliminates the race surface entirely (no per-runtime fan-out cap needed; cap was brittle, coupled to team composition);
- grill C2 (Codex sandbox commit-block) — orchestrator-commits role moves into the **adapter**, not into `/workflows`. Cleaner invariant: `/workflows` orchestrates *work*, adapter orchestrates *integration*.

Phase 0(a) + (b) must explicitly test this — Codex creator returns file list, adapter applies serial commit, integration branch advances fast-forward.

**Phase 3 — Persona surface re-classification (MVP SLICE).** Re-cut the 22/3 from `persona-dispatchability.md` under `/workflows`-as-harness. Output `persona-dispatchability-under-cc-workflows.md`. **Clarification (grill P1):** "collapse into workflow-definition syntax" means **elimination** under `/workflows` — orchestrator and team-lead disappear as personas if their coordination work is fully expressed in workflow YAML/spec, NOT relocation to a different intermediation surface. This preserves memory `feedback_no_team_lead_intermediary`. If `/workflows` cannot fully express their coordination, they remain as personas — no team-lead-shaped surface gets reintroduced.

**Skills distribution (folded from old Phase 4).** First-party path PREFERS CC 2.1.157 auto-load of `.claude/skills/`; if Phase 0 criterion (d) fails (plugin-shipped skills don't auto-load under CLI-interactive), first-party path also uses Mode D-a — collapsing the "no skill export needed" simplification narrative and requiring the README rewrite (Phase 5) to carry the caveat. The W4.4 CI drift guard remains second-party-only either way. (Explicit Plan B per grill U2.)

**Rule (TPM, addresses grill U3 + Q3 delivery safety; architect-v2 enforced via `execute-dispatch` epic_override mechanism above):** per-epic disposition (Phase 4b) **overrides** `execution.runtime: auto` heuristic. `auto` MUST NOT silently route `/plan` + `/test --simulated-manual` away from Multica until Phase 4b applies disposition for `multica-plan-test-cycles`. Codified as a precedence rule in the `execution.runtime` schema + enforced via `field_sources.execution_runtime.epic_override`.

**Phase 4a — Disposition AUDIT (READ-ONLY, runs PARALLEL to Phase 1-2; was Phase 5a in v1).** Per TPM split: 4a classifies each story in `multica-substrate-deepen/` (19 stories) + `multica-plan-test-cycles/` (11 stories) via git + disk cross-check (per memory `feedback_story_status_stale`, YAML `status: pending` lies for shipped work). Output per-story candidate disposition: keep-as-second-party / park / supersede. **No file mutations in 4a.** Read-only audit unblocks Q3 + Q7.

**Phase 4b — Disposition APPLY (sequenced AFTER Q3 resolution; was Phase 5b in v1).** Apply audit verdicts as YAML mutations + project memory updates. **Multica-substrate-deepen W3.2 `w3-2-autopilots-yaml`: park** (per architect-v2 Q5-descope ruling — not disposed in this epic, no adapter implication). Commits bundled into this epic's PR per TPM for single audit trail; watch <150 file cap per memory `feedback_pr_file_count_limit`; stack via base-branch retargeting if scope bloats.

**Phase 5 — README + positioning (OWN SLICE; was Phase 6 in v1).** Rewrite README hero + Quick Start step 1 per Q9's maintainer-confirmed posture (i) "Hive composes ON Claude Code". **Defense of late placement (grill C3 — accepted as written, see §10):** memory `feedback_check_readme_first` says "read README before drafting vision/positioning" — we did, the rescope memo IS that vision drill informed by the existing README. The README is an OUTPUT of this design (carries the resolved Q9 posture statement); making it an INPUT-anchor for Phase 1 stories risks language drift if Q-resolutions shift the posture. Phase 5 placement protects against that drift.

## 4. What Could Go Wrong

- **HIGH — `/workflows` public spec is one CHANGELOG sentence.** Context7 returns zero further API surface. Every design claim about workflow definition syntax, fan-out semantics, persona-to-step mapping, branch/PR discipline, and integration-branch honoring is unverified against Anthropic docs. **This is the load-bearing risk and the reason Phase 0 is non-negotiable.** Maps to grill H1.
- **HIGH — CC 2.1.157 `.claude/skills/` auto-load is unverified for plugin-shipped skills under CLI-interactive.** SDK auto-load confirmed; CHANGELOG language refers to consumer-side `.claude/skills/`. Plugin-hive ships via marketplace; whether 2.1.157 auto-loads it into a consumer's interactive CLI session is **not verified**. Phase 0 criterion (d) verifies. Plan B folded into Phase 3 skills-distribution clause. Maps to grill V3 / H3 / U2.
- **MEDIUM — Convention conflict: per-unit-PR vs per-epic-PR.** If `/workflows` follows `/batch`'s per-unit pattern and rejects integrationBranch coercion, the choice is bending `git_flow.branch_strategy: per-epic` OR running `/workflows` outside its native model via the serial-commit gate's worktree-per-story fallback (§3 Phase 2). Open as Q2 (maintainer-confirmed (a) conditional at gate 1).
- **MEDIUM (UNIFIED — architect-v2 collapse of grill C1 + C2) — Codex under `/workflows` fan-out.** Memory `feedback_codex_parallel_race` ("Agent(isolation:worktree) does NOT isolate codex-rescue subagents; default to SERIAL Codex dispatch") + memory `feedback_codex_sandbox_commit_block` ("codex:codex-rescue can't write `.git/index.lock`; orchestrator commits manually after Codex returns file list"). `/workflows` advertises "tens to hundreds of agents in the background"; multiple Codex creators in one workflow would race AND would lack the orchestrator-commits handoff Codex requires. **Mitigation = the §3 Phase 2 serial-commit-gate mechanism:** agents return file lists, adapter commits serially against integration branch, `/workflows` fan-out is permitted for Codex IFF agents make no `.git` writes. Eliminates both risks via one design move. Cycle-state reference: `.pHive/cycle-state/cc-workflows-first-party.yaml` security:plan-audit moderate (raised_by: tpm + architect). Phase 0(b) tightened pass-bar enforces it. Maps to grill C1 + C2 unified.
- **MEDIUM — Persona-classification regression.** Re-cutting 22/3 without first-hand evidence risks misclassifying orchestrator or team-lead. Phase 0 spike must surface a worked example before Phase 3 commits. Maps to grill P1.
- **MEDIUM — Fresh-merge churn from PR #234.** Day-old multica-plan-test-cycles merge means `/plan` + `/test --simulated-manual` currently route through Multica. Demoting before disposition risks orphaning a working code path. Phase 4a audit + Q3 guard this; per-epic-disposition-overrides-`auto` rule (enforced via `field_sources.execution_runtime.epic_override`) protects the runtime layer.
- **MEDIUM — Integration-principle rule 5 under parallel writers.** Integration-principle (single shared branch + serial discipline) holds because Multica dispatches 1 agent/role serial. `/workflows` claims parallel — would break rule 5 IF agents wrote directly. Serial-commit gate (§3 Phase 2) keeps rule 5 intact by moving serialization to the harness.
- **LOW — Composability narrative posture.** Resolved by maintainer-confirmed Q9 posture (i) "Hive composes ON Claude Code". No longer a quiet downgrade. README rewrite (Phase 5) + CONTEXT.md durable placement carries the reframe.
- **LOW — develop staging push policy.** Per memory `feedback_seek_direct_push_auth`, develop is the staging trunk; epic lands via PR. No deviation.

## 5. Dependencies and Constraints

- **External — CC 2.1.154 (`/workflows`) is GA locally.** Confirmed.
- **External — CC 2.1.157 `.claude/skills/` auto-load behavior for plugin-shipped skills under CLI-interactive.** Unverified; Phase 0 criterion (d).
- **External — `/workflows` API stability.** Undocumented internals may shift.
- **Internal — `task-tracking-dispatch/index.ts` ABI.** Vendor-neutral; reuse.
- **Internal — `mode_decision` precedence chain.** Env > config > default; `field_sources` records source.
- **Internal — `field_sources.execution_runtime.epic_override`** (architect-v2). New traceability field recording which per-epic disposition file overrode the `auto` heuristic for any given dispatch.
- **Internal — `git_flow.branch_strategy: per-epic` + per-story-commit convention.** Memory `feedback_git_flow_per_epic`. First-party adapter honors via serial-commit gate (§3 Phase 2).
- **Internal — `agent_backends` map.** Memory `feedback_codex_general_backend`. Survives.
- **Internal — Per-epic disposition overrides `execution.runtime: auto`.** Enforced via `field_sources.execution_runtime.epic_override` field; protects in-flight Multica routes until Phase 4b applies.
- **Internal — PR file count <150** per memory `feedback_pr_file_count_limit`. Disposition commits + skill scaffold + config + docs + README — watch the cap, stack if needed.
- **In-flight — `multica-substrate-deepen` (19 stories).** Disposition via Phase 4a/4b. W3.2 `w3-2-autopilots-yaml` parks (not disposed in this epic).
- **In-flight — `multica-plan-test-cycles` (11 stories, PR #234 merged 2026-05-28).** Disposition via Phase 4a/4b; Q3 explicit.

## 6. Open Questions

*All Q1-Q8 maintainer-confirmed at gate 1 (2026-05-31). Q5 (autopilot owner split) DESCOPED — autopilot work removed from this epic entirely; remaining questions re-numbered? **No** — preserved as 1-9 minus 5 to keep cross-doc references stable; gap retained at Q5 with a tombstone.*

1. **Phase 0 spike scope.** Pass = criteria (a)-(d) under §3 Phase 0 each have an explicit verdict. Spike runs a 5-story epic with at least one Codex-routed creator. Maintainer override on the pass bar. **Maintainer-confirmed: as written.**
2. **PR-flow under `/workflows` — preserve (a) or bend (b)?** **Conditional recommendation (grill U1):** (a) IF Phase 0 confirms `/workflows` honors shell-snippet integration-branch contract injected into agent prompts; ELSE fall back to serial-commit gate's worktree-per-story isolation + serialized merge (§3 Phase 2 mechanism). **Maintainer-confirmed at gate 1: (a) conditional.**
3. **`multica-plan-test-cycles` disposition.** Keep-as-second-party (Multica still routes `/plan` + `/test --simulated-manual` when user opts in), OR supersede (first-party path replaces those routes). Recommendation: keep-as-second-party for first release, revisit after first-party PR-flow + persona surface settle. Per-epic disposition overrides `auto` until resolved. **Maintainer-confirmed: keep-as-second-party for first release.**
4. **`execution.runtime` default for first release.** `workflows` (aggressive demotion), `auto` with per-skill heuristic (gradual demotion), or `multica` (publish but don't switch). Recommendation: `auto` with the **explicit precedence rule that per-epic disposition (Q3 for mpt; Phase 4b for msd) overrides the heuristic** (architect-v2 enforced via `field_sources.execution_runtime.epic_override`). **Maintainer-confirmed: `auto` + per-epic-override rule.**
5. **~~Autopilot owner split.~~ DESCOPED at gate 1** (architect-v2 ruling). Autopilot work removed from this epic entirely. Tombstone preserved to keep cross-doc references stable (grill record cites Q5; future readers find this tombstone). W3.2 `w3-2-autopilots-yaml` parks under `multica-substrate-deepen` per Phase 4b. Grill H2 (Multica webhook untested) becomes out-of-scope for this epic — see §10 deviation.
6. **First-party `/workflows` adapter parity scope.** Minimum viable (story dispatch + integration-branch contract + completion signal) vs full feature match. Recommendation: minimum viable. **Maintainer-confirmed: minimum viable.**
7. **Rescope memo Option A vs C.** A (narrow Multica to moats) vs C (pivot — `/workflows` as executor, Multica as durable queue + external-trigger). Recommendation: A for first release; C if Phase 0 reveals `/workflows` integration-branch coercion is too costly. **Maintainer-confirmed: A for first release.**
8. **`execution.runtime` vs `execution.substrate` key choice (grill V2).** CONTEXT.md already establishes `execution.substrate: sessions-cloud` for the conceptually-adjacent axis. **Are they orthogonal?** Writer's read: `substrate` names the caller-side loop variant (sessions-cloud / sandcastle-container / etc.); `runtime` names the executor seam (workflows / multica / auto). If maintainer confirms orthogonality, both keys exist. If maintainer sees overlap, extend `execution.substrate` with `workflows` / `multica` values rather than adding `execution.runtime`. **Recommendation: orthogonal — keep both. Maintainer-confirmed: orthogonal.**
9. **Composability posture realignment (grill P2).** 2.0 north-star is "Composability — substrate that the user directs vs director-chair workflow that hard-blocks" (CONTEXT.md). Adopting CC `/workflows` as first-party substrate is a major posture change. Two reframes possible: (i) "Hive composes ON Claude Code" (CC-as-substrate compatible, Hive is the composition layer on top), (ii) substrate-agnostic Hive with CC + Multica as coequal alternative substrates selected by `auto`. **Recommendation: (i). Maintainer-confirmed: (i) — durable placement in CONTEXT.md before story language locks in Phase C.**

## 7. Verification Strategy

```
VERIFICATION PLAN:
  Tools: Phase 0 spike (manual run of /workflows on real epic with Codex-routed creator),
         bash/git for integration-branch tests, pytest for hive/lib changes, shellcheck for shell-snippet contracts
  Platforms: macOS dev workstation (Darwin 25.3.0 in this worktree), CC 2.1.154+ runtime
  Automated:
    - mode_decision enum extension (unit assertion in execute-dispatch contract)
    - execution.runtime config precedence (env > config > default;
      per-epic-disposition-overrides-auto rule via field_sources.execution_runtime.epic_override)
    - episode-marker contract for execute-mode-cc-workflows
    - integration-branch shell-snippet equivalence (diff against multica-story-dispatch snippets)
    - serial-commit gate: file-list-return + fast-forward-only + rebase-and-push 3-retry (mirrors multica-story-dispatch:192-262)
  Manual:
    - Phase 0 spike criteria (a)-(d) — each gets an explicit pass/fail in spike-findings.md
    - persona-dispatchability re-classification (first-hand evidence required)
    - in-flight epic disposition (Phase 4a audit read-only; 4b apply after Q3)
    - README rewrite review (positioning correctness per maintainer-confirmed Q9 posture (i))
  Not verifying:
    - Multica server-side label-return defect (out of scope; second-party W4.x)
    - W4.4 CI drift guard (second-party-only; not migrated to first-party)
    - cost/latency benchmarks beyond Phase 0 spike snapshot (performance:audit minor escalation captures first-release retrospective)
    - Multica webhook-autopilot E2E pilot (autopilot work descoped per Q5; out of scope this epic)
```

## 8. Scale Assessment

```
SCALE ASSESSMENT:
  Files affected: ~50-90
    - skills/execute/SKILL.md (step 6 extension)
    - skills/hive/skills/execute-dispatch/SKILL.md (enum + field_sources + per-epic-override rule + epic_override field)
    - skills/hive/skills/execute-mode-cc-workflows/SKILL.md (NEW; contains workflow_assembly substep)
    - hive.config.yaml + hive/hive.config.yaml (execution.runtime schema + override rule)
    - README.md (hero + Quick Start rewrite — Phase 5 per maintainer-confirmed Q9 posture (i))
    - CONTEXT.md (posture statement per Q9; vocab disambiguation per V1)
    - .pHive/epics/cc-workflows-first-party/docs/ (spike-findings, persona-dispatchability-under-cc-workflows, disposition-pass-msd, disposition-pass-mpt)
    - Story YAMLs across two in-flight epics (disposition annotations from Phase 4b)
    - Possibly hive/lib/ adapter scaffold for cc-workflows runtime (size depends on Phase 0)
  Subsystems: executor seam, persona surface, skill distribution, config schema,
              README/positioning, CONTEXT.md posture, in-flight epic disposition (2 epics), integration-branch contract (serial-commit gate)
              [autopilot subsystem REMOVED per Q5 descope]
  Migration required: yes — Multica demotion is a substrate migration; per-epic disposition overrides `auto` until Phase 4b
  Cross-team coordination: no (single-maintainer plugin); cross-epic disposition for ~30 stories is in scope
  Unknowns: 8 open questions (was 9; Q5 descoped — tombstone retained for cross-doc ref stability), 2 HIGH risks both gated on Phase 0 spike
  
  RECOMMENDATION: Needs structured outline (Large) — maintainer-confirmed at gate 1
  RATIONALE: 8 subsystems + 2 HIGH-risk unknowns gated on Phase 0 + cross-stack work (skills + lib + config + docs + tracker integration + cross-epic disposition for 30 stories) + memory `feedback_scope_class_changes` flags substrate-level as full-planning. Phase B2 H/V → Phase B3 structured outline → Phase C stories → maintainer gate at each. Phase 0 spike is first deliverable; can be scoped after structured outline locks the eight Open Questions. Architect re-review delivered at v2; Q5 descoped; serial-commit-gate mechanism unified C1+C2.
```

## 9. Architect-v2 review note

Architect was bypassed at v1 collaborative gate and returned at v2 with substantive findings: Q1 mirror-shape adapter seam approved; Q2 precedence chain tightened via `execute-dispatch` reading per-epic disposition + recording `field_sources.execution_runtime.epic_override`; **Q3+Q4 grill C1/C2 unified into a single serial-commit-gate mechanism** at the integration-branch push layer (§3 Phase 2 + §4 unified risk); **Q5 (autopilot owner split) descoped entirely** — autopilot work removed from this epic, Phase 4 collapsed, W3.2 parks under multica-substrate-deepen. Performance:audit minor escalation recorded for first-release retrospective. Architect concurs with Large scale + structured outline next.

## 10. Accepted deviations from grill / review findings

- **C3 (README rewrite Phase 5 placement, was Phase 6 in v1)** — accepted as written. Rationale: README is an OUTPUT of this design, not its anchor; the rescope memo + research brief + this design discussion ARE the upstream reading-the-README step memory `feedback_check_readme_first` calls for. Anchoring Phase 1 stories on a pre-resolution README risks language drift if Q-resolutions shift the posture. Phase 5 placement is a conscious bet that the design tail-end is the safest moment to lock the canonical North Star to the maintainer-confirmed posture (i).
- **H2 (Multica webhook-autopilot path not pilot-tested E2E)** — accepted as OUT OF SCOPE for this epic. Rationale: Q5 (autopilot owner split) is descoped per architect-v2 gate-1 ruling. Autopilot work (including the second-party webhook-autopilot E2E pilot that would have validated H2) is not part of this epic. H2 remains a real concern for whichever future epic owns autopilot work; tracked there, not here. Cycle-state escalations carry no autopilot-related entry post-descope.

All other grill findings (V1, V2, V3, H1, H3, U1, U2, U3, C1, C2, P1, P2) addressed inline in §1-§8 or surfaced as Open Questions (Q8 ← V2; Q9 ← P2). No silent skips. C1 + C2 unified into the serial-commit-gate mechanism per architect-v2.

---

*End of revised v2 draft. Next: Phase B2 H/V planning. Architect-v2 review state captured in §0 + §9. Maintainer gate 1 cleared 2026-05-31.*
