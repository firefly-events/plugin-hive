-- seed.sql — KG fixture for kg-augmented-meta-signal S5 test
--
-- Idempotent: every statement uses IF NOT EXISTS / INSERT OR IGNORE so a
-- second run leaves the seeded state unchanged.
--
-- Crafted triple matrix (relative to fixture "now" = 2026-05-01):
--   recent local       — within 30d, source_epic == local fixture epic
--   recent cross       — within 30d, source_epic != local fixture epic
--   recent superseded  — within 30d, supersession marker
--   stale local/cross  — beyond 30d, must be filtered by the recency window
--
-- The runner sets up a tmp project with `.pHive/epics/<local-epic-id>/`
-- whose name matches `kg-fixture-local-epic` so step-02c §1's local-epic
-- discovery tags the matching triples as local_signal.
--
-- See: hive/references/knowledge-graph-schema.md §SQLite Bootstrap

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
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_triple
  ON triples(subject, predicate, object, source_epic);

-- ─── recent local_signal triples (source_epic = kg-fixture-local-epic) ─────
INSERT OR IGNORE INTO triples
  (subject, predicate, object, valid_from, valid_until, source_epic, source_agent)
VALUES
  ('kg-fixture-local-epic',
   'phase_failed',
   'integrate',
   '2026-04-22T10:00:00Z',
   NULL,
   'kg-fixture-local-epic',
   'orchestrator'),
  ('S2-fixture-story',
   'phase_failed',
   'test',
   '2026-04-25T14:30:00Z',
   NULL,
   'kg-fixture-local-epic',
   'tester');

-- ─── recent cross_project_signal triples (source_epic != local) ───────────
INSERT OR IGNORE INTO triples
  (subject, predicate, object, valid_from, valid_until, source_epic, source_agent)
VALUES
  ('kg-fixture-other-epic',
   'phase_blocked',
   'planning',
   '2026-04-18T09:00:00Z',
   NULL,
   'kg-fixture-other-epic',
   'orchestrator'),
  ('S7-other-story',
   'phase_blocked',
   'execute',
   '2026-04-27T16:00:00Z',
   NULL,
   'kg-fixture-other-epic',
   'tpm');

-- ─── recent superseded triple (mix — local source) ────────────────────────
INSERT OR IGNORE INTO triples
  (subject, predicate, object, valid_from, valid_until, source_epic, source_agent)
VALUES
  ('use-bun-spawn-stdin',
   'superseded',
   'use-node-spawn-stdin',
   '2026-04-20T11:00:00Z',
   NULL,
   'kg-fixture-local-epic',
   'architect');

-- ─── STALE triples (valid_from > 30d before 2026-05-01 — excluded) ────────
INSERT OR IGNORE INTO triples
  (subject, predicate, object, valid_from, valid_until, source_epic, source_agent)
VALUES
  ('kg-fixture-local-epic',
   'phase_failed',
   'pre-exec',
   '2026-02-01T08:00:00Z',
   NULL,
   'kg-fixture-local-epic',
   'orchestrator'),
  ('kg-fixture-other-epic',
   'phase_blocked',
   'pre-exec',
   '2026-01-15T08:00:00Z',
   NULL,
   'kg-fixture-other-epic',
   'orchestrator');
