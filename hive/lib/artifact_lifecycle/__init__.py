"""Artifact lifecycle library — Python-first implementation (D46 ADR Option B).

Public surface for skills, tests, and later stories:

    validate_entry(raw: dict) -> RegistryEntry
    load_registry(entries: list[dict]) -> list[RegistryEntry]
    RegistryEntry
    Classification, ArchiveAction, AgeSource
    RegistryValidationError
"""

from __future__ import annotations

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
    "Classification",
    "RegistryEntry",
    "RegistryValidationError",
    "load_registry",
    "validate_entry",
]
