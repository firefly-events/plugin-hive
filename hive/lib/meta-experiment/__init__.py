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
from .direct_commit_adapter import DirectCommitAdapter, PromotionFailure
from .promotion_adapter import (
    PromotionAdapter,
    PromotionEvidence,
    PromotionResult,
    RollbackResult,
)
from .rollback_watch import NoActionResult, TripEvent, evaluate_watch
from .rollback_watch import (
    __getattr__ as _rollback_watch_getattr,
)

arm_watch = _rollback_watch_getattr("arm_watch")
make_direct_commit_auto_revert = _rollback_watch_getattr("make_direct_commit_auto_revert")

__all__ = [
    "AmbiguousEvidenceError",
    "CloseValidationError",
    "DirectCommitAdapter",
    "InvalidDecisionError",
    "MissingEvidenceError",
    "MissingMetricsSnapshotError",
    "MissingRollbackTargetError",
    "NoActionResult",
    "PromotionAdapter",
    "PromotionEvidence",
    "PromotionFailure",
    "PromotionResult",
    "RollbackResult",
    "TripEvent",
    "arm_watch",
    "baseline",
    "closure_validator",
    "compare",
    "envelope",
    "evaluate_watch",
    "is_closable",
    "make_direct_commit_auto_revert",
    "promotion_adapter",
    "rollback_watch",
    "validate_closable",
]
