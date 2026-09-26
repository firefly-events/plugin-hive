---
date: 2026-07-07
decision: Build the approval-actions engine in plugin-hive as a pure JS module with a SQLite-backed audit store, three evaluator modes, and a stable facade (ApprovalEngine) as the dashboard/MCP contract.
status: accepted
epic: DOS-218
---

## Context

DOS-217 (Approval Actions plugin) needs an engine that: (a) supports three distinct approval mechanisms,
(b) captures a durable, machine-readable audit record per decision, and (c) exposes a stable
read/write contract that both the Stage 2 dashboard micro-frontend and the Stage 3 MCP/web fallback
can consume without coupling to each other.

Key constraints:
- Build in an existing repo — plugin-hive already has `better-sqlite3`, `zod`, and `js-yaml`.
- The decision shape must mirror multica `packages/core/permissions/rules.ts` so approval records
  are structurally compatible with the workspace permission layer.
- Stage 1 ships the engine + contract; Stage 2/3 build on top without re-negotiating the interface.

## Decision

### Module layout (`hive/lib/approval/`)

```
types.mjs            — Decision, PendingApproval, AuditRecord, ModeConfig (shared types)
config-registry.mjs  — action-type → ModeConfig registry + shipped defaults
store.mjs            — ApprovalStore: SQLite-backed read/write for pending approvals + audit records
modes/
  human-gate.mjs     — single-human verdict evaluator
  agent-quorum.mjs   — N-agent vote with ratio pass-check
  multi-agent-vote.mjs — diverse-lens panel with hard-veto support
engine.mjs           — ApprovalEngine facade: request() → submit() lifecycle
```

### Decision shape

`{ allowed: boolean, reason: string, message: string }` — canonical field names from multica
`packages/core/permissions/types.ts`. The design shorthand `Decision{allow, reason, copy}` maps to
`allowed`, `reason`, `message` respectively.

### Three modes

| Mode | Evaluator | Pass rule |
|---|---|---|
| `human-gate` | `modes/human-gate.mjs` | single approve=true verdict |
| `agent-quorum` | `modes/agent-quorum.mjs` | `approveCount / quorumSize >= passThreshold` |
| `multi-agent-vote` | `modes/multi-agent-vote.mjs` | no hard-veto AND approveCount ≥ minApprove |

Ratio comparison (not ceil) is used for agent-quorum to avoid off-by-one edge cases where
`ceil(N × threshold)` effectively requires unanimity (e.g. `ceil(3 × 0.67) = 3`). Threshold 0.6
gives clean "2 of 3" majority semantics.

### Durable audit store

SQLite via `better-sqlite3` with WAL mode. Default path: `.pHive/approval-audit.db`.
Pass `:memory:` for ephemeral test databases. Two tables:
- `pending_approvals` — created on `engine.request()`; status flips to `resolved` on submit
- `audit_records` — written atomically with the status update in a single transaction

### Stable contract (Stage 2 / Stage 3 surface)

```js
engine.request(actionType, actionContext, requestedBy) → { pending, modeConfig } | { error: Decision }
engine.submit(approvalId, verdicts, timestamp)          → { auditRecord } | { error: Decision }
engine.getPending(approvalId)                           → PendingApproval | null
engine.listPending(filter?)                             → PendingApproval[]
engine.getAuditRecord(approvalId)                       → AuditRecord | null
engine.listAuditRecords(filter?)                        → AuditRecord[]
```

Error cases return `{ error: Decision }` (not thrown exceptions) so the dashboard and MCP surface
can route to different UX states using `error.reason` without parsing strings.

### Hardening (post-review, 2026-07-08)

Review of the initial cut surfaced four defects; all are fixed and regression-tested:

1. **Atomic resolution.** `resolveApproval()` now flips status with
   `UPDATE … WHERE id = ? AND status = 'pending'` inside the transaction and only writes the
   audit record when `.changes === 1`, returning `null` otherwise. Two consumers (dashboard vs
   MCP fallback) racing on one approval produce exactly one audit record; the loser's
   `engine.submit()` returns `{ error: already_resolved }`. `audit_records(approval_id)` also
   carries a `UNIQUE` index as a schema-level backstop (migration dedupes pre-existing rows).
2. **Verdict completeness is enforced fail-closed.** Absence-of-vote never equals
   absence-of-veto: `multi-agent-vote` requires exactly one verdict per configured panel lens
   (missing / unknown / duplicate ⇒ deny), and only `canHardVeto` lenses can hard-veto.
   `agent-quorum` requires exactly `quorumSize` distinct verdicts and rejects
   `quorumSize < 1` configs. The engine validates *before* evaluating and returns
   `{ error }` while leaving the approval pending (a malformed/partial submission must not
   consume the gate); the evaluators carry the same guards for direct callers.
3. **Shipped configs are deep-frozen.** `shippedConfigs()` returns frozen authoring examples;
   the live registry is seeded with clones, so mutating one can never reconfigure the other.
4. **Malformed verdicts return `{ error }`, never throw.** `submit()` validates verdict shape
   (boolean `approve`, non-empty identity) up front — the prior behavior leaked a raw
   `SqliteError` on a missing `approverIdentity`.

Minor: `listPending`/`listAuditRecords` order with a `rowid` tiebreaker for deterministic
same-timestamp ordering; a mode disabled *after* `request()` still resolves on `submit()` as a
denied `mode_disabled` audit record (fail-closed, intentional, commented in `engine.mjs`).

### Relationship to `~/Code/approval` (standalone plugin template)

DOS-220 produced a standalone, zero-dependency packaging of the same concepts at
`~/Code/approval` (github.com/mdostal/approval) with the design-shorthand field names
(`Decision{allow, reason, copy}`) and an in-memory/JSONL stub store. **This module
(`plugin-hive/hive/lib/approval/`) is the canonical Stage 1 engine and contract** — the Stage 2
dashboard (`server.mjs`) and Stage 3 MCP fallback consume it. The standalone repo is a
template/OSS packaging that must track this contract; its README documents the field mapping
(`allow`→`allowed`, `copy`→`message`) and the same fail-closed panel-completeness rules were
ported to it.

## Consequences

**Enables:**
- Stage 2 (dashboard micro-frontend): mounts on `engine.listPending()` for the pending queue;
  submits human verdicts via `engine.submit()` with a human-gate verdict shape.
- Stage 3 (MCP/web fallback): same engine surface; MCP tool wraps `request()` and `submit()`.
- `repo-creation` config ships immediately as the first real approval gate; a 4-lens vote panel
  with `duplication-scout` carrying a hard veto.

**Costs:**
- SQLite on disk means the store is node-process-local. A future multi-process or distributed
  deployment would need to swap `store.mjs` for a shared backend (Postgres, etc.) — the
  `ApprovalEngine` facade isolates that swap to one file.
- Mode evaluators are pure synchronous functions; actual agent dispatching (quorum, vote) is
  the caller's responsibility. Stage 1 defines the shape; the dispatch harness is Stage 2/3 work.

**Rollback path:**
- All changes are additive files under `hive/lib/approval/`. No existing code is modified.
  Reverting is a directory delete; no migration needed.

### Stage 3 — MCP + web fallback (DOS-221)

Added on top of the unchanged engine/store contract; no changes to `hive/lib/approval/{engine,
store,config-registry,types,modes}.mjs`.

- **`mcp-server.mjs`** — newline-delimited JSON-RPC 2.0 over stdio (the framing used by
  `hive/lib/multica-story-dispatch/mcp-tools.mjs`, not the older Content-Length framing in
  `openai-image-mcp-server.js`). Five tools: `list_pending_approvals`, `get_pending_approval`,
  `submit_verdict`, `list_decision_records`, `get_decision_record`. `submit_verdict` accepts either
  `verdict` (human-gate) or `verdicts` (agent-quorum / multi-agent-vote) and calls `engine.submit()`
  directly — the same completeness/atomicity guarantees from the Hardening section apply
  cross-process between this server, `server.mjs`, and the Multica dashboard. Registered in
  `.mcp.json` as `approval-actions`.
- **`web/`** — a plain HTML + vanilla-JS dashboard (no build step, no framework) served by
  `server.mjs` at `/`. Talks to the existing `/api/approvals/*` JSON API plus a new
  `POST /api/approvals/submit-verdicts` endpoint (the array-verdict counterpart to the existing
  single-verdict `/api/approvals/submit`, needed for agent-quorum / multi-agent-vote approvals from
  a platform with no dashboard micro-frontend).
- **`RULESET.md` + `inject-ruleset.mjs`** — the Dostal ruleset (gated actions must go through this
  engine; MCP registry is discovery only, not policy; no pure-chat secret-entry path) is injected
  into a target project's `AGENTS.md` / `CLAUDE.md` between idempotent markers. Applied to this repo
  itself as the first consumer.
- **`~/.multica/plugins/approval/plugin.json`** — registers the plugin per the v1 manifest schema
  (`type: core`, `engine.kind: mcp`, `ui.mount: link`) documented in
  `~/Code/dostal-swarm/docs/plugin-framework.md`.

Explicit non-goal carried over from the design doc: no tool or endpoint here accepts, stores, or
requests a raw secret/credential — this surface only ever reads/writes approval decisions.

## References

- Design doc: `~/Code/dostal-swarm/docs/approval-plugin.md`
- Decision type source: `~/Code/multica/packages/core/permissions/types.ts`
- Parent epic: DOS-217 (Approval Actions plugin)
- This engine: DOS-218 (Stage 1 — engine + contract)
- MCP + web fallback: DOS-221 (Stage 3)
