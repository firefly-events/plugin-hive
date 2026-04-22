"""Shared runtime lifecycle library scaffold for meta-experiment flows."""

from . import envelope, baseline, compare, promotion_adapter, rollback_watch, closure_validator
from .closure_validator import (
    AmbiguousEvidenceError,
    CloseValidationError,
    InvalidDecisionError,
    MissingEvidenceError,
    MissingMetricsSnapshotError,
    MissingRollbackTargetError,
    is_closable,
    validate_closable,
)
from .promotion_adapter import (
    PromotionAdapter,
    PromotionEvidence,
    PromotionResult,
    RollbackResult,
)
from .rollback_watch import NoActionResult, TripEvent, evaluate_watch

__all__ = [
    "AmbiguousEvidenceError",
    "CloseValidationError",
    "InvalidDecisionError",
    "MissingEvidenceError",
    "MissingMetricsSnapshotError",
    "MissingRollbackTargetError",
    "NoActionResult",
    "PromotionAdapter",
    "PromotionEvidence",
    "PromotionResult",
    "RollbackResult",
    "TripEvent",
    "baseline",
    "closure_validator",
    "compare",
    "envelope",
    "evaluate_watch",
    "is_closable",
    "promotion_adapter",
    "rollback_watch",
    "validate_closable",
]
