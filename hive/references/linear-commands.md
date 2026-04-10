# Linear Commands Quick Reference

Copy-paste commands for each ceremony phase. Values come from `hive.config.yaml` → `task_tracking`:
- `{TEAM}` = `linear_team` (e.g., "ACME")
- `{PROJECT}` = `linear_project` (e.g., "my-project")
- `{PREFIX}` = `branch_prefix` (e.g., "hom")
- `{USER_ID}` = `linear_user_id`

## Standup — Query Board

```bash
# All issues
linearis issues search "" --project "{PROJECT}" --team {TEAM} --limit 50

# Blockers only
linearis issues search "label:human-intervention" --team {TEAM} --status "Todo,In Progress" --limit 20

# Single issue details
linearis issues read {TEAM}-{N}
```

## Planning — Create Tickets

```bash
# Epic parent
linearis issues create "Epic: {epic-id} — {title}" \
  --team {TEAM} --project "{PROJECT}" --labels "epic-parent" \
  -d "{description}"

# Story sub-issue
linearis issues create "{story title}" \
  --team {TEAM} --project "{PROJECT}" --labels "story" \
  --parent-ticket {TEAM}-{epic-N} --status "Todo" \
  -d "{description}"
```

## Execution — Claim & Branch

```bash
# Check lock
linearis issues read {TEAM}-{N}
# → if assignee is null, safe to claim

# Claim (assign + In Progress)
linearis issues update {TEAM}-{N} --status "In Progress" \
  --assignee {USER_ID}

# Create branch
git checkout -b {PREFIX}-{N}-{slug}
```

## Commit — Reference Ticket

```bash
git commit -m "feat: {description}

Refs: {TEAM}-{N}"
```

## Test Handoff — Move to Review

```bash
linearis issues update {TEAM}-{N} --status "In Review"
```

## Fix Loop — Bugs

```bash
# Create bug sub-issue
linearis issues create "Bug: {title}" \
  --team {TEAM} --project "{PROJECT}" --labels "bug" \
  --parent-ticket {TEAM}-{story-N} --priority {1-4} \
  --status "In Progress" \
  -d "{expected vs actual, hypothesis}"

# Close fixed bug
linearis issues update {TEAM}-{bug-N} --status "Done"

# Escalate terminal issue
linearis issues update {TEAM}-{N} --labels "bug,human-intervention" --priority 1
linearis comments create {TEAM}-{N} --body "BLOCKED: {context}"
```

## Push — Auto-Link

```bash
git push -u origin {PREFIX}-{N}-{slug}
# Linear auto-links PR via branch name — no linearis command needed
# Merge auto-closes the ticket
```

## Session End — Release

```bash
# Release completed tickets
linearis issues update {TEAM}-{N} --assignee ""

# Check for anomalies (still In Progress)
linearis issues search "" --project "{PROJECT}" --team {TEAM} --status "In Progress"

# Add resolution comment
linearis comments create {TEAM}-{N} --body "{resolution notes}"
```
