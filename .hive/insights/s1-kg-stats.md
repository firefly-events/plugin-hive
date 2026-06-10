# s1-kg-stats insights

- The KG schema has no `created_at` column — `valid_from` is the only write
  timestamp. "Last write" and 30-day density therefore key off `valid_from`,
  which is writer-supplied (kg_emit stamps it at insert time, but bootstrap
  importers backdate it to the decision's `set:` date). Density measured this
  way reflects *decision recency*, not *insert recency* — fine for s2/s9's
  purpose, but don't use it to detect import jobs.
- Timestamps are ISO-8601 UTC strings ending in `Z`, so the 30-day cutoff is a
  plain lexicographic string compare in SQL (`valid_from >= ?`). No date
  parsing needed; do NOT mix in naive/offset formats or the compare breaks
  silently.
- `hive/` and `hive/lib/` have no `__init__.py` — they work as namespace
  packages, so `python3 -m hive.lib.kg_stats` only resolves when CWD is the
  repo root. Tests must pass `cwd: ROOT` to spawnSync.
- The `predicates` table may be absent in older/foreign DBs; kg_stats guards
  with a `sqlite_master` check and returns an empty zombie list rather than
  raising — consistent with the silent-soft-fail posture of kg_why.
- Node fixture tests don't need better-sqlite3: building the fixture DB via a
  spawned `python3 -c` + `executescript` avoids native-module/NODE_PATH games
  the kg-bootstrap test had to play with mocks.
