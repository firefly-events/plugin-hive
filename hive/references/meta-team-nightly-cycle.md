# Meta-Team Nightly Cycle — Integration Guide

The meta-team is the Hive plugin's autonomous self-improvement system. This guide explains how the nightly cycle integrates with the rest of the Hive framework, how to bootstrap it on a new installation, and how to monitor and tune it over time.

---

## What the Nightly Cycle Does

Each cycle runs eight sequential phases:

| Phase | Step | Agent | Output |
|-------|------|-------|--------|
| 1. Boot | step-01 | orchestrator | Cycle ID, prior state loaded |
| 2. Analysis | step-02 | researcher | Findings list (missing files, broken refs, schema gaps) |
| 3. Proposal | step-03 | architect | Ranked, scoped implementation proposals |
| 4. Implementation | step-04 | developer | New files, added sections, updated memories |
| 5. Testing | step-05 | tester | Cross-reference, schema, and content-safety validation |
| 6. Evaluation | step-06 | reviewer | Pass / needs-optimization / needs-revision per change |
| 7. Promotion | step-07 | orchestrator | Approved changes kept; rejected changes reverted |
| 8. Close | step-08 | orchestrator | Ledger updated, commit made, morning summary written |

---

## Bootstrapping the Meta-Team

### First run
On the first cycle, these files must exist:

1. **`.pHive/meta-team/charter.md`** — defines objectives, scope, and hard constraints. Already committed to the repo.
2. **`hive/workflows/meta-team-cycle.workflow.yaml`** — the workflow definition.
3. **`.pHive/teams/meta-team.yaml`** — the 5-agent team config.
4. **All 8 step files** in `hive/workflows/steps/meta-team-cycle/`.

The ledger (`.pHive/meta-team/ledger.yaml`) and cycle state (`.pHive/meta-team/cycle-state.yaml`) are created by the cycle itself — no manual creation needed.

### Running the cycle
Trigger via the orchestrator:
```
Run the meta-team nightly cycle.
Read: hive/workflows/meta-team-cycle.workflow.yaml
Team: .pHive/teams/meta-team.yaml
Charter: .pHive/meta-team/charter.md
```

Or schedule via a cron-style trigger (see external trigger config if available).

---

## Cycle State Files

### `.pHive/meta-team/cycle-state.yaml`

Created fresh each cycle. Contains the full running log of a single cycle:
- Phase-by-phase outputs
- All findings, proposals, changes, test results, evaluations
- Final summary after close

Use it to debug a failed cycle or review what was changed.

### `.pHive/meta-team/ledger.yaml`

Append-only record of all completed cycles. One entry per cycle:
```yaml
- cycle_id: meta-2026-04-09
  date: 2026-04-09
  verdict: passed
  changes_promoted: 3
  changes_reverted: 0
  findings_identified: 7
  top_changes:
    - hive/references/vertical-planning.md: created missing H/V planning reference
    - skills/status/SKILL.md: added meta-team morning summary section
  commit: abc1234
  notes: First cycle. Bootstrapped meta-team infrastructure.
```

Use it to track Hive improvement over time.

---

## Tuning the Cycle

### Adjusting what gets analyzed
The analysis step (step-02) performs six audit checks. To focus the cycle on specific areas:
- Edit the step file to skip checks that are not relevant
- Add custom check sections for new domains (e.g., check a new sub-directory added to the plugin)

### Adjusting proposal limits
The proposal step (step-03) caps approved proposals at 5 per cycle. To change this:
- Edit `step-03-proposal.md` and update the cap in the MANDATORY EXECUTION RULES section

### Adjusting charter scope
To allow the meta-team to modify additional domains:
- Edit `.pHive/meta-team/charter.md` → scope table
- Edit `.pHive/teams/meta-team.yaml` → member domain sections

---

## Monitoring and Alerts

### Morning review
Run `/hive:status` to see the morning summary rendered inline.

### Ledger review
Read `.pHive/meta-team/ledger.yaml` to see the history of all cycles.

### Aborted cycles
If `.pHive/meta-team/cycle-state.yaml` has `status: running` at the start of the next cycle, the prior cycle crashed. The next cycle will log it as aborted and start fresh.

---

## Bootstrapping Charter Template

If `.pHive/meta-team/charter.md` is missing, create it with these minimum fields:

```markdown
# Meta-Team Charter

## Mission
Self-optimize the Hive plugin.

## Objectives
1. Completeness — all referenced files exist
2. Consistency — schemas and terminology are uniform
3. Clarity — step files have unambiguous procedures
4. Coverage — agent memory starter set grows with each cycle
5. Tooling — skill files route correctly

## Scope
{domains the meta-team may change}

## Hard Constraints
- No destructive operations
- No >50% content removal per file
- 5-hour budget maximum
- Commit all changes with [meta-team] prefix

## Quality Bar
{pass/fail criteria per the charter template}
```

---

## Integration with the Daily Ceremony

The meta-team is independent from the daily standup ceremony. However:
- The morning summary surfaces in `/hive:status` alongside daily epic status
- Flagged-for-human items from the meta-team should be reviewed during standup
- Meta-team insights staged in `.pHive/insights/meta-team/` are evaluated by the orchestrator at session end alongside regular epic insights
