"""Per-class artifact lifecycle registry: schema, enums, and validation.

Design decisions consumed here:
  D1 — untracked sweep only this epic; tracked classes are report-only.
  D2 — tracked classes (episodes, audits, metrics): action = report.
  D4 — archive_action vocab: evict | retire | report.
  D5 — age_source: mtime (untracked) | git-last-commit (tracked).
  retire is deferred — rejected as a sweep action this epic.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Classification(str, Enum):
    UNTRACKED = "untracked"
    TRACKED = "tracked"


class ArchiveAction(str, Enum):
    EVICT = "evict"
    RETIRE = "retire"
    REPORT = "report"


class AgeSource(str, Enum):
    MTIME = "mtime"
    GIT_LAST_COMMIT = "git-last-commit"


# retire is deferred per D1/D4; rejected as an executable sweep action this epic.
_RETIRE_DEFERRED_MSG = (
    "archive_action='retire' is deferred this epic (D1/D4). "
    "Use 'evict' for untracked or 'report' for tracked classes."
)

# Valid actions per classification, per D1/D2/D4.
_VALID_ACTIONS: dict[Classification, frozenset[ArchiveAction]] = {
    Classification.UNTRACKED: frozenset({ArchiveAction.EVICT, ArchiveAction.REPORT}),
    Classification.TRACKED: frozenset({ArchiveAction.REPORT}),
}

# Required age_source per classification, per D5.
_REQUIRED_AGE_SOURCE: dict[Classification, AgeSource] = {
    Classification.UNTRACKED: AgeSource.MTIME,
    Classification.TRACKED: AgeSource.GIT_LAST_COMMIT,
}


class RegistryValidationError(ValueError):
    pass


@dataclass(frozen=True)
class RegistryEntry:
    """Validated descriptor for one artifact class.

    Construct via :func:`validate_entry` rather than directly — the
    dataclass __init__ does NOT run cross-field validation.
    """

    class_id: str
    globs: tuple[str, ...]
    classification: Classification
    active_predicate: str
    retention_threshold: int  # days
    archive_action: ArchiveAction
    age_source: AgeSource
    hard_exclude: bool

    def __post_init__(self) -> None:
        # Basic type sanity — full semantic validation lives in validate_entry.
        if not self.class_id or not isinstance(self.class_id, str):
            raise RegistryValidationError("class_id must be a non-empty string")
        if not self.globs:
            raise RegistryValidationError("globs must be a non-empty sequence")
        if not isinstance(self.retention_threshold, int) or self.retention_threshold < 0:
            raise RegistryValidationError(
                "retention_threshold must be a non-negative integer (days)"
            )
        if not self.active_predicate or not isinstance(self.active_predicate, str):
            raise RegistryValidationError("active_predicate must be a non-empty string")


def validate_entry(raw: dict[str, Any]) -> RegistryEntry:
    """Parse and validate a raw registry dict into a :class:`RegistryEntry`.

    Raises :class:`RegistryValidationError` on any schema or semantic violation.
    """
    required = {
        "class_id",
        "globs",
        "classification",
        "active_predicate",
        "retention_threshold",
        "archive_action",
        "age_source",
        "hard_exclude",
    }
    missing = required - set(raw.keys())
    if missing:
        raise RegistryValidationError(f"Missing required fields: {sorted(missing)}")

    # archive_action — validate enum membership first before semantic checks.
    raw_action = raw["archive_action"]
    try:
        action = ArchiveAction(raw_action)
    except ValueError:
        valid = [a.value for a in ArchiveAction]
        raise RegistryValidationError(
            f"archive_action={raw_action!r} is not valid. Must be one of {valid}."
        )

    # retire is deferred this epic (D1/D4).
    if action is ArchiveAction.RETIRE:
        raise RegistryValidationError(_RETIRE_DEFERRED_MSG)

    # classification
    raw_cls = raw["classification"]
    try:
        classification = Classification(raw_cls)
    except ValueError:
        valid_cls = [c.value for c in Classification]
        raise RegistryValidationError(
            f"classification={raw_cls!r} is not valid. Must be one of {valid_cls}."
        )

    # age_source
    raw_age = raw["age_source"]
    try:
        age_source = AgeSource(raw_age)
    except ValueError:
        valid_age = [a.value for a in AgeSource]
        raise RegistryValidationError(
            f"age_source={raw_age!r} is not valid. Must be one of {valid_age}."
        )

    # D5 — age_source must match classification.
    required_age = _REQUIRED_AGE_SOURCE[classification]
    if age_source is not required_age:
        raise RegistryValidationError(
            f"classification={classification.value!r} requires "
            f"age_source={required_age.value!r}, got {age_source.value!r} (D5)."
        )

    # D1/D2 — action must be valid for classification.
    allowed = _VALID_ACTIONS[classification]
    if action not in allowed:
        allowed_names = sorted(a.value for a in allowed)
        raise RegistryValidationError(
            f"classification={classification.value!r} only allows "
            f"archive_action in {allowed_names}, got {action.value!r} (D1/D2)."
        )

    # globs
    raw_globs = raw["globs"]
    if not isinstance(raw_globs, (list, tuple)) or not raw_globs:
        raise RegistryValidationError("globs must be a non-empty list of strings")
    if not all(isinstance(g, str) and g for g in raw_globs):
        raise RegistryValidationError("every glob must be a non-empty string")

    # retention_threshold
    raw_threshold = raw["retention_threshold"]
    if not isinstance(raw_threshold, int) or isinstance(raw_threshold, bool):
        raise RegistryValidationError("retention_threshold must be an integer (days)")

    # hard_exclude — strict bool; reject truthy strings like "false".
    raw_hard_exclude = raw["hard_exclude"]
    if not isinstance(raw_hard_exclude, bool):
        raise RegistryValidationError("hard_exclude must be a boolean")

    return RegistryEntry(
        class_id=raw["class_id"],
        globs=tuple(raw_globs),
        classification=classification,
        active_predicate=raw["active_predicate"],
        retention_threshold=raw_threshold,
        archive_action=action,
        age_source=age_source,
        hard_exclude=raw_hard_exclude,
    )


def load_registry(entries: list[dict[str, Any]]) -> list[RegistryEntry]:
    """Validate and return a list of :class:`RegistryEntry` from raw dicts.

    Raises :class:`RegistryValidationError` on the first invalid entry.
    """
    result: list[RegistryEntry] = []
    seen_ids: set[str] = set()
    for i, raw in enumerate(entries):
        entry = validate_entry(raw)
        if entry.class_id in seen_ids:
            raise RegistryValidationError(
                f"Duplicate class_id {entry.class_id!r} at index {i}."
            )
        seen_ids.add(entry.class_id)
        result.append(entry)
    return result


# ---------------------------------------------------------------------------
# Tracked class definitions (D2): audits, episodes, metrics — report-only.
# These classes are walked by live consumers and must never be git-rm'd this
# epic; the sweep reports them only.
# Globs are relative to the .pHive state root (same convention as cli.py).
# Retention thresholds per design-decisions §open-question-rulings:
#   90d — audits (gate-mode aggregation), episodes (story-status derivation)
#   60d — metrics (cross-run aggregation)
# ---------------------------------------------------------------------------

TRACKED_CLASSES_RAW: list[dict] = [
    {
        "class_id": "audit-record",
        "globs": ["audits/**"],
        "classification": "tracked",
        "active_predicate": "never-active",
        "retention_threshold": 90,
        "archive_action": "report",
        "age_source": "git-last-commit",
        "hard_exclude": False,
    },
    {
        "class_id": "episode-marker",
        "globs": ["episodes/**"],
        "classification": "tracked",
        "active_predicate": "never-active",
        "retention_threshold": 90,
        "archive_action": "report",
        "age_source": "git-last-commit",
        "hard_exclude": False,
    },
    {
        "class_id": "metrics-record",
        "globs": ["metrics/**"],
        "classification": "tracked",
        "active_predicate": "never-active",
        "retention_threshold": 60,
        "archive_action": "report",
        "age_source": "git-last-commit",
        "hard_exclude": False,
    },
]


def load_tracked_classes() -> list[RegistryEntry]:
    """Return validated registry entries for the three tracked report-only classes.

    These classes (.pHive/audits/**, .pHive/episodes/**, .pHive/metrics/**)
    are scanned by live consumers and are never git-rm'd this epic (D2).
    """
    return load_registry(TRACKED_CLASSES_RAW)


__all__ = [
    "AgeSource",
    "ArchiveAction",
    "Classification",
    "RegistryEntry",
    "RegistryValidationError",
    "TRACKED_CLASSES_RAW",
    "load_registry",
    "load_tracked_classes",
    "validate_entry",
]
