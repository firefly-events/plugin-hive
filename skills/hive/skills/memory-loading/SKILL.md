---
name: memory-loading
description: Load prior-knowledge memories for a Hive roster persona using the L3→L1→L0 tier ladder, with ChromaDB agent isolation, override/pitfall pinning, TTL staleness warnings, and optional kg.sqlite decision context. Inherits the caller's model.
---

# Hive Memory Loading

Atomic skill, NOT inline agent-spawn prose. Resolves a persona's prior-knowledge block via the L3 (ChromaDB) → L1 (wiki) → L0 (scan) tier ladder, applies override/pitfall always-load + 5-cap discipline, and optionally appends KG decision-context triples. The caller injects the returned block at the persona-then-task boundary.

## Invocation contract

Call this skill after persona-resolve has returned `persona_context` and before the spawn prompt is constructed.

**Inputs:**
- `persona_context` — output of `skills/hive/skills/persona-resolve/SKILL.md`. Needs `agent_name`, `resolved_paths.knowledge`.
- `task_description` — story spec plus current step task text, used as the relevance query for L1/L3 retrieval.
- `epic_handle` — optional; the parent epic identifier used for L2 KG entity lookups.

**Outputs:**
- `prior_knowledge_block` — formatted markdown ready to inject as the "Prior Knowledge" section.
- `staleness_signals` — count of override-type memories loaded, oldest `last_verified` age, and per-entry `⚠ last verified: N days ago` prefix where applicable.

**Side effects:** none beyond reads. Memory files are read-only here; emission happens in the caller.

## Process

### Step 5a: L3 availability check (ChromaDB)

- Call `isAvailable()` from `hive/lib/chromadb-wrapper.js`.
- If available (L3 active): **skip steps 5b and 5c entirely** — proceed directly to **5c-L3** below. The compiled-at.md freshness gate does not apply when ChromaDB is active; semantic search operates independently of wiki compilation state.
- If unavailable: proceed to the L0/L1 freshness gate below.

### Step 5a (L0/L1 path): wiki freshness

- Read `~/.claude/hive/memory-wiki/meta/compiled-at.md`.
- If file absent or timestamp > 24 hours old: go to step 5c (L0 fallback).
- If file present and recent: proceed to step 5b.

### Step 5b: wiki-based retrieval (L1)

- Read `~/.claude/hive/memory-wiki/index.md`.
- Identify topic slugs most relevant to `task_description`.
- Read the corresponding topic articles from `~/.claude/hive/memory-wiki/topics/`.
- Optionally read the agent's digest from `~/.claude/hive/memory-wiki/agents/{agent}.md`.
- Format loaded content as the "Prior Knowledge" block.
- Proceed to step 5d for staleness surfacing.

### Step 5c-L3: ChromaDB active path

- Build `queryText` from `task_description`.
- Call `query(collectionName, queryText, 20)` per the wrapper signature in `hive/lib/chromadb-wrapper.js` (`query(collectionName, queryText, topK = 5, ...)`) to fetch top-20 candidate memory IDs ranked by ChromaDB distance.
- **Agent isolation:** memories are written with namespaced docIds of the form `${agentName}/${slug}` (see `hive/lib/session-end.js` Phase C). Filter results to those whose `id` starts with `${persona_context.agent_name}/` before further processing. This protects against cross-agent retrieval from the shared `hive-memories` collection.
- For each remaining candidate, read the memory file at `~/.claude/hive/memories/{agent}/{slug}.md` to access frontmatter (`type`, `timestamp`, `last_verified`, `ttl_days`). The current `query()` wrapper does not return ChromaDB metadata, so frontmatter must be read from disk.
- **Step A — Always include** all `override` and `pitfall` type memories unconditionally. These are immune to the 5-memory cap.
- **Step B — Rank remaining candidates by ChromaDB distance only** (lower distance = more relevant). Future work: extend `query()` to surface metadata so a recency-weighted score (`1 / (1 + days_since_created)`) can multiply the distance-based score; tracked separately.
- **Step C — Cap** the remaining (non-override/pitfall) memories at `max(0, 5 - override_pitfall_count)`. Total Prior Knowledge set size is `override_pitfall_count + remaining_cap`, which may exceed 5 when many overrides/pitfalls exist — this is intentional.
- Format as the "Prior Knowledge" block.
- Proceed to step 5d for staleness surfacing.

### Step 5c (L0/L1 fallback path)

- Scan the memory directory for all `.md` files.
- Read each memory's frontmatter `description` field.
- Check relevance to `task_description` (keyword match: memory descriptions vs task text).
- Load the full content of relevant memories.
- `override` and `pitfall` types always load (bypass relevance filter).
- `reference` type loads when topic keyword matches.
- Cap at 5 memories; prefer recency.
- Format as "Prior Knowledge" block.

### Step 5d: staleness and override surfacing

- For each loaded memory: check `last_verified` + `ttl_days` vs today's date.
- If past TTL: prepend `⚠ last verified: N days ago` to that memory's entry in the Prior Knowledge block.
- Count override-type memories loaded; if count > 0, add the header line:
  `{N} override memories loaded — oldest: {X} days since last_verified`
- These are informational signals, not blocking errors.

### Step 5e: KG Decision Context (L2 — when kg.sqlite active)

- Run `query_decisions({entity: persona_context.agent_name})` to fetch currently-valid triples where the agent appears as subject or object.
- Also run `query_decisions({entity: epic_handle})` to fetch epic-level decisions (e.g. those imported from `cycle-state/` by `scripts/kg-import-cycle-state.js`, which writes `subject: epicId`).
- The `entity:` API parameter binds to the SQL placeholder `:entity` and is matched against both the `subject` and `object` columns (`(subject = :entity OR object = :entity)`), so a single value retrieves triples regardless of which column it appears in.
- Merge results from both calls (deduplicate on `(subject, predicate, object, valid_from)`) before formatting the block.
- See `hive/references/knowledge-graph-schema.md` → "query_decisions() Query Logic" for the SQL.
- If results exist: append a **"Decision Context (from knowledge graph)"** block to Prior Knowledge AFTER the memory entries. Format as:
  ```
  ### Decision Context (from knowledge graph)
  - {subject} {predicate} {object} (since {valid_from}, via {source_epic})
  - ...
  ```
- **This block does NOT count against the 5-memory cap.** Memory cap applies only to the L0/L1 entries from steps 5b/5c.
- If kg.sqlite is not found, empty, or the query returns no results: **omit the block silently — do not raise an error.**

## Output framing

Return `prior_knowledge_block` as a markdown blob the caller injects as a "Prior Knowledge" section after the persona and before the task instructions.
