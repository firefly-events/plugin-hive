# chromadb-integration — implement step output

## Story goal
Wire ChromaDB L3 into agent-spawn steps 5a/5c, and add chromadb.index() to session-end and pre-shutdown write paths.

## Changes applied

### skills/hive/skills/agent-spawn/SKILL.md

**Edit A — step 5a (L3 availability check):**
Prepended a new `5a. L3 availability check (ChromaDB)` step before the existing freshness gate. When `isAvailable()` returns true, the agent skips steps 5b and 5c entirely and proceeds to 5c-L3. The original freshness gate is now labelled `5a (L0/L1 path)`.

**Edit B — step 5c-L3 (ChromaDB active path):**
Added a new `5c-L3` branch before the existing L0 fallback. Queries ChromaDB for top-20 candidates, always includes override/pitfall memories, re-ranks by `relevance_score × recency_weight`, caps at 5 total memories, then proceeds to step 5d. The existing L0 fallback is now labelled `5c (L0/L1 fallback path — unchanged)`.

### hive/references/pre-shutdown-protocol.md

**Edit C — Receiver Protocol step 1b:**
Expanded step 1b from `Call kg_write()` to `Call kg_write() and chromadb.index() (parallel, best-effort)`. Documents that both calls are independent, chromadb.index() imports from `hive/lib/chromadb-wrapper.js`, failure logs a warning but does not block shutdown response.

**Edit D — Session-End Path item 2:**
Updated the numbered list item from `Call kg_write()` to `Call kg_write() and chromadb.index() (parallel, best-effort — see Receiver Protocol step 1b for details)`.

## Artifacts
- `skills/hive/skills/agent-spawn/SKILL.md` — modified (Edits A + B)
- `hive/references/pre-shutdown-protocol.md` — modified (Edits C + D)
- `state/episodes/memory-autonomy-foundation/chromadb-integration/preflight.yaml`
- `state/episodes/memory-autonomy-foundation/chromadb-integration/research.yaml`
- `state/episodes/memory-autonomy-foundation/chromadb-integration/implement.yaml`
- `state/episodes/memory-autonomy-foundation/chromadb-integration/implement-output.md`
