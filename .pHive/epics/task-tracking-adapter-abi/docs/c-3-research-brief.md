# RESEARCH_BRIEF_FOR: c-3-github-adapter-as-abi-validator

**Form factor:** CLI (JSON-over-stdio, spawnSync, fresh-per-call) — locked by c-1
**ABI version target:** 1.0.0 (from c-2)
**Hierarchy declaration:** `mixed` (issues flat; Projects v2 / sub-issues hierarchical)
**Output dir:** `hive/adapters/github/` (currently empty — clean slate, no legacy adapter to migrate)

---

## SOURCES_READ

- `hive/references/task-tracking-adapter-abi.md` — full ABI contract (CLI wire format, capability declaration, 7 method signatures, error model, versioning, common pitfalls)
- `hive/references/task-tracking-adapter-abi-schemas/*.json` — 8 draft-07 JSON schemas (capabilities, createStory, updateStatus, listOpen, getStory, addComment, linkStories, setAssignee)
- `hive/references/task-tracking-adapter.md` — legacy prose-runbook spec (Linear-flavored; non-canonical for c-3)
- `.pHive/epics/task-tracking-adapter-abi/stories/c-3-github-adapter-as-abi-validator.yaml` — story spec
- GitHub REST docs:
  - Issues API: `https://docs.github.com/en/rest/issues/issues`
  - Sub-Issues API: `https://docs.github.com/en/rest/issues/sub-issues`
  - Issue Comments: `https://docs.github.com/en/rest/issues/comments`
  - Issue Assignees: `https://docs.github.com/en/rest/issues/assignees`
  - Rate limits: `https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api`
- `gh` CLI manual: `https://cli.github.com/manual/gh_issue`

**Knowledge base source labels (for follow-up search):**
- `GitHub REST Issues API`
- `GitHub REST Sub-Issues API`
- `GitHub REST Issue Comments`
- `GitHub REST Rate Limits`
- `GitHub REST Assignees`
- `gh CLI issue manual`

---

## PATTERNS

### P1. CLI subprocess shape (fresh-per-call)
- Single binary at `hive/adapters/github/index.<ext>`. Each call = one process: read stdin (request envelope) → make GitHub API calls → write `{"result": ...}` to stdout → exit 0; or `{"error": {...}}` + exit 1.
- ABI's Node.js skeleton at `Task-Tracking Adapter ABI > Step 6` is the canonical template.

### P2. Capability declaration for GitHub
```json
{
  "result": {
    "abi_version": "1.0.0",
    "hierarchy": "mixed",
    "supports_parent_link": true,
    "supported_states": ["open", "closed"],
    "supported_labels": null,
    "metadata": { "team_field": "owner", "project_field": "repo" }
  }
}
```
- `hierarchy: mixed` — matches ABI's GitHub example exactly.
- `supports_parent_link: true` — uses Sub-Issues API for `linkStories`.
- `supported_states: ["open", "closed"]` — GitHub's only native issue states. Stale-but-honest; do not invent intermediate states.
- `supported_labels: null` — GitHub repos accept any string label; if absent on the repo, the create endpoint silently drops the label per docs.
- `team_field: "owner"`, `project_field: "repo"` — GitHub orgs/users are the team grouping; repos are the project. `team_value="firefly-events"` + `project_value="plugin-hive"` resolves to `firefly-events/plugin-hive`.

### P3. Auth pattern (prefer `gh` CLI auth, fall back to env)
- Reuse existing dev tooling: shell out to `gh auth token` if `GITHUB_TOKEN`/`GH_TOKEN` unset. Keeps adapter usable without exporting tokens.
- Fine-grained PAT scope: "Issues" repo permission (read+write), "Pull requests" (read for issue comments parity), optionally "Metadata" (read). Classic PAT: `repo`.

### P4. Transport — raw REST via fetch
- **Decision: raw REST via `fetch` (Node 18+), NOT `gh` CLI.** Rationale:
  - Direct access to `Retry-After` / `X-RateLimit-Reset` headers required for ABI `retry_after_ms`.
  - `gh issue list` returns flattened JSON that drops the headers we need.
  - One subprocess (us) → many API calls; nesting another subprocess per call adds latency to a fresh-per-call adapter.
  - Auth source can still be `gh auth token` resolved once at startup.

### P5. Pagination
- `listOpen` default `limit=50`. GitHub `per_page` max=100. For `limit<=100` use single page; for `limit>100` paginate via `Link: rel="next"` until count satisfied or runs out. Story default likely never exceeds 100.

---

## CONSTRAINTS

### C1. Story ID type — coercion rule (FRICTION FLAG)
- ABI `id` is **string everywhere** (verified in all 8 schemas).
- GitHub issue `number` is an integer; `node_id` is an opaque GraphQL global ID string.
- **Recommended ID scheme: `"<owner>/<repo>#<number>"` string** (e.g., `"firefly-events/plugin-hive#42"`).
  - Parseable on adapter side; survives across `team_value`/`project_value` changes within one cycle.
  - Avoids ambiguity if Hive caches IDs across repos.
  - Plain `"42"` is insufficient — adapter is repo-agnostic between calls (fresh-per-call) and `team_value`/`project_value` are optional params.
- Trade-off noted under FRICTION below.

### C2. State mapping
- ABI `updateStatus(id, state)` — `state` must be in `supported_states`. We declare `["open", "closed"]` only.
- GitHub `PATCH /issues/{number}` accepts `state: "open" | "closed"` plus `state_reason: "completed" | "not_planned" | "reopened"`. We don't expose `state_reason` in v1 (extension point for future minor version).

### C3. Sub-Issues API requires integer ID
- `POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues` body: `{"sub_issue_id": <integer>}` — uses internal issue ID (not `node_id`, not `number`). Adapter must:
  1. Resolve `child_id` (our string format) → fetch issue via `GET /issues/{number}` → extract `id` (integer).
  2. POST to parent's sub_issues endpoint.
- Parent + child must be in same repo OR cross-repo allowed per docs — confirm with integration test.

### C4. Rate limits — both primary and secondary
- Primary: 5000 req/hr authenticated PAT; 15000 req/hr for GitHub Apps. Headers: `x-ratelimit-remaining`, `x-ratelimit-reset` (UTC epoch seconds).
- Secondary: triggered on bursts (>100 concurrent, >900 points/min per endpoint, content-creation throttling — 80/min, 500/hr). Returns 403 OR 429.
- **Both classes return `403` OR `429`** — adapter cannot distinguish by status code alone. Detection rule:
  - `429` → `RATE_LIMIT`
  - `403` + `x-ratelimit-remaining: 0` → primary rate limit → `RATE_LIMIT` with `retry_after_ms = (x-ratelimit-reset - now) * 1000`
  - `403` + `retry-after` header present → secondary rate limit → `RATE_LIMIT` with `retry_after_ms = retry-after * 1000`
  - `403` without either → `AUTH_FAILURE` (insufficient scope)
- Always provide `retry_after_ms` (ABI pitfall #5). Fall back to a sane floor (e.g., 60000ms) if neither header parses.

### C5. CLI wire format invariants
- Void methods (`linkStories`, `setAssignee`) → `{"result": {}}`. Not `{"result": null}`, not `{"result": true}`.
- All exits non-zero treated as crash by Hive (`UNKNOWN_METHOD`, "adapter crashed"). Wrap top-level in try/catch and always print a valid JSON envelope before exit.
- `additionalProperties: false` on every schema — adapter MUST NOT emit extra fields (e.g., `created_at`). Strip to ABI shape.

### C6. Required deliverables (from story AC)
- `hive/adapters/github/index.<ext>` (TypeScript or JavaScript per c-1 — verify in c-1 output; default Node 18+ JS)
- `hive/adapters/github/README.md` — auth setup, rate-limit semantics, mixed-hierarchy explanation, env vars (`GITHUB_TOKEN`, `GITHUB_TEST_REPO`)
- `hive/adapters/github/test/*.test.<ext>` — covers all 7 methods × happy path + 1 error path each
- `hive/adapters/github/friction-notes.md` — present even if empty

---

## RISKS

### R1. Sub-Issues API maturity / availability
- The `sub_issues` endpoints are versioned at `X-GitHub-Api-Version: 2026-03-10`. Confirm on test repo; some older orgs may not have it enabled. **Mitigation:** integration test exercises `linkStories` early; if unsupported on the test repo, fall back to body-reference link (`Parent: #N`) and document under FRICTION rather than blocking c-3.

### R2. Labels silently dropped without push access
- GitHub create-issue endpoint: "Only users with push access can set labels for new issues. Labels are silently dropped otherwise." Same for `assignees` and `milestone`. **Mitigation:** README must note that the auth principal needs push access (write on Issues), or `createStory` will succeed but lose labels. Test fixture asserts the returned story echoes input labels.

### R3. Issue numbers reused for PRs
- "Every pull request is an issue, but not every issue is a pull request" — `listOpen` will return both. `pull_request` key present on PR entries.
- **Mitigation:** filter `listOpen` response to drop entries with a `pull_request` key. Document in friction-notes.

### R4. ID stability — issue can be moved/transferred
- `gh issue transfer` changes owner/repo; our `<owner>/<repo>#<number>` ID becomes stale across transfer. ABI says "stable identifier."
- **Mitigation:** document as known caveat in friction-notes; transfer is rare and out-of-band; do not pre-optimize.

### R5. Test repo provisioning + secrets
- AC requires "real GitHub repo" or "documented mock server fixture." A real test repo is faster to bring up and more honest, but needs a token in CI.
- **Recommendation:** primary path = real repo (e.g., `firefly-events/plugin-hive-adapter-abi-test` or a `*-sandbox` repo); CI uses an org PAT scoped to that repo only. Mock fallback (e.g., `nock`) for offline + PR CI from forks. Both paths run the same test suite, gated by `GITHUB_TEST_REPO` presence.

### R6. Comment `addComment` returns `id` as integer
- GitHub comment endpoint returns `id` (integer) and `node_id` (string). ABI wants `comment_id: string`. Coerce: `String(comment.id)` is sufficient since comments aren't cross-referenced via the adapter. Same rule as C1 but simpler — comments live under one issue.

### R7. `parent_id` in `createStory` is a two-step write
- ABI says `createStory(parent_id=X)` SHOULD apply the link for hierarchical/mixed adapters. GitHub has no atomic "create issue with parent" — must POST issue, then POST sub_issue. If the second call fails (rate limit, race), we have a dangling issue. **Mitigation:** treat as best-effort; on failure of step 2, still return the created child but include a friction-note. Alternative: reject `parent_id` in `createStory` and require explicit `linkStories` — but that contradicts ABI's RECOMMENDED behavior.

### R8. `team_field=owner` / `project_field=repo` is an interpretation
- ABI's example capability for GitHub uses `"owner"` / `"project"`. We're using `"owner"` / `"repo"` to be more honest about what GitHub calls it. Worth confirming with c-2 owner that this isn't load-bearing — if Hive looks up the literal string in some registry, we should match the example. **Recommendation:** match ABI example exactly (`team_field: "owner"`, `project_field: "project"`) and document repo-as-project mapping in README to avoid an unnecessary deviation.

---

## METHOD → ENDPOINT MAP

| ABI method | GitHub REST endpoint | Notes |
|---|---|---|
| `capabilities` | (none — static) | Static object; no API call. |
| `createStory` | `POST /repos/{owner}/{repo}/issues` | Body: `{title, body, labels[], assignees[]}`. Resolve `team_value`/`project_value` → `owner/repo`. If `parent_id` set → follow with `POST /repos/{O}/{R}/issues/{N}/sub_issues`. Return `{id: "<O>/<R>#<n>", url: html_url}`. |
| `updateStatus` | `PATCH /repos/{owner}/{repo}/issues/{number}` | Body: `{state: "open"\|"closed"}`. Re-shape response to ABI full-story shape. |
| `listOpen` | `GET /repos/{owner}/{repo}/issues?state=open&per_page=N` | Filter out `pull_request` entries. Map to subset shape (`id, title, state, labels, url`) — drop body, parent_id per ABI. Resolve owner/repo from `team_value`/`project_value`. |
| `getStory` | `GET /repos/{owner}/{repo}/issues/{number}` | Returns full ABI story shape. `parent_id` resolved via `GET /repos/{O}/{R}/issues/{N}/parent` (Sub-Issues API), null on 404. |
| `addComment` | `POST /repos/{owner}/{repo}/issues/{number}/comments` | Body: `{body}`. Return `{comment_id: String(response.id)}`. |
| `linkStories` | `POST /repos/{O}/{R}/issues/{parent_number}/sub_issues` | Body: `{sub_issue_id: <integer issue id>}`. Requires resolving child string-id → integer issue id (`GET /issues/{n}` then `.id`). Return `{}`. |
| `setAssignee` | `PATCH /repos/{owner}/{repo}/issues/{number}` | Body: `{assignees: [login]}` (or `[]` to clear). Return `{}`. Alt: `POST /issues/{n}/assignees` for additive — but PATCH replaces, which matches ABI's set-not-add semantics. |

**Error → ABI code mapping:**
- 401 / 403 (no rate-limit headers) → `AUTH_FAILURE`
- 403 / 429 (rate-limit headers present) → `RATE_LIMIT` + `retry_after_ms` (see C4)
- 404 / 410 → `NOT_FOUND`
- 422 (validation, e.g., bad state) → `UNKNOWN_METHOD` (closest fit per ABI's 5-code closed enum; or surface as adapter crash) — **FRICTION CANDIDATE**
- Unknown method dispatched → `UNKNOWN_METHOD`
- `linkStories` invoked with `supports_parent_link: false` — N/A here; we declare true

---

## FINDINGS

1. **ABI is implementable on GitHub with no spec changes required.** All 7 methods map to documented REST endpoints. The `mixed` hierarchy + `supports_parent_link: true` combo is exactly what the ABI's GitHub example anticipates.

2. **The cleanest ID encoding is `<owner>/<repo>#<number>` strings**, because the fresh-per-call adapter has no session state to remember which repo a bare number refers to, and `team_value`/`project_value` are optional params.

3. **Auth: prefer `gh auth token` at process start, fall back to `GITHUB_TOKEN` env.** Both yield a bearer token used in raw REST calls. Avoid `gh issue` subcommands — they hide the rate-limit headers we depend on.

4. **Tests: real repo primary, mock fallback for CI.** Env-gated: `GITHUB_TEST_REPO` + `GITHUB_TOKEN` → real path; absent → mock (`nock` or `msw`). Same suite covers both.

5. **`pull_request` filter in `listOpen` is non-negotiable** — without it, every PR shows up as a story.

6. **One ABI gap likely needs a c-2 revision request:** **422 validation errors have no clean home in the 5-code closed enum.** Mapping to `UNKNOWN_METHOD` is a pitfall (ABI common pitfalls #6 says use it for "unknown errors"), but a `VALIDATION_ERROR` or "permanent client error" code would be cleaner. Surface in friction-notes and bring back to c-2 if Linear (c-4) hits the same issue.

---

## FRICTION NOTES (preview — full file lands at hive/adapters/github/friction-notes.md)

1. **String IDs vs integer issue numbers** (C1) — adapter wraps `<owner>/<repo>#<number>`. Resolved fine, but every method does a parse step. Cost: ~3 LOC per method.

2. **Sub-Issues API requires integer issue `id`, not `number`** (C3) — `linkStories(parent, child)` becomes 2 API calls (GET child → POST parent). Documented; not blocking.

3. **5-code closed error enum can't cleanly express 422 validation failures** (Finding 6) — currently mapping to `UNKNOWN_METHOD` per ABI Step 8 pitfall guidance. **Candidate c-2 revision request.**

4. **GitHub has no atomic create-with-parent** (R7) — `createStory(parent_id=X)` is a 2-call sequence; partial failure leaves a dangling issue. Documented behavior.

5. **`state` exposes only `open`/`closed`** — workflow states like `in_progress`, `in_review` from Linear-style trackers map to labels on GitHub. Adapter does NOT auto-translate. Documented in README.

6. **Issues and PRs share number space** — `listOpen` filters out `pull_request`. Performance cost: small (in-memory filter).

7. **Labels/assignees silently dropped without push access** (R2) — surfaces as silent data loss on token under-scoping. README spells out required scopes.

8. **Issue transfer breaks ID stability** (R4) — `<owner>/<repo>#<number>` becomes stale if issue is `gh issue transfer`-ed. Documented as known caveat.

---

## OPEN QUESTIONS (for team-lead, not blocking research)

- **Q1.** TypeScript or plain JS for `index.<ext>`? (Resolve from c-1 outputs before implementation.)
- **Q2.** ABI example says `project_field: "project"`. Should we honor that string verbatim (R8) even though "repo" is more accurate? Default: yes, follow the canonical example.
- **Q3.** Should validation-error mapping (Finding 6) trigger a c-2 revision now, or batch with c-4's findings before requesting? Default: batch — c-3 is one of two validators; second signal worth waiting for.

---

## NEXT STEPS (for the developer agent)

1. Confirm form factor from c-1 outputs → pick `.ts` vs `.js`.
2. Scaffold `hive/adapters/github/index.<ext>` from ABI's Node.js skeleton.
3. Implement `capabilities` first (static), then `getStory` (read-only, easy test), then write-path methods.
4. Wire integration test harness against `GITHUB_TEST_REPO` env var; mock fallback uses `nock`.
5. Run all 7 methods × 2 paths (happy + error). Each error path picks a distinct ABI code so the matrix isn't redundant.
6. Capture every spec ambiguity in `friction-notes.md` as you go — even if you resolve it locally — so c-4 (Linear) can compare.
