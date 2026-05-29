# Research Brief — cc-workflows-first-party

**Epic id:** `cc-workflows-first-party`
**Base branch:** `develop`
**Branch strategy:** per-epic (`feat/cc-workflows-first-party`)
**Produced:** 2026-05-29
**Author:** technical-writer (from researcher raw findings dated 2026-05-29)
**Confidence:** medium (one HIGH risk on public spec gap; see Risks §5)

---

## 1. Summary

This epic re-bases plugin-hive's `/execute` substrate on Claude Code `/workflows`
(CC 2.1.154 GA, "dynamic workflows… tens to hundreds of agents in the background")
as **first-party**, while demoting the existing Multica-in-Sandcastle path to
**second-party** retained for heterogeneous-provider co-mingling, headless webhook
autopilots, and durable cross-session issue queues. Headline finding: the
existing `mode_decision` enum in `skills/hive/skills/execute-dispatch/SKILL.md`
is a clean extension point and the in-repo TaskTrackingDispatch ABI is already
vendor-neutral, so the seam exists — but the **public spec for `/workflows` is
exactly one CHANGELOG sentence**, with zero further API surface returned by
context7. Every shape claim about workflow definition syntax, persona-to-step
mapping, fan-out semantics, and PR/branch discipline is research-spike-required,
not a known-shape rebase.

## 2. Verified state vs assumed state

### Verified on disk (this worktree)

- **Re-scope memo is present.** `.pHive/epics/multica-substrate-deepen/docs/rescope-vs-cc-dynamic-workflows.md` exists on `feat/cc-workflows-first-party` as of commit `90098ea`. Treat as load-bearing input, not an open blocker. (Researcher's HIGH-severity "missing memo" risk in raw findings §RISKS is now resolved by the import; carried forward downgraded.)
- **Existing mode-selection seam.** `skills/execute/SKILL.md` Process steps 6a/6b/6c/6d/6e are the five mode branches (TeamCreate, cmux, sessions, sandcastle, multica). No `cc-workflows` branch exists; adding one means inserting `6f` and a new atomic skill `skills/hive/skills/execute-mode-cc-workflows/SKILL.md`.
- **`mode_decision` enum location.** `skills/hive/skills/execute-dispatch/SKILL.md` carries `mode_decision = sessions | team | team-cmux | sequential | sandcastle | multica`, plus `field_sources` map for `sessions_enabled, parallel_teams, terminal_mux, executor, execution_mode`.
- **TaskTrackingDispatch is vendor-neutral.** `hive/lib/task-tracking-dispatch/index.ts:1-100` exposes `dispatch(req: {method, params}) → result|throw AdapterError` over `github | linear | multica` + custom adapters. No fork required for status updates.
- **Integration-branch contract is encoded in Multica dispatch.** `hive/lib/multica-story-dispatch/index.mjs:192-262` injects per-story shell snippets (fetch/checkout/reset; commit `[{story-id}] <type>(<scope>): <description>`; rebase-and-push with 3-retry policy) into the issue body. Any CC-workflows-runtime dispatch must inject the equivalent prompt-augmentation or honor it via CC-native primitives.
- **Per-persona provider routing.** `hive.config.yaml` `agent_backends` map (2026-05-01 policy): `codex` on researcher / developer(s) / technical-writer / architect; `claude` on reviewer / tester / QA / remaining specialists. Routing survives substrate change — agents are still personas; only the dispatch carrier moves.
- **Persona surface.** 25 personas in `hive/agents/`. Per `.pHive/epics/multica-substrate-deepen/docs/persona-dispatchability.md:15-65`: 22 dispatchable, 3 harness-only (orchestrator, team-lead, pair-programmer). Harness-only verdict is **Multica-substrate-conditional** — CC `/workflows` IS the harness, so re-classification (not re-use) is in scope. See Risks §3.
- **Mode D-a skill bundling.** `hive/lib/multica-bootstrap/` `reconcileSkills` bundles SKILL.md + substrate_deps into a single Multica skill row via `<!-- substrate: <path> -->` markers, driven by `.pHive/multica/skills-export.yaml` (7 exports today: `metrics-check` + 6 writer doc-type skills).

### Assumed in epic premise (NOT independently verified this pass)

- **`/workflows` API surface.** Anthropic CC CHANGELOG entry for 2.1.154 is the only published reference: "Introducing dynamic workflows: ask Claude to create a workflow and it orchestrates work across tens to hundreds of agents in the background, so you can take on larger, more complex tasks. Run `/workflows` to view your runs." Context7 returns **zero** further API/syntax surface. Every design claim about first-party `/workflows` shape is unverified. **HIGH risk.** See §5.1.
- **CC 2.1.157 `.claude/skills/` auto-load.** Claim that 2.1.157 auto-loads skills from `.claude/skills/` is the load-bearing premise for deprecating Mode D-a skill bundling on the first-party path. SDK skill discovery from `.claude/skills/` is confirmed; **interactive-CLI auto-load for 2.1.157 was NOT independently confirmed** in this research pass — one context7 query errored with model unavailability. See §5.2.
- **`/workflows` PR/branch discipline.** Nearest verifiable analog is `/batch` ("decomposes the work into 5 to 30 independent units, spawns one background subagent per unit in an isolated git worktree, each opens a PR"). Per-unit PR conflicts with Hive's `git_flow.branch_strategy: per-epic` convention. Whether `/workflows` inherits `/batch`'s per-unit PR pattern is unknown. See §5.4.

## 3. Key files & surfaces

### Extension points (will change)

- `skills/execute/SKILL.md` — add Process step `6f` for cc-workflows branch.
- `skills/hive/skills/execute-dispatch/SKILL.md` — extend `mode_decision` enum (likely value `cc-workflows` or `workflows`); add `field_sources.execution_mode` entry; preserve env > config > default precedence.
- **(new)** `skills/hive/skills/execute-mode-cc-workflows/SKILL.md` — atomic execute-mode skill; mirrors the shape of `execute-mode-multica` / `execute-mode-sandcastle` / `execute-mode-session` / `execute-mode-team-cmux`. Step 0 precondition gate, episode marker `${HIVE_STATE_DIR}/episodes/{epic}/{story}/cc-workflows-run.yaml`, summary return.
- `README.md:1-20` — hero ("Composable substrate for the agentic SDLC") and Quick Start step 1 (`/hive:multica-init` as "Bootstrap Multica as the execution substrate") become misleading once Multica is second-party. README rewrite is in scope.
- `hive.config.yaml` `execution.*` block — new `execution.runtime: cc-workflows` (or equivalent) sits inside the same block; surfaces through the same `field_sources` mechanism.

### Reused as-is (no fork)

- `hive/lib/task-tracking-dispatch/index.ts` — vendor-neutral story status updates; used by `/plan` Phase D and `/execute`.
- `hive/lib/multica-bootstrap/` — second-party Multica bootstrap retained.
- `hive/lib/multica-issue-closer.mjs` — second-party Multica lifecycle. First-party path needs no equivalent (CC workflows owns its own lifecycle).
- Atomic execute-mode skills `multica`, `sandcastle`, `session`, `team-cmux` — 4 worked examples of the contract that `execute-mode-cc-workflows` follows.
- `hive/references/pre-shutdown-protocol.md`, `skills/hive/skills/respawn/SKILL.md` — session-mode notes it "**replaces** the respawn skill for its stories"; CC-workflows mode likely follows the same exclusivity pattern.
- `hive/lib/scope_drift.py` — 3 emit sites only (`plan:phase-c`, `execute:story`, `review:complete`). CC-workflows mode must NOT re-add per-phase emits (see memory `feedback_scope_drift_emit_sites`).

### Reference / motivating docs

- `.pHive/epics/multica-substrate-deepen/docs/rescope-vs-cc-dynamic-workflows.md` — premise drill; imported on `feat/cc-workflows-first-party` at commit `90098ea`.
- `.pHive/epics/multica-substrate-deepen/docs/pilot-roundtrip-validation.md` — W4.3/W4.5 warm-path defect record (Multica GET `/api/skills` omits `content_hash` / `visibility`; reconcileSkills sees `existing.content_hash === undefined` → unnecessary PUT per re-run). Metric `multica.skills_export_pilot_roundtrip_pass = 0.5`. Relevant to second-party Mode D-a retention, NOT a blocker for first-party path.
- `.pHive/epics/multica-substrate-deepen/docs/persona-dispatchability.md:15-65` — 22 dispatchable / 3 harness-only classification under Multica substrate. Re-classification required under CC-workflows substrate.

## 4. Patterns & conventions

- **Mode-selection chain (additive).** `execution.mode` resolves env > config > default; source recorded in `field_sources`. Enum extension is additive. CC-workflows adds one enum value + one branch in `/execute` step 6.
- **Atomic execute-mode skill shape.** 5 shipped examples define the contract: invocation inputs/outputs, Step 0 precondition gate, episode marker contract under `${HIVE_STATE_DIR}/episodes/{epic}/{story}/<mode>-run.yaml`, summary return to `/execute`. CC-workflows mode mirrors this shape.
- **Per-epic branch + per-story commit.** `git_flow.branch_strategy: per-epic` + memory `feedback_git_flow_per_epic`. Encoded as injected shell snippets in `multica-story-dispatch/index.mjs:192-262`. **CC `/batch`'s per-unit PR pattern conflicts** — reconciliation belongs in the CC-workflows-mode skill or the convention bends.
- **Per-persona provider routing.** `agent_backends` map per `hive.config.yaml` + per-story `resolveCodexInstruction` conditional at `hive/lib/multica-story-dispatch/index.mjs:140-159`. CC-workflows mode must preserve this; only the dispatch carrier changes.
- **Mode D-a skill bundling.** Substrate deps inlined via `<!-- substrate: <path> -->` markers in the bundled skill body, NOT as separate skill_files rows. **Premise**: CC 2.1.157 `.claude/skills/` auto-load obviates this for first-party. **Unverified.**
- **Vendor-neutral story dispatch.** TaskTrackingDispatch already non-branching on adapter vendor. CC-workflows runtime inherits this surface unchanged.

## 5. Risks

1. **HIGH — `/workflows` public spec is one changelog sentence.** Anthropic CC CHANGELOG 2.1.154 is the entirety of the published spec. Context7 query for `/workflows` orchestration / fan-out / step-mapping returns ZERO content; only `/batch`, `/agents`, `/tasks`, `/background` docs exist as adjacent primitives. **Implication:** treat first-party path as research-spike-required. Design discussion must commit to a spike story before structural work.

2. **HIGH — CC 2.1.157 `.claude/skills/` auto-load claim is unverified.** SDK skill discovery from `.claude/skills/` confirmed; CLI/interactive auto-load behavior at 2.1.157 was NOT confirmed (context7 query errored mid-pass with "claude-opus-4-7 temporarily unavailable"). **Implication:** if 2.1.157 auto-load is plugin-shipped-skill-aware, Mode D-a deprecation on first-party path is sound; if it only auto-loads cwd-rooted skills, substrate bundling is still needed. Re-verify before declaring the bundling layer obsolete.

3. **MEDIUM — Persona dispatchability re-classification.** Existing classification (22 dispatchable / 3 harness-only) cites `TeamCreate + SendMessage` as the harness primitives that `orchestrator`, `team-lead`, `pair-programmer` depend on. CC `/workflows` IS the harness, so the orchestrator + team-lead **may collapse into workflow-definition syntax** instead of being dispatched agents. **Implication:** the split under CC-workflows is likely "N dispatchable + 0-3 collapsed-into-workflow-YAML" — NOT the same 22/3 boundary. Re-classification belongs in design discussion.

4. **MEDIUM — Per-unit-PR vs per-epic-PR convention conflict.** `/batch` ("each subagent implements its unit, runs tests, and opens a pull request") is the nearest analog. If `/workflows` shares the per-unit PR pattern, it conflicts with `git_flow.branch_strategy: per-epic` (one PR per epic + one commit per story) per `hive.config.yaml` + memory `feedback_git_flow_per_epic`. **Implication:** load-bearing decision for CC-workflows-mode skill: either collapse per-unit PRs into the per-epic commit-on-shared-branch contract OR bend the convention. Reconcile in design discussion.

5. **MEDIUM — Integration-branch contract injection.** Currently encoded as shell-snippet injection into Multica issue body (`multica-story-dispatch/index.mjs:192-262`). CC-workflows-runtime dispatch must either inject equivalent prompts into agent contexts OR honor it via CC-native worktree primitives (`/batch` uses isolated git worktrees per subagent, which is structurally compatible but uses per-story branches — see §5.4).

6. **MEDIUM — In-flight epic fresh-merge churn.** PR #234 (multica-plan-test-cycles, 11 stories `mpt-1..mpt-11`) merged 2026-05-28, one day before this epic kicks off. It expanded Multica's surface into `/plan` + `/test --simulated-manual`. Demoting Multica to second-party while a fresh merge invests in its expansion creates ownership ambiguity. **Disposition pass required** for both `multica-substrate-deepen/` (19 stories; several shipped via PR #230, PR #231) and `multica-plan-test-cycles/` (11 stories; all in PR #234) — classify each as keep / park / supersede. Trust git + disk; story-YAML status fields are stale per memory `feedback_story_status_stale`.

7. **LOW — Autopilot surface not yet materialized.** `.pHive/multica/autopilots.yaml` is absent (W3.2 `w3-2-autopilots-yaml` status pending in YAML; not shipped to disk). Schema documented at `hive/references/multica-autopilots-schema.md` (`create_issue` and other modes; example: `metrics-check-post-merge` firing `/metrics-check` on TPM). **Implication:** second-party autopilot retention is theoretical — there is nothing shipped to preserve yet. Design discussion decides whether to keep W3.2 in scope under second-party or park it.

8. **LOW — README positioning rewrite.** README hero ("Composable substrate for the agentic SDLC — user-directed, disciplined, kickoff to ship") and Quick Start step 1 (`/hive:multica-init` "Bootstrap Multica as the execution substrate (one-time setup; idempotent on re-run)") are the canonical positioning claims that the rescope memo inverts. **Implication:** rewrite is in scope. Brand-level posture decision (composability narrative under CC-as-substrate; see §6 Open Q3) belongs in design discussion.

## 6. Open questions

1. **`/workflows` API surface.** What is the actual public/internal API surface beyond the changelog sentence — workflow definition syntax, agent-step mapping, interaction with subagents / skills / `/batch` / `/agents`?
2. **2.1.157 `.claude/skills/` auto-load.** Does CC 2.1.157 auto-load from `.claude/skills/` in the interactive CLI (not just SDK), and does it include plugin-shipped skills or only cwd-rooted ones?
3. **PR/branch discipline.** Does `/workflows` follow `/batch`'s per-unit PR pattern, or is it configurable to per-epic? Does it honor a custom integrationBranch instruction in agent prompts, or does it impose its own branch model?
4. **Webhook / autopilot equivalent.** Does CC `/workflows` have a webhook / autopilot equivalent, or does headless dispatch stay in Multica-second-party for the foreseeable future?
5. **Heterogeneous-provider co-mingling.** Does `/workflows` allow per-agent provider routing (some on Codex, others on Claude), or does it run all agents on the current CC session model? This is the load-bearing reason the epic preserves Multica as second-party.
6. **In-flight disposition.** For each `multica-substrate-deepen` story (19) and `multica-plan-test-cycles` story (11): keep under second-party scope, park, or supersede? Cross-check git + disk per memory `feedback_story_status_stale`.
7. **Composable-substrate narrative.** Hive 2.0 framing (per memory `project_hive_2_0_milestone`) is "composable substrate, user-directed". Adopting CC `/workflows` as the first-party substrate makes the substrate **Claude Code itself**. How does the composability narrative absorb or reframe this?

## 7. Inconsistency risk signals (carry-forward to grill)

These 8 signals are the researcher's appended `INCONSISTENCY_RISK_SIGNALS` from `research-raw.md` lines 138-148, preserved verbatim in substance for the grill skill to consume next.

1. **Vocabulary mismatch.** Brief uses "CC `/workflows`" + "first-party"; repo CONTEXT.md and shipped code use "Workflow" to mean `hive/workflows/*.workflow.yaml` static YAML. **Same word, two referents.** Design discussion must disambiguate.

2. **Hidden assumption — first-party as known shape.** Brief asserts "CC `/workflows` (CC 2.1.154 GA) as native multi-agent fan-out". Anthropic's changelog calls it "dynamic workflows" with no published API. Treating it as first-party substrate without a research spike is a load-bearing assumption.

3. **Hidden assumption — 2.1.157 auto-load.** Brief assumes "CC 2.1.157 skills auto-load from `.claude/skills`" subsumes Mode D-a. NOT verified this pass (context7 query failed). If 2.1.157 auto-load is plugin-shipped-skill-aware, claim holds; if not, Mode D-a substrate bundling is still needed on first-party path.

4. **Unresolved tension — fresh-merge churn.** Brief demotes Multica-in-Sandcastle to second-party, but PR #234 (multica-plan-test-cycles, merged 2026-05-28) just expanded Multica's surface into `/plan` and `/test --simulated-manual`. Demoting a substrate one day after merging fresh integration creates ownership ambiguity. Disposition pass must classify each `mpt-*` story.

5. **Convention violation risk — per-epic vs per-unit PR.** If CC `/workflows` follows `/batch`'s per-unit PR pattern (likely), it conflicts with the per-epic PR convention encoded in `hive.config.yaml` and memory `feedback_git_flow_per_epic`. Either CC-workflows mode adapts (collapse per-unit PRs into per-epic) or the convention bends. Load-bearing decision.

6. **Posture mismatch — composable-substrate narrative.** Hive 2.0 framing is "composable-substrate, user-directed". Adopting CC `/workflows` as first-party makes the substrate **Claude Code itself**, not "composable substrate". The composability narrative needs to absorb or reframe this — orchestrator + team-lead potentially collapse into CC workflow harness, but Hive's value still claims "composable substrate".

7. **Convention violation risk — README Quick Start.** README:Quick Start step 1 is `/hive:multica-init` ("Bootstrap Multica as the execution substrate"). Demoting Multica makes this onboarding step misleading. README rewrite is in scope.

8. **Hidden assumption — disposition classification.** Brief expects classification of every `multica-substrate-deepen` (19) + `multica-plan-test-cycles` (11) story as keep / park / supersede. Both epics' story-YAMLs show status `pending` while git log + PR refs show many shipped. Researcher trusted git+disk per memory `feedback_story_status_stale`; design discussion must too.

## 8. Validation note

- **Checked:** Claude Code `/workflows` (2.1.154 GA), Claude Code skills auto-load (`.claude/skills/`), `/batch` parallel orchestration, subagent file format, Multica REST surface (in-repo references only, not freshly contacted).
- **Source:** context7 (`/anthropics/claude-code` CHANGELOG + `/websites/code_claude` docs); codebase reads from this worktree.
- **Confidence:** medium — anchored on a single Anthropic CHANGELOG sentence; one context7 query for 2.1.157 auto-load errored mid-pass and was not retried.
- **Method:** researcher dated 2026-05-29; technical-writer synthesized 2026-05-29 from `research-raw.md` (164 lines) + verified the re-scope memo is now on disk at `.pHive/epics/multica-substrate-deepen/docs/rescope-vs-cc-dynamic-workflows.md` (commit `90098ea`).

---

_End of brief. Next consumer: grill skill (Phase A2 step 4a) reads §7 inconsistency risk signals; design-discussion drafting (Phase B step 4) consumes the full brief._
