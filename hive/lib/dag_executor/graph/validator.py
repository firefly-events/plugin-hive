"""Validate a Graph for executor-readiness.

`validate_graph` raises one of the typed errors from `errors.py` on the
first violation it encounters. Checks are structural only — no execution
semantics, no predicate evaluation, no tool-gating composition.
"""

from __future__ import annotations

from .errors import (
    CycleError,
    DanglingRefError,
    InvalidInputSourceError,
    TimeoutOutOfRangeError,
    TypeMismatchError,
)
from .model import (
    VALID_INPUT_SOURCES,
    VALID_OUTPUT_TYPES,
    Graph,
)


TIMEOUT_MIN_MS = 1000
TIMEOUT_MAX_MS = 3_600_000


def _detect_cycle(graph: Graph) -> list[str] | None:
    """Return the cycle node-id list if a cycle exists, else None.

    Uses iterative DFS with WHITE/GRAY/BLACK coloring so we can name the
    cycle path back to the user.
    """
    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = {nid: WHITE for nid in graph.nodes}
    parent: dict[str, str | None] = {nid: None for nid in graph.nodes}

    successors: dict[str, list[str]] = {nid: [] for nid in graph.nodes}
    for node in graph.nodes.values():
        for predecessor_id in node.depends_on:
            if predecessor_id in successors:
                successors[predecessor_id].append(node.id)

    for start in graph.nodes:
        if color[start] != WHITE:
            continue
        stack: list[tuple[str, int]] = [(start, 0)]
        while stack:
            node_id, child_idx = stack[-1]
            if child_idx == 0:
                color[node_id] = GRAY
            children = successors.get(node_id, [])
            if child_idx < len(children):
                stack[-1] = (node_id, child_idx + 1)
                child = children[child_idx]
                if color[child] == GRAY:
                    cycle = [child, node_id]
                    cursor = parent.get(node_id)
                    while cursor is not None and cursor != child:
                        cycle.append(cursor)
                        cursor = parent.get(cursor)
                    cycle.append(child)
                    cycle.reverse()
                    return cycle
                if color[child] == WHITE:
                    parent[child] = node_id
                    stack.append((child, 0))
            else:
                color[node_id] = BLACK
                stack.pop()
    return None


def validate_graph(graph: Graph) -> None:
    """Raise the appropriate typed error on the first violation."""
    # Dangling depends_on
    for node in graph.nodes.values():
        for predecessor_id in node.depends_on:
            if predecessor_id not in graph.nodes:
                raise DanglingRefError(
                    referencing_node_id=node.id,
                    missing_target_id=predecessor_id,
                    ref_kind="depends_on",
                )

    # Cycles
    cycle = _detect_cycle(graph)
    if cycle is not None:
        raise CycleError(cycle_node_ids=cycle)

    # Inputs
    for node in graph.nodes.values():
        for binding in node.inputs:
            if binding.source not in VALID_INPUT_SOURCES:
                raise InvalidInputSourceError(
                    node_id=node.id,
                    input_name=binding.name,
                    bad_source=binding.source,
                )
            if binding.step_id is not None and binding.step_id not in graph.nodes:
                raise DanglingRefError(
                    referencing_node_id=node.id,
                    missing_target_id=binding.step_id,
                    ref_kind=f"input '{binding.name}'.step_id",
                )

    # Outputs
    for node in graph.nodes.values():
        for output in node.outputs:
            if output.type not in VALID_OUTPUT_TYPES:
                raise TypeMismatchError(
                    node_id=node.id,
                    output_name=output.name,
                    bad_type=output.type,
                )

    # Timeouts
    for node in graph.nodes.values():
        if node.timeout_ms is None:
            continue
        # bool is a subclass of int — exclude it explicitly so a
        # `timeout_ms: true` typo does not silently coerce to 1.
        if not isinstance(node.timeout_ms, int) or isinstance(node.timeout_ms, bool):
            raise TimeoutOutOfRangeError(
                node_id=node.id,
                timeout_ms=node.timeout_ms,
            )
        if node.timeout_ms < TIMEOUT_MIN_MS or node.timeout_ms > TIMEOUT_MAX_MS:
            raise TimeoutOutOfRangeError(
                node_id=node.id,
                timeout_ms=node.timeout_ms,
            )
