# Multica Claude provider — session lifecycle + API socket idle drop

## Pre-step
Source read: ~/Code/spikes/multica @ 2f1f90c11a2e244524c4e42eafb5a764dea6fcac
Files inspected (max 15): server/pkg/agent/claude.go; server/pkg/agent/agent.go; server/internal/daemon/config.go; server/internal/daemon/daemon.go; server/pkg/db/queries/agent.sql

## Repro
Evidence source: ~/.multica/daemon.log for hermes-integration-mvp h-04 attempt 1.

Task 6b08b856 started on Claude at 02:24:55 and emitted normal tool/message traffic. Key lines:
- 04:26:49.737 `DBG agent ... task=6b08b856 text="Now write the tests:"`
- 04:42:58.475 `DBG agent ... task=6b08b856 text="API Error: The socket connection was closed unexpectedly..."`
- 04:42:58.819 `INF claude finished ... status=failed duration=7m9.126s`
- 04:42:58.819 `INF agent finished ... task=6b08b856 status=failed duration=7m9s tools=48`
- 04:42:58.819 result detail preserves the same socket error plus unrelated SessionEnd `MODULE_NOT_FOUND` stderr noise.

The daemon log also shows the same socket-drop text on unrelated tasks 302e56c4, cae5cf26, and 7cca207c. The h-04 smoking gun is the 16-minute daemon-visible gap from the last agent text at 04:26:49 to the API socket error at 04:42:58.

## Root cause
Multica does not create or configure an Anthropic HTTP client for the Claude provider. `server/pkg/agent/claude.go:17-18` says the backend spawns Claude Code CLI with stream-json, and `claude.go:62-70` uses `exec.CommandContext`, cwd, and env. No `http.Client`, `Transport`, `IdleConnTimeout`, `KeepAlive`, or Anthropic SDK client was found in inspected Claude-provider code.

Keepalive mechanism: not found in inspected files. Any TCP/HTTP keepalive for Anthropic is inside the spawned `claude` CLI, not Multica-owned Go code.

Idle timeout: Multica-configurable task ceilings exist, but they are not Anthropic socket idle settings. Claude defaults to `MULTICA_AGENT_TIMEOUT` / `DefaultAgentTimeout = 2h` via `server/internal/daemon/config.go:21,240-246`; the daemon idle watchdog defaults to 30m and is separately configurable via `MULTICA_AGENT_IDLE_WATCHDOG` (`config.go:23-34,256-258`). The 16-minute socket error is therefore not explained by Multica's 2h task timeout or 30m watchdog. It is most consistent with Claude Code / Anthropic / network-side socket closure.

Retry-on-disconnect: absent for this failure in inspected files. The only immediate Claude retry path is resume-start fallback: if a resumed session fails before establishing a session, Multica retries fresh (`server/internal/daemon/daemon.go:2567-2574`). A mid-run socket error with a session id is reported as failed, not reconnected.

Connection pooling posture: no Multica-owned pool for Anthropic. Connection pooling is delegated to the Claude Code process. Multica drains stdout, captures stderr, and records final status (`server/pkg/agent/claude.go:143-190,213-230`).

## Suggested fix
Add a Claude-provider socket-disconnect policy at `server/pkg/agent/claude.go` plus daemon classification at `server/internal/daemon/daemon.go`.

Concrete behavior: detect exact Claude result text `API Error: The socket connection was closed unexpectedly`; classify it as `upstream_socket_closed`; fail the active attempt clearly; optionally allow a Multica-owned bounded reconnect rerun once with `--resume <session_id>` only when a session id was already emitted and no tool call is in flight. Expose the policy as config, e.g. `MULTICA_CLAUDE_SOCKET_RECONNECTS=0|1`, defaulting to 0 until proven safe.

Do not treat this as a generic agent error. The current `agent_error` classification hides that this is provider transport loss and makes unrelated stderr noise look causal.

## Recommended Multica-side change
Issue/PR text:

"Claude provider should classify and optionally reconnect Anthropic socket idle drops. Today Multica delegates Anthropic I/O to the spawned Claude Code CLI (`server/pkg/agent/claude.go`) and has no keepalive/idle-timeout knob. When Claude emits `API Error: The socket connection was closed unexpectedly`, Multica records a generic failed task even though the daemon task timeout and idle watchdog did not fire. Add detection for this exact error in the Claude backend result path, return/report failure_reason `upstream_socket_closed`, and expose a conservative `MULTICA_CLAUDE_SOCKET_RECONNECTS` knob. If enabled, retry once by launching Claude with `--resume <session_id>` after the socket-close failure; otherwise fail fast with a clear transport error. Acceptance: daemon logs distinguish Anthropic socket close from agent logic failure; existing resume-start fallback remains unchanged; default behavior does not silently replay work unless the operator opts in."

Open upstream question: Does Claude Code expose any supported env/flag for HTTP keepalive, idle timeout, fetch verbosity, or transport retry? If yes, Multica should pass it through as a named Claude provider setting instead of relying on opaque `custom_env` / `custom_args`.

## Workaround appendix (NOT recommended for this epic)
Retry-with-backoff in execute-mode-multica poll loop: not recommended for this epic — composable substrate posture per grill P1. Pro: may mask transient drops. Con: Hive would replay provider-owned transport failures and blur root cause.

Decompose epic into smaller stories: not recommended for this epic — composable substrate posture per grill P1. Pro: reduces long idle windows. Con: changes planning granularity to accommodate upstream socket behavior.

Keepalive-tickle from Hive side: not recommended for this epic — composable substrate posture per grill P1. Pro: could keep a session active. Con: invents fake work and depends on undocumented Claude behavior.

Switch long tasks to another provider: not recommended for this epic — composable substrate posture per grill P1. Pro: may avoid this Claude-specific path. Con: routes around the upstream lifecycle bug instead of making substrate failure explicit.

Hive fail-fast with clear error: not recommended as a workaround; this is the desired Hive posture for this epic — composable substrate posture per grill P1. Pro: preserves clean boundaries. Con: does not make Multica/Claude complete the dropped task.
