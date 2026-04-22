"""Wrap shared envelope reads and narrow field updates for experiments."""

from __future__ import annotations

from typing import Any

from hive.lib.metrics import create_envelope, read_envelope, update_envelope


def create(envelope_dict: dict[str, Any]) -> dict[str, Any]:
    """Create a new experiment envelope through the metrics substrate."""
    return create_envelope(envelope_dict)


def load(experiment_id: str) -> dict[str, Any]:
    """Load an experiment envelope by id."""
    return read_envelope(experiment_id)


def set_decision(experiment_id: str, decision: str) -> dict[str, Any]:
    """Update only the decision field on an existing envelope."""
    return update_envelope(experiment_id, {"decision": decision})


def set_regression_watch(experiment_id: str, watch_state_dict: dict[str, Any]) -> dict[str, Any]:
    """Update only the regression watch field on an existing envelope."""
    return update_envelope(experiment_id, {"regression_watch": watch_state_dict})


def set_observation_window(experiment_id: str, window_dict: dict[str, Any]) -> dict[str, Any]:
    """Update only the observation window field on an existing envelope."""
    return update_envelope(experiment_id, {"observation_window": window_dict})


def set_commit_ref(experiment_id: str, commit_ref: str) -> dict[str, Any]:
    """Update only the commit reference field on an existing envelope."""
    return update_envelope(experiment_id, {"commit_ref": commit_ref})


def set_rollback_ref(experiment_id: str, rollback_ref: str) -> dict[str, Any]:
    """Update only the rollback reference field on an existing envelope."""
    return update_envelope(experiment_id, {"rollback_ref": rollback_ref})


def set_metrics_snapshot(experiment_id: str, snapshot_dict: dict[str, Any]) -> dict[str, Any]:
    """Update only the metrics snapshot field on an existing envelope."""
    return update_envelope(experiment_id, {"metrics_snapshot": snapshot_dict})
