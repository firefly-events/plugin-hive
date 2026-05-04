"""External-signal contract: approve / reject / timeout / forgery."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from hive.lib.dag_executor.executor.run_id import make_run_id
from hive.lib.dag_executor.pause import (
    DEFAULT_HARD_CEILING_SECONDS,
    PauseSignalForgedError,
    PauseTimeoutError,
    SignalKind,
    generate,
    wait_for_signal,
)


@pytest.fixture
def runs_root(tmp_path: Path) -> Path:
    return tmp_path / "runs"


@pytest.fixture(autouse=True)
def _clear_env_secret(monkeypatch):
    monkeypatch.delenv("HIVE_PAUSE_SECRET", raising=False)


# ---------------------------------------------------------------------
# Helpers — fake clock + sleep so tests don't actually wait
# ---------------------------------------------------------------------


class _FakeClock:
    """Deterministic clock; advances by `step` on every `now()` call."""

    def __init__(self, start: float = 0.0, step: float = 0.0):
        self.t = start
        self.step = step

    def now(self) -> float:
        v = self.t
        self.t += self.step
        return v


def _approve_after_two_polls(clock: _FakeClock, runs_root: Path, rid: str, node_id: str):
    """Place an approve sentinel on the third sleep tick."""

    sentinel = runs_root / rid / "pause" / f"{node_id}.approve"
    counter = {"n": 0}

    def _sleep(_seconds):
        counter["n"] += 1
        if counter["n"] == 2:
            token = generate(rid, node_id, runs_root)
            sentinel.parent.mkdir(parents=True, exist_ok=True)
            sentinel.write_text(token, encoding="utf-8")

    return _sleep


# ---------------------------------------------------------------------
# Approve / reject paths
# ---------------------------------------------------------------------


def test_approve_sentinel_with_valid_token_returns_approved(runs_root: Path):
    rid = make_run_id("pause-test")
    node_id = "human_approval"
    clock = _FakeClock(step=0.1)
    sleep_fn = _approve_after_two_polls(clock, runs_root, rid, node_id)

    result = wait_for_signal(
        run_id=rid,
        node_id=node_id,
        runs_root=runs_root,
        poll_interval=0,
        clock=clock.now,
        sleep=sleep_fn,
    )
    assert result.kind == SignalKind.APPROVED
    assert result.reason is None


def test_reject_sentinel_with_reason_returns_rejected(runs_root: Path):
    rid = make_run_id("pause-test")
    node_id = "human_approval"
    base = runs_root / rid / "pause"
    base.mkdir(parents=True, exist_ok=True)
    token = generate(rid, node_id, runs_root)
    (base / f"{node_id}.reject").write_text(
        f"{token}\n\noperator says no", encoding="utf-8"
    )
    result = wait_for_signal(
        run_id=rid,
        node_id=node_id,
        runs_root=runs_root,
        poll_interval=0,
        clock=lambda: 0.0,
        sleep=lambda _s: None,
    )
    assert result.kind == SignalKind.REJECTED
    assert result.reason == "operator says no"


def test_pause_directory_created_with_mode_0700(runs_root: Path):
    rid = make_run_id("pause-test")
    node_id = "human_approval"
    base = runs_root / rid / "pause"
    base.mkdir(parents=True, exist_ok=True)
    token = generate(rid, node_id, runs_root)
    (base / f"{node_id}.approve").write_text(token, encoding="utf-8")
    wait_for_signal(
        run_id=rid,
        node_id=node_id,
        runs_root=runs_root,
        poll_interval=0,
        clock=lambda: 0.0,
        sleep=lambda _s: None,
    )
    mode = os.stat(base).st_mode & 0o777
    assert mode == 0o700, f"pause dir mode must be 0700, got {oct(mode)}"


# ---------------------------------------------------------------------
# Forgery defense (security:plan-audit finding #2)
# ---------------------------------------------------------------------


def test_approve_sentinel_without_valid_token_raises_forged(runs_root: Path):
    rid = make_run_id("pause-test")
    node_id = "human_approval"
    base = runs_root / rid / "pause"
    base.mkdir(parents=True, exist_ok=True)
    (base / f"{node_id}.approve").write_text("not-a-real-token", encoding="utf-8")
    with pytest.raises(PauseSignalForgedError):
        wait_for_signal(
            run_id=rid,
            node_id=node_id,
            runs_root=runs_root,
            poll_interval=0,
            clock=lambda: 0.0,
            sleep=lambda _s: None,
        )


def test_approve_sentinel_with_token_for_different_node_raises_forged(runs_root: Path):
    """Cross-node replay defense (Risk #10)."""

    rid = make_run_id("pause-test")
    base = runs_root / rid / "pause"
    base.mkdir(parents=True, exist_ok=True)
    foreign_token = generate(rid, "different_node", runs_root)
    (base / "human_approval.approve").write_text(foreign_token, encoding="utf-8")
    with pytest.raises(PauseSignalForgedError):
        wait_for_signal(
            run_id=rid,
            node_id="human_approval",
            runs_root=runs_root,
            poll_interval=0,
            clock=lambda: 0.0,
            sleep=lambda _s: None,
        )


def test_approve_sentinel_with_token_from_different_run_raises_forged(runs_root: Path):
    """Cross-run replay defense (Risk #10)."""

    rid_a = make_run_id("pause-test")
    rid_b = make_run_id("pause-test")
    foreign_token = generate(rid_a, "human_approval", runs_root)
    base_b = runs_root / rid_b / "pause"
    base_b.mkdir(parents=True, exist_ok=True)
    (base_b / "human_approval.approve").write_text(foreign_token, encoding="utf-8")
    with pytest.raises(PauseSignalForgedError):
        wait_for_signal(
            run_id=rid_b,
            node_id="human_approval",
            runs_root=runs_root,
            poll_interval=0,
            clock=lambda: 0.0,
            sleep=lambda _s: None,
        )


# ---------------------------------------------------------------------
# Timeout — user-configured + hard-ceiling security floor
# ---------------------------------------------------------------------


def test_timeout_raises_pause_timeout(runs_root: Path):
    rid = make_run_id("pause-test")
    times = iter([0.0, 5.1, 10.1])
    with pytest.raises(PauseTimeoutError):
        wait_for_signal(
            run_id=rid,
            node_id="human_approval",
            runs_root=runs_root,
            timeout_seconds=5,
            poll_interval=0,
            clock=lambda: next(times),
            sleep=lambda _s: None,
        )


def test_hard_ceiling_caps_no_timeout_default(runs_root: Path):
    """`timeout_seconds=None` still terminates after the security floor."""

    rid = make_run_id("pause-test")
    # First poll at t=0, then ceiling+1 elapsed → must raise.
    times = iter([0.0, DEFAULT_HARD_CEILING_SECONDS + 1.0])
    with pytest.raises(PauseTimeoutError):
        wait_for_signal(
            run_id=rid,
            node_id="human_approval",
            runs_root=runs_root,
            timeout_seconds=None,
            poll_interval=0,
            clock=lambda: next(times),
            sleep=lambda _s: None,
        )


def test_user_timeout_clamped_to_hard_ceiling(runs_root: Path):
    """A user-set timeout above the hard ceiling reads as the ceiling."""

    rid = make_run_id("pause-test")
    times = iter([0.0, DEFAULT_HARD_CEILING_SECONDS + 1.0])
    with pytest.raises(PauseTimeoutError) as exc:
        wait_for_signal(
            run_id=rid,
            node_id="human_approval",
            runs_root=runs_root,
            timeout_seconds=DEFAULT_HARD_CEILING_SECONDS * 10,
            poll_interval=0,
            clock=lambda: next(times),
            sleep=lambda _s: None,
        )
    msg = str(exc.value)
    assert str(DEFAULT_HARD_CEILING_SECONDS) in msg
