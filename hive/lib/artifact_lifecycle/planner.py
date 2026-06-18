"""Artifact lifecycle planner — builds candidate lists from registry entries.

Hard exclusions are applied before any candidate is created, so forever-retained
paths can never appear in a plan (D1 design decision).

Also provides plan_candidates() which performs a full state-dir scan:
glob expansion + active-predicate checking + mtime age gating.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence

from hive.lib.artifact_lifecycle.exclusions import (
    HardExcludeError,
    assert_not_hard_excluded,
    is_hard_excluded,
)
from hive.lib.artifact_lifecycle.predicates import PredicateError, is_active
from hive.lib.artifact_lifecycle.registry import ArchiveAction, RegistryEntry


@dataclass(frozen=True)
class Candidate:
    """A single artifact path proposed for lifecycle action."""

    path: Path
    class_id: str
    action: ArchiveAction


@dataclass(frozen=True)
class EvictCandidate:
    """A single path scheduled for eviction (full-scan variant)."""

    path: Path
    class_id: str
    age_days: float


class PlanError(RuntimeError):
    """Raised when planning fails for a non-exclusion reason."""


# Alias for new callers
PlannerError = PlanError


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


def plan_candidates(
    entries: Sequence[RegistryEntry],
    state_dir: Path,
    now: datetime | None = None,
) -> list[EvictCandidate]:
    """Return eviction candidates from *entries* scanned under *state_dir*.

    Performs glob expansion, active-predicate evaluation, and mtime age gating.
    Only EVICT-action entries that are not hard-excluded are evaluated.

    Args:
        entries:   Validated registry entries (from ``load_registry``).
        state_dir: Root of the .pHive state directory (or its resolved
                   equivalent).  Globs are expanded relative to this path.
        now:       Reference timestamp for age calculations.  Defaults to
                   ``datetime.now(timezone.utc)``.  Pass an explicit value in
                   tests to keep assertions deterministic.

    Returns:
        A list of :class:`EvictCandidate` objects, one per eligible path.
        Order is not guaranteed.
    """
    if now is None:
        now = datetime.now(timezone.utc)

    candidates: list[EvictCandidate] = []

    for entry in entries:
        if entry.hard_exclude:
            continue
        if entry.archive_action is not ArchiveAction.EVICT:
            continue

        for glob_pattern in entry.globs:
            matched = _expand_glob(state_dir, glob_pattern)
            for path in matched:
                if is_hard_excluded(path):
                    continue
                try:
                    age_days = _age_days(path, now)
                except OSError:
                    continue  # path disappeared between glob and stat

                if age_days < entry.retention_threshold:
                    continue

                try:
                    active = is_active(entry.active_predicate, path)
                except PredicateError as exc:
                    raise PlanError(
                        f"Unknown predicate for class {entry.class_id!r}: {exc}"
                    ) from exc

                if active:
                    continue

                candidates.append(
                    EvictCandidate(
                        path=path,
                        class_id=entry.class_id,
                        age_days=age_days,
                    )
                )

    return candidates


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _expand_glob(root: Path, pattern: str) -> list[Path]:
    if not root.is_dir():
        return []
    try:
        return list(root.glob(pattern))
    except Exception:
        return []


def _age_days(path: Path, now: datetime) -> float:
    mtime = path.stat().st_mtime
    mtime_dt = datetime.fromtimestamp(mtime, tz=timezone.utc)
    delta = now - mtime_dt
    return delta.total_seconds() / 86400.0


__all__ = [
    "Candidate",
    "EvictCandidate",
    "PlanError",
    "PlannerError",
    "apply_guard",
    "build_candidates",
    "plan_candidates",
]
