# GitHub Task-Tracking Adapter

Implements the Hive task-tracking adapter ABI against GitHub Issues + the Sub-Issues alpha API.

- **ABI version:** `1.0.0`
- **Hierarchy:** `mixed` — issues are flat by default; sub-issues add hierarchical parent linkage.
- **Supports parent link:** `true`
- **Supported states:** `["open", "closed"]`
- **Supported labels:** `null` (GitHub accepts arbitrary label strings)

See [`../../references/task-tracking-adapter-abi.md`](../../references/task-tracking-adapter-abi.md) for the full ABI contract.

## Authentication

The adapter resolves credentials in this order:

1. `gh auth token` — shells out to the GitHub CLI. Preferred because it transparently picks up keychain-stored credentials.
2. `GITHUB_TOKEN` (or `GH_TOKEN`) environment variable — fallback for CI and non-interactive contexts.

If neither is available the adapter emits `AUTH_FAILURE`.

The token requires `repo` scope (private repos) or `public_repo` (public only). Sub-issue linkage also needs `repo`.

## Invocation

The adapter reads JSON from stdin and writes JSON to stdout. Exit code is `0` on success, `1` on adapter-emitted error, `2` only on transport/parse failure.

```bash
# Capabilities
echo '{"method":"capabilities","params":{}}' | ./index.ts

# Create an issue
echo '{
  "method": "createStory",
  "params": {
    "title": "Add pagination",
    "body": "Issues endpoint maxes at 100",
    "labels": ["enhancement"],
    "team_value": "firefly-events",
    "project_value": "plugin-hive"
  }
}' | ./index.ts

# Get a single issue
echo '{"method":"getStory","params":{"id":"firefly-events/plugin-hive#42"}}' | ./index.ts
```

For ad-hoc testing the adapter also accepts the request as `argv[2]`:

```bash
./index.ts '{"method":"capabilities","params":{}}'
```

### Running the TypeScript entry point directly

`index.ts` carries a `#!/usr/bin/env node` shebang. To execute it directly you need a TypeScript-aware Node loader. Install [`tsx`](https://github.com/privatenumber/tsx) globally (or use `npx tsx index.ts`):

```bash
npm install -g tsx
# then either:
tsx ./index.ts < request.json
# or set the shebang interpreter:
PATH="$(npm bin -g):$PATH" ./index.ts < request.json
```

For a true CLI binary, compile to `dist/index.js` with `tsc` (or `esbuild`) and register that path in `hive.config.yaml`.

## ID encoding

Hive sees story IDs as opaque strings. This adapter encodes them as:

```
<owner>/<repo>#<number>
```

Example: `firefly-events/plugin-hive#42`. Decoding is strict — malformed IDs raise `NOT_FOUND` rather than fabricating a fetch.

## Hierarchical mapping

| ABI concept | GitHub mapping |
|-------------|----------------|
| Flat story  | Plain issue   |
| Parent link | Sub-Issues alpha API (`POST /repos/{owner}/{repo}/issues/{parent}/sub_issues`) |
| `parent_id` on `createStory` | Triggers a follow-up `linkStories` call after issue creation |
| `parent_id` on `getStory` response | Derived from `sub_issue_of` field, encoded as `owner/repo#number` |

The Sub-Issues API takes the integer issue `id` (not the human-facing `number`), so `linkStories` does two requests: a GET to resolve the child's integer id, then a POST.

## Rate limiting (tri-modal)

GitHub signals throttling three ways. The adapter maps each to ABI codes:

| GitHub response | ABI mapping |
|-----------------|-------------|
| `HTTP 429` | `RATE_LIMIT` with `retry_after_ms` from `Retry-After` header |
| `HTTP 403` + `x-ratelimit-remaining: 0` | `RATE_LIMIT` (primary) with `retry_after_ms` derived from `x-ratelimit-reset` |
| `HTTP 403` + `Retry-After` present | `RATE_LIMIT` (secondary / abuse) |
| `HTTP 403` alone | `AUTH_FAILURE` |
| `HTTP 401` | `AUTH_FAILURE` |
| `HTTP 404` | `NOT_FOUND` |
| `HTTP 422` | `UNKNOWN_METHOD` (see `friction-notes.md`) |

`retry_after_ms` defaults to 60 000 ms if neither header is present on a rate-limited response.

## Caveats

- **PRs are filtered.** GitHub returns pull requests from `/repos/{owner}/{repo}/issues`. The adapter drops any entry where `pull_request` is set before returning `listOpen` results.
- **Sub-Issues is an alpha API.** Linkage requests use the standard JSON `Accept` header; the endpoint is documented but subject to change. Failures here may surface as `UNKNOWN_METHOD` (HTTP 422) until GitHub publishes a stable contract.
- **Assignment is single-value at the ABI boundary.** GitHub assigns to an array; the adapter wraps the single ABI `assignee_id` (or empty array when null) and **replaces** existing assignees. Co-assignment isn't expressible through the ABI.
- **`team_value` / `project_value` are repo coordinates.** `capabilities.metadata.team_field` is `"owner"` and `project_field` is `"repo"`. Hive should pass the GitHub owner login as `team_value` and the repo name as `project_value`.
- **Capabilities cached per Hive session.** Restart the Hive session to pick up adapter changes (per ABI §Capability caching).
