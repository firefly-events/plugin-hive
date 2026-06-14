# Research Brief: Cross-Harness Local Agent Communication

**Date:** 2026-05-26
**Topic:** Letting agents running in different harnesses (Claude Code, Codex CLI, Gemini CLI, Aider, Pi, Cursor, Kimi, etc.) register and exchange live two-way messages on a single workstation, via OSS, local-first transports.
**Context:** plugin-hive has already adopted Multica as its `/execute` substrate (project memory: `multica_substrate_adoption`); brief is scoped to evaluate whether that adoption is the right answer to free-form agent-to-agent comms, or whether a complementary layer is needed.

---

## Summary

Only **two production options** answer the literal question today: (1) **Multica's daemon + WebSocket task stream** — already integrated with every harness the user named, but shaped as task/comment/metadata rather than free-form messaging; (2) **A2A v1 (Linux Foundation) on loopback** — neutral, framework-agnostic, JSON-RPC over HTTP/SSE, with optional WebSocket custom binding. The strongest stack for Hive is: keep Multica as the execution + registration substrate, layer A2A `Message`/`Part` envelopes on top of its existing WebSocket channel for free-form agent-to-agent payloads. Everything else (AGNTCY/SLIM, NATS, MCP-as-bus, Letta, LangGraph) is either too heavy, wrong-shape, or roadmap-only.

---

## Directed Source Findings

### `~/Code/spikes/multica` + `multica-ai/multica` README
- Multica daemon already auto-detects and registers installed CLIs: **Claude Code, Codex, GitHub Copilot CLI, OpenClaw, OpenCode, Hermes, Gemini, Pi, Cursor Agent, Kimi, Kiro CLI**. Cross-harness registration is solved by `multica daemon start`.
- Transport between daemon and clients is **REST + WebSocket** for real-time progress streaming.
- Message shape is **task-board semantic**: issues, threaded comments, assignments, metadata key/value, run-message stream. No documented free-form agent-to-agent channel; agents talk to each other by commenting on a shared issue or by being co-assigned to a squad.
- "Squads" add a stable routing layer (leader agent delegates to members) — closest thing to a peer-channel primitive.

### plugin-hive's existing Multica integration
- `/Users/don/Documents/plugin-hive/.pHive/episodes/wire-execute-multica-codex/*` — `/execute` already routes through Multica.
- Local Multica spike at `~/Code/spikes/multica` validated end-to-end on Podman (per `project_multica_substrate_adoption` memory).
- Adoption is execution-shaped, not comms-shaped — leaves room for an a2a layer on top.

---

## Web Research Findings

### Protocols / Substrates (May 2026 landscape)

| # | Substrate | Local-first? | Cross-harness fit | Headline tradeoff |
|---|---|---|---|---|
| 1 | **A2A v1.0 (Linux Foundation)** | Yes — bind 127.0.0.1 | Strong: every framework ships an adapter in 2026 | JSON-RPC over HTTP/SSE; WebSocket is a "custom binding". Request/response-shaped, signed Agent Cards for discovery |
| 2 | **AGNTCY (ACP + SLIM)** — Cisco/Linux Foundation | Yes via `agent-gateway` sidecar | Most a2a-native (pub/sub, groups, MLS-encrypted) | Heaviest stack; IETF-draft SLIM; needs sidecar; overkill for one workstation |
| 3 | **MCP as a bus** | Yes — already how harnesses talk to tools | Weak: strict client↔server, no peer notion | 2026 roadmap names a2a as goal but **not delivered**; a2a only works by treating one harness as "server" |
| 4 | **Multica** | Yes — daemon on localhost | **Already cross-harness for every named CLI** | Task-board semantics, not free-form messages |
| 5 | **Letta v1** | Yes — self-hosted on `:8283` | Agents live in Letta, not your harness | Cross-runtime only if every harness shells out to Letta REST |
| 6 | **LangGraph Platform / RemoteGraph** | Yes via `langgraph dev` | Agent must BE a LangGraph graph | Cross-language but not a meeting place for foreign harnesses; LangServe archived 2026-05-05 |
| 7 | **CrewAI / AutoGen GroupChat** | No native bus | Not harness-neutral | In-process Python; both now ship A2A adapters instead |
| 8 | **agent-protocol (AI Engineer Fdn)** | Yes (spec-only) | Effectively dormant 2026 | Superseded by A2A/MCP/AGNTCY under new AAIF |
| 9 | **NATS / Redis Streams** | Yes — purpose-built | Free-form peer pub/sub | No agent semantics, no card discovery, no auth — you build the protocol |

### Plumbing / Transport / Discovery patterns

| Pattern | Production? | Local-first fit | Notes |
|---|---|---|---|
| **Local WebSocket hub** on `ws://127.0.0.1` w/ named participants | Yes — Tabby, LM Studio, Open Interpreter House, AutoGen Studio, Continue.dev, OpenHands | Strong | Pair with `Origin` validation + per-session token in `Sec-WebSocket-Protocol` |
| **Unix domain socket / named pipe** | Yes — Docker, Podman, gh CLI, llama.cpp | Excellent for trust (OS perms = ACL) | No browser clients; Windows AF_UNIX uneven; pair with ws bridge |
| **mDNS / Bonjour discovery** | Almost theoretical for agents | Poor | Overkill on a single workstation; dangerous on shared LAN |
| **File-based runtime registry** (`~/.thing/runtimes.json`) | **Production-standard** — Multica, Docker, gh, Codex, Claude Code, Ollama, Continue | Excellent | Stale-entry risk; use atomic rename + fsevents/inotify push |
| **JSON-RPC over stdio / streamable-HTTP** | Yes — MCP de-facto standard | Strong | Same envelope reusable peer-to-peer |
| **Message envelopes** | **Converging on A2A `Message` + `Part[]`** | — | ACP folded into A2A under Linux Foundation May 2026; A2A `Part` model (text/file/data) is the convergence point |
| **Auth for localhost** | Underdone everywhere | Critical gap | "localhost = trusted" is **false**; token-in-handshake + Origin allowlist + UDS where possible |
| **Health / liveness** | Inconsistent | App concern | ws ping/pong 30s + 90s dead-peer timeout = industry default |

---

## Cross-Reference Analysis

| Dimension | Multica today | Web standard (A2A) | Gap / fit |
|---|---|---|---|
| Cross-harness registration | **Solved** — daemon auto-detects 11 named CLIs | Signed Agent Cards per agent | Multica gives you a fleet without writing 11 cards; A2A gives you a portable card if you leave Multica |
| Transport | REST + WebSocket on localhost | JSON-RPC over HTTP/SSE; ws is custom binding | Same shape; A2A envelope can ride Multica's existing ws channel |
| Message semantics | Task/issue/comment/metadata | Free-form `Message` w/ typed `Part[]` (text/file/data) | **This is the actual gap.** Multica frames everything as task-board ops; A2A frames everything as conversation turns |
| Discovery | File-based runtime registry written by daemon | Agent Card URL per agent | Multica's registry is the local-first answer; A2A cards are the wire-portable answer |
| Auth | Per-workspace token, daemon-managed | Spec-mandates `Origin` + 127.0.0.1 binding | Compatible — Multica daemon already does this |
| Peer-to-peer pub/sub | Squads (leader-delegates) | Not native; via streaming task updates | Neither gives you NATS-style fan-out; AGNTCY/SLIM would, at sidecar cost |

The directed picture and the web picture agree on one thing: **the registration and transport problem is already solved (file-registry + loopback ws), and the unsolved part is the message envelope**. A2A's `Message`/`Part` schema is the rallying point.

---

## Recommendation

**Primary: extend Multica with an A2A-shaped agent-to-agent channel.**

1. **Keep Multica as the substrate.** Registration of Claude/Codex/Gemini/Pi/Cursor/Aider/Hermes/Kimi/Kiro/Copilot is already shipping there and matches `/execute` integration in plugin-hive.
2. **Layer A2A `Message`/`Part` envelopes** on top of Multica's existing WebSocket channel as a new "a2a" message type, parallel to existing `task_update` / `comment` types. This buys cross-ecosystem portability — if you later replace Multica, the envelope and any code that produces/consumes it remain valid.
3. **Auth via the existing per-session token** in `Sec-WebSocket-Protocol`, bound 127.0.0.1 only, `Origin` allowlist. Multica's daemon already enforces this.
4. **Discovery stays file-based** in `~/.multica/state/runtimes.json` (Multica already writes this) plus an A2A Agent Card per agent generated on registration, so agents are addressable both ways.

**Fallback / future option: AGNTCY SLIM** if Hive ever needs true MLS-encrypted many-to-many pub/sub across machines. Heavy today, but it's the only spec that natively models peer groups.

**Explicitly skip:**
- **MCP as a bus** — roadmap-only for a2a in 2026; will conflate tool calls with peer chat.
- **NATS / Redis** — gain peer pub/sub, lose discovery, card, and auth story; rebuilds what A2A already provides.
- **agent-protocol, LangServe, CrewAI/AutoGen as substrate** — dormant, archived, or wrong shape.
- **mDNS discovery** — wrong problem on a single workstation.

**Risk:** Multica's task-board framing may resist a free-form peer channel; if so, fork point is to host a tiny A2A-only daemon next to Multica (file-registry + ws on a separate port) and let both run. Cost is one extra binding; gain is no Multica internals coupling.

---

---

## A2A Mechanical Detail — How Harness-Agents Plug In

Added 2026-05-26 after deep-dive on Claude Code / Codex CLI / Gemini CLI / Aider / Cursor specifically (agents that are NOT built on Google ADK / LangGraph / CrewAI / AutoGen).

### Server topology
Every A2A agent is an HTTP server exposing `.well-known/agent-card.json` plus JSON-RPC endpoints. Interactive REPL harnesses (Claude Code, Codex CLI, Aider, etc.) therefore need a **wrapper sidecar** — a long-running HTTP process that owns the CLI subprocess (or uses its SDK), translates inbound A2A requests into prompts, and streams CLI output back as A2A `TaskStatusUpdateEvent` / `TaskArtifactUpdateEvent`. Confirmed live in [ericabouaf/claude-a2a](https://github.com/ericabouaf/claude-a2a) — Node HTTP server on `:3008` spawning Claude Code SDK.

### AgentExecutor shim = ~50 lines, not 500
Python `a2a-sdk` requires two async methods: `execute(ctx: RequestContext, queue: EventQueue) -> None` and `cancel(...)`. Framework owns JSON-RPC parsing, SSE streaming, task lifecycle, concurrency. Executor enqueues terminal `TaskStatusUpdateEvent` (e.g. `TASK_STATE_COMPLETED`); for input-required interrupts, enqueue `TASK_STATE_INPUT_REQUIRED` and return — framework re-invokes `execute()` on resume. Cancel arrives as `asyncio.CancelledError` plus explicit `cancel()` call. [a2a-samples helloworld](https://github.com/a2aproject/a2a-samples) is ~30 lines.

### Existing harness wrappers (May 2026 inventory)

| Harness | A2A wrapper | Status |
|---|---|---|
| Claude Code | [ericabouaf/claude-a2a](https://github.com/ericabouaf/claude-a2a) (npm `claude-a2a`, TS) | Hobby, 5 commits, ~7 stars. Streaming + sessions + artifacts working. Auth/persistence/Docker on TODO |
| Codex CLI | none | Greenfield |
| Gemini CLI | none | Greenfield |
| Aider | none | Greenfield |
| Cursor | none | Greenfield |
| MCP→A2A bridge | [GongRzhe/A2A-MCP-Server](https://github.com/GongRzhe/A2A-MCP-Server) | Inverse direction — lets an LLM call A2A peers as MCP tools |

### Bidirectional / peer-push reality
**A2A v1 is client→server JSON-RPC. No native peer-push primitive.** Three escape hatches (spec §3.5):
1. **SSE streaming** on `POST /message:stream` — server pushes incremental events but only for the *active task*.
2. **Push notifications** — client registers a webhook via `CreateTaskPushNotificationConfig`; server POSTs `StreamResponse` to it. Still tied to an existing task.
3. **"Every agent is also a client"** — for unsolicited peer chat, agent A must hold agent B's URL and call B's `message:send`. This is the canonical pattern for true peer mesh.

No WebSocket binding in v1; §12 allows custom bindings.

### Streaming + interruption
v1 ships `CancelTask` (`POST /tasks/{id}:cancel`) and `tasks/resubscribe` (`POST /tasks/{id}:subscribe`, returns SSE). Cancel works mid-stream; subscribe lets a disconnected client rejoin an in-flight task's event stream. `SubscribeToTask` returns `UnsupportedOperationError` if task is already terminal.

### Agent Card (spec §4.4.1)
Required fields: `name`, `description`, `version`, `capabilities`, `defaultInputModes`, `defaultOutputModes`, `supportedInterfaces` (array of `{url, protocolBinding, protocolVersion}`). `skills` array declares discrete capabilities. Lives at `/.well-known/agent-card.json` (IANA-registered §14.3). **No standard registry** — discovery is well-known URL, third-party registries, or direct-URL config.

### Loopback auth
Spec offers `APIKeySecurityScheme`, `HTTPAuthSecurityScheme` (Bearer), `OAuth2`, `OpenIdConnect`, `MutualTLS`. For `127.0.0.1` peer trust: shared bearer token in `Authorization: Bearer <token>` minted by the daemon at startup. mTLS overkill on loopback; `securitySchemes` may be empty (spec marks optional) if trusting local socket boundary plus Origin/loopback bind check.

### SDK maturity (May 2026)
All five officially GA at 1.0: **Python** (`a2a-sdk`, 1.9k stars), **JS/TS** (`@a2a-js/sdk`, 547 stars), **Java**, **Go**, **.NET**. LF press confirms 150+ orgs in production; Azure AI Foundry and AWS Bedrock AgentCore have first-party A2A.

### MCP + A2A coexistence — explicit by design
Spec Appendix B: **MCP = agent→tool, A2A = agent↔agent**. Claude Code already speaks MCP outbound; it can simultaneously sit behind an A2A sidecar that exposes it as a peer. Dual role is the *documented* expected pattern, not a workaround.

### Hive/Multica integration shape
Three options weighed; **(a) is the recommendation**:
- **(a) Inside the Multica daemon — one A2A server per registered CLI.** Reuses daemon's CLI-lifecycle/auth/registration. Each registered CLI gets a stable Agent Card URL (e.g. `http://127.0.0.1:<daemon-port>/agents/<cli-name>/.well-known/agent-card.json`). Lowest overhead.
- **(b) Sidecar per CLI.** Duplicates lifecycle management already in daemon. Skip.
- **(c) Replace Multica's ws envelope with A2A on same port.** More disruptive than needed. Multica's internal ws and A2A endpoints can coexist on different paths of the same daemon port.

### Spike verdict
**A 1-day spike wrapping Claude Code as an A2A server is realistic.** `claude-a2a` proves the path in ~5 TS commits. Day-1 deliverable: AgentCard at `/.well-known/agent-card.json`, `execute()` that spawns `claude` via SDK + forwards stdout chunks as `TaskArtifactUpdateEvent`s, smoke test from `a2a-js` client. Day-2+ unknowns: cleanly mapping `cancel()` → Claude Code SIGINT, session/context_id persistence across calls, tool-permission UX. None block the proof.

### Revised recommendation (supersedes original)
Same shape, sharper edges:
1. Keep Multica as substrate + execution layer.
2. **Add A2A servers inside the Multica daemon** — one per registered CLI. Multica's existing daemon owns the right primitives (registration, lifecycle, auth-token mint, ws port).
3. For peer-push between two harness-agents, follow A2A's canonical "every agent is also a client" pattern — agent A's wrapper holds agent B's `http://127.0.0.1:.../agent-card.json` URL and calls `message:send` on B. Daemon can publish the registry of local Agent Card URLs.
4. MCP stays on each harness for tool calls; A2A is layered on top for peer chat. Spec Appendix B sanctions the dual role.

---

## Sources

1. `/Users/don/Documents/plugin-hive/hive.config.yaml` — hive's substrate config
2. `/Users/don/Documents/plugin-hive/.pHive/episodes/wire-execute-multica-codex/*` — existing Multica `/execute` integration
3. `/Users/don/.claude/projects/-Users-don-Documents-plugin-hive/memory/project_multica_substrate_adoption.md` — adoption status
4. https://github.com/multica-ai/multica — Multica repo
5. https://github.com/multica-ai/multica/blob/main/CLI_AND_DAEMON.md — daemon docs
6. https://a2a-protocol.org/latest/ — A2A protocol home
7. https://a2a-protocol.org/latest/specification/ — A2A v1.0 spec
8. https://a2a-protocol.org/latest/topics/custom-protocol-bindings/ — A2A WebSocket binding notes
9. https://www.linuxfoundation.org/press/linux-foundation-launches-the-agent2agent-protocol-project-to-enable-secure-intelligent-communication-between-ai-agents — LF stewardship
10. https://docs.agntcy.org/ — AGNTCY docs
11. https://docs.agntcy.org/messaging/slim-core/ — SLIM transport
12. https://datatracker.ietf.org/doc/draft-mpsb-agntcy-slim/ — SLIM IETF draft
13. https://github.com/agntcy/acp-spec — ACP spec repo (merged into A2A)
14. https://tedt.org/MCPs-2026-Roadmap/ — MCP 2026 roadmap (a2a goal)
15. https://chatforest.com/guides/mcp-real-time-streaming/ — MCP streamable HTTP
16. https://docs.letta.com/guides/agents/multi-agent/ — Letta multi-agent
17. https://github.com/letta-ai/letta — Letta repo
18. https://github.com/langchain-ai/langserve/discussions/790 — LangServe archived 2026-05
19. https://github.com/langchain-ai/langgraph — LangGraph repo
20. https://github.com/AI-Engineer-Foundation — agent-protocol (dormant 2026)
21. https://dev.to/young_gao/pubsub-messaging-patterns-redis-nats-and-when-to-use-what-2el2 — NATS vs Redis for agents
22. https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation — AAIF formation
