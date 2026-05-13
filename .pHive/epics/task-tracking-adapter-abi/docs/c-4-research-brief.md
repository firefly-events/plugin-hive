# RESEARCH_BRIEF_FOR: c-4 — Linear adapter as second ABI validator

Form factor: **CLI** (single-file TypeScript executable, fresh subprocess per call, stdin JSON in / stdout JSON out / non-zero exit on error). Mirrors `hive/adapters/github/index.ts` shipped in c-3.

ABI spec: `hive/references/task-tracking-adapter-abi.md` (v1.0.0).
Sibling adapter: `hive/adapters/github/index.ts` (~520 LOC).

---

## SOURCES_READ

1. `/Users/don/Documents/plugin-hive-adapter-abi/hive/references/task-tracking-adapter-abi.md` — full ABI v1.0.0 contract (wire format, 7 methods, error envelope, capability shape, versioning).
2. `/Users/don/Documents/plugin-hive-adapter-abi/hive/adapters/github/index.ts` — c-3 reference implementation (auth, `__setFetch` seam, `mapHttpError`, `encodeStoryId`/`decodeStoryId`, dispatch, `toAbiStory`/`toAbiStorySubset`, all 8 handlers).
3. `/Users/don/Documents/plugin-hive-adapter-abi/hive/references/task-tracking-adapter-abi-schemas/` — JSON schemas for envelopes.
4. `/Users/don/Documents/plugin-hive-adapter-abi/hive/references/task-tracking-adapter.md` — legacy prose runbook (Linear-flavored) — method vocabulary: `createEpicParent`, `createStoryIssue`, `createBugIssue`, `claimIssue`, `releaseIssue`, `updateStatus`, `queryBoard`, `readIssue`, `addComment`.
5. `/Users/don/Documents/plugin-hive-adapter-abi/hive/references/linear-integration.md` + `linear-commands.md` — config keys (`linear_team`, `linear_project`, `linear_user_id`, `branch_prefix`), ceremony usage.
6. context7 `/linear/linear` — `@linear/sdk` reference (LinearClient, createIssue/updateIssue/createComment/issues/issue/teams.states, RatelimitedLinearError shape).
7. context7 `/linear/linear` — raw GraphQL via `client.client.request(query, vars)` for custom queries.
8. Linear docs (web, indexed): `Linear Rate Limiting v2` (`https://linear.app/developers/rate-limiting`) and `Linear GraphQL API Auth` (`https://linear.app/developers/graphql`).

---

## PATTERNS (reuse from c-3 GitHub adapter)

Reuse these verbatim or near-verbatim — they are the ABI envelope contract:

- **File layout:** `hive/adapters/linear/{index.ts, index.test.ts, README.md, friction-notes.md}` mirroring `hive/adapters/github/`.
- **Top-of-file header:** shebang `#!/usr/bin/env node`, ABI-version comment, wire-format reminder, auth precedence, ID encoding doc-line.
- **Types block:** `Request`, `ErrorCode` union, `AbiError`, `FetchResult`, `AdapterError extends Error` (constructor takes `code, message, retry_after_ms = null`).
- **`__setFetch` test seam:** module-scoped `let _fetchImpl = globalThis.fetch; export function __setFetch(f) { _fetchImpl = f; }`. Tests inject a mock handler.
- **`mapHttpError(status, headers, body)`:** exported, branchy, per-branch unit tests (one `describe("mapHttpError")` block per code path).
- **Dispatch shape:** `handlers: Record<string,(p)=>Promise<any>>` keyed by method name; unknown method → `AdapterError("UNKNOWN_METHOD", ...)`.
- **`main()`:** read argv[2] or stdin → JSON.parse with malformed-JSON error envelope + exit 2 → dispatch → `{result}` exit 0 or `{error}` exit 1.
- **`isMain` guard:** so tests can import without spawning `main()`.
- **Encode/decode helpers:** `encodeStoryId(...)` / `decodeStoryId(...)` exported. For Linear use the native identifier `TEAM-123` (not URL components).
- **`toAbiStory` (full) + `toAbiStorySubset` (listOpen omits `body` and `parent_id`).**
- **`capabilities()`** returns hard-coded shape **plus** dynamic `supported_states` fetched from Linear team workflow states (see below).

---

## CONSTRAINTS

### C1. Auth header is `Authorization: <API_KEY>` — NO `Bearer` prefix
Linear docs explicitly distinguish:
- **Personal API key (preferred per memory feedback):** `Authorization: lin_api_xxx` — raw key, no scheme prefix.
- **OAuth access token:** `Authorization: Bearer <token>` — only when supporting third-party apps.

GitHub uses `Authorization: Bearer <token>` unconditionally. Diverge here. Auth precedence: `LINEAR_API_KEY` env var → throw `AUTH_FAILURE` ("set LINEAR_API_KEY"). No equivalent of `gh auth token` shell-out; Linear CLI is third-party and not assumed installed.

### C2. Single-mode rate limiting — do NOT replicate GitHub's tri-modal logic
Linear's rate-limit model (per `linear.app/developers/rate-limiting`):
- HTTP **400** with body `errors[*].extensions.code === "RATELIMITED"` on global/endpoint limits (NOT 429). GraphQL convention: errors live in body even on 200/400.
- Headers (sent on every response): `X-RateLimit-Requests-Limit`, `X-RateLimit-Requests-Remaining`, `X-RateLimit-Requests-Reset` (UTC epoch ms). Complexity: `X-Complexity`, `X-RateLimit-Complexity-{Limit,Remaining,Reset}`. Per-endpoint: `X-RateLimit-Endpoint-Requests-{Limit,Remaining,Reset}` + `X-RateLimit-Endpoint-Name`.
- Limits: API key = 2,500 req/hr/user (some sources cite 5,000 — c-4 should not hardcode); complexity = 3,000,000 pts/hr/user.

**`mapHttpError` for Linear:**
| Signal | ABI code | retry_after_ms |
|---|---|---|
| Body has `errors[*].extensions.code === "RATELIMITED"` (regardless of HTTP status) | `RATE_LIMIT` | derive from `X-RateLimit-Requests-Reset` (or Endpoint variant) → `Math.max(1000, reset_ms - Date.now())`; fallback `60_000` |
| HTTP 401 OR body `errors[*].extensions.code === "AUTHENTICATION_ERROR"` | `AUTH_FAILURE` | null |
| HTTP 403 OR body `errors[*].extensions.code === "FORBIDDEN"` | `AUTH_FAILURE` | null |
| Body `errors[*].extensions.code === "INVALID_INPUT"` and message implies not-found (or `entityId` missing) | `NOT_FOUND` | null |
| `client.issue(id)` returns null/throws "Entity not found" | `NOT_FOUND` | null |
| anything else | `UNKNOWN_METHOD` | null |

No `403 + x-ratelimit-remaining: 0` branch; no `Retry-After` header (Linear uses `Reset` epoch instead). Keep per-branch unit tests — same structure as c-3, fewer branches.

### C3. Hierarchy: `hierarchical` — `linkStories` is NOT optional
Per memory feedback ("hierarchical → linkStories non-optional"). Capability response:
```json
{
  "abi_version": "1.0.0",
  "hierarchy": "hierarchical",
  "supports_parent_link": true,
  "supported_labels": null,
  "supported_states": [/* dynamic — see C4 */],
  "metadata": { "team_field": "teamId", "project_field": "projectId" }
}
```

### C4. `supported_states` is dynamic — fetched from team workflow states
Linear teams customize their workflow. Each `WorkflowState` has `id`, `name`, `type` (one of `backlog | unstarted | started | completed | canceled | triage`). Hive validates `state` arguments from `updateStatus` against this list, so we MUST enumerate the *names* the user's team actually has.

**Strategy:** require `LINEAR_TEAM` env var (or `team_value` param on capabilities — spec ambiguity, see Risk R3). `capabilities` issues:
```graphql
query TeamStates($team: String!) {
  team(id: $team) { id name states { nodes { id name type } } }
}
```
Cache nothing (fresh subprocess model). Return `supported_states: states.nodes.map(s => s.name)`. Map ABI `state` string → Linear `stateId` by name lookup at `updateStatus` time (re-issue states query, expensive but stateless — acceptable since Hive caches capabilities response per `CACHE_TTL_MS`).

### C5. Story ID encoding: native `TEAM-123` identifier
Per reviewer note. `encodeStoryId(identifier)` is identity; `decodeStoryId(id)` validates `/^[A-Z][A-Z0-9_]*-\d+$/` and throws `NOT_FOUND` on shape mismatch. The Linear `issue(id: "TEAM-123")` GraphQL resolver accepts identifier directly — no UUID lookup needed.

### C6. `linkStories` is ONE call (not GitHub's two)
Linear `issueUpdate(id, { parentId })` accepts the parent issue's identifier directly. GraphQL gives the parent in `issue.parent { identifier }` in one fetch — no lazy fetch needed. This is the single biggest simplification vs c-3.

### C7. `setAssignee` semantics
Linear `assigneeId` is a single optional UUID (not GitHub's array). ABI passes one id or null. Mapping is direct: `issueUpdate(id, { assigneeId })`. Note: Linear assignee is a **user UUID**, NOT a username/email — document this in `friction-notes.md` (Hive callers must resolve username → UUID separately, e.g. via `users` query). Memory has `linear_user_id` config key — same UUID concept.

---

## METHOD MAPPING (ABI → Linear GraphQL)

Recommend using `@linear/sdk` (LinearClient) for ergonomics + typed errors, OR raw `fetch` against `https://api.linear.app/graphql` for zero-dep (matches c-3 style). **Recommendation: raw `fetch` + GraphQL strings**, because the `__setFetch` seam is cleanest with `fetch`, and `@linear/sdk` adds ~700KB and an extra abstraction layer. The SDK's `client.client.request` is useful as a reference for query shapes only.

| ABI method | GraphQL operation | Notes |
|---|---|---|
| `capabilities` | `query { team(id: $team) { states { nodes { name type } } } }` | Static fields + dynamic states |
| `createStory` | `mutation { issueCreate(input: { teamId, title, description, labelIds, assigneeId, parentId, projectId }) { success, issue { identifier, url, ... } } }` | `labelIds` requires resolving label names → UUIDs (extra query OR document: Hive passes label names, adapter does name→UUID lookup once) — flag as friction |
| `updateStatus` | `mutation { issueUpdate(id, input: { stateId }) { success, issue { ... } } }` | Resolve `state` name → `stateId` UUID via team states query |
| `listOpen` | `query { issues(filter: { team: {id: {eq: $team}}, state: {type: {nin: ["completed","canceled"]}} }, first: $limit, orderBy: updatedAt) { nodes { identifier, title, state{name}, labels{nodes{name}}, url } } }` | Drop `body` + `parent_id` per c-3 subset rule |
| `getStory` | `query { issue(id: $id) { identifier, title, description, state{name}, labels{nodes{name}}, parent{identifier}, url } }` | `id` is `TEAM-123` |
| `addComment` | `mutation { commentCreate(input: { issueId, body }) { success, comment { id } } }` | `issueId` accepts identifier per Linear API |
| `linkStories` | `mutation { issueUpdate(id: $child_id, input: { parentId: $parent_id }) { success } }` | **ONE call** — Linear takes identifiers directly |
| `setAssignee` | `mutation { issueUpdate(id, input: { assigneeId }) { success } }` | `null` clears |

### Full GraphQL POST request shape
```ts
async function lnFetch(query: string, variables: any) {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) throw new AdapterError("AUTH_FAILURE", "set LINEAR_API_KEY");
  const res = await _fetchImpl("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": apiKey,  // NO Bearer
      "User-Agent": "hive-linear-adapter/0.1.0",
    },
    body: JSON.stringify({ query, variables }),
  });
  const headers = {};
  res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  const body = await res.json();
  if (body.errors) throw mapGraphqlError(res.status, headers, body.errors);
  return { status: res.status, headers, data: body.data };
}
```

---

## RISKS

### R1. Label resolution adds a hidden round-trip on every `createStory`
Linear `issueCreate.input.labelIds` requires UUIDs. ABI passes `labels: string[]`. Either:
(a) Adapter pre-fetches team labels (+1 query per createStory), maps names→UUIDs, throws `UNKNOWN_METHOD` on unknown label; OR
(b) Declare `supported_labels: null` (already planned) and document that Hive callers must pass UUIDs in the `labels` array. **Recommend (a)** — matches the GitHub adapter's friction-free string semantics. Document in `friction-notes.md` as "implicit name resolution; cost: +1 GraphQL request per createStory".

### R2. State resolution on `updateStatus` adds a round-trip
Same shape as R1: ABI `state` is a string ("In Progress"), Linear needs `stateId` UUID. Strategy: same as R1(a) — resolve at call time. Friction note: this is fundamental to Linear's customizable workflow model and unavoidable without caller-side caching.

### R3. `capabilities` needs team context but ABI does not pass `team_value` to capabilities
ABI `capabilities` method takes empty params (`{"method":"capabilities","params":{}}`) but `supported_states` requires a team. Options:
(a) Require `LINEAR_TEAM` env var (e.g. `LINEAR_TEST_TEAM` for tests, `LINEAR_TEAM` for prod). **Recommended** — matches Linear-integration ref's pattern of `linear_team` in `hive.config.yaml`.
(b) Return union of states across all teams in the workspace (expensive, ambiguous).
(c) Return empty `supported_states` and emit a friction-note for a future ABI revision that lets `capabilities` accept `team_value`.

Pick (a) and flag (c) as ABI feedback for v1.1.

### R4. Rate limit code lives in body, not HTTP status
Tri-modal logic in c-3 keys off HTTP status + headers. Linear's rate-limit signal can return HTTP 200 *with* `errors[].extensions.code === "RATELIMITED"`. `mapHttpError` must accept the GraphQL `errors` array as input, not just status+headers. Suggest renaming the helper `mapGraphqlError(status, headers, errors)` to make the divergence explicit and avoid copy-paste confusion across adapters.

### R5. ID format collision
`TEAM-123` shape `[A-Z]+-\d+` collides with nothing in c-3, but if Hive cross-adapter dispatch ever auto-detects adapter by ID shape, document the regex now. GitHub IDs are `owner/repo#N`; Linear IDs are `TEAM-N` — distinct.

### R6. Subprocess-fresh + dynamic capabilities = N+1 in capability discovery
Per-call spawning means `capabilities` runs a Linear API call. ABI spec § Capability caching allows Hive-side caching; document expected TTL (≥1 hr) so we don't burn the 2,500 req/hr quota on capabilities probes alone.

### R7. Hive config keys are not standardized across adapters yet
GitHub adapter takes `team_value=<owner>`, `project_value=<repo>` per call. Linear should accept `team_value=<team-id-or-key>`, `project_value=<project-id-or-name>` symmetrically — but Linear `linear_team` is a team **key** (e.g., "ACME") while the GraphQL `team(id: $key)` accepts either UUID or key. Adapter should pass through as-is. Friction-note for c-5a (dispatch module) to confirm semantics.

---

## FINDINGS — FRICTION vs GitHub adapter

| Aspect | GitHub (c-3) | Linear (c-4) | Note |
|---|---|---|---|
| Auth header | `Authorization: Bearer <token>` | `Authorization: <api_key>` (raw) | Diverge — do NOT copy header line from c-3 |
| Auth source | `gh auth token` → `GITHUB_TOKEN` env | `LINEAR_API_KEY` env only | No equivalent CLI fallback |
| Transport | REST per path | Single POST `/graphql` with query+variables | All operations share one `lnFetch` |
| Rate-limit signal | HTTP 429 OR 403 + headers (tri-modal) | Body `errors[].extensions.code === "RATELIMITED"` (often HTTP 200 or 400) | Different mapping logic |
| `linkStories` | 2 calls (GET child id → POST sub_issues) | 1 call (`issueUpdate { parentId }`) | Linear wins |
| Parent on `getStory` | `sub_issue_of.number` (sometimes absent) | `parent.identifier` (always returned if requested in GraphQL selection) | Reliable; no opportunistic check needed |
| `supported_states` | Static `["open","closed"]` | Dynamic — fetched from team workflow | Capability call hits API |
| Label semantics | Pass through strings (GitHub stores as strings) | Names → UUIDs lookup required | +1 query per `createStory`/`updateStatus` |
| State semantics | Two values, native | Custom per team, name → UUID | +1 query per `updateStatus` |
| Hierarchy | `mixed` | `hierarchical` | Different capability value |
| Test seam | `__setFetch` (fetch swap) | Same pattern | Reuse verbatim |
| Test gate envs | `GITHUB_TOKEN` + `GITHUB_TEST_REPO` | `LINEAR_API_KEY` + `LINEAR_TEST_TEAM` (+ optional `LINEAR_TEST_PROJECT`) | Same gating shape |
| 422 mapping | → `UNKNOWN_METHOD` (closest) | Linear's `INVALID_INPUT` → `UNKNOWN_METHOD` similarly | Same compromise |
| Lines (estimate) | ~520 | ~450-500 (GraphQL is denser than REST) | Similar |

### Implementation order (recommended for c-4)
1. Scaffold `hive/adapters/linear/` — copy structure from `github/`, delete branch-specific bodies.
2. Implement `lnFetch` + `mapGraphqlError` + per-branch tests.
3. Implement `capabilities` (dynamic `supported_states`).
4. Implement `getStory` (simplest read; validates id decoding + GraphQL shape).
5. Implement `createStory` with label name→UUID resolver helper.
6. Implement `updateStatus` with state name→UUID resolver helper (shares the per-team-state cache pattern with createStory's label resolver — refactor both to a shared `getTeamMetadata(teamKey)` helper after both work).
7. Implement `listOpen`, `addComment`, `setAssignee`, `linkStories` (one each).
8. Write `hive/adapters/linear/README.md` (invocation examples, env vars).
9. Write `hive/adapters/linear/friction-notes.md` documenting R1–R7.
10. Integration test against real Linear team gated on `LINEAR_API_KEY` + `LINEAR_TEST_TEAM`; mock-only tests run unconditionally via `__setFetch`.

### Test strategy
- **Mock tests (unconditional):** mirror c-3's `index.test.ts` structure — one `describe` per method, one `describe` for `mapGraphqlError` with a branch per error code. Inject GraphQL response bodies via `__setFetch`.
- **Live tests (gated):** `if (!process.env.LINEAR_API_KEY || !process.env.LINEAR_TEST_TEAM) skip;` — create issue, update status, comment, link to parent, set assignee, fetch, list, delete (or close + tag with `[hive-test]` since Linear lacks hard delete via API for some plans). Document any live-test skips in `friction-notes.md` (per memory feedback on c-3).

---

## OPEN QUESTIONS (defer to c-4 developer)

1. **`@linear/sdk` vs raw fetch?** Brief recommends raw fetch (matches c-3 zero-dep style + cleaner `__setFetch` seam). Confirm before scaffolding.
2. **Label/state UUID caching across one subprocess call?** YES — within a single dispatch, cache the team metadata fetch so `createStory({title, labels:[...]})` doesn't issue two identical state+label queries. Caching across subprocess invocations is Hive's job per ABI.
3. **`assignee_id` semantics — accept username OR UUID?** Brief says UUID-only (matches Linear native). Document username resolution as out-of-scope.
4. **`project_value` semantics — project UUID, name, or slug?** Linear `project(id: ...)` accepts UUID only. Suggest documenting that `project_value` must be the project UUID and Hive callers handle name→UUID lookup once at config-load time. Or do name resolution inside the adapter (+1 query per call). Lean toward UUID-only and add to friction-notes.
