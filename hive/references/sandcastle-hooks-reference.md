# Sandcastle Hooks Reference — V1 Minimal

**Purpose:** Minimal V1 hook contract for Sandcastle adoption — wires only `host.onWorktreeReady`.

> **IMPORTANT — layer distinction:** Sandcastle hooks are **lifecycle hooks** operating at the
> worktree/container layer. They are **NOT** Hive `PreToolUse` or `PostToolUse` hooks. Do not
> confuse the two: Hive tool-hooks intercept Claude tool calls; Sandcastle lifecycle hooks run
> shell commands at container-setup milestones (worktree ready, sandbox ready). They serve
> entirely different purposes and live at entirely different layers.

---

## V1 Hook Surface

**Wired in V1:** `host.onWorktreeReady` only.

**Purpose of `host.onWorktreeReady`:** Runs on the host machine after the worktree is prepared
but before the sandbox container starts. Use it to copy persona files, memory directory paths,
and an in-worktree config snapshot into the worktree so agent code finds them on startup.

**Not wired in V1 (deferred):**

| Hook point | Status |
|---|---|
| `host.onSandboxReady` | Deferred — not wired; rejected at the option boundary |
| `sandbox.onSandboxReady` | Deferred — not wired; rejected at the option boundary |

Adding deferred hook points requires a future work item with a real consumer use case.

---

## Hook Shape

```
hooks: {
  host: {
    onWorktreeReady?: HostHookCmd[];   // V1: wired
    onSandboxReady?:  HostHookCmd[];   // V1: deferred — provider rejects this key
  };
  sandbox: {
    onSandboxReady?: SandboxHookCmd[]; // V1: deferred — provider rejects this key
  };
}

HostHookCmd    = { command: string; timeoutMs?: number }
SandboxHookCmd = { command: string; sudo?: boolean; timeoutMs?: number }
```

Note: `HostHookCmd` intentionally omits `sudo` and `cwd`. The provider wrapper rejects both at
the option boundary (see "Provider-Wrapper Contract" below).

---

## Provider-Wrapper Contract

The wrapper at `hive/lib/sandcastle-provider.js` enforces the V1 minimal-hooks contract at call
time (option boundary), before any Sandcastle module is constructed:

1. **Deferred hook points rejected:** Passing `hooks.host.onSandboxReady` or
   `hooks.sandbox.onSandboxReady` throws immediately with a message directing the caller to
   the user-decisions doc.

2. **`HostHookCmd` shape validated:** Each entry in `hooks.host.onWorktreeReady` must be a
   non-null object with a non-empty `command` string. The wrapper rejects:
   - `sudo` — not allowed on host hooks
   - `cwd` — not allowed on host hooks

3. **Fail-fast semantics:** If a host hook command exits non-zero, setup bails before agent
   code runs. No partial worktree state is silently passed downstream.

---

## Usage Example

```js
const { createSandcastleProvider } = require('./hive/lib/sandcastle-provider');

const { sandboxProvider, createWorktree } = createSandcastleProvider({
  hooks: {
    host: {
      onWorktreeReady: [
        { command: 'cp -r .pHive/agents/personas worktree/personas' },
        { command: 'cp hive.config.yaml worktree/hive.config.yaml', timeoutMs: 5000 },
      ],
    },
    // Do NOT pass host.onSandboxReady or sandbox.onSandboxReady — provider rejects them in V1.
  },
});
```

---

## Out of Scope for V1

The following are explicitly deferred and must not be configured via the provider wrapper:

- YAML config surface for hooks (provider-wrapper options API only in V1)
- `sudo` in host hooks
- `cwd` in host hooks
- Sandbox-side hooks (`sandbox.onSandboxReady`)

---

## Cross-References

- **Provider wrapper implementation:** `hive/lib/sandcastle-provider.js` — hook validation logic
  at Step 0, hook wiring at "Hook wiring — V1 minimal" comment block.
- **Hook tests:** `tests/hive-lib/sandcastle-provider-hooks.test.js` — covers deferred-key
  rejection, `HostHookCmd` shape validation (`sudo`/`cwd` rejection), and happy-path wiring.
- **User decisions:** `.pHive/epics/sandcastle-adoption-followon/docs/user-decisions-b1.md` Q4 —
  authoritative minimal-hooks decision rationale.
