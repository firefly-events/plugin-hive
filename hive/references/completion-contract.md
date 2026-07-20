# Completion Contract (tmux / `Agent(name:)` dispatch)

Canonical source for the `SubagentStop` completion-marker instruction.
`hooks/notify-agent-complete.sh` is the only hook bound to `SubagentStop`, and
it derives its verdict solely from a self-written
`<cwd>/.hive-task-status.json` marker (no exit-status field exists in the
payload). Every prompt-assembly path that dispatches work over the
`Agent(name:)` tmux backend — whether a solo spawn or a named-teammate spawn
inside a team description — MUST append this block, verbatim, as part of the
assembled prompt, or the dispatched agent has no way to record a verdict and
`notify-agent-complete.sh` defaults to `failure`.

**Consumers (keep byte-identical to the block below — drift between copies
silently reintroduces the wr-5 signal-poisoning gap in whichever copy falls
out of sync):**
- `skills/hive/skills/agent-spawn/SKILL.md` §7.2 (solo `Agent(name:)` spawn)
- `skills/execute/references/team-execution.md` (team-execution per-story
  teammate prompt template)

Not required on the cmux path (no `SubagentStop` binding; completion is
detected via the `[STORY-COMPLETE:{story-id}]` scrollback marker instead) or
for Bash `run_in_background` dispatch (no completion hook exists for that
path at all — carve-out, not fixed).

```
## Completion Contract
Before you finish, as your LAST action, run exactly one of:
  bash "${CLAUDE_PLUGIN_ROOT}/hooks/write-task-status.sh" success
  bash "${CLAUDE_PLUGIN_ROOT}/hooks/write-task-status.sh" failure
Use "success" only if every acceptance criterion for this task was met and
all required tests pass. Use "failure" otherwise. A missing marker is always
read downstream as failure, never success — so skipping this step silently
fails the story even if your work was correct.
```
