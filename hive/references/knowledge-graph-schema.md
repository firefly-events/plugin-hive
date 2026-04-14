# Knowledge Graph Schema

The L2 knowledge graph stores structured decisions and lifecycle events as subject-predicate-object triples in `~/.claude/hive/kg.sqlite`. It complements the compiled wiki (L1) by providing queryable, time-stamped decision provenance rather than narrative memory articles.

## Triple Schema

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| subject | TEXT | NOT NULL | The actor or entity making or experiencing the decision (e.g., epic ID, story ID, agent name) |
| predicate | TEXT | NOT NULL, FK → predicates | The relationship type; must be in the controlled predicate vocabulary |
| object | TEXT | NOT NULL | The target of the relationship (e.g., a technology slug, phase name, story ID) |
| valid_from | TEXT | NOT NULL | ISO 8601 timestamp when this triple became valid |
| valid_until | TEXT | NULL | ISO 8601 timestamp when this triple was superseded; NULL means currently valid |
| source_epic | TEXT | | Epic ID that produced this triple |
| source_agent | TEXT | | Agent name that wrote this triple |

## Controlled Predicate Vocabulary

### Decision Predicates

| Predicate | Description |
|-----------|-------------|
| `decided` | Records a deliberate architectural or implementation decision |
| `superseded` | Marks a prior decision as replaced by a newer one |
| `assigned_to` | Records assignment of a story or task to an agent or team |
| `blocked_by` | Records a blocking dependency between two work items |
| `depends_on` | Records a soft dependency between two work items |

### Lifecycle Predicates

| Predicate | Description |
|-----------|-------------|
| `phase_started` | Records that a workflow phase began |
| `phase_complete` | Records that a workflow phase completed successfully |
| `phase_failed` | Records that a workflow phase failed |
| `phase_blocked` | Records that a workflow phase is blocked and cannot proceed |

## valid_until Convention

- `NULL` — the triple is currently valid; its assertion holds as of now
- ISO 8601 timestamp — the triple was invalidated or superseded at that time; it is historical record only

When querying for the current state, filter `WHERE valid_until IS NULL`. When querying point-in-time state, filter `WHERE valid_from <= :as_of AND (valid_until IS NULL OR valid_until > :as_of)`.

## Indexes

| Index | Definition | Purpose |
|-------|------------|---------|
| `idx_subject` | `ON triples(subject)` | Fast lookup of all triples for a given entity |
| `idx_object` | `ON triples(object)` | Reverse lookup — find what depends on or refers to an object |
| `idx_predicate` | `ON triples(predicate)` | Filter by relationship type |
| `idx_valid` | `ON triples(valid_from, valid_until)` | Composite index for point-in-time queries |

> **Query pattern note:** The dominant query is `WHERE valid_until IS NULL` (current-state lookups). A partial index `CREATE INDEX idx_current ON triples(subject, predicate) WHERE valid_until IS NULL` can be added later when query profiling shows this is a bottleneck; the composite idx_valid is sufficient for the current volume.

## Triple Shape Examples

### Decision Triples

```
subject               predicate  object                         valid_from              valid_until  source_epic                   source_agent
--------------------  ---------  -----------------------------  ----------------------  -----------  ----------------------------  ------------
architect             decided    use-chromadb-for-l3            2026-04-12T09:00:00Z    null         memory-autonomy-foundation    architect
architect             decided    use-sqlite-for-l2-kg           2026-04-12T09:00:00Z    null         memory-autonomy-foundation    architect
```

### Lifecycle Triples

```
subject                         predicate        object     valid_from              valid_until  source_epic                   source_agent
------------------------------  ---------------  ---------  ----------------------  -----------  ----------------------------  ------------
memory-autonomy-foundation      phase_started    pre-exec   2026-04-13T10:00:00Z    null         memory-autonomy-foundation    orchestrator
memory-autonomy-foundation      phase_complete   planning   2026-04-12T18:00:00Z    null         memory-autonomy-foundation    orchestrator
```

### Supersession Pattern

When a decision is superseded, set `valid_until` on the old triple and insert a new triple:

```sql
-- Step 1: Invalidate the old triple
UPDATE triples
SET valid_until = '2026-04-13T14:00:00Z'
WHERE subject = 'architect'
  AND predicate = 'decided'
  AND object = 'use-redis-for-l2-kg'
  AND valid_until IS NULL;

-- Step 2: Insert the new triple
INSERT INTO triples (subject, predicate, object, valid_from, valid_until, source_epic, source_agent)
VALUES ('architect', 'decided', 'use-sqlite-for-l2-kg', '2026-04-13T14:00:00Z', NULL, 'memory-autonomy-foundation', 'architect');

-- Optional: record the supersession relationship
INSERT INTO triples (subject, predicate, object, valid_from, valid_until, source_epic, source_agent)
VALUES ('use-sqlite-for-l2-kg', 'superseded', 'use-redis-for-l2-kg', '2026-04-13T14:00:00Z', NULL, 'memory-autonomy-foundation', 'architect');
```

## kg_write() Behavioral Contract

```
kg_write(triples: Array<{
  subject: string,         // required — agent name, epic ID, story ID, or decision key
  predicate: string,       // required — must be in controlled vocabulary
  object: string,          // required — value, slug, or identifier
  valid_from?: string,     // ISO 8601 timestamp; defaults to current time if omitted
  source_epic?: string,    // optional — epic providing context for this triple
  source_agent?: string    // optional — agent that produced this triple
}>) → void
```

**Validation:** Before writing, each predicate is validated against the `predicates` table:
```sql
SELECT 1 FROM predicates WHERE predicate = ?
```
Unknown predicates are rejected immediately with an error naming the invalid predicate:
```
Error: unknown predicate "my-custom-predicate" — must be one of: decided, superseded, assigned_to, blocked_by, depends_on, phase_started, phase_complete, phase_failed, phase_blocked
```

**Atomicity:** All triples in a single kg_write() call are written in a WAL transaction:
```sql
BEGIN;
INSERT INTO triples (subject, predicate, object, valid_from, valid_until, source_epic, source_agent)
VALUES (?, ?, ?, ?, NULL, ?, ?);
-- ... repeat for each triple
COMMIT;
```
If any insert fails, the transaction is rolled back (no partial writes).

**Availability gate:** If `~/.claude/hive/kg.sqlite` is unavailable (file not found, locked, or permission error), kg_write() logs a warning and returns without error. KG writes are best-effort — callers must not depend on them for correctness.

**Performance:** WAL mode enables concurrent reads during writes. Writing 20 triples completes in <100ms on standard hardware — well within the pre-shutdown 2-turn timeout window.

## SQLite Bootstrap

Run this DDL to initialize the schema. All statements are idempotent (`IF NOT EXISTS`, `INSERT OR IGNORE`).

```sql
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS triples (
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL REFERENCES predicates(predicate),
  object TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  source_epic TEXT,
  source_agent TEXT
);
CREATE TABLE IF NOT EXISTS predicates (predicate TEXT PRIMARY KEY);
INSERT OR IGNORE INTO predicates VALUES
  ('decided'), ('superseded'), ('assigned_to'), ('blocked_by'), ('depends_on'),
  ('phase_started'), ('phase_complete'), ('phase_failed'), ('phase_blocked');
CREATE INDEX IF NOT EXISTS idx_subject ON triples(subject);
CREATE INDEX IF NOT EXISTS idx_object ON triples(object);
CREATE INDEX IF NOT EXISTS idx_predicate ON triples(predicate);
CREATE INDEX IF NOT EXISTS idx_valid ON triples(valid_from, valid_until);
```
