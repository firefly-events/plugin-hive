"""DAG executor for Hive workflows.

Local Python module per architect's plugin-packaging lock; not in
plugin.json. The marketplace surface continues to be the existing
`/execute` skill, which invokes this executor when the consumer-side
flag (`.pHive/hive.config.yaml`) is on AND the workflow appears in the
graduation registry (`.pHive/runtime/executor-graduated-workflows.yaml`).

Default behaviour is OFF — orchestrator-narrated path. Schema evolution
stays under maintainer control until the surface is stable.

Public surface for `skills/execute` and tests:

    load_executor_config(repo_root) -> dict
    is_workflow_graduated(workflow_name, repo_root) -> bool
    executor_enabled_for(workflow_name, repo_root) -> bool
    run_workflow(workflow_path, ...) -> dict[str, NodeOutput]
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

# Consumer-side config + registry paths (relative to repo root).
# These are LOCATIONS — content is per-consumer and gitignored where
# appropriate.
CONSUMER_CONFIG_PATH = Path(".pHive/hive.config.yaml")
GRADUATED_REGISTRY_PATH = Path(".pHive/runtime/executor-graduated-workflows.yaml")

# The only valid executor identifier today. Any other value fails closed
# (orchestrator path) per the Q4 lock.
EXECUTOR_HIVE_DAG = "hive-dag"


def _normalise_default(raw: Any) -> bool:
    """Normalise `executor_default` to a strict bool.

    PyYAML 1.1 maps unquoted `on`/`off`/`yes`/`no` to True/False; consumers
    may also write quoted `"on"`/`"off"` strings. Anything else (None,
    unknown string, missing key) → False (fail-closed).
    """

    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        return raw.strip().lower() in {"on", "true", "yes", "1"}
    return False


def load_executor_config(repo_root: Path | str | None = None) -> dict[str, Any]:
    """Read `.pHive/hive.config.yaml`.

    Returns a dict with normalised keys:
        {"executor": <str|None>, "executor_default": <bool>, "_present": <bool>}

    Missing file → `{"executor": None, "executor_default": False, "_present": False}`.
    Any read/parse error fails closed to the same default-OFF shape so a
    malformed consumer config never accidentally activates the executor.
    """

    root = Path(repo_root) if repo_root is not None else Path.cwd()
    config_path = root / CONSUMER_CONFIG_PATH

    default = {"executor": None, "executor_default": False, "_present": False}
    if not config_path.is_file():
        return default

    try:
        raw_text = config_path.read_text(encoding="utf-8")
        parsed = yaml.safe_load(raw_text) or {}
    except (OSError, yaml.YAMLError):
        return default

    if not isinstance(parsed, dict):
        return default

    return {
        "executor": parsed.get("executor"),
        "executor_default": _normalise_default(parsed.get("executor_default")),
        "_present": True,
    }


def _load_graduated_registry(repo_root: Path) -> set[str]:
    """Read the maintainer-only graduation registry (hde-9b).

    Missing file → empty set (no workflows graduated). Malformed file
    fails closed to empty so consumers never get a partial allow-list.

    The registry schema is hde-9b's contract; this reader only requires
    a top-level `workflows:` list of workflow-name strings. Any other
    shape returns empty.
    """

    registry_path = repo_root / GRADUATED_REGISTRY_PATH
    if not registry_path.is_file():
        return set()

    try:
        parsed = yaml.safe_load(registry_path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError):
        return set()

    if not isinstance(parsed, dict):
        return set()

    raw = parsed.get("workflows")
    if not isinstance(raw, list):
        return set()
    if not all(isinstance(item, str) and item for item in raw):
        return set()

    return set(raw)


def is_workflow_graduated(
    workflow_name: str,
    repo_root: Path | str | None = None,
) -> bool:
    """True iff `workflow_name` appears in the graduation registry."""

    root = Path(repo_root) if repo_root is not None else Path.cwd()
    return workflow_name in _load_graduated_registry(root)


def executor_enabled_for(
    workflow_name: str,
    repo_root: Path | str | None = None,
) -> bool:
    """Single dispatch decision: should `/execute` invoke the executor?

    Returns True iff ALL of the following hold:
      1. `.pHive/hive.config.yaml` exists.
      2. `executor: hive-dag` (the only valid value today).
      3. `executor_default: on` (or truthy equivalent).
      4. `workflow_name` appears in the graduation registry.

    Otherwise False → orchestrator-narrated path. Default OFF.
    """

    root = Path(repo_root) if repo_root is not None else Path.cwd()
    cfg = load_executor_config(root)
    if not cfg["_present"]:
        return False
    if cfg["executor"] != EXECUTOR_HIVE_DAG:
        return False
    if not cfg["executor_default"]:
        return False
    return is_workflow_graduated(workflow_name, root)


def run_workflow(
    workflow_path: Path | str,
    dispatcher: Any,
    *,
    run_id: str | None = None,
    telemetry: Any | None = None,
    run_state_path: Path | str | None = None,
    worktree_manager: Any | None = None,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Invoke the executor for `workflow_path`.

    Thin wrapper that materialises the executor's L3 surface
    (run_state + worktree-aware Walker invocation). Caller-supplied
    `dispatcher` and `worktree_manager` are honoured — important for
    meta-meta-optimize (hde-6 nesting policy: the outer cycle worktree
    must be reused; do not nest a new one).

    The skill caller is responsible for assembling the dispatcher with
    the handler shape it needs (real `AgentHandler(spawn=...)` for live
    runs, stubs for tests). The wrapper does not synthesise a default
    dispatcher because real handlers require runtime dependencies (a
    live `AgentSpawn`) that this layer cannot reasonably default.

    Returns the materialised output graph (`{step_id: NodeOutput}`).
    """

    # Imports kept local so `import hive.lib.dag_executor` stays cheap
    # and free of side effects for callers that only need the config
    # readers (e.g., the gating tests).
    from hive.lib.dag_executor.executor import Telemetry, Walker, make_run_id
    from hive.lib.dag_executor.graph import load_workflow

    graph = load_workflow(Path(workflow_path))

    effective_run_id = run_id or make_run_id(graph.workflow_name)
    effective_telemetry = telemetry or Telemetry(run_id=effective_run_id)

    return Walker().walk(
        graph,
        dispatcher,
        effective_run_id,
        effective_telemetry,
        context=context or {},
        run_state_path=Path(run_state_path) if run_state_path else None,
        worktree_manager=worktree_manager,
    )


__all__ = [
    "CONSUMER_CONFIG_PATH",
    "EXECUTOR_HIVE_DAG",
    "GRADUATED_REGISTRY_PATH",
    "executor_enabled_for",
    "is_workflow_graduated",
    "load_executor_config",
    "run_workflow",
]
