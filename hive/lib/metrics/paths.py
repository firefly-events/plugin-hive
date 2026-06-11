from __future__ import annotations

import os
from pathlib import Path

from hive.lib.config import resolve_state_dir

from .errors import MetricsPathBoundaryError


def get_metrics_root() -> Path:
    """Resolve the metrics root, per call (not frozen at import time).

    Precedence: ``METRICS_ROOT`` env (existing metrics-specific seam, used by
    tests and the maintainer proof scripts) > ``<state-dir>/metrics``, where
    ``<state-dir>`` comes from the sdr-1 resolver (``HIVE_STATE_DIR`` env >
    ``paths.state_dir`` in hive.config.yaml > default ``.pHive`` under cwd).
    The previous default was pinned to this package's repo root, which
    diverged from the shell metrics hooks (they write relative to cwd) —
    adopting the resolver closes that writer/reader split.
    """
    override = os.environ.get("METRICS_ROOT")
    if override:
        return Path(override).expanduser().resolve()
    state_dir = resolve_state_dir(cwd=Path.cwd(), env=os.environ)
    return (Path(state_dir) / "metrics").resolve()


def resolve_metrics_path(*parts: str, for_write: bool = False) -> Path:
    root = get_metrics_root()
    candidate = root.joinpath(*parts).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise MetricsPathBoundaryError(
            f"resolved path escapes metrics root: {candidate}"
        ) from exc

    if for_write:
        parent = candidate.parent
        parent.mkdir(parents=True, exist_ok=True)
        candidate = candidate.resolve()
        try:
            candidate.relative_to(root)
        except ValueError as exc:
            raise MetricsPathBoundaryError(
                f"resolved write path escapes metrics root: {candidate}"
            ) from exc
    return candidate

