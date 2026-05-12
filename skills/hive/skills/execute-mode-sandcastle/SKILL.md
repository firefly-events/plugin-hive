---
name: execute-mode-sandcastle
description: Run story dispatch inside a Sandcastle container sandbox. Codex-path-only. Provider wrapper usage, split worktree ownership, and lifecycle-hook boundary required.
---

# Hive Mode — Sandcastle

Atomic skill, NOT inline `/execute` prose. Runs the Sandcastle container-sandbox execution mode for a workflow. The caller (the dispatch skill plus `/execute`) selects this mode and hands off the inputs below; this skill owns the Sandcastle provider lifecycle from runtime preflight through worktree teardown.

This mode is **Codex-path-only**. The `claudeCode()` subscription lane is blocked by upstream issue #191. Subscription-lane support is deferred to a future story — do NOT attempt to wire `claudeCode()` in this mode.

## Preconditions

Before entering this mode:

1. Run `/hive:sandbox-setup` to authenticate and verify the container runtime. This is the only supported setup path — do not shortcut it.
2. Confirm `.sandcastle/` has a `.gitignore` entry. This is a **ship gate**: the mode must not proceed if `.sandcastle/` is tracked by git. Presence of a `.gitignore` rule for `.sandcastle/` (or an encompassing pattern) is required.

## Required runtime preflight

`@ai-hero/sandcastle >=0.5.10 <0.6.0` is required.

The mode **must bail before any auth, hook, or provider setup** if the installed version falls outside this range. Do not construct the provider, register hooks, or attempt authentication before preflight passes.

Preflight is implemented in `hive/lib/sandcastle-provider.js` via `runVersionPreflight()`. Callers **must use the wrapper** — `createSandcastleProvider(options)` — and must NOT construct `SandboxProvider` inline. The wrapper enforces this preflight as its first operation (before logger wrapping, before provider construction).

If preflight throws, propagate the error to the caller immediately and abort the mode.

## Provider construction

Import and call `createSandcastleProvider` from `hive/lib/sandcastle-provider.js`:

```js
const { createSandcastleProvider } = require('hive/lib/sandcastle-provider');
const { sandboxProvider, createWorktree } = createSandcastleProvider(options);
```

**Default options (do not override without explicit need):**

| Option | Default | Notes |
|---|---|---|
| `useDocker` | `false` | Podman is the default runtime |
| `userns` | `false` | Hard-coded in wrapper; do NOT set `userns: true` |
| Mount | `.sandcastle/codex-config` → `/home/agent/.codex` | Codex config host path mounted into sandbox |
| `imageName` | `sandcastle:hive` | Override only if the story spec requires a custom image |

Docker is opt-in: set `options.useDocker = true` only when the story spec or config explicitly requests Docker. Default Podman with `userns: false` is the correct choice for macOS parallel runs.

The wrapper also wraps the logger with redaction before constructing the provider — this is why inline `SandboxProvider` construction is prohibited. Auth token leakage in logs is the failure mode inline construction causes.

## Worktree ownership

```
Do not call `wt.close()` for a legacy `.claude/worktrees/{story-id}`
worktree handed in by another owner.
Do call `wt.close()` for the Sandcastle-created worktree before
returning from the Sandcastle run path.
```

The split rule in full:

- **Sandcastle-created worktree** (`createWorktree(storyId)` return value): this mode owns `wt.close()`. Call it before the mode returns on both the success path and the failure/abort path. Failing to close leaks the container sandbox.
- **Legacy `.claude/worktrees/{story-id}` worktree handed in by another owner**: this mode does NOT own `wt.close()`. The owner that created and passed the worktree is responsible for closing it. Calling `wt.close()` here causes double-cleanup.

Ownership is determined by who called `createWorktree`. If this mode called `createWorktree`, this mode closes. If the parent handed in a worktree object, do not close it.

## Hooks

Sandcastle hooks are **lifecycle hooks** (worktree/container layer). They are **NOT** Hive PreToolUse hooks. Do not confuse the two systems.

**V1 hook points (supported):**

| Hook | Layer | When it fires |
|---|---|---|
| `host.onWorktreeReady` | Host | After worktree is prepared, before container starts |

Pass `host.onWorktreeReady` commands via `options.hooks.host.onWorktreeReady` as an array of `HostHookCmd` objects: `{ command: string; timeoutMs?: number }`.

**HostHookCmd constraints** (enforced by wrapper):
- No `sudo` key.
- No `cwd` key.
- `command` must be a non-empty string.

**V1 deferred hook points (do NOT pass):**

`host.onSandboxReady` and `sandbox.onSandboxReady` are deferred. The wrapper throws if you attempt to pass them. Do not add them until a real consumer story requires them.

## Invocation contract

Call this skill once per parent workflow when `mode_decision == sandcastle` was returned by the dispatch atom.

**Inputs:**
- `workflow_path` — path to the resolved workflow YAML.
- `unblocked_stories[]` — ordered list of story specs whose `depends_on` is satisfied at start.
- `epic_handle` — the parent epic identifier (used for branch naming and episode markers).
- `hive_config` — parsed root `hive.config.yaml` for `agent_backends`, `model_overrides`, and any Sandcastle-specific config.

**Outputs:**
- Episode markers written under the parent's episode write path.
- Per-story commits on the current epic feature branch.
- Sandcastle worktrees closed on both success and failure paths.

## Process

### Step 1: Precondition check

Verify both preconditions (sandbox-setup complete, `.sandcastle/` gitignored). Abort with a clear error message if either fails. Do not proceed to preflight on a failed precondition check.

### Step 2: Runtime preflight

Call `createSandcastleProvider(options)`. The wrapper runs preflight automatically as its first operation. If it throws, propagate and abort.

### Step 3: Create worktree

For each story, call `createWorktree(storyId)` from the returned provider pair. Track the returned `wt` object — this mode owns its `wt.close()`.

### Step 4: Invoke Codex

Pass the worktree and sandbox context to the Codex invocation path. The `claudeCode()` subscription lane is unavailable — Codex-path only.

### Step 5: Teardown

On story completion (success or failure): call `wt.close()` for each Sandcastle-created worktree before returning. This step is mandatory on ALL exit paths including aborts. Do not skip teardown on failure paths.

## Constraint summary

| Rule | Enforcement |
|---|---|
| Use `createSandcastleProvider` wrapper | Acceptance criterion — never construct `SandboxProvider` inline |
| Preflight before auth/hooks/provider | Wrapper enforces; mode must not swallow the throw |
| `wt.close()` only on Sandcastle-created worktrees | Split ownership rule above |
| Codex-path only | `claudeCode()` deferred per upstream #191 |
| `.sandcastle/` gitignored | Ship gate — checked at Step 1 |
| `/hive:sandbox-setup` run first | Precondition — checked at Step 1 |
