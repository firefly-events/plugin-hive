from __future__ import annotations

import os
from pathlib import Path

from .errors import MetricsPathBoundaryError


PACKAGE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = PACKAGE_DIR.parents[2]
DEFAULT_METRICS_ROOT = PROJECT_ROOT / ".pHive" / "metrics"


def get_metrics_root() -> Path:
    override = os.environ.get("METRICS_ROOT")
    root = Path(override).expanduser() if override else DEFAULT_METRICS_ROOT
    return root.resolve()


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

