"""Tests for al-5-report-only-tracked-classes.

Acceptance criteria covered:
  AC1 — registry entries load with classification=tracked, archive_action=report,
         age_source=git-last-commit for audits, episodes, and metrics classes.
  AC2 — dry-run lists tracked report-only candidates with no remove/move action.
  AC3 — apply-mode path produces no git rm, file deletion, or move-to-temp;
         candidates carry action=REPORT so the evict executor never processes them.
  AC4 — report output names the live-consumer reason for each tracked class.
  AC5 — retire action fails validation before planning.
"""

from __future__ import annotations

import io
from datetime import datetime, timezone
from pathlib import Path

import pytest
import yaml

from hive.lib.artifact_lifecycle.planner import (
    Candidate,
    plan_terminal_report_candidates,
)
from hive.lib.artifact_lifecycle.registry import (
    ArchiveAction,
    Classification,
    AgeSource,
    RegistryValidationError,
    TRACKED_CLASSES_RAW,
    load_tracked_classes,
    validate_entry,
)
from hive.lib.artifact_lifecycle.reporter import (
    _CONSUMER_REASON,
    emit_report,
    format_report_line,
)

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

_CLASS_IDS = {"audit-record", "episode-marker", "metrics-record"}


# ---------------------------------------------------------------------------
# AC1 — Registry entries load with correct schema
# ---------------------------------------------------------------------------


class TestTrackedClassesRegistry:
    def test_load_returns_three_entries(self):
        entries = load_tracked_classes()
        assert len(entries) == 3

    def test_all_class_ids_present(self):
        entries = load_tracked_classes()
        ids = {e.class_id for e in entries}
        assert ids == _CLASS_IDS

    def test_all_classification_tracked(self):
        for entry in load_tracked_classes():
            assert entry.classification is Classification.TRACKED, (
                f"{entry.class_id} has classification={entry.classification}"
            )

    def test_all_archive_action_report(self):
        for entry in load_tracked_classes():
            assert entry.archive_action is ArchiveAction.REPORT, (
                f"{entry.class_id} has archive_action={entry.archive_action}"
            )

    def test_all_age_source_git_last_commit(self):
        for entry in load_tracked_classes():
            assert entry.age_source is AgeSource.GIT_LAST_COMMIT, (
                f"{entry.class_id} has age_source={entry.age_source}"
            )

    def test_audit_record_globs(self):
        entries = {e.class_id: e for e in load_tracked_classes()}
        assert "audits/**" in entries["audit-record"].globs

    def test_episode_marker_globs(self):
        entries = {e.class_id: e for e in load_tracked_classes()}
        assert "episodes/**" in entries["episode-marker"].globs

    def test_metrics_record_globs(self):
        entries = {e.class_id: e for e in load_tracked_classes()}
        assert "metrics/**" in entries["metrics-record"].globs

    def test_audit_retention_threshold(self):
        entries = {e.class_id: e for e in load_tracked_classes()}
        assert entries["audit-record"].retention_threshold == 90

    def test_episode_retention_threshold(self):
        entries = {e.class_id: e for e in load_tracked_classes()}
        assert entries["episode-marker"].retention_threshold == 90

    def test_metrics_retention_threshold(self):
        entries = {e.class_id: e for e in load_tracked_classes()}
        assert entries["metrics-record"].retention_threshold == 60

    def test_none_hard_excluded(self):
        for entry in load_tracked_classes():
            assert entry.hard_exclude is False


# ---------------------------------------------------------------------------
# AC2 — Dry-run lists tracked candidates with action=REPORT (no evict/move)
# ---------------------------------------------------------------------------


class TestDryRunReportOnly:
    def _make_shipped_yaml(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w") as fh:
            yaml.dump({"status": "shipped", "release_id": "v1.0"}, fh)

    def test_plan_returns_report_action(self, tmp_path):
        state_dir = tmp_path / ".pHive"
        audit_file = state_dir / "audits" / "run-001.yaml"
        self._make_shipped_yaml(audit_file)

        entries = [e for e in load_tracked_classes() if e.class_id == "audit-record"]
        # Override threshold to 0 so age gate passes without git
        import dataclasses
        entries = [dataclasses.replace(entries[0], retention_threshold=0)]

        candidates = plan_terminal_report_candidates(
            entries, state_dir, repo_root=None, now=_NOW
        )

        assert len(candidates) >= 1
        for c in candidates:
            assert c.action is ArchiveAction.REPORT

    def test_plan_never_returns_evict_action(self, tmp_path):
        state_dir = tmp_path / ".pHive"
        ep_file = state_dir / "episodes" / "epic-x" / "story-1.yaml"
        self._make_shipped_yaml(ep_file)

        entries = [e for e in load_tracked_classes() if e.class_id == "episode-marker"]
        import dataclasses
        entries = [dataclasses.replace(entries[0], retention_threshold=0)]

        candidates = plan_terminal_report_candidates(
            entries, state_dir, repo_root=None, now=_NOW
        )

        evict_candidates = [c for c in candidates if c.action is ArchiveAction.EVICT]
        assert evict_candidates == []

    def test_plan_never_returns_retire_action(self, tmp_path):
        state_dir = tmp_path / ".pHive"
        m_file = state_dir / "metrics" / "run-001.jsonl"
        m_file.parent.mkdir(parents=True, exist_ok=True)
        m_file.write_text("{}")

        # metrics-record has no shipped YAML; without terminal eligibility no candidates
        entries = [e for e in load_tracked_classes() if e.class_id == "metrics-record"]
        candidates = plan_terminal_report_candidates(
            entries, state_dir, repo_root=None, now=_NOW
        )

        retire_candidates = [c for c in candidates if c.action is ArchiveAction.RETIRE]
        assert retire_candidates == []


# ---------------------------------------------------------------------------
# AC3 — Apply-mode: Candidate type is REPORT; executor never receives these
# ---------------------------------------------------------------------------


class TestApplyModeNoRemoval:
    def test_report_candidate_action_is_report(self, tmp_path):
        # Candidates from plan_terminal_report_candidates always carry REPORT action.
        # The evict executor (apply_evict) only accepts EvictCandidate — a distinct
        # type — so tracked report-only candidates can never trigger a move or delete.
        state_dir = tmp_path / ".pHive"
        audit_file = state_dir / "audits" / "audit-001.yaml"
        audit_file.parent.mkdir(parents=True, exist_ok=True)
        with audit_file.open("w") as fh:
            yaml.dump({"status": "shipped", "release_id": "v1.0"}, fh)

        import dataclasses
        entries = [e for e in load_tracked_classes() if e.class_id == "audit-record"]
        entries = [dataclasses.replace(entries[0], retention_threshold=0)]

        candidates = plan_terminal_report_candidates(
            entries, state_dir, repo_root=None, now=_NOW
        )

        for c in candidates:
            assert c.action is ArchiveAction.REPORT
            # Confirm Candidate type (not EvictCandidate which apply_evict consumes)
            assert isinstance(c, Candidate)
            assert not hasattr(c, "age_days")  # EvictCandidate has age_days; Candidate does not

    def test_file_still_exists_after_report_planning(self, tmp_path):
        state_dir = tmp_path / ".pHive"
        ep_file = state_dir / "episodes" / "epic-y" / "s1.yaml"
        ep_file.parent.mkdir(parents=True, exist_ok=True)
        with ep_file.open("w") as fh:
            yaml.dump({"status": "shipped", "release_id": "v2.0"}, fh)

        import dataclasses
        entries = [e for e in load_tracked_classes() if e.class_id == "episode-marker"]
        entries = [dataclasses.replace(entries[0], retention_threshold=0)]

        plan_terminal_report_candidates(entries, state_dir, repo_root=None, now=_NOW)

        # Planning must never delete or move the file.
        assert ep_file.exists()


# ---------------------------------------------------------------------------
# AC4 — Reporter names the live-consumer reason per class
# ---------------------------------------------------------------------------


class TestReporterOutput:
    def _make_candidate(self, class_id: str, path: Path) -> Candidate:
        return Candidate(path=path, class_id=class_id, action=ArchiveAction.REPORT)

    def test_audit_reason_in_output(self, tmp_path):
        c = self._make_candidate("audit-record", tmp_path / "audits" / "x.yaml")
        line = format_report_line(c)
        assert "audits feed gate-mode aggregation" in line

    def test_episode_reason_in_output(self, tmp_path):
        c = self._make_candidate("episode-marker", tmp_path / "episodes" / "x.yaml")
        line = format_report_line(c)
        assert "episodes feed story-status derivation" in line

    def test_metrics_reason_in_output(self, tmp_path):
        c = self._make_candidate("metrics-record", tmp_path / "metrics" / "x.jsonl")
        line = format_report_line(c)
        assert "metrics feed cross-run aggregation" in line

    def test_format_includes_report_only_label(self, tmp_path):
        c = self._make_candidate("audit-record", tmp_path / "audits" / "x.yaml")
        line = format_report_line(c)
        assert "report-only" in line

    def test_format_includes_path(self, tmp_path):
        p = tmp_path / "audits" / "x.yaml"
        c = self._make_candidate("audit-record", p)
        line = format_report_line(c)
        assert str(p) in line

    def test_emit_report_summary_line(self, tmp_path):
        candidates = [
            self._make_candidate("audit-record", tmp_path / "a.yaml"),
            self._make_candidate("episode-marker", tmp_path / "b.yaml"),
        ]
        buf = io.StringIO()
        emit_report(candidates, file=buf)
        output = buf.getvalue()
        assert "2 report-only candidate(s)" in output

    def test_all_class_ids_have_consumer_reason(self):
        assert "audit-record" in _CONSUMER_REASON
        assert "episode-marker" in _CONSUMER_REASON
        assert "metrics-record" in _CONSUMER_REASON


# ---------------------------------------------------------------------------
# AC5 — Retire action fails validation before planning
# ---------------------------------------------------------------------------


class TestRetireRejected:
    def _base_raw(self) -> dict:
        return {
            "class_id": "audit-record",
            "globs": ["audits/**"],
            "classification": "tracked",
            "active_predicate": "never-active",
            "retention_threshold": 90,
            "archive_action": "report",
            "age_source": "git-last-commit",
            "hard_exclude": False,
        }

    def test_retire_raises_validation_error(self):
        raw = self._base_raw()
        raw["archive_action"] = "retire"
        with pytest.raises(RegistryValidationError, match="retire"):
            validate_entry(raw)

    def test_retire_blocked_regardless_of_classification(self):
        # retire is deferred for ALL classifications (D4).
        for cls in ("tracked", "untracked"):
            raw = self._base_raw()
            raw["archive_action"] = "retire"
            raw["classification"] = cls
            raw["age_source"] = "git-last-commit" if cls == "tracked" else "mtime"
            with pytest.raises(RegistryValidationError):
                validate_entry(raw)

    def test_load_tracked_classes_contains_no_retire(self):
        for entry in load_tracked_classes():
            assert entry.archive_action is not ArchiveAction.RETIRE
