"""Pause handler — full implementation (hde-8).

`node_type: pause` nodes SUSPEND the run, persist a per-run signing
key (mode 0600), emit a signed resume token to telemetry, and wait
for an external sentinel at:

  `<runs_root>/<run_id>/pause/<node_id>.{approve,reject}`

The sentinel file body must contain the resume token; `signal.py`
verifies the token before honoring approve/reject (defeats sentinel
forgery and cross-run replay).

State transitions:
  * On suspend: telemetry emits `pause_suspended` with the token in
    the payload (the token is intended to be readable by the
    operator who will write the sentinel — it is bound to this
    specific (run_id, node_id) pair so logging it is acceptable).
  * On approve: telemetry emits `pause_resumed`; handler returns
    NodeOutput.
  * On reject: telemetry emits `pause_rejected`; handler raises
    `PauseRejectedError(reason)`. The walker maps that to
    `mark_failed`.
  * On timeout (user OR hard-ceiling): telemetry emits
    `pause_timeout`; handler raises `PauseTimeoutError`.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from hive.lib.dag_executor.pause import (
    SignalKind,
    generate,
    wait_for_signal,
)
from hive.lib.dag_executor.pause.errors import PauseRejectedError, PauseTimeoutError

from .agent import NodeOutput

if TYPE_CHECKING:
    from hive.lib.dag_executor.executor.telemetry import Telemetry


_DEFAULT_RUNS_ROOT = Path(".pHive") / "runs"


class PauseHandler:
    """Suspends the run; resumes (or fails) on external signal."""

    def __init__(
        self,
        runs_root: Path | None = None,
        telemetry: "Telemetry | None" = None,
        poll_interval: float = 5.0,
    ) -> None:
        self.runs_root = runs_root or _DEFAULT_RUNS_ROOT
        self.telemetry = telemetry
        self.poll_interval = poll_interval

    def handle(
        self,
        node: Any,
        inputs: dict[str, Any],
        run_id: str,
    ) -> NodeOutput:
        timeout_seconds = (
            int(node.timeout_ms / 1000) if getattr(node, "timeout_ms", None) else None
        )
        token = generate(run_id, node.id, self.runs_root)
        if self.telemetry is not None:
            self.telemetry.emit(
                "pause_suspended",
                node.id,
                {"token": token, "timeout_seconds": timeout_seconds},
            )

        try:
            result = wait_for_signal(
                run_id=run_id,
                node_id=node.id,
                runs_root=self.runs_root,
                timeout_seconds=timeout_seconds,
                poll_interval=self.poll_interval,
            )
        except PauseTimeoutError:
            if self.telemetry is not None:
                self.telemetry.emit(
                    "pause_timeout",
                    node.id,
                    {"timeout_seconds": timeout_seconds},
                )
            raise

        if result.kind == SignalKind.APPROVED:
            if self.telemetry is not None:
                self.telemetry.emit(
                    "pause_resumed",
                    node.id,
                    {"sentinel_path": str(result.sentinel_path)},
                )
            return NodeOutput(outputs={"paused": True, "approved": True}, meta={})

        # REJECTED
        if self.telemetry is not None:
            self.telemetry.emit(
                "pause_rejected",
                node.id,
                {
                    "sentinel_path": str(result.sentinel_path),
                    "reason": result.reason or "<no reason given>",
                },
            )
        raise PauseRejectedError(result.reason or "<no reason given>")
