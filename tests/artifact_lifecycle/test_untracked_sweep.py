"""Tests for the untracked runtime sweep (al-3).

Covers:
  - Relocation: completed DAG run older than threshold is moved to OS temp.
  - Dry-run: planned evict actions reported without moving any files.
  - Class-filter: --class restricts which registry classes are evaluated;
    unknown class IDs return non-zero exit.
  - Never-touch-active: suspended, failed, running DAG runs are not evicted;
    unconsumed metrics streams are not evicted; unacknowledged interrupts are
    not evicted; staged (not-yet-promoted/discarded) insights are not evicted.
"""

from __future__ import annotations

import textwrap
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml

from hive.lib.artifact_lifecycle.executor import EvictRecord, apply_evict
from hive.lib.artifact_lifecycle.executor import dry_run as executor_dry_run
from hive.lib.artifact_lifecycle.planner import EvictCandidate, plan_candidates
from hive.lib.artifact_lifecycle.predicates import (
    chroma_sidecar_active,
    dag_run_active,
    insight_staged,
    interrupt_not_acknowledged,
    metrics_stream_not_consumed,
    never_active,
    resolve_predicate,
)
from hive.lib.artifact_lifecycle.registry import load_registry

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
_OLD = _NOW - timedelta(days=40)  # 40 days ago — beyond 30d threshold
_NEW = _NOW - timedelta(days=5)   # 5 days ago — within 30d threshold


def _write_run_state(run_dir: Path, status: str) -> None:
    run_dir.mkdir(parents=True, exist_ok=True)
    payload = {"run_id": run_dir.name, "status": status, "schema_version": 0}
    (run_dir / "run_state.yaml").write_text(yaml.dump(payload))


def _make_entry(**overrides) -> dict:
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


# ---------------------------------------------------------------------------
# Predicate unit tests
# ---------------------------------------------------------------------------


class TestDagRunActivePredicate:
    def test_completed_run_is_inactive(self, tmp_path):
        run_dir = tmp_path / "01J0000000000000000TESTRUN-test"
        _write_run_state(run_dir, "completed")
        assert dag_run_active(run_dir) is False

    def test_running_run_is_active(self, tmp_path):
        run_dir = tmp_path / "run-running"
        _write_run_state(run_dir, "running")
        assert dag_run_active(run_dir) is True

    def test_suspended_run_is_active(self, tmp_path):
        run_dir = tmp_path / "run-suspended"
        _write_run_state(run_dir, "suspended")
        assert dag_run_active(run_dir) is True

    def test_failed_run_is_active(self, tmp_path):
        run_dir = tmp_path / "run-failed"
        _write_run_state(run_dir, "failed")
        assert dag_run_active(run_dir) is True

    def test_missing_state_file_is_active(self, tmp_path):
        run_dir = tmp_path / "run-no-state"
        run_dir.mkdir()
        assert dag_run_active(run_dir) is True


class TestMetricsStreamPredicate:
    def test_no_consumed_marker_is_active(self, tmp_path):
        stream = tmp_path / "stop-abc123.jsonl"
        stream.write_text("{}\n")
        assert metrics_stream_not_consumed(stream) is True

    def test_consumed_marker_present_is_inactive(self, tmp_path):
        stream = tmp_path / "stop-abc123.jsonl"
        stream.write_text("{}\n")
        (tmp_path / "stop-abc123.jsonl.consumed").touch()
        assert metrics_stream_not_consumed(stream) is False


class TestInterruptPredicate:
    def test_no_acknowledged_at_is_active(self, tmp_path):
        f = tmp_path / "interrupt.yaml"
        f.write_text(yaml.dump({"interrupted_at": "2026-01-01T00:00:00Z"}))
        assert interrupt_not_acknowledged(f) is True

    def test_acknowledged_at_present_is_inactive(self, tmp_path):
        f = tmp_path / "interrupt.yaml"
        f.write_text(
            yaml.dump(
                {
                    "interrupted_at": "2026-01-01T00:00:00Z",
                    "acknowledged_at": "2026-01-01T01:00:00Z",
                }
            )
        )
        assert interrupt_not_acknowledged(f) is False

    def test_missing_file_is_active(self, tmp_path):
        assert interrupt_not_acknowledged(tmp_path / "nonexistent.yaml") is True


class TestInsightStagedPredicate:
    def _write_insight(self, path: Path, extra_frontmatter: str = "") -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        content = textwrap.dedent(
            f"""\
            ---
            name: test-insight
            type: pattern
            {extra_frontmatter}
            ---

            Some insight body.
            """
        )
        path.write_text(content)

    def test_no_promotion_marker_is_staged(self, tmp_path):
        f = tmp_path / "insight.md"
        self._write_insight(f)
        assert insight_staged(f) is True

    def test_promoted_at_set_is_inactive(self, tmp_path):
        f = tmp_path / "insight.md"
        self._write_insight(f, "promoted_at: '2026-01-01T00:00:00Z'")
        assert insight_staged(f) is False

    def test_discarded_true_is_inactive(self, tmp_path):
        f = tmp_path / "insight.md"
        self._write_insight(f, "discarded: true")
        assert insight_staged(f) is False

    def test_no_frontmatter_treated_as_staged(self, tmp_path):
        f = tmp_path / "no-fm.md"
        f.write_text("Just some plain text, no frontmatter.\n")
        assert insight_staged(f) is True


class TestNeverActivePredicate:
    def test_always_returns_false(self, tmp_path):
        assert never_active(tmp_path / "anything") is False


class TestResolvePredicateErrors:
    def test_unknown_predicate_raises(self):
        from hive.lib.artifact_lifecycle.predicates import PredicateError

        with pytest.raises(PredicateError, match="Unknown active_predicate"):
            resolve_predicate("nonexistent-predicate")

    def test_known_predicates_resolve(self):
        known = [
            "dag-run-active",
            "metrics-stream-not-consumed",
            "interrupt-not-acknowledged",
            "insight-staged",
            "chroma-sidecar-active",
            "never-active",
        ]
        for name in known:
            fn = resolve_predicate(name)
            assert callable(fn), f"predicate {name!r} did not resolve to callable"


# ---------------------------------------------------------------------------
# Planner tests
# ---------------------------------------------------------------------------


class TestPlannerRelocation:
    def test_completed_old_run_is_candidate(self, tmp_path):
        state_dir = tmp_path
        run_dir = state_dir / "runs" / "01JOLD000000000000000RUN-test"
        _write_run_state(run_dir, "completed")
        # backdate mtime
        old_ts = _OLD.timestamp()
        import os

        os.utime(run_dir / "run_state.yaml", (old_ts, old_ts))
        os.utime(run_dir, (old_ts, old_ts))

        registry = load_registry([_make_entry()])
        candidates = plan_candidates(registry, state_dir, now=_NOW)

        assert len(candidates) == 1
        assert candidates[0].class_id == "dag-run-state"
        assert candidates[0].path == run_dir

    def test_new_completed_run_not_candidate(self, tmp_path):
        state_dir = tmp_path
        run_dir = state_dir / "runs" / "01JNEW000000000000000RUN-test"
        _write_run_state(run_dir, "completed")
        # mtime defaults to now — within threshold

        registry = load_registry([_make_entry()])
        candidates = plan_candidates(registry, state_dir, now=_NOW)
        assert candidates == []

    def test_hard_excluded_entry_skipped(self, tmp_path):
        state_dir = tmp_path
        run_dir = state_dir / "runs" / "01JOLD000000000000000RUN-excl"
        _write_run_state(run_dir, "completed")
        old_ts = _OLD.timestamp()
        import os

        os.utime(run_dir / "run_state.yaml", (old_ts, old_ts))
        os.utime(run_dir, (old_ts, old_ts))

        entry = _make_entry(hard_exclude=True)
        registry = load_registry([entry])
        candidates = plan_candidates(registry, state_dir, now=_NOW)
        assert candidates == []


class TestPlannerNeverTouchActive:
    @pytest.mark.parametrize("status", ["running", "suspended", "failed"])
    def test_active_dag_status_not_candidate(self, tmp_path, status):
        state_dir = tmp_path
        run_dir = state_dir / "runs" / f"01JACTIVE000000000000000-{status}"
        _write_run_state(run_dir, status)
        old_ts = _OLD.timestamp()
        import os

        os.utime(run_dir / "run_state.yaml", (old_ts, old_ts))
        os.utime(run_dir, (old_ts, old_ts))

        registry = load_registry([_make_entry()])
        candidates = plan_candidates(registry, state_dir, now=_NOW)
        assert candidates == [], f"status={status!r} should not produce a candidate"

    def test_unconsumed_metrics_stream_not_candidate(self, tmp_path):
        state_dir = tmp_path
        events_dir = state_dir / "metrics" / "events"
        events_dir.mkdir(parents=True)
        stream = events_dir / "stop-abc123.jsonl"
        stream.write_text("{}\n")
        old_ts = _OLD.timestamp()
        import os

        os.utime(stream, (old_ts, old_ts))
        # no .consumed marker

        entry = _make_entry(
            class_id="metrics-stop-stream",
            globs=["metrics/events/stop-*.jsonl"],
            active_predicate="metrics-stream-not-consumed",
            retention_threshold=30,
        )
        registry = load_registry([entry])
        candidates = plan_candidates(registry, state_dir, now=_NOW)
        assert candidates == []

    def test_consumed_metrics_stream_is_candidate(self, tmp_path):
        state_dir = tmp_path
        events_dir = state_dir / "metrics" / "events"
        events_dir.mkdir(parents=True)
        stream = events_dir / "stop-abc123.jsonl"
        stream.write_text("{}\n")
        (events_dir / "stop-abc123.jsonl.consumed").touch()
        old_ts = _OLD.timestamp()
        import os

        os.utime(stream, (old_ts, old_ts))

        entry = _make_entry(
            class_id="metrics-stop-stream",
            globs=["metrics/events/stop-*.jsonl"],
            active_predicate="metrics-stream-not-consumed",
            retention_threshold=30,
        )
        registry = load_registry([entry])
        candidates = plan_candidates(registry, state_dir, now=_NOW)
        assert len(candidates) == 1

    def test_unacknowledged_interrupt_not_candidate(self, tmp_path):
        state_dir = tmp_path
        interrupts_dir = state_dir / "interrupts"
        interrupts_dir.mkdir()
        interrupt_file = interrupts_dir / "2026-01-01T000000Z.yaml"
        interrupt_file.write_text(
            yaml.dump({"interrupted_at": "2026-01-01T00:00:00Z"})
        )
        old_ts = _OLD.timestamp()
        import os

        os.utime(interrupt_file, (old_ts, old_ts))

        entry = _make_entry(
            class_id="interrupt-record",
            globs=["interrupts/*.yaml"],
            active_predicate="interrupt-not-acknowledged",
            retention_threshold=30,
        )
        registry = load_registry([entry])
        candidates = plan_candidates(registry, state_dir, now=_NOW)
        assert candidates == []

    def test_acknowledged_interrupt_is_candidate(self, tmp_path):
        state_dir = tmp_path
        interrupts_dir = state_dir / "interrupts"
        interrupts_dir.mkdir()
        interrupt_file = interrupts_dir / "2025-12-01T000000Z.yaml"
        interrupt_file.write_text(
            yaml.dump(
                {
                    "interrupted_at": "2025-12-01T00:00:00Z",
                    "acknowledged_at": "2025-12-01T01:00:00Z",
                }
            )
        )
        old_ts = _OLD.timestamp()
        import os

        os.utime(interrupt_file, (old_ts, old_ts))

        entry = _make_entry(
            class_id="interrupt-record",
            globs=["interrupts/*.yaml"],
            active_predicate="interrupt-not-acknowledged",
            retention_threshold=30,
        )
        registry = load_registry([entry])
        candidates = plan_candidates(registry, state_dir, now=_NOW)
        assert len(candidates) == 1

    def test_staged_insight_not_candidate(self, tmp_path):
        state_dir = tmp_path
        insight_dir = state_dir / "insights" / "epic-x" / "story-y"
        insight_dir.mkdir(parents=True)
        insight_file = insight_dir / "some-pattern.md"
        insight_file.write_text(
            "---\nname: some-pattern\ntype: pattern\n---\n\nBody.\n"
        )
        old_ts = _OLD.timestamp()
        import os

        os.utime(insight_file, (old_ts, old_ts))

        entry = _make_entry(
            class_id="staged-insight",
            globs=["insights/**/*.md"],
            active_predicate="insight-staged",
            retention_threshold=30,
        )
        registry = load_registry([entry])
        candidates = plan_candidates(registry, state_dir, now=_NOW)
        assert candidates == []

    def test_promoted_insight_is_candidate(self, tmp_path):
        state_dir = tmp_path
        insight_dir = state_dir / "insights" / "epic-x" / "story-y"
        insight_dir.mkdir(parents=True)
        insight_file = insight_dir / "promoted-pattern.md"
        insight_file.write_text(
            "---\nname: promoted-pattern\ntype: pattern\npromoted_at: '2025-11-01T00:00:00Z'\n---\n\nBody.\n"
        )
        old_ts = _OLD.timestamp()
        import os

        os.utime(insight_file, (old_ts, old_ts))

        entry = _make_entry(
            class_id="staged-insight",
            globs=["insights/**/*.md"],
            active_predicate="insight-staged",
            retention_threshold=30,
        )
        registry = load_registry([entry])
        candidates = plan_candidates(registry, state_dir, now=_NOW)
        assert len(candidates) == 1


# ---------------------------------------------------------------------------
# Executor tests
# ---------------------------------------------------------------------------


class TestDryRun:
    def test_dry_run_returns_records_without_moving(self, tmp_path):
        state_dir = tmp_path
        run_dir = state_dir / "runs" / "01JOLD000000000000000RUN-dry"
        run_dir.mkdir(parents=True)

        candidates = [
            EvictCandidate(path=run_dir, class_id="dag-run-state", age_days=40.0)
        ]
        records = executor_dry_run(candidates)

        assert len(records) == 1
        rec = records[0]
        assert rec.dry_run is True
        assert rec.source == run_dir
        assert run_dir.exists(), "dry_run must not move the source"

    def test_dry_run_dest_is_under_tmp(self, tmp_path):
        run_dir = tmp_path / "run-x"
        run_dir.mkdir()
        candidates = [
            EvictCandidate(path=run_dir, class_id="dag-run-state", age_days=40.0)
        ]
        records = executor_dry_run(candidates)
        import tempfile

        assert str(records[0].dest).startswith(tempfile.gettempdir())


class TestApplyEvict:
    def test_apply_moves_run_dir_to_temp(self, tmp_path):
        state_dir = tmp_path / "state"
        state_dir.mkdir()
        run_dir = state_dir / "runs" / "01JOLD000000000000000RUN-apply"
        run_dir.mkdir(parents=True)
        (run_dir / "run_state.yaml").write_text("status: completed\n")

        custom_tmp = tmp_path / "temp"
        candidates = [
            EvictCandidate(path=run_dir, class_id="dag-run-state", age_days=40.0)
        ]
        records = apply_evict(candidates, tmp_root=custom_tmp)

        assert len(records) == 1
        rec = records[0]
        assert rec.dry_run is False
        assert rec.source == run_dir
        assert not run_dir.exists(), "source directory must be moved away"
        assert rec.dest.exists(), "destination must exist after move"

    def test_apply_records_source_and_dest(self, tmp_path):
        run_dir = tmp_path / "state" / "runs" / "run-record"
        run_dir.mkdir(parents=True)
        (run_dir / "run_state.yaml").write_text("status: completed\n")
        custom_tmp = tmp_path / "out"

        candidates = [
            EvictCandidate(path=run_dir, class_id="dag-run-state", age_days=35.0)
        ]
        records = apply_evict(candidates, tmp_root=custom_tmp)
        rec = records[0]
        assert rec.class_id == "dag-run-state"
        assert rec.source == run_dir
        assert "run-record" in str(rec.dest)


# ---------------------------------------------------------------------------
# CLI integration tests
# ---------------------------------------------------------------------------


class TestCLIClassFilter:
    def test_unknown_class_exits_nonzero(self):
        from hive.lib.artifact_lifecycle.cli import main

        ret = main(["--class", "nonexistent-class-id"])
        assert ret != 0

    def test_known_class_exits_zero(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        # Ensure the state_dir exists but has no artifacts → no candidates.
        (tmp_path / ".pHive" / "runs").mkdir(parents=True)
        from hive.lib.artifact_lifecycle.cli import main

        ret = main(["--class", "dag-run-state", "--dry-run"])
        assert ret == 0

    def test_dry_run_no_files_moved(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        state_dir = tmp_path / ".pHive"
        run_dir = state_dir / "runs" / "01JOLD000000000000000RUN-cli"
        _write_run_state(run_dir, "completed")
        import os

        old_ts = _OLD.timestamp()
        os.utime(run_dir / "run_state.yaml", (old_ts, old_ts))
        os.utime(run_dir, (old_ts, old_ts))

        from hive.lib.artifact_lifecycle.cli import main

        ret = main(["--dry-run"])
        assert ret == 0
        assert run_dir.exists(), "--dry-run must not move files"

    def test_dry_run_and_apply_mutually_exclusive(self):
        from hive.lib.artifact_lifecycle.cli import main

        with pytest.raises(SystemExit) as exc_info:
            main(["--dry-run", "--apply"])
        assert exc_info.value.code != 0
