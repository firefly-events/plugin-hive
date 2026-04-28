# kg-write-path: implement step output

## Changes Applied

### Change 1: hive/references/pre-shutdown-protocol.md

Modified Receiver Protocol step 1 to expand "Record insights first" into three ordered sub-steps:
- 1a: Write insight files
- 1b: Call kg_write() (after insight files, before compile)
- 1c: Call compile() to refresh memory wiki

Added mandatory ordering note: `insight files → kg_write() → compile()`

Added new section `## Session-End Path (Natural Completion)` at end of file documenting that natural session endings follow the same three sub-steps, and clarifying the complementary relationship between shutdown and session-end paths.

### Change 2: hive/references/knowledge-graph-schema.md

Added `## kg_write() Behavioral Contract` section before `## SQLite Bootstrap`. Documents:
- Full function signature with all fields (subject, predicate, object, valid_from, source_epic, source_agent)
- Predicate validation via SELECT against predicates table; rejection with named invalid predicate
- WAL transaction atomicity with rollback on failure
- Availability gate: unavailable kg.sqlite → silent warning, no error
- Performance: <100ms for 20 triples under WAL mode
