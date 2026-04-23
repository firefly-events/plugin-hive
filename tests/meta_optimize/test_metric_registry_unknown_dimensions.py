from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
REGISTRY_PATH = ROOT / "skills/hive/skills/meta-optimize/metric_registry.py"


def _load_registry_module():
    module_name = "tests.meta_optimize._metric_registry"
    spec = importlib.util.spec_from_file_location(module_name, REGISTRY_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load metric_registry.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _load_meta_experiment():
    module_name = "tests.meta_optimize._meta_experiment_unknown_dimensions"
    module_dir = ROOT / "hive/lib/meta-experiment"
    spec = importlib.util.spec_from_file_location(
        module_name,
        module_dir / "__init__.py",
        submodule_search_locations=[str(module_dir)],
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load meta-experiment package")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _event(run_id: str, event_id: str, metric_type: str, value: object, unit: str) -> dict[str, object]:
    return {
        "event_id": event_id,
        "timestamp": "2026-04-20T14:00:00Z",
        "run_id": run_id,
        "swarm_id": "meta-meta-optimize",
        "story_id": "BL3.4",
        "phase": "verification",
        "agent": "tester",
        "metric_type": metric_type,
        "value": value,
        "unit": unit,
        "dimensions": {},
        "source": "test-fixture",
    }


def test_normalize_dimensions_preserves_known_and_tracks_unknowns() -> None:
    registry = _load_registry_module()

    normalized = registry.normalize_dimensions(
        {
            "tokens": 120,
            "wall_clock_ms": 55,
            "custom_latency_p95": 11,
            "team_score": 3,
        }
    )

    assert normalized["tokens"] == 120
    assert normalized["wall_clock_ms"] == 55
    assert normalized["skipped_dimensions"] == ["custom_latency_p95", "team_score"]
    assert "custom_latency_p95" not in normalized


def test_is_known_dimension_matches_mvp_set_only() -> None:
    registry = _load_registry_module()

    assert registry.is_known_dimension("tokens") is True
    assert registry.is_known_dimension("wall_clock_ms") is True
    assert registry.is_known_dimension("fix_loop_iterations") is True
    assert registry.is_known_dimension("first_attempt_pass") is True
    assert registry.is_known_dimension("human_escalation") is True
    assert registry.is_known_dimension("tokens_per_story") is False
    assert registry.is_known_dimension("custom_latency_p95") is False


def test_capture_from_run_tolerates_unknown_metric_dimensions() -> None:
    meta_experiment = _load_meta_experiment()

    with tempfile.TemporaryDirectory() as temp_dir:
        metrics_root = Path(temp_dir) / ".pHive" / "metrics"
        events_dir = metrics_root / "events"
        events_dir.mkdir(parents=True, exist_ok=True)
        prior_metrics_root = os.environ.get("METRICS_ROOT")
        os.environ["METRICS_ROOT"] = str(metrics_root)
        try:
            run_id = "run_unknown_metric"
            rows = [
                _event(run_id, "evt_001", "tokens", 100, "tokens"),
                _event(run_id, "evt_002", "custom_latency_p95", 44, "ms"),
                _event(run_id, "evt_003", "first_attempt_pass", True, "bool"),
            ]
            with (events_dir / f"{run_id}.jsonl").open("w", encoding="utf-8") as handle:
                for row in rows:
                    handle.write(json.dumps(row, sort_keys=True))
                    handle.write("\n")

            snapshot = meta_experiment.baseline.capture_from_run(run_id)
        finally:
            if prior_metrics_root is None:
                os.environ.pop("METRICS_ROOT", None)
            else:
                os.environ["METRICS_ROOT"] = prior_metrics_root

    assert snapshot is not None
    assert snapshot["metrics"] == {"tokens": 100, "first_attempt_pass": True}


def test_compare_evaluate_handles_mixed_known_and_unknown_metrics() -> None:
    meta_experiment = _load_meta_experiment()

    decision = meta_experiment.compare.evaluate(
        {
            "captured_at": "2026-04-20T14:00:00Z",
            "metrics": {"tokens": 100, "custom_latency_p95": 40},
        },
        {
            "captured_at": "2026-04-20T15:00:00Z",
            "metrics": {"tokens": 104, "custom_latency_p95": 50},
        },
        5.0,
    )

    assert decision["metrics"]["tokens"]["delta_pct"] == 4.0
    assert decision["metrics"]["tokens"]["over_threshold"] is False
    assert decision["metrics"]["custom_latency_p95"]["delta_pct"] == 25.0
    assert decision["verdict"] == "reject"
    assert "custom_latency_p95" in decision["regression_metrics"]


def test_no_threshold_class_or_schema_expansion_was_added() -> None:
    meta_experiment = _load_meta_experiment()
    promotion_source = (ROOT / "hive/lib/meta-experiment/promotion_adapter.py").read_text(
        encoding="utf-8"
    )

    assert not (ROOT / "hive/lib/meta-experiment/threshold_class.py").exists()
    assert not (ROOT / "hive/lib/meta-experiment/metric_schema.py").exists()
    assert "threshold_class" not in promotion_source
    assert set(meta_experiment.PromotionEvidence.__annotations__) == {"commit_ref", "pr_ref", "pr_state"}
