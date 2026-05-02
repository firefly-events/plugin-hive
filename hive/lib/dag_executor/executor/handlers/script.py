"""Script handler — runs `node.task` as a shell command.

Captures stdout into `NodeOutput.outputs["stdout"]`. Honors
`node.timeout_ms` if set; raises `ScriptHandlerError` on subprocess
failure or timeout. Predicate evaluation is intentionally NOT done
here (hde-3a owns that); script handler runs whatever string is in
`node.task` verbatim.
"""

from __future__ import annotations

import subprocess
from typing import Any

from ..errors import ScriptHandlerError
from .agent import NodeOutput


class ScriptHandler:
    """Executes a node's `task` shell command."""

    def handle(
        self,
        node: Any,
        inputs: dict[str, Any],
        run_id: str,
    ) -> NodeOutput:
        task = node.task or ""
        if not task:
            raise ScriptHandlerError(
                f"script node {node.id!r} has empty task — nothing to run"
            )
        timeout_s: float | None = None
        if node.timeout_ms is not None:
            timeout_s = node.timeout_ms / 1000.0

        try:
            completed = subprocess.run(
                task,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout_s,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise ScriptHandlerError(
                f"script node {node.id!r} exceeded timeout_ms={node.timeout_ms}"
            ) from exc

        if completed.returncode != 0:
            raise ScriptHandlerError(
                f"script node {node.id!r} exited {completed.returncode}: {completed.stderr.strip()}"
            )

        return NodeOutput(
            outputs={"stdout": completed.stdout},
            meta={"returncode": completed.returncode, "stderr": completed.stderr},
        )
