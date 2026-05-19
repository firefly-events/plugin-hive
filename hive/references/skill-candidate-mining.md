# Skill-candidate signal mining

`hive/lib/skill_candidate_mine.py` reads four Hive signal sources and emits
a deterministic list of pattern observations. Ranking and the
`/find-skills` handoff live in story `se-5-candidate-ranking-handoff` —
this module is observation-only.

## Public API

```python
from hive.lib.skill_candidate_mine import mine

observations = mine(
    state_dir=".pHive",        # default
    project_root=".",          # working tree for git log; default = cwd
    git_log_limit=200,         # last N commits
)
```

`mine()` returns `list[dict]`. Empty list when the project's maturity
classification (per `hive/lib/project_maturity.py`, story `ed-1`) is
`greenfield` or `early`.

## Signal sources

| Source                          | Path                                     | Signature shape                       |
|---------------------------------|------------------------------------------|---------------------------------------|
| Metric events                   | `.pHive/metrics/events/*.jsonl`          | `event:{agent}|{metric_type}|{phase}` |
| KG triples (silent on absence)  | `.pHive/kg.sqlite` table `triples`       | `kg:{predicate}|{subject_namespace}`  |
| Conventional-commit subjects    | `git log -200 --no-merges`               | `commit:{type}({scope})`              |
| Cycle-state escalations         | `.pHive/cycle-state/*.yaml`              | `escalation:{trigger}|{placement}|{severity}` |

Only patterns with **occurrence_count ≥ 2** are returned. Singletons are
noise for downstream ranking.

`subject_namespace` for KG triples is the prefix before the first colon
in the subject (e.g., `epic:foo` → `epic`); subjects without a colon use
`_`.

## Observation shape

```json
{
  "pattern_signature":  "commit:feat(execute)",
  "occurrence_count":   12,
  "recent_examples":    ["feat(execute): ...", "feat(execute): ..."],
  "source_kind":        "commit",
  "first_seen":         "2026-04-22T18:32:14+00:00",
  "last_seen":          "2026-05-18T09:11:00+00:00"
}
```

- `recent_examples` is bounded at 3 entries, most-recent first, each
  truncated to 120 chars.
- `first_seen` / `last_seen` are ISO-8601 timestamps when the source row
  carries one, else the empty string.

## Determinism contract

`mine()` is deterministic for a fixed input state:

- Files are iterated in `sorted(glob(...))` order.
- Buckets are emitted in `(source_kind, pattern_signature)` order.
- Example lists are sorted by `(timestamp DESC, text ASC)` then deduped.
- Signatures never contain timestamps or run IDs — only stable
  categorical fields.

The test suite asserts byte-equal output across two consecutive calls
(`tests/test_skill_candidate_mining.py::TestDeterminism`).

## Maturity gate

`mine()` calls `hive.lib.project_maturity.resolve_maturity()` with
`{state_dir}/project-profile.yaml`. When the resolved maturity is
`greenfield` or `early`, the function logs:

```
INFO  skip: {maturity} maturity
```

…and returns `[]`. This avoids mining sparse signal that would produce
noisy candidates on projects without enough history.

If the ed-1 helper module is not yet on disk (e.g., the helper has not
landed on the current branch), the soft-import in
`skill_candidate_mine.py` falls back to assuming `established` so the
module is still importable in isolation.

## Failure modes

| Scenario                          | Behavior                                    |
|-----------------------------------|---------------------------------------------|
| `.pHive/metrics/events/` absent   | Skip metric-event reader; no error          |
| Malformed JSONL row               | `logger.warning(...)`; skip row; continue   |
| Non-object JSONL row              | `logger.warning(...)`; skip row; continue   |
| `.pHive/kg.sqlite` absent         | Silent skip; no error                       |
| `triples` table missing           | `logger.warning(...)`; skip source          |
| `git log` returns non-zero        | `logger.warning(...)`; skip source          |
| `git log` raises `OSError`        | `logger.warning(...)`; skip source          |
| `git` binary missing              | Caught as `FileNotFoundError`; skip source  |
| `.pHive/cycle-state/` absent      | Skip; no error                              |
| PyYAML missing                    | `logger.warning(...)`; skip cycle-state     |
| Malformed cycle-state YAML        | `logger.warning(...)`; skip file; continue  |

No failure mode crashes `mine()`. The function always returns a list.
