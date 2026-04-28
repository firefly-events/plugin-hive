# Optimize Step Output — chromadb-integration

## Summary

Two documentation ambiguities in `skills/hive/skills/agent-spawn/SKILL.md` (section `5c-L3`) were resolved with surgical edits.

## Changes Made

### Finding 1 — Normalization formula clarified

Added clarifying sentence after the ranking formula specifying the correct cosine distance normalization:

**Added:**
```
where `relevance_score = 1 - distance` for cosine distance (ChromaDB default) — higher score = more relevant.
```

### Finding 2 — Override/pitfall cap immunity made unambiguous

**Replaced:**
```
- **Always include** all `override` and `pitfall` type memories regardless of score
```
**With:**
```
- **Step A — Always include** all `override` and `pitfall` type memories unconditionally. These are immune to the 5-memory cap.
```

**Replaced:**
```
- Cap final set at **5 total memories** (override/pitfall slots count toward the cap)
```
**With:**
```
- **Step C — Cap** the remaining (non-override/pitfall) memories at `max(0, 5 - override_pitfall_count)`. Total Prior Knowledge set size is `override_pitfall_count + remaining_cap`, which may exceed 5 when many overrides/pitfalls exist — this is intentional.
```

## Artifacts Modified

- `skills/hive/skills/agent-spawn/SKILL.md` — section `5c-L3`
