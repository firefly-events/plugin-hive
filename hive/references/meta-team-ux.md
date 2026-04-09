# Meta Team Subjective Evaluation UX Reference

> Reference document for all user-facing Meta Team surfaces: morning summary,
> `/meta-team review` command, and `/status` integration.

## 1. Morning Summary

### Generation

Generated automatically at Phase 8 (close) of every nightly cycle. Written to:
```
state/meta-team/summary-{date}.md
```

Regenerated each cycle (not cumulative). Previous summaries are overwritten if
the same date runs twice (e.g., manual re-trigger).

### Format

```markdown
# Meta Team Cycle Summary — {date}

**Duration:** {start_time} — {end_time} ({elapsed})
**Targets analyzed:** {count} ({internal} internal, {external} external, {memory} memory)
**Proposals generated:** {count}

## Kept (Promoted)

{For each kept change:}
1. **{target file}** — {description}
   - Metrics: {metric_name} {before} → {after}
   - Commit: `{sha}`

## Discarded

{For each discarded change:}
1. **{target file}** — {description}
   - Reason: {discard reason}

## Deferred (Needs Your Review)

{For each deferred change:}
1. **{target file}** — {description}
   - Rationale: {architect's rationale}
   - Tester: {structural ✓/✗, heuristic flags}
   - Reviewer: "{deferral reason}"
   - **Run `/meta-team review` to approve or reject**

## Queue Status

- Pending targets: {queue depth}
- Next cycle: {next cron time}
```

### Edge Cases

- No proposals generated: "No proposals this cycle — analysis identified {N} targets for future cycles."
- All discarded: "All proposals discarded this cycle." with reasons listed
- No deferred: omit the Deferred section entirely
- Baseline cycle (S3): "Baseline cycle complete. {N} targets identified. Zero modifications."

## 2. `/meta-team review` Command

### Trigger

User invokes `/meta-team review` during an interactive session.

### Behavior

1. **Read deferred changes** from queue.yaml (status: `needs-user-review`)
2. **If no deferred changes:** display "No deferred changes pending review." and exit
3. **For each deferred change, display:**
   - Target file and change description
   - Diff from patch file (`state/meta-team/deferred/{id}.patch`)
   - Architect's rationale (available for user review, unlike the reviewer)
   - Tester's metrics and notes
   - Reviewer's deferral reason
4. **Prompt for user verdict per change:**
   - **approve** — promote the change
   - **reject** — discard the change
   - **skip** — leave for later

### Approve Flow

When the user approves a deferred change:

1. Read patch from `state/meta-team/deferred/{id}.patch`
2. Create fresh worktree: `git worktree add .claude/worktrees/meta-team-{id} -b meta-team/sandbox-{id}`
3. Apply patch in worktree: `git apply {patch-file}`
4. If patch applies cleanly:
   a. Commit in worktree
   b. Run promotion protocol (same as nightly cycle Phase 7)
   c. Cherry-pick to main: `meta-team: {description} [opt-{id}] (user-approved)`
   d. Update ledger: `verdict: keep`, `promoted: true`, `reason: "user-approved"`
   e. Remove patch file
   f. Clean up worktree and branch
5. If patch fails to apply (stale patch):
   a. Display: "Patch cannot apply cleanly — the target file has changed since this
      patch was created. You may need to apply this change manually."
   b. Show the patch content for reference
   c. Clean up worktree
   d. Leave in queue with `needs-user-review` status

### Reject Flow

When the user rejects a deferred change:

1. Update queue entry: `status: discarded`
2. Write ledger entry: `verdict: discard`, `promoted: false`, `reason: "user rejected"`
3. Remove patch file from `state/meta-team/deferred/{id}.patch`
4. Display: "Change rejected and logged."

### Skip Flow

When the user skips a deferred change:

1. No state changes — entry remains `needs-user-review`
2. Display: "Skipped — will appear in next review."

## 3. `/status` Integration

### Meta Team Section

Add the following section to the existing `/status` output when Meta Team state
files exist:

```
## Meta Team

Last cycle: {date} — {kept} kept, {discarded} discarded, {deferred} deferred
Queue: {depth} targets pending ({needs_review} awaiting your review)
Next cycle: {next_cron_time} (CronCreate durable)
Health: {health_status}
```

### Data Sources

- **Last cycle:** read from `state/meta-team/cycle-state.yaml` (cycle_id, latest ledger entries)
- **Queue depth:** count entries in `state/meta-team/queue.yaml` with status `queued` or `needs-user-review`
- **Next cycle:** parse cron expression from team config or scheduled_tasks.json
- **Health indicators:**
  - "Healthy" — no rollbacks in last 5 cycles, no stuck deferred items
  - "Attention needed" — rollback occurred in last 5 cycles (include which)
  - "Review pending" — deferred items awaiting user review > 3 cycles old
  - "Idle" — no cycles have run yet

### Conditional Display

Only show the Meta Team section if `state/meta-team/cycle-state.yaml` exists.
If the file doesn't exist, the Meta Team hasn't been set up — omit the section.

## Implementation Notes

### Skill Registration

The `/meta-team review` command should be registered as a Hive skill:

```
skills/hive/meta-team-review/SKILL.md
```

With frontmatter:
```yaml
---
name: meta-team-review
description: Review and approve/reject deferred Meta Team optimization changes.
---
```

### Status Extension

The `/status` skill should be extended to check for `state/meta-team/cycle-state.yaml`
and append the Meta Team section if present. This is a non-breaking addition —
projects without Meta Team simply don't show the section.

### Patch File Management

Patch files in `state/meta-team/deferred/` include:
- Full context diffs (not minimal diffs) for clean application
- Base commit SHA in filename or metadata for staleness detection
- Created by Phase 7 of the nightly cycle
- Consumed by `/meta-team review` approve flow
- Removed on approve or reject, retained on skip
