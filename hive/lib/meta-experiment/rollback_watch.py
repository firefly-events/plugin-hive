from __future__ import annotations

from dataclasses import dataclass as _dataclass
from datetime import datetime as _datetime, timezone as _timezone
from typing import Any as _Any
from typing import Protocol as _Protocol
from collections.abc import Callable as _Callable

from . import compare as _compare
from .promotion_adapter import RollbackResult as _RollbackResult


class EnvelopeWriter(_Protocol):
    def set_regression_watch(self, experiment_id: str, state: dict[str, _Any]) -> dict[str, _Any]: ...

    def set_decision(self, experiment_id: str, decision: str) -> dict[str, _Any]: ...


@_dataclass(frozen=True)
class TripEvent:
    experiment_id: str
    tripped_at: str
    tripped_by: dict[str, _Any]
    regression_metrics: list[str]
    threshold_pct: float
    rollback_ref: str
    rollback_result: _RollbackResult | None


@_dataclass(frozen=True)
class NoActionResult:
    reason: str


def evaluate_watch(
    envelope: dict[str, _Any],
    post_close_snapshot: dict[str, _Any],
    threshold_pct: float,
    now: str | _datetime,
    auto_revert_callback: _Callable[[dict[str, _Any], str], _RollbackResult] | None = None,
    envelope_writer: EnvelopeWriter | None = None,
) -> TripEvent | NoActionResult:
    """Evaluate an armed observation-window watch.

    The observation window is start-inclusive and end-exclusive: `start <= now < end`.
    If `envelope_writer` is `None`, this function skips envelope mutations but still
    returns the computed result and still invokes `auto_revert_callback` when a
    regression trips the watch.
    """

    if envelope.get("decision") != "accept":
        return NoActionResult(reason="not-accepted")

    regression_watch = envelope.get("regression_watch") or {}
    watch_state = regression_watch.get("state")
    if watch_state == "tripped":
        return NoActionResult(reason="already-tripped")
    if watch_state != "armed":
        return NoActionResult(reason="not-armed")

    now_dt, now_value = _coerce_timestamp(now)
    observation_window = envelope["observation_window"]
    window_start, _ = _coerce_timestamp(observation_window["start"])
    window_end, _ = _coerce_timestamp(observation_window["end"])

    if now_dt < window_start:
        return NoActionResult(reason="not-yet-in-window")
    if now_dt >= window_end:
        return NoActionResult(reason="window-elapsed")

    baseline_snapshot = envelope["metrics_snapshot"]
    decision = _compare.evaluate(baseline_snapshot, post_close_snapshot, threshold_pct)
    if decision["verdict"] == "accept":
        return NoActionResult(reason="no-regression")

    experiment_id = envelope["experiment_id"]
    rollback_ref = envelope["rollback_ref"]
    trip_event = TripEvent(
        experiment_id=experiment_id,
        tripped_at=now_value,
        tripped_by=post_close_snapshot,
        regression_metrics=list(decision["regression_metrics"]),
        threshold_pct=threshold_pct,
        rollback_ref=rollback_ref,
        rollback_result=None,
    )

    if envelope_writer is not None:
        envelope_writer.set_regression_watch(
            experiment_id,
            {
                "state": "tripped",
                "tripped_by": post_close_snapshot,
                "tripped_at": now_value,
            },
        )

    rollback_result = None
    if auto_revert_callback is not None:
        rollback_result = auto_revert_callback(envelope, rollback_ref)
        if rollback_result.success and envelope_writer is not None:
            envelope_writer.set_decision(experiment_id, "reverted")

    return TripEvent(
        experiment_id=trip_event.experiment_id,
        tripped_at=trip_event.tripped_at,
        tripped_by=trip_event.tripped_by,
        regression_metrics=trip_event.regression_metrics,
        threshold_pct=trip_event.threshold_pct,
        rollback_ref=trip_event.rollback_ref,
        rollback_result=rollback_result,
    )


def _coerce_timestamp(value: str | _datetime) -> tuple[_datetime, str]:
    if isinstance(value, _datetime):
        return value, _format_timestamp(value)
    if not isinstance(value, str):
        raise TypeError("timestamp must be an ISO 8601 string or datetime")

    parsed = _datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed, _format_timestamp(parsed)


def _format_timestamp(value: _datetime) -> str:
    if value.tzinfo is not None and value.utcoffset() == _timezone.utc.utcoffset(value):
        return value.astimezone(_timezone.utc).isoformat().replace("+00:00", "Z")
    return value.isoformat()


__all__ = ["EnvelopeWriter", "TripEvent", "NoActionResult", "evaluate_watch"]
