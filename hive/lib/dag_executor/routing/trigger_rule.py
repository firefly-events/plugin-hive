"""trigger_rule policy: ``none_failed_min_one_success`` (lock).

Per user-gate Q3 = ``skip_propagation_none_failed_min_one_success``,
this is the ONLY supported trigger_rule. Any other policy (Argo's
``all_success``, ``any_success``, ``always``, ``one_failed``, etc.)
is OUT OF SCOPE for hde-3a and additions are an epic-level grammar
change, not a story-level patch.

Semantics:
  * RUN if at least one upstream is COMPLETED, AND no upstream is
    in a state that should cascade halt-style failure.
  * FAILED upstreams convert to SKIP for THIS node — failure does
    NOT cascade as failure under this policy. The downstream node
    is skipped, not failed; subsequent nodes that consume its
    outputs use per-input optional semantics.
  * SKIPPED upstreams count toward the "no successes" check (zero
    successes ⇒ SKIP), but they don't independently skip the node
    if a sibling completed.

Decision values:
  * ``ActivationDecision.RUN`` — proceed with normal dispatch.
  * ``ActivationDecision.SKIP`` — mark the node SKIPPED, emit a
    ``node_skipped`` event, do not dispatch.
"""

from __future__ import annotations

from enum import Enum
from typing import Iterable

from hive.lib.dag_executor.run_state import NodeStatus

from .errors import TriggerRuleViolationError


class ActivationDecision(str, Enum):
    """Walker-facing decision returned by ``none_failed_min_one_success``."""

    RUN = "run"
    SKIP = "skip"


def none_failed_min_one_success(
    upstream_statuses: Iterable[NodeStatus],
) -> ActivationDecision:
    """Decide whether to RUN or SKIP based on upstream node statuses.

    Args:
        upstream_statuses: Statuses of every upstream (depends_on) node
            for the candidate node. May be empty (root node).

    Returns:
        ActivationDecision.RUN  iff at least one upstream is COMPLETED.
        ActivationDecision.SKIP otherwise (FAILED upstreams convert to
        SKIP; all-SKIPPED also becomes SKIP).

    Raises:
        TriggerRuleViolationError: if any upstream status is not a
            recognised NodeStatus value. Gate against silent acceptance
            of unknown enum members from a future schema migration.
    """

    statuses = list(upstream_statuses)

    # Root node (no upstreams) under this rule is always RUN — there
    # is no "min one success" requirement to violate.
    if not statuses:
        return ActivationDecision.RUN

    for status in statuses:
        if not isinstance(status, NodeStatus):
            raise TriggerRuleViolationError(
                f"upstream status {status!r} is not a NodeStatus enum value"
            )

    has_completed = any(s == NodeStatus.COMPLETED for s in statuses)
    return ActivationDecision.RUN if has_completed else ActivationDecision.SKIP
