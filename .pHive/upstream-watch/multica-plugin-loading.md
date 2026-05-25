# Multica Claude provider — plugin loading mechanism

## Pre-step
Source read: ~/Code/spikes/multica @ 2f1f90c
Files inspected (max 15): server/pkg/agent/claude.go; server/pkg/agent/agent.go; server/internal/daemon/config.go; server/internal/daemon/daemon.go; server/internal/daemon/types.go; server/internal/daemon/execenv/context.go; server/internal/daemon/execenv/runtime_config.go; server/internal/daemon/local_skills.go

## Repro
hermes-integration-mvp #62 remained unverified/broken at runtime: plugin-hive source could exist in `workdir/plugin-hive/`, but `/hive:*` slash commands were not registered; h-01 had the clone, while h-02/h-03/h-04 often had bare workdirs, per `.pHive/epics/multica-integration-fixes/docs/research-brief.md`. Multica source confirms Claude launches the `claude` CLI directly in task cwd and only writes Multica skills to `{workDir}/.claude/skills`, not Claude Code plugin manifests: `server/pkg/agent/claude.go:62-70`, `server/internal/daemon/execenv/context.go:12-24,120-128`.

## Root cause
No dedicated Claude Code plugin loader was found. The gating mechanism is environment pass-through: `claudeBackend.Execute(ctx context.Context, prompt string, opts ExecOptions)` sets `cmd.Env = buildEnv(b.cfg.Env)`, and `buildEnv` merges `os.Environ()` plus daemon-provided env while filtering only `CLAUDECODE*` / `CLAUDE_CODE*`, not `CLAUDE_PLUGIN_PATH`: `server/pkg/agent/claude.go:62-70,508-530`. Per-agent `custom_env` is merged into that env unless blocklisted, and `CLAUDE_PLUGIN_PATH` is not blocklisted: `server/internal/daemon/daemon.go:2423-2435`, `server/internal/daemon/daemon.go:3253-3266`, `server/internal/daemon/types.go:85-95`.

## Suggested fix
Use a config-only fix first: extend `/hive:multica-init` to set the Claude agent's `custom_env.CLAUDE_PLUGIN_PATH` to the plugin-hive/Codex plugin install root visible to the Multica daemon user, then restart or re-run the agent session. Do not rely on `custom_args`; Claude args are for CLI flags and plugin path is controlled through env, while Multica's Claude args surface only appends `MULTICA_CLAUDE_ARGS` / `custom_args`: `server/internal/daemon/config.go:208-215`, `server/internal/daemon/daemon.go:2459-2464,3268-3279`, `server/pkg/agent/claude.go:423-459`.

## Recommended Multica-side change
Issue/PR text: "Document Claude Code plugin discovery for Multica Claude agents and add an explicit `claude_plugin_path` agent/runtime setting that maps to `CLAUDE_PLUGIN_PATH` in `custom_env`. Current code passes env through, but users must infer that from `server/pkg/agent/claude.go:508-530` and `server/internal/daemon/daemon.go:2423-2435`; there is no named plugin field, validation, or log line. Acceptance: a Claude agent configured with the setting launches with `CLAUDE_PLUGIN_PATH=<value>`, keeps existing `.claude/skills` behavior unchanged, and logs the plugin path key with value redacted."

## Plugin discovery posture (REQUIRED)
Actual behavior: Multica skips any explicit Claude Code plugin install/mount layer. It passes through `CLAUDE_PLUGIN_PATH` if present in the daemon process env or per-agent `custom_env`; it inherits the daemon process `HOME` because `os.Environ()` is merged, but users cannot override `HOME` through `custom_env`: `server/pkg/agent/claude.go:508-530`, `server/internal/daemon/daemon.go:3253-3266`. It mounts per-task Multica skills at `{workDir}/.claude/skills` and writes `CLAUDE.md`; it does not mount a per-agent plugin dir: `server/internal/daemon/execenv/context.go:12-24,120-128`, `server/internal/daemon/execenv/runtime_config.go:87-107,361-366`. Local skills listing reads `~/.claude/skills`, not `~/.claude/plugins`: `server/internal/daemon/local_skills.go:54-63`.

## mi-04 routing recommendation (REQUIRED)
(a) config-only fix — mi-04 should extend the `/hive:multica-init` agent configuration surface to write `custom_env.CLAUDE_PLUGIN_PATH` for the Claude agents. This is the only source-backed knob found within budget; Multica already passes that env through to Claude, while source patch work should be limited to upstream documentation/ergonomics unless a smoke test proves Claude Code ignores `CLAUDE_PLUGIN_PATH` in this launch mode.
