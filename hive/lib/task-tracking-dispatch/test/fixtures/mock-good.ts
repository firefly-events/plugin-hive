// Minimal mock adapter conforming to Hive ABI 1.x.
// Behavior is controlled by mutable module state so tests can switch modes.

export const __state: {
  mode:
    | "ok"
    | "rate-limit"
    | "auth-fail"
    | "uncaught"
    | "slow"
    | "missing-parent";
  initCalls: number;
  dispatchCalls: Array<{ method: string; params: any }>;
} = {
  mode: "ok",
  initCalls: 0,
  dispatchCalls: [],
};

export function __reset(mode: typeof __state.mode = "ok") {
  __state.mode = mode;
  __state.initCalls = 0;
  __state.dispatchCalls = [];
}

class AdapterError extends Error {
  code: string;
  retry_after_ms: number | null;
  constructor(code: string, message: string, retry_after_ms: number | null = null) {
    super(message);
    this.code = code;
    this.retry_after_ms = retry_after_ms;
  }
}

export async function init(_config: any): Promise<void> {
  __state.initCalls += 1;
}

export async function dispatch(req: { method: string; params?: any }): Promise<any> {
  __state.dispatchCalls.push({ method: req.method, params: req.params ?? {} });

  if (req.method === "capabilities") {
    return {
      abi_version: "1.0.0",
      hierarchy: "mixed",
      supports_parent_link: __state.mode !== "missing-parent",
      supported_labels: null,
      supported_states: ["open", "closed"],
      metadata: { team_field: "owner", project_field: "repo" },
    };
  }

  if (__state.mode === "slow") {
    await new Promise((r) => setTimeout(r, 500));
    return { id: "slow/repo#1" };
  }
  if (__state.mode === "rate-limit") {
    throw new AdapterError("RATE_LIMIT", "Mock rate limit", 1500);
  }
  if (__state.mode === "auth-fail") {
    throw new AdapterError("AUTH_FAILURE", "Mock auth failure");
  }
  if (__state.mode === "uncaught") {
    throw new Error("kaboom — non-ABI error");
  }
  return { id: "mock/repo#42", method: req.method, params: req.params };
}
