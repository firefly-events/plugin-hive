# @hive/task-tracking-dispatch

Hive-side dispatcher for task-tracking adapters that conform to the Hive ABI
(currently 1.x). Loads built-in adapters (`github`, `linear`) or a custom
adapter at a filesystem path, caches the loaded module + capabilities, and
exposes a uniform `invoke(method, params)` surface that maps adapter outcomes
to recoverable vs terminal results.

This is the only entry point skills/hooks/orchestrator code should use to
reach a task tracker. Direct imports of `hive/adapters/<vendor>/index.ts` are
allowed only for adapter tests.

## Public surface

```ts
import { TaskTrackingDispatch } from "@hive/task-tracking-dispatch";

const dispatch = new TaskTrackingDispatch();
await dispatch.load({
  adapter: "github",                // "github" | "linear" | absolute path | null
  adapter_timeout_ms: 30000,
  gate_mode: "warning",             // "warning" (default) | "hard"
  team_value: "firefly-events",
  project_value: "plugin-hive",
  github: { token: process.env.GITHUB_TOKEN ?? null },
  state_dir: ".pHive",
});

const r = await dispatch.invoke("createStory", {
  title: "Story title",
  body: "Body markdown",
  team_value: "firefly-events",
  project_value: "plugin-hive",
});
if (r.ok) {
  // r.result is the adapter's raw return value
} else if (r.recoverable) {
  // RATE_LIMIT — retry after r.retry_after_ms
} else {
  // Terminal — log r.code / r.message and route to the no-tracker fallback
}

dispatch.capability("supports_parent_link"); // -> boolean | undefined
dispatch.hasAdapter; // -> false when adapter is unset
dispatch.abiVersion; // -> e.g. "1.0.0"
```

## Configuration

The dispatcher reads its config from a `task_tracking` block in
`hive.config.yaml`. See the comments in
`hive/hive.config.yaml` (shipped baseline) and the root `hive.config.yaml`
(consumer/maintainer override) for the documented schema.

| Field                | Type      | Default     | Notes                                                                 |
|----------------------|-----------|-------------|-----------------------------------------------------------------------|
| `adapter`            | string \| null | `null`  | `github`, `linear`, or absolute path to a custom ABI 1.x adapter      |
| `adapter_timeout_ms` | number    | `30000`     | Max wall-clock for any single adapter call                            |
| `gate_mode`          | string    | `warning`   | `warning` skips tracker ops; `hard` blocks any call                   |
| `team_value`         | string    | `null`      | Runtime team identifier — passed at invoke time, not at load time     |
| `project_value`      | string    | `null`      | Runtime project identifier                                            |
| `github.token`       | string    | `null`      | Propagated to `GITHUB_TOKEN` env; falls back to `gh auth token`       |
| `linear.api_key`     | string    | `null`      | Propagated to `LINEAR_API_KEY` env                                    |
| `linear.team`        | string    | `null`      | Propagated to `LINEAR_TEAM` env                                       |

## How loading works

1. `load(config)` short-circuits when `config.adapter` is null — no handle is
   loaded and subsequent `invoke()` calls return `NO_ADAPTER` (gated by
   `gate_mode`).
2. A cache key is computed as `SHA-1(JSON.stringify({state_dir, adapter,
   github, linear}))`. Two `load()` calls with the same config share a single
   `dispatch()`-validated handle within the process.
3. Built-in keys (`github`, `linear`) resolve to `hive/adapters/<key>/index.ts`.
   Custom paths must contain a slash and resolve via `path.resolve()` against
   cwd (or be absolute).
4. Adapter-specific sub-config keys (`github.token`, `linear.api_key`,
   `linear.team`) are propagated to env vars before import — adapters read
   their credentials from env at call time.
5. The dispatcher dynamic-imports the adapter as ESM. If the module exports
   an `init(config)` function (current built-in adapters do NOT), the
   dispatcher awaits it for forward compatibility.
6. The dispatcher invokes `dispatch({ method: "capabilities" })`, asserts an
   `abi_version` is present, and rejects any adapter whose major version is
   not in Hive's supported set (currently `[1]`).

## Cache lifetime

The handle cache is a module-scoped `Map<string, AdapterHandle>` with
**per-process lifetime**. There is no TTL and no cross-process persistence.
Restart the host process to force a reload. Tests can clear the cache via
the `__resetHandleCache()` test helper.

## Error mapping

| Outcome on adapter side                                       | Module result                                                  |
|---------------------------------------------------------------|----------------------------------------------------------------|
| `dispatch()` returns a value                                  | `{ ok: true, result }`                                         |
| `dispatch()` throws an `AdapterError` with `code: RATE_LIMIT` | `{ ok: false, recoverable: true, code: "RATE_LIMIT", retry_after_ms }` |
| `dispatch()` throws another ABI-coded `AdapterError`          | `{ ok: false, recoverable: false, code, message }`             |
| `dispatch()` throws an uncaught error                         | `{ ok: false, recoverable: false, code: "INTERNAL_ERROR" }`    |
| `dispatch()` exceeds `adapter_timeout_ms`                     | `{ ok: false, recoverable: false, code: "TIMEOUT" }`           |
| No adapter loaded, `gate_mode=warning`                        | `{ ok: false, recoverable: false, code: "NO_ADAPTER" }` + warning + JSONL telemetry (once per process) |
| No adapter loaded, `gate_mode=hard`                           | `{ ok: false, recoverable: false, code: "NO_ADAPTER" }`        |
| `linkStories` called but `supports_parent_link: false`        | `{ ok: false, recoverable: false, code: "OPERATION_UNSUPPORTED" }` |

ABI-defined error codes (the adapter throws these): `NOT_FOUND`,
`AUTH_FAILURE`, `RATE_LIMIT`, `UNKNOWN_METHOD`, `OPERATION_UNSUPPORTED`. Hive
virtual codes (this module adds): `INTERNAL_ERROR`, `TIMEOUT`, `NO_ADAPTER`.

## Telemetry — no-adapter event

When `gate_mode=warning` and no adapter is configured, the first `invoke()`
of the process appends a JSONL event to
`<state_dir>/metrics/events/task-tracking-no-adapter-<timestamp>.jsonl`:

```json
{
  "event_id": "uuid",
  "timestamp": "2026-05-12T18:42:11.123Z",
  "run_id": "<HIVE_RUN_ID or 'unknown'>",
  "metric_type": "task-tracking-no-adapter",
  "method": "createStory",
  "gate_mode": "warning"
}
```

This event is best-effort; filesystem errors are swallowed and never block
the caller. Subsequent `invoke()` calls within the same process do not
re-emit (warning + telemetry are emitted at most once per process).

## Running the tests

```bash
cd hive/lib/task-tracking-dispatch
npm install
npm test
```

The suite uses mock-adapter ESM fixtures (in `test/fixtures/`) plus the
real built-in adapter paths to validate path resolution. No network is hit.
