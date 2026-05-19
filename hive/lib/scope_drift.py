"""Scope-drift scoring helper.

Computes a bucketed score for how phase output compares to phase input
and (optionally) emits a ``scope_drift_score`` metric event row.

Buckets (v1, per user direction — easier to grade and read than 0-1):

    ``none``       expected == delivered, no drift
    ``minor``      small drift in one direction
    ``major``      scope-creep ≥ 2x expected, or ≥ half of expected dropped
    ``divergent``  no overlap between expected and delivered (replacement)

The ``delta_reasons`` list caps the bucket at ``minor`` when ``blocked``
is present — blocked drift is acknowledged, not divergence.

Maturity gate: emits are skipped when the project's resolved maturity is
``greenfield`` or ``early`` (per story ``ed-1-maturity-helper``). The
helper imports ``hive.lib.project_maturity.resolve_maturity`` defensively
— if that module is not present on disk yet, we default to ``early``,
which produces a skip-with-reason log line so consumers can tell the
difference between "no events on purpose" and "emit path broken".
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from .metrics.core import append_event

BUCKETS = ("none", "minor", "major", "divergent")
BUCKET_ORDINALS = {bucket: idx for idx, bucket in enumerate(BUCKETS)}

SKIP_MATURITIES = {"greenfield", "early"}

_log = logging.getLogger(__name__)
_skip_logged_for_run: set[str] = set()


def compute_scope_drift(
    expected_scope: list[str] | None,
    delivered_scope: list[str] | None,
    delta_reasons: list[str] | None = None,
) -> dict[str, Any]:
    """Score a single phase boundary.

    Returns a dict with ``bucket``, ``ordinal``, ``n_expected``,
    ``n_delivered``, ``n_dropped``, ``n_added``, and ``n_common``. The
    caller chooses what to do with the result; ``emit_scope_drift`` is
    the canonical writer.
    """
    expected_list = list(expected_scope or [])
    delivered_list = list(delivered_scope or [])
    reasons = list(delta_reasons or [])

    expected_set = set(expected_list)
    delivered_set = set(delivered_list)

    dropped = expected_set - delivered_set
    added = delivered_set - expected_set
    common = expected_set & delivered_set

    n_expected = len(expected_set)
    n_delivered = len(delivered_set)
    n_dropped = len(dropped)
    n_added = len(added)
    n_common = len(common)

    bucket = _bucket_for(
        n_expected=n_expected,
        n_delivered=n_delivered,
        n_dropped=n_dropped,
        n_added=n_added,
        n_common=n_common,
        reasons=reasons,
    )

    return {
        "bucket": bucket,
        "ordinal": BUCKET_ORDINALS[bucket],
        "n_expected": n_expected,
        "n_delivered": n_delivered,
        "n_dropped": n_dropped,
        "n_added": n_added,
        "n_common": n_common,
    }


def emit_scope_drift(
    run_id: str,
    phase_label: str,
    expected_scope: list[str] | None,
    delivered_scope: list[str] | None,
    delta_reasons: list[str] | None = None,
    *,
    story_id: str | None = None,
    proposal_id: str | None = None,
    skill: str | None = None,
    source: str = "scope-drift-helper",
    extra_dimensions: dict[str, Any] | None = None,
    maturity: str | None = None,
) -> dict[str, Any] | None:
    """Emit one ``scope_drift_score`` event row.

    Returns the appended event dict on success, or ``None`` when the
    maturity gate caused the emit to be skipped. ``story_id`` and
    ``proposal_id`` follow the one-of rule from
    ``hive/references/metrics-event.schema.md`` — pass exactly one (or
    neither, in which case the helper defaults ``proposal_id`` to
    ``"runtime:" + phase_label`` so the row still validates).
    """
    resolved_maturity = maturity if maturity is not None else _resolve_maturity_safe()
    if resolved_maturity in SKIP_MATURITIES:
        if run_id not in _skip_logged_for_run:
            _log.info(
                "scope_drift_score: emit skipped — project_maturity=%s "
                "(run_id=%s, gate=%s)",
                resolved_maturity,
                run_id,
                "ed-1-maturity",
            )
            _skip_logged_for_run.add(run_id)
        return None

    score = compute_scope_drift(expected_scope, delivered_scope, delta_reasons)

    dimensions: dict[str, Any] = {
        "bucket": score["bucket"],
        "phase_label": phase_label,
        "n_expected": score["n_expected"],
        "n_delivered": score["n_delivered"],
        "n_dropped": score["n_dropped"],
        "n_added": score["n_added"],
    }
    if delta_reasons:
        dimensions["delta_reasons"] = list(delta_reasons)
    if skill:
        dimensions["skill"] = skill
    if extra_dimensions:
        for key, value in extra_dimensions.items():
            if key not in dimensions:
                dimensions[key] = value

    event: dict[str, Any] = {
        "event_id": f"evt_scope_drift_{uuid.uuid4().hex[:12]}",
        "timestamp": _now_iso(),
        "run_id": run_id,
        "metric_type": "scope_drift_score",
        "value": score["ordinal"],
        "unit": "bucket",
        "dimensions": dimensions,
        "source": source,
    }
    if story_id is not None:
        event["story_id"] = story_id
    elif proposal_id is not None:
        event["proposal_id"] = proposal_id
    else:
        event["proposal_id"] = f"runtime:{phase_label}"

    return append_event(event, run_id)


def reset_skip_log_cache() -> None:
    """Test seam: clear the once-per-run skip-log dedupe set."""
    _skip_logged_for_run.clear()


def _bucket_for(
    *,
    n_expected: int,
    n_delivered: int,
    n_dropped: int,
    n_added: int,
    n_common: int,
    reasons: list[str],
) -> str:
    if n_expected == 0 and n_delivered == 0:
        return "none"

    if "blocked" in reasons:
        if n_dropped == 0 and n_added == 0:
            return "none"
        return "minor"

    if n_dropped == 0 and n_added == 0:
        return "none"

    if n_common == 0 and n_expected > 0 and n_delivered > 0:
        return "divergent"

    if n_expected > 0 and n_added >= 2 * n_expected:
        return "major"
    if n_expected >= 2 and n_dropped * 2 >= n_expected:
        return "major"
    if n_expected == 0 and n_added >= 2:
        return "major"

    return "minor"


def _resolve_maturity_safe() -> str:
    """Resolve project maturity via ``hive.lib.project_maturity`` if available.

    The ed-1 helper landed on a separate branch and was closed pending a
    rewrite under the project-purpose detection model. Until that lands,
    a missing module defaults to ``early`` so emits are skipped — the
    same conservative posture the ed-1 helper applies for placeholder
    profiles.
    """
    try:
        from .project_maturity import resolve_maturity  # type: ignore[import-not-found]
    except Exception:
        return "early"

    try:
        return resolve_maturity()
    except Exception as exc:
        _log.warning(
            "scope_drift_score: resolve_maturity() raised %s — defaulting to 'early'",
            exc,
        )
        return "early"


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
