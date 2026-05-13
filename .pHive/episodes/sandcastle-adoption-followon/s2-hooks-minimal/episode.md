# Episode: s2-hooks-minimal

**Story:** s2-hooks-minimal — Wire only host.onWorktreeReady for copyToWorktree preparation
**Epic:** sandcastle-adoption-followon
**Timestamp:** 2026-05-12
**Commit SHA:** 83d559c
**Branch:** feat/sandcastle-adoption-followon

## Files touched

- `hive/lib/sandcastle-provider.js` — extended with hook option surface, validation, and pass-through
- `tests/hive-lib/sandcastle-provider-hooks.test.js` — new test file (14 tests)

## Test counts

| Suite | Tests | Pass | Fail |
|-------|-------|------|------|
| sandcastle-provider.test.js (regression) | 15 | 15 | 0 |
| sandcastle-provider-hooks.test.js (new) | 14 | 14 | 0 |
| **Total** | **29** | **29** | **0** |

## Implementation summary

- Added Step 0 validation block before version preflight: rejects `host.onSandboxReady` and `sandbox.onSandboxReady` with explicit V1-contract error messages referencing user-decisions-b1.md.
- Validates `HostHookCmd` shape: rejects entries with `sudo` or `cwd` (not part of HostHookCmd contract).
- Wires `hooks.host.onWorktreeReady` into `sandboxOptions.hooks` only when the array is non-empty (opt-in default leaves hooks absent).
- Inline comment at hook wiring site: "Sandcastle hooks are lifecycle hooks (worktree/container layer), NOT Hive PreToolUse hooks. See user-decisions-b1.md."
- No changes to /execute routing, package.json, redaction module, or sandbox-setup skill.

## Key decisions

- Deferred hook points rejected explicitly (not silently stripped) for clearest V1 contract.
- Empty `onWorktreeReady` array → no `hooks` key on provider (opt-in is real).
- `HostHookCmd` shape validated at wrapper boundary (only valid keys: `command`, `timeoutMs`).
