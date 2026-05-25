# Research Brief — wire /execute through Multica + Codex routing

**Date:** 2026-05-25
**Researcher:** orchestrator (audit during preceding meta-improvement-reset epic + alignment exchange)
**Scope:** Inventory the bypass surface that let /execute run 10 stories without invoking its own machinery, plus the missing wiring needed for `agent_backends`-driven Codex routing inside per-story Multica sessions.

---

## Trigger

2026-05-25 meta-improvement-reset epic shipped 10 commits but skipped:

- `execute-dispatch` skill (mode selection + telemetry)
- `execute-mode-multica` skill (per-story dispatch + poll + episode write)
- `multica-story-dispatch` lib helpers (resolveAgentUuidByName, ensureIssueBriefMatches, dispatchStoryToAgent, moveOutOfBacklogIfNeeded)
- `episode-sync.mjs` helpers (pollTaskUntilTerminal, writeMulticaRunEpisode)
- `TaskTrackingDispatch.updateStatus` (step 7b in /execute)
- `scope_drift` emit per story close
- `agent_backends` Codex routing
- Per-story phase decomposition (developer-only, no test/review dispatch)

Orchestrator hand-rolled HTTP calls + bash + python instead. Every story hit a push race or auth failure and required cherry-pick rescue from agent workdirs.

User flagged the recurring pattern: "we keep producing fixes and not really using them" → must close the gap so the substrate × plugin combination thesis actually holds.

---

## Locked architecture (alignment 2026-05-25)

- **Per-story Multica sessions** (NOT per-epic) — context budget ≤150k/story keeps inner sessions safe
- **`.pHive/` cloned with repo**, already in `.gitignore` with per-epic allowlist; inner workdir can read + write freely without git noise
- **Phase 1 Codex**: Multica developer agent runs Claude Code with codex plugin installed; inner calls `/codex:rescue` for dev work
- **Phase 2 (deferred)**: native Codex agents in Multica without Claude wrapper — out of scope this epic
- **Outer plugin-hive orchestrator** owns dispatch + `.pHive/` canonical writes via lib helpers; inner Claude Code session is the dev sandbox

---

## Concrete gap inventory (verified from current code)

### G1 — /execute routing enum missing `multica` (BLOCKER)
- **File:** `skills/hive/skills/execute/SKILL.md` step 5
- **Issue:** dispatch enum lists `sessions / team-cmux / team / sequential / sandcastle`. `mode_decision=multica` (returned by `execute-dispatch`) falls through with no route. The skill literally cannot fire today.
- **Evidence:** `execute-dispatch/SKILL.md` Step 0 + Invocation contract document `multica` as a valid `mode_decision`. `execute-mode-multica/SKILL.md` exists at `skills/hive/skills/execute-mode-multica/SKILL.md`. Only the routing case in `/execute` is missing.

### G2 — execute-mode-multica skill text stale
- **File:** `skills/hive/skills/execute-mode-multica/SKILL.md`
- **Lines 167-170:** "s4 is the DEPENDENCY of this story… temporarily, until s4 lands, this step can be a stub that logs `[multica:{story_id}] s4 episode-marker-sync not yet implemented`"
- **Reality:** `episode-sync.mjs` exists at `hive/lib/multica-story-dispatch/episode-sync.mjs` exporting `pollTaskUntilTerminal` (line 123) and `writeMulticaRunEpisode` (line 229). The skill text needs to replace the stub with the real call shape.
- **Also lines 22, 206, 209, 310:** sidecar injection deferred to v2 multi-agent contract — out of scope for this epic, retain DEFERRED status.

### G3 — dispatchStoryToAgent ignores agent_backends
- **File:** `hive/lib/multica-story-dispatch/index.mjs:211`
- **Current signature:** `dispatchStoryToAgent(serverUrl, token, workspaceId, issueUuid, agentUuid)` — caller passes a fixed UUID
- **Gap:** no resolution from role + `agent_backends[role]` to runtime-appropriate agent UUID. Need a new helper that:
  - reads `agent_backends[role]` (claude | codex)
  - lists workspace agents (existing `resolveAgentUuidByName` at line 170 caches this)
  - matches by role name + runtime affinity
  - returns the correct agent UUID
- **Naming:** `resolveAgentForRole(serverUrl, token, workspaceId, role, agentBackends)` — returns `{ agentUuid, runtime, source }`

### G4 — Codex-runtime agents not bootstrapped in Multica
- **Current Multica workspace (`plugin-hive` slug, ws `21c6d282…`):** 4 agents — spike-claude, developer, tester, reviewer, ALL on Claude runtime (`0b8e2f02`)
- **Codex runtime:** ONLINE (`66507ebe`) but zero agents
- **Gap:** `/hive:multica-init` only bootstraps Claude-runtime agents. Need extension to also create `developer-codex / tester-codex / reviewer-codex` on the Codex runtime when codex routing is configured.
- **Convention:** suffix `-codex` distinguishes runtime variants. `resolveAgentForRole` looks up `<role>-codex` when `agent_backends[role] === 'codex'`, else `<role>`.

### G5 — serializeStoryBrief missing /codex:rescue instruction
- **File:** `hive/lib/multica-story-dispatch/index.mjs:140` (serializeStoryBrief)
- **Gap:** inner Claude Code session has no signal to invoke the codex plugin. For Phase 1 routing (Multica's developer agent IS Claude Code w/ codex plugin), the brief must inject a section telling the inner session: "use `/codex:rescue` with this story spec for implementation work."
- **Conditional emission:** only inject when `agent_backends[role] === 'codex'` AND target runtime is claude (Phase 1 wrapper pattern). When target runtime is codex directly (Phase 2 future), skip this injection.

### G6 — Push race on parallel-depth dispatch
- **Observed:** depth-0 dispatched mir-1 + mir-2 + mir-4 concurrently. Agents committed locally to per-agent branches (`agent/developer/<hash>`), then pushed concurrently to `feat/<epic>`. mir-5 also pushed to same branch (race with mir-3). Second pusher wins, first commit lost silently (push rejected, agent doesn't retry, marker comment never mentions push failure for mir-2/mir-4).
- **Fix shape:** per-story ephemeral branch + `gh pr create --base feat/<epic>` + `gh pr merge --squash --auto`. Agents never touch `feat/<epic>` directly. Race goes away by construction.
- **Side benefit:** PR creates a CodeRabbit review surface per story, matching `feedback_coderabbit_stacked_pr_workflow` pattern.
- **Cost:** N+1 PRs per epic (one per story + one epic-rollup if needed). Operator tolerance noted in `feedback_pr_file_count_limit` (<150 files/PR). 8 small PRs in this epic fits easily.

### G7 — writeMulticaRunEpisode + scope_drift emit not wired
- **Files:**
  - `hive/lib/multica-story-dispatch/episode-sync.mjs:229` — `writeMulticaRunEpisode`
  - `hive/lib/scope_drift.py` — `emit_scope_drift`
- **Gap:** `execute-mode-multica` Step 3 currently hand-rolls YAML; should call `writeMulticaRunEpisode`. Per /execute "Scope-drift emit" section, one emit per story close with `phase_label='execute:story'`.

### G8 — TaskTrackingDispatch step 7b for multica adapter
- **File:** `skills/hive/skills/execute/SKILL.md` step 7b
- **Question:** when adapter is multica, does `updateStatus` round-trip make sense? Multica IS the tracker — the issue lifecycle (todo → in_progress → in_review → done) is already managed by the daemon. `updateStatus("in-progress")` from /execute would either be a no-op or a redundant write.
- **Resolution path:** verify behavior, document explicit pass-through (no-op for multica adapter since the dispatch loop owns issue state) or pass-through to the adapter implementation.

### G9 — /multica-init bootstrap surface
- **File:** `skills/hive/skills/multica-init/SKILL.md` (per skill catalog)
- **Verify on read:** what exactly does multica-init do today, what's the extension point for codex-runtime variant bootstrap.

---

## Key files + line refs

| File | Lines | Why |
|---|---|---|
| `skills/hive/skills/execute/SKILL.md` | step 5/6 enum, step 7b | G1, G8 |
| `skills/hive/skills/execute-mode-multica/SKILL.md` | 22, 167-170, 206, 209, 310 | G2 |
| `hive/lib/multica-story-dispatch/index.mjs` | 140, 170, 200, 211, 219 | G3, G5 |
| `hive/lib/multica-story-dispatch/episode-sync.mjs` | 123, 229 | G7 |
| `hive/lib/scope_drift.py` | emit_scope_drift entry | G7 |
| `skills/hive/skills/execute-dispatch/SKILL.md` | Step 0, Invocation contract | G1 context (multica already in enum here) |
| `skills/hive/skills/codex-invoke/SKILL.md` | Supported personas section | G5 context (codex routing model) |
| `skills/hive/skills/multica-init/SKILL.md` | bootstrap path | G4 |
| `hive.config.yaml` | `agent_backends:`, `execution.mode: multica` | G3 source-of-truth |

---

## context7 validation note

No third-party SDK / framework / API in scope this epic. All changes are local to plugin-hive's own skills + lib. Context7 not invoked (no library docs to validate).

Web research not escalated — gap list grounded in directly-observed code paths and a finished execution run (meta-improvement-reset 2026-05-25, branch `feat/meta-improvement-reset`, 10 commits 9e10219..81d37fc on origin).

Confidence: **high** on G1-G7. **Medium** on G8 (need to verify TaskTrackingDispatch behavior for multica adapter — may already be a no-op). **Medium** on G9 (need to read /multica-init SKILL.md to know exact extension point).

---

## Inconsistency-risk signals (for grill)

The following are areas where the design could go sideways during decomposition — flag to grill skill:

1. **Codex runtime fallback semantics**: when `agent_backends[role]=codex` but the codex agent variant is missing or offline, fall back to claude variant? Or fail-fast? Existing `codex-invoke` skill uses fallback pattern. Multica routing should align.
2. **PR-merge vs direct-push trade-off**: does per-story PR really kill the race, or just move it (squash-merge to feat/<epic> still serializes via PR queue)? Confirm `gh pr merge --auto` queue semantics.
3. **Brief mutation under codex routing**: serializeStoryBrief currently doesn't know `agent_backends`. Adding conditional `/codex:rescue` injection means brief becomes context-aware. New parameter shape needs careful design to not break callers that pass story alone.
4. **/execute step 6e route number**: step list goes 6 (team) / 6b (cmux) / 6c (sessions) / 6d (sandcastle). Adding "6e (multica)" preserves numbering but mixes alphabet with semantic — alternative is restructuring step 5 to a dispatch table. Conservative path: add 6e.
5. **Phase-decomposed methodology vs single-dispatch**: "classic" methodology prescribes research/implement/test/review/integrate per story. Each phase = separate Multica dispatch + reassignment to next role's agent. Multiplies issue activity by 5x. The current single-dispatch (developer does whole story) collapses methodology. Choose: keep collapsed (pragma), or fan out per phase (purity). Out of scope this epic per locked decisions, but flag for follow-on.
6. **Outer .pHive writes from execute-mode-multica context**: when /execute is the outer orchestrator AND the user is running it inside a Claude Code session (also "inner"), there's only one .pHive. The mental model "outer owns writes, inner only reads" needs concrete tested separation. For Phase 1 this just means: the orchestrator's writes are canonical, and the per-story inner workdir is a transient clone (lib helper already clones via `multica repo checkout`).
