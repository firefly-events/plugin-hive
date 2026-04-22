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
    "envelope",
    "baseline",
    "compare",
    "promotion_adapter",
    "rollback_watch",
    "closure_validator",
    "validate_closable",
    "is_closable",
    "CloseValidationError",
    "MissingEvidenceError",
    "AmbiguousEvidenceError",
    "MissingMetricsSnapshotError",
    "MissingRollbackTargetError",
    "InvalidDecisionError",
    "PromotionAdapter",
    "PromotionResult",
    "PromotionEvidence",
    "RollbackResult",
    "TripEvent",
    "NoActionResult",
    "evaluate_watch",
]
