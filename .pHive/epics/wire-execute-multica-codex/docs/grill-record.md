# Grill Record — wire-execute-multica-codex

**Source draft:** `.pHive/epics/wire-execute-multica-codex/docs/design-discussion.md`
**CONTEXT.md substrate:** present
**inconsistency_risk_signals:** present (research-brief §6)
**Generated:** 2026-05-25T17:00:00Z

## Summary

- Vocabulary mismatches: 1 finding
- Hidden assumptions: 4 findings
- Unresolved tensions: 1 finding
- Convention violations: 1 finding
- Posture mismatches: 1 finding (the central one — Phase 1 vs Phase 2 conflation)

## Vocabulary mismatches

- **V1** — "Codex routing" is used with two incompatible meanings in the draft.
  - Draft location: §1 ("inner calls `/codex:rescue` for dev work") vs §3 ("bootstrap a `<role>-codex` agent on the Codex runtime" + "`resolveAgentForRole` calls `resolveAgentUuidByName(<role>-codex)`")
  - Reference: `.pHive/CONTEXT.md` defines **Backend** as "Either direct (Claude via TeamCreate) or `codex` (codex-rescue subagent). Routing controlled by `agent_backends` in root `hive.config.yaml`." — the codex backend IS the codex-rescue subagent pattern, NOT a separate Multica-side runtime agent.
  - Question for planner: When `agent_backends[role] = codex` under Phase 1, does that mean (a) assign the existing Claude-runtime `<role>` agent and inject `/codex:rescue` into the brief, OR (b) assign a separate `<role>-codex` agent that bypasses the Claude wrapper? Picking (a) collapses stories s2/s3/s4 substantially. Picking (b) makes Phase 1 indistinguishable from Phase 2 and contradicts the locked decision.

## Hidden assumptions

- **H1** — Draft assumes `gh pr merge --auto` queues PRs serially and waits for required checks without re-pushing on conflict.
  - Draft location: §3 line "auto-merge queues PRs serially against the epic branch; race becomes impossible"
  - Why this matters: if the queue collapses to a fast-merge (no required checks because epic branch has no protection), two PRs can still race at merge time. If required checks ARE configured, story PRs may queue for tens of minutes and effective throughput collapses (which §4 H1 already flags as a high risk — but the proposed approach in §3 doesn't yet have a fallback).
  - Question for planner: what's the branch-protection posture on `feat/<epic>` branches today? If unprotected, does auto-merge still queue? If protected, what's the CI cost per story?

- **H2** — Draft assumes inner Claude Code spawned by Multica has the codex plugin loaded.
  - Draft location: §4 medium risk "Inner Claude Code session may not have codex plugin loaded — assumed because plugin-hive workdir IS the cwd"
  - Why this matters: if codex plugin loads from the user's Claude Code config rather than the project workdir, Multica-spawned Claude Code may have a totally different plugin set than the orchestrator. The whole Phase 1 hinges on `/codex:rescue` being available inside.
  - Question for planner: should s8 smoke test gate on a `Skill` tool listing inside the inner session to confirm `codex:rescue` is present? Or add a pre-flight check earlier (s4 execute-mode-multica Step 0 precondition gate)?

- **H3** — Draft assumes Multica's agent-create API supports runtime selection at agent-create time.
  - Draft location: §4 high risk #2 "Codex-runtime agent bootstrapping may need Multica-side schema changes"
  - Why this matters: if runtime is daemon-level config, you can't have per-agent runtime variants. Then the whole `<role>-codex` naming convention is unworkable.
  - Question for planner: should s2 start with a 30-min spike against Multica's `/api/agents` POST to confirm runtime selection is possible BEFORE committing the rest of the chain? Add a story s0 = "spike: verify Multica agent runtime selection"?

- **H4** — Draft assumes `<role>-codex` is a viable agent name convention.
  - Draft location: §3 line "Convention: suffix `-codex` distinguishes runtime variants"
  - Why this matters: Multica may enforce unique agent names per workspace, or impose name-format rules. The convention has not been validated.
  - Question for planner: confirm name convention against Multica's agent-create constraints in the same spike that resolves H3.

## Unresolved tensions

- **U1** — §3 proposes per-story PR (kills race by construction) but §4 high-risk-#1 says the PR queue may collapse throughput. The draft surfaces both but doesn't pick a decision rule.
  - Draft location: §3 line "auto-merge queues PRs serially" vs §4 H1 "PR-merge serialization may queue too aggressively"
  - Tension: the fix for race is to add serialization; but more serialization is the cost. Without a decision rule, s5 could ship the PR-merge path, the first real epic to use it hits the CI queue, and we revert.
  - Question for planner: define an opt-out knob upfront (e.g., `execution.multica.merge_strategy: pr-auto|direct-push|orchestrator-cherrypick`) and let s5 land all three, with `pr-auto` as default? Or commit to `pr-auto` and treat the throughput risk as a fast-follow if it materializes?

## Convention violations

- **C1** — Draft's G6 fix (per-story ephemeral branch + per-story PR) contradicts `feedback_git_flow_per_epic` ("One branch per epic, one commit per story; per-story branches fragment review").
  - Draft location: §3 line "create branch `agent/{story-id}/{short-hash}`, commit, push, run `gh pr create`"
  - Convention: `~/.claude/projects/-Users-don-Documents-plugin-hive/memory/feedback_git_flow_per_epic.md` — "branch is `feat/<epic-id>`; each story is one commit on it; per-story branches fragment review"
  - Question for planner: is this an explicit deviation (PR-per-story is the cost we accept for race elimination) or an alignment (find a race fix that preserves one-commit-per-story-on-epic-branch — e.g., orchestrator-side serial cherry-pick promoted from bandage to canonical)? The draft §6 Q1 frames the alternative as inferior, but the convention memo is explicit and well-aged.

## Posture mismatches

- **P1** — **Central finding.** Stories s2 ("bootstrap `<role>-codex` agents on Codex runtime"), s3 ("`resolveAgentForRole` looks up `<role>-codex`"), and s4 ("route Codex via agent-variant pickup") all implement what the draft explicitly labels Phase 2 ("native Codex agents in Multica without Claude wrapper — out of scope this epic"). Yet they're packaged as Phase 1 stories.
  - Draft location: §1 + §3 stories s2/s3/s4 vs §1 "Phase 2 (deferred): native Codex agents in Multica without Claude wrapper — out of scope this epic"
  - Posture reference: locked decision exchange 2026-05-25 — user explicitly chose "Phase 1: Multica's developer agent runs Claude Code with codex plugin, calls `/codex:rescue` for dev work" and said Phase 2 is "a lot of work, I think, as of right now to do"
  - Question for planner: under Phase 1, what does `agent_backends[role] = codex` actually mean? If it means "use the existing Claude-runtime agent, inject `/codex:rescue` into the brief," then the work shape simplifies to s1 (routing) + s5 (race fix) + s6 (brief injection) + s7 (telemetry wiring) + s8 (smoke test) — 5 stories not 8. Stories s2/s3/s4 become a follow-on epic for Phase 2. Confirm or reject this collapse before story decomposition.

## Notes

- The draft is internally consistent if `agent_backends[role] = codex` means "swap the agent to a Codex-runtime variant." But that semantic IS Phase 2.
- The draft is also internally consistent if `agent_backends[role] = codex` means "instruct the inner Claude Code to use `/codex:rescue` for code work." But under that semantic, s2/s3/s4 are not needed for Phase 1.
- The author appears to have inherited the s2/s3/s4 shape from a half-built mental model of how routing "should" eventually look, without re-deriving the work from Phase 1's actual requirements. This is exactly the failure mode CONTEXT.md's "composable substrate, user-directed" posture is meant to guard against — don't pre-build Phase 2 substrate as a side effect of Phase 1 wiring.
- One downstream consequence: if P1 is resolved by collapsing to 5 stories, the epic ships faster, the cherry-pick rescue pattern dies sooner, and Phase 2 becomes a clean later choice instead of a half-built dependency.

## Out of scope (this pass)

Grill does not propose solutions, score quality, or gate work. The 8 findings above each end with an explicit question. Resolution belongs to the planner (via design-discussion revision or accepted-deviation annotation) before story decomposition begins.
