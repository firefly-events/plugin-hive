"""Hard-exclusion matcher for artifact lifecycle.

Forever-retained roots (never evict/retire/report-for-removal):
  - ~/.claude/hive/memories/**
  - .pHive/team-memories/**
  - ~/.claude/hive/kg.sqlite  (or $HIVE_KG_SQLITE_PATH)
  - ChromaDB collection / index data directories

Evictable Chroma sidecars: chromadb.pid, chromadb.port, chromadb.lock,
chromadb.lockdir, chromadb.log — these are NOT hard-excluded.
"""

from __future__ import annotations

import os
from pathlib import Path


# Chroma sidecar filenames that are explicitly evictable (not hard-excluded).
_CHROMA_EVICTABLE_SIDECARS: frozenset[str] = frozenset(
    {
        "chromadb.pid",
        "chromadb.port",
        "chromadb.lock",
        "chromadb.lockdir",
        "chromadb.log",
    }
)

# Chroma data sub-paths whose parents signal a collection/index directory.
_CHROMA_DATA_MARKERS: tuple[str, ...] = (
    "chroma.sqlite3",
    "data_level0.bin",
    "header.bin",
    "length.bin",
    "link_lists.bin",
)


def _home() -> Path:
    return Path.home()


def _hard_exclude_roots() -> list[Path]:
    """Return resolved forever-retention root paths (expanded, absolute)."""
    roots: list[Path] = []

    # ~/.claude/hive/memories/**  → root is ~/.claude/hive/memories
    roots.append((_home() / ".claude" / "hive" / "memories").resolve())

    # ~/.claude/hive/kg.sqlite  (or $HIVE_KG_SQLITE_PATH)
    kg_env = os.environ.get("HIVE_KG_SQLITE_PATH", "")
    if kg_env:
        roots.append(Path(kg_env).expanduser().resolve())
    else:
        roots.append((_home() / ".claude" / "hive" / "kg.sqlite").resolve())

    return roots


def _relative_hard_exclude_prefixes() -> list[str]:
    """Return repo-relative prefix strings for boundary-safe matching."""
    return [
        ".pHive/team-memories",
    ]


def _relative_prefix_matches(candidate: Path, prefix: str) -> bool:
    """Return True if *candidate* lies at or under repo-relative *prefix*.

    Matches the prefix as a contiguous run of path components anywhere in
    *candidate* (so absolute paths still match when the lifecycle runs outside
    the repo root — the old ``relative_to(Path.cwd())`` form silently missed
    those), and as a leading run for already-relative candidates. Component-wise
    so it stays boundary-safe (``.pHive/team-memories`` never matches a sibling
    like ``.pHive/team-memories-archive``).
    """
    pref_parts = tuple(Path(prefix).parts)
    cand_parts = candidate.parts
    n = len(pref_parts)
    if n == 0:
        return False
    for i in range(len(cand_parts) - n + 1):
        if cand_parts[i : i + n] == pref_parts:
            return True
    return False


class HardExcludeError(RuntimeError):
    """Raised when apply mode attempts to act on a hard-excluded path."""


def is_hard_excluded(candidate: Path) -> bool:
    """Return True if *candidate* falls under any forever-retention root.

    Handles:
      - Absolute roots (memories dir, KG sqlite, env-override KG path)
      - Repo-relative prefixes (.pHive/team-memories/**)
      - ChromaDB collection/index data directories
      - Evictable Chroma sidecars are explicitly NOT hard-excluded
    """
    candidate = candidate.resolve() if candidate.is_absolute() else candidate

    # Evictable Chroma sidecars pass through immediately.
    if candidate.name in _CHROMA_EVICTABLE_SIDECARS:
        return False

    # ChromaDB collection/index data: any directory whose parent or self
    # contains chroma data markers is a collection/index root.
    if _is_chroma_data_path(candidate):
        return True

    # Absolute forever roots.
    for root in _hard_exclude_roots():
        try:
            candidate.relative_to(root)
            return True
        except ValueError:
            pass
        # Exact file match (e.g. kg.sqlite itself).
        if candidate == root:
            return True

    # Repo-relative prefix matching (candidate may be relative or absolute,
    # and the lifecycle may run from outside the repo root).
    for prefix in _relative_hard_exclude_prefixes():
        if _relative_prefix_matches(candidate, prefix):
            return True

    return False


def _is_chroma_data_path(candidate: Path) -> bool:
    """Return True if candidate is inside a ChromaDB collection/index data dir.

    A directory is treated as a Chroma data root if it or any ancestor
    contains at least one Chroma data marker file.  Evictable sidecars
    in the *same* directory are NOT treated as markers for this check.
    """
    if candidate.name in _CHROMA_EVICTABLE_SIDECARS:
        return False

    # Walk up to find a chroma data dir.
    check: Path | None = candidate if candidate.is_dir() else candidate.parent
    while check is not None and check != check.parent:
        for marker in _CHROMA_DATA_MARKERS:
            if (check / marker).exists():
                return True
        check = check.parent
    return False


def assert_not_hard_excluded(candidate: Path, action: str = "action") -> None:
    """Raise :class:`HardExcludeError` if *candidate* is hard-excluded.

    Used by apply-mode guards to enforce the forever-retention contract.
    The error message names the excluded root so the caller can surface it.
    """
    candidate_resolved = candidate.resolve() if candidate.is_absolute() else candidate

    # Find the matching root to report it.
    for root in _hard_exclude_roots():
        try:
            candidate_resolved.relative_to(root)
            raise HardExcludeError(
                f"Refusing {action}: path {candidate} is under hard-excluded root {root}"
            )
        except ValueError:
            pass
        if candidate_resolved == root:
            raise HardExcludeError(
                f"Refusing {action}: path {candidate} is hard-excluded root {root}"
            )

    for prefix in _relative_hard_exclude_prefixes():
        if _relative_prefix_matches(candidate_resolved, prefix):
            raise HardExcludeError(
                f"Refusing {action}: path {candidate} is under hard-excluded root {prefix!r}"
            )

    if _is_chroma_data_path(candidate):
        raise HardExcludeError(
            f"Refusing {action}: path {candidate} is inside a ChromaDB collection/index data directory"
        )


__all__ = [
    "HardExcludeError",
    "assert_not_hard_excluded",
    "is_hard_excluded",
]
