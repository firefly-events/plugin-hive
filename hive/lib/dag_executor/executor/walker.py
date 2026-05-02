"""Walker — Kahn's topological sort + sequential dispatch.

Per hde-2 design locks:
  * Sequential execution only. Parallel fan-out is hde-4.
  * Predicate evaluation for `when:` is hde-3a — the walker recognises
    `skip_when` as a presence flag and emits `node_skipped` if set,
    but does NOT evaluate the predicate text yet.
  * Per-step `optional: true` + a recoverable handler error → log
    + continue. Per-input `optional` is honored when resolving inputs
    (a missing/skipped upstream becomes `None`).
  * Every dispatch is bracketed by `node_started`/`node_completed`
    (or `node_failed`) telemetry. Every event carries the run_id.
"""

from __future__ import annotations

from collections import defaultdict, deque
from typing import Any

from hive.lib.dag_executor.graph import Graph, InputBinding, Node

from .dispatcher import Dispatcher
from .errors import (
    HandlerError,
    WalkerCycleError,
    WalkerOptionalStepFailure,
)
from .handlers import NodeOutput
from .telemetry import Telemetry


def _topological_order(graph: Graph) -> list[str]:
    """Kahn's algorithm over Node.depends_on.

    Returns node ids in a topological order. Raises WalkerCycleError
    if the graph contains a cycle the loader/validator missed.
    Tie-breaks on lexicographic node id for deterministic ordering
    so the spine parity diff stays byte-stable across runs.
    """
    in_degree: dict[str, int] = {nid: 0 for nid in graph.nodes}
    successors: dict[str, list[str]] = defaultdict(list)
    for node_id, node in graph.nodes.items():
        for predecessor in node.depends_on:
            in_degree[node_id] = in_degree.get(node_id, 0) + 1
            successors[predecessor].append(node_id)

    ready = deque(sorted(nid for nid, deg in in_degree.items() if deg == 0))
    order: list[str] = []
    while ready:
        nid = ready.popleft()
        order.append(nid)
        for successor in sorted(successors[nid]):
            in_degree[successor] -= 1
            if in_degree[successor] == 0:
                ready.append(successor)

    if len(order) != len(graph.nodes):
        unresolved = sorted(set(graph.nodes) - set(order))
        raise WalkerCycleError(
            f"cycle detected; unresolved nodes: {unresolved}"
        )
    return order


def _resolve_inputs(
    node: Node,
    materialised: dict[str, NodeOutput],
    context: dict[str, Any],
) -> dict[str, Any]:
    """Materialise node inputs from upstream outputs and the run context."""
    resolved: dict[str, Any] = {}
    for binding in node.inputs:
        resolved[binding.name] = _resolve_one(binding, materialised, context)
    return resolved


def _resolve_one(
    binding: InputBinding,
    materialised: dict[str, NodeOutput],
    context: dict[str, Any],
) -> Any:
    if binding.source == "literal":
        return binding.value
    if binding.source == "context":
        if binding.context_key is None:
            return None
        return context.get(binding.context_key)
    if binding.source == "step_output":
        upstream = materialised.get(binding.step_id) if binding.step_id else None
        if upstream is None:
            if binding.optional:
                return None
            raise HandlerError(
                f"input {binding.name!r} requires step_output from {binding.step_id!r} "
                f"but the upstream produced no output"
            )
        if binding.output_name is None:
            return upstream.outputs
        return upstream.outputs.get(binding.output_name)
    return None


class Walker:
    """Walks a Graph and dispatches each node sequentially."""

    def walk(
        self,
        graph: Graph,
        dispatcher: Dispatcher,
        run_id: str,
        telemetry: Telemetry,
        context: dict[str, Any] | None = None,
    ) -> dict[str, NodeOutput]:
        ctx = context or {}
        order = _topological_order(graph)
        materialised: dict[str, NodeOutput] = {}
        skipped: set[str] = set()

        for node_id in order:
            node = graph.nodes[node_id]

            # `skip_when` predicate evaluation is hde-3a; for now treat
            # the field's mere presence as a skip signal so the spine
            # workflow's structural events stay aligned with the
            # orchestrator-narrated path.
            if node.skip_when:
                telemetry.emit(
                    "node_skipped",
                    node.id,
                    {"reason": "skip_when present (hde-3a evaluation pending)"},
                )
                skipped.add(node_id)
                continue

            inputs = _resolve_inputs(node, materialised, ctx)

            telemetry.emit("node_started", node.id, {})
            try:
                output = dispatcher.dispatch(node, inputs, run_id)
            except HandlerError as exc:
                if node.optional:
                    telemetry.emit(
                        "node_failed",
                        node.id,
                        {"optional": True, "error": str(exc)},
                    )
                    materialised[node_id] = NodeOutput(
                        outputs={}, meta={"optional_failure": str(exc)}
                    )
                    continue
                telemetry.emit(
                    "node_failed",
                    node.id,
                    {"optional": False, "error": str(exc)},
                )
                raise
            except Exception as exc:
                telemetry.emit(
                    "node_failed",
                    node.id,
                    {"optional": bool(node.optional), "error": str(exc)},
                )
                if node.optional:
                    raise WalkerOptionalStepFailure(
                        f"optional node {node.id!r} raised non-handler exception: {exc}"
                    ) from exc
                raise

            materialised[node_id] = output
            telemetry.emit(
                "node_completed",
                node.id,
                {"outputs": list(output.outputs.keys())},
            )

        return materialised
