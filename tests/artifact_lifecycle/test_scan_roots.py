"""Tests for scan-root resolution (al-7).

Covers:
  - Default scan: resolved state_dir only.
  - Compat scan: legacy .pHive included when repo_root given and dir exists.
  - Compat scan: legacy .pHive skipped when repo_root is None.
  - Compat scan: legacy .pHive skipped when .pHive dir doesn't exist.
  - Compat scan: primary==legacy → no duplicate legacy root.
  - Duplicate detection: same artifact in both roots → "duplicate" diagnostic,
    at most one action planned.
  - Skipped classes: hard_exclude=True → "skipped" diagnostic.
  - Hard-exclude (al-2): excluded paths never appear as duplicates or actions.
  - plan_candidates_with_compat: default (no compat) uses only state_dir.
  - plan_candidates_with_compat: compat mode merges and deduplicates.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence

import pytest

from hive.lib.artifact_lifecycle.planner import (
    CompatPlanResult,
    EvictCandidate,
    plan_candidates_with_compat,
)
from hive.lib.artifact_lifecycle.registry import (
    AgeSource,
    ArchiveAction,
    Classification,
    RegistryEntry,
)
from hive.lib.artifact_lifecycle.scan_roots import (
    ScanDiagnostic,
    ScanRoot,
    ScanRootResult,
    find_duplicates,
    resolve_scan_roots,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _evict_entry(class_id: str = "dag-run-state", hard_exclude: bool = False) -> RegistryEntry:
    return RegistryEntry(
        class_id=class_id,
        globs=("runs/**",),
        classification=Classification.UNTRACKED,
        active_predicate="never-active",
        retention_threshold=30,
        archive_action=ArchiveAction.EVICT,
        age_source=AgeSource.MTIME,
        hard_exclude=hard_exclude,
    )


def _make_old_file(path: Path, age_days: float = 40.0) -> None:
    """Create file and set mtime to `age_days` days ago."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch()
    mtime = time.time() - age_days * 86400
    import os
    os.utime(path, (mtime, mtime))


_NOW = datetime(2026, 6, 18, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# resolve_scan_roots — default (no compat)
# ---------------------------------------------------------------------------


class TestResolveDefaultOnly:
    def test_primary_is_state_dir(self, tmp_path):
        state_dir = tmp_path / "state"
        state_dir.mkdir()
        result = resolve_scan_roots(state_dir=state_dir)
        assert result.primary.path == state_dir.resolve()
        assert result.primary.is_legacy is False

    def test_no_legacy_by_default(self, tmp_path):
        state_dir = tmp_path / "state"
        state_dir.mkdir()
        result = resolve_scan_roots(state_dir=state_dir)
        assert result.legacy is None

    def test_no_diagnostics_by_default(self, tmp_path):
        state_dir = tmp_path / "state"
        state_dir.mkdir()
        result = resolve_scan_roots(state_dir=state_dir)
        assert result.diagnostics == []


# ---------------------------------------------------------------------------
# resolve_scan_roots — compat mode
# ---------------------------------------------------------------------------


class TestResolveCompat:
    def test_legacy_included_when_phive_exists(self, tmp_path):
        state_dir = tmp_path / "xdg_state"
        state_dir.mkdir()
        repo_root = tmp_path / "repo"
        legacy = repo_root / ".pHive"
        legacy.mkdir(parents=True)
        result = resolve_scan_roots(state_dir=state_dir, repo_root=repo_root, compat=True)
        assert result.legacy is not None
        assert result.legacy.path == legacy.resolve()
        assert result.legacy.is_legacy is True

    def test_no_legacy_when_repo_root_none(self, tmp_path):
        state_dir = tmp_path / "state"
        state_dir.mkdir()
        result = resolve_scan_roots(state_dir=state_dir, repo_root=None, compat=True)
        assert result.legacy is None

    def test_no_legacy_when_phive_missing(self, tmp_path):
        state_dir = tmp_path / "state"
        state_dir.mkdir()
        repo_root = tmp_path / "repo"
        repo_root.mkdir()
        # .pHive does NOT exist
        result = resolve_scan_roots(state_dir=state_dir, repo_root=repo_root, compat=True)
        assert result.legacy is None

    def test_no_legacy_when_primary_equals_legacy(self, tmp_path):
        # state_dir IS .pHive — no separate legacy scan needed.
        repo_root = tmp_path / "repo"
        phive = repo_root / ".pHive"
        phive.mkdir(parents=True)
        result = resolve_scan_roots(state_dir=phive, repo_root=repo_root, compat=True)
        assert result.legacy is None

    def test_skipped_diagnostic_for_hard_exclude_entry(self, tmp_path):
        state_dir = tmp_path / "state"
        state_dir.mkdir()
        repo_root = tmp_path / "repo"
        (repo_root / ".pHive").mkdir(parents=True)
        excluded_entry = _evict_entry(class_id="forever-class", hard_exclude=True)
        result = resolve_scan_roots(
            state_dir=state_dir,
            repo_root=repo_root,
            compat=True,
            entries=[excluded_entry],
        )
        skipped = [d for d in result.diagnostics if d.kind == "skipped"]
        assert any(d.class_id == "forever-class" for d in skipped)

    def test_safe_entry_no_skipped_diagnostic(self, tmp_path):
        state_dir = tmp_path / "state"
        state_dir.mkdir()
        repo_root = tmp_path / "repo"
        (repo_root / ".pHive").mkdir(parents=True)
        safe_entry = _evict_entry(class_id="dag-run-state", hard_exclude=False)
        result = resolve_scan_roots(
            state_dir=state_dir,
            repo_root=repo_root,
            compat=True,
            entries=[safe_entry],
        )
        skipped = [d for d in result.diagnostics if d.kind == "skipped"]
        assert not any(d.class_id == "dag-run-state" for d in skipped)


# ---------------------------------------------------------------------------
# find_duplicates
# ---------------------------------------------------------------------------


class TestFindDuplicates:
    def test_no_overlap(self, tmp_path):
        primary = [tmp_path / "state" / "a.json"]
        legacy = [tmp_path / ".pHive" / "b.json"]
        for p in primary + legacy:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.touch()
        keep, diags = find_duplicates(primary, legacy)
        assert len(keep) == 2
        assert diags == []

    def test_duplicate_emits_diagnostic_primary_wins(self, tmp_path):
        shared = tmp_path / "state" / "run.json"
        shared.parent.mkdir(parents=True)
        shared.touch()
        # Legacy symlink resolves to same inode.
        legacy_dir = tmp_path / ".pHive"
        legacy_dir.mkdir()
        legacy_copy = legacy_dir / "run.json"
        # Use the same real path to trigger duplicate detection.
        primary = [shared]
        legacy = [shared]  # same path → same resolved path
        keep, diags = find_duplicates(primary, legacy)
        assert any(d.kind == "duplicate" for d in diags)
        # At most one action: only the primary copy kept.
        assert len([p for p in keep if p.resolve() == shared.resolve()]) == 1

    def test_hard_excluded_paths_ignored(self, tmp_path):
        team_mem = Path(".pHive/team-memories/notes.md")
        primary = [tmp_path / "ok.json"]
        legacy = [team_mem]
        (primary[0]).parent.mkdir(parents=True, exist_ok=True)
        (primary[0]).touch()
        keep, diags = find_duplicates(primary, legacy)
        # team-memories excluded; not counted as duplicate or kept
        assert all(p != team_mem for p in keep)
        assert not any(d.kind == "duplicate" for d in diags)


# ---------------------------------------------------------------------------
# plan_candidates_with_compat — default (no compat)
# ---------------------------------------------------------------------------


class TestPlanCandidatesDefault:
    def test_uses_state_dir_only(self, tmp_path):
        state_dir = tmp_path / "state"
        runs_dir = state_dir / "runs" / "run-1"
        _make_old_file(runs_dir / "state.json")

        # Stale file also in a "legacy" dir that should NOT be scanned.
        legacy = tmp_path / "repo" / ".pHive"
        _make_old_file(legacy / "runs" / "run-2" / "state.json")

        entry = _evict_entry()
        result = plan_candidates_with_compat(
            entries=[entry],
            state_dir=state_dir,
            repo_root=tmp_path / "repo",
            compat=False,
            now=_NOW,
        )
        # Only state_dir run should appear.
        paths = [c.path for c in result.candidates]
        assert any("run-1" in str(p) for p in paths)
        assert not any("run-2" in str(p) for p in paths)

    def test_no_diagnostics_without_compat(self, tmp_path):
        state_dir = tmp_path / "state"
        state_dir.mkdir()
        result = plan_candidates_with_compat(
            entries=[_evict_entry()],
            state_dir=state_dir,
            compat=False,
            now=_NOW,
        )
        assert result.diagnostics == []


# ---------------------------------------------------------------------------
# plan_candidates_with_compat — compat mode
# ---------------------------------------------------------------------------


class TestPlanCandidatesCompat:
    def test_compat_includes_legacy_artifacts(self, tmp_path):
        state_dir = tmp_path / "state"
        repo_root = tmp_path / "repo"
        legacy_phive = repo_root / ".pHive"

        # Artifact only in legacy root.
        _make_old_file(legacy_phive / "runs" / "run-legacy" / "state.json")
        state_dir.mkdir(parents=True, exist_ok=True)

        entry = _evict_entry()
        result = plan_candidates_with_compat(
            entries=[entry],
            state_dir=state_dir,
            repo_root=repo_root,
            compat=True,
            now=_NOW,
        )
        paths = [c.path for c in result.candidates]
        assert any("run-legacy" in str(p) for p in paths)

    def test_compat_duplicate_planned_once(self, tmp_path):
        state_dir = tmp_path / "state"
        repo_root = tmp_path / "repo"
        legacy_phive = repo_root / ".pHive"

        # Legacy symlink → same real file as primary; should be planned exactly once.
        artifact = state_dir / "runs" / "run-shared" / "state.json"
        _make_old_file(artifact)
        legacy_run_dir = legacy_phive / "runs" / "run-shared"
        legacy_run_dir.mkdir(parents=True)
        (legacy_run_dir / "state.json").symlink_to(artifact)

        entry = _evict_entry()
        result = plan_candidates_with_compat(
            entries=[entry],
            state_dir=state_dir,
            repo_root=repo_root,
            compat=True,
            now=_NOW,
        )
        # Resolved to same inode → deduped; exactly one candidate.
        resolved_paths = [c.path.resolve() for c in result.candidates]
        assert resolved_paths.count(artifact.resolve()) == 1

    def test_compat_duplicate_emits_diagnostic(self, tmp_path):
        state_dir = tmp_path / "state"
        repo_root = tmp_path / "repo"
        legacy_phive = repo_root / ".pHive"

        # Same artifact exists in both scan roots (symlink forces same inode).
        artifact = state_dir / "runs" / "run-x" / "state.json"
        _make_old_file(artifact)
        legacy_link_parent = legacy_phive / "runs" / "run-x"
        legacy_link_parent.mkdir(parents=True)
        # Point legacy to same real file.
        (legacy_link_parent / "state.json").symlink_to(artifact)

        entry = _evict_entry()
        result = plan_candidates_with_compat(
            entries=[entry],
            state_dir=state_dir,
            repo_root=repo_root,
            compat=True,
            now=_NOW,
        )
        dup_diags = [d for d in result.diagnostics if d.kind == "duplicate"]
        assert len(dup_diags) >= 1

    def test_compat_skipped_class_in_diagnostics(self, tmp_path):
        state_dir = tmp_path / "state"
        state_dir.mkdir()
        repo_root = tmp_path / "repo"
        (repo_root / ".pHive").mkdir(parents=True)

        excluded_entry = _evict_entry(class_id="forever-memories", hard_exclude=True)
        result = plan_candidates_with_compat(
            entries=[excluded_entry],
            state_dir=state_dir,
            repo_root=repo_root,
            compat=True,
            now=_NOW,
        )
        skipped = [d for d in result.diagnostics if d.kind == "skipped"]
        assert any(d.class_id == "forever-memories" for d in skipped)

    def test_hard_exclude_wins_before_duplicate_logic(self, tmp_path):
        state_dir = tmp_path / "state"
        repo_root = tmp_path / "repo"
        (repo_root / ".pHive").mkdir(parents=True)
        state_dir.mkdir(parents=True)

        # team-memories path — should never become a candidate.
        team_mem_primary = state_dir / ".." / ".pHive" / "team-memories" / "n.md"
        team_mem_legacy = repo_root / ".pHive" / "team-memories" / "n.md"

        entry = _evict_entry()
        result = plan_candidates_with_compat(
            entries=[entry],
            state_dir=state_dir,
            repo_root=repo_root,
            compat=True,
            now=_NOW,
        )
        paths_str = [str(c.path) for c in result.candidates]
        assert not any("team-memories" in p for p in paths_str)
