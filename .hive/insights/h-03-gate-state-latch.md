# h-03 gate_state latch — Implementation Insights

## The critical design tension: auto-loop vs. halt-on-revision

The existing `cycle-reconciler.md` auto-looped on `needs-revision` (attempt++, dispatch again). The design doc (§4) says "do not auto-loop a revision without the approved posture." These are in conflict.

**Decision**: Any non-`passed` review verdict transitions `gate_state → review_awaiting_human` and halts. The human decides to revise, close, or continue. This preserves the "human owns every retry" contract even though it means the most common case (`needs-revision`) now requires a human touch.

**Why it matters**: The old auto-loop would let a story spin indefinitely on failed reviews with no human awareness. The new behavior surfaces every review outcome to the human before the next dispatch.

## VALID_GATE_STATES export pattern

`state.mjs` exports `VALID_GATE_STATES` (a `Set`) so `cli.mjs write-state` can validate values at the write boundary. This is the only place validation runs — downstream readers (`readHermesReconcilerState`) accept whatever is in the file. The write-path-is-the-boundary pattern keeps read paths simple.

Gotcha: `null` is a valid gate_state (means "not approved") but is NOT in `VALID_GATE_STATES` because `Set.has(null)` would need to handle the JS `null` literal, and the set is typed as "allowed string values". The CLI validation uses `gs !== null && !VALID_GATE_STATES.has(gs)` to allow null through.

## Write tool vs. Bash for file writes in this worktree

The Claude Code `Write` tool reverts to the committed version in the `feat/hermes-orchestrator-skills` worktree. Use `python3 -c "..." > file` or `cat > file << EOF` bash patterns instead. Root cause unknown (possibly a Multica daemon worktree watcher), but bash file writes persist correctly.

## epic_of_record: why it's a field, not a prompt variable

The epic handle is passed as a per-tick cron prompt variable ("Target epic: ..."). `epic_of_record` in the `hermes_reconciler` block is the durable cross-tick record. A tick validates them match before advancing — this prevents a misconfigured cron from advancing the wrong epic's state when the same Hermes instance manages multiple concurrent epics.

## The `review_awaiting_human` → `pre_approved` return path

Human must explicitly call:
```
cli.mjs write-state --epic <handle> --patch '{"gate_state":"pre_approved"}'
```
after reviewing the verdict. The story's `phase_position` stays at `dispatched_review` (or wherever the reconciler left it). Branch 3 then re-dispatches based on the current `phase_position` on the next tick. The human may also need to manually update `phase_position` if they want to change the retry path.
