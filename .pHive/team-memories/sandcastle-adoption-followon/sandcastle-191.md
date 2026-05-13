# Project Memory: Sandcastle issue #191 upstream blocker

Story: s6-issue-191-defer-marker
Epic: sandcastle-adoption-followon

## What this is

A durable upstream blocker record for Sandcastle issue #191
(https://github.com/mattpocock/sandcastle/issues/191).

The `claudeCode()` Sandcastle lane is blocked while #191 is open (subscription
auth unimplemented upstream). Hive ships Sandcastle support via Codex path only.

## Key files

- `.pHive/upstream-watch/sandcastle-191.md` — canonical watch file with upstream
  link, current behavior, unblock condition, owner, and cleanup-out-of-scope note.
- `hive/scripts/gate-claudecode-sandcastle.mjs` — audit gate; fails if any code
  wires `claudeCode()` through Sandcastle. Codex-path (`codex()`) is allowed.
- `tests/gate-claudecode-sandcastle.test.js` — fixture tests for both blocked and
  allowed paths.

## For future planners

When https://github.com/mattpocock/sandcastle/issues/191 is closed upstream:
1. Create a new story to flip status and remove the audit gate.
2. Cleanup is intentionally OUT OF SCOPE for this epic.
3. Do not remove `gate-claudecode-sandcastle.mjs` without a dedicated story.
