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

Binding selection honours (in precedence order):
  1. explicit ``binding`` arg
  2. ``HIVE_EXECUTION_MODE`` env var
  3. ``{flow}.mode`` knob in root ``hive.config.yaml`` (s14 — config unification)
  4. default ``"local"``

``flow`` is ``"planning"`` for the plan flow and ``"execution"`` for
execute/test/review. The precedence above is the single shared resolver that all
four flows (plan=s9, execute=s11, test=s12, review=s13) now use; there is no
per-flow copy of this logic (s14-backend-episodes AC1).

This module also exposes the ``register_binding`` seam that s6-multica-spawn
plugs the Multica binding into.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any, Callable

import yaml

from hive.lib.dag_executor.graph import NodeType


# Binding registry. s6-multica-spawn calls register_binding("multica", factory)
# so this module never imports the Node bridge directly (keeps the Python<-Node
# seam contained behind the binding).
_BINDING_FACTORIES: dict[str, Callable[..., Any]] = {}


def register_binding(name: str, factory: Callable[..., Any]) -> None:
    """Register a spawn-binding factory under `name` (e.g. "multica")."""
    _BINDING_FACTORIES[name.strip().lower()] = factory


def _read_mode_knob(
    repo_root: Path | str | None,
    *,
    flow: str = "execution",
) -> str | None:
    """Read ``{flow}.mode`` from the root ``hive.config.yaml`` (s14 AC1).

    Checks the consumer-override config first (``.pHive/hive.config.yaml``),
    then the shipped baseline (``hive/hive.config.yaml``). Returns the raw mode
    string (e.g. ``"multica"``) or ``None`` if the key is absent or unreadable.
    """
    root = Path(repo_root) if repo_root is not None else Path.cwd()
    candidates = (
        root / ".pHive" / "hive.config.yaml",
        root / "hive" / "hive.config.yaml",
    )
    for config_path in candidates:
        if not config_path.is_file():
            continue
        try:
            raw = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError):
            continue
        if not isinstance(raw, dict):
            continue
        section = raw.get(flow)
        if isinstance(section, dict):
            mode = section.get("mode")
            if isinstance(mode, str) and mode:
                return mode.strip().lower()
    return None


def resolve_spawn_binding(
    binding: str | None = None,
    *,
    env: dict[str, str] | None = None,
    repo_root: Path | str | None = None,
    flow: str = "execution",
) -> tuple[str, Any]:
    """Resolve the AgentSpawn binding.

    Precedence: explicit ``binding`` arg > ``HIVE_EXECUTION_MODE`` env >
    ``{flow}.mode`` config knob > ``"local"``.

    ``flow`` is ``"planning"`` for the plan flow and ``"execution"`` for
    execute/test/review. This is the single shared resolver for all four
    flows — plan/execute/test/review all call this function (s14 AC1).

    Returns ``(name, spawn_instance)``. Unset/``local``/``default`` →
    LocalAgentSpawn (s1). A name registered via ``register_binding`` is
    instantiated from its factory. ``multica`` falls through to
    ``MulticaAgentSpawn`` (registered by s6-multica-spawn).
    """
    env = env if env is not None else dict(os.environ)
    name = (
        binding
        or env.get("HIVE_EXECUTION_MODE")
        or _read_mode_knob(repo_root, flow=flow)
        or "local"
    ).strip().lower()

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
    flow: str = "execution",
    episode_hook: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    """Assemble a dispatcher and run ``workflow_path`` through the executor.

    Parameters
    ----------
    workflow_path:
        Path to a ``*.workflow.yaml`` graph.
    binding:
        Explicit spawn-binding name. If omitted, resolved via
        ``resolve_spawn_binding`` (env then config knob then local).
    spawn:
        Pre-constructed spawn instance (tests pass ``StubAgentSpawn``).
    run_id:
        Explicit run identifier. Auto-generated from workflow slug if omitted.
    run_state_path:
        Directory root for ``run_state.yaml`` persistence. Enables resume:
        re-invoke with the same ``run_id`` and path to replay from checkpoint
        (see ``hive.lib.dag_executor.run_state.resume.resume_run``).
    repo_root:
        Repo root for config-knob reading and binding factory instantiation.
    context:
        Arbitrary key/value context forwarded to graph nodes.
    env:
        Environment dict override (defaults to ``os.environ``).
    flow:
        Logical flow label used for config-knob selection and episode markers.
        Use ``"planning"`` for the plan flow; ``"execution"`` (default) for
        execute/test/review. Passed to ``resolve_spawn_binding`` so the correct
        ``{flow}.mode`` knob is consulted.
    episode_hook:
        Optional callable invoked after a successful run with keyword args
        ``(run_id, workflow, flow, outputs, status)``. Use
        ``hive.lib.dag_executor.episode.emit_run_episode`` to write the
        standard DAG-run episode marker (s14 AC2).
    """
    if spawn is None:
        _, spawn = resolve_spawn_binding(binding, env=env, repo_root=repo_root, flow=flow)
    dispatcher = assemble_dispatcher(spawn, repo_root=repo_root)

    from hive.lib.dag_executor import run_workflow
    from hive.lib.dag_executor.executor import make_run_id
    from hive.lib.dag_executor.graph import load_workflow

    wf_path = Path(workflow_path)
    graph = load_workflow(wf_path)
    effective_run_id = run_id or make_run_id(graph.workflow_name)

    try:
        outputs = run_workflow(
            wf_path,
            dispatcher,
            run_id=effective_run_id,
            run_state_path=run_state_path,
            context=context,
        )
    except Exception:
        if episode_hook is not None:
            try:
                episode_hook(
                    run_id=effective_run_id,
                    workflow=graph.workflow_name,
                    flow=flow,
                    outputs={},
                    status="failed",
                )
            except Exception:
                pass
        raise

    if episode_hook is not None:
        episode_hook(
            run_id=effective_run_id,
            workflow=graph.workflow_name,
            flow=flow,
            outputs=outputs,
            status="completed",
        )

    return outputs


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
