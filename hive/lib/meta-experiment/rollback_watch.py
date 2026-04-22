"""Watch accepted experiments for post-close regressions and rollbacks."""

from __future__ import annotations

from collections.abc import Callable as _Callable
from dataclasses import dataclass as _dataclass, replace as _replace
from datetime import datetime as _datetime, timedelta as _timedelta, timezone as _timezone
from typing import Any as _Any
from typing import Protocol as _Protocol

from . import compare as _compare
from .closure_validator import _has_reference as _has_reference
from .promotion_adapter import RollbackResult as _RollbackResult


class EnvelopeWriter(_Protocol):
    """Protocol for the envelope mutations used by regression watching."""

    def set_regression_watch(self, experiment_id: str, state: dict[str, _Any]) -> dict[str, _Any]: ...

    def set_observation_window(
        self, experiment_id: str, window: dict[str, _Any]
    ) -> dict[str, _Any]: ...

    def set_decision(self, experiment_id: str, decision: str) -> dict[str, _Any]: ...


@_dataclass(frozen=True)
class TripEvent:
    """Captured details for a regression-watch trip."""

    experiment_id: str
    tripped_at: str
    tripped_by: dict[str, _Any]
    regression_metrics: list[str]
    threshold_pct: float
    rollback_ref: str
    rollback_result: _RollbackResult | None


@_dataclass(frozen=True)
class NoActionResult:
    """Reason no rollback-watch action was taken."""

    reason: str


def _arm_watch(
    envelope: dict[str, _Any],
    observation_window_hours: int | float = 4,
    now: str | _datetime = None,
    envelope_writer: EnvelopeWriter | None = None,
) -> dict[str, dict[str, _Any]]:
    if envelope.get("decision") != "accept":
        raise ValueError("cannot arm watch: decision must be 'accept'")
    if not _has_reference(envelope.get("rollback_ref")):
        raise ValueError("cannot arm watch: missing rollback_ref")

    metrics_snapshot = envelope.get("metrics_snapshot")
    if not isinstance(metrics_snapshot, dict) or not metrics_snapshot:
        raise ValueError("cannot arm watch: missing metrics_snapshot")

    if now is None:
        raise TypeError("now must be an ISO 8601 string or datetime")

    start_dt, start_iso = _coerce_timestamp(now)
    if start_dt.tzinfo is None:
        raise ValueError(
            "arm_watch requires a tz-aware datetime or an ISO 8601 string with explicit offset (e.g., Z or +00:00)"
        )
    end_iso = _format_timestamp(start_dt + _timedelta(hours=observation_window_hours))
    regression_watch = {"state": "armed", "armed_at": start_iso}
    observation_window = {"start": start_iso, "end": end_iso}

    if envelope_writer is not None:
        experiment_id = envelope["experiment_id"]
        envelope_writer.set_regression_watch(experiment_id, regression_watch)
        envelope_writer.set_observation_window(experiment_id, observation_window)

    return {
        "regression_watch": regression_watch,
        "observation_window": observation_window,
    }


def _make_direct_commit_auto_revert(
    adapter: _Any,
) -> _Callable[[dict[str, _Any], str], _RollbackResult]:
    """Return a direct-commit rollback callback with an inspectable binding."""

    return adapter.rollback


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

    If the auto_revert_callback returns success=False or raises, the envelope
    remains armed and records the failed rollback attempt so operators may retry
    evaluate_watch or invoke adapter.rollback directly.
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

    rollback_result = None
    if auto_revert_callback is not None:
        try:
            rollback_result = auto_revert_callback(envelope, rollback_ref)
        except Exception:
            if envelope_writer is not None:
                armed_at = (envelope.get("regression_watch") or {}).get("armed_at")
                envelope_writer.set_regression_watch(
                    experiment_id,
                    {
                        "state": "armed",
                        "armed_at": armed_at,
                        "last_rollback_attempt": {
                            "attempted_at": now_value,
                            "tripped_by": post_close_snapshot,
                        },
                    },
                )
            raise

    rollback_succeeded = rollback_result is not None and rollback_result.success
    no_callback_configured = rollback_result is None
    if rollback_succeeded or no_callback_configured:
        regression_watch_record = {
            "state": "tripped",
            "tripped_by": post_close_snapshot,
            "tripped_at": now_value,
        }
        if rollback_result is not None:
            regression_watch_record["rollback_result"] = {
                "success": rollback_result.success,
                "revert_ref": rollback_result.revert_ref,
                "notes": rollback_result.notes,
            }
    else:
        armed_at = (envelope.get("regression_watch") or {}).get("armed_at")
        regression_watch_record = {
            "state": "armed",
            "armed_at": armed_at,
            "last_rollback_attempt": {
                "attempted_at": now_value,
                "tripped_by": post_close_snapshot,
                "rollback_result": {
                    "success": rollback_result.success,
                    "revert_ref": rollback_result.revert_ref,
                    "notes": rollback_result.notes,
                },
            },
        }

    if envelope_writer is not None:
        envelope_writer.set_regression_watch(experiment_id, regression_watch_record)
        if rollback_succeeded:
            envelope_writer.set_decision(experiment_id, "reverted")

    return _replace(trip_event, rollback_result=rollback_result)


def _coerce_timestamp(value: str | _datetime) -> tuple[_datetime, str]:
    if isinstance(value, _datetime):
        return value, _format_timestamp(value)
    if not isinstance(value, str):
        raise TypeError("timestamp must be an ISO 8601 string or datetime")

    parsed = _datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed, _format_timestamp(parsed)


def _format_timestamp(value: _datetime) -> str:
    if value.tzinfo is not None and value.utcoffset() == _timedelta(0):
        return value.astimezone(_timezone.utc).isoformat().replace("+00:00", "Z")
    return value.isoformat()


__all__ = ["EnvelopeWriter", "TripEvent", "NoActionResult", "evaluate_watch"]


def __getattr__(name: str) -> _Any:
    if name == "arm_watch":
        return _arm_watch
    if name == "make_direct_commit_auto_revert":
        return _make_direct_commit_auto_revert
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
