RESEARCH_BRIEF_FOR: c-2-abi-specification

---

## SOURCES_READ

- `hive/references/task-tracking-adapter-abi-sketch.md` — c-1 ABI sketch with method stubs, wire format, capability declaration, and atoshell placeholder
- `hive/references/task-tracking-adapter.md` — prose-runbook with 9 adapter operations
- `hive/references/task-tracking-adapter-linear.md` — FILE_NOT_FOUND
- `hive/references/task-tracking-adapter-github.md` — FILE_NOT_FOUND

---

## PATTERNS_OBSERVED

### Wire Format (pinned from sketch)

Dispatch: `spawnSync(adapterPath, [], { input: JSON.stringify(call) })` — one subprocess per call, fresh, no persistent socket.

Request envelope (stdin):
```json
{ "method": "<name>", "params": { ... } }
```

Success response (stdout, exit 0):
```json
{ "result": { ... } }
```

Error response (stdout, exit 1):
```json
{ "error": { "code": "NOT_FOUND", "message": "..." } }
```

Only one error code is demonstrated in the sketch (`NOT_FOUND`). The example adapter also uses `UNKNOWN_METHOD`. Auth and rate-limit codes are not in the sketch — they are open slots.

### Method Stubs Extracted from c-1 Sketch

| ABI Method     | Params (sketch)                                          | Result shape                                             |
|----------------|----------------------------------------------------------|----------------------------------------------------------|
| `capabilities` | `{}`                                                     | `{hierarchy, supports_parent_link, metadata:{team_field,project_field}}` |
| `createStory`  | `{title, body, parent_id?, labels?, team_field?, project_field?}` | `{id, url}`                                  |
| `updateStatus` | `{id, status: "open|in_progress|done|cancelled"}`        | `{ok: true}`                                             |
| `listOpen`     | `{limit:50, team_field?, project_field?}`                | `{stories:[{id,title,status,url}]}`                      |
| `getStory`     | `{id}`                                                   | `{id,title,body,status,labels,parent_id,url}`            |
| `addComment`   | NOT IN SKETCH — present in prose-runbook only            | (pending c-2 definition)                                 |
| `linkStories`  | NOT IN SKETCH — implied by `supports_parent_link` flag   | (pending c-2 definition)                                 |

### Prose-Runbook → ABI Method Mapping (9 operations)

| Prose-runbook operation          | ABI method        | Notes                                                  |
|----------------------------------|-------------------|--------------------------------------------------------|
| `createEpicParent(title, desc)`  | `createStory`     | `parent_id=null`; hierarchy=hierarchical trackers only |
| `createStoryIssue(title, desc, parentId)` | `createStory` | `parent_id` set; standard story creation          |
| `createBugIssue(title, desc, parentStoryId, priority)` | `createStory` | labels=["bug"]; priority extension needed  |
| `claimIssue(issueId, userId)`    | NOT YET IN ABI    | Assignment lock — maps to `updateStatus` partially; needs `assignee` field or separate method |
| `releaseIssue(issueId)`          | NOT YET IN ABI    | Inverse of claim; same gap                            |
| `updateStatus(issueId, status)`  | `updateStatus`    | Direct 1:1 map                                        |
| `queryBoard(project)`            | `listOpen`        | `project_field` param filters scope                   |
| `readIssue(issueId)`             | `getStory`        | Direct 1:1 map                                        |
| `addComment(issueId, body)`      | `addComment`      | In prose-runbook; stub missing from c-1 sketch         |

**Gap:** `claimIssue`/`releaseIssue` (assignment-based locking) have no ABI method. Either extend `updateStatus` with an optional `assignee` field or add `setAssignee` as a 7th method. Recommend surfacing this as a c-2 decision point.

---

## CONSTRAINTS

1. **Subprocess lifecycle is fresh-per-call** (`spawnSync` in sketch). This is the current spec — not persistent. The 52ms cost reviewer note applies here: at ~52ms cold-spawn cost per call, a 6-method session startup + story create + status update = ~312ms minimum. Sketch explicitly notes that MCP (persistent) is the migration path if batch-operation volume makes this prohibitive.

2. **`capabilities` dispatch semantics are undefined for CLI form factor.** Sketch says "called by Hive at dispatch-time" but uses the same `spawnSync` mechanism — so `capabilities` incurs its own 52ms cold spawn. There is no in-sketch mechanism for per-session capability caching.

3. **`team_field`/`project_field` dual role is ambiguous in sketch.** They appear in both `capabilities.metadata` (as field *names* the adapter declares it understands) and in `listOpen.params` and `createStory.params` (as runtime *values* passed by Hive). The sketch does not explicitly distinguish these roles.

4. **`atoshell` appears as `atoshell (if revisited)` in the sketch hierarchy table.** It is a placeholder tracker name, not a real integration. The canonical normalized form is `atoshell-if-revisited` in the sketch source; c-2 should either drop this row or replace it with a generic `flat-tracker` label.

5. **Error code set is partially implied.** `NOT_FOUND` and `UNKNOWN_METHOD` are demonstrated. `AUTH_FAILURE` and `RATE_LIMIT` are absent from the sketch. The reviewer's requirement closes the enum at exactly these 4.

---

## RISKS

1. **Assignment-lock gap.** `claimIssue`/`releaseIssue` are load-bearing in the prose-runbook (prevent double-claiming) but have no ABI stub. If c-2 doesn't add `setAssignee` or extend `updateStatus`, any adapter implementing locking must do it out-of-band.

2. **Capability cache miss on every call.** Fresh-per-call `spawnSync` means each call re-reads `hive.config.yaml` and re-resolves adapter path. If Hive calls `capabilities` before every `createStory`, that doubles the per-call cost.

3. **`listOpen` returns no `parent_id`.** The result stub is `{id,title,status,url}` — no hierarchy info. Caller cannot reconstruct parent-child relationships from list output alone, requiring a follow-up `getStory` per item if hierarchy matters.

4. **`addComment` and `linkStories` are undefined.** Both appear in the 6-method target but have no JSON stubs in the sketch. c-2 must define them from scratch.

---

## FINDINGS

### F1 — Subprocess lifecycle: fresh-per-call (current spec)
The sketch uses `spawnSync` explicitly, which is synchronous and fresh per invocation. This is not an open question — it is the specified behavior. The 52ms cost is real and cumulative. **Recommendation for c-2:** Keep fresh-per-call as the v1 spec (simpler, stateless, no zombie processes). Add a note that Hive MAY cache the capability response in its own session state after the first call, without requiring the adapter to be persistent. This eliminates the double-spawn for `capabilities`.

### F2 — Capability caching: Hive-side, per-session
Since the adapter is stateless (fresh subprocess), caching must live in Hive's runtime, not the adapter. **Recommendation:** Hive calls `capabilities` once at first adapter invocation, stores result in session-scoped memory (e.g., a module-level cache keyed by adapter path), and reuses it for all subsequent calls in that session. Adapter authors need not implement any caching.

### F3 — Error code closed enum (4 codes)
Map external errors to exactly 4 adapter-level codes:

| Code            | Category    | Retry semantics          | Trigger examples                                 |
|-----------------|-------------|--------------------------|--------------------------------------------------|
| `NOT_FOUND`     | Terminal*   | No retry (or soft retry if polling for eventual consistency) | Linear 404, GitHub 404 |
| `AUTH_FAILURE`  | Terminal    | No retry; surface to user | Linear 401/403, GitHub 401/403, expired token   |
| `RATE_LIMIT`    | Recoverable | Retry after backoff; adapter SHOULD include `retry_after_ms` in error message | Linear quota, GitHub 429 |
| `UNKNOWN_METHOD`| Terminal    | No retry; indicates adapter version mismatch | Method name not in adapter's case statement |

*`NOT_FOUND` is terminal in most cases. Exception: if Hive is polling for a story that was just created (eventual-consistency window), a single retry after 1s is acceptable. Adapter cannot distinguish these cases — Hive caller decides retry policy.

### F4 — team_field/project_field: capability metadata vs runtime filter
`capabilities.metadata.team_field` = the *name of the parameter* (e.g., `"teamId"`, `"owner"`) that the adapter uses for team scoping. It is a schema declaration.

`listOpen.params.team_field` and `createStory.params.team_field` = the *runtime value* (e.g., `"TEAM-ABC"`, `"firefly-events"`) passed by Hive at call time, using the field name the adapter declared.

These are two different things sharing the same key name. c-2 should rename the runtime params to `team_value` and `project_value` to avoid confusion, or add a prose note clarifying the distinction.

### F5 — atoshell normalization
The sketch uses `atoshell (if revisited)` as a label in the hierarchy table. This is a placeholder for any future flat-tracker integration. **Recommendation:** Replace the example tracker label in the `flat` row with `"any-flat-tracker (e.g., Trello)"` and drop the `atoshell` reference. If atoshell becomes a real integration it warrants its own row at that time.

### F6 — addComment stub
Infer from prose-runbook `addComment(issueId, body)`:
```json
Request:  { "method": "addComment", "params": { "id": "string", "body": "string" } }
Response: { "result": { "ok": true, "comment_id": "string | null" } }
```
`comment_id` is nullable because not all trackers return a comment ID on creation.

### F7 — linkStories stub
The sketch implies this via `supports_parent_link: true` but provides no method. Infer:
```json
Request:  { "method": "linkStories", "params": { "child_id": "string", "parent_id": "string" } }
Response: { "result": { "ok": true } }
```
Adapters where `supports_parent_link: false` MUST return `{ "error": { "code": "UNKNOWN_METHOD", "message": "linkStories not supported by this adapter" } }`.

### F8 — Assignment locking gap
`claimIssue` / `releaseIssue` from the prose-runbook have no ABI stub. Recommend adding a 7th method `setAssignee`:
```json
Request:  { "method": "setAssignee", "params": { "id": "string", "assignee_id": "string | null" } }
Response: { "result": { "ok": true } }
```
`assignee_id: null` = release. This preserves the locking protocol without a separate `releaseIssue` method.
