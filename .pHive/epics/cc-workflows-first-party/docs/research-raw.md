# Research Raw Findings — cc-workflows-first-party

**Epic:** cc-workflows-first-party
**Branch:** feat/cc-workflows-first-party off develop
**Author:** researcher persona
**Date:** 2026-05-29

---

## FILES_EXAMINED

### Current /execute mode-selection seam
- `skills/execute/SKILL.md` (396 lines) — Process steps 6a/6b/6c/6d/6e are the five mode-selection branches: TeamCreate, cmux, sessions, sandcastle, multica. Each invokes `skills/hive/skills/execute-mode-<mode>/SKILL.md`. No `cc-workflows` branch exists; adding one means inserting a new `6f` branch and a new atomic skill.
- `skills/hive/skills/execute-dispatch/SKILL.md` (the dispatch atom) — `mode_decision` enum currently `sessions | team | team-cmux | sequential | sandcastle | multica`. Outputs `mode_reason`, `runner_path` (`hive-dag | orchestrator-narrated`), `runner_reason`, `field_sources` map for `sessions_enabled, parallel_teams, terminal_mux, executor, execution_mode`. **First-party CC workflows must extend this enum (likely `cc-workflows` or `workflows`) and add a `field_sources.execution_mode` source entry.**
- `skills/hive/skills/execute-mode-multica/SKILL.md` — gate: `HIVE_EXECUTION_MODE=multica` env OR `execution.mode: multica` config. One Multica issue per Hive story → assigned to bootstrapped agent → Multica owns inner task work_dir + execution. This is the shape the new CC-workflows-mode skill mirrors but with native CC workflow as the dispatch carrier.
- `skills/hive/skills/execute-mode-sandcastle/SKILL.md` — Sandcastle is identified at `skills/sandcastle-gh-init/assets/hive-dispatch.yml.tpl:9,202` setting `HIVE_EXECUTION_MODE=team` inside the container (single-isolation-layer rule).
- `skills/hive/skills/execute-mode-session/SKILL.md` — Session mode uses Claude Agent SDK `/v1/sessions`. Documents "**replaces** the respawn skill for its stories" pattern — same exclusivity contract CC-workflows mode will need.
- `skills/hive/skills/execute-mode-team-cmux/SKILL.md` — cmux variant of TeamCreate.

### Story dispatch (Multica path)
- `hive/lib/multica-story-dispatch/index.mjs` — `serializeStoryBrief(story, options)` at line 161; sections: Goal, Use /codex:rescue (conditional), Acceptance Criteria, Files to Touch, Code Examples, References, Integration Contract. Honors `integrationBranch` option (single shared epic branch contract). `resolveCodexInstruction(options)` at line 140 takes `{codexInstruction, dispatchingPersona, agents, agentBackends}` — per-persona codex routing. `dispatchStoryToAgent(serverUrl, token, workspaceId, issueUuid, agentUuid)` issues a PUT against the Multica REST surface. `dispatchStoryToPersonas(...)` does N-persona fan-out (planning-mode use).
- `hive/lib/multica-story-dispatch/README.md` — module-level contract.
- `hive/lib/multica-story-dispatch/episode-sync.mjs` — multica-run.yaml episode marker writer.

### Task-tracking adapter ABI (vendor-neutral)
- `hive/lib/task-tracking-dispatch/index.ts:1-100` — TaskTrackingDispatch class. ABI: `dispatch(req: {method, params}) → result|throw AdapterError`. Built-in adapters: `github | linear | multica`, plus custom paths. Adapter config map: `{adapter, adapter_timeout_ms, gate_mode, team_value, project_value, github:{token}, linear:{api_key,team}, multica:{server_url,token}}`. Module-scoped cache keyed by SHA-1 of normalized config. ABI error codes (5): NOT_FOUND, AUTH_FAILURE, RATE_LIMIT, UNKNOWN_METHOD, OPERATION_UNSUPPORTED + 3 Hive virtuals: INTERNAL_ERROR, TIMEOUT, NO_ADAPTER. **This is the shape CC-workflows runtime needs to honor — story status updates already vendor-neutral, no fork required.**

### Multica bootstrap (will remain second-party)
- `hive/lib/multica-bootstrap/index.mjs:1-80` — DEFAULT_SERVER_URL, USER_AGENT, RUNTIME_CACHE, bootstrapError, redact (PAT redaction). Houses reconcileAgents/Squads/Autopilots/Skills.
- `skills/multica-init/SKILL.md` Step 1-7: checkHealth → ensureCli → ensureAuth → ensureWorkspace → ensureDaemon → reconcileSkills (BEFORE agents per dep order) → reconcileAgents (resolves persona_ref to markdown; attaches skills via `PUT /api/agents/{id}/skills`).

### Persona surface
- `hive/agents/` lists 25 personas. Classification per `.pHive/epics/multica-substrate-deepen/docs/persona-dispatchability.md:15-65`:
  - **Dispatchable (22):** accessibility-specialist, analyst, animations-specialist, architect, backend-developer, developer (deprecated), frontend-developer, idiomatic-reviewer, peer-validator (borderline), performance-reviewer, researcher, reviewer, security-reviewer, technical-writer, test-architect, test-inspector, test-scout, test-sentinel, test-worker, tester, tpm, ui-designer.
  - **Harness-only (3):** orchestrator, team-lead, pair-programmer.
- The harness-only verdict explicitly cites `TeamCreate + SendMessage` coordination — these are CC harness primitives. CC `/workflows` is itself the multi-agent harness; the question is whether orchestrator+team-lead **collapse into workflow-definition syntax** when CC is the substrate.

### Skills shipped + auto-load
- 23 top-level skills under `skills/` and 28 atomic skills under `skills/hive/skills/`.
- `.claude/` worktree directory contains ONLY `settings.local.json` — no `.claude/skills/` materialized locally. Plugin shipping is via `.claude-plugin/marketplace.json` + `plugin.json` (declares `plugin-hive` at `./` source).
- Marketplace entry: `version: 2.9.0`, tags include `workflow`, `multi-agent`, `orchestration`, `sdlc`.
- Mode D-a (Multica skill-export): `.pHive/multica/skills-export.yaml` declares 7 exports (`metrics-check` + 6 writer doc-type skills). reconcileSkills bundles SKILL.md + substrate_deps via `<!-- substrate: <path> -->` markers into Multica skill row.

### Config surface
- `hive.config.yaml` (root, maintainer override) — `paths.state_dir: .pHive`, `paths.gate_mode: warning`, full `agent_backends` map (codex on researcher/developer(s)/technical-writer/architect; claude on the rest), `model_overrides`, `git_flow.default_pr_base: auto`, `git_flow.branch_strategy: per-epic`, `execution.*` block (sandcastle/multica-shaped knobs), `task_tracking` examples (commented). **Convention for new `execution.runtime: cc-workflows` knob:** sits inside `execution.*` block; per-skill override likely via same `field_sources` mechanism in execute-dispatch.
- `hive/hive.config.yaml` (shipped baseline, fall-through default).
- `.pHive/hive.config.yaml` (consumer override layer, not driving runtime path decisions).

### In-flight epic disposition
- `.pHive/epics/multica-substrate-deepen/`: epic.yaml + 19 stories. ALL 19 status: `pending` in YAML, BUT git log shows w2-3, w3-3, w4-3, w4-4, w4-5 commits already merged. Story status YAMLs are stale per memory `[feedback_story_status_stale](story_status_stale.md)` — trust git+disk. Shipped through PR #230 (referenced in branch list as merged) + PR #231 (writer-doctype-skills) + PR #234 (multica-plan-test-cycles, merged 2026-05-28 432bad2).
- `.pHive/epics/multica-plan-test-cycles/`: 11 stories (mpt-1..mpt-11), all YAML status `pending`, all shipped via PR #234 commits (`966b2cd mpt-6`, `273dbf8 mpt-7`, `e3dfdda mpt-8`, `b5d9e80 mpt-9`, `c31ba62 mpt-10`, `3ad2303 mpt-11`).
- W4.3/W4.5 known defect: `.pHive/epics/multica-substrate-deepen/docs/pilot-roundtrip-validation.md` — cold path PASS, warm idempotent path FAIL (Multica GET `/api/skills` does not return `content_hash` or `visibility`; reconcileSkills.diffSkill always sees `existing.content_hash === undefined` → unnecessary PUT each re-run). Metric `multica.skills_export_pilot_roundtrip_pass = 0.5`.

### Autopilot surface (second-party retention candidate)
- `.pHive/multica/autopilots.yaml` — **FILE ABSENT** (find returned only skills-export, agents, squads). W3.2 story (`w3-2-autopilots-yaml`) status: pending in YAML; not shipped to disk.
- `hive/references/multica-autopilots-schema.md` documents schema: `name, title, mode, agent, description, priority`. Modes: `create_issue` (verified) and others. Concrete example shows `metrics-check-post-merge` autopilot firing `/metrics-check` on TPM agent post-merge.
- `.pHive/epics/multica-substrate-deepen/docs/autopilot-deprecation.md` — autopilots replace local cron/scheduler invocation of `/metrics-check` + `/visual-qa`. **No /loop, /goal, RemoteTrigger, ScheduleWakeup callers found in shipped skills** — `find … -name '*loop*'` returns only `hive/lib/plan-phase-d/dispatch-loop.mjs` (internal helper) and `hive/references/sandcastle-ops-loop.md` (Sandcastle ops doc). The Sandcastle ops layer epic (sandcastle-ops-layer) has `s3-gh-actions-cron-loop.yaml` — cron-style scheduling lives in GH-Actions, not in-skill.

### README positioning
- `README.md:1-20` — Hero: "**Composable substrate for the agentic SDLC — user-directed, disciplined, kickoff to ship.**" Tagline: "A Claude Code plugin that turns your project into a coordinated swarm of AI specialists…" Quick Start step 1 is `/hive:multica-init` ("Bootstrap Multica as the execution substrate (one-time setup; idempotent on re-run)"). Features bullet: "Cross-model execution — route implementation and planning agents to OpenAI Codex while Claude handles orchestration, review, and gating". **The "Multica as the execution substrate" framing in Quick Start step 1 is the load-bearing positioning claim that the rescope memo would invert.**

### CC 2.1.154 changelog (load-bearing)
- `/anthropics/claude-code` CHANGELOG entry verbatim: "**2.1.154** — Opus 4.8 is here! Now defaults to high effort · /effort xhigh for your hardest tasks. **Introducing dynamic workflows: ask Claude to create a workflow and it orchestrates work across tens to hundreds of agents in the background, so you can take on larger, more complex tasks. Run `/workflows` to view your runs.** Fast mode on Opus 4.8 is now available at a fraction of its previous cost: 2x the standard rate for 2.5x the speed. The lean system prompt is now the default for all models except Haiku, Sonnet, and Opus 4.7 and earlier."
- CC docs context (`/websites/code_claude`) describe related primitives: `/batch` (decompose into 5-30 units, spawn one background subagent per unit in isolated git worktree, opens PRs); `/agents` (subagent manager); `/tasks` (lists running); `/background` (detaches session as background agent). **Note: context7 returns NO further `/workflows` API/syntax surface** — the changelog 1-liner is the entirety of the public spec available.

---

## PATTERNS_OBSERVED

- **Mode-selection chain pattern.** Pattern: `execution.mode` resolution | File: `skills/hive/skills/execute-dispatch/SKILL.md` | Detail: precedence env > config > default; `field_sources` map records source; `mode_decision` enum extension is additive. CC-workflows mode adds one enum value + one branch in /execute step 6.
- **Atomic execute-mode skill pattern.** Pattern: `skills/hive/skills/execute-mode-<mode>/SKILL.md` | File: 5 examples already shipped | Detail: each owns invocation contract (inputs/outputs), Step 0 precondition gate, episode markers under `${HIVE_STATE_DIR}/episodes/{epic}/{story}/<mode>-run.yaml`, summary return to /execute. CC-workflows mode follows the same shape.
- **Integration-branch single-commit contract.** Pattern: `serializeStoryBrief` integrationBranch section | File: `hive/lib/multica-story-dispatch/index.mjs:192-262` | Detail: explicit shell snippets for fetch/checkout/reset, commit format `[{story-id}] <type>(<scope>): <description>`, rebase-and-push retry policy with 3 retries. **CC-workflows-runtime dispatch must honor the same contract or downstream review/integrate flows break.**
- **Per-persona provider routing.** Pattern: `agent_backends` map | File: `hive.config.yaml` + `agents.yaml` (`provider: codex` for creators, `provider: claude` for verifiers + remaining specialists) | Detail: 2026-05-01 policy; per-persona explicit. CC-workflows mode preserves this — agents are still personas; only the dispatch carrier changes.
- **Mode D-a skill bundling.** Pattern: skill + substrate_deps bundled into single Multica skill row via `<!-- substrate: <path> -->` markers | File: `hive/lib/multica-bootstrap/index.mjs` reconcileSkills + `.pHive/multica/skills-export.yaml` | Detail: substrate dependencies inlined, NOT separate skill_files rows. CC 2.1.157 (per brief — unverified in context7) would auto-load `.claude/skills/` and obviate this bundling for the first-party path.
- **Vendor-neutral story dispatch.** Pattern: TaskTrackingDispatch | File: `hive/lib/task-tracking-dispatch/index.ts` | Detail: `/plan` Phase D and `/execute` status updates already do not branch on adapter vendor. CC-workflows runtime inherits this surface unchanged.
- **Provider routing in serializeStoryBrief.** Pattern: `resolveCodexInstruction` per-persona conditional | File: `hive/lib/multica-story-dispatch/index.mjs:140-159` | Detail: takes `{codexInstruction, dispatchingPersona, agents, agentBackends}` — codex instruction included only when dispatching persona's backend is codex. **This conditional was added by w1-4-dispatch-codex-instruction-conditional (status: pending in YAML, but referenced in code).**

---

## CONSTRAINTS

- **Constraint:** Branch is `feat/cc-workflows-first-party` off `develop`; per-epic branch strategy mandatory per `git_flow.branch_strategy: per-epic`. | Source: `hive.config.yaml` git_flow block + memory `[feedback_git_flow_per_epic](feedback_git_flow_per_epic.md)` | Impact: one PR for the whole epic; commits formatted `[story-id] <type>(<scope>): <description>`.
- **Constraint:** PR file count <150 for CodeRabbit. | Source: memory `[feedback_pr_file_count_limit](feedback_pr_file_count_limit.md)` | Impact: epic estimate (≈50-75 file touches per multica-substrate-deepen sizing) is comfortably under the cap; CC-workflows-first-party with similar scope is fine, but spanning stories must avoid stacking 200+ touch deltas.
- **Constraint:** `/execute` mode selection is config-overridable per-skill via env > config > default, source recorded in `field_sources`. | Source: `skills/hive/skills/execute-dispatch/SKILL.md:14-50` | Impact: new `execution.runtime: cc-workflows` must follow the same precedence chain; surfaces as a new value (`workflows`?) in `mode_decision` enum OR as a sibling `runner_path` value.
- **Constraint:** Single-isolation-layer rule. | Source: `skills/sandcastle-gh-init/assets/hive-dispatch.yml.tpl:9,202` ("the bridge sets HIVE_EXECUTION_MODE=team") | Impact: CC-workflows mode cannot recursively spawn CC-workflows; once selected, downstream invocations honor the parent decision.
- **Constraint:** Multica skill bundling has a known warm-path defect. | Source: `.pHive/epics/multica-substrate-deepen/docs/pilot-roundtrip-validation.md` | Impact: second-party retention of Mode D-a is contingent on this fix or a client-side state file workaround. **Not a blocker for first-party CC-workflows path** since auto-load obviates bundling.
- **Constraint:** Story status YAMLs lag git+disk. | Source: memory `[feedback_story_status_stale](feedback_story_status_stale.md)` | Impact: disposition pass for in-flight epics MUST cross-check git log, not trust YAML status field.

---

## RISKS

- **Severity: HIGH | Risk:** `/workflows` public spec is one changelog line. | Evidence: `/anthropics/claude-code` CHANGELOG 2.1.154 entry is the only Anthropic-source reference; context7 query for "dynamic workflows orchestration steps fan-out" returns ZERO `/workflows`-specific content — only `/batch`, `/agents`, `/tasks`, `/background` docs. | Implication: every claim about workflow definition syntax, fan-out semantics, persona-vs-step mapping, branch/PR discipline, and integration-branch honoring is **unverified against Anthropic docs**. Design discussion must treat first-party path as research-spike-required, not as a known-shape rebase.
- **Severity: HIGH | Risk:** Brief references `.pHive/epics/multica-substrate-deepen/docs/rescope-vs-cc-dynamic-workflows.md` but the file does NOT exist on disk. | Evidence: `find … docs/ -type f` returns 10 files; none named "rescope". `grep -r 'rescope'` in `.pHive/` returns only an enum value in `ed-2-handoff-schema.yaml`. | Implication: the canonical motivation document is missing. The brief either (a) references a memo that lives outside this worktree, (b) names a memo that will be authored as part of this epic, or (c) refers to a different filename. **This should be reconciled with team-lead before design discussion.**
- **Severity: HIGH | Risk:** "CC 2.1.157 skills auto-load from `.claude/skills`" claim cannot be verified through context7 in this session — last fetch errored with model unavailability. | Evidence: context7 query attempt returned `claude-opus-4-7 temporarily unavailable`. | Implication: if 2.1.157 auto-load behavior is misremembered, Mode D-a deprecation logic in CC-workflows-first-party path may break.
- **Severity: MEDIUM | Risk:** Persona dispatchability under CC `/workflows` is re-classification, not re-use. | Evidence: existing doc classifies `orchestrator`, `team-lead`, `pair-programmer` as harness-only on the Multica substrate; CC workflows IS the harness, so orchestrator+team-lead potentially collapse into workflow YAML, not into a dispatched agent. | Implication: workflow-as-harness path likely needs 19 dispatchable + 0-3 collapsed into workflow definitions; this is NOT the same 22/3 split.
- **Severity: MEDIUM | Risk:** integration-branch contract is encoded as shell-snippets injected into Multica issue body. | Evidence: `multica-story-dispatch/index.mjs:192-262` | Implication: CC-workflows-runtime dispatch must inject equivalent commit/push/rebase discipline into its agent prompts, OR honor it via CC-native worktree primitives (`/batch` uses isolated git worktrees per subagent — this is structurally compatible but uses per-story branches, conflicting with per-epic branch strategy).
- **Severity: MEDIUM | Risk:** `/batch` produces one PR per unit, not one PR per epic. | Evidence: `/websites/code_claude` doc: "Each subagent implements its unit, runs tests, and opens a pull request." | Implication: if `/workflows` shares `/batch`'s per-unit PR pattern, it conflicts with `git_flow.branch_strategy: per-epic` (one PR per epic, one commit per story). Adapter logic in CC-workflows-mode skill must reconcile.
- **Severity: MEDIUM | Risk:** Multica-plan-test-cycles just merged 2026-05-28 (PR #234). | Evidence: git log 432bad2 | Implication: Multica-as-substrate work continues to invest in `/plan`+`/test` Multica wiring. Demoting Multica to second-party while a fresh merge expands its surface creates churn. Disposition pass needed for mpt-* stories.
- **Severity: LOW | Risk:** Autopilots not yet materialized (no `autopilots.yaml`). | Evidence: `find .pHive/multica/` returns skills-export, agents, squads only | Implication: second-party autopilot retention is theoretical — no shipped autopilots to preserve.
- **Severity: LOW | Risk:** README hero is "Composable substrate" + Quick Start step 1 is `/hive:multica-init`. | Evidence: README:1-20 | Implication: rebase changes the canonical bootstrap path; README rewrite is part of epic scope.

---

## UTILITIES_AVAILABLE

- **Utility:** TaskTrackingDispatch | File: `hive/lib/task-tracking-dispatch/index.ts` | Relevance: already vendor-neutral, used by /plan Phase D + /execute status updates. Reusable as-is for CC-workflows-first-party path.
- **Utility:** serializeStoryBrief | File: `hive/lib/multica-story-dispatch/index.mjs` | Relevance: integration-branch contract section + per-persona codex instruction conditional. CC-workflows-runtime needs equivalent prompt-augmentation hook.
- **Utility:** execute-dispatch atom | File: `skills/hive/skills/execute-dispatch/SKILL.md` | Relevance: single point to extend `mode_decision` enum. All upstream `/execute` callers already route through this.
- **Utility:** Atomic execute-mode skill template | File: `skills/hive/skills/execute-mode-{multica,sandcastle,session,team-cmux}/SKILL.md` | Relevance: 4 worked examples of the invocation contract + step 0 gate + episode marker contract.
- **Utility:** PreShutdown / respawn protocols | File: `hive/references/pre-shutdown-protocol.md`, `skills/hive/skills/respawn/SKILL.md` | Relevance: session-mode SKILL.md notes it "**replaces** the respawn skill for its stories" — CC-workflows mode likely follows the same exclusivity pattern.
- **Utility:** scope-drift emit | File: `hive/lib/scope_drift.py` + memory `[feedback_scope_drift_emit_sites](scope_drift_emit_sites.md)` | Relevance: 3 emit sites only (`plan:phase-c`, `execute:story`, `review:complete`). CC-workflows mode must not re-add per-phase emits.
- **Utility:** multica-issue-closer | File: `hive/lib/multica-issue-closer.mjs` | Relevance: second-party Multica path retains this. First-party path needs no equivalent — CC workflows owns its own lifecycle.

---

## EXTERNAL_REFERENCES

- **Source:** Anthropic CC CHANGELOG 2.1.154 entry on `/workflows` | Relevance: only authoritative spec for dynamic workflows | Key takeaway: "ask Claude to create a workflow and it orchestrates work across tens to hundreds of agents in the background"; user-visible surface is `/workflows` to view runs. **The "ask Claude to create a workflow" framing implies natural-language workflow synthesis, not pre-authored workflow YAML; this is structurally different from Hive's `hive/workflows/*.workflow.yaml` static definitions.**
- **Source:** Anthropic CC docs `/websites/code_claude` on `/batch` | Relevance: nearest verifiable analog for native multi-agent fan-out | Key takeaway: "decomposes the work into 5 to 30 independent units, spawns one background subagent per unit in an isolated git worktree, each opens a PR. Requires a git repository." Per-unit PR pattern conflicts with per-epic branch strategy.
- **Source:** Anthropic CC docs on subagents | Relevance: subagent system already supports MD+YAML frontmatter definitions with hooks. Hive personas could ship as subagent files for native CC consumption. | Key takeaway: subagent file format is `--- name/description/hooks ---` + system prompt markdown body.
- **Source:** Anthropic CC docs on `.claude/skills/` directory | Relevance: SDK loads skills from `.claude/skills/` in cwd and parent directories up to repo root | Key takeaway: PROJECT-level skill discovery exists. Whether 2.1.157 auto-loads from `.claude/skills/` for the interactive CLI (not just SDK) is the load-bearing claim that needs final confirmation.

---

## UNANSWERED_QUESTIONS

- What is the actual public/internal API surface of `/workflows` beyond the changelog 1-liner? (workflow definition syntax; agent-step mapping; how it interacts with subagents, skills, `/batch`, `/agents`)
- Does the `rescope-vs-cc-dynamic-workflows.md` memo exist somewhere outside this worktree, or is it expected output of this epic?
- Does CC 2.1.157 auto-load from `.claude/skills/`, and does that include plugin-shipped skills, or only ones placed in cwd-rooted `.claude/skills/`?
- Per-unit PR (a la `/batch`) vs per-epic PR (Hive convention) — which does `/workflows` follow, and is it configurable?
- Does `/workflows` honor a custom integrationBranch instruction in agent prompts, or does it impose its own branch model?
- Does CC `/workflows` have a webhook/autopilot equivalent, or does headless dispatch stay in Multica-second-party for the foreseeable future?
- Does CC `/workflows` allow heterogeneous-provider co-mingling (some agents on Codex, others on Claude), or does it run all agents on the user's current CC session model?

---

## INCONSISTENCY_RISK_SIGNALS

- **Signal:** vocabulary mismatch | Where: brief + repo CONTEXT.md | Detail: brief uses "CC `/workflows`" + "first-party"; CONTEXT.md and shipped code use "Workflow" to mean `hive/workflows/*.workflow.yaml` static YAML. Same word, two referents. Design discussion must disambiguate.
- **Signal:** hidden assumption | Where: brief | Detail: Brief asserts "CC `/workflows` (CC 2.1.154 GA) as native multi-agent fan-out" — Anthropic's changelog calls it "dynamic workflows" with no published API. Treating it as first-party substrate without a research spike is a load-bearing assumption.
- **Signal:** hidden assumption | Where: brief | Detail: Brief asserts "CC 2.1.157 skills auto-load from `.claude/skills`" subsumes Mode D-a. Not verified in this research run (context7 query failed mid-pass). If 2.1.157 auto-load is plugin-shipped-skill-aware (not just cwd-rooted), the claim holds; if not, Mode D-a's substrate bundling is still needed even on first-party path.
- **Signal:** unresolved tension | Where: brief vs in-flight work | Detail: Brief demotes Multica-in-Sandcastle to second-party, but PR #234 (multica-plan-test-cycles, merged yesterday 2026-05-28) just expanded Multica's surface into `/plan` and `/test --simulated-manual`. Demoting a substrate one day after merging fresh integration creates ownership ambiguity. Disposition pass must classify each mpt-* story.
- **Signal:** convention violation risk | Where: brief vs `git_flow.branch_strategy: per-epic` | Detail: If CC `/workflows` follows `/batch`'s per-unit PR pattern (likely), it conflicts with the per-epic PR convention encoded in `hive.config.yaml` and memory `[feedback_git_flow_per_epic](feedback_git_flow_per_epic.md)`. Either CC-workflows mode adapts (collapse per-unit PRs into per-epic) or the convention bends. This is a load-bearing decision.
- **Signal:** posture mismatch | Where: brief vs `[project_hive_2_0_milestone](project_hive_2_0_milestone.md)` | Detail: Hive 2.0 framing is "composable-substrate-user-directed". Adopting CC `/workflows` as the first-party substrate makes the substrate **Claude Code itself**, not "composable substrate". The composability narrative needs to absorb or reframe this — orchestrator+team-lead collapse into CC workflow harness, but Hive's value still claims "composable substrate".
- **Signal:** convention violation risk | Where: README Quick Start | Detail: README:Quick Start step 1 is `/hive:multica-init` ("Bootstrap Multica as the execution substrate"). Demoting Multica makes this onboarding step misleading. README rewrite is in scope.
- **Signal:** hidden assumption | Where: brief Section 7 "in-flight epic disposition" | Detail: Brief expects classification of every multica-substrate-deepen + multica-plan-test-cycles story as keep/park/supersede. Both epics' story-YAMLs show status `pending` while git log + PR refs show many shipped. Researcher trusted git+disk per memory; design discussion must too.

---

## VALIDATION NOTE

- **Checked:** Claude Code `/workflows` (2.1.154 GA), Claude Code skills auto-load (`.claude/skills/`), `/batch` parallel orchestration command, subagent file format, Multica REST surface (referenced via in-repo episode messages + spike docs, not freshly contacted).
- **Source:** context7 (`/anthropics/claude-code` CHANGELOG + `/websites/code_claude` docs); codebase reads
- **Confidence:** medium
- **Findings:**
  - CC 2.1.154 changelog **confirms** `/workflows` exists and is intended for "tens to hundreds of agents in the background". No further API surface available via context7.
  - CC skills `.claude/skills/` directory load **confirmed** for the Agent SDK; CLI/CC-interactive auto-load behavior for 2.1.157 NOT independently confirmed in this pass (one context7 query errored).
  - `/batch` is the nearest verifiable analog for native parallel agent fan-out; uses isolated git worktrees + per-unit PRs.
  - Subagent file format confirmed: YAML frontmatter + markdown system prompt — Hive personas are structurally compatible for native subagent shipping.

---

_End of raw findings. Downstream consumer (technical-writer) produces the formatted research brief next._
