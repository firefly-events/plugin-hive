# Research Brief — multica-agent-ops

Research date: 2026-06-10
Researcher: researcher agent (mao-plan-research)
Author: technical-writer agent (mao-plan-writer)

---

## 1. Summary

Investigated two user concerns: (1) how tools (CLIs, MCP servers) are provisioned to headless Multica agents, and (2) how stuck/hung agents are detected. Tool provisioning surfaces already exist per-agent in `.pHive/multica/agents.yaml` — the design question is convention and gap-closure, not building from scratch. A critical unknown is the behavior of `--strict-mcp-config` (always injected by the runtime) when `mcp_config` is null: if it suppresses all MCP servers, agents without explicit `mcp_config` have zero MCP access today, which makes context-mode unavailable in headless runs. Stuck detection has three existing legs (dispatch-loop timeout, stale-parent sweep, squad-leader contract); the gap is live detection of a running-but-stuck agent process.

---

## 2. Key Files & Surfaces

- `.pHive/multica/agents.yaml`:1-289 — canonical per-agent declarations: `persona_ref`, `skills`, `custom_env`, `custom_args`, `mcp_config` fields.
- `hive/lib/multica-bootstrap/index.mjs`:1-1012 — reconciler; `buildEnv`/`mergeEnv` shows host env inheritance; skill associations wired via PUT `/api/agents/{id}/skills`.
- `hive/lib/multica-agents-config/index.mjs`:1-151 — YAML parser + `resolveAgentInstructions`; reads `persona_ref` file from disk into `instructions` API field.
- `~/Code/spikes/multica/server/pkg/agent/claude.go`:1-649 — complete spawn model; `buildClaudeArgs`, `buildEnv`, `writeMcpConfigToTemp`; `--strict-mcp-config` always at line 429.
- `~/Code/spikes/multica/server/internal/daemon/daemon.go`:2231-2560 — `runTask`, `execenv.InjectRuntimeConfig` call; instructions reach agent via workdir disk files (not `--append-system-prompt`).
- `~/Code/spikes/multica/server/internal/handler/agent.go`:208-225 — `TaskAgentData` struct defining server-side agent payload fields.
- `hive/lib/multica-story-dispatch/episode-sync.mjs`:127-210 — `pollTaskUntilTerminal` (5s poll, 30min max, auto-cancel).
- `scripts/multica-sweep-stale-parents.py`:1-431 — post-run stale-parent backstop; stdlib Python; report-first, `--apply` opt-in.
- `hive/references/squad-leader-terminal-contract.md`:1-150 — behavioral contract for squad leader self-flip and BLOCKED path.
- `hive/references/multica-agents-schema.md`:1-101 — field docs; `mcp_config: null` skips `--mcp-config`; `{}` explicitly invalid.

---

## 3. Patterns & Conventions

**Tool provisioning (three surfaces):**
- `mcp_config` (per-agent YAML field): non-null value is written to a temp file, passed via `--mcp-config <path>`. Null skips the flag. `--mcp-config` is in `claudeBlockedArgs` — custom_args cannot override it. (`claude.go`:43-54, 413)
- `custom_env` (per-agent YAML field): merged over the full daemon host environment via `mergeEnv(os.Environ(), extra)`. Agents inherit host `PATH`, `HOME`, etc. `CLAUDECODE` and `CLAUDE_CODE_*` are stripped. Last-wins for duplicate keys. (`claude.go`:508-531)
- `custom_args` (per-agent YAML field): appended to claude CLI args after filtering against `claudeBlockedArgs` (blocks `-p`, `--output-format`, `--input-format`, `--permission-mode`, `--mcp-config`, `--effort`). (`claude.go`:408-421, 547-577)

**CLAUDE_PLUGIN_PATH split:** reviewer, peer-validator, tester, tpm agents explicitly set `CLAUDE_PLUGIN_PATH` in `custom_env`; developer, researcher, architect, backend-developer, frontend-developer do not — they rely on daemon host env. (`agents.yaml`:87-105)

**Persona delivery:** Bootstrap stores persona content as `instructions` API field. Daemon writes it to workdir disk files via `execenv.InjectRuntimeConfig` for the claude provider (`providerNeedsInlineSystemPrompt("claude") = false`). (`daemon.go`:2231-2238, `multica-agents-config/index.mjs`:131-143)

**Stuck detection — existing legs:**
1. `pollTaskUntilTerminal`: dispatch-loop timeout (30min, configurable). Auto-cancels. Does not cover sub-issues with no waiting dispatch-loop. (`episode-sync.mjs`:127-210)
2. Stale-parent sweep: post-run, classifies STALE when all children terminal + parent quiet >30min. Does not cover live hung tasks. (`multica-sweep-stale-parents.py`:1-431)
3. Squad-leader contract: behavioral self-flip + BLOCKED path in persona instructions. Sweep is backstop. Does not cover single-agent tasks or mid-run detection. (`squad-leader-terminal-contract.md`:1-100)

**Token cache vs context-mode:** No evidence of a Multica-side token cache that substitutes for context-mode. These are orthogonal: a prompt cache reduces cost of repeated context; context-mode prevents raw tool output from flooding the context window within a session. Cache does not stop a 56 KB command dump from consuming the window.

---

## 4. Constraints

- `mcp_config: {}` is invalid — must use `null` to skip. Using `{}` causes claude CLI to reject with "mcpServers: expected record, received undefined". (`multica-agents-schema.md`:29)
- `--mcp-config` is blocked in `custom_args` — only the per-agent `mcp_config` field is authoritative for MCP server provisioning. (`claude.go`:413)
- `--strict-mcp-config` is ALWAYS injected by the daemon regardless of per-agent config. (`claude.go`:429)
- `persona_ref` must be under repo root — absolute paths and `..` traversal are rejected. (`multica-agents-config/index.mjs`:145-148)
- Skill names in `agents.yaml` must exist in workspace before reconcile; `reconcileSkills` must run before `reconcileAgents` or ALL agent updates abort. (`multica-bootstrap/index.mjs`:308-319)
- New stuck-detection logic must be Python (canonical for scripts in this repo); `multica-story-dispatch` (Node) is a named bridge — no new logic there. (`CLAUDE.md` language policy)
- `--disallowedTools AskUserQuestion` is hardcoded. Agents in headless mode cannot ask the user for clarification. (`claude.go`:437)

---

## 5. Risks

- **[HIGH]** `mcp_config: null` + `--strict-mcp-config` behavior is undocumented. If `--strict-mcp-config` without `--mcp-config` means "no MCP at all", then all agents with `mcp_config: null` (developer, researcher, architect, backend-developer, frontend-developer) run with zero MCP servers today — no context-mode, no Frame0 MCP, nothing. This is a critical unknown; confirmed behavior changes the remediation scope significantly. (`claude.go`:429, `multica-agents-schema.md`:29)

- **[HIGH]** context-mode plugin loading in headless `claude -p` sessions is unverified. context-mode is installed at `~/.claude/plugins/data/context-mode-context-mode`. Whether claude CLI loads plugins in non-interactive headless mode is unknown. No completed-run episode messages were captured to verify. (`agents.yaml`:87-105)

- **[MEDIUM]** Live stuck detection gap. `pollTaskUntilTerminal` covers dispatch-side. Sweep covers post-run stale parents. Neither covers: `status=in_progress`, task running, last message >N minutes ago, agent process dead. Single-agent task crashes go undetected until a human notices or a dispatch-loop timeout fires (if one was waiting).

- **[MEDIUM]** `runtime.last_seen_at` freshness is unknown. No code found for how often the daemon updates this field. If heartbeat interval > 30min, it is an unreliable liveness signal for a watchdog. (`multica runtime list --output json`)

- **[LOW]** `CLAUDE_PLUGIN_PATH` inconsistency across agents. Agents without it in `custom_env` depend on daemon host env. If the daemon's environment lacks `CLAUDE_PLUGIN_PATH`, those agents load no plugins. No stated rationale for the split.

---

## 6. Open Questions

1. What is the exact behavior of `--strict-mcp-config` without `--mcp-config`? Does it block all MCP servers (null-config = no MCP) or fall back to `~/.claude` defaults? This determines whether context-mode is available in headless runs with `mcp_config: null`. **Requires a live probe.**

2. What does `execenv.InjectRuntimeConfig` write to the workdir? CLAUDE.md? AGENTS.md? Are skills written as individual files or bundled into the persona? The `execenv` package was not read.

3. How frequently does the daemon update `runtime.last_seen_at`? Per-heartbeat or per-task-event? This determines watchdog design options.

4. Where does `AgentContextForEnv` render skill content in the workdir? Individual `.claude/skills/{name}.md` files or bundled into the persona CLAUDE.md?

5. For live stuck watchdog: what API endpoint provides per-task message timestamps? `GET /api/tasks/{id}/messages` exists but the timestamp field name within each message object is unknown.

---

## 7. Inconsistency Risk Signals

*(Preserved verbatim — consumed by grill downstream)*

- **Signal: mcp_config: null vs --strict-mcp-config**
  | Where: `hive/references/multica-agents-schema.md`:29, `~/Code/spikes/multica/server/pkg/agent/claude.go`:429
  | Detail: Schema says null skips --mcp-config. Spike code always passes --strict-mcp-config. Behavior of --strict-mcp-config without --mcp-config is nowhere documented. This is a vocabulary gap between the schema doc (YAML perspective) and the runtime (CLI perspective).

- **Signal: custom_env for some agents but not others re CLAUDE_PLUGIN_PATH**
  | Where: `.pHive/multica/agents.yaml`:87-105 (reviewer, peer-validator, tester, tpm have CLAUDE_PLUGIN_PATH; developer, researcher, architect, backend-developer, frontend-developer do NOT)
  | Detail: Some agents explicitly set CLAUDE_PLUGIN_PATH in custom_env, others rely on daemon host env. If CLAUDE_PLUGIN_PATH is not in the daemon's environment, developer/researcher/architect will not load plugins. Inconsistency in provisioning strategy across agent types — no stated reason for why some get it explicitly and others don't.

- **Signal: instructions vs CLAUDE.md for persona delivery — undocumented split**
  | Where: `~/Code/spikes/multica/server/internal/daemon/daemon.go`:2231-2238, `hive/lib/multica-bootstrap/index.mjs`:131-143
  | Detail: Bootstrap stores persona as `instructions` field in API. Daemon writes them to disk files via execenv for claude provider. This two-stage path (API field → task claim → disk write) means persona changes are NOT live until next task claim; a cached session might run with stale persona if sessions are resumed. Risk of persona drift on resumed sessions.

- **Signal: --disallowedTools AskUserQuestion hardcoded**
  | Where: `~/Code/spikes/multica/server/pkg/agent/claude.go`:437
  | Detail: Agents in headless mode can never call AskUserQuestion. If any skill or persona references using AskUserQuestion for clarification, those instructions are dead code and may confuse the agent.
