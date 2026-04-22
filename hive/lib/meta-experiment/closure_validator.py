"""Validate whether an experiment envelope is ready to close."""

from __future__ import annotations

from typing import Any as _Any


class CloseValidationError(Exception):
    """Base class for all close-validation failures."""


class MissingEvidenceError(CloseValidationError):
    """Neither commit_ref nor pr_ref is present."""


class AmbiguousEvidenceError(CloseValidationError):
    """Both commit_ref and pr_ref are set -- mutually exclusive per L1.5 contract."""


class MissingMetricsSnapshotError(CloseValidationError):
    """metrics_snapshot is absent or empty."""


class MissingRollbackTargetError(CloseValidationError):
    """rollback_ref is absent."""


class InvalidDecisionError(CloseValidationError):
    """decision is missing or not a recognized terminal/decision value."""


_CLOSABLE_DECISIONS = {"accept", "reject", "reverted"}
_PLACEHOLDER_REFS = frozenset({"tbd", "pending", "n/a", "unknown"})
def validate_closable(envelope: dict) -> None:
    """Raise a distinct validation error if the envelope cannot close."""

    if not isinstance(envelope, dict):
        raise TypeError("envelope must be a dict")

    _validate_decision(envelope)
    _validate_evidence(envelope)
    _validate_metrics_snapshot(envelope)
    _validate_rollback_ref(envelope)


def is_closable(envelope: dict) -> bool:
    """Return whether an envelope passes close validation."""

    try:
        validate_closable(envelope)
    except Exception:
        return False
    return True


def _validate_decision(envelope: dict[str, _Any]) -> None:
    decision = envelope.get("decision")
    if decision is None:
        raise InvalidDecisionError("decision is missing")
    if decision == "pending":
        raise InvalidDecisionError("decision is pending and not closable")
    if decision not in _CLOSABLE_DECISIONS:
        raise InvalidDecisionError(f"unrecognized decision value: {decision!r}")


def _validate_evidence(envelope: dict[str, _Any]) -> None:
    commit_ref_set = _has_reference(envelope.get("commit_ref"))
    # Forward-looking S10 support: the current C1 envelope schema documents
    # commit_ref only, but the closure-evidence-shape-mismatch escalation
    # requires this shared validator to accept PR-only close evidence too.
    pr_ref_set = _has_reference(envelope.get("pr_ref"))

    if commit_ref_set and pr_ref_set:
        raise AmbiguousEvidenceError("exactly one of commit_ref or pr_ref must be present; both are set")
    if not commit_ref_set and not pr_ref_set:
        raise MissingEvidenceError("either commit_ref or pr_ref must be present")


def _validate_metrics_snapshot(envelope: dict[str, _Any]) -> None:
    metrics_snapshot = envelope.get("metrics_snapshot")
    if not isinstance(metrics_snapshot, dict) or not metrics_snapshot:
        raise MissingMetricsSnapshotError("metrics_snapshot must be a non-empty dict")


def _validate_rollback_ref(envelope: dict[str, _Any]) -> None:
    if not _has_reference(envelope.get("rollback_ref")):
        raise MissingRollbackTargetError("rollback_ref must be present")


def _has_reference(value: _Any) -> bool:
    return isinstance(value, str) and value != "" and not _is_placeholder_ref(value)


def _is_placeholder_ref(value: str) -> bool:
    return value.strip().casefold() in _PLACEHOLDER_REFS


__all__ = [
    "CloseValidationError",
    "MissingEvidenceError",
    "AmbiguousEvidenceError",
    "MissingMetricsSnapshotError",
    "MissingRollbackTargetError",
    "InvalidDecisionError",
    "validate_closable",
    "is_closable",
]
