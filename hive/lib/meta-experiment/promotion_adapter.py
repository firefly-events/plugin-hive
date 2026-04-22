from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class PromotionEvidence:
    commit_ref: str | None = None
    pr_ref: str | None = None

    def __post_init__(self) -> None:
        if bool(self.commit_ref) == bool(self.pr_ref):
            raise ValueError("exactly one of commit_ref or pr_ref must be set")


@dataclass(frozen=True)
class PromotionResult:
    success: bool
    evidence: PromotionEvidence
    rollback_target: str
    notes: str | None = None


@dataclass(frozen=True)
class RollbackResult:
    success: bool
    revert_ref: str | None = None
    notes: str | None = None


class PromotionAdapter(ABC):
    """Abstract seam shared by maintainer and public promotion paths."""

    @abstractmethod
    def promote(self, envelope: dict[str, Any], decision: dict[str, Any]) -> PromotionResult:
        """Promote a candidate using the adapter-specific policy."""

    @abstractmethod
    def rollback(self, envelope: dict[str, Any], rollback_ref: str) -> RollbackResult:
        """Rollback a prior promotion using the adapter-specific policy."""
