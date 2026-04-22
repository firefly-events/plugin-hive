from __future__ import annotations

from typing import Any

from hive.lib.metrics import delta_compare, read_baseline_metrics


def evaluate(
    baseline_metrics: dict[str, Any], candidate_metrics: dict[str, Any], threshold_pct: float
) -> dict[str, Any]:
    raw_metrics = delta_compare(baseline_metrics, candidate_metrics)

    metrics: dict[str, dict[str, Any]] = {}
    regression_metrics: list[str] = []
    for metric_name, raw_result in raw_metrics.items():
        metric_result = dict(raw_result)
        over_threshold = _is_over_threshold(metric_result, threshold_pct)
        metric_result["over_threshold"] = over_threshold
        metrics[metric_name] = metric_result
        if over_threshold:
            regression_metrics.append(metric_name)

    return {
        "verdict": "reject" if regression_metrics else "accept",
        "threshold_pct": threshold_pct,
        "metrics": metrics,
        "regression_metrics": regression_metrics,
    }


def evaluate_from_envelope(
    envelope_dict: dict[str, Any], candidate_metrics: dict[str, Any], threshold_pct: float
) -> dict[str, Any]:
    baseline_metrics = read_baseline_metrics(envelope_dict)
    return evaluate(baseline_metrics, candidate_metrics, threshold_pct)


def _is_over_threshold(metric_result: dict[str, Any], threshold_pct: float) -> bool:
    if "changed" in metric_result:
        return False

    delta_pct = metric_result.get("delta_pct")
    return delta_pct is not None and delta_pct > threshold_pct
