# Episode: s6-issue-191-defer-marker

Story: s6-issue-191-defer-marker
Epic: sandcastle-adoption-followon
Agent: backend-developer
Date: 2026-05-12

## Outcome

Created upstream-watch file, narrow audit gate (sibling script), fixture tests,
and project memory pointer for Sandcastle issue #191 blocker.

## Files Touched

- `.pHive/upstream-watch/sandcastle-191.md` — new upstream-watch file
- `hive/scripts/gate-claudecode-sandcastle.mjs` — new audit gate script (sibling to gate-mode-audit.mjs)
- `tests/gate-claudecode-sandcastle.test.js` — 7 fixture tests (blocked/allowed/null)
- `.pHive/team-memories/sandcastle-adoption-followon/sandcastle-191.md` — project memory pointer
- `.pHive/episodes/sandcastle-adoption-followon/s6-issue-191-defer-marker/episode.md` — this file

## Design decisions

- **Sibling script over extending gate-mode-audit.mjs**: The existing gate is a
  telemetry aggregator (JSONL events → recommendation). A static code-audit gate
  has a fundamentally different interface and concern. A sibling script keeps both
  single-purpose and independently testable.
- **Regex-based file scan**: `fs.readdirSync` + two regexes (sandcastle import +
  claudeCode call co-occurrence). No AST parser needed for this narrow check.
- **Codex-path explicitly allowed**: Gate matches `claudeCode(` specifically.
  Files with `codex(` + sandcastle import pass cleanly (AC-2 verified).
- **Cleanup out of scope**: Watch file and gate explicitly note that removal is a
  future status-flip story, not part of this epic.

## Test Results

```
7 tests, 7 pass, 0 fail
node tests/gate-claudecode-sandcastle.test.js
```

## Acceptance Criteria Status

- [x] Watch file includes upstream link, current behavior, unblock condition, owner, cleanup-out-of-scope note
- [x] Blocked fixture (claudeCode + sandcastle) → gate fails (exit 1)
- [x] Allowed fixture (codex + sandcastle) → gate passes (exit 0)
- [x] Memory pointer exists at .pHive/team-memories/sandcastle-adoption-followon/sandcastle-191.md
