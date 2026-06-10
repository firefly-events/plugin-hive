# sls-3 stale-parent sweep — implementation insights

- `multica issue list --output json` does NOT return a bare array: it wraps
  pages as `{issues, has_more, limit, offset, total}`. Use `has_more` for
  pagination, not page-length heuristics. By contrast,
  `multica issue comment list --output json` DOES return a bare array on
  stdout (the "Showing N comments." line goes to stderr, so `json.loads` on
  stdout is safe).
- There is no `--parent` filter on `multica issue list`, so child discovery
  requires listing ALL issues and grouping by `parent_issue_id` client-side.
  Keep the fallback path (parsing `mention://issue/<uuid>` from the leader's
  Delegated comments) — some older parents predate parent linkage.
- BLOCKED detection is intentionally case-sensitive word-boundary
  (`\bBLOCKED\b`): the terminal contract (sls-1) specifies a literal marker,
  and prose like "this was blocked earlier" must not park a parent in the
  blocked section forever.
- Script filename has dashes (`multica-sweep-stale-parents.py`), so tests
  import it via `importlib.util.spec_from_file_location` — don't rename the
  script to make it importable; the dash naming matches the existing
  `scripts/` convention.
