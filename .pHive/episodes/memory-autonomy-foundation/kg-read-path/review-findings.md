# Review Findings: kg-read-path

**Verdict: passed**

---

## knowledge-graph-schema.md — query_decisions() section

### 1. Point-in-time SQL — CORRECT
`valid_from <= :as_of AND (valid_until IS NULL OR valid_until > :as_of)` correctly captures all triples that had started by the reference time and had not yet been superseded. A triple with `valid_until IS NULL` (still current) is also correctly included as valid at any past `as_of` value.

### 2. Current-state SQL — CORRECT
`AND valid_until IS NULL` is the right filter. This matches the schema's explicit convention documented in the "valid_until Convention" section directly above.

### 3. Entity matching — CORRECT
Both queries use `(subject = :entity OR object = :entity)`, covering the case where an entity appears as the target (e.g., a technology slug that was `decided` upon by another actor). This is essential for reverse lookups.

### 4. include_superseded behavior — DOCUMENTED
The optional filters section explicitly states: `include_superseded: true`: remove the `valid_until IS NULL` clause entirely (returns all matching triples regardless of validity period). Clear and unambiguous.

### 5. Index usage note — ACCURATE
- `idx_subject` and `idx_object` cover the OR condition on subject/object.
- `idx_valid` (`ON triples(valid_from, valid_until)`) is correctly identified as optimizing the range scan for point-in-time queries.
- Minor observation: SQLite cannot use both `idx_subject` and `idx_object` simultaneously for an OR condition without a UNION rewrite. The query planner will typically pick one and scan the other. This is a performance nuance, not a correctness issue, and is acceptable at current volume.

---

## agent-spawn/SKILL.md — step 5e

### 6. Narrative fit — CLEAN
Step 5e follows step 5d (staleness surfacing) naturally. The ordering is logical: load memories (5b/5c) → surface staleness (5d) → enrich with KG context (5e). The transition is smooth.

### 7. 5-memory cap exclusion — CLEARLY STATED
"This block does NOT count against the 5-memory cap. Memory cap applies only to the L0/L1 entries from steps 5b/5c." Explicit and unambiguous.

### 8. Silent-omit behavior — UNAMBIGUOUS
"If kg.sqlite is not found, empty, or the query returns no results: omit the block silently — do not raise an error." Covers all three failure modes (missing file, empty DB, no matching rows).

### 9. Output format — SUFFICIENTLY CLEAR
The named block header "Decision Context (from knowledge graph)" and the bullet template `{subject} {predicate} {object} (since {valid_from}, via {source_epic})` give agents enough structure to produce consistent output. The field order mirrors the triple schema, which reduces ambiguity.

### 10. Query call specificity — ADEQUATE WITH MINOR GAP
`query_decisions({subject: current_agent})` gives the primary lookup key. The prose note "agent or its current epic" clarifies that agents should try the epic ID if agent-name returns no results. This is workable.

**Minor observation:** The parameter name `subject` in the call signature is slightly misleading — the SQL actually queries `subject OR object`, not just subject. Renaming the parameter to `entity` (matching `:entity` in the schema SQL) would align terminology and reduce potential confusion. This is cosmetic — the cross-reference to the schema resolves any ambiguity for a careful reader.

---

## Summary

All 10 checklist items pass. Two minor observations noted (OR index performance nuance; `subject` vs `entity` parameter naming) — neither is a correctness issue and neither blocks implementation. No revision required.
