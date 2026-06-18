# Insights — al-7 State-Dir Scan Scope

## Duplicate detection is inode-based, not name-based

`find_duplicates` resolves paths before comparing. Two separate files at the
same *relative* path under different scan roots (primary vs legacy) are NOT
deduplicated — they're distinct artifacts. Only symlinks or hardlinks that
resolve to the same inode trigger a duplicate diagnostic. Don't write tests
expecting name-based dedup.

## `plan_candidates` predicates must be known at call time

The predicate registry is closed. Test helpers must use a real predicate
(`never-active`, `dag-run-active`, etc.). `"always"` does not exist — using it
causes `PlanError` at scan time, not at entry construction time.

## Legacy scan skips the same root as primary silently

When `state_dir` resolves to the same path as `repo_root/.pHive`, `resolve_scan_roots`
returns `legacy=None`. No diagnostic is emitted. This is intentional — the scan
already covers that directory via the primary root.

## `hard_exclude=True` entries get skipped in legacy scanning

The compatibility scan filters out hard-excluded entries before scanning legacy
`.pHive`. This generates a `"skipped"` diagnostic. The rationale: hard-excluded
entries have no globs worth scanning anywhere.

## Skipped class IDs must be excluded from legacy `plan_candidates` call

In `plan_candidates_with_compat`, build `skipped_class_ids` from diagnostics
**before** calling `plan_candidates` on the legacy root. Otherwise excluded
entries still scan legacy and their results feed into dedup logic, producing
spurious candidates.
