"""Activation tests for arming and tripping the rollback watch."""

from __future__ import annotations

import inspect
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

from tests.meta_meta.test_direct_commit_adapter import (
    _git,
    _init_repo,
    _load_meta_experiment_module,
    _make_worktree_candidate,
)


META_EXPERIMENT = _load_meta_experiment_module()
DirectCommitAdapter = META_EXPERIMENT.DirectCommitAdapter
NoActionResult = META_EXPERIMENT.NoActionResult
RollbackResult = META_EXPERIMENT.RollbackResult
TripEvent = META_EXPERIMENT.TripEvent
arm_watch = META_EXPERIMENT.arm_watch
evaluate_watch = META_EXPERIMENT.evaluate_watch
make_direct_commit_auto_revert = META_EXPERIMENT.make_direct_commit_auto_revert


class RecordingEnvelopeWriter:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, object]] = []

    def set_regression_watch(self, experiment_id: str, state: dict) -> dict:
        self.calls.append(("set_regression_watch", experiment_id, state))
        return {"experiment_id": experiment_id, "regression_watch": state}

    def set_observation_window(self, experiment_id: str, window: dict) -> dict:
        self.calls.append(("set_observation_window", experiment_id, window))
        return {"experiment_id": experiment_id, "observation_window": window}

    def set_decision(self, experiment_id: str, decision: str) -> dict:
        self.calls.append(("set_decision", experiment_id, decision))
        return {"experiment_id": experiment_id, "decision": decision}


def _snapshot(tokens: int, wall_clock_ms: int = 200) -> dict[str, object]:
    return {
        "captured_at": "2026-04-21T12:15:00Z",
        "metrics": {
            "tokens": tokens,
            "wall_clock_ms": wall_clock_ms,
        },
    }


def _base_envelope(**overrides: object) -> dict[str, object]:
    envelope = {
        "experiment_id": "exp_watch_activation",
        "swarm_id": "meta-meta-optimize",
        "target_ref": "repo:plugin-hive@worktree/test",
        "baseline_ref": "experiment:baseline_001",
        "candidate_ref": "snapshot:candidate/2026-04-21T12:00:00Z",
        "policy_ref": "policy:default",
        "decision": "accept",
        "metrics_snapshot": _snapshot(tokens=100),
        "rollback_ref": "rollback:exp_watch_activation",
    }
    envelope.update(overrides)
    return envelope


def _promoted_envelope(repo: Path) -> tuple[dict[str, object], str, str]:
    experiment_id = "exp-watch-live"
    _init_repo(repo)
    worktree = repo / ".pHive/meta-team/worktrees" / experiment_id
    candidate_ref = _make_worktree_candidate(
        repo,
        worktree,
        experiment_id,
        "feature.txt",
        "promoted content\n",
    )
    adapter = DirectCommitAdapter(repo)
    promotion = adapter.promote(
        {
            "experiment_id": experiment_id,
            "candidate_ref": candidate_ref,
            "target_branch": "main",
        },
        {"verdict": "pass"},
    )
    envelope = {
        "experiment_id": experiment_id,
        "target_branch": "main",
        "commit_ref": promotion.evidence.commit_ref,
        "rollback_ref": promotion.rollback_target,
        "decision": "accept",
        "metrics_snapshot": _snapshot(tokens=100),
    }
    return envelope, promotion.evidence.commit_ref, promotion.rollback_target


def test_arm_watch_sets_regression_watch_and_observation_window() -> None:
    writer = RecordingEnvelopeWriter()

    armed = arm_watch(
        _base_envelope(),
        observation_window_hours=4,
        now="2026-04-21T12:00:00Z",
        envelope_writer=writer,
    )

    assert armed == {
        "regression_watch": {
            "state": "armed",
            "armed_at": "2026-04-21T12:00:00Z",
        },
        "observation_window": {
            "start": "2026-04-21T12:00:00Z",
            "end": "2026-04-21T16:00:00Z",
        },
    }
    assert writer.calls == [
        (
            "set_regression_watch",
            "exp_watch_activation",
            {"state": "armed", "armed_at": "2026-04-21T12:00:00Z"},
        ),
        (
            "set_observation_window",
            "exp_watch_activation",
            {"start": "2026-04-21T12:00:00Z", "end": "2026-04-21T16:00:00Z"},
        ),
    ]


def test_arm_watch_rejects_non_accept_decision() -> None:
    try:
        arm_watch(
            _base_envelope(decision="reject"),
            observation_window_hours=4,
            now="2026-04-21T12:00:00Z",
        )
    except ValueError as exc:
        assert str(exc) == "cannot arm watch: decision must be 'accept'"
    else:
        raise AssertionError("expected ValueError")


def test_arm_watch_rejects_missing_rollback_ref() -> None:
    try:
        arm_watch(
            _base_envelope(rollback_ref=""),
            observation_window_hours=4,
            now="2026-04-21T12:00:00Z",
        )
    except ValueError as exc:
        assert str(exc) == "cannot arm watch: missing rollback_ref"
    else:
        raise AssertionError("expected ValueError")


def test_arm_watch_rejects_missing_metrics_snapshot() -> None:
    try:
        arm_watch(
            _base_envelope(metrics_snapshot={}),
            observation_window_hours=4,
            now="2026-04-21T12:00:00Z",
        )
    except ValueError as exc:
        assert str(exc) == "cannot arm watch: missing metrics_snapshot"
    else:
        raise AssertionError("expected ValueError")


def test_observation_window_defaults_to_4_hours() -> None:
    armed = arm_watch(_base_envelope(), now="2026-04-21T12:00:00Z")

    start = datetime.fromisoformat(armed["observation_window"]["start"].replace("Z", "+00:00"))
    end = datetime.fromisoformat(armed["observation_window"]["end"].replace("Z", "+00:00"))
    assert end - start == timedelta(hours=4)


def test_arm_watch_rejects_naive_datetime() -> None:
    try:
        arm_watch(_base_envelope(), now=datetime.now())
    except ValueError as exc:
        assert str(exc) == (
            "arm_watch requires a tz-aware datetime or an ISO 8601 string with explicit offset "
            "(e.g., Z or +00:00)"
        )
    else:
        raise AssertionError("expected ValueError")


def test_arm_then_evaluate_no_regression() -> None:
    envelope = _base_envelope()
    envelope.update(arm_watch(envelope, now="2026-04-21T12:00:00Z"))

    result = evaluate_watch(
        envelope,
        _snapshot(tokens=103),
        threshold_pct=5.0,
        now="2026-04-21T12:30:00Z",
    )

    assert result == NoActionResult(reason="no-regression")


def test_arm_then_evaluate_tripped_invokes_direct_commit_adapter_rollback(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    envelope, promoted_ref, rollback_ref = _promoted_envelope(repo)
    writer = RecordingEnvelopeWriter()
    armed_fields = arm_watch(
        envelope,
        now=datetime(2026, 4, 21, 12, 0, tzinfo=timezone.utc),
        envelope_writer=writer,
    )
    envelope.update(armed_fields)
    adapter = DirectCommitAdapter(repo)
    callback = make_direct_commit_auto_revert(adapter)

    assert inspect.ismethod(callback)
    assert callback.__self__ is adapter
    assert callback.__func__ is DirectCommitAdapter.rollback

    result = evaluate_watch(
        envelope,
        _snapshot(tokens=111),
        threshold_pct=5.0,
        now="2026-04-21T12:30:00Z",
        auto_revert_callback=callback,
        envelope_writer=writer,
    )

    assert isinstance(result, TripEvent)
    assert result.rollback_result == RollbackResult(
        success=True,
        revert_ref=_git(repo, "rev-parse", "HEAD"),
        notes="reverted via git revert",
    )
    assert result.rollback_result.revert_ref not in {None, promoted_ref, rollback_ref}
    log_lines = subprocess.run(
        ["git", "log", "--oneline", "-2"],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    assert len(log_lines) == 2
    assert result.rollback_result.revert_ref.startswith(log_lines[0].split()[0])
    assert promoted_ref.startswith(log_lines[1].split()[0])
    assert "Revert" in log_lines[0]
    assert writer.calls[-2:] == [
        (
            "set_regression_watch",
            "exp-watch-live",
            {
                "state": "tripped",
                "tripped_by": _snapshot(tokens=111),
                "tripped_at": "2026-04-21T12:30:00Z",
                "rollback_result": {
                    "success": True,
                    "revert_ref": result.rollback_result.revert_ref,
                    "notes": "reverted via git revert",
                },
            },
        ),
        ("set_decision", "exp-watch-live", "reverted"),
    ]
    persisted_watch = writer.calls[-2][2]
    assert persisted_watch["rollback_result"]["revert_ref"]
    assert persisted_watch["rollback_result"]["notes"] is not None


def test_window_out_of_range_returns_correct_no_action() -> None:
    envelope = _base_envelope()
    envelope.update(arm_watch(envelope, now="2026-04-21T12:00:00Z"))

    before = evaluate_watch(
        envelope,
        _snapshot(tokens=103),
        threshold_pct=5.0,
        now="2026-04-21T11:59:59Z",
    )
    after = evaluate_watch(
        envelope,
        _snapshot(tokens=103),
        threshold_pct=5.0,
        now="2026-04-21T16:00:00Z",
    )

    assert before == NoActionResult(reason="not-yet-in-window")
    assert after == NoActionResult(reason="window-elapsed")


def test_armed_watch_evidence_is_grepable() -> None:
    armed = arm_watch(_base_envelope(), now="2026-04-21T12:00:00Z")

    assert armed["regression_watch"]["state"] == "armed"
    assert armed["regression_watch"]["armed_at"] == "2026-04-21T12:00:00Z"
    assert armed["observation_window"]["start"] == "2026-04-21T12:00:00Z"
    assert armed["observation_window"]["end"] == "2026-04-21T16:00:00Z"


def test_failed_rollback_keeps_watch_armed_for_retry() -> None:
    writer = RecordingEnvelopeWriter()
    envelope = _base_envelope()
    envelope.update(arm_watch(envelope, now="2026-04-21T12:00:00Z"))

    result = evaluate_watch(
        envelope,
        _snapshot(tokens=111),
        threshold_pct=5.0,
        now="2026-04-21T12:30:00Z",
        auto_revert_callback=lambda _envelope, _rollback_ref: RollbackResult(
            success=False,
            revert_ref=None,
            notes="simulated failure",
        ),
        envelope_writer=writer,
    )

    assert isinstance(result, TripEvent)
    assert writer.calls == [
        (
            "set_regression_watch",
            "exp_watch_activation",
            {
                "state": "armed",
                "armed_at": "2026-04-21T12:00:00Z",
                "last_rollback_attempt": {
                    "attempted_at": "2026-04-21T12:30:00Z",
                    "tripped_by": _snapshot(tokens=111),
                    "rollback_result": {
                        "success": False,
                        "revert_ref": None,
                        "notes": "simulated failure",
                    },
                },
            },
        )
    ]

    retry_envelope = dict(envelope)
    retry_envelope["regression_watch"] = writer.calls[0][2]
    retry_result = evaluate_watch(
        retry_envelope,
        _snapshot(tokens=111),
        threshold_pct=5.0,
        now="2026-04-21T12:31:00Z",
    )

    assert isinstance(retry_result, TripEvent)


def test_failed_rollback_does_not_flip_decision() -> None:
    writer = RecordingEnvelopeWriter()
    envelope = _base_envelope()
    envelope.update(arm_watch(envelope, now="2026-04-21T12:00:00Z"))

    result = evaluate_watch(
        envelope,
        _snapshot(tokens=111),
        threshold_pct=5.0,
        now="2026-04-21T12:30:00Z",
        auto_revert_callback=lambda _envelope, _rollback_ref: RollbackResult(
            success=False,
            revert_ref=None,
            notes="simulated failure",
        ),
        envelope_writer=writer,
    )

    assert isinstance(result, TripEvent)
    assert all(call[0] != "set_decision" for call in writer.calls)
