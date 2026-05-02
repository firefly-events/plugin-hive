"""Pause handler — STUB ONLY.

Full suspend/resume token semantics land in hde-8 (depends_on hde-5
for the run-state primitives). The dispatcher routes pause nodes here
so every node_type has a handler entry; this handler returns
immediately without suspending so the spine workflow can complete.
"""

from __future__ import annotations

from typing import Any

from .agent import NodeOutput


class PauseHandler:
    """Returns immediately. Full pause semantics ship in hde-8."""

    def handle(
        self,
        node: Any,
        inputs: dict[str, Any],
        run_id: str,
    ) -> NodeOutput:
        return NodeOutput(outputs={"paused": False}, meta={"stub": True})
