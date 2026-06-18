"""Artifact lifecycle library — Python-first implementation (D46 ADR Option B).

Public surface for skills, tests, and later stories:

    validate_entry(raw: dict) -> RegistryEntry
    load_registry(entries: list[dict]) -> list[RegistryEntry]
    RegistryEntry
    Classification, ArchiveAction, AgeSource
    RegistryValidationError
    is_hard_excluded(path: Path) -> bool
    assert_not_hard_excluded(path: Path, action: str) -> None
    HardExcludeError
    build_candidates(entry, paths) -> list[Candidate]
    apply_guard(candidate) -> None
    Candidate
"""

from __future__ import annotations

from hive.lib.artifact_lifecycle.exclusions import (
    HardExcludeError,
    assert_not_hard_excluded,
    is_hard_excluded,
)
from hive.lib.artifact_lifecycle.planner import (
    Candidate,
    PlanError,
    apply_guard,
    build_candidates,
)
from hive.lib.artifact_lifecycle.registry import (
    AgeSource,
    ArchiveAction,
    Classification,
    RegistryEntry,
    RegistryValidationError,
    load_registry,
    validate_entry,
)

__all__ = [
    "AgeSource",
    "ArchiveAction",
    "Candidate",
    "Classification",
    "HardExcludeError",
    "PlanError",
    "RegistryEntry",
    "RegistryValidationError",
    "apply_guard",
    "assert_not_hard_excluded",
    "build_candidates",
    "is_hard_excluded",
    "load_registry",
    "validate_entry",
]
