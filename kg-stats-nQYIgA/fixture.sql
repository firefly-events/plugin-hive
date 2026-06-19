
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
INSERT INTO triples VALUES
  ('story-a', 'decided', 'use sqlite', '2026-06-01T10:00:00Z', NULL, 'epic-1', 'architect'),
  ('story-a', 'decided', 'use python', '2026-06-02T10:00:00Z', NULL, 'epic-1', 'architect'),
  ('story-b', 'assigned_to', 'developer', '2026-06-03T10:00:00Z', NULL, 'epic-2', 'planner'),
  ('story-c', 'phase_started', 'build', '2020-01-01T00:00:00Z', NULL, 'epic-old', 'runner');
