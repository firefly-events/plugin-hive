"""Artifact lifecycle planner — builds candidate lists from registry entries.

Hard exclusions are applied before any candidate is created, so forever-retained
paths can never appear in a plan (D1 design decision).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from hive.lib.artifact_lifecycle.exclusions import (
    HardExcludeError,
    assert_not_hard_excluded,
    is_hard_excluded,
)
from hive.lib.artifact_lifecycle.registry import ArchiveAction, RegistryEntry


@dataclass(frozen=True)
class Candidate:
    """A single artifact path proposed for lifecycle action."""

    path: Path
    class_id: str
    action: ArchiveAction


class PlanError(RuntimeError):
    """Raised when planning fails for a non-exclusion reason."""


def build_candidates(
    entry: RegistryEntry,
    paths: list[Path],
) -> list[Candidate]:
    """Return Candidate records for *paths* that are not hard-excluded.

    Hard-excluded paths are silently dropped — they never become candidates.
    The caller is responsible for supplying an already-scanned list of paths
    matching the entry's globs.

    Args:
        entry: The registry entry describing this artifact class.
        paths: Candidate paths discovered by glob expansion.

    Returns:
        List of :class:`Candidate` with hard-excluded paths removed.
    """
    candidates: list[Candidate] = []
    for path in paths:
        if is_hard_excluded(path):
            continue
        candidates.append(
            Candidate(
                path=path,
                class_id=entry.class_id,
                action=entry.archive_action,
            )
        )
    return candidates


def apply_guard(candidate: Candidate) -> None:
    """Enforce hard-exclusion contract before executing any apply-mode action.

    Raises :class:`HardExcludeError` with a non-zero-equivalent message if the
    candidate path is hard-excluded.  Callers should treat this as a fatal
    sweep error for the offending path.

    This is a belt-and-suspenders guard: ``build_candidates`` should have
    already filtered hard-excluded paths.  This guard defends against paths
    that bypass the planner (e.g. direct apply calls or future code paths).
    """
    assert_not_hard_excluded(candidate.path, action=f"apply({candidate.action.value})")


__all__ = [
    "Candidate",
    "PlanError",
    "apply_guard",
    "build_candidates",
]
