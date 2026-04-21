---
title: Phase A Researcher Raw Findings — meta-improvement-system
author: researcher (claude-sonnet)
date: 2026-04-19
status: raw findings (pre-brief, pre-architect review)
---

# Phase A Research Raw Findings

## Q1: Current meta-team wiring inventory

### Workflow files
- `hive/workflows/meta-team-cycle.workflow.yaml` — 8-step nightly cycle; agents: orchestrator (boot/close), researcher (analysis), architect (proposal), developer (implementation), tester (testing), reviewer (evaluation/promotion). WORKS.
- `hive/workflows/steps/meta-team-cycle/step-01-boot.md` — reads charter + ledger, checks incomplete cycles, inits cycle-state. WORKS.
- `hive/workflows/steps/meta-team-cycle/step-02-analysis.md` — 6 audit tasks; reads git history + files; NO metrics reading. WORKS (structurally).
- step-03-proposal.md — ranked proposals from findings. WORKS.
- step-04-implementation.md — implements via sandbox pipeline; records change_id. WORKS.
- step-05-testing.md — integrity/schema/content-safety/path validity checks against sandbox copies. WORKS.
- step-06-evaluation.md — qualitative charter quality bar verdict (pass/needs_revision/needs_optimization). **No numeric metrics.**
- step-07-promotion.md — promotes passing, reverts needs_revision, generates insights. WORKS.
- step-08-close.md — writes ledger, commits with [meta-team] prefix, closes cycle. WORKS.

### Daily ceremony integration
- `hive/workflows/steps/daily-ceremony/step-01-load-state.md:task-0` — pulls overnight meta-team commits via git fetch; counts `[meta-team]` prefix; surfaces in standup. WORKS assuming remote set.
- `hive/workflows/steps/daily-ceremony/step-03-present-standup.md` — displays meta_team_commits from step-01. WORKS.

### Reference files (all under `hive/references/`)
- `meta-team-nightly-cycle.md` — integration guide, bootstrapping, cycle state docs. WORKS.
- `meta-team-sandbox.md` — file-copy sandbox: copy → write → validate → promote/discard. WORKS.
- `meta-team-ux.md` — morning summary format, status skill integration. WORKS.
- `meta-team-memory-targeting.md` — agent memory gap identification, starter memory criteria. WORKS.
- `meta-team-external-research.md` — external research loop, research-notes path. WORKS.

### State directories
- `.pHive/meta-team/` exists; contains `charter.md`, `cycle-state.yaml`, `ledger.yaml`, `queue.yaml` — all present.
- `.pHive/meta-team/charter.md` — mission, objectives (completeness > consistency > clarity > coverage > tooling), scope table, hard constraints, quality bar. WORKS.
- `.pHive/meta-team/cycle-state.yaml` — complete multi-phase ledger of cycles meta-2026-04-09 → meta-2026-04-13. POPULATED AND VALID.
- `.pHive/meta-team/ledger.yaml` — append-only; 5 cycles recorded; last commit `1ed945ef`. Paths reference `hive/`, `skills/hive/agents/memories/` — all valid.
- `.pHive/meta-team/queue.yaml` — 3 targets, all `status: completed`. Queue is clear.

### Config fields
- `hive/hive.config.yaml` `meta_team:` block: only `github_forwarding: false`. No schedule, no enabled flag, no metrics config.

### Hooks
- `.claude-plugin/plugin.json` — no hooks registered.
- `~/.claude/settings.json` — Stop hook + firecrawl PostToolUse hook; neither writes metrics/episode records.
- **FINDING: no instrumentation hooks anywhere. Meta-team cycle has no hook-based triggers.**

### Skill files
- `skills/status/SKILL.md` §8 references meta-team morning summary. WORKS.
- **No `meta-optimize` or `meta-meta-optimize` skills exist.**

### Hardcoded paths / post-transfer check
- `grep -r 'hom-hq'` = ZERO results.
- `grep -r 'firefly-events'` = ZERO results in hive/ and skills/.
- **The suspected repo-transfer path breakage is a FALSE ALARM. All cross-references are relative. Cycle has run 5 times successfully.**

**SALVAGE VERDICT (researcher):** Meta-team nightly cycle is salvageable. 8-step workflow complete and exercising successfully. Gaps: (a) no objective metrics, (b) no experiment/baseline/measure loop, (c) evaluation is qualitative-only.

---

## Q2: Existing metrics/instrumentation surface

### Episode markers
Schema fields (`episode-schema.md`): step_id, status (completed/failed/escalated), timestamp (ISO 8601), artifacts (list).
**EXPLICIT EXCLUSIONS:** "Token usage or duration — operational metrics belong in logging, not state files." "Story/epic IDs — derivable from file path."

Observed actual YAML (from `.pHive/episodes/ui-designer-step-files/`): varies between files — some 4 schema fields, others 8+ including conclusions, decisions_made, context_for_next_phase. **No record has token/cost/wall-clock/fix_loop fields.** Schema explicitly excludes them.

### Cycle state
Required: epic_id, created, updated, decisions (phase/key/value/rationale/timestamp).
Optional: product_name, constraints, naming, scope_boundaries, technology, linear (ticket IDs), escalations.
**No timing, token, cost, or quality score fields.** Cycle state is coordination, not metrics.

### Circuit breakers (closest to instrumentation config)
step_timeout_minutes: 10, fix_loop_timeout_minutes: 20, story_timeout_minutes: 45, ceremony_timeout_hours: 4, max_step_retries: 2, max_fix_iterations: 3, max_same_error_repeats: 3.
**These are LIMITS, not measurements.**

### Insight staging
Fields: agent, type (pattern/pitfall/override/codebase/reference), summary, detail, scope, related_files.
**No cost/token/timing in insights.** Qualitative behavioral observations only.

### PR #7 metric-relevant changes
- `respawn`: mentioned in spawn report — "Respawn: yes (iter N of 3) | no"
- `permission_mode`: resolved per spawn (auto in worktree, default outside)
- **No token/cost fields added. No metric collection in agent-spawn skill.**

### GAP ANALYSIS (brief's metrics list vs current state)

| Metric Category | Brief Wants | Currently Exists | Gap |
|---|---|---|---|
| Cost: tokens per story | input/output/cache by agent | NOTHING | Full gap |
| Cost: $$ per story | cost_usd | NOTHING | Full gap |
| Cost: cache hit rate | cache_hits/total | NOTHING | Full gap |
| Quality: first-attempt pass rate | no-fix-loop count | episode status exists, not aggregated | Partial |
| Quality: fix-loop iterations | count/story | max_fix_iterations limit only | Full gap |
| Quality: respawn rate | count/agent | reported but not persisted | Full gap |
| Quality: test pass rate (first commit) | pass/fail | episode status per step, no first-commit flag | Partial |
| Quality: CodeRabbit fixes/PR | count | NOTHING | Full gap |
| Speed: wall-clock/phase | sec/step/story | NOTHING persisted | Full gap |
| Speed: step timeout hits | count | breaker limit, no counter | Full gap |
| Speed: gate pass rate | per gate type | NOTHING | Full gap |
| Friction: human escalations | count/epic | NOTHING | Full gap |
| Friction: permission prompts | count/story | NOTHING (PR #7 reduced, didn't count) | Full gap |
| Friction: clarification Qs | count | NOTHING | Full gap |
| Friction: manual overrides | count | NOTHING | Full gap |
| Reuse: memory wiki hit rate | hits/session | NOTHING | Full gap |
| Reuse: skill invocation coverage | declared vs fired | NOTHING | Full gap |
| Reuse: trust score trajectory | per agent-pair | NOTHING | Full gap |

**Summary: only first-attempt pass rate and test pass rate have partial data. All cost/speed/friction/reuse = complete gaps.**

---

## Q3: Baseline for Karpathy auto-improvement loop

### Hypothesis-like structures
- **Existing analog:** `.pHive/meta-team/queue.yaml` — each entry IS a hypothesis (target, type, description, source_evidence, priority_score, attempted_count, completion_note, status). Could be extended with baseline_metric, target_delta, result_metric.
- **Cycle-state.yaml:** `decisions` list could log baseline measurements at experiment start. Could add a `baseline` decision type.
- **Story spec YAML:** `design_decisions` field could accommodate hypothesis, but story-scoped not meta-scoped.

**Most natural extension:** queue.yaml → experiment record. Alternative: new `.pHive/meta-team/experiments/{exp-id}.yaml`.

### Experiments in isolation
- **Worktrees fully supported:** `EnterWorktree` tool creates at `.claude/worktrees/`; each story gets own branch in parallel execution. `codex-invoke` auto-detects worktree (full-auto inside, read-only outside).
- **Current sandbox:** file-copy only (`.pHive/meta-team/sandbox/{cycle-id}/{change-id}/`). Appropriate for docs/skills/YAMLs. **Not worktree-based.** For multi-file code changes, worktrees would be needed — infrastructure exists (`sandboxing-patterns.md`) but NOT wired into meta-team cycle.
- **Feature flags / toggles:** none. Only toggles are config fields (`parallel_teams`, `collaborative_review`). Could serve as experiment toggles if a meta swarm wrote/reverted config values.

### Baseline capture
- **No baseline persistence mechanism exists.** Ledger tracks `changes_promoted`/`changes_reverted` counts — counts, not measurements.
- **What's needed:** baseline snapshot = metrics query result at time T. Requires Epic C metrics JSONL first.
- **Natural anchor:** step-01-boot already reads prior ledger state. Extending boot to snapshot current metrics (e.g., last 10 story records) into cycle-state.yaml under `metrics_baseline` gives each cycle a before-state.

### A/B prior art
**None.** No A/B patterns, feature flags, or skill toggles. Closest is `collaborative_review` binary disable — not A/B comparison.

Insight pipeline (stage → evaluate → promote/discard) is structurally right pattern — already a keep/discard loop. Gap: operates on qualitative observations, not numeric measurements. Adding numeric measurement layer to evaluation step is the bridge.

---

## CONSTRAINTS
- `paths.state_dir` resolver NOT in scope — all paths use `.pHive/`. No `hom-hq` paths, no broken absolute refs.
- Nightly cycle schedule not in repo. Presumably Claude Code scheduled trigger (CronCreate) or external cron — not inspectable.
- **Token counts:** Claude Code SDK does not surface per-Agent-invocation token usage via TeamCreate tool results. **#1 instrumentation risk.**

## UNANSWERED QUESTIONS
- Where is the nightly cycle actually scheduled? Not in hive.config.yaml, plugin.json, or settings.json hooks.
- Does step-02-analysis read git history directly (bash git log) or only via ledger?
- Are there any `.pHive/meta-team/research-notes/` files?

## VALIDATION
- Scope: plugin-hive internals only
- context7: not triggered (no library API uncertainty)
- Confidence: high
