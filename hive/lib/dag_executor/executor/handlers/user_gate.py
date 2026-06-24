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

from typing import TYPE_CHECKING, Any

from hive.lib.dag_executor.pause import (
    SignalKind,
    generate,
    wait_for_signal,
)
from hive.lib.dag_executor.pause.errors import PauseRejectedError, PauseTimeoutError
from hive.lib.dag_executor.routing import Skipped, evaluate as eval_predicate, parse as parse_predicate

from .agent import NodeOutput

if TYPE_CHECKING:
    from hive.lib.dag_executor.executor.telemetry import Telemetry

OUTPUT_GRAPH_INPUT = "__output_graph"


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

        if result.kind == SignalKind.APPROVED:
            if self.telemetry is not None:
                self.telemetry.emit(
                    "pause_resumed",
                    node.id,
                    {"sentinel_path": str(result.sentinel_path)},
                )
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
        raise PauseRejectedError(result.reason or "<no reason given>")
