"""Per-node-type handlers.

The dispatcher routes each Node to one of these by `node_type`. Handlers
return a `NodeOutput` (a thin dict-of-named-outputs wrapper) and may
raise from the typed exception tree in `executor.errors`.
"""

from .agent import AgentHandler, NodeOutput, StubAgentSpawn
from .gate import GateHandler
from .pause import PauseHandler
from .script import ScriptHandler

__all__ = [
    "AgentHandler",
    "GateHandler",
    "NodeOutput",
    "PauseHandler",
    "ScriptHandler",
    "StubAgentSpawn",
]
