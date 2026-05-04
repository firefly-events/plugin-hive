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


class ToolGatingError(ExecutorError):
    """Base for tool-gating policy refusals."""


class PlatformIncompatibilityError(ToolGatingError):
    """Step requested a tool whose platform constraint is unmet.

    Raised when a workflow step references a macOS-only tool (codex,
    cmux) on a non-Darwin platform. No silent fallback — Risk #11
    mitigation per epic.yaml.
    """


class ToolNotEscalatableError(ToolGatingError):
    """Step tried to grant a tool not in the maintainer allow-list.

    The escalatable_tools.yaml allow-list is the second factor on top
    of the `tool_gating_overridden` audit event. High-blast tools
    (Bash, Write, Edit) require explicit allow-list entry; low-blast
    tools (Read, Grep, Glob) are always grantable. Locks the
    pure-override surface against silent privilege escalation.
    """


class BackendIsolationViolationError(ToolGatingError):
    """Step tried to grant a backend-bound tool to an isolated persona.

    Verifier personas (reviewer, peer-validator, security-reviewer)
    are pinned to Opus precisely so they cross-verify Codex output.
    A step-level `tools: [codex]` override on a verifier persona
    silently re-routes the verifier through the same backend it is
    meant to verify — this exception blocks that path.
    """
