"""s2 — production front-door: binding assembly + selection + CLI shim.

The L3 surface (`hive.lib.dag_executor.run_workflow` + `Walker.walk` with
run_state/resume/worktree) already loads a graph and walks it. What it does NOT
do is *assemble a dispatcher with a real AgentSpawn binding* — by contract the
caller supplies that. This module is that caller, made reusable so every skill
(plan/execute/test/review) enters the executor the same way:

  resolve_spawn_binding(...) -> pick LocalAgentSpawn (s1) or a registered binding
  assemble_dispatcher(spawn) -> Dispatcher with AgentHandler + Gate/Script/Pause
  run(...)                   -> assemble + run_workflow (run_state + resume aware)
  main()                     -> thin CLI so Node/skill prose can shell the executor

Binding selection here honours an explicit arg and the `HIVE_EXECUTION_MODE`
env, defaulting to the local binding. Full root-`hive.config.yaml` mode-knob
resolution (planning.mode / execution.mode) is unified across all flows in
story s14-backend-episodes; this module exposes the seam (`register_binding`)
that s6-multica-spawn plugs the Multica binding into.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any, Callable

from hive.lib.dag_executor.graph import NodeType


# Binding registry. s6-multica-spawn calls register_binding("multica", factory)
# so this module never imports the Node bridge directly (keeps the Python<-Node
# seam contained behind the binding).
_BINDING_FACTORIES: dict[str, Callable[..., Any]] = {}


def register_binding(name: str, factory: Callable[..., Any]) -> None:
    """Register a spawn-binding factory under `name` (e.g. "multica")."""
    _BINDING_FACTORIES[name.strip().lower()] = factory


def resolve_spawn_binding(
    binding: str | None = None,
    *,
    env: dict[str, str] | None = None,
    repo_root: Path | str | None = None,
) -> tuple[str, Any]:
    """Resolve the AgentSpawn binding.

    Precedence: explicit `binding` arg > `HIVE_EXECUTION_MODE` env > local.
    Returns `(name, spawn_instance)`. Unset/`local`/`default` -> LocalAgentSpawn
    (s1). A name registered via `register_binding` is instantiated from its
    factory. `multica` before s6 raises NotImplementedError with the story ref.
    """
    env = env if env is not None else dict(os.environ)
    name = (binding or env.get("HIVE_EXECUTION_MODE") or "local").strip().lower()

    if name in ("local", "", "default"):
        from hive.lib.dag_executor.executor import LocalAgentSpawn

        return "local", LocalAgentSpawn()

    if name in _BINDING_FACTORIES:
        return name, _BINDING_FACTORIES[name](repo_root=repo_root)

    if name == "multica":
        from hive.lib.dag_executor.executor import MulticaAgentSpawn

        return "multica", MulticaAgentSpawn(repo_root=repo_root)

    raise ValueError(
        f"unknown spawn binding {name!r} "
        f"(known: local, {', '.join(sorted(_BINDING_FACTORIES)) or 'none registered'})"
    )


def assemble_dispatcher(spawn: Any, *, repo_root: Path | str | None = None) -> Any:
    """Build a Dispatcher with a real AgentHandler bound to `spawn`.

    Gate/Script/Pause handlers come from the Dispatcher's defaults; only the
    AGENT handler needs the runtime spawn dependency injected here.
    """
    from hive.lib.dag_executor.executor import AgentHandler, Dispatcher

    dispatcher = Dispatcher()
    dispatcher.register(NodeType.AGENT, AgentHandler(spawn, repo_root=repo_root).handle)
    return dispatcher


def run(
    workflow_path: Path | str,
    *,
    binding: str | None = None,
    spawn: Any | None = None,
    run_id: str | None = None,
    run_state_path: Path | str | None = None,
    repo_root: Path | str | None = None,
    context: dict[str, Any] | None = None,
    env: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Assemble a dispatcher and run `workflow_path` through the executor.

    Pass `spawn=` to inject a binding directly (tests use StubAgentSpawn);
    otherwise the binding is resolved from `binding`/env. `run_state_path`
    enables persistence + resume (a re-run with the same path resumes from
    checkpointed state via the Walker).
    """
    if spawn is None:
        _, spawn = resolve_spawn_binding(binding, env=env, repo_root=repo_root)
    dispatcher = assemble_dispatcher(spawn, repo_root=repo_root)

    from hive.lib.dag_executor import run_workflow

    return run_workflow(
        workflow_path,
        dispatcher,
        run_id=run_id,
        run_state_path=run_state_path,
        context=context,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="hive-dag-run",
        description="Run a DAG workflow through the production front door.",
    )
    parser.add_argument("workflow", help="Path to a *.workflow.yaml graph")
    parser.add_argument(
        "--binding",
        default=None,
        help="Spawn binding: local (default) | multica (s6) | a registered name",
    )
    parser.add_argument("--run-id", default=None)
    parser.add_argument(
        "--run-state",
        default=None,
        help="Run-state file path; enables persistence + resume",
    )
    parser.add_argument("--repo-root", default=None)
    args = parser.parse_args(argv)

    outputs = run(
        args.workflow,
        binding=args.binding,
        run_id=args.run_id,
        run_state_path=args.run_state,
        repo_root=args.repo_root,
    )
    serialisable = {
        step_id: getattr(out, "outputs", out) for step_id, out in outputs.items()
    }
    print(json.dumps(serialisable, default=str))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
