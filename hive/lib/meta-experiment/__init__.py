"""Shared runtime lifecycle library scaffold for meta-experiment flows."""

from . import envelope, baseline, compare, promotion_adapter, rollback_watch
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
    "PromotionAdapter",
    "PromotionResult",
    "PromotionEvidence",
    "RollbackResult",
    "TripEvent",
    "NoActionResult",
    "evaluate_watch",
]
