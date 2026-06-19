"""Tests for artifact lifecycle registry validation (al-1).

Covers:
  - Required field presence
  - archive_action enum membership + retire rejection (D4)
  - age_source / classification cross-field rules (D5)
  - Untracked class: mtime, evict or report only (D1)
  - Tracked class: git-last-commit, report only (D1/D2)
  - Duplicate class_id rejection in load_registry
"""

from __future__ import annotations

import pytest

from hive.lib.artifact_lifecycle.registry import (
    AgeSource,
    ArchiveAction,
    Classification,
    RegistryEntry,
    RegistryValidationError,
    load_registry,
    validate_entry,
)


def _untracked(**overrides) -> dict:
    base = {
        "class_id": "dag-run-state",
        "globs": [".pHive/runs/**"],
        "classification": "untracked",
        "active_predicate": "never-active",
        "retention_threshold": 30,
        "archive_action": "evict",
        "age_source": "mtime",
        "hard_exclude": False,
    }
    base.update(overrides)
    return base


def _tracked(**overrides) -> dict:
    base = {
        "class_id": "episodes",
        "globs": [".pHive/episodes/**"],
        "classification": "tracked",
        "active_predicate": "never-active",
        "retention_threshold": 90,
        "archive_action": "report",
        "age_source": "git-last-commit",
        "hard_exclude": False,
    }
    base.update(overrides)
    return base


class TestRequiredFields:
    def test_valid_untracked_parses(self):
        entry = validate_entry(_untracked())
        assert entry.class_id == "dag-run-state"
        assert entry.classification is Classification.UNTRACKED
        assert entry.archive_action is ArchiveAction.EVICT
        assert entry.age_source is AgeSource.MTIME
        assert entry.hard_exclude is False

    def test_valid_tracked_parses(self):
        entry = validate_entry(_tracked())
        assert entry.class_id == "episodes"
        assert entry.classification is Classification.TRACKED
        assert entry.archive_action is ArchiveAction.REPORT
        assert entry.age_source is AgeSource.GIT_LAST_COMMIT

    @pytest.mark.parametrize("field", [
        "class_id", "globs", "classification", "active_predicate",
        "retention_threshold", "archive_action", "age_source", "hard_exclude",
    ])
    def test_missing_required_field_raises(self, field):
        raw = _untracked()
        del raw[field]
        with pytest.raises(RegistryValidationError, match="Missing required fields"):
            validate_entry(raw)

    def test_all_fields_present_in_entry(self):
        entry = validate_entry(_untracked())
        assert isinstance(entry, RegistryEntry)
        for attr in (
            "class_id", "globs", "classification", "active_predicate",
            "retention_threshold", "archive_action", "age_source", "hard_exclude",
        ):
            assert hasattr(entry, attr)


class TestArchiveActionValidation:
    def test_evict_accepted(self):
        entry = validate_entry(_untracked(archive_action="evict"))
        assert entry.archive_action is ArchiveAction.EVICT

    def test_report_accepted_for_untracked(self):
        entry = validate_entry(_untracked(archive_action="report"))
        assert entry.archive_action is ArchiveAction.REPORT

    def test_report_accepted_for_tracked(self):
        entry = validate_entry(_tracked(archive_action="report"))
        assert entry.archive_action is ArchiveAction.REPORT

    def test_retire_rejected_for_untracked(self):
        with pytest.raises(RegistryValidationError, match="retire"):
            validate_entry(_untracked(archive_action="retire"))

    def test_retire_rejected_for_tracked(self):
        with pytest.raises(RegistryValidationError, match="retire"):
            validate_entry(_tracked(archive_action="retire"))

    def test_invalid_action_rejected(self):
        with pytest.raises(RegistryValidationError, match="archive_action"):
            validate_entry(_untracked(archive_action="delete"))

    @pytest.mark.parametrize("action", ["evict", "EVICT", "delete", "rm", ""])
    def test_only_valid_enum_values_accepted(self, action):
        raw = _untracked(archive_action=action)
        if action == "evict":
            validate_entry(raw)  # should succeed
        else:
            with pytest.raises(RegistryValidationError):
                validate_entry(raw)


class TestUntrackedClassRules:
    def test_untracked_requires_mtime(self):
        with pytest.raises(RegistryValidationError, match="mtime"):
            validate_entry(_untracked(age_source="git-last-commit"))

    def test_untracked_evict_allowed(self):
        entry = validate_entry(_untracked(archive_action="evict"))
        assert entry.archive_action is ArchiveAction.EVICT

    def test_untracked_report_allowed(self):
        entry = validate_entry(_untracked(archive_action="report"))
        assert entry.archive_action is ArchiveAction.REPORT

    def test_untracked_retire_not_allowed(self):
        with pytest.raises(RegistryValidationError, match="retire"):
            validate_entry(_untracked(archive_action="retire"))


class TestTrackedClassRules:
    def test_tracked_requires_git_last_commit(self):
        with pytest.raises(RegistryValidationError, match="git-last-commit"):
            validate_entry(_tracked(age_source="mtime"))

    def test_tracked_report_allowed(self):
        entry = validate_entry(_tracked(archive_action="report"))
        assert entry.archive_action is ArchiveAction.REPORT

    def test_tracked_evict_not_allowed(self):
        # evict is for untracked; tracked must be report this epic (D1/D2)
        with pytest.raises(RegistryValidationError, match="report"):
            validate_entry(_tracked(archive_action="evict"))

    def test_tracked_retire_not_allowed(self):
        with pytest.raises(RegistryValidationError, match="retire"):
            validate_entry(_tracked(archive_action="retire"))


class TestLoadRegistry:
    def test_valid_list_parsed(self):
        entries = load_registry([_untracked(), _tracked()])
        assert len(entries) == 2
        assert entries[0].class_id == "dag-run-state"
        assert entries[1].class_id == "episodes"

    def test_empty_list_ok(self):
        assert load_registry([]) == []

    def test_duplicate_class_id_rejected(self):
        with pytest.raises(RegistryValidationError, match="Duplicate class_id"):
            load_registry([_untracked(), _untracked()])

    def test_invalid_entry_in_list_raises(self):
        with pytest.raises(RegistryValidationError):
            load_registry([_untracked(), _tracked(archive_action="evict")])


class TestCLIHelp:
    """Verify CLI exits 0 with --help and exposes required flags."""

    def test_help_exits_successfully(self):
        import subprocess
        import sys

        result = subprocess.run(
            [sys.executable, "-m", "hive.lib.artifact_lifecycle.cli", "--help"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0

    def test_help_shows_dry_run(self):
        import subprocess
        import sys

        result = subprocess.run(
            [sys.executable, "-m", "hive.lib.artifact_lifecycle.cli", "--help"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert "--dry-run" in result.stdout

    def test_help_shows_class(self):
        import subprocess
        import sys

        result = subprocess.run(
            [sys.executable, "-m", "hive.lib.artifact_lifecycle.cli", "--help"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert "--class" in result.stdout

    def test_help_shows_apply(self):
        import subprocess
        import sys

        result = subprocess.run(
            [sys.executable, "-m", "hive.lib.artifact_lifecycle.cli", "--help"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert "--apply" in result.stdout
