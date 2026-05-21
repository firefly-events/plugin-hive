// Hive-side task-tracking dispatch module.
//
// Loads built-in (github | linear | multica) or custom-path adapters via direct ESM
// dynamic import, caches the handle (per-process module-scoped Map keyed on
// SHA-1(JSON.stringify({state_dir, adapter, sub-config}))), invokes ABI
// methods, maps adapter errors to recoverable/terminal results, and emits
// no-adapter telemetry when gate_mode=warning and no adapter is configured.
//
// Critical reality-check vs Epic C story spec (c-5a researcher findings):
//   1. Adapters' exported `dispatch(req)` returns the raw result and throws
//      `AdapterError` on failure — the `{result}`/`{error}` wire envelope is
//      only added by `main()` for the CLI form. This module adapts to that.
//   2. Adapters configure via env vars (GITHUB_TOKEN / gh auth token,
//      LINEAR_API_KEY, LINEAR_TEAM, MULTICA_TOKEN, MULTICA_SERVER_URL).
//      This module propagates sub-config to env
//      before invocation, then probe-and-calls an `init` export if present
//      (forward-compatible).
//   3. ABI error codes (5): NOT_FOUND, AUTH_FAILURE, RATE_LIMIT,
//      UNKNOWN_METHOD, OPERATION_UNSUPPORTED. Hive virtual codes (3):
//      INTERNAL_ERROR (uncaught), TIMEOUT, NO_ADAPTER.

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

export type GateMode = "warning" | "hard";

export interface TaskTrackingConfig {
  adapter: "github" | "linear" | "multica" | string | null; // string for custom path
  adapter_timeout_ms?: number;
  gate_mode?: GateMode;
  team_value?: string | null;
  project_value?: string | null;
  // Adapter-specific keys propagated to env before invocation:
  github?: { token?: string | null };
  linear?: { api_key?: string | null; team?: string | null };
  multica?: { server_url?: string | null; token?: string | null };
  // Project state dir (used in cache key + JSONL telemetry output dir):
  state_dir?: string;
}

export type DispatchResult =
  | { ok: true; result: any }
  | {
      ok: false;
      recoverable: boolean;
      code: string;
      message: string;
      retry_after_ms?: number | null;
    };

interface AdapterModule {
  dispatch: (req: { method: string; params?: any }) => Promise<any>;
  init?: (config: any) => Promise<void> | void;
}

interface AdapterHandle {
  module: AdapterModule;
  capabilities: any;
  abi_version: string;
  config: TaskTrackingConfig;
}

const HIVE_SUPPORTED_ABI_MAJOR = 1;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_GATE_MODE: GateMode = "warning";

const BUILTIN_ADAPTERS: Record<string, string> = {
  github: "../../adapters/github/index.ts",
  linear: "../../adapters/linear/index.ts",
  multica: "../../adapters/multica/index.ts",
};

// Module-scoped cache: per-process, keyed by SHA-1 of normalized config.
const handleCache = new Map<string, AdapterHandle>();

// Process-wide flag so the no-adapter warning + telemetry is emitted exactly
// once across all dispatcher instances per process (matches the documented
// behavior in README — was instance-scoped before, which double-fired in
// multi-dispatcher setups).
let noAdapterWarningEmittedProcessWide = false;

export class TaskTrackingDispatch {
  private handle: AdapterHandle | null = null;
  private config: TaskTrackingConfig | null = null;

  /**
   * Test-only: reset the process-wide no-adapter warning flag so each test
   * sees a fresh "first-invoke" state. Production code should never call this.
   */
  static __resetNoAdapterWarningForTests(): void {
    noAdapterWarningEmittedProcessWide = false;
  }

  /**
   * Load and validate the adapter declared in `config`. When `config.adapter`
   * is null, no handle is loaded; subsequent `invoke()` calls return
   * NO_ADAPTER results gated by `config.gate_mode`.
   */
  async load(config: TaskTrackingConfig): Promise<void> {
    this.config = config;
    this.handle = null;
    if (!config.adapter) {
      return;
    }

    const cacheKey = computeCacheKey(config);
    const cached = handleCache.get(cacheKey);
    if (cached) {
      this.handle = cached;
      return;
    }

    const adapterPath = resolveAdapterPath(config.adapter);
    if (!adapterPath) {
      throw new Error(
        `Adapter not found: ${config.adapter} (built-in keys: ${Object.keys(
          BUILTIN_ADAPTERS,
        ).join(", ")}; or pass an absolute path to a custom adapter module)`,
      );
    }

    // Propagate adapter-specific sub-config to env vars before import. Adapters
    // read env at call time (GITHUB_TOKEN / LINEAR_API_KEY / LINEAR_TEAM).
    propagateConfigToEnv(config);

    let mod: AdapterModule;
    try {
      mod = (await import(pathToFileURL(adapterPath).href)) as AdapterModule;
    } catch (err: any) {
      throw new Error(
        `Failed to load adapter ${config.adapter} from ${adapterPath}: ${err?.message ?? err}`,
      );
    }

    if (typeof mod.dispatch !== "function") {
      throw new Error(
        `Adapter ${config.adapter} does not export dispatch() — not a valid Hive ABI adapter`,
      );
    }

    // Forward-compat: probe-and-call init if present. Current built-in
    // adapters do not export init, but custom adapters may.
    if (typeof mod.init === "function") {
      try {
        await mod.init(config);
      } catch (err: any) {
        throw new Error(
          `Adapter ${config.adapter} init failed: ${err?.message ?? err}`,
        );
      }
    }

    // Fetch capabilities + validate ABI major version. Note: adapter.dispatch
    // returns the raw result and throws AdapterError on failure (NOT the
    // {result}/{error} CLI wire envelope).
    let caps: any;
    try {
      caps = await withTimeout(
        mod.dispatch({ method: "capabilities" }),
        config.adapter_timeout_ms ?? DEFAULT_TIMEOUT_MS,
      );
    } catch (err: any) {
      throw new Error(
        `Adapter ${config.adapter} capabilities call failed: ${err?.message ?? err}`,
      );
    }

    if (!caps || !caps.abi_version) {
      throw new Error(
        `Adapter ${config.adapter} capabilities response missing abi_version`,
      );
    }
    const adapterMajor = Number(String(caps.abi_version).split(".")[0]);
    if (adapterMajor !== HIVE_SUPPORTED_ABI_MAJOR) {
      throw new Error(
        `Adapter ${config.adapter} ABI version ${caps.abi_version} incompatible with Hive supported major ${HIVE_SUPPORTED_ABI_MAJOR}`,
      );
    }

    const handle: AdapterHandle = {
      module: mod,
      capabilities: caps,
      abi_version: caps.abi_version,
      config,
    };
    handleCache.set(cacheKey, handle);
    this.handle = handle;
  }

  /**
   * Invoke an ABI method on the loaded adapter. Maps adapter outcomes to a
   * uniform `DispatchResult` (ok | recoverable | terminal).
   *
   * If no adapter is loaded:
   *   gate_mode=warning -> emit warning + JSONL telemetry once, return
   *                        NO_ADAPTER (non-recoverable, caller routes to skip)
   *   gate_mode=hard    -> return NO_ADAPTER (non-recoverable, hard block)
   *
   * `options.skill_context` (optional) is recorded in prose-runbook-fallback
   * telemetry so cost/migration dashboards can attribute terminal failures to
   * the calling skill (e.g. "plan", "execute", "kickoff").
   */
  async invoke(
    method: string,
    params: any = {},
    options?: { skill_context?: string },
  ): Promise<DispatchResult> {
    if (!this.handle) {
      return this.handleNoAdapter(method);
    }

    const skillContext = options?.skill_context ?? "unknown";

    // Guard linkStories by supports_parent_link capability.
    if (
      method === "linkStories" &&
      this.handle.capabilities?.supports_parent_link === false
    ) {
      const r: DispatchResult = {
        ok: false,
        recoverable: false,
        code: "OPERATION_UNSUPPORTED",
        message: "Adapter does not support parent-child links",
      };
      this.maybeEmitProseRunbookFallback(method, r, skillContext);
      return r;
    }

    // Read timeout from THIS dispatcher's config, not the cached handle's
    // config — handles can be shared across dispatcher instances with
    // different adapter_timeout_ms; reading from handle.config would let the
    // first instance's timeout bleed into the second.
    const timeoutMs =
      this.config?.adapter_timeout_ms ?? DEFAULT_TIMEOUT_MS;
    let result: any;
    try {
      result = await withTimeout(
        this.handle.module.dispatch({ method, params }),
        timeoutMs,
      );
    } catch (err: any) {
      if (err && err.message === "TIMEOUT") {
        const r: DispatchResult = {
          ok: false,
          recoverable: false,
          code: "TIMEOUT",
          message: `Adapter call ${method} exceeded ${timeoutMs}ms`,
        };
        this.maybeEmitProseRunbookFallback(method, r, skillContext);
        return r;
      }
      // Adapter threw — distinguish AdapterError (ABI-shaped) from uncaught.
      // AdapterError instances expose `.code` matching the 5 ABI error codes;
      // anything else is INTERNAL_ERROR.
      const code = (err && (err as any).code) as string | undefined;
      const retry_after_ms =
        ((err as any)?.retry_after_ms as number | null | undefined) ?? null;
      if (code && isAbiErrorCode(code)) {
        const r: DispatchResult = {
          ok: false,
          recoverable: code === "RATE_LIMIT",
          code,
          message: err?.message ?? "",
          retry_after_ms,
        };
        this.maybeEmitProseRunbookFallback(method, r, skillContext);
        return r;
      }
      const r: DispatchResult = {
        ok: false,
        recoverable: false,
        code: "INTERNAL_ERROR",
        message: `Adapter threw uncaught error in ${method}: ${err?.message ?? err}`,
      };
      this.maybeEmitProseRunbookFallback(method, r, skillContext);
      return r;
    }

    return { ok: true, result };
  }

  /** Read a field from the cached capabilities object. */
  capability(field: string): any {
    if (!this.handle) return undefined;
    return this.handle.capabilities?.[field];
  }

  get hasAdapter(): boolean {
    return this.handle !== null;
  }

  get abiVersion(): string | null {
    return this.handle?.abi_version ?? null;
  }

  private handleNoAdapter(method: string): DispatchResult {
    const gateMode = this.config?.gate_mode ?? DEFAULT_GATE_MODE;

    if (gateMode === "hard") {
      return {
        ok: false,
        recoverable: false,
        code: "NO_ADAPTER",
        message: `No task-tracking adapter configured (gate_mode=hard blocks ${method})`,
      };
    }

    if (!noAdapterWarningEmittedProcessWide) {
      this.emitNoAdapterWarning();
      this.writeNoAdapterTelemetry(method);
      noAdapterWarningEmittedProcessWide = true;
    }
    return {
      ok: false,
      recoverable: false,
      code: "NO_ADAPTER",
      message: `No task-tracking adapter configured; gate_mode=warning — skipping ${method}`,
    };
  }

  private emitNoAdapterWarning(): void {
    // eslint-disable-next-line no-console
    console.warn(
      "[hive] task-tracking adapter is unset. Set task_tracking.adapter in hive.config.yaml to enable. (gate_mode=warning — skipping tracker ops)",
    );
  }

  private writeNoAdapterTelemetry(method: string): void {
    const stateDir = this.config?.state_dir ?? ".pHive";
    const eventsDir = path.join(stateDir, "metrics", "events");
    try {
      fs.mkdirSync(eventsDir, { recursive: true });
    } catch {
      return; // best-effort; never block on telemetry
    }
    const timestamp = new Date().toISOString();
    const event = {
      event_id: crypto.randomUUID(),
      timestamp,
      run_id: process.env.HIVE_RUN_ID ?? "unknown",
      metric_type: "task-tracking-no-adapter",
      method,
      gate_mode: "warning",
    };
    const filePath = path.join(
      eventsDir,
      `task-tracking-no-adapter-${timestamp.replace(/[:.]/g, "-")}.jsonl`,
    );
    try {
      fs.appendFileSync(filePath, JSON.stringify(event) + "\n");
    } catch {
      // best-effort
    }
  }

  /**
   * Emit prose-runbook-fallback telemetry when a loaded adapter returns a
   * terminal (non-recoverable) result under gate_mode=warning. Skips:
   *   - successful results
   *   - recoverable results (RATE_LIMIT)
   *   - NO_ADAPTER (handled by writeNoAdapterTelemetry instead)
   *   - any gate_mode other than warning
   *
   * Per-occurrence emit: every qualifying terminal call writes a fresh event
   * (each terminal is a distinct migration signal away from prose runbooks).
   */
  private maybeEmitProseRunbookFallback(
    method: string,
    result: DispatchResult,
    skillContext: string,
  ): void {
    if (result.ok) return;
    if (result.recoverable) return;
    if (result.code === "NO_ADAPTER") return;

    const gateMode = this.config?.gate_mode ?? DEFAULT_GATE_MODE;
    if (gateMode !== "warning") return;

    this.writeProseRunbookFallbackTelemetry(method, result.code, skillContext);
  }

  private writeProseRunbookFallbackTelemetry(
    method: string,
    code: string,
    skillContext: string,
  ): void {
    const stateDir = this.config?.state_dir ?? ".pHive";
    const eventsDir = path.join(stateDir, "metrics", "events");
    try {
      fs.mkdirSync(eventsDir, { recursive: true });
    } catch {
      return; // best-effort; never block on telemetry
    }
    const timestamp = new Date().toISOString();
    const event = {
      event_id: crypto.randomUUID(),
      timestamp,
      run_id: process.env.HIVE_RUN_ID ?? "unknown",
      metric_type: "prose-runbook-fallback",
      skill: skillContext,
      method,
      adapter: this.config?.adapter ?? null,
      gate_mode: "warning",
      error_code: code,
    };
    // Include random suffix so per-occurrence events within the same ms don't
    // collide on filename.
    const filePath = path.join(
      eventsDir,
      `prose-runbook-fallback-${timestamp.replace(/[:.]/g, "-")}-${crypto
        .randomBytes(4)
        .toString("hex")}.jsonl`,
    );
    try {
      fs.appendFileSync(filePath, JSON.stringify(event) + "\n");
    } catch {
      // best-effort
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Module-scoped helpers
// ──────────────────────────────────────────────────────────────────────────────

function computeCacheKey(config: TaskTrackingConfig): string {
  // Normalize sub-config so cache key is stable across equivalent configs.
  const keyObj = {
    state_dir: config.state_dir ?? "",
    adapter: config.adapter,
    github: config.github ?? null,
    linear: config.linear ?? null,
    multica: config.multica ?? null,
  };
  return crypto.createHash("sha1").update(JSON.stringify(keyObj)).digest("hex");
}

function resolveAdapterPath(adapter: string): string | null {
  if (BUILTIN_ADAPTERS[adapter]) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const resolved = path.resolve(__dirname, BUILTIN_ADAPTERS[adapter]);
    return fs.existsSync(resolved) ? resolved : null;
  }
  // Custom path: accept absolute paths or paths relative to cwd. Reject
  // bare keys to keep typos from silently matching nothing.
  if (!adapter.includes("/") && !adapter.includes("\\")) {
    return null;
  }
  const resolved = path.isAbsolute(adapter) ? adapter : path.resolve(adapter);
  return fs.existsSync(resolved) ? resolved : null;
}

function propagateConfigToEnv(config: TaskTrackingConfig): void {
  // GitHub token: set when present + adapter is github; clear otherwise so a
  // previously-set GITHUB_TOKEN does not bleed across reload() calls or into
  // a linear-adapter run.
  if (config.adapter === "github" && config.github?.token) {
    process.env.GITHUB_TOKEN = config.github.token;
  } else {
    delete process.env.GITHUB_TOKEN;
  }
  // Linear creds: same rule — set when present + adapter is linear; clear
  // otherwise (covers explicit null/undefined and adapter-switch cases).
  if (config.adapter === "linear" && config.linear?.api_key) {
    process.env.LINEAR_API_KEY = config.linear.api_key;
  } else {
    delete process.env.LINEAR_API_KEY;
  }
  if (config.adapter === "linear" && config.linear?.team) {
    process.env.LINEAR_TEAM = config.linear.team;
  } else {
    delete process.env.LINEAR_TEAM;
  }
  // Multica creds: same rule — set when present + adapter is multica; clear
  // otherwise (covers explicit null/undefined and adapter-switch cases).
  if (config.adapter === "multica" && config.multica?.token) {
    process.env.MULTICA_TOKEN = config.multica.token;
  } else {
    delete process.env.MULTICA_TOKEN;
  }
  if (config.adapter === "multica" && config.multica?.server_url) {
    process.env.MULTICA_SERVER_URL = config.multica.server_url;
  } else {
    delete process.env.MULTICA_SERVER_URL;
  }
}

const ABI_ERROR_CODES = new Set([
  "NOT_FOUND",
  "AUTH_FAILURE",
  "RATE_LIMIT",
  "UNKNOWN_METHOD",
  "OPERATION_UNSUPPORTED",
]);

function isAbiErrorCode(code: string): boolean {
  return ABI_ERROR_CODES.has(code);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("TIMEOUT")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// Test-only helpers
export function __resetHandleCache(): void {
  handleCache.clear();
}

export function __handleCacheSize(): number {
  return handleCache.size;
}
