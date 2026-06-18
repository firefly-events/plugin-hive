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

    plan_candidates(entries, state_dir, now?) -> list[EvictCandidate]
    EvictCandidate

    dry_run(candidates) -> list[EvictRecord]
    apply_evict(candidates, tmp_root?) -> list[EvictRecord]
    EvictRecord

    is_active(predicate_name, path) -> bool
    resolve_predicate(name) -> Callable
    PredicateError
"""

from __future__ import annotations

from hive.lib.artifact_lifecycle.exclusions import (
    HardExcludeError,
    assert_not_hard_excluded,
    is_hard_excluded,
)
from hive.lib.artifact_lifecycle.executor import EvictRecord, ExecutorError, apply_evict
from hive.lib.artifact_lifecycle.executor import dry_run
from hive.lib.artifact_lifecycle.planner import (
    Candidate,
    EvictCandidate,
    PlanError,
    PlannerError,
    apply_guard,
    build_candidates,
    plan_candidates,
)
from hive.lib.artifact_lifecycle.predicates import PredicateError, is_active, resolve_predicate
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
    "EvictCandidate",
    "EvictRecord",
    "ExecutorError",
    "HardExcludeError",
    "PlanError",
    "PlannerError",
    "PredicateError",
    "RegistryEntry",
    "RegistryValidationError",
    "apply_evict",
    "apply_guard",
    "assert_not_hard_excluded",
    "build_candidates",
    "dry_run",
    "is_active",
    "is_hard_excluded",
    "load_registry",
    "plan_candidates",
    "resolve_predicate",
    "validate_entry",
]
