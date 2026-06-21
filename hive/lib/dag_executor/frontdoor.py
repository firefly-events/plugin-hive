"""Production front door for the DAG executor.

Single reusable entrypoint for all Hive skills (plan / execute / test / review).
Assembles the Dispatcher with real handlers, selects the AgentSpawn binding, and
supports stateful resume.

Binding selection order:
  1. Explicit ``spawn`` argument (bypasses all detection)
  2. Explicit ``mode`` argument
  3. ``HIVE_EXECUTION_MODE`` environment variable
  4. Default: ``"local"`` → :class:`~hive.lib.dag_executor.executor.handlers.LocalAgentSpawn`

Supported modes:
  ``"local"``   — LocalAgentSpawn (subprocess ``claude --print``, s1)
  ``"multica"`` — MulticaAgentSpawn (Multica issue dispatch, s4; raises
                  NotImplementedError until s4 lands)
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from hive.lib.dag_executor.executor import (
    AgentHandler,
    Dispatcher,
    LocalAgentSpawn,
    Telemetry,
    Walker,
    make_run_id,
)
from hive.lib.dag_executor.executor.handlers import GateHandler, PauseHandler, ScriptHandler
from hive.lib.dag_executor.graph import NodeType, load_workflow


def resolve_spawn_binding(mode: str | None = None) -> Any:
    """Return the AgentSpawn implementation for the given mode.

    Priority: explicit ``mode`` arg → ``HIVE_EXECUTION_MODE`` env → ``"local"``.
    """
    effective = (mode or os.environ.get("HIVE_EXECUTION_MODE") or "local").lower().strip()
    if effective == "multica":
        try:
            from hive.lib.dag_executor.executor.handlers.agent import (  # noqa: PLC0415
                MulticaAgentSpawn,
            )
        except ImportError:
            raise NotImplementedError(
                "MulticaAgentSpawn (s4) is not yet available. "
                "Unset HIVE_EXECUTION_MODE or set it to 'local'."
            ) from None
        return MulticaAgentSpawn()
    return LocalAgentSpawn()


def assemble_dispatcher(spawn: Any, runs_root: Path | None = None) -> Dispatcher:
    """Build a Dispatcher with the full production handler set.

    Registers handlers for AGENT, GATE, SCRIPT, and PAUSE node types.
    ``runs_root`` is forwarded to :class:`PauseHandler` for pause-token I/O.
    """
    d = Dispatcher()
    d.register(NodeType.AGENT, AgentHandler(spawn=spawn).handle)
    d.register(NodeType.GATE, GateHandler().handle)
    d.register(NodeType.SCRIPT, ScriptHandler().handle)
    d.register(NodeType.PAUSE, PauseHandler(runs_root=runs_root).handle)
    return d


def run_frontdoor(
    workflow_path: Path | str,
    *,
    run_id: str | None = None,
    mode: str | None = None,
    spawn: Any | None = None,
    run_state_path: Path | str | None = None,
    context: dict[str, Any] | None = None,
    worktree_manager: Any | None = None,
) -> dict[str, Any]:
    """Production entrypoint for DAG execution.

    Loads the graph, selects the AgentSpawn binding, assembles the Dispatcher with all
    four handler types, and runs the graph.  Supports stateful resume: pass the same
    ``run_id`` together with ``run_state_path`` to skip completed nodes and retry from
    the last failure point.

    Args:
        workflow_path:    Path to a ``*.workflow.yaml`` file.
        run_id:           Run identifier.  Pass the same value as a prior interrupted
                          run (together with ``run_state_path``) to resume.  A new
                          ULID-prefixed ID is generated when omitted.
        mode:             Spawn backend: ``"local"`` (default) or ``"multica"``.
                          Overrides the ``HIVE_EXECUTION_MODE`` environment variable.
                          Ignored when ``spawn`` is provided.
        spawn:            Explicit ``AgentSpawn`` instance.  When supplied, ``mode`` /
                          ``HIVE_EXECUTION_MODE`` are ignored.
        run_state_path:   Directory root for run-state YAML and pause tokens.  Required
                          for resume semantics; omit for stateless runs.
        context:          Workflow-level context dict forwarded to every node.
        worktree_manager: Optional worktree manager (preserves nesting policy).

    Returns:
        ``{step_id: NodeOutput}`` mapping of completed node outputs.
    """
    wf_path = Path(workflow_path)
    graph = load_workflow(wf_path)

    effective_spawn = spawn if spawn is not None else resolve_spawn_binding(mode)
    effective_run_id = run_id or make_run_id(graph.workflow_name)
    runs_root: Path | None = Path(run_state_path) if run_state_path is not None else None

    dispatcher = assemble_dispatcher(effective_spawn, runs_root=runs_root)
    telemetry = Telemetry(run_id=effective_run_id)
    walker = Walker()

    if run_id is not None and runs_root is not None:
        from hive.lib.dag_executor.executor.handlers import NodeOutput  # noqa: PLC0415
        from hive.lib.dag_executor.run_state import (  # noqa: PLC0415
            RunStateNotFoundError,
            resume_run,
        )

        try:
            final_state = resume_run(
                run_id,
                graph,
                walker,
                dispatcher,
                telemetry,
                runs_root,
                context or {},
            )
            return {
                nid: NodeOutput(outputs=dict(payload))
                for nid, payload in final_state.output_graph.items()
            }
        except RunStateNotFoundError:
            pass  # no prior state — fall through to fresh run

    return walker.walk(
        graph,
        dispatcher,
        effective_run_id,
        telemetry,
        context=context or {},
        run_state_path=runs_root,
        worktree_manager=worktree_manager,
    )


__all__ = [
    "assemble_dispatcher",
    "resolve_spawn_binding",
    "run_frontdoor",
]
