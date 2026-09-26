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


class FatalAgentHandlerError(AgentHandlerError):
    """A dispatch-time failure that must halt the graph unconditionally.

    Unlike a plain `AgentHandlerError`, the walker's optional-node recovery
    path (`node.optional=True` swallows `HandlerError` and continues) does
    NOT apply here — s4-null-spec-fail-loud-guard requires a missing
    story_spec to stop the graph even when the guarded node is optional, so
    a spec-less agent can never be fabricated by a downstream node.
    """


class ScriptHandlerError(HandlerError):
    """Script handler subprocess failed or exceeded its timeout."""


class ReconcileHandlerError(HandlerError):
    """Reconcile handler failed: non-ff merge, missing sha, or cli.mjs error."""


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


class LoopNodeInvariantError(ExecutorError):
    """A LOOP node reached the executor walker post-expander.

    LOOP is an authoring-only keyword consumed by the load-time expander.
    No LOOP node should ever reach the executor after the unroll pass.
    Re-plan the workflow through the loader to unroll the LOOP node before
    execution.
    """
