# Research Brief — multica-hermes-chat-refine

**Goal:** Close the 6 known UX gaps in the Multica fork's Hermes tab chat so it behaves like the Hermes web UI's session view (discrete turns, context meter, model badge, sessions surfaced + named, faster, per-workspace channels).

All findings VERIFIED 2026-06-25 by SSH probe of Studio (`macstudio`, user `hive`).

---

## 1. The system (3 layers + hermes brain)

| Layer | Path (in `/Users/hive/Code/spikes/multica/`) | Role |
|-------|------|------|
| Web chat | `packages/hive/HermesChat.tsx` (588 ln) + `apps/web/app/[workspaceSlug]/(dashboard)/hive/hermes/page.tsx` | Threads, persisted msgs, realtime WS, bridge-health dot. Renders `{msg.Body}` **raw plaintext**. |
| Go server | `server/internal/hive/` (router.go, store.go, bridge_status.go) | `/api/plugins/hive/hermes-{threads,messages,bridge-status}`. Msg schema `{ID,ThreadID,AuthorID,Body,CreatedAt}` — **no model/usage fields**. |
| Bridge | `docs/hive-plugin/hermes_bridge.py` (638 ln) | Subscribes multica WS for ONE workspace. Per user-msg: get/create hermes session, post ONE placeholder, SSE-stream reply, PATCH that single msg repeatedly. |
| Hermes brain | `/Users/hive/Code/hermes-agent/gateway/platforms/api_server.py` (`:8642`) | SSE chat stream. **Already emits** `usage`, session `model`, `title`/`source`, `tool.started`/`tool.completed`/`reasoning.available`. |

Hermes `dashboard` (`:9119`) reads the **same session DB** as api_server `:8642`.

---

## 2. Key finding — the data already exists

The hermes api server SSE stream (`gateway/platforms/api_server.py`) already carries everything the user wants. The bridge simply does not consume it:

- Bridge `stream_hermes()` only reads `assistant.delta` / `assistant.completed` / `run.completed`.
- It **ignores** `tool.started`/`tool.completed`/`reasoning.available` (→ gap 1: separate messages).
- It **ignores** `usage` in the completion event (→ gap 2: context meter).
- It **ignores** session `model` (→ gap 3: model badge).
- Sessions ARE created in the hermes store (title `hive:<thread_id>`) so they already appear in `hermes dashboard` — just badly named (→ gap 4).

So gaps 1-4 are primarily a **bridge consumption + light schema/UI plumbing** problem, not a missing-capability problem.

---

## 3. Gap → root cause → layers touched

| # | Gap | Root cause | Layers |
|---|-----|-----------|--------|
| 1 | Output appends into one growing bubble; hard to follow | bridge collapses a whole turn into one repeatedly-PATCHed message | bridge (+ frontend already renders discrete msgs) |
| 2 | No context meter | `usage` never read; no server field; no UI | bridge + server + frontend |
| 3 | No model indication | session `model` never forwarded; no field; no UI | bridge + server + frontend |
| 4 | Sessions not surfaced / mis-named in hermes UI | session title = raw `hive:<uuid>`; no `source` tag | bridge (session create/title) |
| 5 | Bridge slow | sync `requests`, single-threaded WS handler, per-0.4s HTTP PATCH | bridge |
| 6 | Want channels per workspace | bridge serves single `HERMES_WORKSPACE_ID` | bridge (+ deploy/config) |

---

## 4. Constraints

- **Python** is canonical (bridge is Python ✓). Go server edits are a bridge-surface exception (the multica fork is Go/TS, not Hive's repo — this work lives in the **fork**, not plugin-hive).
- **This epic targets the Multica fork repo** (`/Users/hive/Code/spikes/multica/`), NOT plugin-hive. Story `target_codebase` = the fork.
- Bridge runs as a process on Studio; restart needed to apply changes.
- Frontend renders raw `Body` today — adding markdown is also a cheap parallel win (not in the 6 but adjacent).

---

## 5. Open technical questions for design

1. Gap 1 — "separate messages" granularity: one msg per assistant turn, or also per tool call (tool.started → its own collapsed "🔧 Read(...)" message)? Affects schema (need a `kind`/`role` field on message).
2. Gap 2 — context meter denominator: `usage.total_tokens` / model context length. api_server exposes `model_context_length`. Show `used / window` + %?
3. Gap 6 — one bridge process multiplexing N workspaces, or one process per workspace under a supervisor? Multiplex is less overhead; per-process is simpler isolation.
4. Where do model/usage live — per-message (last turn) or per-thread (running total)? Likely both: per-message usage delta, per-thread cumulative.

---

## 6. Validation note

Confidence: HIGH for the data path (read all 4 layers' relevant code directly). MEDIUM for api_server SSE exact field names of `usage` payload — confirmed `usage` is returned by `_run_agent` and attached to completion event; exact sub-keys (`total_tokens` etc.) to confirm at implementation time against a live stream. No context7/web needed — all internal source.
