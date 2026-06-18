"""Artifact lifecycle planner — builds candidate lists from registry entries.

Hard exclusions are applied before any candidate is created, so forever-retained
paths can never appear in a plan (D1 design decision).

Also provides plan_candidates() which performs a full state-dir scan:
glob expansion + active-predicate checking + mtime age gating.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence

from hive.lib.artifact_lifecycle.age import git_commit_age_days, mtime_age_days
from hive.lib.artifact_lifecycle.eligibility import (
    TerminalEligibility,
    check_terminal_eligibility,
)
from hive.lib.artifact_lifecycle.exclusions import (
    HardExcludeError,
    assert_not_hard_excluded,
    is_hard_excluded,
)
from hive.lib.artifact_lifecycle.predicates import PredicateError, is_active
from hive.lib.artifact_lifecycle.registry import ArchiveAction, Classification, RegistryEntry
from hive.lib.artifact_lifecycle.scan_roots import (
    ScanDiagnostic,
    find_duplicates,
    resolve_scan_roots,
)


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


@dataclass(frozen=True)
class CompatPlanResult:
    """Result of plan_candidates_with_compat()."""

    candidates: list[EvictCandidate]
    diagnostics: list[ScanDiagnostic]


def plan_candidates_with_compat(
    entries: Sequence[RegistryEntry],
    state_dir: Path,
    repo_root: Path | None = None,
    compat: bool = False,
    now: datetime | None = None,
) -> CompatPlanResult:
    """plan_candidates extended with scan-root resolution and compat diagnostics.

    When ``compat=True`` and ``repo_root`` is given, also scans legacy
    ``.pHive`` for EVICT-action entries that are safe for legacy scanning.
    Emits:
      - ``duplicate`` diagnostics for artifacts found in both roots (primary
        wins; at most one action is planned).
      - ``skipped`` diagnostics for classes that are unsafe/unsupported for
        legacy scanning.

    Hard-exclusions from al-2 win before any duplicate or action logic.

    Args:
        entries:   Registry entries.
        state_dir: Resolved ``paths.state_dir`` (primary scan root).
        repo_root: Repository root for locating legacy ``.pHive``.
        compat:    Enable compatibility scanning.
        now:       Reference timestamp; defaults to ``datetime.now(timezone.utc)``.

    Returns:
        :class:`CompatPlanResult` with deduplicated candidates and all diagnostics.
    """
    if now is None:
        now = datetime.now(timezone.utc)

    scan_result = resolve_scan_roots(
        state_dir=state_dir,
        repo_root=repo_root,
        compat=compat,
        entries=entries,
    )

    # Collect skipped-class diagnostics from scan root resolution.
    diagnostics: list[ScanDiagnostic] = list(scan_result.diagnostics)

    # Build sets of safe class IDs for legacy scanning.
    # Classes that appear in `diagnostics` as "skipped" are excluded from legacy.
    skipped_class_ids: set[str] = {
        d.class_id for d in diagnostics if d.kind == "skipped"
    }

    primary_candidates = plan_candidates(entries, scan_result.primary.path, now=now)

    if scan_result.legacy is None:
        return CompatPlanResult(candidates=primary_candidates, diagnostics=diagnostics)

    # Build legacy candidates only for safe classes.
    safe_entries = [e for e in entries if e.class_id not in skipped_class_ids]
    legacy_candidates = plan_candidates(safe_entries, scan_result.legacy.path, now=now)

    # Dedup: primary wins.
    primary_paths = [c.path for c in primary_candidates]
    legacy_paths = [c.path for c in legacy_candidates]
    merged_paths, dup_diagnostics = find_duplicates(primary_paths, legacy_paths)
    diagnostics.extend(dup_diagnostics)

    # Rebuild the candidate list preserving EvictCandidate metadata.
    # Build a lookup: resolved path → EvictCandidate (primary preferred).
    path_to_candidate: dict[Path, EvictCandidate] = {}
    for c in primary_candidates:
        if not is_hard_excluded(c.path):
            path_to_candidate[c.path.resolve()] = c
    for c in legacy_candidates:
        rp = c.path.resolve()
        if rp not in path_to_candidate and not is_hard_excluded(c.path):
            path_to_candidate[rp] = c

    final_candidates = [
        path_to_candidate[p.resolve()]
        for p in merged_paths
        if p.resolve() in path_to_candidate
    ]

    return CompatPlanResult(candidates=final_candidates, diagnostics=diagnostics)


def plan_terminal_report_candidates(
    entries: Sequence[RegistryEntry],
    state_dir: Path,
    repo_root: Path | None = None,
    default_branch: str = "main",
    now: datetime | None = None,
) -> list[Candidate]:
    """Return REPORT candidates for tracked entries that pass terminal eligibility.

    Implements D3: evaluates /ship-written and merged+age signals.  Action is
    always REPORT (D2 — tracked classes are report-only this epic).  D1/D2 are
    not overridden by a passing terminal signal.

    Args:
        entries:        Registry entries to evaluate (all classifications/actions
                        accepted; non-tracked or non-REPORT entries are skipped).
        state_dir:      Root of the .pHive state directory for glob expansion.
        repo_root:      Repository root for git merge queries.  When None the
                        legacy merged+age signal is disabled.
        default_branch: Branch that feature branches must be merged into.
        now:            Reference timestamp for age calculations.  Defaults to
                        ``datetime.now(timezone.utc)``.

    Returns:
        List of :class:`Candidate` with ``action=REPORT``, one per eligible path.
    """
    if now is None:
        now = datetime.now(timezone.utc)

    candidates: list[Candidate] = []

    for entry in entries:
        if entry.hard_exclude:
            continue
        if entry.classification is not Classification.TRACKED:
            continue
        if entry.archive_action is not ArchiveAction.REPORT:
            continue

        for glob_pattern in entry.globs:
            matched = _expand_glob(state_dir, glob_pattern)
            for path in matched:
                if is_hard_excluded(path):
                    continue

                yaml_dict = _read_yaml(path)
                feature_branch = yaml_dict.get("branch") if yaml_dict else None

                try:
                    age_days = _git_commit_age_days(path, repo_root, now)
                except OSError:
                    continue

                eligibility = check_terminal_eligibility(
                    yaml_dict=yaml_dict,
                    repo_root=repo_root,
                    feature_branch=feature_branch,
                    age_days=age_days,
                    threshold_days=entry.retention_threshold,
                    default_branch=default_branch,
                )

                if not eligibility.eligible:
                    continue

                candidates.append(
                    Candidate(
                        path=path,
                        class_id=entry.class_id,
                        action=ArchiveAction.REPORT,
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
    return mtime_age_days(path, now)


def _git_commit_age_days(path: Path, repo_root: Path | None, now: datetime) -> float:
    return git_commit_age_days(path, repo_root, now)


def _read_yaml(path: Path) -> dict | None:
    """Read and parse a YAML file, returning a dict or None on failure."""
    if not path.is_file():
        return None
    try:
        import yaml  # type: ignore

        with path.open("r", encoding="utf-8") as fh:
            payload = yaml.safe_load(fh)
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


__all__ = [
    "Candidate",
    "CompatPlanResult",
    "EvictCandidate",
    "PlanError",
    "PlannerError",
    "TerminalEligibility",
    "apply_guard",
    "build_candidates",
    "plan_candidates",
    "plan_candidates_with_compat",
    "plan_terminal_report_candidates",
]
