"""Gate handler — declarative presence/non-empty checks.

Initial implementation handles the `must not be empty` predicate
shipping today (e.g., `development.classic.workflow.yaml:166` —
`test_artifacts must not be empty`). Richer predicate languages land
in hde-3a; this handler intentionally stays narrow.

The gate's predicate string lives on `node.gate`. Inputs to the gate
are the resolved input values from the materialised output graph.
"""

from __future__ import annotations

import re
from typing import Any

from ..errors import GateFailedError
from .agent import NodeOutput


_NOT_EMPTY = re.compile(r"^(?P<name>[\w.-]+)\s+must\s+not\s+be\s+empty$", re.IGNORECASE)


def _is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, (str, list, tuple, dict, set)):
        return len(value) == 0
    return False


class GateHandler:
    """Evaluates simple presence-style gate predicates."""

    def handle(
        self,
        node: Any,
        inputs: dict[str, Any],
        run_id: str,
    ) -> NodeOutput:
        predicate = (node.gate or "").strip()
        if not predicate:
            raise GateFailedError(
                f"gate node {node.id!r} has no gate predicate"
            )

        match = _NOT_EMPTY.match(predicate)
        if not match:
            raise GateFailedError(
                f"gate node {node.id!r} predicate not understood by hde-2 gate handler "
                f"(richer predicates land in hde-3a): {predicate!r}"
            )
        name = match.group("name")
        value = inputs.get(name)
        if _is_empty(value):
            raise GateFailedError(
                f"gate node {node.id!r}: {name!r} is empty (predicate {predicate!r})"
            )
        return NodeOutput(outputs={"gate_passed": True}, meta={"predicate": predicate})
