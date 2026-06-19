"""Tests for forever-retention hard exclusions (al-2).

Covers:
  - ~/.claude/hive/memories/** is hard-excluded
  - .pHive/team-memories/** is hard-excluded
  - ~/.claude/hive/kg.sqlite is hard-excluded
  - $HIVE_KG_SQLITE_PATH override is hard-excluded
  - ChromaDB collection/index data directories are hard-excluded
  - Chroma evictable sidecars (pid/port/lock/lockdir/log) are NOT excluded
  - apply_guard raises HardExcludeError and exits non-zero (RuntimeError)
  - Normal paths are not excluded
"""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import patch

import pytest

from hive.lib.artifact_lifecycle.exclusions import (
    HardExcludeError,
    assert_not_hard_excluded,
    is_hard_excluded,
)
from hive.lib.artifact_lifecycle.planner import (
    Candidate,
    apply_guard,
    build_candidates,
)
from hive.lib.artifact_lifecycle.registry import ArchiveAction, Classification


def _fake_home(tmp_path: Path) -> Path:
    return tmp_path / "home"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _memories_path(home: Path, *parts: str) -> Path:
    return home / ".claude" / "hive" / "memories" / Path(*parts) if parts else home / ".claude" / "hive" / "memories"


def _kg_path(home: Path) -> Path:
    return home / ".claude" / "hive" / "kg.sqlite"


# ---------------------------------------------------------------------------
# ~/.claude/hive/memories/**
# ---------------------------------------------------------------------------

class TestMemoriesExclusion:
    def test_memories_root_excluded(self, tmp_path):
        home = _fake_home(tmp_path)
        memories = _memories_path(home)
        memories.mkdir(parents=True)
        with patch("hive.lib.artifact_lifecycle.exclusions._home", return_value=home):
            assert is_hard_excluded(memories) is True

    def test_memories_subpath_excluded(self, tmp_path):
        home = _fake_home(tmp_path)
        subpath = _memories_path(home, "developer", "pattern.md")
        subpath.parent.mkdir(parents=True)
        subpath.touch()
        with patch("hive.lib.artifact_lifecycle.exclusions._home", return_value=home):
            assert is_hard_excluded(subpath) is True

    def test_memories_nested_dir_excluded(self, tmp_path):
        home = _fake_home(tmp_path)
        nested = _memories_path(home, "a", "b", "c")
        nested.mkdir(parents=True)
        with patch("hive.lib.artifact_lifecycle.exclusions._home", return_value=home):
            assert is_hard_excluded(nested) is True


# ---------------------------------------------------------------------------
# .pHive/team-memories/**
# ---------------------------------------------------------------------------

class TestTeamMemoriesExclusion:
    def test_team_memories_root_excluded(self, tmp_path):
        path = Path(".pHive/team-memories")
        assert is_hard_excluded(path) is True

    def test_team_memories_subpath_excluded(self, tmp_path):
        path = Path(".pHive/team-memories/squad-alpha/notes.md")
        assert is_hard_excluded(path) is True

    def test_team_memories_deep_excluded(self, tmp_path):
        path = Path(".pHive/team-memories/a/b/c/d.txt")
        assert is_hard_excluded(path) is True

    def test_similar_prefix_not_excluded(self):
        # .pHive/team-memoriesx should NOT match
        path = Path(".pHive/team-memoriesx/file.md")
        assert is_hard_excluded(path) is False

    def test_phive_other_dir_not_excluded(self):
        path = Path(".pHive/runs/some-run/state.json")
        assert is_hard_excluded(path) is False


# ---------------------------------------------------------------------------
# KG sqlite
# ---------------------------------------------------------------------------

class TestKGSqliteExclusion:
    def test_kg_sqlite_excluded(self, tmp_path):
        home = _fake_home(tmp_path)
        kg = _kg_path(home)
        kg.parent.mkdir(parents=True)
        kg.touch()
        with patch("hive.lib.artifact_lifecycle.exclusions._home", return_value=home):
            assert is_hard_excluded(kg) is True

    def test_kg_sqlite_env_override_excluded(self, tmp_path):
        custom_kg = tmp_path / "custom" / "kg.sqlite"
        custom_kg.parent.mkdir(parents=True)
        custom_kg.touch()
        with patch.dict(os.environ, {"HIVE_KG_SQLITE_PATH": str(custom_kg)}):
            assert is_hard_excluded(custom_kg) is True

    def test_kg_sqlite_env_override_subpath_not_excluded(self, tmp_path):
        # The env var points to a file, not a dir; a sibling file is not excluded.
        custom_kg = tmp_path / "custom" / "kg.sqlite"
        sibling = tmp_path / "custom" / "other.db"
        custom_kg.parent.mkdir(parents=True)
        custom_kg.touch()
        sibling.touch()
        with patch.dict(os.environ, {"HIVE_KG_SQLITE_PATH": str(custom_kg)}):
            assert is_hard_excluded(sibling) is False


# ---------------------------------------------------------------------------
# ChromaDB collection/index data
# ---------------------------------------------------------------------------

class TestChromaDataExclusion:
    def test_chroma_sqlite_marker_excludes_dir(self, tmp_path):
        chroma_dir = tmp_path / "chroma_store"
        chroma_dir.mkdir()
        (chroma_dir / "chroma.sqlite3").touch()
        assert is_hard_excluded(chroma_dir) is True

    def test_file_inside_chroma_dir_excluded(self, tmp_path):
        chroma_dir = tmp_path / "chroma_store"
        chroma_dir.mkdir()
        (chroma_dir / "chroma.sqlite3").touch()
        data_file = chroma_dir / "index_data" / "segment.bin"
        data_file.parent.mkdir()
        data_file.touch()
        assert is_hard_excluded(data_file) is True

    def test_hnsw_marker_excludes_dir(self, tmp_path):
        hnsw_dir = tmp_path / "hnswlib"
        hnsw_dir.mkdir()
        (hnsw_dir / "header.bin").touch()
        assert is_hard_excluded(hnsw_dir) is True

    def test_data_level0_marker_excludes_dir(self, tmp_path):
        seg_dir = tmp_path / "segment"
        seg_dir.mkdir()
        (seg_dir / "data_level0.bin").touch()
        assert is_hard_excluded(seg_dir) is True


# ---------------------------------------------------------------------------
# Chroma evictable sidecars — must NOT be hard-excluded
# ---------------------------------------------------------------------------

class TestChromaEvictableSidecars:
    @pytest.mark.parametrize("sidecar", [
        "chromadb.pid",
        "chromadb.port",
        "chromadb.lock",
        "chromadb.lockdir",
        "chromadb.log",
    ])
    def test_sidecar_not_excluded(self, tmp_path, sidecar):
        path = tmp_path / sidecar
        path.touch()
        assert is_hard_excluded(path) is False

    @pytest.mark.parametrize("sidecar", [
        "chromadb.pid",
        "chromadb.port",
        "chromadb.lock",
        "chromadb.lockdir",
        "chromadb.log",
    ])
    def test_sidecar_in_chroma_data_dir_still_not_excluded(self, tmp_path, sidecar):
        # Sidecars co-located with chroma data markers remain evictable.
        chroma_dir = tmp_path / "chroma_store"
        chroma_dir.mkdir()
        (chroma_dir / "chroma.sqlite3").touch()
        sidecar_path = chroma_dir / sidecar
        sidecar_path.touch()
        assert is_hard_excluded(sidecar_path) is False


# ---------------------------------------------------------------------------
# Normal paths — must NOT be excluded
# ---------------------------------------------------------------------------

class TestNormalPathsNotExcluded:
    def test_phive_runs_not_excluded(self):
        assert is_hard_excluded(Path(".pHive/runs/run-abc/state.json")) is False

    def test_scratch_not_excluded(self):
        assert is_hard_excluded(Path(".pHive/scratch/tmp.txt")) is False

    def test_episodes_not_excluded(self):
        assert is_hard_excluded(Path(".pHive/episodes/epic-x/story-y/step.yaml")) is False

    def test_arbitrary_home_subdir_not_excluded(self, tmp_path):
        home = _fake_home(tmp_path)
        other = home / "projects" / "foo.py"
        other.parent.mkdir(parents=True)
        other.touch()
        with patch("hive.lib.artifact_lifecycle.exclusions._home", return_value=home):
            assert is_hard_excluded(other) is False


# ---------------------------------------------------------------------------
# assert_not_hard_excluded raises HardExcludeError
# ---------------------------------------------------------------------------

class TestAssertNotHardExcluded:
    def test_raises_for_team_memories(self):
        path = Path(".pHive/team-memories/notes.md")
        with pytest.raises(HardExcludeError, match="hard-excluded root"):
            assert_not_hard_excluded(path, action="evict")

    def test_raises_names_excluded_root(self, tmp_path):
        home = _fake_home(tmp_path)
        memories = _memories_path(home, "dev", "insight.md")
        memories.parent.mkdir(parents=True)
        memories.touch()
        with patch("hive.lib.artifact_lifecycle.exclusions._home", return_value=home):
            with pytest.raises(HardExcludeError, match="memories"):
                assert_not_hard_excluded(memories, action="evict")

    def test_raises_for_kg_sqlite(self, tmp_path):
        home = _fake_home(tmp_path)
        kg = _kg_path(home)
        kg.parent.mkdir(parents=True)
        kg.touch()
        with patch("hive.lib.artifact_lifecycle.exclusions._home", return_value=home):
            with pytest.raises(HardExcludeError, match=r"kg\.sqlite"):
                assert_not_hard_excluded(kg, action="evict")

    def test_no_raise_for_normal_path(self):
        path = Path(".pHive/runs/run-x/state.json")
        assert_not_hard_excluded(path, action="evict")  # should not raise


# ---------------------------------------------------------------------------
# apply_guard raises HardExcludeError for hard-excluded candidates
# ---------------------------------------------------------------------------

class TestApplyGuard:
    def _make_entry(self):
        from hive.lib.artifact_lifecycle.registry import (
            AgeSource,
            ArchiveAction,
            Classification,
            RegistryEntry,
        )
        return RegistryEntry(
            class_id="dag-run-state",
            globs=(".pHive/runs/**",),
            classification=Classification.UNTRACKED,
            active_predicate="always",
            retention_threshold=30,
            archive_action=ArchiveAction.EVICT,
            age_source=AgeSource.MTIME,
            hard_exclude=False,
        )

    def test_apply_guard_raises_for_team_memories(self):
        candidate = Candidate(
            path=Path(".pHive/team-memories/notes.md"),
            class_id="dag-run-state",
            action=ArchiveAction.EVICT,
        )
        with pytest.raises(HardExcludeError):
            apply_guard(candidate)

    def test_apply_guard_passes_for_normal_path(self, tmp_path):
        candidate = Candidate(
            path=tmp_path / "some" / "artifact.json",
            class_id="dag-run-state",
            action=ArchiveAction.EVICT,
        )
        apply_guard(candidate)  # should not raise


# ---------------------------------------------------------------------------
# build_candidates filters hard-excluded paths
# ---------------------------------------------------------------------------

class TestBuildCandidates:
    def _entry(self):
        from hive.lib.artifact_lifecycle.registry import (
            AgeSource,
            ArchiveAction,
            Classification,
            RegistryEntry,
        )
        return RegistryEntry(
            class_id="dag-run-state",
            globs=(".pHive/runs/**",),
            classification=Classification.UNTRACKED,
            active_predicate="always",
            retention_threshold=30,
            archive_action=ArchiveAction.EVICT,
            age_source=AgeSource.MTIME,
            hard_exclude=False,
        )

    def test_hard_excluded_paths_filtered(self):
        entry = self._entry()
        paths = [
            Path(".pHive/runs/run-abc/state.json"),
            Path(".pHive/team-memories/notes.md"),
        ]
        candidates = build_candidates(entry, paths)
        assert len(candidates) == 1
        assert candidates[0].path == Path(".pHive/runs/run-abc/state.json")

    def test_all_excluded_returns_empty(self):
        entry = self._entry()
        paths = [
            Path(".pHive/team-memories/a.md"),
            Path(".pHive/team-memories/b.md"),
        ]
        candidates = build_candidates(entry, paths)
        assert candidates == []

    def test_no_excluded_returns_all(self, tmp_path):
        entry = self._entry()
        paths = [
            tmp_path / "run-1" / "state.json",
            tmp_path / "run-2" / "state.json",
        ]
        candidates = build_candidates(entry, paths)
        assert len(candidates) == 2
        assert all(c.class_id == "dag-run-state" for c in candidates)
        assert all(c.action == ArchiveAction.EVICT for c in candidates)
