# am-5 MLX Qwen sidecar — implementation insights

## Probe without curl/wget

Host policy blocks curl/wget. Use `urllib.request.urlopen` (stdlib) against the
OpenAI-compatible `/v1/models` endpoint. This endpoint returns 200 only after the
model weights are fully loaded — making it a genuine readiness signal, not just a
port-open check. Connection-refused and timeout both map to `not_ready` (not `error`).

## Three-state probe contract

`probe()` returns exactly three states:
- `"not_ready"` — process alive, model loading in progress
- `"ready"` — `/v1/models` → HTTP 200
- `"error"` — server process exited (check `handle.proc.returncode`)

Do not collapse `not_ready` and `error` into a single failure state; the caller
needs to distinguish "keep waiting" from "abort — the process died".

## Process group kill for clean port release

`mlx_lm.server` may spawn child processes (model-loader threads, etc.). Kill the
entire process group (`os.killpg`) rather than just the leader PID so the port is
freed completely. SIGTERM first, SIGKILL after `grace` seconds.

## Model log suppression

Route server stdout/stderr to `subprocess.DEVNULL` at start time. The model loader
emits ~30 lines of progress; dumping these into the caller's console (and into agent
context) is hostile. The probe state already encodes loading progress clearly enough.

## start_new_session=True

Pass `start_new_session=True` to `Popen` so the server gets its own process group
independent of the Python parent. This makes `os.killpg` safe and prevents the
server from receiving SIGINT when the parent's terminal session closes.

## Default port 8089

8080 is owned by Multica and must never be used. 8089 matches the spike convention
(Arm D). Document this constraint in `SidecarConfig`; don't hide it in a comment.

## mlx_lm.server invocation

Start via `sys.executable -m mlx_lm.server` (not a bare `mlx_lm.server` entrypoint)
to guarantee the same Python environment that hosts the caller. Relevant flags:
`--model`, `--port`, `--host`. No `--log-level` flag exists in the current mlx_lm
release; log suppression must come from DEVNULL redirection.
