# Episode: s5-hooks-reference

**Story:** s5-hooks-reference  
**Epic:** sandcastle-adoption-followon  
**Agent:** technical-writer  
**Date:** 2026-05-12  
**Status:** complete

## What was done

Created `hive/references/sandcastle-hooks-reference.md` — the minimal V1 hooks reference for
Sandcastle adoption. The document covers:

- Layer-boundary distinction: Sandcastle lifecycle hooks vs Hive PreToolUse/PostToolUse hooks
- V1 hook surface: only `host.onWorktreeReady` wired
- Full hook shape type signatures (`HostHookCmd`, `SandboxHookCmd`)
- Provider-wrapper enforcement: deferred keys rejected at option boundary, `HostHookCmd` shape
  validated (rejects `sudo` + `cwd`), fail-fast on non-zero exit
- Usage example
- Explicit out-of-scope list for V1
- Cross-references to provider wrapper and test file

## Discovery notes

- `hive/lib/sandcastle-provider.js` — Step 0 validates hook options before version preflight;
  hook wiring happens after SandboxProvider construction. Both deferred key rejection and
  HostHookCmd shape validation confirmed from source.
- `tests/hive-lib/sandcastle-provider-hooks.test.js` confirmed present on disk.
- Work spec specified output path as `sandcastle-hooks-reference.md`; YAML key_files used
  `sandcastle-hooks-minimal.md`. Used the task-prompt path as authoritative.

## Insights

- The layer-distinction callout at the top of hooks references is high-value for this domain:
  "lifecycle hook" and "tool hook" sound similar but operate at completely different layers.
  Leading with a bold callout box prevents the most common misread.
