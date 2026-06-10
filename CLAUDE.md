# Hive — Project Charter

Hive is an extensible multi-agent SDLC framework, packaged as a Claude Code plugin.
This file is the **project charter**: the implementation-language policy and runtime
ownership that govern all new work. The full decision record is
`.pHive/proposals/language-strategy-adr.md` (accepted: Option B — Python-first with
bridges). Domain glossary + conventions live in `.pHive/CONTEXT.md`.

> The mandatory **context-mode routing rules** (context-window protection) are not
> repeated here — they live in `.claude/context-mode.md` and are imported at the
> bottom of this file. Read them; they are operational policy, not optional.

## Language Policy

Python is the canonical language for new business logic.

Node is permitted only in named bridge surfaces. New Node, JavaScript, TypeScript,
MJS, or CJS files outside those surfaces require explicit maintainer approval before
implementation.

Shell is permitted only for Claude Code hook entrypoints and OS sidecar scripts that
must run in the host environment.

Existing non-canonical runtime code is tolerated only when it is listed below as a
bridge or shim. It must not be treated as precedent for new subsystem ownership.

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
| Task-tracking adapters | Node / TypeScript | Bridge |
| Anthropic session stack (`hive/lib/session-*`, `messages-session.js`) | Node | Bridge |
| Sandcastle provider and worker paths (`hive/lib/sandcastle-*`) | Node | Bridge |
| Claude Code hooks (`hooks/*.sh`) | Shell | Shim |
| OS sidecar / lifecycle scripts requiring host shell behavior | Shell | Shim |

## Named Bridge Surfaces

The only places Node is permitted long-term. Each shrinks as the Python-first
migration proceeds.

- **Sandcastle** (`hive/lib/sandcastle-*`, loads `@ai-hero/sandcastle`) — JS-native
  execution substrate. **Optional maintainer-only execution mode**, bridged-indefinite;
  not Hive's core. Must stay isolated behind the bridge.
- **Multica dispatch** (`hive/lib/multica-story-dispatch/`) — drives Multica issue/task
  APIs, Codex brief injection, episode sync, insight distill. Load-bearing for
  Multica-routed stories. Disposition: deferred (needs a dedicated port + parity tests).
- **Anthropic session stack** (`hive/lib/session-*`, `messages-session.js`) — uses
  `@anthropic-ai/sdk`, Node SSE/HTTP, SQLite closeout. Disposition: deferred (a real
  SDK + streaming rewrite, not a translation).
- **Task-tracking adapters** (`hive/lib/task-tracking-dispatch/` + adapters) — ESM/TS
  ABI with dynamic import. Disposition: deferred (revisit when the adapter ABI language
  contract is decided).

## Dependency Policy

npm dependencies must be declared in the root `package.json` and locked in the root
lockfile, each scoped to a named bridge surface (or an explicitly optional tool
surface). Implicit reliance on transitive installs is not allowed; per-surface
manifests may document local commands but do not replace the root manifest.

Python dependencies are stdlib-first. Add a third-party Python dependency only when
the standard library or an existing dependency cannot cover the behavior.

## Cross-Runtime Conformance

`hive/lib/config.py` is the canonical config reader. Any remaining JavaScript config
caller must conform to its behavior via a shared conformance fixture. The
state-dir-resolver `sdr-1` resolver is Python-primary; shell and Node resolvers, where
still needed, are compatibility shims rather than co-equal runtime owners.

## References

- `.pHive/proposals/language-strategy-adr.md` — accepted Option B decision.
- `.pHive/proposals/language-strategy-research.md` — language inventory, bridge
  analysis, npm dependency audit.
- `.pHive/CONTEXT.md` — domain glossary + conventions.

---

@.claude/context-mode.md
