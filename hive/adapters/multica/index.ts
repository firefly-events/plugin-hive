#!/usr/bin/env -S npx tsx
// Multica task-tracking adapter — implements Hive ABI 1.0.0
// Hierarchy: hierarchical-ish (workspace → issues; parent_issue_id on create)
//
// Wire format: JSON request on stdin → JSON response on stdout.
//   Success: {"result": {...}}            exit 0
//   Error:   {"error": {"code":...}}      exit 1 (per ABI spec)
//
// Authentication:
//   MULTICA_TOKEN env var, or ~/.multica/config.json token field.
//
// Story ID encoding: `<workspace-slug>/<identifier>`  (e.g. "plugin-hive/PLU-4")

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const DEFAULT_WORKSPACE_SLUG = "plugin-hive";
const STATUS_VALUES = new Set([
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
]);

interface Request {
  method: string;
  params?: any;
}

type ErrorCode =
  | "NOT_FOUND"
  | "AUTH_FAILURE"
  | "RATE_LIMIT"
  | "UNKNOWN_METHOD"
  | "TRANSPORT"
  | "INVALID_PARAMS";

interface AbiError {
  code: ErrorCode;
  message: string;
  retry_after_ms: number | null;
}

interface MulticaConfig {
  token?: string;
  server_url?: string;
  app_url?: string;
  workspace_id?: string;
  workspace_slug?: string;
}

class AdapterError extends Error {
  code: ErrorCode;
  retry_after_ms: number | null;
  constructor(code: ErrorCode, message: string, retry_after_ms: number | null = null) {
    super(message);
    this.code = code;
    this.retry_after_ms = retry_after_ms;
  }
}

let _fetchImpl: typeof globalThis.fetch = globalThis.fetch;
export function __setFetch(f: typeof globalThis.fetch) {
  _fetchImpl = f;
}

let _workspaceId: string | null = null;
const _issueUuidByIdentifier = new Map<string, string>();
export function __resetCache() {
  _workspaceId = null;
  _issueUuidByIdentifier.clear();
}

function readConfig(): MulticaConfig {
  const configPath = path.join(os.homedir(), ".multica", "config.json");
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

function getSettings() {
  const cfg = readConfig();
  const token = process.env.MULTICA_TOKEN || cfg.token;
  if (!token) {
    throw new AdapterError(
      "AUTH_FAILURE",
      "No Multica credentials: set MULTICA_TOKEN env or run /hive:multica-init",
    );
  }
  const serverUrl = trimTrailingSlash(process.env.MULTICA_SERVER_URL || cfg.server_url || "");
  if (!serverUrl) {
    throw new AdapterError(
      "AUTH_FAILURE",
      "No Multica server URL: set MULTICA_SERVER_URL env or run /hive:multica-init",
    );
  }
  return {
    token,
    serverUrl,
    appUrl: trimTrailingSlash(cfg.app_url || serverUrl),
    workspaceId: cfg.workspace_id || null,
    workspaceSlug: cfg.workspace_slug || DEFAULT_WORKSPACE_SLUG,
  };
}

function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function encodeStoryId(workspaceSlug: string, identifier: string): string {
  return `${workspaceSlug}/${identifier}`;
}

function decodeStoryId(id: string): { workspaceSlug: string; identifier: string } {
  const m = String(id ?? "").match(/^([^\/\s]+)\/([A-Z][A-Z0-9_]*-\d+)$/);
  if (!m) {
    throw new AdapterError(
      "NOT_FOUND",
      `Invalid story id '${id}': expected '<workspace-slug>/PLU-N'`,
    );
  }
  return { workspaceSlug: m[1], identifier: m[2] };
}

function issueNumber(identifier: string): string {
  return identifier.split("-").pop() ?? identifier;
}

function synthesizeUrl(appUrl: string, workspaceSlug: string, identifier: string): string {
  return `${appUrl}/${workspaceSlug}/issues/${issueNumber(identifier)}`;
}

function sanitizeMessage(message: string): string {
  const cfg = readConfig();
  const secrets = [process.env.MULTICA_TOKEN, cfg.token].filter(Boolean) as string[];
  let sanitized = message;
  for (const secret of secrets) {
    sanitized = sanitized.split(secret).join("[redacted]");
  }
  return sanitized.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]");
}

async function multicaFetch(apiPath: string, init: { method?: string; body?: any } = {}) {
  const { token, serverUrl } = getSettings();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "User-Agent": "hive-multica-adapter/0.1.0",
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await _fetchImpl(`${serverUrl}${apiPath}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (e: any) {
    throw new AdapterError("TRANSPORT", sanitizeMessage(e?.message ?? String(e)));
  }

  const rawHeaders: Record<string, string> = {};
  res.headers.forEach((v: string, k: string) => (rawHeaders[k.toLowerCase()] = v));
  const text = await res.text();
  let body: any = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (res.status >= 200 && res.status < 300) return body;
  throw mapHttpError(res.status, rawHeaders, body);
}

function mapHttpError(status: number, headers: Record<string, string>, body: any): AdapterError {
  const msg = typeof body?.message === "string"
    ? body.message
    : typeof body?.error === "string"
      ? body.error
      : `HTTP ${status}`;
  const safeMsg = sanitizeMessage(msg);
  if (status === 429) {
    const retry = headers["retry-after"];
    const retryMs = retry && !Number.isNaN(parseInt(retry, 10))
      ? parseInt(retry, 10) * 1000
      : null;
    return new AdapterError("RATE_LIMIT", safeMsg, retryMs);
  }
  if (status === 401 || status === 403) return new AdapterError("AUTH_FAILURE", safeMsg);
  if (status === 404) return new AdapterError("NOT_FOUND", safeMsg);
  return new AdapterError("TRANSPORT", `${safeMsg} (HTTP ${status})`);
}

async function getWorkspaceId(): Promise<string> {
  if (_workspaceId) return _workspaceId;
  const { workspaceId, workspaceSlug } = getSettings();
  if (workspaceId) {
    _workspaceId = workspaceId;
    return workspaceId;
  }
  const body = await multicaFetch("/api/workspaces");
  const workspaces = Array.isArray(body) ? body : body?.workspaces ?? body?.data ?? [];
  const match = workspaces.find((w: any) => w?.slug === workspaceSlug);
  if (!match?.id) {
    throw new AdapterError("NOT_FOUND", `Workspace '${workspaceSlug}' not found`);
  }
  _workspaceId = String(match.id);
  return _workspaceId;
}

function cacheIssue(issue: any): void {
  if (issue?.identifier && issue?.id) {
    _issueUuidByIdentifier.set(String(issue.identifier), String(issue.id));
  }
}

function toAbiStory(issue: any): any {
  const { appUrl, workspaceSlug } = getSettings();
  const identifier = String(issue?.identifier ?? "");
  cacheIssue(issue);
  return {
    id: encodeStoryId(workspaceSlug, identifier),
    title: issue?.title ?? "",
    body: issue?.description ?? issue?.body ?? "",
    status: issue?.status ?? "",
    labels: Array.isArray(issue?.labels) ? issue.labels : [],
    parent_id: issue?.parent_issue_id ?? null,
    url: synthesizeUrl(appUrl, workspaceSlug, identifier),
    uuid: issue?.id,
  };
}

async function resolveIssueUuid(id: string): Promise<string> {
  const { identifier } = decodeStoryId(id);
  const cached = _issueUuidByIdentifier.get(identifier);
  if (cached) return cached;

  const workspaceId = await getWorkspaceId();
  const queryPath = `/api/issues?workspace_id=${encodeURIComponent(workspaceId)}&identifier=${encodeURIComponent(identifier)}`;
  let issue: any = null;
  try {
    const body = await multicaFetch(queryPath);
    const candidates = Array.isArray(body) ? body : body?.issues ?? body?.data ?? [body];
    issue = candidates.find((i: any) => i?.identifier === identifier);
  } catch (e: any) {
    if (e instanceof AdapterError && ["AUTH_FAILURE", "RATE_LIMIT", "NOT_FOUND"].includes(e.code)) {
      throw e;
    }
  }
  if (!issue) {
    const listBody = await multicaFetch(`/api/issues?workspace_id=${encodeURIComponent(workspaceId)}`);
    const list = Array.isArray(listBody) ? listBody : listBody?.issues ?? listBody?.data ?? [];
    issue = list.find((i: any) => i?.identifier === identifier);
  }
  if (!issue?.id) throw new AdapterError("NOT_FOUND", `Issue '${id}' not found`);
  cacheIssue(issue);
  return String(issue.id);
}

async function capabilities(): Promise<any> {
  return {
    abi_version: "1.0.0",
    hierarchy: "hierarchical",
    supports_parent_link: true,
    supported_labels: null,
    supported_states: Array.from(STATUS_VALUES),
    metadata: {
      team_field: "workspace",
      project_field: null,
    },
  };
}

async function createStory(params: any): Promise<any> {
  const { title, body = "", labels = [], parent_id = null } = params ?? {};
  if (!title) throw new AdapterError("INVALID_PARAMS", "createStory requires 'title'");
  const workspaceId = await getWorkspaceId();
  const parentUuid = parent_id ? await resolveIssueUuid(parent_id) : null;
  const issue = await multicaFetch(`/api/issues?workspace_id=${encodeURIComponent(workspaceId)}`, {
    method: "POST",
    body: {
      title,
      description: body,
      status: "todo",
      labels,
      parent_issue_id: parentUuid,
    },
  });
  cacheIssue(issue);
  const { appUrl, workspaceSlug } = getSettings();
  const identifier = String(issue?.identifier ?? "");
  if (!issue?.id || !identifier) {
    throw new AdapterError("TRANSPORT", "Create issue response missing id or identifier");
  }
  return {
    id: encodeStoryId(workspaceSlug, identifier),
    url: synthesizeUrl(appUrl, workspaceSlug, identifier),
  };
}

async function updateStory(params: any): Promise<any> {
  const { id, status } = params ?? {};
  decodeStoryId(id);
  if (!STATUS_VALUES.has(status)) {
    throw new AdapterError("INVALID_PARAMS", `Invalid status '${status}'`);
  }
  const [workspaceId, issueUuid] = await Promise.all([getWorkspaceId(), resolveIssueUuid(id)]);
  const issue = await multicaFetch(
    `/api/issues/${encodeURIComponent(issueUuid)}?workspace_id=${encodeURIComponent(workspaceId)}`,
    { method: "PUT", body: { status } },
  );
  cacheIssue(issue);
  return { id, status: issue?.status ?? status };
}

async function addComment(params: any): Promise<any> {
  const { id, body } = params ?? {};
  decodeStoryId(id);
  if (typeof body !== "string") throw new AdapterError("INVALID_PARAMS", "addComment requires 'body'");
  const [workspaceId, issueUuid] = await Promise.all([getWorkspaceId(), resolveIssueUuid(id)]);
  const comment = await multicaFetch(
    `/api/issues/${encodeURIComponent(issueUuid)}/comments?workspace_id=${encodeURIComponent(workspaceId)}`,
    { method: "POST", body: { content: body } },
  );
  return { comment_id: String(comment?.id ?? comment?.comment_id ?? ""), ...comment };
}

async function getStory(params: any): Promise<any> {
  const { id } = params ?? {};
  const issueUuid = await resolveIssueUuid(id);
  const workspaceId = await getWorkspaceId();
  const issue = await multicaFetch(
    `/api/issues/${encodeURIComponent(issueUuid)}?workspace_id=${encodeURIComponent(workspaceId)}`,
  );
  return toAbiStory(issue);
}

export async function dispatch(req: Request): Promise<any> {
  const handlers: Record<string, (p: any) => Promise<any>> = {
    capabilities,
    createStory,
    updateStory,
    addComment,
    getStory,
  };
  const h = handlers[req.method];
  if (!h) throw new AdapterError("UNKNOWN_METHOD", `Unknown method: ${req.method}`);
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
    process.stdout.write(JSON.stringify({
      error: { code: "UNKNOWN_METHOD", message: `Malformed request: ${e.message}`, retry_after_ms: null },
    }));
    process.exit(2);
  }

  try {
    const result = await dispatch(req);
    process.stdout.write(JSON.stringify({ result }));
    process.exit(0);
  } catch (e: any) {
    if (e instanceof AdapterError && e.code === "AUTH_FAILURE") {
      process.stderr.write("Multica auth failed: set MULTICA_TOKEN env or run /hive:multica-init\n");
    }
    const err: AbiError = e instanceof AdapterError
      ? { code: e.code, message: e.message, retry_after_ms: e.retry_after_ms }
      : { code: "TRANSPORT", message: e?.message ?? String(e), retry_after_ms: null };
    process.stdout.write(JSON.stringify({ error: err }));
    process.exit(1);
  }
}

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
