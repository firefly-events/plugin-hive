"""Reconcile handler — fetch + ff-merge agent commits before the gate.

Invokes `cli.mjs reconcile --repo <repo> --branch <branch> --sha <sha>`
via subprocess. Must be an explicit graph node between any Multica agent
node and its downstream gate so the gate provably validates real committed
files (R5 — not an empty/stale tree).

Local binding no-op: when `inputs["sha"]` is absent or empty the node
returns immediately. This covers runs where the AgentHandler used the
local binding (work already in the tree) and there is no remote commit
to harvest.

Non-ff or missing sha (after a Multica run) → ReconcileHandlerError is
raised loud; the gate must never run against a stale tree.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from ..errors import ReconcileHandlerError
from .agent import NodeOutput


class ReconcileHandler:
    """Materialises an agent's committed work into the working tree.

    Constructor parameters mirror MulticaAgentSpawn for consistency:
      cli_path  — path to hive/lib/multica-story-dispatch/cli.mjs
      node_bin  — node executable (default "node")
      timeout_ms — subprocess timeout in milliseconds (default 120 s)
    """

    _DEFAULT_TIMEOUT_MS = 120_000

    def __init__(
        self,
        *,
        cli_path: str | Path | None = None,
        node_bin: str = "node",
        timeout_ms: int = _DEFAULT_TIMEOUT_MS,
    ) -> None:
        self._cli_path = Path(cli_path) if cli_path else self._default_cli_path()
        self._node_bin = node_bin
        self._timeout_ms = timeout_ms

    @staticmethod
    def _default_cli_path() -> Path:
        # reconcile.py is at hive/lib/dag_executor/executor/handlers/reconcile.py
        # cli.mjs  is at hive/lib/multica-story-dispatch/cli.mjs
        here = Path(__file__).resolve().parent
        return (here / "../../../multica-story-dispatch/cli.mjs").resolve()

    def handle(
        self,
        node: Any,
        inputs: dict[str, Any],
        run_id: str,
    ) -> NodeOutput:
        sha = inputs.get("sha") or ""
        branch = inputs.get("branch") or ""
        repo = inputs.get("repo") or ""
        work_dir = inputs.get("work_dir") or ""

        # Local binding: no sha means work is already in the tree — clean no-op.
        if not sha:
            return NodeOutput(outputs={}, meta={"reconcile": "noop"})

        if not branch:
            raise ReconcileHandlerError(
                f"reconcile node {node.id!r}: 'branch' input required when sha is set"
            )
        if not repo:
            raise ReconcileHandlerError(
                f"reconcile node {node.id!r}: 'repo' input required when sha is set"
            )

        args = ["reconcile", "--repo", repo, "--branch", branch, "--sha", sha]
        if work_dir:
            args += ["--work-dir", work_dir]

        cmd = [self._node_bin, str(self._cli_path)] + args
        timeout_s = self._timeout_ms / 1000.0

        try:
            result = subprocess.run(
                cmd,
                text=True,
                capture_output=True,
                timeout=timeout_s,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise ReconcileHandlerError(
                f"reconcile node {node.id!r} timed out after {self._timeout_ms} ms"
            ) from exc

        if result.returncode != 0:
            raise ReconcileHandlerError(
                f"reconcile node {node.id!r} failed (exit {result.returncode}): "
                f"{result.stderr.strip()}"
            )

        try:
            data = json.loads(result.stdout)
        except ValueError as exc:
            raise ReconcileHandlerError(
                f"reconcile node {node.id!r} cli.mjs returned non-JSON: "
                f"{result.stdout[:200]!r}"
            ) from exc

        if not isinstance(data, dict):
            raise ReconcileHandlerError(
                f"reconcile node {node.id!r} cli.mjs returned non-dict "
                f"({type(data).__name__})"
            )

        return NodeOutput(
            outputs=data,
            meta={"returncode": result.returncode, "stderr": result.stderr},
        )
