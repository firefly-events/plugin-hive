# Sandcastle issue 191 watch

Upstream: https://github.com/mattpocock/sandcastle/issues/191
Current behavior: `claudeCode()` subscription auth is blocked.
Hive scope: Codex-path Sandcastle only.
Unblock condition: upstream supports the Claude subscription lane.

## Details

As of 2026-05-08 spike, `claudeCode()` requires an API key for auth; Pro/Max
subscription auth is unimplemented upstream (#191 open). Hive therefore ships
Sandcastle support via the Codex path only (`codex()` provider). The
`claudeCode()` Sandcastle lane is blocked until upstream resolves this.

## Owner

Epic: sandcastle-adoption-followon (TBD — assign when #191 ships a fix)

## Audit gate

`hive/scripts/gate-claudecode-sandcastle.mjs` enforces this restriction.
It fails CI if any file both imports Sandcastle and calls `claudeCode()`.
Codex-path Sandcastle wiring (`codex()`) is explicitly allowed.

## Cleanup — out of scope for this epic

Removing this watch file and the audit gate after upstream resolution is a
**separate future story** (status-flip work item). Do NOT remove this file or
the gate as part of the sandcastle-adoption-followon epic. A future planner
should create a story when #191 is closed upstream and flip status to resolved.
