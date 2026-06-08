# Hive Architecture Charter

**Status:** Accepted.

This charter records Hive's implementation-language policy after the accepted
language strategy decision: Python-first with named bridges.

## Language Policy

Python is the canonical language for new business logic.

Node is permitted only in named bridge surfaces. New Node, JavaScript,
TypeScript, MJS, or CJS files outside those surfaces require explicit
maintainer approval before implementation.

Shell is permitted only for Claude Code hook entrypoints and OS sidecar scripts
that must run in the host environment.

Existing non-canonical runtime code is tolerated only when it is listed below
as a bridge or shim. It should not be treated as precedent for new subsystem
ownership.

## Runtime Ownership By Subsystem

| Subsystem | Language | Status |
| --- | --- | --- |
| DAG executor (`hive/lib/dag_executor/`) | Python | Canonical |
| Metrics (`hive/lib/metrics/`) | Python | Canonical |
| KG helpers (`hive/lib/kg_*`, `scripts/kg-*` Python paths) | Python | Canonical |
| Scope drift and scope helpers | Python | Canonical |
| `hive/lib/config.py` | Python | Canonical |
| Meta-experiment and meta-optimize logic | Python | Canonical |
| `hive/lib/multica-story-dispatch/` | Node | Bridge |
| `hive/lib/task-tracking-dispatch/` | Node / TypeScript | Bridge |
| Task-tracking adapters (`hive/adapters/*/`) | Node / TypeScript | Bridge |
| Anthropic session stack (`hive/lib/session-*`, `messages-session.js`) | Node | Bridge |
| Sandcastle provider and worker paths (`hive/lib/sandcastle-*`) | Node | Bridge |
| Claude Code hooks (`hooks/*.sh`) | Shell | Shim |
| OS sidecar and lifecycle scripts that require host shell behavior | Shell | Shim |

## Named Bridge Surfaces

### Sandcastle

Surface: `hive/lib/sandcastle-*`, Sandcastle scaffold assets, and code that
loads `@ai-hero/sandcastle`.

Why Node remains: Sandcastle is a JS-native execution substrate. The current
provider, loader, worker, Docker/Podman factories, and ESM/CJS interop depend
on `@ai-hero/sandcastle`.

Disposition: bridged-indefinite. Sandcastle is an optional maintainer-only
execution mode. It is not Hive's Python core and must remain isolated behind
the bridge.

### Multica Dispatch

Surface: `hive/lib/multica-story-dispatch/`.

Why Node remains: this surface drives Multica issue and task APIs, Codex brief
injection, episode sync, and insight distillation. It is load-bearing for
Multica-routed stories.

Disposition: deferred. Porting requires a dedicated migration plan and parity
tests for dispatch, episode, and brief contracts.

### Anthropic Session Stack

Surface: `hive/lib/session-client.js`, `hive/lib/messages-session.js`,
`hive/lib/session-sse-reader.js`, `hive/lib/session-registry.js`,
`hive/lib/session-episode-writer.js`, `hive/lib/session-prompt-builder.js`,
`hive/lib/session-turn-builder.js`, and `hive/lib/session-end.js`.

Why Node remains: the current implementation uses `@anthropic-ai/sdk`, Node
SSE/HTTP behavior, YAML session registry code, and SQLite closeout logic.

Disposition: deferred. A Python port must be a real SDK and streaming rewrite,
not a line-by-line translation.

### Task-Tracking Adapters

Surface: `hive/lib/task-tracking-dispatch/` and `hive/adapters/*/`.

Why Node remains: the adapter ABI is ESM/TypeScript today and dispatch uses
dynamic import behavior. The adapter logic is portable, but the current ABI is
Node-native.

Disposition: deferred. Revisit when the adapter ABI language contract is
decided.

## Dependency Policy

npm dependencies must be declared in the root `package.json` and locked in the
root lockfile.

Each npm dependency must be scoped to a named bridge surface or an explicitly
optional tool surface. Implicit reliance on transitive installs is not allowed.

Per-surface package manifests may document local commands, but they do not
replace the root dependency manifest.

Python dependencies are stdlib-first. Add third-party Python dependencies only
when the standard library or an existing dependency cannot cover the behavior.

## Cross-Runtime Conformance

`hive/lib/config.py` is the canonical config reader.

Any remaining JavaScript config caller must conform to `config.py` behavior via
a shared conformance fixture.

The state-dir-resolver `sdr-1` direction is Python-primary. Shell and Node
resolvers, where still needed, are compatibility shims rather than co-equal
runtime owners.

## References

- `.pHive/proposals/language-strategy-adr.md` records the accepted Option B
  decision: Python-first with bridges.
- `.pHive/proposals/language-strategy-research.md` records the language
  inventory, bridge analysis, and npm dependency audit used by this charter.
- Context-mode routing rules live in their own file referenced from
  `CLAUDE.md`; they are operational routing policy, not this architecture
  charter.
