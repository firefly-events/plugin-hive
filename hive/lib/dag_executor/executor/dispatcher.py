"""Dispatcher — routes each Node to its node_type handler.

The handler dict is pluggable so tests can substitute a stub agent
handler without touching production code. The dispatcher does NOT
own per-node telemetry — that is the walker's responsibility (the
walker emits `node_started`/`node_completed` around the dispatch
call). The dispatcher just routes and propagates the result.
"""

from __future__ import annotations

from typing import Any, Callable, Mapping

from hive.lib.dag_executor.graph import NodeType

from .errors import DispatcherError
from .handlers import AgentHandler, GateHandler, NodeOutput, PauseHandler, ReconcileHandler, ScriptHandler


HandlerCallable = Callable[[Any, dict[str, Any], str], NodeOutput]


class Dispatcher:
    """Routes a Node to its handler by node_type.

    Default routing covers all four node_types defined in `NodeType`.
    Pass `handlers={NodeType.AGENT: my_stub_handler}` to override
    specific entries (e.g., for the spine parity test where the agent
    handler is configured with a stub spawn).
    """

    def __init__(
        self,
        handlers: Mapping[NodeType, HandlerCallable] | None = None,
    ) -> None:
        defaults: dict[NodeType, HandlerCallable] = {
            NodeType.SCRIPT: ScriptHandler().handle,
            NodeType.GATE: GateHandler().handle,
            NodeType.PAUSE: PauseHandler().handle,
            NodeType.RECONCILE: ReconcileHandler().handle,
        }
        if handlers:
            defaults.update(handlers)
        self._handlers = defaults

    def register(self, node_type: NodeType, handler: HandlerCallable) -> None:
        """Late-bind a handler. Used to inject AgentHandler with its
        spawn callable after construction."""
        self._handlers[node_type] = handler

    def dispatch(
        self,
        node: Any,
        inputs: dict[str, Any],
        run_id: str,
    ) -> NodeOutput:
        handler = self._handlers.get(node.node_type)
        if handler is None:
            raise DispatcherError(
                f"no handler registered for node_type {node.node_type!r} "
                f"(node {node.id!r})"
            )
        return handler(node, inputs, run_id)
