# Test Results: kg-read-path

**Date:** 2026-04-13  
**Story:** kg-read-path  
**Tester:** tester agent  
**Verdict:** PASS (6/6)

---

## AC1: query_decisions() current-state — PASS

Inserted two triples (one active, one superseded). Query for `valid_until IS NULL`:

```
architect|decided|use-chromadb
```

Exactly one row returned. Superseded `use-sqlite` triple (valid_until set) correctly excluded.

---

## AC2: query_decisions() point-in-time (as_of='2026-04-05') — PASS

Point-in-time query filtering `valid_from <= '2026-04-05' AND (valid_until IS NULL OR valid_until > '2026-04-05')`:

```
architect|decided|use-sqlite
```

Returned the superseded triple that was valid on 2026-04-05, and correctly excluded the `use-chromadb` triple (valid_from 2026-04-10).

---

## AC3: entity on object side — PASS

Inserted `epic-001 assigned_to architect`. Current-state query:

```
architect|decided|use-chromadb
epic-001|assigned_to|architect
```

2 rows returned. Object-side lookup works correctly.

**Cleanup:** `DELETE FROM triples WHERE source_epic='test-epic'` — confirmed.

---

## AC4: agent-spawn step 5e documented — PASS

File: `skills/hive/skills/agent-spawn/SKILL.md` lines 101–111

- Step 5e exists after 5d: ✓
- References `query_decisions({subject: current_agent})`: ✓
- States "This block does NOT count against the 5-memory cap": ✓
- States "omit the block silently — do not raise an error" when kg.sqlite unavailable: ✓

---

## AC5: knowledge-graph-schema.md has both SQL variants — PASS

File: `hive/references/knowledge-graph-schema.md` lines 134–157

Section `## query_decisions() Query Logic` contains:
- Current-state query (`WHERE valid_until IS NULL`): ✓
- Point-in-time query (`valid_from <= :as_of AND (valid_until IS NULL OR valid_until > :as_of)`): ✓

---

## AC6: Silent-omit behavior documented — PASS

SKILL.md line 111 (step 5e):
> "If kg.sqlite is not found, empty, or the query returns no results: **omit the block silently — do not raise an error.**"

Explicit silent-omit documented for: not found, empty, query returns no results.

---

## Summary

| AC | Result |
|----|--------|
| AC1: current-state query | PASS |
| AC2: point-in-time query | PASS |
| AC3: object-side entity lookup | PASS |
| AC4: step 5e in SKILL.md | PASS |
| AC5: both SQL variants in schema doc | PASS |
| AC6: silent-omit documented | PASS |

**Total: 6 pass / 0 fail**
