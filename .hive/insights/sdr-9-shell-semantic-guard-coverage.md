# sdr-9-shell-semantic-guard-coverage — insights

- The legacy `state` alternative in the story-path regex has no left word
  boundary, so any custom state dir whose basename *ends* in `state`
  (e.g. `.hive-state`) already matched `state/epics/...` as a substring
  before this story. Tests for "unconfigured custom dir is NOT flagged"
  must pick a basename that does not contain `state` or `pHive`
  (we used `.hive-meta`), or they pass for the wrong reason.
- Pattern 2 (`execute.*epic`) matches *across* path text: a prompt like
  "execute story <dir>/epics/.../stories/x.yaml" trips the epic-level
  block via the `/epics/` path segment, masking whether Pattern 1's
  story-path regex fired at all. Guard tests that want to exercise
  Pattern 1 specifically should use "implement story ... development
  workflow" phrasing and assert on the `story-level work` stderr text,
  not the shared `Use TeamCreate` suffix.
- `hooks/common.sh` declares `set -euo pipefail`; calling
  `_resolve_state_dir` from another `set -e` hook must use
  `var=$(fn) || var=""` so a resolver failure degrades to default
  `.pHive` coverage instead of crashing the hook with a non-0/2 exit
  (which Claude Code would treat as a hook error, not allow/block).
- The resolved state dir is an absolute canonical path; only its
  basename is useful for prompt matching, and it must be ERE-escaped
  (basenames like `.pHive` contain regex metacharacters). Skip appending
  when the basename is already `.pHive` or `state` to keep the regex
  free of duplicate alternatives.
