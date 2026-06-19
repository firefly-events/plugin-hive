# al-8-lifecycle-tests: implementation insights

## Relative vs. absolute path in is_hard_excluded

`is_hard_excluded` handles two distinct exclusion types:
- **Absolute roots** (memories, kg.sqlite): resolved against real filesystem paths → works for any absolute path.
- **Relative prefixes** (`.pHive/team-memories/**`): string prefix match → only fires on *relative* paths starting with `.pHive/team-memories`.

`plan_candidates` expands globs from an absolute `state_dir`, producing absolute paths. The relative-prefix exclusion for `team-memories` does NOT fire for those absolute paths. `build_candidates` is the correct boundary: it accepts caller-supplied paths (which can be relative) and applies the filter there.

Implication: guard tests for `team-memories` must test through `build_candidates` (relative paths), not through `plan_candidates` (absolute glob results). The real protection is by omission — the builtin registry has no glob that matches `team-memories/**`.

## shipped signal ignores age threshold

`check_terminal_eligibility` with `status: shipped + release_id` returns `eligible=True` regardless of age. Age only gates the legacy `merged-and-aged` signal. Testing "recent git commit → not a candidate" requires advisory status (`status: done`) + a mocked merged branch — not a shipped story.

## Extracting age.py

`_age_days` and `_git_commit_age_days` were private helpers in `planner.py`. Extracting them to `age.py` lets tests import and verify behavior directly. `planner.py` now delegates to the public names; private aliases preserved for compatibility with other callers that relied on the module-internal names.

## conftest.py shared helpers

`backdate(path)` and `write_run_state(run_dir, status, age_ts)` reduce fixture boilerplate across guard tests. `git_commit_at(repo, path, ts)` sets both `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` via env vars to deterministically control the git commit timestamp for D5 age-source tests.
