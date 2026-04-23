"""Tolerant metric-name normalization for the public meta-optimize path.

Known dimensions are preserved as top-level keys. Unknown dimensions are
skipped and recorded under ``skipped_dimensions`` in sorted order so callers
can tolerate consumer-supplied metrics without widening the shared carrier.
"""

from __future__ import annotations

from typing import Any

KNOWN_DIMENSIONS = (
    "tokens",
    "wall_clock_ms",
    "fix_loop_iterations",
    "first_attempt_pass",
    "human_escalation",
)


def is_known_dimension(name: str) -> bool:
    return name in KNOWN_DIMENSIONS


def normalize_dimensions(raw_metrics: list[dict[str, Any]] | dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    skipped: set[str] = set()

    if isinstance(raw_metrics, dict):
        items = raw_metrics.items()
    else:
        items = (
            (row.get("metric_type"), row.get("value"))
            for row in raw_metrics
            if isinstance(row, dict)
        )

    for name, value in items:
        if not isinstance(name, str) or not name:
            continue
        if is_known_dimension(name):
            normalized[name] = value
            continue
        skipped.add(name)

    if skipped:
        normalized["skipped_dimensions"] = sorted(skipped)
    return normalized
