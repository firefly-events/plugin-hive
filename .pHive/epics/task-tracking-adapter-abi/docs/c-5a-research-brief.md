# Research Brief — c-5a Dispatch Module + Config Schema

**RESEARCH_BRIEF_FOR:** `c-5a-dispatch-module-and-config-schema`
**Wave:** W4 | **Methodology:** classic | **Branch:** `feat/task-tracking-adapter-abi`
**Depends on:** c-3 (GitHub adapter), c-4 (Linear adapter), c-2 (ABI spec)

---

## SOURCES_READ

1. `hive/references/task-tracking-adapter-abi.md` — full ABI 1.0.0 wire contract
2. `hive/adapters/github/index.ts` — built-in adapter #1 (TypeScript, ESM, tsx)
3. `hive/adapters/linear/index.ts` — built-in adapter #2 (TypeScript, ESM, tsx)
4. `hive/adapters/github/package.json` + `hive/adapters/linear/package.json` — `"type": "module"`, `tsx ^4.21`, Node ≥18
5. `hive.config.yaml` (root) + `hive/hive.config.yaml` (shipped baseline) — current `task_tracking:` block
6. `.pHive/metrics/metrics-event.schema.md` — canonical JSONL row shape (`event_id`, `timestamp`, `run_id`, ...)
7. `hive/lib/metrics/README.md` — runtime primitives (`append_event(event_dict, run_id)`, `METRICS_ROOT`, `MetricsPathBoundaryError`)
8. `.pHive/epics/catalog-hygiene-and-borrows/stories/w1-warning-lift.yaml` — only existing **shipped** gate-mode-shaped story (5 read-only skills; warn-don't-block pattern); references Epic B's `paths.gate_mode` knob as future fold-in
9. `.pHive/epics/task-tracking-adapter-abi/stories/c-5a-…yaml` — own story spec (AC, design decisions, risks)
10. `.pHive/epics/task-tracking-adapter-abi/stories/c-5b-…yaml` — sibling story (skill citation swap; consumes this module)

**Confirmed absent:** `.pHive/epics/structural-refactor-and-gate-lift/stories/a-33-*.yaml` does **not** exist on disk yet. Epic B exists at `.pHive/epics/structural-refactor-and-gate-lift/epic.yaml` only; stories not yet planned. The c-5a story cites a-33 aspirationally — we must **infer** `paths.gate_mode` semantics from w1-warning-lift and the c-5a/c-5b/c-6 cross-references.

---

## PATTERNS_OBSERVED

### Adapter API surface (c-3, c-4)

Both adapters export an in-process `dispatch(req)`:

```ts
export async function dispatch(req: { method: string; params?: any }): Promise<any>
```

- **Returns:** raw result object on success (the adapter's method return value).
- **Throws:** `AdapterError` (subclass of `Error`) with fields `{ code: ErrorCode, message, retry_after_ms: number | null }`.
- **ErrorCode enum:** `"NOT_FOUND" | "AUTH_FAILURE" | "RATE_LIMIT" | "UNKNOWN_METHOD" | "OPERATION_UNSUPPORTED"` (adapter-emitted, closed set per ABI).
- The wire-format envelope (`{result}` / `{error}` + exit code) is constructed only in `main()` for stdin/stdout CLI invocation — `dispatch()` itself is **callable directly** from Hive in-process.
- Both expose 8 methods (the 7 ABI methods + `capabilities`): `capabilities, createStory, updateStatus, listOpen, getStory, addComment, linkStories, setAssignee`.
- Both also export test seams: `__setFetch`, `__resetCache` (Linear), `validateStoryId`, `toAbiStory`, `toAbiStorySubset`.
- No `init(config)` function exists — adapters configure via env vars (`GITHUB_TOKEN`, `gh auth token`; `LINEAR_API_KEY`, `LINEAR_TEAM`). **Important:** the c-5a story spec mentions `adapter.init(config)`, but the shipped c-3/c-4 adapters do **not** export `init`. Dispatch must either (a) call `init` if present (optional probe) or (b) just pre-populate env vars from config before importing.
- `capabilities()` is async and idempotent; both return a fully populated object literal (no I/O), so caching is essentially free.
- Adapter `package.json` declares `"type": "module"` and uses ESM imports. Both files have `#!/usr/bin/env tsx` (Linear) or `#!/usr/bin/env node` (GitHub) shebangs.

### ABI capability declaration (per spec)

```ts
interface Capability {
  abi_version: string;       // semver — "1.0.0" today
  hierarchy: "flat" | "hierarchical" | "mixed";
  supports_parent_link: boolean;
  supported_labels: string[] | null;     // null = open vocabulary
  supported_states: string[];
  metadata: { team_field: string | null; project_field: string | null };
}
```

Hive caches capability **once per session** and reads from cache thereafter (ABI spec: Subprocess Lifecycle § Capability caching).

### Config shape (current state)

`hive.config.yaml` already has a `task_tracking:` block that lists `linear_*` fields with a note: "Set adapter to enable. All linear_* fields required when adapter: linear." No `adapter:` key is currently active; the schema delta is to **formalize** `adapter:` and document `github` / `linear` / `<path>` as valid values.

```yaml
task_tracking:
  adapter: null              # null | github | linear | /abs/path/to/custom-adapter
  adapter_timeout_ms: 30000  # default; matches ABI spec § Hive-side timeout
  github:
    owner: firefly-events
    repo: plugin-hive
  linear:
    team_id: ACME
    # ...
```

`paths.gate_mode` is **not** present in either config file today — c-5a will read it from `paths.gate_mode` with a default. The default must be `warning` (matches w1's "warn don't block" precedent for read-only skills) — but for task-tracking the safe default is `hard` so consumers must opt in to silent no-adapter mode. Story design_decisions don't pin this; recommend **defaulting to `warning`** to match the broader gate-lift direction (Epic B fold-in goal), with hard-mode as opt-in for strict shops.

### JSONL telemetry shape (from `.pHive/metrics/metrics-event.schema.md`)

Required fields per event row (`.pHive/metrics/events/*.jsonl`, append-only, one JSON object per line):

- `event_id` (string, required) — e.g. `evt_2026-05-12T14:03:11Z_0001`
- `timestamp` (ISO-8601 string, required)
- `run_id` (string, required)
- `swarm_id` (optional)
- `story_id` / `proposal_id` (one-of required)
- `phase` (optional)
- `agent` (optional)
- `metric_type` (optional)

**File naming:** the schema says `events/{run_id}.jsonl` (events grouped by run_id, not per-event-type). The c-5a AC says `task-tracking-no-adapter-<ISO>.jsonl` (per-event-type file). These are in tension; the story's note that telemetry "mirrors a-33/a-35 JSONL shape" implies Epic B will define a fan-out family. **Recommendation:** Follow the story's spelled-out path (`task-tracking-no-adapter-<ISO>.jsonl`) — Epic B's audit script will glob `events/*.jsonl` anyway. Inside, use the schema field set (`event_id`, `timestamp`, `run_id`, plus event-specific payload).

### Existing JSONL writer

`hive/lib/metrics/` exposes a **Python** primitive `append_event(event_dict, run_id)` — but the dispatch module is TypeScript. No TS JSONL writer exists yet. Dispatch will need to either:

- (a) Write JSONL directly with `fs.appendFileSync` (simple, no cross-language coupling), or
- (b) Add a TS sibling to `hive/lib/metrics/` for symmetry (out of scope for c-5a).

Recommendation: **(a)** — inline `appendFileSync` keeps c-5a tight.

### Module structure conventions

`hive/lib/` currently hosts only `metrics/` (Python). No prior TypeScript module exists under `hive/lib/`. The new module at `hive/lib/task-tracking-dispatch/index.ts` is greenfield. Match the adapter convention: `"type": "module"`, ESM, tsx-runnable, no compile step.

---

## CONSTRAINTS

1. **Adapters do not export `init(config)`.** The c-5a story spec assumes they do. Dispatch must adapt: probe for `init` (call if present), else propagate config to env vars before first invoke.
2. **TypeScript ESM, no build step.** Dynamic import resolves `.ts` because tsx loader is active. Built-in adapter names (`github` / `linear`) resolve to `hive/adapters/github/index.ts` and `hive/adapters/linear/index.ts`. Custom paths are absolute file paths; the dispatch must `import(pathToFileURL(...).href)` for filesystem paths.
3. **Hierarchy-agnostic.** No `if adapter === "github"` branches inside dispatch (reviewer gate criterion #1). All hierarchy/labels/states behavior is read from `capabilities()` cache.
4. **Session cache, not per-invocation reload.** Cache key MUST include resolved state_dir + adapter config hash (story risk mitigation: cross-project handle leak).
5. **ABI version check at load.** Compare `capabilities.abi_version` major against Hive's supported ABI major (currently `1`). Mismatch = terminal error at load time.
6. **Backward-compat: dispatch is unused until c-5b.** No skill citations swap in this story. Module must be safe to ship dark.
7. **`paths.gate_mode` semantics:** `warning` = emit warning + JSONL + proceed (no-adapter calls return `null` or capability-defaulted no-op); `hard` = throw terminal error on first invoke when no adapter loaded (preserves pre-Epic-B behavior byte-equivalently for strict consumers).
8. **30s default subprocess timeout** per ABI § Hive-side timeout. **Not applicable** to in-process dispatch (no subprocess) — but `adapter_timeout_ms` config key should still parse, even if it's a no-op for the v1 in-process form factor.

---

## RISKS

| Severity | Risk | Mitigation |
|---|---|---|
| Medium | Custom adapter at arbitrary fs path is code-injection vector | Document loud warning in README; require absolute paths; future: signed adapters or sandboxing |
| Medium | Adapter doesn't export `init(config)` — c-5a spec mismatches reality | Probe for `init` optionally; propagate config to env vars before first call as fallback |
| Low | Session cache leaks handle across project boundaries | Cache key includes resolved `state_dir` + JSON-hash of adapter config |
| Low | ABI major mismatch silently accepted | `load()` compares `capabilities.abi_version` major; rejects with terminal error |
| Low | JSONL file-naming mismatch with Epic B audit script (a-36) | Follow story-spec path; Epic B globs `events/*.jsonl` so prefix-based naming is forward-compat |
| Low | Adapter throws unexpected non-AdapterError exception | Wrap all `dispatch.invoke` calls in `try/catch`; map unknown throws to terminal `INTERNAL_ERROR` virtual code |

---

## FINDINGS

### F1 — `gate_mode` semantics (inferred from w1 + c-5a)

Epic B's `paths.gate_mode` knob has not landed yet; only w1-warning-lift's "warn-don't-block" pattern is shipped. Inferred semantics for c-5a:

- **`warning`** (recommended default): no-adapter calls return a no-op result (e.g. `null` story_id) + emit a structured warning to stderr + write a JSONL row to `.pHive/metrics/events/task-tracking-no-adapter-<ISO>.jsonl`. Skills proceed.
- **`hard`**: no-adapter calls throw a terminal error. Mirrors pre-Epic-B byte-equivalent behavior so strict consumers can pin to the old block-on-missing-config posture.

Pre-Epic-B default policy stance: task-tracking is opt-in already (current config has `adapter: null` baseline). Defaulting `gate_mode: warning` lets c-5b skill citations call dispatch safely without crashing un-configured consumers.

### F2 — Existing JSONL event shape

Canonical fields: `event_id`, `timestamp` (ISO-8601), `run_id`, plus optional `swarm_id`, `story_id` / `proposal_id` (one-of), `phase`, `agent`, `metric_type`. For no-adapter telemetry:

```json
{
  "event_id": "evt_2026-05-12T14:03:11Z_no-adapter_0001",
  "timestamp": "2026-05-12T14:03:11Z",
  "run_id": "<session-run-id-or-`adhoc-<iso>`>",
  "phase": "task_tracking_dispatch",
  "metric_type": "task-tracking-no-adapter",
  "event_type": "task_tracking_no_adapter",
  "method": "createStory",
  "gate_mode": "warning"
}
```

`event_type` is **not** in the canonical schema — but the schema explicitly allows additional payload fields per event family. Use `metric_type: "task-tracking-no-adapter"` as the canonical discriminator; include `event_type` as a convenience alias for grep readability.

### F3 — Module loading approach: **direct ESM dynamic import**, not subprocess spawn

**Decision:** Hive-side dispatch imports the adapter module directly via `import()` and calls `adapter.dispatch(req)` in-process. This deviates from the ABI spec's "Subprocess Lifecycle" section (which describes the CLI wire format for external/cross-language adapters) but is **explicitly permitted** because the shipped GitHub + Linear adapters export `dispatch()` for direct call. The CLI form factor is for *custom-language* adapters; built-in TypeScript adapters can be called in-process for performance.

Rationale:
- No subprocess overhead (the c-3/c-4 adapters were designed with the `dispatch` export precisely to enable this).
- Adapter auth handshake (env-var driven today) happens once per session via module-scope caching inside the adapter (e.g. Linear's `_teamMetadataCache` + `__resetCache` test seam).
- Trade-off: subprocess timeout (`adapter_timeout_ms`) doesn't directly apply; replace with `Promise.race` against `setTimeout` for runaway-call protection.

Custom adapters at arbitrary filesystem paths: same in-process dynamic import, using `pathToFileURL` to resolve absolute paths to file URLs for ESM compat.

For future: if a non-TS custom adapter is configured (e.g. a `.sh` or `.py` script), dispatch detects non-`.ts`/`.js`/`.mjs` extension and falls back to spawn-subprocess form. **Out of scope for c-5a** — the story explicitly handles only the built-in adapter shape today; spawn fallback is c-6 or later.

### F4 — Recommended Dispatch API signature

```ts
// hive/lib/task-tracking-dispatch/index.ts

export interface TaskTrackingConfig {
  adapter: 'github' | 'linear' | string | null;  // null = no adapter; bare strings are built-in names; absolute paths are custom adapters
  adapter_timeout_ms?: number;                   // default 30000; v1 in-process uses Promise.race
  gate_mode?: 'warning' | 'hard';                // default 'warning'
  state_dir?: string;                            // resolved .pHive/ root; used for telemetry path + cache key
  // adapter-specific sub-blocks passed verbatim as env vars during load:
  github?: { owner?: string; repo?: string; token?: string };
  linear?: { team_id?: string; api_key?: string; project?: string };
  [k: string]: unknown;                          // forward-compat for custom adapter config
}

export type DispatchResult<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; recoverable: boolean; code: string; message: string; retry_after_ms?: number };

export interface AdapterHandle {
  dispatch(req: { method: string; params?: unknown }): Promise<unknown>;
  // optional probes (built-in adapters today export neither):
  init?(config: TaskTrackingConfig): Promise<void> | void;
  capabilities?(): Promise<Capability>;
}

export class TaskTrackingDispatch {
  // Module-scoped cache; per-process lifetime
  private static cache = new Map<string, { handle: AdapterHandle; cap: Capability }>();

  async load(config: TaskTrackingConfig): Promise<void>;
  async invoke<T = unknown>(method: string, params?: unknown): Promise<DispatchResult<T>>;
  async capability<K extends keyof Capability>(field: K): Promise<Capability[K]>;
  get hasAdapter(): boolean;

  // For testing only
  static __resetCache(): void;
}
```

**Error mapping** inside `invoke`:

- Adapter throws `AdapterError` with `code: "RATE_LIMIT"` → `{ ok: false, recoverable: true, code, message, retry_after_ms }`
- Adapter throws `AdapterError` with `code: "AUTH_FAILURE" | "UNKNOWN_METHOD" | "OPERATION_UNSUPPORTED"` → `{ ok: false, recoverable: false, code, message }`
- Adapter throws `AdapterError` with `code: "NOT_FOUND"` → `{ ok: false, recoverable: false, code, message }` (caller-recoverable but adapter-terminal — caller decides)
- Adapter throws non-AdapterError → wrap as terminal `INTERNAL_ERROR` (Hive-generated virtual code per ABI § Error Model)
- Timeout → terminal `TIMEOUT` (Hive-generated virtual code per ABI § Error Model)
- No adapter loaded + `gate_mode: warning` → emit JSONL + return `{ ok: true, result: null }` (callers MUST treat null as no-op)
- No adapter loaded + `gate_mode: hard` → `{ ok: false, recoverable: false, code: "NO_ADAPTER", message: "..." }`

### F5 — Session cache strategy

- **Cache key:** SHA-1 hex of `JSON.stringify({ state_dir, adapter, github?, linear?, ...adapterSubConfig })` (deterministic + handles config drift cleanly).
- **Lifetime:** module-scoped `Map`. Per-process — when the Node process exits, the cache dies. No TTL needed.
- **Eviction:** none within process. Test seam: `TaskTrackingDispatch.__resetCache()`.
- **Cache value:** `{ handle, cap }` where `cap` is the resolved `capabilities()` result, captured at load time per ABI § Subprocess Lifecycle § Capability caching.

### F6 — Files to create / modify

| Path | Action | Purpose |
|---|---|---|
| `hive/lib/task-tracking-dispatch/index.ts` | NEW | Primary deliverable; the dispatch class + types |
| `hive/lib/task-tracking-dispatch/README.md` | NEW | Public surface doc for c-5b skill consumers |
| `hive/lib/task-tracking-dispatch/package.json` | NEW (optional) | If we need tsx as a local dep for tests; alternatively reuse root toolchain |
| `hive/lib/task-tracking-dispatch/test/*.test.ts` | NEW | Unit tests (6 cases per story AC) |
| `hive/hive.config.yaml` | EDIT | Document `task_tracking.adapter` field with valid values + `adapter_timeout_ms` |
| `hive.config.yaml` (root) | EDIT | Add example block with `adapter: null` (or `linear` if maintainer-local) + comments pointing at ABI spec |

### F7 — Open questions for implementer (low-risk, flag-only)

1. **`init(config)` on adapter:** built-in adapters don't export it. Implementer decides: probe-and-call if present, else propagate `config.github` / `config.linear` to env vars (`process.env.GITHUB_TOKEN = config.github?.token` etc.) before first invoke. Either works; the probe-pattern is forward-compatible with future adapters that need explicit init.
2. **`abiVersion` field location:** the ABI spec stores it inside `capabilities().abi_version`, not as a module-top-level export. So `load()` must call `capabilities()` first to do the version check. This is fine — the call is in-memory (Linear hits Linear's API only on team-key resolution, which happens inside `createStory`/`listOpen`, not `capabilities`).
3. **Timeout enforcement:** for in-process calls, use `Promise.race([invokePromise, timeoutPromise])`. Document that the timer doesn't kill the async work — it just unblocks the caller. Adapter-internal cleanup is the adapter's job.
4. **Run ID source:** the JSONL `run_id` should come from cycle state (`<state_dir>/cycle-state/<epic>.yaml`) when available; else fall back to `adhoc-<iso>` for tests / one-off calls.

---

## RECOMMENDED IMPLEMENTATION ORDER

1. Write `hive/lib/task-tracking-dispatch/index.ts` skeleton with the API in F4.
2. Implement `load(config)`:
   a. Validate config shape.
   b. Compute cache key (F5).
   c. If cache hit, set internal handle from cache, return.
   d. Resolve adapter: name → built-in path; absolute path → file URL.
   e. Propagate sub-config to env vars (GitHub: `GITHUB_TOKEN`, `gh` auth; Linear: `LINEAR_API_KEY`, `LINEAR_TEAM`).
   f. `await import(moduleUrl)` → handle.
   g. If `handle.init`, call it with config (forward-compat).
   h. Call `handle.capabilities()` (or `handle.dispatch({method:'capabilities'})` if direct-export not present).
   i. ABI version major check.
   j. Store in cache.
3. Implement `invoke(method, params)` with the error mapping in F4.
4. Implement `capability(field)` reading from cached `cap`.
5. Implement no-adapter handler (`gate_mode`-aware) + JSONL write helper (inline `fs.appendFileSync`).
6. Update `hive.config.yaml` schema + root `hive.config.yaml` example block.
7. Write `README.md` documenting public surface, cache lifetime, and the "no-`init`" probe behavior.
8. Tests (6 cases per AC):
   - load(github) → handle exposes 8 methods (including `capabilities`)
   - load(nonexistent) → terminal error
   - load(/abs/path/to/broken) → terminal error
   - invoke(rate-limit) → recoverable result
   - invoke(auth-fail) → terminal result
   - load(null) + gate_mode warning → JSONL row written
   - load(null) + gate_mode hard → terminal error
   - 2× consecutive invoke → 1 init call (cache verification)

---

**End of brief. Ready for `developer` step.**
