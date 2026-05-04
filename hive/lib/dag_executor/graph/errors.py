"""Typed exceptions raised by the DAG graph loader and validator.

Each error carries the offending node id(s) and a human-readable message
so the executor (or a debug session) can pinpoint the failing graph
element without inspecting the raw YAML.
"""

from __future__ import annotations


class GraphLoadError(Exception):
    """Base class for all graph load and validation failures."""


class CycleError(GraphLoadError):
    """A cycle was detected in the graph's depends_on relations."""

    def __init__(self, cycle_node_ids: list[str]):
        self.cycle_node_ids = list(cycle_node_ids)
        joined = " -> ".join(self.cycle_node_ids)
        super().__init__(f"cycle detected in graph: {joined}")


class DanglingRefError(GraphLoadError):
    """A depends_on or input.step_id references a node that does not exist."""

    def __init__(self, referencing_node_id: str, missing_target_id: str, ref_kind: str = "depends_on"):
        self.referencing_node_id = referencing_node_id
        self.missing_target_id = missing_target_id
        self.ref_kind = ref_kind
        super().__init__(
            f"node '{referencing_node_id}' references missing node "
            f"'{missing_target_id}' via {ref_kind}"
        )


class TypeMismatchError(GraphLoadError):
    """An OutputRef.type is not one of the supported enum values."""

    def __init__(self, node_id: str, output_name: str, bad_type: str):
        self.node_id = node_id
        self.output_name = output_name
        self.bad_type = bad_type
        super().__init__(
            f"node '{node_id}' output '{output_name}' has invalid type "
            f"'{bad_type}' (expected: string, json, artifact_ref)"
        )


class TimeoutOutOfRangeError(GraphLoadError):
    """A node's timeout_ms is outside the [1000, 3600000] allowed range."""

    def __init__(self, node_id: str, timeout_ms: int):
        self.node_id = node_id
        self.timeout_ms = timeout_ms
        super().__init__(
            f"node '{node_id}' timeout_ms={timeout_ms} out of range "
            f"[1000, 3600000]"
        )


class InvalidInputSourceError(GraphLoadError):
    """An InputBinding.source is not one of the supported enum values."""

    def __init__(self, node_id: str, input_name: str, bad_source: str):
        self.node_id = node_id
        self.input_name = input_name
        self.bad_source = bad_source
        super().__init__(
            f"node '{node_id}' input '{input_name}' has invalid source "
            f"'{bad_source}' (expected: literal, step_output, context)"
        )
