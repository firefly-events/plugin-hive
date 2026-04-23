"""Define shared promotion and rollback adapter contracts."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class PromotionEvidence:
    """Promotion evidence carrying exactly one close reference."""

    commit_ref: str | None = None
    pr_ref: str | None = None
    pr_state: str | None = None

    def __post_init__(self) -> None:
        if bool(self.commit_ref) == bool(self.pr_ref):
            raise ValueError("exactly one of commit_ref or pr_ref must be set")
        if self.pr_ref is not None and self.pr_state is None:
            raise ValueError("pr_state must be set when pr_ref is provided")
        if self.commit_ref is not None and self.pr_state is not None:
            raise ValueError("pr_state must be None when commit_ref is provided")


@dataclass(frozen=True)
class PromotionResult:
    """Promotion outcome details returned by an adapter."""

    success: bool
    evidence: PromotionEvidence
    rollback_target: str
    notes: str | None = None


@dataclass(frozen=True)
class RollbackResult:
    """Rollback outcome details returned by an adapter."""

    success: bool
    # Commit hash created by the rollback operation itself.
    revert_ref: str | None = None
    # Git reference that the rollback operation targeted.
    rollback_target: str | None = None
    notes: str | None = None


class PromotionAdapter(ABC):
    """Abstract seam shared by maintainer and public promotion paths."""

    @abstractmethod
    def promote(self, envelope: dict[str, Any], decision: dict[str, Any]) -> PromotionResult:
        """Promote a candidate using the adapter-specific policy.

        Concrete implementations MAY raise PromotionFailure to signal failure
        paths that have no valid commit_ref (e.g., merge conflict,
        verdict=needs_revision). Callers must catch it and treat as promotion
        failure with main tree unchanged.
        """

    @abstractmethod
    def rollback(self, envelope: dict[str, Any], rollback_ref: str) -> RollbackResult:
        """Rollback a prior promotion using the adapter-specific policy.

        Concrete implementations SHOULD return RollbackResult(success=False, ...)
        on recoverable failure (e.g., revert conflict) rather than raising, so
        the rollback watch loop can distinguish recoverable from catastrophic
        failure.
        """
