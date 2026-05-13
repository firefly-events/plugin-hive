#!/usr/bin/env tsx
// Linear task-tracking adapter — implements Hive ABI 1.0.0
// Hierarchy: hierarchical (teams → projects → issues; native parent links)
//
// Wire format: JSON request on stdin → JSON response on stdout.
//   Success: {"result": {...}}            exit 0
//   Error:   {"error": {"code":...}}      exit 1 (per ABI spec)
//
// Authentication:
//   LINEAR_API_KEY env var, sent as raw `Authorization: <key>` (NO Bearer prefix).
//   Bearer is reserved for OAuth on Linear; personal API keys go in raw.
//
// Story ID encoding: `TEAM-123`  (e.g. "ACME-42") — Linear's native human identifier.
//
// Team context: `LINEAR_TEAM` env var (a team key like "ACME") is required for
// `capabilities` (to enumerate workflow states + labels) and for `listOpen`.
//
// See ./README.md for invocation examples and ./friction-notes.md for known gaps.

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const STORY_ID_REGEX = /^[A-Z][A-Z0-9_]*-\d+$/;

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
// Test seam
// ──────────────────────────────────────────────────────────────────────────────

let _fetchImpl: typeof globalThis.fetch = globalThis.fetch;
export function __setFetch(f: typeof globalThis.fetch) {
  _fetchImpl = f;
}

// Allow tests to flush metadata cache between scenarios.
const _teamMetadataCache: Map<string, TeamMetadata> = new Map();
export function __resetCache() {
  _teamMetadataCache.clear();
}

// ──────────────────────────────────────────────────────────────────────────────
// Auth + env
// ──────────────────────────────────────────────────────────────────────────────

function getAuthToken(): string {
  const key = process.env.LINEAR_API_KEY;
  if (!key) {
    throw new AdapterError(
      "AUTH_FAILURE",
      "No Linear credentials: set LINEAR_API_KEY env var"
    );
  }
  return key;
}

function getTeamKey(): string {
  // Auth check first — if both env vars are unset, callers should see AUTH_FAILURE
  // for the missing API key rather than a misleading config error for the team.
  getAuthToken();
  const team = process.env.LINEAR_TEAM;
  if (!team) {
    throw new AdapterError(
      "AUTH_FAILURE",
      "LINEAR_TEAM env var required for this operation"
    );
  }
  return team;
}

// ──────────────────────────────────────────────────────────────────────────────
// ID validation
// ──────────────────────────────────────────────────────────────────────────────

export function validateStoryId(id: string): void {
  if (typeof id !== "string" || !STORY_ID_REGEX.test(id)) {
    throw new AdapterError(
      "NOT_FOUND",
      `Invalid story id '${id}': expected 'TEAM-123' format`
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// GraphQL transport + error mapping
// ──────────────────────────────────────────────────────────────────────────────

interface GraphqlResponse {
  data?: any;
  errors?: Array<{
    message: string;
    extensions?: {
      code?: string;
      type?: string;
      [k: string]: any;
    };
  }>;
}

async function linearGraphQL(query: string, variables?: any): Promise<any> {
  const token = getAuthToken();
  const res = await _fetchImpl(LINEAR_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token, // RAW — no Bearer prefix for personal API keys
      "User-Agent": "hive-linear-adapter/0.1.0",
    },
    body: JSON.stringify({ query, variables }),
  });
  const rawHeaders: Record<string, string> = {};
  res.headers.forEach((v: string, k: string) => {
    rawHeaders[k.toLowerCase()] = v;
  });
  const text = await res.text();
  let body: GraphqlResponse | null = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  // Hard auth failures show up as 401/403 even without a GraphQL envelope.
  if (res.status === 401 || res.status === 403) {
    throw new AdapterError(
      "AUTH_FAILURE",
      (body as any)?.message || `HTTP ${res.status}`
    );
  }
  // GraphQL errors land in body.errors regardless of HTTP status (often 200).
  if (body && Array.isArray(body.errors) && body.errors.length > 0) {
    const mapped = mapGraphqlError(res.status, rawHeaders, body.errors);
    throw new AdapterError(
      mapped.error.code as ErrorCode,
      mapped.error.message,
      mapped.error.retry_after_ms ?? null
    );
  }
  if (res.status < 200 || res.status >= 300) {
    throw new AdapterError("UNKNOWN_METHOD", `HTTP ${res.status}`);
  }
  if (!body || !body.data) {
    throw new AdapterError("UNKNOWN_METHOD", "Empty GraphQL response");
  }
  return body.data;
}

// Map Linear's GraphQL error envelope into ABI error codes.
//
//   errors[*].extensions.code === "AUTHENTICATION_ERROR" OR HTTP 401/403  → AUTH_FAILURE
//   errors[*].extensions.code === "RATELIMITED"                            → RATE_LIMIT
//   errors[*].extensions.code === "ENTITY_NOT_FOUND"                       → NOT_FOUND
//   message contains "not found"                                           → NOT_FOUND
//   other                                                                  → UNKNOWN_METHOD
export function mapGraphqlError(
  status: number,
  headers: Headers | Record<string, string>,
  errors: any[]
): { error: { code: string; message: string; retry_after_ms?: number } } {
  const getHeader = (name: string): string | null => {
    if (headers instanceof Headers) return headers.get(name);
    const lower = name.toLowerCase();
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === lower) return (headers as Record<string, string>)[k];
    }
    return null;
  };

  const first = errors[0] ?? {};
  const code: string | undefined =
    first?.extensions?.code || first?.extensions?.type;
  const msg: string = first?.message || `GraphQL error (HTTP ${status})`;

  if (status === 401 || status === 403 || code === "AUTHENTICATION_ERROR") {
    return { error: { code: "AUTH_FAILURE", message: msg } };
  }

  if (code === "RATELIMITED") {
    const resetHeader = getHeader("X-RateLimit-Requests-Reset");
    const resetExt = first?.extensions?.reset;
    let retryAfterMs = 60_000; // default 1 minute
    if (resetHeader) {
      const epochMs = parseInt(resetHeader, 10);
      if (!isNaN(epochMs)) {
        retryAfterMs = Math.max(1000, epochMs - Date.now());
      }
    } else if (typeof resetExt === "number") {
      retryAfterMs = Math.max(1000, resetExt - Date.now());
    }
    return {
      error: { code: "RATE_LIMIT", message: msg, retry_after_ms: retryAfterMs },
    };
  }

  if (code === "ENTITY_NOT_FOUND" || /not found/i.test(msg)) {
    return { error: { code: "NOT_FOUND", message: msg } };
  }

  return {
    error: { code: "UNKNOWN_METHOD", message: `${msg} (HTTP ${status})` },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Team metadata — cached per subprocess
// ──────────────────────────────────────────────────────────────────────────────

interface WorkflowState {
  id: string;
  name: string;
  type: string;
}

interface Label {
  id: string;
  name: string;
}

interface TeamMetadata {
  teamId: string;
  teamKey: string;
  states: WorkflowState[];
  labels: Label[];
}

const TEAM_METADATA_QUERY = `
  query TeamMetadata($key: String!) {
    teams(filter: { key: { eq: $key } }, first: 1) {
      nodes {
        id
        key
        states(first: 100) {
          nodes { id name type }
        }
        labels(first: 250) {
          nodes { id name }
        }
      }
    }
  }
`;

async function getTeamMetadata(teamKey: string): Promise<TeamMetadata> {
  const cached = _teamMetadataCache.get(teamKey);
  if (cached) return cached;
  const data = await linearGraphQL(TEAM_METADATA_QUERY, { key: teamKey });
  const node = data?.teams?.nodes?.[0];
  if (!node) {
    throw new AdapterError("NOT_FOUND", `Team '${teamKey}' not found`);
  }
  const md: TeamMetadata = {
    teamId: node.id,
    teamKey: node.key,
    states: (node.states?.nodes ?? []) as WorkflowState[],
    labels: (node.labels?.nodes ?? []) as Label[],
  };
  _teamMetadataCache.set(teamKey, md);
  return md;
}

function resolveLabelIds(md: TeamMetadata, names: string[]): string[] {
  if (!Array.isArray(names) || names.length === 0) return [];
  const byName = new Map(md.labels.map((l) => [l.name, l.id]));
  const ids: string[] = [];
  for (const n of names) {
    const id = byName.get(n);
    if (!id) {
      throw new AdapterError(
        "OPERATION_UNSUPPORTED",
        `Label '${n}' not found on team '${md.teamKey}'`
      );
    }
    ids.push(id);
  }
  return ids;
}

function resolveStateId(md: TeamMetadata, name: string): string {
  const match = md.states.find((s) => s.name === name);
  if (!match) {
    throw new AdapterError(
      "OPERATION_UNSUPPORTED",
      `State '${name}' not found on team '${md.teamKey}'`
    );
  }
  return match.id;
}

// Resolve a `TEAM-123` identifier to Linear's internal UUID. Cached briefly via
// caller — Linear's `issue(id)` accepts the identifier directly for reads, but
// `issueCreate.parentId` and similar mutations require the UUID.
async function resolveIssueUuid(identifier: string): Promise<string> {
  validateStoryId(identifier);
  const data = await linearGraphQL(
    `query Issue($id: String!) { issue(id: $id) { id } }`,
    { id: identifier }
  );
  if (!data?.issue?.id) {
    throw new AdapterError("NOT_FOUND", `Issue '${identifier}' not found`);
  }
  return data.issue.id;
}

// ──────────────────────────────────────────────────────────────────────────────
// Shape mapping
// ──────────────────────────────────────────────────────────────────────────────

const ISSUE_FIELDS = `
  identifier
  title
  description
  state { name type }
  labels { nodes { name } }
  parent { identifier }
  url
`;

export function toAbiStory(issue: any): any {
  return {
    id: issue.identifier ?? "",
    title: issue.title ?? "",
    body: issue.description ?? "",
    state: issue.state?.name ?? "",
    labels: Array.isArray(issue.labels?.nodes)
      ? issue.labels.nodes.map((l: any) => l.name).filter(Boolean)
      : [],
    parent_id: issue.parent?.identifier ?? null,
    url: issue.url ?? "",
  };
}

export function toAbiStorySubset(issue: any): any {
  return {
    id: issue.identifier ?? "",
    title: issue.title ?? "",
    state: issue.state?.name ?? "",
    labels: Array.isArray(issue.labels?.nodes)
      ? issue.labels.nodes.map((l: any) => l.name).filter(Boolean)
      : [],
    url: issue.url ?? "",
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Method handlers
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_LINEAR_STATES = ["Backlog", "Todo", "In Progress", "Done", "Canceled"];

async function capabilities(): Promise<any> {
  // supported_states and supported_labels are DYNAMIC, derived from the configured
  // team. If LINEAR_TEAM is unset, return Linear's default workflow names so the
  // capability call is still callable without team context.
  let supportedStates: string[] = DEFAULT_LINEAR_STATES;
  let supportedLabels: string[] | null = null;
  if (process.env.LINEAR_TEAM) {
    try {
      const md = await getTeamMetadata(getTeamKey());
      supportedStates = md.states.map((s) => s.name);
      supportedLabels = md.labels.map((l) => l.name);
    } catch (e) {
      if (!(e instanceof AdapterError) || e.code !== "AUTH_FAILURE") {
        // Fall through to defaults on non-auth errors so capabilities is robust.
      } else {
        throw e;
      }
    }
  }
  return {
    abi_version: "1.0.0",
    hierarchy: "hierarchical",
    supports_parent_link: true,
    supported_labels: supportedLabels,
    supported_states: supportedStates,
    metadata: {
      team_field: "teamId",
      project_field: "projectId",
    },
  };
}

const ISSUE_CREATE_MUTATION = `
  mutation IssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {
        identifier
        url
      }
    }
  }
`;

async function createStory(params: any): Promise<any> {
  // Auth must be verified before any config errors surface — otherwise callers
  // with no env vars set get a misleading "LINEAR_TEAM required" instead of
  // "AUTH_FAILURE: missing LINEAR_API_KEY".
  getAuthToken();
  const {
    title,
    body = "",
    labels = [],
    parent_id = null,
    team_value,
    project_value,
  } = params ?? {};
  if (!title) {
    throw new AdapterError("UNKNOWN_METHOD", "createStory requires 'title'");
  }

  // team_value is the team UUID per metadata.team_field; fall back to LINEAR_TEAM
  // resolution if caller passed nothing (Hive may pass team_key as team_value).
  let teamId: string | undefined = team_value;
  let teamMetadata: TeamMetadata | null = null;
  if (!teamId) {
    teamMetadata = await getTeamMetadata(getTeamKey());
    teamId = teamMetadata.teamId;
  }

  // Need team metadata to resolve label names → ids (and for friendly errors).
  if (!teamMetadata) {
    // If team_value was a UUID we still need names → ids. Fetch by LINEAR_TEAM key
    // if available; otherwise we can only accept zero labels.
    if (process.env.LINEAR_TEAM) {
      teamMetadata = await getTeamMetadata(process.env.LINEAR_TEAM);
    } else if (labels.length > 0) {
      throw new AdapterError(
        "AUTH_FAILURE",
        "LINEAR_TEAM env var required for this operation"
      );
    }
  }
  const labelIds = teamMetadata ? resolveLabelIds(teamMetadata, labels) : [];

  let parentUuid: string | null = null;
  if (parent_id) {
    parentUuid = await resolveIssueUuid(parent_id);
  }

  const input: any = { teamId, title, description: body, labelIds };
  if (project_value) input.projectId = project_value;
  if (parentUuid) input.parentId = parentUuid;

  const data = await linearGraphQL(ISSUE_CREATE_MUTATION, { input });
  const issue = data?.issueCreate?.issue;
  if (!data?.issueCreate?.success || !issue) {
    throw new AdapterError("UNKNOWN_METHOD", "issueCreate did not succeed");
  }
  return { id: issue.identifier, url: issue.url ?? "" };
}

const ISSUE_UPDATE_MUTATION = `
  mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue {
        ${ISSUE_FIELDS}
      }
    }
  }
`;

async function updateStatus(params: any): Promise<any> {
  const { id, state } = params ?? {};
  validateStoryId(id);
  if (!state) {
    throw new AdapterError("UNKNOWN_METHOD", "updateStatus requires 'state'");
  }
  // Resolve issue identifier → UUID and state name → state UUID.
  const md = await getTeamMetadata(getTeamKey());
  const stateId = resolveStateId(md, state);
  const issueUuid = await resolveIssueUuid(id);
  const data = await linearGraphQL(ISSUE_UPDATE_MUTATION, {
    id: issueUuid,
    input: { stateId },
  });
  const issue = data?.issueUpdate?.issue;
  if (!data?.issueUpdate?.success || !issue) {
    throw new AdapterError("UNKNOWN_METHOD", "issueUpdate did not succeed");
  }
  return toAbiStory(issue);
}

const LIST_OPEN_QUERY = `
  query ListOpen($teamKey: String!, $first: Int!) {
    issues(
      first: $first,
      filter: {
        team: { key: { eq: $teamKey } },
        state: { type: { nin: ["completed", "canceled"] } }
      }
    ) {
      nodes {
        identifier
        title
        state { name type }
        labels { nodes { name } }
        url
      }
    }
  }
`;

async function listOpen(params: any): Promise<any> {
  const { limit = 50, team_value } = params ?? {};
  const teamKey = team_value && /^[A-Z][A-Z0-9_]*$/.test(team_value)
    ? team_value
    : getTeamKey();
  const first = Math.min(250, Math.max(1, limit));
  const data = await linearGraphQL(LIST_OPEN_QUERY, { teamKey, first });
  const nodes = (data?.issues?.nodes ?? []) as any[];
  const stories = nodes.slice(0, limit).map(toAbiStorySubset);
  return { stories };
}

const GET_STORY_QUERY = `
  query GetStory($id: String!) {
    issue(id: $id) {
      ${ISSUE_FIELDS}
    }
  }
`;

async function getStory(params: any): Promise<any> {
  const { id } = params ?? {};
  validateStoryId(id);
  const data = await linearGraphQL(GET_STORY_QUERY, { id });
  if (!data?.issue) {
    throw new AdapterError("NOT_FOUND", `Issue '${id}' not found`);
  }
  return toAbiStory(data.issue);
}

const ADD_COMMENT_MUTATION = `
  mutation CommentCreate($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
      comment { id }
    }
  }
`;

async function addComment(params: any): Promise<any> {
  const { id, body } = params ?? {};
  validateStoryId(id);
  if (typeof body !== "string") {
    throw new AdapterError("UNKNOWN_METHOD", "addComment requires 'body'");
  }
  const issueUuid = await resolveIssueUuid(id);
  const data = await linearGraphQL(ADD_COMMENT_MUTATION, {
    input: { issueId: issueUuid, body },
  });
  const cid = data?.commentCreate?.comment?.id;
  if (!data?.commentCreate?.success || !cid) {
    throw new AdapterError("UNKNOWN_METHOD", "commentCreate did not succeed");
  }
  return { comment_id: String(cid) };
}

async function linkStories(params: any): Promise<any> {
  // Single call: issueUpdate with parentId. Linear has native parent-child
  // links, so unlike GitHub's 2-call Sub-Issues sequence this is one mutation.
  const { parent_id, child_id } = params ?? {};
  validateStoryId(parent_id);
  validateStoryId(child_id);
  const [parentUuid, childUuid] = await Promise.all([
    resolveIssueUuid(parent_id),
    resolveIssueUuid(child_id),
  ]);
  const data = await linearGraphQL(
    `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
       issueUpdate(id: $id, input: $input) { success }
     }`,
    { id: childUuid, input: { parentId: parentUuid } }
  );
  if (!data?.issueUpdate?.success) {
    throw new AdapterError("UNKNOWN_METHOD", "linkStories did not succeed");
  }
  return {};
}

async function setAssignee(params: any): Promise<any> {
  const { id, assignee_id } = params ?? {};
  validateStoryId(id);
  const issueUuid = await resolveIssueUuid(id);
  // null clears assignment; otherwise pass the UUID directly. Linear stores a
  // single assignee per issue, matching the ABI's single-id semantics.
  const data = await linearGraphQL(
    `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
       issueUpdate(id: $id, input: $input) { success }
     }`,
    { id: issueUuid, input: { assigneeId: assignee_id ?? null } }
  );
  if (!data?.issueUpdate?.success) {
    throw new AdapterError("UNKNOWN_METHOD", "setAssignee did not succeed");
  }
  return {};
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

export { AdapterError };
