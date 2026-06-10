# Insights — mao-plan-research

## Skills attachment was historically broken; requires two-step bootstrap

Skills in agents.yaml are NOT sent in the agent POST/PUT body — the server ignores them there.
They are attached via a separate `PUT /api/agents/{id}/skills` call. Before commit 55b328e this
was never wired; all agents showed 0 skills. Always run `reconcileSkills` before `reconcileAgents`
or SKILL_NOT_FOUND aborts the whole reconcile before any agent is created/updated.

## mcp_config: null is NOT the same as mcp_config: {} — {} crashes claude

`{}` causes claude CLI to error with "mcpServers: expected record, received undefined". Use `null`
or omit entirely. This is documented in the schema but easy to get wrong when authoring YAML by hand.

## --strict-mcp-config is always injected by daemon, but --mcp-config only with non-null config

The daemon always passes `--strict-mcp-config` to claude. When `mcp_config: null`, no `--mcp-config`
flag is passed. The behavior of `--strict-mcp-config` without `--mcp-config` is undocumented in the
spike code — it likely loads from the claude CLI's default config (~/.claude/config.json MCP section),
but this is unverified. This is the key question for whether context-mode MCP tools are available in
headless agent sessions.

## Persona reaches claude via disk files (execenv), NOT --append-system-prompt

For the claude provider, `providerNeedsInlineSystemPrompt("claude") = false`. Agent instructions
(from persona_ref) are written to the task workdir via `execenv.InjectRuntimeConfig`. They are NOT
passed via `--append-system-prompt`. This means persona changes only take effect at next task claim,
and resumed sessions may use a stale persona if the session caches prior context.

## Agents inherit full host PATH — git, python3, bun, gh are available

`buildEnv` in the daemon starts from `os.Environ()` (minus CLAUDECODE* keys) and appends custom_env.
Agents running on the local daemon have the same tools as the host machine — no sandboxing. Work_dir
is under `/multica_workspaces/{ws-id}/{task-id}/workdir`.

## Token cache (Anthropic API) vs context-mode plugin are orthogonal concerns

`~/.multica/config.json` has no cache-related keys. Multica's "token cache" is Anthropic's API-level
prompt prefix caching (tracked as CacheReadTokens/CacheWriteTokens in daemon usage telemetry).
context-mode is a Claude Code plugin that prevents context-window flooding within a session. They
address different layers — API cost vs context management — and do not interact.

## Live stuck detection gap is real — no watchdog for in-progress single-agent tasks

Three mechanisms exist: (1) pollTaskUntilTerminal covers dispatch loops (30min timeout, auto-cancel);
(2) stale-parent sweep covers post-run missed self-flip; (3) squad-leader contract is behavioral.
None detect: agent claims task, task enters in_progress, agent crashes mid-run. The issue status
stays in_progress indefinitely unless a human notices or a new run is attempted. A Python watchdog
(matching the sweep script pattern) checking `task.updated_at` vs a threshold would close this gap.

## Some agents lack CLAUDE_PLUGIN_PATH in custom_env — may not load plugins

reviewer/peer-validator/tester/tpm/analyst have `custom_env: {CLAUDE_PLUGIN_PATH: "${HOME}/.claude/plugins"}`.
developer/researcher/architect/backend-developer/frontend-developer have `custom_env: {}`. Those
without the explicit override rely on the daemon's host environment having CLAUDE_PLUGIN_PATH set.
If not set, these agents may not load context-mode or other plugins. Reason for the split is
undocumented and may be an oversight.
