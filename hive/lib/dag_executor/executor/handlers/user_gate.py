"""User-gate handler — conditional auto-pass or human halt/resume.

`node_type: user_gate` evaluates a per-node predicate (`auto_pass_when`)
against the materialised output graph and branches:

  * **Predicate True** → proceed (no human halt, no sentinel written).
    Behaves identically to the existing `output-validation` gate path.
  * **Predicate False / absent** → suspend exactly like hde-8 PAUSE:
    record pause, save run state, emit a signed resume token, write
    sentinel dirs at `<runs_root>/<run_id>/pause/<node_id>.{approve,reject}`,
    and wait via `signal.wait_for_signal()`.
  * **`.approve` sentinel** → resume via `Walker.replay()` from the
    `run_state_path` checkpoint.
  * **`.reject` sentinel** → **abort the run** (terminal failure, NOT retry).
    Revise-on-reject is explicitly out of scope and deferred to the t-005
    converge-loop epic.

Actor contract (MUST be observed):
  The `.approve` / `.reject` sentinels MUST be written by a **human reviewer**.
  CI automation, agent loops, or automated pipelines MUST NOT write these
  sentinels. This constraint is enforced by ops practice and documentation,
  not by code — there is no technical mechanism to distinguish a human from
  an automated actor at the filesystem level. The handler docstring exists
  to make the contract explicit to anyone operating the executor.

Absent-dotpath fail direction:
  If a dotpath referenced in `auto_pass_when` is absent (upstream produced
  no output for that name), the predicate evaluates to False — the gate
  HALTS, never auto-passes. This is the fail-closed behavior: a missing
  signal is treated as insufficient confidence, not as a clean pass.

Grammar:
  `auto_pass_when` uses the EXISTING frozen predicate grammar unchanged.
  No new constructs, no function calls, no null-coalescing. Any evaluator
  behavior change is a hard stop and must be escalated as an epic-scope
  grammar change.
"""

from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

from hive.lib.dag_executor.pause import (
    SignalKind,
    generate,
    wait_for_signal,
)
from hive.lib.dag_executor.pause.errors import PauseRejectedError, PauseTimeoutError
from hive.lib.dag_executor.routing import Skipped, evaluate as eval_predicate, parse as parse_predicate
from hive.lib.metrics.core import append_event

from .agent import NodeOutput

if TYPE_CHECKING:
    from hive.lib.dag_executor.executor.telemetry import Telemetry

OUTPUT_GRAPH_INPUT = "__output_graph"


def _metrics_opt_in() -> bool:
    """Same `metrics.enabled` opt-in gate documented in `hive.config.yaml`.

    Precedence mirrors `hive.lib.config.resolve_state_dir`: `CONFIG_FILE`
    env, else `HIVE_ROOT/hive.config.yaml`, else `cwd/hive.config.yaml`.
    Defaults to disabled (no config, unreadable config, or `metrics.enabled`
    absent/false) so a missing config never turns emits on by accident.
    """
    from hive.lib.config import read_config_file

    config_path = os.environ.get("CONFIG_FILE")
    if not config_path:
        hive_root = os.environ.get("HIVE_ROOT")
        config_path = (
            os.path.join(hive_root, "hive.config.yaml") if hive_root else "hive.config.yaml"
        )
    config = read_config_file(config_path)
    metrics_cfg = config.get("metrics")
    return isinstance(metrics_cfg, dict) and metrics_cfg.get("enabled") is True


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _record_gate_opened(run_id: str, node_id: str, runs_root: Any) -> float | None:
    """Persist (once) the wall-clock gate-open time beside the pause sentinel.

    `_halt` re-runs on crash-restart replay (`Walker.replay()`); if timing
    used only `time.monotonic()` within the process, a replay that finds
    the pause already resolved would compute `elapsed_ms ~= 0`, losing the
    real human-wait duration. Persisting `time.time()` alongside the
    sentinel dir on first open lets a later process recover it.

    Returns the wall-clock open time, or None if persistence failed or the
    marker predates this file (legacy pause dir) — the caller then falls
    back to per-process monotonic timing.
    """
    path = Path(runs_root) / run_id / "pause" / f"{node_id}.opened_at"
    try:
        if path.exists():
            return float(path.read_text(encoding="utf-8").strip())
        path.parent.mkdir(parents=True, exist_ok=True)
        now = time.time()
        path.write_text(str(now), encoding="utf-8")
        return now
    except (OSError, ValueError):
        return None


def _emit_human_gate_ms(
    node: Any,
    inputs: dict[str, Any],
    run_id: str,
    decision: str,
    elapsed_ms: int,
) -> None:
    """Emit one `human_gate_ms` event; no-op when the metrics opt-in is off."""
    if not _metrics_opt_in():
        return

    dimensions = {"node_id": node.id, "decision": decision, "run_id": run_id}
    event: dict[str, Any] = {
        "event_id": f"evt_human_gate_{uuid.uuid4().hex[:12]}",
        "timestamp": _now_iso(),
        "run_id": run_id,
        "metric_type": "human_gate_ms",
        "value": elapsed_ms,
        "unit": "ms",
        "dimensions": dimensions,
        "source": "user-gate-handler",
    }
    story_id = inputs.get("story_id")
    if isinstance(story_id, str) and story_id:
        event["story_id"] = story_id
    else:
        event["proposal_id"] = f"runtime:{node.id}"

    append_event(event, run_id)


class UserGateHandler:
    """Evaluate auto_pass_when; proceed or halt for human review.

    Uses the existing routing predicate grammar unchanged. When the
    predicate is false, absent, invalid, or references missing output,
    this handler halts for a human reviewer; CI/automation must not
    write the approve/reject sentinels.
    """

    def __init__(
        self,
        runs_root: Any = None,
        telemetry: "Telemetry | None" = None,
        poll_interval: float = 5.0,
    ) -> None:
        from hive.lib.dag_executor.run_state.store import default_runs_root
        from pathlib import Path

        self.runs_root = Path(runs_root) if runs_root is not None else default_runs_root()
        self.telemetry = telemetry
        self.poll_interval = poll_interval

    def handle(
        self,
        node: Any,
        inputs: dict[str, Any],
        run_id: str,
    ) -> NodeOutput:
        auto_pass_when = getattr(node, "auto_pass_when", None)

        # No auto_pass_when → always-halt semantics (design gate pattern).
        if not auto_pass_when or not str(auto_pass_when).strip():
            return self._halt(node, inputs, run_id, reason="always-halt-no-predicate")

        predicate = str(auto_pass_when).strip()
        output_graph = inputs.get(OUTPUT_GRAPH_INPUT, {})
        ast = parse_predicate(predicate)
        predicate_passed = False if isinstance(ast, Skipped) else eval_predicate(ast, output_graph)
        if self.telemetry is not None:
            payload: dict[str, Any] = {
                "expr": predicate,
                "result": bool(predicate_passed),
            }
            if isinstance(ast, Skipped):
                payload["fail_closed"] = True
                payload["reason"] = ast.reason
            self.telemetry.emit("predicate_evaluated", node.id, payload)

        # If the predicate passed → proceed, no human halt.
        if predicate_passed:
            if self.telemetry is not None:
                self.telemetry.emit(
                    "gate_checked",
                    node.id,
                    {"auto_pass_when": predicate},
                )
            return NodeOutput(
                outputs={"user_gate": "passed", "auto_pass_when": predicate},
                meta={"predicate": predicate},
            )

        # Predicate failed (False, invalid, or absent dotpath) → halt for human.
        return self._halt(node, inputs, run_id, reason=f"predicate-false:{predicate}")

    def _halt(
        self,
        node: Any,
        inputs: dict[str, Any],
        run_id: str,
        reason: str,
    ) -> NodeOutput:
        """Invoke the PauseHandler halt path: suspend, wait for sentinel."""
        timeout_seconds = (
            int(node.timeout_ms / 1000) if getattr(node, "timeout_ms", None) else None
        )
        gate_opened_at = time.monotonic()
        gate_opened_wall = _record_gate_opened(run_id, node.id, self.runs_root)
        token = generate(run_id, node.id, self.runs_root)
        if self.telemetry is not None:
            self.telemetry.emit(
                "pause_suspended",
                node.id,
                # Do not emit `token` — it is the signed resume credential that
                # wait_for_signal() trusts as approval proof. Logging it would let
                # anyone with telemetry + pause-dir access forge .approve/.reject.
                {"timeout_seconds": timeout_seconds, "reason": reason},
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

        gate_closed_at = time.monotonic()
        if gate_opened_wall is not None:
            elapsed_ms = int((time.time() - gate_opened_wall) * 1000)
        else:
            elapsed_ms = int((gate_closed_at - gate_opened_at) * 1000)

        if result.kind == SignalKind.APPROVED:
            if self.telemetry is not None:
                self.telemetry.emit(
                    "pause_resumed",
                    node.id,
                    {"sentinel_path": str(result.sentinel_path)},
                )
            # A metrics emit failure must never turn an already-approved gate
            # into a run failure.
            try:
                _emit_human_gate_ms(node, inputs, run_id, "approve", elapsed_ms)
            except Exception:
                pass
            return NodeOutput(
                outputs={"user_gate": "approved", "resumed": True},
                meta={"reason": reason},
            )

        # REJECTED — terminal failure. No retry, no loop.
        if self.telemetry is not None:
            self.telemetry.emit(
                "pause_rejected",
                node.id,
                {
                    "sentinel_path": str(result.sentinel_path),
                    "reason": result.reason or "<no reason given>",
                },
            )
        # A metrics emit failure must not shadow the real PauseRejectedError.
        try:
            _emit_human_gate_ms(node, inputs, run_id, "reject", elapsed_ms)
        except Exception:
            pass
        raise PauseRejectedError(result.reason or "<no reason given>")
