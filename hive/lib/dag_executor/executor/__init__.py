"""Public surface for the DAG executor's runtime layer (L2).

The executor walks a Graph (produced by the hde-1 graph layer) in
topological order, dispatching each node to a handler keyed by
node_type. It carries the `run_id` primitive that downstream slices
(hde-5 run-state, hde-8 pause) inherit, and emits structured
per-node telemetry every step of the way.

Out of scope for hde-2 (deferred to later slices):
  * Predicate evaluation for `when:` / `skip_when:` (hde-3a)
  * Run-state persistence (hde-5)
  * Worktree isolation (hde-6)
  * Parallel fan-out + barrier joins (hde-4)
  * Full pause/approve semantics (hde-8)
"""

from .dispatcher import Dispatcher
from .errors import (
    AgentHandlerError,
    DispatcherError,
    ExecutorError,
    GateFailedError,
    HandlerError,
    ScriptHandlerError,
    TelemetryEmitError,
    TelemetryError,
    WalkerCycleError,
    WalkerOptionalStepFailure,
)
from .handlers import (
    AgentHandler,
    GateHandler,
    LocalAgentSpawn,
    NodeOutput,
    PauseHandler,
    ScriptHandler,
    StubAgentSpawn,
)
from .run_id import make_run_id, new_ulid
from .telemetry import (
    REQUIRED_EXECUTOR_EVENT_FIELDS,
    RESERVED_EVENT_TYPES,
    Telemetry,
)
from .tool_gating import compose_tool_policy
from .walker import Walker

__all__ = [
    "AgentHandler",
    "AgentHandlerError",
    "LocalAgentSpawn",
    "Dispatcher",
    "DispatcherError",
    "ExecutorError",
    "GateFailedError",
    "GateHandler",
    "HandlerError",
    "NodeOutput",
    "PauseHandler",
    "REQUIRED_EXECUTOR_EVENT_FIELDS",
    "RESERVED_EVENT_TYPES",
    "ScriptHandler",
    "ScriptHandlerError",
    "StubAgentSpawn",
    "Telemetry",
    "TelemetryEmitError",
    "TelemetryError",
    "Walker",
    "WalkerCycleError",
    "WalkerOptionalStepFailure",
    "compose_tool_policy",
    "make_run_id",
    "new_ulid",
]
