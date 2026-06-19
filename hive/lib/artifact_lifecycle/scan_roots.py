"""Scan-root resolution for artifact lifecycle (al-7).

Default scan root: resolved ``paths.state_dir``.
Compatibility mode: also scans legacy repo-relative ``.pHive`` and emits
diagnostics for duplicates and unsupported/unsafe class IDs.

Design decisions consumed:
  D7 (al-7) — default = resolved state_dir; compat scan = legacy .pHive;
               duplicates marked, one action planned at most; unsafe classes
               skipped with class_id + reason; al-2 exclusions win first.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

from hive.lib.artifact_lifecycle.exclusions import is_hard_excluded
from hive.lib.artifact_lifecycle.registry import RegistryEntry


# ---------------------------------------------------------------------------
# Public data classes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ScanRoot:
    """A resolved directory root for a lifecycle scan pass."""

    path: Path
    is_legacy: bool = False


@dataclass
class ScanDiagnostic:
    """Diagnostic record produced during compatibility scanning."""

    class_id: str
    # "duplicate" | "skipped"
    kind: str
    reason: str
    # Populated for duplicate entries (path visible in both roots)
    path: Path | None = None


@dataclass
class ScanRootResult:
    """Outcome of resolve_scan_roots()."""

    primary: ScanRoot
    legacy: ScanRoot | None
    diagnostics: list[ScanDiagnostic] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Class-safety contract for legacy .pHive scanning
# ---------------------------------------------------------------------------

# Classes declared unsafe for legacy .pHive scanning.
# Add class IDs here when a class writes to the legacy root in a way that
# would corrupt state or produce false positives on a dual-root scan.
_LEGACY_UNSAFE_CLASS_IDS: frozenset[str] = frozenset()

# Reason template for unsafe classes.
_UNSAFE_REASON = "class unsafe for legacy .pHive scanning"


def _is_legacy_safe(entry: RegistryEntry) -> tuple[bool, str]:
    """Return (safe, reason).  reason is empty when safe."""
    if entry.class_id in _LEGACY_UNSAFE_CLASS_IDS:
        return False, _UNSAFE_REASON
    # hard_exclude entries carry no globs worth scanning in legacy root.
    if entry.hard_exclude:
        return False, "class is hard-excluded; no legacy scan needed"
    return True, ""


# ---------------------------------------------------------------------------
# Core resolution
# ---------------------------------------------------------------------------


def resolve_scan_roots(
    state_dir: Path,
    repo_root: Path | None = None,
    compat: bool = False,
    entries: Sequence[RegistryEntry] | None = None,
) -> ScanRootResult:
    """Resolve scan roots for a lifecycle planning pass.

    Args:
        state_dir:  Resolved ``paths.state_dir`` (absolute).  Always becomes
                    the primary scan root.
        repo_root:  Repository root, used to locate the legacy ``.pHive``
                    directory when ``compat=True``.  When *None* and
                    ``compat=True``, legacy scanning is silently skipped.
        compat:     Enable compatibility scanning of legacy ``.pHive``.
        entries:    Registry entries used to detect skipped classes when
                    ``compat=True``.  Pass ``None`` to skip that diagnostic.

    Returns:
        :class:`ScanRootResult` with primary root, optional legacy root, and
        any diagnostics.
    """
    primary = ScanRoot(path=state_dir.resolve(), is_legacy=False)
    result = ScanRootResult(primary=primary, legacy=None)

    if not compat or repo_root is None:
        return result

    legacy_path = (repo_root / ".pHive").resolve()
    if not legacy_path.is_dir():
        return result

    # If legacy is the same directory as primary, no separate legacy scan.
    if legacy_path == primary.path:
        return result

    legacy = ScanRoot(path=legacy_path, is_legacy=True)
    result.legacy = legacy

    if entries:
        for entry in entries:
            safe, reason = _is_legacy_safe(entry)
            if not safe:
                result.diagnostics.append(
                    ScanDiagnostic(
                        class_id=entry.class_id,
                        kind="skipped",
                        reason=reason,
                    )
                )

    return result


# ---------------------------------------------------------------------------
# Duplicate detection
# ---------------------------------------------------------------------------


def find_duplicates(
    primary_paths: Sequence[Path],
    legacy_paths: Sequence[Path],
) -> tuple[list[Path], list[ScanDiagnostic]]:
    """Identify paths visible in both roots and emit duplicate diagnostics.

    Hard-excluded paths are never treated as duplicates — exclusions win first.

    Args:
        primary_paths:  Paths found under the primary (resolved state_dir) root.
        legacy_paths:   Paths found under the legacy ``.pHive`` root.

    Returns:
        A tuple of:
          - deduplicated list of paths to plan (primary wins; legacy paths that
            duplicate a primary path are dropped).
          - list of :class:`ScanDiagnostic` with kind="duplicate" for each
            dropped legacy path.
    """
    primary_set: set[Path] = set()
    for p in primary_paths:
        if not is_hard_excluded(p):
            primary_set.add(p.resolve())

    keep: list[Path] = [p for p in primary_paths if not is_hard_excluded(p)]
    diagnostics: list[ScanDiagnostic] = []

    for lp in legacy_paths:
        if is_hard_excluded(lp):
            continue
        resolved = lp.resolve()
        if resolved in primary_set:
            diagnostics.append(
                ScanDiagnostic(
                    class_id="",  # caller can fill if needed
                    kind="duplicate",
                    reason="artifact visible in both resolved state_dir and legacy .pHive",
                    path=lp,
                )
            )
        else:
            keep.append(lp)
            primary_set.add(resolved)

    return keep, diagnostics


__all__ = [
    "ScanDiagnostic",
    "ScanRoot",
    "ScanRootResult",
    "find_duplicates",
    "resolve_scan_roots",
]
