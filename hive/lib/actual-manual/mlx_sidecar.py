"""
MLX Qwen sidecar lifecycle — start / readiness-probe / stop.

Story: am-5-mlx-qwen-sidecar (actual-manual-tier)

Starts `python -m mlx_lm.server` as a subprocess with the model pinned, exposes
a readiness probe (no curl/wget — stdlib urllib only), and provides a clean stop.

Config (env-over-config; all have documented defaults):
  MLX_MODEL  — model id     (default: mlx-community/Qwen2.5-VL-7B-Instruct-4bit)
  MLX_PORT   — server port  (default: 8089; 8080 is owned by Multica, not available)
  MLX_HOST   — server host  (default: 127.0.0.1)

Probe states (returned by probe() and wait_ready()):
  "not_ready" — process alive but model not yet serving (connection refused or non-200)
  "ready"     — /v1/models returned 200; model is loaded and serving
  "error"     — server process exited unexpectedly; inspect SidecarError.returncode

Public API:
  SidecarConfig                — dataclass; build via SidecarConfig.from_env()
  start(cfg)                   → SidecarHandle
  probe(handle)                → "not_ready" | "ready" | "error"
  wait_ready(handle, timeout)  → "ready" | "error"  (raises TimeoutError on timeout)
  stop(handle)                 → None

CLI:
  python3 mlx_sidecar.py start  [--port PORT] [--model MODEL] [--host HOST]
  python3 mlx_sidecar.py probe  <pid>
  python3 mlx_sidecar.py stop   <pid>
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Literal

# ─── Types ────────────────────────────────────────────────────────────────────

ProbeState = Literal["not_ready", "ready", "error"]


class SidecarError(RuntimeError):
    """Raised when the server process exits unexpectedly."""

    def __init__(self, returncode: int | None, msg: str) -> None:
        super().__init__(msg)
        self.returncode = returncode


# ─── Config ───────────────────────────────────────────────────────────────────

_DEFAULT_MODEL = "mlx-community/Qwen2.5-VL-7B-Instruct-4bit"
_DEFAULT_PORT = 8089  # 8080 is Multica — never use it
_DEFAULT_HOST = "127.0.0.1"


@dataclass
class SidecarConfig:
    model: str = _DEFAULT_MODEL
    port: int = _DEFAULT_PORT
    host: str = _DEFAULT_HOST

    @classmethod
    def from_env(cls) -> "SidecarConfig":
        """Build config from env vars; env-over-config."""
        return cls(
            model=os.environ.get("MLX_MODEL", _DEFAULT_MODEL),
            port=int(os.environ.get("MLX_PORT", str(_DEFAULT_PORT))),
            host=os.environ.get("MLX_HOST", _DEFAULT_HOST),
        )

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    @property
    def models_url(self) -> str:
        return f"{self.base_url}/v1/models"


# ─── Handle ───────────────────────────────────────────────────────────────────

@dataclass
class SidecarHandle:
    cfg: SidecarConfig
    proc: subprocess.Popen = field(repr=False)

    @property
    def pid(self) -> int:
        return self.proc.pid


# ─── Lifecycle ────────────────────────────────────────────────────────────────

def start(cfg: SidecarConfig | None = None) -> SidecarHandle:
    """
    Launch mlx_lm.server with the model pinned.

    Returns a SidecarHandle immediately — the server is NOT yet ready.
    Call wait_ready() or poll probe() to confirm readiness.

    Stdout/stderr from the server are discarded (DEVNULL) so model-load
    log chatter does not bleed into the caller.
    """
    if cfg is None:
        cfg = SidecarConfig.from_env()

    cmd = [
        sys.executable, "-m", "mlx_lm.server",
        "--model", cfg.model,
        "--port", str(cfg.port),
        "--host", cfg.host,
    ]

    # Silence server logs from the caller's perspective.
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return SidecarHandle(cfg=cfg, proc=proc)


def probe(handle: SidecarHandle) -> ProbeState:
    """
    Check sidecar readiness without curl/wget (stdlib urllib only).

    Returns:
        "ready"     — /v1/models returned HTTP 200
        "not_ready" — process alive but not yet serving (connection error or non-200)
        "error"     — process exited; inspect handle.proc.returncode
    """
    # Fast path: process already dead
    ret = handle.proc.poll()
    if ret is not None:
        return "error"

    try:
        with urllib.request.urlopen(handle.cfg.models_url, timeout=2) as resp:
            if resp.status == 200:
                return "ready"
            return "not_ready"
    except (urllib.error.URLError, OSError):
        # Connection refused, timeout, or socket error — not yet up
        return "not_ready"
    except Exception:
        return "not_ready"


def probe_ready(
    host: str = _DEFAULT_HOST,
    port: int = _DEFAULT_PORT,
    timeout: float = 2.0,
) -> dict:
    """
    Readiness check for an EXTERNALLY-managed sidecar, by host/port — no
    SidecarHandle/PID required.

    Used by /test actual Step 1 to confirm a separately-launched MLX server is
    serving before scenario execution. stdlib urllib only (no curl/wget).

    Returns a dict (not a bare ProbeState) so callers can surface a reason:
        {"state": "ready",     "detail": "..."} — /v1/models returned HTTP 200
        {"state": "not_ready", "detail": "..."} — reachable but non-200
        {"state": "error",     "detail": "..."} — connection refused / timeout / socket error
    """
    url = f"http://{host}:{port}/v1/models"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            if resp.status == 200:
                return {"state": "ready", "detail": f"{url} returned 200"}
            return {"state": "not_ready", "detail": f"{url} returned HTTP {resp.status}"}
    except urllib.error.HTTPError as e:
        return {"state": "not_ready", "detail": f"{url} returned HTTP {e.code}"}
    except (urllib.error.URLError, OSError) as e:
        return {"state": "error", "detail": f"cannot reach {url}: {e}"}


def wait_ready(
    handle: SidecarHandle,
    timeout: float = 120.0,
    interval: float = 1.0,
) -> ProbeState:
    """
    Block until the sidecar is ready, the process dies, or timeout elapses.

    Returns "ready" or "error". Raises TimeoutError on timeout (caller decides
    whether to stop() the process or retry).
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = probe(handle)
        if state in ("ready", "error"):
            return state
        time.sleep(interval)
    raise TimeoutError(
        f"MLX sidecar (pid={handle.pid}) not ready after {timeout:.0f}s"
    )


def stop(handle: SidecarHandle, grace: float = 5.0) -> None:
    """
    Shut down the sidecar cleanly and free the port.

    Sends SIGTERM, waits up to `grace` seconds, then SIGKILL if needed.
    """
    ret = handle.proc.poll()
    if ret is not None:
        return  # already dead

    os.killpg(os.getpgid(handle.proc.pid), signal.SIGTERM)
    try:
        handle.proc.wait(timeout=grace)
    except subprocess.TimeoutExpired:
        os.killpg(os.getpgid(handle.proc.pid), signal.SIGKILL)
        handle.proc.wait()


# ─── CLI ──────────────────────────────────────────────────────────────────────

def _cli() -> None:
    parser = argparse.ArgumentParser(
        prog="mlx_sidecar.py",
        description="MLX Qwen sidecar lifecycle — start / probe / stop",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_start = sub.add_parser("start", help="Start the MLX server")
    p_start.add_argument("--model", default=None, help=f"model id (default: {_DEFAULT_MODEL})")
    p_start.add_argument("--port", type=int, default=None, help=f"port (default: {_DEFAULT_PORT})")
    p_start.add_argument("--host", default=None, help=f"host (default: {_DEFAULT_HOST})")
    p_start.add_argument(
        "--wait", action="store_true", help="block until ready before printing PID"
    )
    p_start.add_argument("--timeout", type=float, default=120.0, help="readiness timeout (s)")

    p_probe = sub.add_parser("probe", help="Probe an already-running sidecar by PID")
    p_probe.add_argument("pid", type=int)
    p_probe.add_argument("--port", type=int, default=None)
    p_probe.add_argument("--host", default=None)

    p_stop = sub.add_parser("stop", help="Stop a running sidecar by PID")
    p_stop.add_argument("pid", type=int)
    p_stop.add_argument("--grace", type=float, default=5.0)

    args = parser.parse_args()

    if args.cmd == "start":
        cfg = SidecarConfig.from_env()
        if args.model:
            cfg.model = args.model
        if args.port:
            cfg.port = args.port
        if args.host:
            cfg.host = args.host

        handle = start(cfg)
        if args.wait:
            try:
                state = wait_ready(handle, timeout=args.timeout)
            except TimeoutError as e:
                # Kill the started-but-never-ready server so a wedged MLX
                # process is not orphaned on the port for the next run.
                stop(handle)
                print(json.dumps({"state": "timeout", "pid": handle.pid, "error": str(e), "stopped": True}))
                sys.exit(1)
            print(json.dumps({"state": state, "pid": handle.pid, "port": cfg.port}))
            if state != "ready":
                sys.exit(1)
        else:
            print(json.dumps({"state": "started", "pid": handle.pid, "port": cfg.port}))

    elif args.cmd == "probe":
        cfg = SidecarConfig.from_env()
        if args.port:
            cfg.port = args.port
        if args.host:
            cfg.host = args.host

        # Wrap an existing PID in a minimal handle (process already running)
        try:
            proc = subprocess.Popen.__new__(subprocess.Popen)
            proc._popen = None  # type: ignore[attr-defined]
        except Exception:
            pass
        # Simplest correct approach: open /proc/<pid> or use os.kill(pid, 0)
        class _FakeProc:
            def poll(self_inner):
                try:
                    os.kill(args.pid, 0)
                    return None  # alive
                except ProcessLookupError:
                    return -1
            pid = args.pid

        fake_handle = SidecarHandle(cfg=cfg, proc=_FakeProc())  # type: ignore[arg-type]
        state = probe(fake_handle)
        print(json.dumps({"state": state, "pid": args.pid}))
        sys.exit(0 if state == "ready" else 1)

    elif args.cmd == "stop":
        class _FakeProc2:
            def poll(self_inner):
                try:
                    os.kill(args.pid, 0)
                    return None
                except ProcessLookupError:
                    return -1

            def wait(self_inner, timeout=None):
                deadline = time.monotonic() + (timeout or 30)
                while time.monotonic() < deadline:
                    try:
                        os.kill(args.pid, 0)
                    except ProcessLookupError:
                        return
                    time.sleep(0.2)
                raise subprocess.TimeoutExpired([], timeout)

            pid = args.pid

        cfg = SidecarConfig.from_env()
        fake_handle = SidecarHandle(cfg=cfg, proc=_FakeProc2())  # type: ignore[arg-type]
        stop(fake_handle, grace=args.grace)
        print(json.dumps({"state": "stopped", "pid": args.pid}))


if __name__ == "__main__":
    _cli()
