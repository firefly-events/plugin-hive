# Review Findings — chromadb-integration

**Verdict:** needs_optimization

**Reviewed:** 2026-04-13
**Files reviewed:**
- `skills/hive/skills/agent-spawn/SKILL.md`
- `hive/references/pre-shutdown-protocol.md`

---

## agent-spawn/SKILL.md

### Item 1 — L3 bypass gated on `isAvailable()`: PASS
Step 5a calls `isAvailable()` first and only skips 5b/5c when ChromaDB is confirmed available. The bypass is conditional, not unconditional.

### Item 2 — L3 replaces L0/L1 (not supplements): PASS
The text is unambiguous: "skip steps 5b and 5c entirely — proceed directly to 5c-L3." No code path combines L3 results with L0/L1 results additively.

### Item 3 — Recency×relevance normalization: NEEDS OPTIMIZATION
The formula states `relevance_score` is "ChromaDB distance (lower = more relevant, normalize to 0–1)" but the actual normalization transform is not described. "Normalize to 0–1" is mentioned as intent but the method is unspecified (e.g., `1 - distance`, `1 / (1 + distance)`, or min-max scaling). This leaves implementors free to choose incompatible transforms, producing inconsistent ranking across implementations.

**Recommended fix:** Specify the exact transform, e.g.:
> `relevance_score = 1 - distance` (assumes ChromaDB cosine distance in [0, 1])
> or `relevance_score = 1 / (1 + distance)` (for L2 distance, unbounded)

### Item 4 — Override/pitfall immunity to cap cutoff: NEEDS OPTIMIZATION
The text says "Always include all `override` and `pitfall` type memories regardless of score" and "Cap final set at 5 total memories (override/pitfall slots count toward the cap)." Override/pitfall memories are immune to score-based filtering but NOT immune to the cap. If there are more override/pitfall memories than the cap allows, some will be dropped.

This may be intentional (cap is absolute), but it conflicts with the spirit of "always include." The L0/L1 fallback path (step 5c) uses the same phrasing with the same ambiguity. If the intent is full cap immunity for override/pitfall, the text should read: "override/pitfall memories do NOT count toward the cap." If the cap is intended to be absolute, the "always include" language should be qualified: "always include in preference to other types, but subject to the overall cap."

### Item 5 — 5c-L3 as second touch after 5e was added: PASS
Step 5e is present and the flow (5c-L3 → 5d → 5e) makes the ordering clear. The 5c-L3 description does not explicitly call itself a "second touch," but the structural presence of 5e after 5c-L3 is sufficient context.

### Item 6 — Step 5e KG injection present and unchanged: PASS
Step 5e is intact: `query_decisions()` call, Decision Context block format, explicit note that it does not count against the 5-memory cap. No regressions detected.

---

## pre-shutdown-protocol.md

### Item 7 — Parallel best-effort framing: PASS
Step 1b states "Both calls are independent; either may fail without affecting the other." kg_write() targets kg.sqlite and chromadb.index() targets ChromaDB — no shared state or ordering dependency. The framing is accurate.

### Item 8 — Import reference sufficiency: PASS
`hive/lib/chromadb-wrapper.js` is specified inline in step 1b. This matches the same reference in SKILL.md step 5a, providing consistent discoverability.

### Item 9 — Failure handling matches kg_write() gate pattern: PASS
chromadb.index() failure: "log a warning and continue — do NOT block shutdown response." kg_write() failure: "skip silently." Both are non-blocking best-effort. The chromadb path warns rather than silently skips, which is a minor behavioral difference but is strictly more informative — not a defect.

---

## Summary

| # | Check | Result |
|---|-------|--------|
| 1 | L3 bypass gated on isAvailable() | PASS |
| 2 | L3 replaces, not supplements, L0/L1 | PASS |
| 3 | Normalization from distance to 0-1 described | NEEDS OPTIMIZATION |
| 4 | Override/pitfall immune to cap cutoff | NEEDS OPTIMIZATION |
| 5 | 5c-L3 identified as second touch | PASS |
| 6 | Step 5e KG injection unchanged | PASS |
| 7 | Parallel best-effort framing accurate | PASS |
| 8 | Import reference sufficient | PASS |
| 9 | chromadb.index() failure handling matches pattern | PASS |

**7/9 pass. 2 items need clarification. No blocking defects.**
