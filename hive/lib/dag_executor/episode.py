"""Episode marker emission for DAG executor runs (s14-backend-episodes AC2).

Writes a dag-run.yaml marker into the episode surface so DAG-on-Multica
flows are observable and auditable. Called via the `episode_hook` parameter
of `run()` in `hive.lib.dag_executor.run`.

Marker path: {state_dir}/episodes/{flow}/{run_id}/dag-run.yaml
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml


def emit_run_episode(
    *,
    run_id: str,
    workflow: str,
    flow: str,
    status: str,
    outputs: dict[str, Any],
    state_dir: Path | str | None = None,
) -> Path:
    """Write a dag-run.yaml episode marker for a completed/failed DAG flow.

    Parameters
    ----------
    run_id:    Unique run identifier (ULID-slug).
    workflow:  Workflow name (e.g. ``plan``, ``development.classic``).
    flow:      Logical flow label (``plan`` | ``execute`` | ``test`` | ``review``).
    status:    Terminal status (``completed`` | ``failed``).
    outputs:   Materialised output dict from ``run()`` (keys = node ids).
    state_dir: Root state directory. Defaults to the sdr-1 resolved state dir.

    Returns the path of the written marker file.
    """
    if state_dir is None:
        from hive.lib.config import resolve_state_dir

        state_dir = Path(resolve_state_dir(cwd=Path.cwd(), env=dict(os.environ)))
    else:
        state_dir = Path(state_dir)

    marker_dir = state_dir / "episodes" / flow / run_id
    marker_dir.mkdir(parents=True, exist_ok=True)
    marker_path = marker_dir / "dag-run.yaml"

    payload: dict[str, Any] = {
        "run_id": run_id,
        "workflow": workflow,
        "flow": flow,
        "status": status,
        "completed_nodes": sorted(outputs.keys()),
        "emitted_at": datetime.now(timezone.utc).isoformat(),
    }

    tmp = marker_path.with_suffix(marker_path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(payload, handle, sort_keys=False)
    os.replace(tmp, marker_path)
    return marker_path


__all__ = ["emit_run_episode"]
