# Insights: al-5-report-only-tracked-classes

## active_predicate is required but unused for tracked classes

`plan_terminal_report_candidates` doesn't call `is_active()` — terminal eligibility
replaces the predicate check for tracked classes. But `RegistryEntry` requires a
non-empty `active_predicate` field. Use `"never-active"` as the placeholder; it
satisfies the schema and documents that tracked classes have no active-state guard.

## `dataclasses.replace` is the clean way to override threshold in tests

`plan_terminal_report_candidates` uses `entry.retention_threshold` for age gating, but
tests need to pass without a real git repo providing commit timestamps. Overriding the
threshold to 0 via `dataclasses.replace(entry, retention_threshold=0)` makes shipped-YAML
candidates appear without mocking git, keeping tests fast and hermetic.

## Candidate vs EvictCandidate: the type split IS the apply-mode guard

`apply_evict` accepts `Sequence[EvictCandidate]`. `plan_terminal_report_candidates`
returns `list[Candidate]`. These are distinct frozen dataclasses with different fields
(`age_days` only on `EvictCandidate`). The type boundary is the structural guarantee
that report-only candidates never reach the evict executor — no runtime check needed.

## Globs are relative to state_dir, not the repo root

`_expand_glob(state_dir, "audits/**")` resolves to `.pHive/audits/**` when `state_dir`
is `.pHive`. Don't include the `.pHive/` prefix in the glob strings — the planner adds
it implicitly via `root.glob(pattern)`.
