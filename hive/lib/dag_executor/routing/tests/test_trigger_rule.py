"""Exhaustive matrix tests for ``none_failed_min_one_success``.

Per user-gate Q3 lock:
  * RUN iff ≥1 upstream is COMPLETED.
  * FAILED upstreams convert to SKIP for the candidate (no failure cascade).
  * All-SKIPPED → SKIP.
  * Empty upstream set (root nodes) → RUN.
"""

from __future__ import annotations

from itertools import product

import pytest

from hive.lib.dag_executor.routing import (
    ActivationDecision,
    TriggerRuleViolationError,
    none_failed_min_one_success,
)
from hive.lib.dag_executor.run_state import NodeStatus


# 0 upstreams (root node) → always RUN.
def test_zero_upstreams_runs():
    assert none_failed_min_one_success([]) == ActivationDecision.RUN


# 1 upstream — exhaustive single-status table.
@pytest.mark.parametrize(
    "status,expected",
    [
        (NodeStatus.COMPLETED, ActivationDecision.RUN),
        (NodeStatus.FAILED, ActivationDecision.SKIP),
        (NodeStatus.SKIPPED, ActivationDecision.SKIP),
        (NodeStatus.PENDING, ActivationDecision.SKIP),
        (NodeStatus.RUNNING, ActivationDecision.SKIP),
    ],
)
def test_single_upstream_table(status, expected):
    assert none_failed_min_one_success([status]) == expected


# 2 upstreams — every combination.
@pytest.mark.parametrize(
    "a,b",
    list(
        product(
            [
                NodeStatus.COMPLETED,
                NodeStatus.FAILED,
                NodeStatus.SKIPPED,
                NodeStatus.PENDING,
                NodeStatus.RUNNING,
            ],
            repeat=2,
        )
    ),
)
def test_two_upstream_matrix(a, b):
    expected = (
        ActivationDecision.RUN
        if NodeStatus.COMPLETED in (a, b)
        else ActivationDecision.SKIP
    )
    assert none_failed_min_one_success([a, b]) == expected


# 3 upstreams — sample combinations covering each meaningful pattern.
@pytest.mark.parametrize(
    "statuses,expected",
    [
        (
            [NodeStatus.COMPLETED, NodeStatus.COMPLETED, NodeStatus.COMPLETED],
            ActivationDecision.RUN,
        ),
        (
            [NodeStatus.COMPLETED, NodeStatus.FAILED, NodeStatus.SKIPPED],
            # ≥1 completed → RUN; FAILED converts to SKIP for THIS node
            # only matters in the absence of a sibling COMPLETED.
            ActivationDecision.RUN,
        ),
        (
            [NodeStatus.FAILED, NodeStatus.FAILED, NodeStatus.FAILED],
            ActivationDecision.SKIP,
        ),
        (
            [NodeStatus.FAILED, NodeStatus.SKIPPED, NodeStatus.SKIPPED],
            ActivationDecision.SKIP,
        ),
        (
            [NodeStatus.SKIPPED, NodeStatus.SKIPPED, NodeStatus.SKIPPED],
            ActivationDecision.SKIP,
        ),
        (
            [NodeStatus.PENDING, NodeStatus.RUNNING, NodeStatus.COMPLETED],
            ActivationDecision.RUN,
        ),
    ],
)
def test_three_upstream_combinations(statuses, expected):
    assert none_failed_min_one_success(statuses) == expected


def test_unknown_status_value_raises():
    """Defensive gate against an unrecognised enum from a future schema."""

    with pytest.raises(TriggerRuleViolationError):
        none_failed_min_one_success(["completed"])  # type: ignore[list-item]


def test_failed_does_not_cascade_as_failure():
    """Lock: failure propagation is SKIP, not FAILURE.

    Even when ALL upstreams are FAILED, the trigger-rule policy
    declines to RUN — but it does so by emitting SKIP, not by raising.
    Cascading-failure semantics belong to a different policy and are
    OUT OF SCOPE for hde-3a.
    """

    decision = none_failed_min_one_success(
        [NodeStatus.FAILED, NodeStatus.FAILED]
    )
    assert decision == ActivationDecision.SKIP
