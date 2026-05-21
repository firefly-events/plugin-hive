# D.1 — handoff dispatch helper + /execute post-integrate step

**Hive story id:** `d-1-handoff-dispatch-and-execute-wire`
**Epic:** `autonomous-cycle-loop`
**Complexity:** medium
**Methodology:** classic

## Description

Build the dispatch helper and wire /execute to read terminal_handoff.next
after each story's integrate step. Targets: test, review, both, none.
Default none preserves today's behavior.

## Acceptance Criteria

- hive/lib/handoff/dispatch.mjs exports dispatchHandoff({story_id, target, branch, pr_number?}) returning {ok, verdict, evidence_ref, duration_ms} or {ok: false, reason}.
- target: 'test' invokes /test --story `<story-id>` (or scenario path if simulated-manual concern is on the story).
- target: 'review' invokes /review #`<pr_number>` when a PR exists, else /review `<branch>`.
- target: 'both' runs test first, then review with verdict from test available to review.
- target: 'none' is a no-op.
- skills/execute/SKILL.md adds a post-integrate step in the per-story loop reading story.terminal_handoff.next (or epic.execution.terminal_handoff_default).
- Handoff writes a row to cycle-state handoff_log[] regardless of verdict.
- Failed integrate (no episode marker) skips the handoff and logs why.

## Workflow Steps (classic methodology)

### research (researcher)
Identify how skills are invoked as child processes today; pick a consistent invocation surface (Skill tool vs shell vs in-process); document the choice.

### implement (developer)
Write dispatch helper; wire /execute post-integrate step; add the handoff_log[] writeback in cycle-state.

### test (tester)
Fixture story with terminal_handoff.next: test triggers /test invocation; same with review; with both runs test then review; with none nothing fires; integrate-failure skips handoff.

### review (reviewer)
Confirm helper respects the orchestrator coordination contract (it dispatches the named skill, not inlines its work); confirm handoff_log[] shape matches S0 schema.

### integrate (developer)
Commit + push.

## Key Files

- `hive/lib/handoff/dispatch.mjs` — New dispatch helper
- `skills/execute/SKILL.md` — Post-integrate step added here
- `hive/references/cycle-state-schema.md` — handoff_log[] shape (S0)

## Cross-Cutting Concerns

- **documentation**: Update execute skill markdown's "Process" section to document the new step; reference cycle-state-schema for handoff_log[] shape.

---
*Dispatched from Hive epic `autonomous-cycle-loop` via Multica execution mode. Run the full classic workflow (research → implement → test → review → integrate) inside this issue. Commit on epic branch `feat/autonomous-cycle-loop`; open a story PR when done.*