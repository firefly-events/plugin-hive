# Research Findings — multica-agent-ops

Research date: 2026-06-10
Researcher: researcher agent (mao-plan-research)

---

## FINDINGS

### FILES_EXAMINED

- `.pHive/multica/agents.yaml`:1-289 — canonical agent declarations; all active agents, their persona_ref, skills, custom_env, custom_args, mcp_config fields
- `hive/lib/multica-agents-config/index.mjs`:1-151 — custom YAML parser + `resolveAgentInstructions` (reads persona_ref file from disk)
- `hive/lib/multica-bootstrap/index.mjs`:1-1012 — reconciler: `reconcileAgentsWithDeps` builds API payload, calls PUT /api/agents/{id}/skills for skills; `buildEnv`/`mergeEnv` show host env inheritance
- `hive/lib/multica-story-dispatch/index.mjs`:1-250 — `serializeStoryBrief` builds the task description injected into the issue; `resolveAgentUuidByName` for dispatch
- `hive/lib/multica-story-dispatch/episode-sync.mjs`:1-378 — `pollTaskUntilTerminal` (5s interval, 30min max, auto-cancel on timeout); `writeMulticaRunEpisode` writes episode marker
- `scripts/multica-sweep-stale-parents.py`:1-431 — stale-parent sweep; classifies STALE/BLOCKED/ACTIVE based on child terminal status + 30min quiet threshold; report-only by default, --apply flips
- `hive/references/squad-leader-terminal-contract.md`:1-150 — behavioral contract for leader self-flip + BLOCKED path
- `hive/references/multica-agents-schema.md`:1-101 — field docs; notes `mcp_config: null` skips --mcp-config; `{}` explicitly rejected by claude CLI
- `~/Code/spikes/multica/server/pkg/agent/claude.go`:1-649 — claude backend spawn; `buildClaudeArgs`, `buildEnv`, `writeMcpConfigToTemp`, `claudeBlockedArgs`, `--strict-mcp-config` always present
- `~/Code/spikes/multica/server/pkg/agent/agent.go`:1-60 — `ExecOptions` struct definition (SystemPrompt, CustomArgs, McpConfig, ThinkingLevel)
- `~/Code/spikes/multica/server/internal/daemon/daemon.go`:2231-2560 — `providerNeedsInlineSystemPrompt`, `runTask`, `execenv.InjectRuntimeConfig` call; ExecOptions construction
- `~/Code/spikes/multica/server/internal/handler/agent.go`:208-225 — `TaskAgentData` struct (Instructions, Skills, CustomEnv, CustomArgs, McpConfig)
- `~/.multica/config.json` — keys: `['server_url', 'app_url', 'workspace_id', 'token']`
- `~/.claude/plugins/data/` — installed plugins: caveman, context-mode, context7, firebase, hive-inline, plugin-hive, swift-lsp, kotlin-lsp

---

### PATTERNS_OBSERVED

**TOPIC A — Tool Provisioning**

- Pattern: Two-phase agent provisioning | File: `hive/lib/multica-bootstrap/index.mjs`:275-407 | Detail: Agent body (POST/PUT /api/agents) carries instructions, custom_env, custom_args, mcp_config, model. Skills are a SEPARATE association managed via PUT /api/agents/{id}/skills — the agent body explicitly ignores the skills field (comment at line 134: "NOTE: `skills` is intentionally NOT in the agent body"). Bootstrap commit 55b328e wired this.

- Pattern: persona_ref → instructions injection path | File: `hive/lib/multica-agents-config/index.mjs`:130-151, `hive/lib/multica-bootstrap/index.mjs`:371 | Detail: `resolveAgentInstructions(agent, repoRoot)` reads the file at `persona_ref` (repo-relative path, sandbox-checked against repoRoot). The content becomes the `instructions` field in the API payload.

- Pattern: Instructions → CLAUDE.md via execenv | File: `~/Code/spikes/multica/server/internal/daemon/daemon.go`:2356 | Detail: `execenv.InjectRuntimeConfig(env.WorkDir, provider, taskCtx)` writes runtime config files into the task workdir. For claude provider, `providerNeedsInlineSystemPrompt("claude") = false` — instructions are NOT passed via `--append-system-prompt`; they come from disk files written to workdir. `taskCtx.AgentInstructions` and `taskCtx.AgentSkills` populate these files.

- Pattern: skills content injection via taskCtx | File: `~/Code/spikes/multica/server/internal/daemon/daemon.go`:2265-2283 | Detail: `AgentSkills = convertSkillsForEnv(skills)` where skills come from `task.Agent.Skills`. These are embedded in the workdir runtime config by `execenv.InjectRuntimeConfig`. Skills are attached server-side as associations; the daemon fetches them when claiming the task.

- Pattern: mcp_config = temp file + --mcp-config flag | File: `~/Code/spikes/multica/server/pkg/agent/claude.go`:43-54 | Detail: Non-nil `mcp_config` is written to a temp file (`multica-mcp-*.json`), then `--mcp-config <path>` is appended to claude args. `--strict-mcp-config` is ALWAYS in the base args (line 429). `--mcp-config` is in `claudeBlockedArgs` — custom_args cannot set it.

- Pattern: custom_env merged with host env | File: `~/Code/spikes/multica/server/pkg/agent/claude.go`:508-531 | Detail: `buildEnv(extra)` calls `mergeEnv(os.Environ(), extra)`. Base is ALL of the daemon's host environment except `CLAUDECODE` and `CLAUDE_CODE_*` keys. custom_env values are appended after base (last-wins in PATH lookup). Agents inherit host PATH, HOME, etc.

- Pattern: custom_args filtered against blocked set | File: `~/Code/spikes/multica/server/pkg/agent/claude.go`:408-421, 547-577 | Detail: `claudeBlockedArgs` prevents custom_args from overriding protocol-critical flags: `-p`, `--output-format`, `--input-format`, `--permission-mode`, `--mcp-config`, `--effort`. daemon-wide `ExtraArgs` go before per-agent `CustomArgs`.

**TOPIC B — Stuck Detection**

- Pattern: pollTaskUntilTerminal — dispatch-loop timeout | File: `hive/lib/multica-story-dispatch/episode-sync.mjs`:127-210 | Detail: Polls `/api/issues/{id}/active-task` + `/api/issues/{id}/task-runs` every 5s. Terminal set: `{completed, failed, cancelled}`. Max wall clock 30min (configurable). Auto-cancels via POST `/api/issues/{id}/tasks/{id}/cancel` on timeout. Handles up to 3 consecutive HTTP failures before surfacing as error. Does NOT cover: sub-issue stuck without an active dispatch-loop waiting on it.

- Pattern: stale-parent sweep — post-run backstop | File: `scripts/multica-sweep-stale-parents.py`:1-431 | Detail: Stdlib-only Python. Lists all `in_progress` issues assigned to squad/agent via `multica issue list --status in_progress`. Classifies STALE when: all children terminal + parent.updated_at > 30min ago + no BLOCKED comment. `--apply` flips to done. Report-first by default. Does NOT cover: live hung tasks (agent still running but making no progress).

- Pattern: squad-leader self-flip contract | File: `hive/references/squad-leader-terminal-contract.md`:1-100 | Detail: Behavioral contract in squad.instructions. Leader must: check children terminal → post summary → flip own status to done. BLOCKED path: post BLOCKED comment, leave in_progress. Enforced by sweep as backstop. Does NOT cover: non-leader agents (single-agent tasks) or detection during a run.

---

### CONSTRAINTS

- Constraint: `{}` is invalid for mcp_config | Source: `hive/references/multica-agents-schema.md`:29 | Impact: Must use `null` (not `{}`) to skip --mcp-config. Using `{}` would cause claude CLI to reject with "mcpServers: expected record, received undefined".

- Constraint: Skills must be declared as string names, resolved at bootstrap time | Source: `hive/lib/multica-bootstrap/index.mjs`:308-319 | Impact: All skill names in agents.yaml must exist in workspace before reconcile runs, or SKILL_NOT_FOUND aborts ALL agent updates. reconcileSkills must run before reconcileAgents.

- Constraint: `--mcp-config` blocked in custom_args | Source: `~/Code/spikes/multica/server/pkg/agent/claude.go`:413 | Impact: Cannot override mcp_config via custom_args. Only per-agent `mcp_config` field in agents.yaml/API is authoritative.

- Constraint: persona_ref must be under repo root | Source: `hive/lib/multica-agents-config/index.mjs`:145-148 | Impact: Absolute paths or `..` traversal rejected with error. All persona files must be inside the repo.

- Constraint: Instructions → disk files (not --append-system-prompt) for claude | Source: `~/Code/spikes/multica/server/internal/daemon/daemon.go`:2231-2238 | Impact: For claude provider, persona content reaches the agent via workdir files (CLAUDE.md). Changes to persona_ref are reflected at next bootstrap reconcile, NOT at task claim time for cached agents.

- Constraint: `multica-story-dispatch` (Node) is a named bridge — no new logic here | Source: `CLAUDE.md` language policy | Impact: New watchdog or polling logic for stuck detection must be Python (canonical) per charter.

---

### RISKS

- Severity: high | Risk: mcp_config: null + --strict-mcp-config interaction is undocumented | Evidence: `--strict-mcp-config` always injected (claude.go:429). Schema doc says null skips --mcp-config. Behavior when --strict-mcp-config present but no --mcp-config passed is NOT documented in the spike code or schema. If --strict-mcp-config without --mcp-config means "no MCP at all", then agents with mcp_config: null would lose ALL MCP servers (including context-mode). If it means "use defaults", they'd inherit ~/.claude MCP config. This is a critical unknown for context-mode availability.

- Severity: high | Risk: context-mode plugin loading in headless claude sessions is unverified | Evidence: context-mode installed at `~/.claude/plugins/data/context-mode-context-mode`. Daemon doesn't set CLAUDE_PLUGIN_PATH explicitly for developer/researcher/architect (custom_env: {}). Plugin loading in headless `claude -p` sessions depends on whether the daemon's environment carries CLAUDE_PLUGIN_PATH and whether claude CLI loads plugins in non-interactive mode. No episode evidence found (episode messages files were empty/not captured for completed runs).

- Severity: medium | Risk: Live stuck detection gap — no watchdog for in-progress single-agent tasks | Evidence: `pollTaskUntilTerminal` covers dispatch-loop side. Sweep covers post-run stale parents. Neither covers: issue status=in_progress, task status=running, last message timestamp >N minutes ago, agent process dead. This gap means agent crashes or infinite loops in single-agent tasks are only detected if a human notices or the 30min dispatch-loop timeout fires (if one was waiting).

- Severity: medium | Risk: Runtime `last_seen_at` freshness is unknown | Evidence: `multica runtime list --output json` returns `last_seen_at` field. No code found for how often the daemon updates this field or what "seen" means (heartbeat vs last task completion). If heartbeat interval > 30min, last_seen_at is an unreliable liveness signal.

- Severity: low | Risk: `custom_env` precedence when CLAUDE_PLUGIN_PATH set both in host env and custom_env | Evidence: `mergeEnv` appends base env then custom_env — if CLAUDE_PLUGIN_PATH is in both, it appears twice. Last occurrence wins in most env lookups, so custom_env overrides. But for agents with custom_env: {}, they rely entirely on daemon host env, which may or may not carry CLAUDE_PLUGIN_PATH.

---

### UTILITIES_AVAILABLE

- Utility: `pollTaskUntilTerminal` | File: `hive/lib/multica-story-dispatch/episode-sync.mjs`:127 | Relevance: Reusable for any dispatch-and-wait flow. Accepts configurable maxWallClockMs, pollIntervalMs, onStateTransition callback.

- Utility: `multica issue list --status in_progress --output json` | File: `scripts/multica-sweep-stale-parents.py`:219-236 | Relevance: Used by sweep script to enumerate candidate parents. Same pattern usable by live watchdog.

- Utility: `multica runtime list --output json` | CLI | Relevance: Returns `{id, status, last_seen_at, provider, ...}` — runtime-level liveness signal. Key field: `last_seen_at`.

- Utility: `multica agent list --output json` | CLI | Relevance: Returns `{id, name, status, updated_at, ...}` — agent-level status.

- Utility: `multica agent tasks <agent-id> --output json` | CLI | Relevance: Lists tasks for a specific agent; useful for checking if a specific agent has a stuck in-progress task.

---

### EXTERNAL_REFERENCES

- Source: `~/Code/spikes/multica/CLAUDE.md` | Relevance: Multica platform architecture (Go backend + Next.js + Electron, Chi router, sqlc, gorilla/websocket). Confirms agents as first-class citizens. | Key takeaway: This is the platform source; API shapes documented here are authoritative.

- Source: `~/Code/spikes/multica/server/pkg/agent/claude.go` | Relevance: Complete spawn model for claude runtime including all CLI flags, env handling, MCP config flow. | Key takeaway: `--strict-mcp-config` always present; `--permission-mode bypassPermissions` always present; AskUserQuestion disallowed.

- Source: commit 55b328e (feat(multica): attach agent skills by name + export doc-type skills) | Relevance: Skills attachment was never wired before this commit. | Key takeaway: Prior to this commit, agents had 0 skills even if declared in agents.yaml. Now correctly wired via /api/agents/{id}/skills.

---

### UNANSWERED_QUESTIONS

- Q1: What is the exact behavior of `--strict-mcp-config` without `--mcp-config`? Does it block all MCP servers (null-config) or fall back to ~/.claude defaults? This directly determines whether context-mode is available in headless runs with mcp_config: null.

- Q2: What does `execenv.InjectRuntimeConfig` write exactly? Specifically: does it write a CLAUDE.md, an AGENTS.md, or something else? And does it write skill content to files or just metadata? The execenv package code was not read (not in spike or plugin-hive repo under hive/).

- Q3: How frequently does the daemon update `runtime.last_seen_at`? Is it a heartbeat or per-task event? This determines whether it's a reliable liveness signal for a watchdog.

- Q4: Where does `AgentContextForEnv` render skill content in the workdir? Are skills written as individual files (e.g. `.claude/skills/{name}.md`) or bundled into the persona CLAUDE.md?

- Q5: For the live stuck watchdog (B2), what API endpoint provides per-task message timestamps? `GET /api/tasks/{id}/messages` returns messages but the timestamp field name within each message object is unknown (not read).

---

### INCONSISTENCY_RISK_SIGNALS

- Signal: mcp_config: null vs --strict-mcp-config
  | Where: `hive/references/multica-agents-schema.md`:29, `~/Code/spikes/multica/server/pkg/agent/claude.go`:429
  | Detail: Schema says null skips --mcp-config. Spike code always passes --strict-mcp-config. Behavior of --strict-mcp-config without --mcp-config is nowhere documented. This is a vocabulary gap between the schema doc (YAML perspective) and the runtime (CLI perspective).

- Signal: custom_env for some agents but not others re CLAUDE_PLUGIN_PATH
  | Where: `.pHive/multica/agents.yaml`:87-105 (reviewer, peer-validator, tester, tpm have CLAUDE_PLUGIN_PATH; developer, researcher, architect, backend-developer, frontend-developer do NOT)
  | Detail: Some agents explicitly set CLAUDE_PLUGIN_PATH in custom_env, others rely on daemon host env. If CLAUDE_PLUGIN_PATH is not in the daemon's environment, developer/researcher/architect will not load plugins. Inconsistency in provisioning strategy across agent types — no stated reason for why some get it explicitly and others don't.

- Signal: instructions vs CLAUDE.md for persona delivery — undocumented split
  | Where: `~/Code/spikes/multica/server/internal/daemon/daemon.go`:2231-2238, `hive/lib/multica-bootstrap/index.mjs`:131-143
  | Detail: Bootstrap stores persona as `instructions` field in API. Daemon writes them to disk files via execenv for claude provider. This two-stage path (API field → task claim → disk write) means persona changes are NOT live until next task claim; a cached session might run with stale persona if sessions are resumed. Risk of persona drift on resumed sessions.

- Signal: `--disallowedTools AskUserQuestion` hardcoded
  | Where: `~/Code/spikes/multica/server/pkg/agent/claude.go`:437
  | Detail: Agents in headless mode can never call AskUserQuestion. This is intentional (comment cites GitHub #2588), but if any skill or persona references using AskUserQuestion for clarification, those instructions are dead code and may confuse the agent.

---

### VALIDATION NOTE

  Checked: Claude Code SDK/CLI (--strict-mcp-config, --mcp-config, --permission-mode flags); Multica Go server API (agent endpoints, runtime spawn); multica-bootstrap (Node reconciler)
  Source: codebase-only (spike source + plugin-hive repo) | web escalation: not triggered
  Confidence: high for A1/A2/A3 provisioning path; medium for A4 context-mode headless availability (--strict-mcp-config behavior unverified); high for B1/B2/B3 stuck detection machinery
  Findings: No version constraint issues. Key gotcha: `{}` invalid for mcp_config; `--strict-mcp-config` always present and may suppress MCP when mcp_config is null — needs live test to confirm behavior.
