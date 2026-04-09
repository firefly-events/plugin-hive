# Step 8: Close

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Close the cycle even if most changes were reverted — partial cycles are valid outcomes
- The morning summary must be useful to a user who has not read the full cycle log
- Commit BEFORE writing the ledger entry — the ledger records what was actually committed
- If commit fails, record `status: uncommitted` in ledger with error — do NOT mark as closed

## EXECUTION PROTOCOLS

**Mode:** autonomous

Finalize the cycle: write the closed cycle-state, update the ledger, commit all changes, and produce the morning summary.

## CONTEXT BOUNDARIES

**Inputs available:**
- `cycle_id` from step 1
- `promoted_changes` and `reverted_changes` from step 7
- `state/meta-team/cycle-state.yaml` — full cycle history
- `state/meta-team/ledger.yaml` — prior cycle records
- Git (for committing changes)

**NOT available:**
- User input
- Any ability to change evaluation verdicts

## YOUR TASK

Close the cycle cleanly: update state, commit everything, update the ledger, produce the morning summary.

## TASK SEQUENCE

### 1. Finalize cycle-state.yaml
Update `state/meta-team/cycle-state.yaml` with final summary:
```yaml
status: closed
closed: {ISO 8601 timestamp}
phase: close
summary:
  total_findings: {N}
  proposals_generated: {N}
  changes_attempted: {N}
  changes_promoted: {N}
  changes_reverted: {N}
  flagged_for_human: {N}
  cycle_verdict: {passed | partial | poor}
```

### 2. Commit all changes
Commit all modified and created files under:
- `hive/`
- `skills/hive/agents/memories/`
- `state/meta-team/` (charter, cycle-state)
- `state/teams/`
- Any other files touched during the cycle

Use commit message:
```
[meta-team] Cycle {cycle_id} — {N changes}: {one-line summary of what changed}
```

Examples:
- `[meta-team] Cycle meta-2026-04-09 — 3 changes: vertical-planning.md, status skill meta section, orchestrator memory`
- `[meta-team] Cycle meta-2026-04-09 — 0 changes: analysis found 5 issues, all blocked by charter scope`

### 3. Update ledger.yaml
After the commit succeeds, append to `state/meta-team/ledger.yaml`:
```yaml
- cycle_id: {cycle_id}
  date: {YYYY-MM-DD}
  started: {ISO 8601}
  closed: {ISO 8601}
  verdict: {passed | partial | poor}
  changes_promoted: {N}
  changes_reverted: {N}
  findings_identified: {N}
  top_changes:
    - {file}: {one-line description}
  commit: {git commit hash}
  notes: |
    {Any notable context: first run, all blocked, large improvement, etc.}
```

If ledger.yaml does not exist, create it with a YAML list header.

### 4. Produce morning summary
Write the morning summary to `state/meta-team/morning-summary.md`.

Follow the format in `hive/references/meta-team-ux.md`.

Minimal format if that reference doesn't exist:
```markdown
# Hive Meta-Team — Nightly Cycle Report
**Cycle:** {cycle_id} | **Date:** {date} | **Verdict:** {verdict}

## What Changed
{Bulleted list of promoted changes with one-line descriptions}

## What Was Found (Not Fixed This Cycle)
{Bulleted list of findings that were skipped, deferred, or flagged for human}

## Metrics
- Findings: {N} | Proposals: {N} | Promoted: {N} | Reverted: {N}
- Next cycle priority: {top deferred finding}
```

### 5. Final confirmation
Verify:
- `state/meta-team/cycle-state.yaml` has `status: closed`
- `state/meta-team/ledger.yaml` has the new entry
- `state/meta-team/morning-summary.md` exists
- Git commit succeeded

## SUCCESS METRICS

- [ ] `cycle-state.yaml` status updated to `closed`
- [ ] All changed files committed with `[meta-team]` prefix
- [ ] `ledger.yaml` updated with cycle entry including commit hash
- [ ] `morning-summary.md` written per format in `meta-team-ux.md`
- [ ] No files left in uncommitted state from this cycle

## FAILURE MODES

- Git commit fails: record `status: uncommitted` in cycle-state.yaml, record error in ledger, still write morning summary
- Ledger YAML parse error: create a fresh ledger with only this cycle entry
- Morning summary not possible (no format reference): use minimal format from this step file

## CYCLE COMPLETE

This is the final step of the meta-team cycle. No next step.

**If all gating conditions met:** Cycle is fully closed. Morning summary available at `state/meta-team/morning-summary.md`.
**If commit failed:** Cycle is closed with uncommitted changes. User should review and commit manually.
