# MemoryStore Interface

The MemoryStore interface decouples memory retrieval callers from the backing store. It defines a stable contract that agent-spawn (step 5) and session-end (step 8) call against — regardless of whether the store is the compiled wiki (L1) or a future vector database (L3).

This is a **documentation schema**, not executable code. Implementations are described in natural language with enough precision to guide development.

## Interface Methods

### 1. `read(query: string) → PriorKnowledge`

**Purpose:** Retrieve memories relevant to the current task context.

**Inputs:**
- `query` — a string derived from the story's description and context fields; used for relevance matching

**Outputs:**
- `PriorKnowledge` — a structured block of up to 5 memory entries, ready for injection into an agent prompt (see agent-memory-schema.md for injection format)

**L1 implementation (compiled wiki):**
1. Check `memory-wiki/compiled-at.md` for freshness (compare to last memory write timestamp)
2. If wiki is fresh: navigate wiki index to find relevant topic articles; load matching articles
3. If wiki is stale or absent: fall back to L0 keyword scan — read each memory file's `description` frontmatter field and filter by keyword match against `query`
4. Apply relevance filtering: `override` and `pitfall` types always include; `pattern`, `codebase`, `reference` include on keyword match
5. Cap at 5 memories; prefer recency (`timestamp` field) when many match

**L3 future (Qdrant):** Replace L0 keyword scan and wiki navigation with semantic vector search against the Qdrant collection. Same output format; higher recall on paraphrased queries.

---

### 2. `write(memory: MemoryFile) → void`

**Purpose:** Persist a promoted memory to the agent's memory directory.

**Inputs:**
- `memory` — a complete memory file with schema-compliant frontmatter: `name`, `description`, `type`, `agent`, `timestamp`, `source_epic`. Optional: `last_verified`, `ttl_days`, `source`, `imported_from`.

**Outputs:** None (side effect only)

**L1 implementation:** Write the memory file to `~/.claude/hive/memories/{agent}/{slug}.md`. The slug is derived from the memory's `name` field (lowercase, hyphenated). If a file with the same slug exists and the new memory is type `override`, replace it; otherwise append a version suffix.

**L2 side-effect (kg_write):** When the memory being written has type `decision` or `lifecycle`, additionally insert a triple into `~/.claude/hive/kg.sqlite`. The triple subject is the memory's `source_epic` or agent name; predicate maps from memory type; object is the memory's `name` slug. This side-effect is a no-op if kg.sqlite is unavailable.

**L3 future:** Write to disk (same as L1) and additionally upsert a vector embedding into the Qdrant collection for the agent's namespace.

---

### 3. `compile(affected_topics?: string[]) → void`

**Purpose:** Trigger wiki recompilation after memory writes accumulate.

**Inputs:**
- `affected_topics` (optional) — list of topic slugs to recompile. Omit for full recompile.

**Outputs:** None (side effect: updates `memory-wiki/` directory and `memory-wiki/compiled-at.md` timestamp)

**L1 implementation (compiled wiki):** This is the primary method for L1 — the wiki IS the compiled artifact. Steps:
1. If `affected_topics` provided: recompile only those topic articles in `memory-wiki/topics/`
2. If omitted: scan all agent memory directories and regenerate the full wiki index and all topic articles
3. Update `memory-wiki/compiled-at.md` with current timestamp

Called by: session-end (step 8) after insight promotion completes.

**L3 future:** No-op for Qdrant (vector index is updated incrementally by `write()`). May optionally refresh the wiki as a human-readable cache.

---

### 4. `staleness_check() → MemoryFile[]`

**Purpose:** Surface memories that have exceeded their TTL for human review.

**Inputs:** None

**Outputs:** Array of memory file references where `last_verified + ttl_days < current_date`. Memories with no `ttl_days` are excluded.

**L1 implementation:** Scan `~/.claude/hive/memories/` recursively. For each `.md` file with a `ttl_days` value, compute `last_verified + ttl_days`. If that date is before today, include in result. Return metadata only (name, agent, type, last_verified, days_overdue) — do not load full content.

**L3 future:** Same logic; Qdrant does not change staleness semantics (TTL is a memory-schema concern, not a store concern).

**Note:** Stale memories are flagged, not auto-deleted. The result is surfaced to the orchestrator as warnings during wiki compilation or session-end evaluation.

---

### 5. `export(filter: ExportFilter) → MemoryBundle`

**Purpose:** Produce a portable bundle of memories for cross-user or cross-project sharing.

**Inputs:**
- `filter` — an `ExportFilter` object with any combination of:
  - `by_type: string[]` — include only memories matching these types (e.g., `["pattern", "pitfall"]`)
  - `by_agent: string[]` — include only memories for these agents
  - `since_date: string` — include only memories with `timestamp` on or after this date (YYYY-MM-DD)
  - `exclude_stale: boolean` — if true, omit memories past their TTL

**Outputs:** `MemoryBundle` — a directory containing selected memory `.md` files and a generated `manifest.yaml` (see memory-bundle-format.md for full specification)

**Privacy note:** The `codebase` memory type often contains project-specific details (file paths, internal API names, proprietary patterns). Exclude `codebase` type when producing bundles for cross-user sharing. The export method does not enforce this automatically — callers are responsible for applying `by_type` filters accordingly.

**L1 implementation:** Collect matching files from `~/.claude/hive/memories/`, apply filters, copy to a temporary bundle directory, generate `manifest.yaml`.

---

### 6. `import(bundle: MemoryBundle, strategy: ImportStrategy) → ImportResult`

**Purpose:** Ingest a MemoryBundle into the local memory store.

**Inputs:**
- `bundle` — a `MemoryBundle` directory (see memory-bundle-format.md)
- `strategy` — one of: `skip-existing`, `merge`, `overwrite`

**Outputs:**
- `ImportResult` — summary object with: `imported_count`, `skipped_count`, `overwritten_count`, `affected_topics[]`

**Provenance:** All imported memories receive:
- `source: "imported"`
- `imported_from: {manifest.label}` (taken from the bundle's `manifest.yaml`)

**Post-import:** Calls `compile(affected_topics)` with the topics affected by newly imported memories. This ensures the wiki reflects the new state.

**L1 implementation:** For each `.md` file in the bundle: apply strategy logic (see Import Strategies below), write to `~/.claude/hive/memories/{agent}/`, then call `compile()` on affected topics.

---

### 7. `query_decisions(filter: DecisionFilter) → Triple[]`

**Purpose:** Retrieve decision and lifecycle triples from the KG for agent context injection.

**Inputs:**
- `filter` — a `DecisionFilter` object with any combination of:
  - `subject?: string` — filter by subject (e.g., epic ID, story ID, agent name)
  - `predicate?: string` — filter by predicate (must be in controlled vocabulary)
  - `as_of?: string` — ISO 8601 timestamp; return only triples valid at that time (valid_from ≤ as_of AND (valid_until IS NULL OR valid_until > as_of)). Defaults to now.
  - `include_superseded?: boolean` — if true, include triples where valid_until is set. Default false.

**Outputs:**
- `Triple[]` — array of matching triple objects: `{subject, predicate, object, valid_from, valid_until, source_epic, source_agent}`

**L2 implementation (SQLite KG):** Query `~/.claude/hive/kg.sqlite` triples table with the filter criteria. Use the composite index (valid_from, valid_until) for point-in-time queries.

**Note:** This method is KG-specific. L1 (wiki) and L3 (Qdrant) do not implement this method — it supplements, not replaces, the existing `read()` method.

---

## Import Strategies

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| `skip-existing` | If a memory with the same slug already exists, skip the incoming file. Existing memories are never modified. | **Default.** Safe for first-time imports; preserves local work. |
| `merge` | If a conflict exists, keep whichever memory has the newer `timestamp`. The older file is replaced. | Syncing updates from a shared bundle — newer knowledge wins. |
| `overwrite` | Replace all existing memories with bundle contents, unconditionally. | **Destructive.** Only for resetting a known-bad local state from a canonical source. Prompt for confirmation before executing. |

For `reference` type memories under `merge` or `overwrite`: append new entries to the existing file rather than replacing it entirely (reference memories have append semantics — see agent-memory-schema.md).

---

## Implementations

| Layer | Implementation | Ships When | Implements |
|-------|---------------|------------|------------|
| L1 | Compiled wiki (`memory-wiki/`) | Now | All core methods except `query_decisions()`. `compile()` is the core operation; `read()` navigates wiki articles, falls back to L0 keyword scan if stale. |
| L2 | SQLite knowledge graph (`~/.claude/hive/kg.sqlite`) | Now (memory-autonomy-foundation epic) | Stores structured decision triples and lifecycle events. Adds `query_decisions()` for filtered retrieval. `kg_write()` is a side-effect of `write()` — fires when memory type is `decision` or `lifecycle`. |
| L3 | ChromaDB JSON-RPC wrapper (`hive/lib/chromadb-wrapper.js`) | Optional — active when ChromaDB sidecar is running (see kickoff-protocol.md Phase 5) | `read()` calls `isAvailable()` first; if false, falls back to L1+L0 silently. `write()` additionally calls `index()` for semantic search. Optional — all paths degrade to L1+L0 when sidecar absent. |

The wiki-compilation step in L1 implements `compile()`. If Qdrant is adopted for L3, `read()` is the primary method that changes — the rest of the interface remains identical.

---

## Callers

| Caller | Methods Used | When |
|--------|-------------|------|
| agent-spawn step 5 | `read(query)` | At every agent spawn, before injecting Prior Knowledge |
| session-end step 8 | `write(memory)`, `compile(topics)`, `staleness_check()` | After insight promotion completes |
| export command / user request | `export(filter)` | On demand |
| import command / kickoff | `import(bundle, strategy)` | When ingesting a shared bundle |
