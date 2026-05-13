---
name: escalation-backfill
description: Backfill escalation stories[] topic-area entries to canonical story YAML IDs after /plan story decomposition. Preserves unmatched topic areas with required warnings.
---

# Hive Escalation Backfill

Atomic skill, NOT inline `/plan` prose. It runs after canonical story YAML IDs are determined, updates escalation `stories[]` entries in cycle state, and preserves raise-time topic areas that cannot be matched. This is a sibling orchestration concern to the cross-cutting concern planning contract in `hive/references/cross-cutting-concerns.md`.

## Invocation contract

Call this skill once per `/plan` story decomposition, after canonical story YAML IDs are finalized and before requirements traceability continues.

**Inputs:** `epic_id`, `story_ids[]` (decomposed canonical story YAML IDs), and `cycle_state_path` (default `.pHive/cycle-state/{epic_id}.yaml`).

**Outputs:** updated cycle state file and warnings logged for unmatched topic areas.

**Side effects:** reads and writes `cycle_state_path`; updates only `escalations[].stories[]` entries; emits a warning for each topic area string that cannot be matched to a canonical story ID.

## Process

### Step 1: Load Escalations

Open `cycle_state_path`, defaulting to `.pHive/cycle-state/{epic_id}.yaml`. Iterate every entry in `escalations:`.

### Step 2: Match Stories Entries

For each escalation entry, inspect its `stories` list. Entries may contain topic area strings from raise time.

For each topic area string, attempt a match against decomposed story IDs:
- **Exact match:** topic area string equals a story ID → replace in place
- **Fuzzy match:** topic area string overlaps with a story's `title` or `description` keywords (case-insensitive substring match) → replace with the matched canonical ID
- **Already canonical:** if an entry already matches a story YAML ID exactly, leave it unchanged (no re-matching needed)

Entries whose `stories` list is already canonical IDs (from a prior run or manual edit) require no change.

### Step 3: Write Back

After replacement, write the updated `stories` list back to the escalation entry in cycle state.

For any topic area with **no match found:** preserve the original string as-is and log:

```text
WARNING: escalation "{trigger}" stories[] entry "{topic-area}" could not be matched to a canonical story ID — leaving as topic area string
```

> **Two-phase population pattern:** `escalations[].stories[]` is populated in two phases: (1) topic areas at raise time by the raising agent, (2) canonical IDs at plan step 11 by orchestrator backfill. Execute reads the backfilled canonical IDs.
