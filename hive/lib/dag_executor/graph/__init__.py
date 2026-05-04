"""Public surface for the DAG executor's graph layer.

The graph layer parses Hive workflow YAMLs into a typed in-memory model
and validates them. It does NOT execute any step; the executor core
(hde-2) walks the Graph this layer produces.
"""

from .errors import (
    CycleError,
    DanglingRefError,
    GraphLoadError,
    InvalidInputSourceError,
    TimeoutOutOfRangeError,
    TypeMismatchError,
)
from .loader import load_all_workflows, load_workflow
from .model import (
    VALID_INPUT_SOURCES,
    VALID_OUTPUT_TYPES,
    ConditionalEdge,
    Graph,
    InputBinding,
    Node,
    NodeType,
    OutputRef,
)
from .validator import validate_graph

# Backwards-compatible alias for the generic "edge" name used in spec docs.
Edge = ConditionalEdge

__all__ = [
    "ConditionalEdge",
    "CycleError",
    "DanglingRefError",
    "Edge",
    "Graph",
    "GraphLoadError",
    "InputBinding",
    "InvalidInputSourceError",
    "Node",
    "NodeType",
    "OutputRef",
    "TimeoutOutOfRangeError",
    "TypeMismatchError",
    "VALID_INPUT_SOURCES",
    "VALID_OUTPUT_TYPES",
    "load_all_workflows",
    "load_workflow",
    "validate_graph",
]
