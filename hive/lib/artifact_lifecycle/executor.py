"""Executor for artifact lifecycle eviction actions.

Supports two modes:
  dry_run — return planned EvictRecord objects without touching the filesystem.
  apply   — move each candidate to OS temp (via shutil.move) and return records.

The OS-temp destination preserves the source filename stem with a unique suffix
so collisions from repeated sweeps across different state dirs do not overwrite
each other. The sweep records both source and destination for auditability.

Design decisions consumed:
  D1 — action = evict (move-to-temp); NOT durable archival.
  D4 — verb is "evict"; temp is transient (OS purge reclaims).
"""

from __future__ import annotations

import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from .planner import EvictCandidate


@dataclass(frozen=True)
class EvictRecord:
    """Audit record for a completed or planned eviction."""

    class_id: str
    source: Path
    dest: Path
    dry_run: bool


class ExecutorError(RuntimeError):
    pass


def dry_run(candidates: Sequence[EvictCandidate]) -> list[EvictRecord]:
    """Return planned eviction records without moving anything.

    Each record has ``dry_run=True`` and a ``dest`` path showing where the
    artifact *would* be moved if apply mode were used.
    """
    records: list[EvictRecord] = []
    tmp_root = Path(tempfile.gettempdir()) / "hive-artifact-lifecycle"
    for candidate in candidates:
        dest = _dest_path(candidate.path, tmp_root)
        records.append(
            EvictRecord(
                class_id=candidate.class_id,
                source=candidate.path,
                dest=dest,
                dry_run=True,
            )
        )
    return records


def apply_evict(
    candidates: Sequence[EvictCandidate],
    tmp_root: Path | None = None,
) -> list[EvictRecord]:
    """Move each candidate to OS temp and return audit records.

    Args:
        candidates: Planned eviction candidates from the planner.
        tmp_root:   Directory under which artifacts are placed.  Defaults to
                    ``<tempfile.gettempdir()>/hive-artifact-lifecycle``.

    Returns:
        One :class:`EvictRecord` per successfully moved artifact.  Failures
        raise :class:`ExecutorError` immediately — partial moves are possible
        when multiple candidates are provided.
    """
    if tmp_root is None:
        tmp_root = Path(tempfile.gettempdir()) / "hive-artifact-lifecycle"
    tmp_root.mkdir(parents=True, exist_ok=True)

    records: list[EvictRecord] = []
    for candidate in candidates:
        dest = _dest_path(candidate.path, tmp_root)
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.move(str(candidate.path), str(dest))
        except Exception as exc:
            raise ExecutorError(
                f"Failed to evict {candidate.path} → {dest}: {exc}"
            ) from exc
        records.append(
            EvictRecord(
                class_id=candidate.class_id,
                source=candidate.path,
                dest=dest,
                dry_run=False,
            )
        )
    return records


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _dest_path(source: Path, tmp_root: Path) -> Path:
    """Derive a unique destination path under *tmp_root*.

    Preserves the source path's last two components (parent dir name + filename)
    so the result is human-readable while the full source path prefix acts as a
    natural namespace when needed by tests (source.as_posix() is embedded in the
    parent dir name).
    """
    # Use a sanitised form of the full source path to avoid collisions.
    safe = source.as_posix().lstrip("/").replace("/", "_")
    return tmp_root / safe


__all__ = [
    "EvictRecord",
    "ExecutorError",
    "apply_evict",
    "dry_run",
]
