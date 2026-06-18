"""Tests for D3 terminal eligibility signal (al-4-backfill-terminal-signal).

Acceptance criteria covered:
  AC1 — shipped YAML (status=shipped + release_id) → eligible (signal=shipped)
  AC2 — merged feature branch + aged artifact → eligible (signal=merged-and-aged)
  AC3 — advisory non-shipped status only → not eligible unless merged+age passes
  AC4 — D1/D2 action contract: untracked→evict, tracked→report (planner test)
  AC5 — unmerged branch → legacy signal inactive, regardless of age
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml

from hive.lib.artifact_lifecycle.eligibility import (
    TerminalEligibility,
    check_terminal_eligibility,
    is_branch_merged_to_default,
    is_shipped,
)
from hive.lib.artifact_lifecycle.planner import (
    Candidate,
    plan_terminal_report_candidates,
)
from hive.lib.artifact_lifecycle.registry import ArchiveAction, load_registry

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
_THRESHOLD = 90  # days — typical tracked-class threshold
_OLD_DAYS = 100.0  # beyond threshold
_NEW_DAYS = 10.0   # within threshold


# ---------------------------------------------------------------------------
# is_shipped unit tests
# ---------------------------------------------------------------------------


class TestIsShipped:
    def test_shipped_with_release_id(self):
        # AC1: /ship-written status + release_id → True
        assert is_shipped({"status": "shipped", "release_id": "v1.2.3"}) is True

    def test_shipped_without_release_id(self):
        # AC1: shipped status alone is insufficient
        assert is_shipped({"status": "shipped"}) is False

    def test_shipped_empty_release_id(self):
        assert is_shipped({"status": "shipped", "release_id": ""}) is False

    def test_advisory_done_status(self):
        # AC3: advisory non-shipped status is not terminal
        assert is_shipped({"status": "done", "release_id": "v1.0"}) is False

    def test_advisory_pending_status(self):
        assert is_shipped({"status": "pending"}) is False

    def test_empty_dict(self):
        assert is_shipped({}) is False

    def test_in_progress_status(self):
        assert is_shipped({"status": "in_progress", "release_id": "v2.0"}) is False


# ---------------------------------------------------------------------------
# check_terminal_eligibility — shipped signal (AC1)
# ---------------------------------------------------------------------------


class TestShippedSignal:
    def test_shipped_yaml_is_eligible(self):
        result = check_terminal_eligibility(
            yaml_dict={"status": "shipped", "release_id": "v1.0"},
            repo_root=None,
            feature_branch=None,
            age_days=5.0,
            threshold_days=_THRESHOLD,
        )
        assert result.eligible is True
        assert result.signal == "shipped"

    def test_shipped_yaml_eligible_regardless_of_age(self):
        # Primary signal does not gate on age; class threshold controls action timing.
        result = check_terminal_eligibility(
            yaml_dict={"status": "shipped", "release_id": "r123"},
            repo_root=None,
            feature_branch=None,
            age_days=1.0,
            threshold_days=_THRESHOLD,
        )
        assert result.eligible is True
        assert result.signal == "shipped"

    def test_none_yaml_dict_not_eligible_via_shipped(self):
        result = check_terminal_eligibility(
            yaml_dict=None,
            repo_root=None,
            feature_branch=None,
            age_days=_OLD_DAYS,
            threshold_days=_THRESHOLD,
        )
        assert result.eligible is False
        assert result.signal == "none"


# ---------------------------------------------------------------------------
# check_terminal_eligibility — legacy merged+age signal (AC2, AC5)
# ---------------------------------------------------------------------------


class TestLegacyMergedAgedSignal:
    def test_merged_and_aged_is_eligible(self, tmp_path, monkeypatch):
        # AC2: merged branch + old enough → eligible
        monkeypatch.setattr(
            "hive.lib.artifact_lifecycle.eligibility.is_branch_merged_to_default",
            lambda repo_root, branch, default: True,
        )
        result = check_terminal_eligibility(
            yaml_dict={"status": "done"},  # advisory only
            repo_root=tmp_path,
            feature_branch="feat/some-feature",
            age_days=_OLD_DAYS,
            threshold_days=_THRESHOLD,
        )
        assert result.eligible is True
        assert result.signal == "merged-and-aged"

    def test_merged_but_not_aged_is_not_eligible(self, tmp_path, monkeypatch):
        monkeypatch.setattr(
            "hive.lib.artifact_lifecycle.eligibility.is_branch_merged_to_default",
            lambda repo_root, branch, default: True,
        )
        result = check_terminal_eligibility(
            yaml_dict={"status": "done"},
            repo_root=tmp_path,
            feature_branch="feat/some-feature",
            age_days=_NEW_DAYS,
            threshold_days=_THRESHOLD,
        )
        assert result.eligible is False
        assert result.signal == "none"

    def test_unmerged_branch_is_not_eligible_regardless_of_age(self, tmp_path, monkeypatch):
        # AC5: unmerged → legacy signal inactive, regardless of artifact age
        monkeypatch.setattr(
            "hive.lib.artifact_lifecycle.eligibility.is_branch_merged_to_default",
            lambda repo_root, branch, default: False,
        )
        result = check_terminal_eligibility(
            yaml_dict={"status": "done"},
            repo_root=tmp_path,
            feature_branch="feat/unmerged",
            age_days=_OLD_DAYS,
            threshold_days=_THRESHOLD,
        )
        assert result.eligible is False
        assert result.signal == "none"

    def test_no_feature_branch_is_not_eligible(self, tmp_path):
        # No branch → legacy signal cannot fire
        result = check_terminal_eligibility(
            yaml_dict={"status": "done"},
            repo_root=tmp_path,
            feature_branch=None,
            age_days=_OLD_DAYS,
            threshold_days=_THRESHOLD,
        )
        assert result.eligible is False

    def test_no_repo_root_is_not_eligible(self):
        result = check_terminal_eligibility(
            yaml_dict={"status": "done"},
            repo_root=None,
            feature_branch="feat/some-feature",
            age_days=_OLD_DAYS,
            threshold_days=_THRESHOLD,
        )
        assert result.eligible is False


# ---------------------------------------------------------------------------
# Advisory-only status → not eligible (AC3)
# ---------------------------------------------------------------------------


class TestAdvisoryStatusNotEligible:
    @pytest.mark.parametrize("status", ["done", "pending", "in_progress", "blocked"])
    def test_advisory_status_without_merge_not_eligible(self, tmp_path, status, monkeypatch):
        # AC3: advisory status + unmerged branch → not eligible
        monkeypatch.setattr(
            "hive.lib.artifact_lifecycle.eligibility.is_branch_merged_to_default",
            lambda repo_root, branch, default: False,
        )
        result = check_terminal_eligibility(
            yaml_dict={"status": status},
            repo_root=tmp_path,
            feature_branch="feat/wip",
            age_days=_OLD_DAYS,
            threshold_days=_THRESHOLD,
        )
        assert result.eligible is False, f"status={status!r} should not be eligible without merge"

    def test_advisory_status_with_merge_and_age_is_eligible(self, tmp_path, monkeypatch):
        # AC3: advisory status + merged + aged → eligible via legacy signal
        monkeypatch.setattr(
            "hive.lib.artifact_lifecycle.eligibility.is_branch_merged_to_default",
            lambda repo_root, branch, default: True,
        )
        result = check_terminal_eligibility(
            yaml_dict={"status": "done"},
            repo_root=tmp_path,
            feature_branch="feat/shipped-elsewhere",
            age_days=_OLD_DAYS,
            threshold_days=_THRESHOLD,
        )
        assert result.eligible is True
        assert result.signal == "merged-and-aged"


# ---------------------------------------------------------------------------
# Planner: D1/D2 action contract (AC4)
# ---------------------------------------------------------------------------


def _make_tracked_entry(**overrides) -> dict:
    base = {
        "class_id": "story-spec",
        "globs": ["epics/*/stories/*.yaml"],
        "classification": "tracked",
        "active_predicate": "never-active",
        "retention_threshold": _THRESHOLD,
        "archive_action": "report",
        "age_source": "git-last-commit",
        "hard_exclude": False,
    }
    base.update(overrides)
    return base


class TestPlannerD1D2ActionContract:
    def _write_story_yaml(self, path: Path, content: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(yaml.dump(content))
        # backdate mtime so age gating passes
        old_ts = (_NOW - timedelta(days=_OLD_DAYS)).timestamp()
        os.utime(path, (old_ts, old_ts))

    def test_tracked_shipped_story_produces_report_candidate(self, tmp_path, monkeypatch):
        # AC4: shipped story → action=REPORT (D2 — tracked is report-only)
        state_dir = tmp_path
        story_path = state_dir / "epics" / "my-epic" / "stories" / "s-1.yaml"
        self._write_story_yaml(story_path, {"status": "shipped", "release_id": "v2.0", "branch": "feat/my-epic"})

        registry = load_registry([_make_tracked_entry()])
        candidates = plan_terminal_report_candidates(
            registry,
            state_dir=state_dir,
            repo_root=None,
            now=_NOW,
        )

        assert len(candidates) == 1
        c = candidates[0]
        assert c.action is ArchiveAction.REPORT
        assert c.class_id == "story-spec"
        assert c.path == story_path

    def test_tracked_merged_aged_story_produces_report_candidate(self, tmp_path, monkeypatch):
        # AC4: legacy merged+aged story → action=REPORT
        monkeypatch.setattr(
            "hive.lib.artifact_lifecycle.eligibility.is_branch_merged_to_default",
            lambda repo_root, branch, default: True,
        )
        state_dir = tmp_path
        story_path = state_dir / "epics" / "my-epic" / "stories" / "s-2.yaml"
        self._write_story_yaml(story_path, {"status": "done", "branch": "feat/my-epic"})

        registry = load_registry([_make_tracked_entry()])
        candidates = plan_terminal_report_candidates(
            registry,
            state_dir=state_dir,
            repo_root=tmp_path,
            now=_NOW,
        )

        assert len(candidates) == 1
        assert candidates[0].action is ArchiveAction.REPORT

    def test_advisory_unmerged_story_not_in_candidates(self, tmp_path, monkeypatch):
        # AC4: advisory status + unmerged → not a candidate
        monkeypatch.setattr(
            "hive.lib.artifact_lifecycle.eligibility.is_branch_merged_to_default",
            lambda repo_root, branch, default: False,
        )
        state_dir = tmp_path
        story_path = state_dir / "epics" / "my-epic" / "stories" / "s-3.yaml"
        self._write_story_yaml(story_path, {"status": "in_progress", "branch": "feat/my-epic"})

        registry = load_registry([_make_tracked_entry()])
        candidates = plan_terminal_report_candidates(
            registry,
            state_dir=state_dir,
            repo_root=tmp_path,
            now=_NOW,
        )

        assert candidates == []

    def test_hard_excluded_entry_skipped(self, tmp_path):
        state_dir = tmp_path
        story_path = state_dir / "epics" / "my-epic" / "stories" / "s-4.yaml"
        self._write_story_yaml(story_path, {"status": "shipped", "release_id": "v1.0"})

        entry = _make_tracked_entry(hard_exclude=True)
        registry = load_registry([entry])
        candidates = plan_terminal_report_candidates(registry, state_dir=state_dir, now=_NOW)
        assert candidates == []

    def test_untracked_entry_skipped_by_terminal_planner(self, tmp_path):
        # plan_terminal_report_candidates only handles tracked/report entries (D1/D2).
        state_dir = tmp_path
        untracked_entry = {
            "class_id": "dag-run-state",
            "globs": ["runs/*"],
            "classification": "untracked",
            "active_predicate": "never-active",
            "retention_threshold": 30,
            "archive_action": "evict",
            "age_source": "mtime",
            "hard_exclude": False,
        }
        run_dir = state_dir / "runs" / "run-x"
        run_dir.mkdir(parents=True)

        registry = load_registry([untracked_entry])
        candidates = plan_terminal_report_candidates(registry, state_dir=state_dir, now=_NOW)
        assert candidates == []
