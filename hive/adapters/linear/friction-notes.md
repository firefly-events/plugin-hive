# Linear Adapter — Friction Notes vs ABI 1.0.0

Recorded per the c-4 validator charter so the c-5a wiring story and the c-2 spec
revision have explicit feedback to act on.

## 1. Rate-limit signal lives in the response body, not HTTP status

GitHub's adapter relied on `HTTP 429` plus headers — Linear ships the signal
inside the GraphQL envelope: `errors[*].extensions.code === "RATELIMITED"` on a
response that may be HTTP 200 or 400. The adapter introduces a dedicated
`mapGraphqlError(status, headers, errors)` helper (vs the GitHub adapter's
`mapHttpError`) and only reads `X-RateLimit-Requests-Reset` from headers; the
status field alone is not sufficient.

**Recommendation:** the spec already allows adapters latitude on detection.
Worth surfacing in the c-6 migration guide: GraphQL trackers belong in the same
ABI but error-detection plumbing differs.

## 2. `capabilities` is team-scoped — workflow states are dynamic

Linear's workflow states (`Backlog`, `Todo`, `In Progress`, `Done`, ...) are
defined per team and renameable. To return an accurate `supported_states` the
adapter needs `LINEAR_TEAM`. Without it, the adapter falls back to Linear's
default-template names. `supported_labels` is similarly dynamic.

**Recommendation:** consider an ABI v1.1 minor bump that lets `capabilities`
accept a `team_value` param so adapters can declare the actual list without
relying on out-of-band env config. Today's call site assumes capabilities is a
zero-arg method.

## 3. Name → UUID resolution adds round-trips

Linear's GraphQL mutations want UUIDs for `labelIds`, `stateId`, `parentId`,
and `assigneeId`, but the ABI carries human names (labels, states). Each
`createStory`/`updateStatus`/`linkStories` therefore does up to two extra
round-trips: team metadata fetch (cached) and identifier-to-UUID resolution
(one per ID). The metadata cache is module-scoped within a single subprocess,
which helps when the orchestrator pipelines multiple calls in one process but
adds no benefit across separate CLI invocations.

**Recommendation:** the c-5a dispatch module could optionally batch calls
within a single subprocess to amortize metadata fetches. Not an ABI change.

## 4. Identifier vs UUID asymmetry

Linear accepts the human identifier `TEAM-123` on read queries (`issue(id:
"ACME-42")`) but mutations like `issueCreate.parentId` insist on the internal
UUID. The adapter resolves transparently, but each parent-link operation pays a
GET-style query before the mutation. For `linkStories` the cost is two
resolutions in parallel (Promise.all), then one mutation — still strictly
better than GitHub's two-call sequence.

## 5. Auth header: raw vs Bearer

Linear personal API keys use the **raw** `Authorization: <key>` form. The
adapter ships without a `Bearer` prefix. `Bearer` is reserved for OAuth tokens
issued to third-party apps. Worth flagging in the c-6 doc consistency pass —
the GitHub adapter uses `Bearer` and the Linear adapter does not, both are
correct for their respective auth modes.

## 6. Single assignee, single project — alignment with ABI

Unlike GitHub's multi-assignee array, Linear stores a single assignee per
issue. `setAssignee` is a clean fit. Projects are similarly single-valued. No
friction here — recorded for the c-5a wiring guide as evidence the ABI's
single-id semantics align well with one major tracker.
