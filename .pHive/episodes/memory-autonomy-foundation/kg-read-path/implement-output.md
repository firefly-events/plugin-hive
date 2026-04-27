# kg-read-path implement output

## Changes applied

### Change 1: hive/references/knowledge-graph-schema.md
Added `## query_decisions() Query Logic` section between `## kg_write() Behavioral Contract` and `## SQLite Bootstrap`. The new section documents:
- Point-in-time query (as_of provided) with full SQL
- Current-state query (as_of omitted — default) with full SQL
- Optional filters (predicate filter, include_superseded)
- Index usage notes for idx_subject, idx_object, and idx_valid

### Change 2: skills/hive/skills/agent-spawn/SKILL.md
Added `**5e. KG Decision Context (L2 — when kg.sqlite active):**` between step 5d (Staleness and override surfacing) and the closing Prior Knowledge injection note. The new sub-step specifies:
- query_decisions({subject: current_agent}) call
- Reference to knowledge-graph-schema.md for SQL details
- "Decision Context (from knowledge graph)" block format with subject/predicate/object/valid_from/source_epic fields
- Explicit note that KG block does NOT count against the 5-memory cap
- Silent omission if kg.sqlite is absent, empty, or returns no results

## Files modified
- `/Users/don/Documents/plugin-hive/hive/references/knowledge-graph-schema.md`
- `/Users/don/Documents/plugin-hive/skills/hive/skills/agent-spawn/SKILL.md`
