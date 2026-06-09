#!/usr/bin/env tsx
// GitHub task-tracking adapter — implements Hive ABI 1.0.0
// Hierarchy: mixed (issues flat; sub-issues hierarchical via Sub-Issues alpha API)
//
// Wire format: JSON request on stdin → JSON response on stdout.
//   Success: {"result": {...}}            exit 0
//   Error:   {"error": {"code":...}}      exit 1 (per ABI spec)
//
// Authentication:
//   1. `gh auth token` (shell out, preferred)
//   2. GITHUB_TOKEN env var (fallback)
//
// Story ID encoding: `<owner>/<repo>#<number>`  (e.g. "firefly-events/plugin-hive#42")
//
// See ./README.md for invocation examples and ./friction-notes.md for known gaps.

import { execSync } from "node:child_process";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

interface Request {
  method: string;
  params?: any;
}

type ErrorCode =
  | "NOT_FOUND"
  | "AUTH_FAILURE"
  | "RATE_LIMIT"
  | "UNKNOWN_METHOD"
  | "OPERATION_UNSUPPORTED";

interface AbiError {
  code: ErrorCode;
  message: string;
  retry_after_ms: number | null;
}

interface FetchResult {
  status: number;
  headers: Record<string, string>;
  body: any;
}

// Custom error class so handlers can throw and main() maps to ABI envelope.
class AdapterError extends Error {
  code: ErrorCode;
  retry_after_ms: number | null;
  constructor(code: ErrorCode, message: string, retry_after_ms: number | null = null) {
    super(message);
    this.code = code;
    this.retry_after_ms = retry_after_ms;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Auth
// ──────────────────────────────────────────────────────────────────────────────

function getAuthToken(): string {
  // Prefer `gh auth token` — picks up gh CLI's stored credentials (keychain, etc.)
  try {
    const token = execSync("gh auth token", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (token) return token;
  } catch {
    // gh CLI not installed or not logged in — fall through to env
  }
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (envToken) return envToken;
  throw new AdapterError(
    "AUTH_FAILURE",
    "No GitHub credentials: run `gh auth login` or set GITHUB_TOKEN"
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// ID encoding
// ──────────────────────────────────────────────────────────────────────────────

function encodeStoryId(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}#${number}`;
}

function decodeStoryId(id: string): { owner: string; repo: string; number: number } {
  // Format: owner/repo#number
  const m = id.match(/^([^\/\s]+)\/([^#\s]+)#(\d+)$/);
  if (!m) {
    throw new AdapterError(
      "NOT_FOUND",
      `Invalid story id '${id}': expected '<owner>/<repo>#<number>'`
    );
  }
  return { owner: m[1], repo: m[2], number: parseInt(m[3], 10) };
}

// ──────────────────────────────────────────────────────────────────────────────
// HTTP / rate-limit mapping
// ──────────────────────────────────────────────────────────────────────────────

// Test seam: tests may override this to inject mock responses.
let _fetchImpl: typeof globalThis.fetch = globalThis.fetch;
export function __setFetch(f: typeof globalThis.fetch) {
  _fetchImpl = f;
}

async function ghFetch(
  path: string,
  init: { method?: string; body?: any; headers?: Record<string, string> } = {}
): Promise<FetchResult> {
  const token = getAuthToken();
  const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "hive-github-adapter/0.1.0",
    ...(init.headers ?? {}),
  };
  if (init.body !== undefined && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await _fetchImpl(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const rawHeaders: Record<string, string> = {};
  res.headers.forEach((v: string, k: string) => {
    rawHeaders[k.toLowerCase()] = v;
  });
  const text = await res.text();
  let body: any = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (res.status >= 200 && res.status < 300) {
    return { status: res.status, headers: rawHeaders, body };
  }
  throw mapHttpError(res.status, rawHeaders, body);
}

// Map an HTTP non-2xx into the ABI error enum.
// Tri-modal rate limiting:
//   429                                                   → RATE_LIMIT
//   403 + x-ratelimit-remaining: 0                        → RATE_LIMIT (primary)
//   403 + retry-after header present                      → RATE_LIMIT (secondary)
//   403 alone (no rate-limit signal)                      → AUTH_FAILURE
//   401                                                   → AUTH_FAILURE
//   404                                                   → NOT_FOUND
//   422                                                   → UNKNOWN_METHOD (see friction-notes)
//   other                                                 → UNKNOWN_METHOD
function mapHttpError(
  status: number,
  headers: Record<string, string>,
  body: any
): AdapterError {
  const msg = (body && body.message) || `HTTP ${status}`;
  const retryAfterMs = (() => {
    const ra = headers["retry-after"];
    if (ra) {
      const n = parseInt(ra, 10);
      if (!isNaN(n)) return n * 1000;
    }
    const reset = headers["x-ratelimit-reset"];
    if (reset) {
      const epoch = parseInt(reset, 10);
      if (!isNaN(epoch)) {
        const ms = epoch * 1000 - Date.now();
        return Math.max(1000, ms);
      }
    }
    return 60_000; // default 1m back-off if no signal given
  })();

  if (status === 429) {
    return new AdapterError("RATE_LIMIT", `${msg}`, retryAfterMs);
  }
  if (status === 403) {
    const remaining = headers["x-ratelimit-remaining"];
    if (remaining === "0" || headers["retry-after"]) {
      return new AdapterError("RATE_LIMIT", `${msg}`, retryAfterMs);
    }
    return new AdapterError("AUTH_FAILURE", `${msg}`);
  }
  if (status === 401) {
    return new AdapterError("AUTH_FAILURE", `${msg}`);
  }
  if (status === 404) {
    return new AdapterError("NOT_FOUND", `${msg}`);
  }
  // 422 unprocessable entity — see friction-notes.md
  // Currently mapped to UNKNOWN_METHOD as the closest available code.
  return new AdapterError("UNKNOWN_METHOD", `${msg} (HTTP ${status})`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Shape mapping
// ──────────────────────────────────────────────────────────────────────────────

// GitHub Issue → ABI full story shape.
// `parent_id` is derived from `sub_issue_of` when present (issue is a sub-issue),
// otherwise null. (Sub-Issues alpha API exposes parent linkage via the issue
// resource itself; we surface only what's present.)
export function toAbiStory(gh: any, owner: string, repo: string): any {
  const parent = gh.sub_issue_of || gh.parent || null;
  let parent_id: string | null = null;
  if (parent && typeof parent.number === "number") {
    const pOwner = parent.repository?.owner?.login ?? owner;
    const pRepo = parent.repository?.name ?? repo;
    parent_id = encodeStoryId(pOwner, pRepo, parent.number);
  }
  return {
    id: encodeStoryId(owner, repo, gh.number),
    title: gh.title ?? "",
    body: gh.body ?? "",
    state: gh.state ?? "open",
    labels: Array.isArray(gh.labels)
      ? gh.labels.map((l: any) => (typeof l === "string" ? l : l.name))
      : [],
    parent_id,
    url: gh.html_url ?? "",
  };
}

// listOpen subset — drops body + parent_id (per c-3 research).
export function toAbiStorySubset(gh: any, owner: string, repo: string): any {
  return {
    id: encodeStoryId(owner, repo, gh.number),
    title: gh.title ?? "",
    state: gh.state ?? "open",
    labels: Array.isArray(gh.labels)
      ? gh.labels.map((l: any) => (typeof l === "string" ? l : l.name))
      : [],
    url: gh.html_url ?? "",
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Method handlers
// ──────────────────────────────────────────────────────────────────────────────

async function capabilities(): Promise<any> {
  return {
    abi_version: "1.0.0",
    hierarchy: "mixed",
    supports_parent_link: true,
    supports_needs_rework: true,
    supported_labels: null,
    supported_states: ["open", "closed"],
    metadata: {
      team_field: "owner",
      project_field: "repo",
    },
  };
}

async function createStory(params: any): Promise<any> {
  const { title, body, labels = [], parent_id = null, team_value, project_value } = params;
  const owner = team_value;
  const repo = project_value;
  if (!owner || !repo) {
    throw new AdapterError(
      "UNKNOWN_METHOD",
      "createStory requires team_value (owner) and project_value (repo)"
    );
  }
  const res = await ghFetch(`/repos/${owner}/${repo}/issues`, {
    method: "POST",
    body: { title, body, labels },
  });
  const issue = res.body;
  const created = {
    id: encodeStoryId(owner, repo, issue.number),
    url: issue.html_url,
  };
  // If parent_id given, establish sub-issue link as a second call.
  if (parent_id) {
    await linkStories({ parent_id, child_id: created.id });
  }
  return created;
}

async function updateStatus(params: any): Promise<any> {
  const { id, state } = params;
  const { owner, repo, number } = decodeStoryId(id);
  // GitHub only has open/closed. Map the ABI state to GH's state.
  let ghState: string;
  if (state === "open") ghState = "open";
  else if (state === "closed") ghState = "closed";
  else {
    throw new AdapterError(
      "OPERATION_UNSUPPORTED",
      `GitHub only supports open|closed; got '${state}'`
    );
  }
  const res = await ghFetch(`/repos/${owner}/${repo}/issues/${number}`, {
    method: "PATCH",
    body: { state: ghState },
  });
  return toAbiStory(res.body, owner, repo);
}

async function listOpen(params: any): Promise<any> {
  const { limit = 50, team_value, project_value } = params ?? {};
  const owner = team_value;
  const repo = project_value;
  if (!owner || !repo) {
    throw new AdapterError(
      "UNKNOWN_METHOD",
      "listOpen requires team_value (owner) and project_value (repo)"
    );
  }
  const perPage = Math.min(100, Math.max(1, limit));
  const res = await ghFetch(
    `/repos/${owner}/${repo}/issues?state=open&per_page=${perPage}`
  );
  const issues = Array.isArray(res.body) ? res.body : [];
  // Filter out PRs — GitHub returns PRs from /issues endpoint.
  const filtered = issues
    .filter((i: any) => !i.pull_request)
    .slice(0, limit)
    .map((i: any) => toAbiStorySubset(i, owner, repo));
  return { stories: filtered };
}

async function getStory(params: any): Promise<any> {
  const { id } = params;
  const { owner, repo, number } = decodeStoryId(id);
  const res = await ghFetch(`/repos/${owner}/${repo}/issues/${number}`);
  return toAbiStory(res.body, owner, repo);
}

async function addComment(params: any): Promise<any> {
  const { id, body } = params;
  const { owner, repo, number } = decodeStoryId(id);
  const res = await ghFetch(`/repos/${owner}/${repo}/issues/${number}/comments`, {
    method: "POST",
    body: { body },
  });
  return { comment_id: String(res.body.id) };
}

async function linkStories(params: any): Promise<any> {
  // 2-call sequence:
  //   1. GET child issue to fetch its integer `id` (Sub-Issues API takes id, not number)
  //   2. POST /repos/{owner}/{repo}/issues/{parent_number}/sub_issues
  const { parent_id, child_id } = params;
  const parent = decodeStoryId(parent_id);
  const child = decodeStoryId(child_id);
  const childRes = await ghFetch(
    `/repos/${child.owner}/${child.repo}/issues/${child.number}`
  );
  const childIntId = childRes.body.id;
  await ghFetch(
    `/repos/${parent.owner}/${parent.repo}/issues/${parent.number}/sub_issues`,
    {
      method: "POST",
      body: { sub_issue_id: childIntId },
    }
  );
  return {};
}

async function setAssignee(params: any): Promise<any> {
  const { id, assignee_id } = params;
  const { owner, repo, number } = decodeStoryId(id);
  // GitHub `assignees` is an array; ABI passes a single id (or null to clear).
  // For null: PATCH with assignees: [].
  // For value: PATCH with assignees: [assignee_id]. This REPLACES existing assignees.
  const assignees: string[] = assignee_id === null ? [] : [assignee_id];
  await ghFetch(`/repos/${owner}/${repo}/issues/${number}`, {
    method: "PATCH",
    body: { assignees },
  });
  return {};
}

async function markNeedsRework(params: any): Promise<any> {
  const { id, reason: _reason } = params;
  const { owner, repo, number } = decodeStoryId(id);
  // Step 1: reopen the issue (ensure it is open so it lands in triage queue)
  await ghFetch(`/repos/${owner}/${repo}/issues/${number}`, {
    method: "PATCH",
    body: { state: "open" },
  });
  // Step 2: fetch current labels so we can append without clobbering existing ones
  const issueRes = await ghFetch(`/repos/${owner}/${repo}/issues/${number}`);
  const priorLabels: string[] = Array.isArray(issueRes.body.labels)
    ? issueRes.body.labels.map((l: any) => (typeof l === "string" ? l : l.name))
    : [];
  const newLabels = priorLabels.includes("hive:needs-rework")
    ? priorLabels
    : [...priorLabels, "hive:needs-rework"];
  // Step 3: POST labels endpoint to add hive:needs-rework
  await ghFetch(`/repos/${owner}/${repo}/issues/${number}/labels`, {
    method: "POST",
    body: { labels: ["hive:needs-rework"] },
  });
  return { id, status: "open", labels: newLabels };
}

// ──────────────────────────────────────────────────────────────────────────────
// Dispatch + main
// ──────────────────────────────────────────────────────────────────────────────

export async function dispatch(req: Request): Promise<any> {
  const handlers: Record<string, (p: any) => Promise<any>> = {
    capabilities,
    createStory,
    updateStatus,
    listOpen,
    getStory,
    addComment,
    linkStories,
    setAssignee,
    markNeedsRework,
  };
  const h = handlers[req.method];
  if (!h) {
    throw new AdapterError("UNKNOWN_METHOD", `Unknown method: ${req.method}`);
  }
  return await h(req.params ?? {});
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function main() {
  let raw: string;
  try {
    // argv[2] override for ad-hoc testing: `./index.ts '{"method":"capabilities"}'`
    raw = process.argv[2] ?? (await readStdin());
  } catch (e: any) {
    process.stderr.write(`adapter transport error: ${e.message}\n`);
    process.exit(2);
  }
  let req: Request;
  try {
    req = JSON.parse(raw);
    if (!req || typeof req.method !== "string") {
      throw new Error("Request must be {method: string, params?: object}");
    }
  } catch (e: any) {
    // Malformed JSON is a transport failure — write error envelope but use exit 2.
    process.stdout.write(
      JSON.stringify({
        error: {
          code: "UNKNOWN_METHOD",
          message: `Malformed request: ${e.message}`,
          retry_after_ms: null,
        },
      })
    );
    process.exit(2);
  }

  try {
    const result = await dispatch(req);
    process.stdout.write(JSON.stringify({ result }));
    process.exit(0);
  } catch (e: any) {
    const err: AbiError =
      e instanceof AdapterError
        ? { code: e.code, message: e.message, retry_after_ms: e.retry_after_ms }
        : { code: "UNKNOWN_METHOD", message: e?.message ?? String(e), retry_after_ms: null };
    process.stdout.write(JSON.stringify({ error: err }));
    process.exit(1);
  }
}

// Run main when invoked as a script (not when imported by tests).
// Detection: argv[1] ends with this file's basename, or argv[1] is undefined (rare).
const isMain = (() => {
  const a1 = process.argv[1] ?? "";
  return (
    a1.endsWith("/index.ts") ||
    a1.endsWith("/index.js") ||
    a1.endsWith("\\index.ts") ||
    a1.endsWith("\\index.js")
  );
})();
if (isMain) {
  main();
}

export { AdapterError, encodeStoryId, decodeStoryId, mapHttpError };
