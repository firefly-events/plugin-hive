"""Typed exceptions for the executor layer.

Distinct from `hive.lib.dag_executor.graph.errors` so phase boundaries
stay clear: graph-layer errors (cycles, dangling refs) surface during
load/validate; executor-layer errors surface during walk/dispatch.
"""

from __future__ import annotations


class ExecutorError(Exception):
    """Base for every executor-layer failure."""


class WalkerCycleError(ExecutorError):
    """Topological sort detected a cycle the loader missed."""


class DispatcherError(ExecutorError):
    """No handler is registered for a node's node_type."""


class HandlerError(ExecutorError):
    """A node-type handler raised while executing a node."""


class AgentHandlerError(HandlerError):
    """The agent handler failed to invoke the agent-spawn chain."""


class ScriptHandlerError(HandlerError):
    """Script handler subprocess failed or exceeded its timeout."""


class GateFailedError(HandlerError):
    """A gate node's predicate did not hold."""


class WalkerOptionalStepFailure(ExecutorError):
    """Optional step raised a recoverable error; walker continues."""


class TelemetryError(ExecutorError):
    """Telemetry emit refused an event (missing fields, bad run_id)."""


class TelemetryEmitError(TelemetryError):
    """Backwards-compatible alias surfaced in the story spec."""
