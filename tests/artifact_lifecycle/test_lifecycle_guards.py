"""Epic-level guard tests for artifact lifecycle sweep (al-8).

Acceptance criteria covered:
  AC1 — Active-state artifacts (suspended/failed DAG, in-review story/episode,
         active triage) are never moved, removed, or reported as removable.
  AC2 — Hard-excluded roots (memories, team-memory, KG sqlite, Chroma index)
         are not planned or applied in dry-run or apply mode.
  AC3 — Dry-run: report lists candidates; fixture paths remain untouched.
  AC4 — Apply mode is idempotent: second run produces no duplicate moves or errors.
  AC5 — Age-source selection (D5): untracked classes use filesystem mtime;
         tracked report-only classes use git last-commit date.
  AC6 — Tracked report-only classes (audits, episodes, metrics): files remain
         present after apply, and the terminal report marks them report-only.
"""

from __future__ import annotations

import os
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

import pytest
import yaml

from hive.lib.artifact_lifecycle.executor import apply_evict
from hive.lib.artifact_lifecycle.executor import dry_run as executor_dry_run
from hive.lib.artifact_lifecycle.planner import (
    EvictCandidate,
    plan_candidates,
    plan_terminal_report_candidates,
)
from hive.lib.artifact_lifecycle.registry import (
    AgeSource,
    ArchiveAction,
    Classification,
    RegistryEntry,
    load_registry,
    load_tracked_classes,
)

from .conftest import (
    _NOW,
    _OLD_TS,
    backdate,
    git_commit_at,
    write_run_state,
)


# ---------------------------------------------------------------------------
# Registry helpers
# ---------------------------------------------------------------------------


def _dag_entry(**overrides) -> dict:
    base = {
        "class_id": "dag-run-state",
        "globs": ["runs/*"],
        "classification": "untracked",
        "active_predicate": "dag-run-active",
        "retention_threshold": 30,
        "archive_action": "evict",
        "age_source": "mtime",
        "hard_exclude": False,
    }
    base.update(overrides)
    return base


def _untracked_never_active_entry(**overrides) -> dict:
    base = {
        "class_id": "scratch-output",
        "globs": ["scratch/**"],
        "classification": "untracked",
        "active_predicate": "never-active",
        "retention_threshold": 30,
        "archive_action": "evict",
        "age_source": "mtime",
        "hard_exclude": False,
    }
    base.update(overrides)
    return base


def _tracked_report_entry(**overrides) -> dict:
    base = {
        "class_id": "story-spec",
        "globs": ["epics/*/stories/*.yaml"],
        "classification": "tracked",
        "active_predicate": "never-active",
        "retention_threshold": 90,
        "archive_action": "report",
        "age_source": "git-last-commit",
        "hard_exclude": False,
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# AC1 — Active-state guards
# ---------------------------------------------------------------------------


class TestActiveStateGuards:
    """Active artifacts must never be planned for eviction or reported as removable."""

    @pytest.mark.parametrize("status", ["suspended", "failed"])
    def test_active_dag_run_not_planned(self, state_dir, now, status):
        # AC1: suspended and failed runs are active → not planned regardless of age.
        run_dir = state_dir / "runs" / f"run-{status}"
        write_run_state(run_dir, status, age_ts=_OLD_TS)

        registry = load_registry([_dag_entry()])
        candidates = plan_candidates(registry, state_dir, now=now)

        assert candidates == [], f"status={status!r} run must not be planned"

    def test_in_review_story_not_reported(self, state_dir, now):
        # AC1: in-review story has advisory status, not terminal → not eligible.
        story_dir = state_dir / "epics" / "my-epic" / "stories"
        story_dir.mkdir(parents=True)
        story = story_dir / "s-active.yaml"
        story.write_text(yaml.dump({"status": "in_review", "branch": "feat/my-epic"}))
        backdate(story)

        registry = load_registry([_tracked_report_entry()])
        # No repo_root → merged+age signal disabled; advisory status → not eligible.
        candidates = plan_terminal_report_candidates(registry, state_dir=state_dir, now=now)
        assert candidates == [], "in-review story must not be reported as removable"

    def test_in_progress_episode_not_reported(self, state_dir, now):
        # AC1: episode with in_progress advisory status is not terminal.
        ep_dir = state_dir / "epics" / "epic-x" / "episodes"
        ep_dir.mkdir(parents=True)
        ep = ep_dir / "ep-001.yaml"
        ep.write_text(yaml.dump({"status": "in_progress", "branch": "feat/epic-x"}))
        backdate(ep)

        entry = _tracked_report_entry(
            class_id="episode-marker",
            globs=["epics/*/episodes/*.yaml"],
        )
        registry = load_registry([entry])
        candidates = plan_terminal_report_candidates(registry, state_dir=state_dir, now=now)
        assert candidates == []

    def test_active_triage_not_touched_by_sweep(self, state_dir, now):
        # AC1: triage queue is not registered → sweep never plans it.
        triage_dir = state_dir / "triage"
        triage_dir.mkdir()
        queue = triage_dir / "queue.yaml"
        queue.write_text(
            yaml.dump(
                {
                    "version": 1,
                    "items": [{"id": "t-001", "state": "open", "title": "Active item"}],
                }
            )
        )
        backdate(queue)

        # Use the builtin untracked entry — triage has no glob match.
        registry = load_registry([_dag_entry()])
        candidates = plan_candidates(registry, state_dir, now=now)
        paths_str = [str(c.path) for c in candidates]
        assert not any("triage" in p for p in paths_str), "triage must not appear in candidates"


# ---------------------------------------------------------------------------
# AC2 — Hard-exclusion guards
# ---------------------------------------------------------------------------


class TestHardExclusionGuards:
    """Hard-excluded paths must never appear in a plan, regardless of mode."""

    def _eligible_entry(self) -> dict:
        return _untracked_never_active_entry(
            class_id="mem-test",
            globs=["**/*.md"],
        )

    def test_memories_dir_not_planned_in_dry_run(self, tmp_path, now):
        # AC2: ~/.claude/hive/memories/** must not appear in dry-run report.
        fake_home = tmp_path / "home"
        memories = fake_home / ".claude" / "hive" / "memories"
        memories.mkdir(parents=True)
        target = memories / "dev" / "pattern.md"
        target.parent.mkdir(parents=True)
        target.write_text("# insight\n")
        backdate(target)

        registry = load_registry([self._eligible_entry()])
        state_dir = memories.parent.parent  # .claude/hive/

        with patch("hive.lib.artifact_lifecycle.exclusions._home", return_value=fake_home):
            candidates = plan_candidates(registry, state_dir, now=now)

        paths_str = [str(c.path) for c in candidates]
        assert not any("memories" in p for p in paths_str)

    def test_team_memories_not_planned(self):
        # AC2: .pHive/team-memories/** is filtered by build_candidates (relative-path exclusion).
        # The relative prefix ".pHive/team-memories" is checked by is_hard_excluded;
        # build_candidates receives relative paths when the caller passes them explicitly.
        from hive.lib.artifact_lifecycle.planner import Candidate, build_candidates
        from hive.lib.artifact_lifecycle.registry import (
            AgeSource,
            ArchiveAction,
            Classification,
            RegistryEntry,
        )

        entry = RegistryEntry(
            class_id="scratch-output",
            globs=("scratch/**",),
            classification=Classification.UNTRACKED,
            active_predicate="never-active",
            retention_threshold=30,
            archive_action=ArchiveAction.EVICT,
            age_source=AgeSource.MTIME,
            hard_exclude=False,
        )
        paths = [
            Path(".pHive/scratch/tmp.txt"),
            Path(".pHive/team-memories/squad-alpha/notes.md"),
        ]
        candidates = build_candidates(entry, paths)
        paths_str = [str(c.path) for c in candidates]
        assert not any("team-memories" in p for p in paths_str), (
            "team-memories path must be filtered by build_candidates hard-exclusion check"
        )
        assert any("scratch" in p for p in paths_str), "non-excluded path must remain"

    def test_chroma_index_not_planned_in_dry_run(self, state_dir, now):
        # AC2: Chroma data dir (has chroma.sqlite3 marker) is hard-excluded.
        chroma_dir = state_dir / "chroma_store"
        chroma_dir.mkdir()
        (chroma_dir / "chroma.sqlite3").touch()
        seg = chroma_dir / "segment.bin"
        seg.write_text("binary\n")
        backdate(seg)

        registry = load_registry([self._eligible_entry()])
        candidates = plan_candidates(registry, state_dir, now=now)
        paths_str = [str(c.path) for c in candidates]
        assert not any("chroma_store" in p for p in paths_str)

    def test_kg_sqlite_not_planned(self, tmp_path, now):
        # AC2: KG sqlite file is hard-excluded.
        fake_home = tmp_path / "home"
        kg = fake_home / ".claude" / "hive" / "kg.sqlite"
        kg.parent.mkdir(parents=True)
        kg.touch()
        backdate(kg)

        # Use a glob broad enough to hit it.
        entry = _untracked_never_active_entry(
            class_id="kg-test",
            globs=["hive/*.sqlite"],
        )
        registry = load_registry([entry])
        state_dir = kg.parent  # .claude/hive/

        with patch("hive.lib.artifact_lifecycle.exclusions._home", return_value=fake_home):
            candidates = plan_candidates(registry, state_dir, now=now)

        paths_str = [str(c.path) for c in candidates]
        assert not any("kg.sqlite" in p for p in paths_str)

    def test_hard_excluded_path_not_applied(self):
        # AC2: apply_guard raises HardExcludeError for team-memories path.
        from hive.lib.artifact_lifecycle.exclusions import HardExcludeError
        from hive.lib.artifact_lifecycle.planner import Candidate, apply_guard

        candidate = Candidate(
            path=Path(".pHive/team-memories/notes.md"),
            class_id="dag-run-state",
            action=ArchiveAction.EVICT,
        )
        with pytest.raises(HardExcludeError):
            apply_guard(candidate)


# ---------------------------------------------------------------------------
# AC3 — Dry-run: candidates reported, paths untouched
# ---------------------------------------------------------------------------


class TestDryRunBehavior:
    """Dry-run must list candidates and leave all fixture paths in place."""

    def _make_eligible_run(self, state_dir: Path) -> Path:
        run_dir = state_dir / "runs" / "run-dry-001"
        write_run_state(run_dir, "completed", age_ts=_OLD_TS)
        return run_dir

    def test_dry_run_reports_candidate(self, state_dir, now):
        # AC3: dry-run produces EvictRecord with dry_run=True.
        run_dir = self._make_eligible_run(state_dir)
        registry = load_registry([_dag_entry()])
        candidates = plan_candidates(registry, state_dir, now=now)

        assert len(candidates) >= 1
        records = executor_dry_run([c for c in candidates if c.path == run_dir])
        assert len(records) == 1
        assert records[0].dry_run is True

    def test_dry_run_does_not_move_source(self, state_dir, now):
        # AC3: source path must remain after dry-run.
        run_dir = self._make_eligible_run(state_dir)
        registry = load_registry([_dag_entry()])
        candidates = plan_candidates(registry, state_dir, now=now)

        executor_dry_run(candidates)
        assert run_dir.exists(), "dry-run must not move the source directory"

    def test_dry_run_dest_is_under_tmp(self, state_dir, now):
        # AC3: planned dest path is inside OS temp root.
        import tempfile

        run_dir = self._make_eligible_run(state_dir)
        registry = load_registry([_dag_entry()])
        candidates = plan_candidates(registry, state_dir, now=now)
        records = executor_dry_run([c for c in candidates if c.path == run_dir])

        assert records, "expected at least one record"
        assert str(records[0].dest).startswith(tempfile.gettempdir())


# ---------------------------------------------------------------------------
# AC4 — Apply-mode idempotency
# ---------------------------------------------------------------------------


class TestApplyIdempotency:
    """Running apply twice must not produce duplicate moves or raise errors."""

    def test_second_apply_produces_no_candidates(self, state_dir, now, tmp_path):
        # AC4: first apply moves the file; second scan finds nothing → no errors.
        run_dir = state_dir / "runs" / "run-idempotent"
        write_run_state(run_dir, "completed", age_ts=_OLD_TS)

        registry = load_registry([_dag_entry()])
        custom_tmp = tmp_path / "evict-out"

        # First apply.
        candidates_1 = plan_candidates(registry, state_dir, now=now)
        assert any(c.path == run_dir for c in candidates_1), "expected candidate before first apply"
        records_1 = apply_evict(
            [c for c in candidates_1 if c.path == run_dir],
            tmp_root=custom_tmp,
        )
        assert len(records_1) == 1
        assert not run_dir.exists(), "source must be moved after first apply"

        # Second apply — source is gone; planner finds no candidates.
        candidates_2 = plan_candidates(registry, state_dir, now=now)
        second_run = [c for c in candidates_2 if c.path == run_dir]
        assert second_run == [], "second run must find no candidates for already-evicted artifact"

    def test_second_apply_no_errors(self, state_dir, now, tmp_path):
        # AC4: applying an empty candidate list raises no errors.
        records = apply_evict([], tmp_root=tmp_path / "empty-out")
        assert records == []


# ---------------------------------------------------------------------------
# AC5 — Age-source selection (D5)
# ---------------------------------------------------------------------------


class TestAgeSourceSelection:
    """Untracked classes must use mtime; tracked classes must use git last-commit date."""

    def test_untracked_uses_mtime_not_git(self, state_dir, now):
        # AC5: plan_candidates uses mtime for untracked entries.
        # File mtime is old (>threshold); git is irrelevant.
        run_dir = state_dir / "runs" / "run-mtime"
        write_run_state(run_dir, "completed", age_ts=_OLD_TS)

        registry = load_registry([_dag_entry()])
        candidates = plan_candidates(registry, state_dir, now=now)

        assert any(c.path == run_dir for c in candidates), (
            "completed run with old mtime must be a candidate (mtime age-source)"
        )

    def test_untracked_fresh_mtime_not_candidate(self, state_dir, now):
        # AC5: file with mtime within threshold is NOT a candidate.
        run_dir = state_dir / "runs" / "run-fresh"
        write_run_state(run_dir, "completed")  # no backdate → mtime ≈ now

        registry = load_registry([_dag_entry()])
        candidates = plan_candidates(registry, state_dir, now=now)
        assert not any(c.path == run_dir for c in candidates), (
            "fresh mtime must not produce a candidate"
        )

    def test_tracked_uses_git_commit_date(self, state_dir, git_repo, now):
        # AC5: tracked classes use git-last-commit date (D5).
        # Commit the story file with a timestamp 100 days before now;
        # then reset mtime to "now" (simulating a fresh checkout).
        # The file should still be eligible because git date is used.
        story_dir = state_dir / "epics" / "shipped-epic" / "stories"
        story_dir.mkdir(parents=True)
        story = story_dir / "s-shipped.yaml"
        story.write_text(yaml.dump({"status": "shipped", "release_id": "v1.0"}))

        # Commit at old date within the git_repo.
        old_commit_ts = _OLD_TS
        # Copy file into git_repo so git can track it.
        repo_story_dir = git_repo / "epics" / "shipped-epic" / "stories"
        repo_story_dir.mkdir(parents=True)
        repo_story = repo_story_dir / "s-shipped.yaml"
        repo_story.write_text(yaml.dump({"status": "shipped", "release_id": "v1.0"}))
        git_commit_at(git_repo, repo_story, old_commit_ts)

        # Fresh mtime on the file the planner actually scans (state_dir=git_repo),
        # within threshold → would fail an mtime check, proving git date wins.
        fresh_ts = (now - timedelta(days=1)).timestamp()
        os.utime(repo_story, (fresh_ts, fresh_ts))

        entry = _tracked_report_entry(
            globs=["epics/shipped-epic/stories/*.yaml"],
        )
        registry = load_registry([entry])

        # Use repo_root=git_repo so planner can query git.
        # The path queried is repo_story (inside git_repo), so we point state_dir there.
        candidates = plan_terminal_report_candidates(
            registry,
            state_dir=git_repo,
            repo_root=git_repo,
            now=now,
        )
        paths = [c.path for c in candidates]
        assert any("s-shipped.yaml" in str(p) for p in paths), (
            "shipped story with old git-commit date must be a candidate "
            "even when mtime is fresh (D5: tracked uses git-last-commit)"
        )

    def test_tracked_recent_git_commit_not_candidate(self, state_dir, git_repo, now, monkeypatch):
        # AC5: tracked story with advisory status + merged branch, but recent git commit.
        # Uses merged+age signal path (not shipped), so the age threshold does apply.
        monkeypatch.setattr(
            "hive.lib.artifact_lifecycle.eligibility.is_branch_merged_to_default",
            lambda repo_root, branch, default: True,
        )
        repo_story_dir = git_repo / "epics" / "recent-epic" / "stories"
        repo_story_dir.mkdir(parents=True)
        repo_story = repo_story_dir / "s-recent.yaml"
        # Advisory status only — no release_id, so shipped signal cannot fire.
        repo_story.write_text(yaml.dump({"status": "done", "branch": "feat/recent-epic"}))

        # Commit at 5 days ago — within the 90d threshold; age gate should block it.
        recent_ts = (now - timedelta(days=5)).timestamp()
        git_commit_at(git_repo, repo_story, recent_ts)

        entry = _tracked_report_entry(globs=["epics/recent-epic/stories/*.yaml"])
        registry = load_registry([entry])
        candidates = plan_terminal_report_candidates(
            registry,
            state_dir=git_repo,
            repo_root=git_repo,
            now=now,
        )
        paths = [c.path for c in candidates]
        assert not any("s-recent.yaml" in str(p) for p in paths), (
            "recently committed story (age < threshold) must not be a candidate"
        )


# ---------------------------------------------------------------------------
# AC6 — Tracked report-only classes: files present, report marks report-only
# ---------------------------------------------------------------------------


class TestTrackedReportOnly:
    """Tracked classes (audits, episodes, metrics) must never be evicted;
    the terminal report marks their candidates with action=REPORT."""

    def _setup_tracked_file(self, state_dir: Path, sub: str, name: str) -> Path:
        d = state_dir / sub
        d.mkdir(parents=True, exist_ok=True)
        f = d / name
        f.write_text(yaml.dump({"status": "shipped", "release_id": "v1.0"}))
        backdate(f)
        return f

    def test_audit_record_not_evicted_by_sweep(self, state_dir, now):
        # AC6: audits/**  → tracked; plan_candidates (evict sweep) ignores it.
        audit_file = self._setup_tracked_file(state_dir, "audits/gate-run-001", "audit.yaml")
        # Use load_tracked_classes to get the real registry entries.
        registry = load_tracked_classes()
        candidates = plan_candidates(registry, state_dir, now=now)
        paths = [c.path for c in candidates]
        assert audit_file not in paths, "tracked audit must not appear in evict sweep"

    def test_episode_marker_not_evicted_by_sweep(self, state_dir, now):
        # AC6: episodes/** → tracked; plan_candidates ignores it.
        ep_file = self._setup_tracked_file(state_dir, "episodes/epic-a/story-b", "step.yaml")
        registry = load_tracked_classes()
        candidates = plan_candidates(registry, state_dir, now=now)
        paths = [c.path for c in candidates]
        assert ep_file not in paths

    def test_metrics_record_not_evicted_by_sweep(self, state_dir, now):
        # AC6: metrics/** → tracked; plan_candidates ignores it.
        metrics_file = self._setup_tracked_file(state_dir, "metrics/run-001", "metrics.yaml")
        registry = load_tracked_classes()
        candidates = plan_candidates(registry, state_dir, now=now)
        paths = [c.path for c in candidates]
        assert metrics_file not in paths

    def test_tracked_shipped_story_produces_report_candidate(self, state_dir, now):
        # AC6: terminal-eligible story → action=REPORT (not EVICT).
        story_dir = state_dir / "epics" / "shipped" / "stories"
        story_dir.mkdir(parents=True)
        story = story_dir / "done.yaml"
        story.write_text(yaml.dump({"status": "shipped", "release_id": "v3.0"}))
        backdate(story)

        entry = _tracked_report_entry()
        registry = load_registry([entry])
        candidates = plan_terminal_report_candidates(registry, state_dir=state_dir, now=now)

        assert len(candidates) >= 1
        for c in candidates:
            if c.path == story:
                assert c.action is ArchiveAction.REPORT, "tracked candidate action must be REPORT"
                break
        else:
            pytest.fail("shipped story not found in terminal report candidates")

    def test_apply_does_not_move_tracked_files(self, state_dir, now, tmp_path):
        # AC6: applying the evict sweep against a state_dir with tracked files
        # leaves them untouched (they're never planned for eviction).
        audit_file = self._setup_tracked_file(state_dir, "audits/run-001", "a.yaml")
        episode_file = self._setup_tracked_file(state_dir, "episodes/epic-x/story-y", "s.yaml")
        metrics_file = self._setup_tracked_file(state_dir, "metrics/run-002", "m.yaml")

        registry = load_tracked_classes()
        candidates = plan_candidates(registry, state_dir, now=now)
        # apply_evict requires EvictCandidate; build from plan_candidates output.
        evict_candidates = [
            EvictCandidate(path=c.path, class_id=c.class_id, age_days=100.0)
            for c in candidates
        ]
        apply_evict(evict_candidates, tmp_root=tmp_path / "evict-out")

        assert audit_file.exists(), "audit file must remain after apply sweep"
        assert episode_file.exists(), "episode file must remain after apply sweep"
        assert metrics_file.exists(), "metrics file must remain after apply sweep"
