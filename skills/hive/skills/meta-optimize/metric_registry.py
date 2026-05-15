"""Tolerant metric-name normalization for the public meta-optimize path.

Known dimensions are preserved as top-level keys. Unknown dimensions are
skipped and recorded under ``skipped_dimensions`` in sorted order so callers
can tolerate consumer-supplied metrics without widening the shared carrier.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterable

KNOWN_DIMENSIONS = frozenset(
    {
    "tokens",
    "wall_clock_ms",
    "fix_loop_iterations",
    "first_attempt_pass",
    "human_escalation",
    }
)

REGISTERED_COUNTERS = {
    "kg_writes_total": ("predicate",),
    "kg_signal_findings_total": ("cycle_id",),
    "kg_signal_proposals_total": ("cycle_id",),
}

REGISTERED_GAUGES = {
    "hit_rate_5cycle": (),
}

_counter_values: dict[str, defaultdict[tuple[str, ...], int]] = {
    name: defaultdict(int) for name in REGISTERED_COUNTERS
}
_gauge_values: dict[str, float] = {name: 0.0 for name in REGISTERED_GAUGES}


def is_known_dimension(name: str) -> bool:
    return name in KNOWN_DIMENSIONS


def is_registered_counter(name: str) -> bool:
    return name in REGISTERED_COUNTERS


def is_registered_gauge(name: str) -> bool:
    return name in REGISTERED_GAUGES


def counter_labels(name: str) -> tuple[str, ...]:
    if name not in REGISTERED_COUNTERS:
        raise ValueError(f"unknown counter: {name}")
    return REGISTERED_COUNTERS[name]


def gauge_labels(name: str) -> tuple[str, ...]:
    if name not in REGISTERED_GAUGES:
        raise ValueError(f"unknown gauge: {name}")
    return REGISTERED_GAUGES[name]


def increment_counter(name: str, labels: dict[str, str], by: int = 1) -> int:
    if by < 0:
        raise ValueError("counter increments must be non-negative")
    label_names = counter_labels(name)
    label_key = _label_key(name, label_names, labels)
    _counter_values[name][label_key] += by
    return _counter_values[name][label_key]


def counter_value(name: str, labels: dict[str, str]) -> int:
    label_names = counter_labels(name)
    label_key = _label_key(name, label_names, labels)
    return _counter_values[name][label_key]


def set_gauge(name: str, value: float) -> float:
    if name not in REGISTERED_GAUGES:
        raise ValueError(f"unknown gauge: {name}")
    _gauge_values[name] = float(value)
    return _gauge_values[name]


def gauge_value(name: str) -> float:
    if name not in REGISTERED_GAUGES:
        raise ValueError(f"unknown gauge: {name}")
    return _gauge_values[name]


def compute_hit_rate_5cycle(cycle_entries: Iterable[dict[str, Any]]) -> float:
    entries = list(cycle_entries)
    if not entries:
        return 0.0
    window = entries[-5:]
    hits = sum(1 for entry in window if _kg_signal_proposal_count(entry) > 0)
    return hits / len(window)


def update_hit_rate_5cycle(cycle_entries: Iterable[dict[str, Any]]) -> float:
    return set_gauge("hit_rate_5cycle", compute_hit_rate_5cycle(cycle_entries))


def reset_metrics_for_test() -> None:
    for values in _counter_values.values():
        values.clear()
    for name in _gauge_values:
        _gauge_values[name] = 0.0


def _label_key(name: str, label_names: tuple[str, ...], labels: dict[str, str]) -> tuple[str, ...]:
    missing = [label for label in label_names if label not in labels]
    if missing:
        raise ValueError(f"missing labels for {name}: {', '.join(missing)}")
    unexpected = sorted(set(labels) - set(label_names))
    if unexpected:
        raise ValueError(f"unexpected labels for {name}: {', '.join(unexpected)}")
    return tuple(str(labels[label]) for label in label_names)


def _kg_signal_proposal_count(entry: dict[str, Any]) -> int:
    raw = entry.get("kg_signal_proposals_total", 0)
    if isinstance(raw, dict):
        raw = raw.get("value", raw.get("count", 0))
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


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
        # Reserve the synthetic output key so caller input cannot clobber it.
        if name == "skipped_dimensions":
            raise ValueError("skipped_dimensions is reserved for normalization output")
        if is_known_dimension(name):
            normalized[name] = value
            continue
        skipped.add(name)

    if skipped:
        normalized["skipped_dimensions"] = sorted(skipped)
    return normalized
