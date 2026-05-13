# Sandcastle warm-pool placeholder

V1 creates a fresh sandbox per run.
Deferred option: long-lived `createSandbox()` warm pool.
Trigger: measured cold-start cost becomes material.
Non-goal: no V1 provider-wrapper runtime change.

---

## Current state (V1)

The provider wrapper at `hive/lib/sandcastle-provider.js` creates a new
sandbox for every execution request. The Sandcastle `createSandbox()` call
is made at the start of each run and the resulting sandbox is closed after
the run completes. Cold-start overhead is therefore incurred on every run.

This is intentional for V1: correctness and isolation take priority over
startup latency. The warm-pool pattern is explicitly parked as future work.

## Deferred optimization: long-lived warm pool

Sandcastle exposes a `createSandbox()` primitive that is compatible with a
warm-pool pattern: a small set of pre-initialized sandboxes held open
between runs and leased out on demand. V1 does **not** use this pattern.

When the warm-pool pattern is adopted, the expected implementation surface
would be:

- A new module (e.g. `hive/lib/sandcastle-pool.js`) that owns the pool
  lifecycle — initialization, leasing, release, and drain on shutdown.
- `hive/lib/sandcastle-provider.js` updated to acquire a sandbox from the
  pool instead of calling `createSandbox()` inline.
- Lifecycle integration with `wt.close()`: the pool drain must be called
  before the worktree is closed, or the borrowed sandbox returned to the
  pool if the run completes normally. Ownership of `wt.close()` and pool
  drain must be clearly sequenced to avoid leaked open sandboxes.
- Pool-size configuration lives in the provider options or `hive.config.yaml`;
  no auto-tuning logic is in scope for the initial warm-pool story.

## Trigger conditions for future adoption

The warm-pool pattern should be considered **when measured cold-start cost
becomes material against per-run elapsed time** — that is, when profiling
or telemetry shows that sandbox initialization is a dominant fraction of
total execution time.

Do not adopt the warm-pool pattern based on assumed or estimated latency.
Wait for evidence from a `performance:audit` post-execution phase or
equivalent instrumentation before opening a follow-on story.

## Non-goals (explicit)

The following are explicitly **out of scope** for this placeholder and for
any story that directly descends from it:

- **V1 provider-wrapper runtime change** — `hive/lib/sandcastle-provider.js`
  is unchanged by this story. No warm-pool behavior is added.
- **YAML config surface for pool size** — no `hive.config.yaml` key for
  pool size is introduced here.
- **Auto-tuning logic** — adaptive pool sizing based on run history or
  concurrency signals is a separate, later concern.

## Future story shape

When cold-start evidence justifies action, a follow-on story should:

1. Add `hive/lib/sandcastle-pool.js` with acquire/release/drain API.
2. Update `hive/lib/sandcastle-provider.js` to delegate sandbox creation
   to the pool.
3. Add pool lifecycle tests, including drain-on-close behavior.
4. Optionally expose `execution.sandcastle.warmPoolSize` in
   `hive.config.yaml` with a conservative default (e.g. 2).

This story is doc-only. The implementation above is a sketch only.
