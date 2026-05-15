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

### Step 4: Emit `phase_blocked` KG triples (S2.1 seam 2 — TPM escalation-raise)

After Step 3's write-back lands, emit one `phase_blocked` KG triple per `(escalation, canonical-story-id)` pair so the priority predicate surfaces TPM-raised blockers to /meta-optimize. Skip topic-area entries that did NOT match a canonical ID — those already have a WARNING from Step 3.

For each canonical story ID in `escalations[].stories[]`, invoke the CLI emitter (silent no-op when the `kg.emit_lifecycle_at` knob is `off` or `kg.sqlite` is missing — safe under `set -e`):

```bash
python3 -m hive.lib.kg_emit_cli \
  --subject "{canonical-story-id}" \
  --predicate "phase_blocked" \
  --object "escalation:{trigger-id}" \
  --source-epic "{epic_id}" \
  --source-agent "tpm"
```

The CLI runs `sanitize_obj` on `--object` by default; pass `--no-sanitize` only if you already kebab-normalized the trigger ID. Emit failures must NOT abort backfill — the emitter swallows internally and the surrounding skill MUST NOT add error handling around the call.
