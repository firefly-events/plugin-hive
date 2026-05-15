from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from hive.lib import metric_increment_cli


REGISTRY_PATH = (
    Path(__file__).resolve().parents[4]
    / "skills"
    / "hive"
    / "skills"
    / "meta-optimize"
    / "metric_registry.py"
)


def load_registry(name: str = "metric_registry_under_test"):
    spec = importlib.util.spec_from_file_location(name, REGISTRY_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_kg_signal_metrics_registered_idempotently_across_reimports():
    first = load_registry("metric_registry_under_test_first")
    second = load_registry("metric_registry_under_test_second")

    for module in (first, second):
        assert module.is_registered_counter("kg_writes_total")
        assert module.counter_labels("kg_writes_total") == ("predicate",)
        assert module.is_registered_counter("kg_signal_findings_total")
        assert module.counter_labels("kg_signal_findings_total") == ("cycle_id",)
        assert module.is_registered_counter("kg_signal_proposals_total")
        assert module.counter_labels("kg_signal_proposals_total") == ("cycle_id",)
        assert module.is_registered_gauge("hit_rate_5cycle")
        assert module.gauge_labels("hit_rate_5cycle") == ()


def test_direct_counter_increment_bumps_findings_and_proposals():
    registry = load_registry()
    registry.reset_metrics_for_test()

    assert registry.increment_counter(
        "kg_signal_findings_total",
        {"cycle_id": "cycle-1"},
    ) == 1
    assert registry.increment_counter(
        "kg_signal_proposals_total",
        {"cycle_id": "cycle-1"},
        by=2,
    ) == 2

    assert registry.counter_value("kg_signal_findings_total", {"cycle_id": "cycle-1"}) == 1
    assert registry.counter_value("kg_signal_proposals_total", {"cycle_id": "cycle-1"}) == 2


def test_increment_cli_bumps_kg_signal_counters(monkeypatch):
    registry = load_registry()
    registry.reset_metrics_for_test()
    monkeypatch.setattr(metric_increment_cli, "_load_metric_registry", lambda: registry)

    assert metric_increment_cli.main(
        [
            "--counter",
            "kg_signal_findings_total",
            "--label",
            "cycle_id=cycle-2",
            "--by",
            "1",
        ]
    ) == 0
    assert metric_increment_cli.main(
        [
            "--counter",
            "kg_signal_proposals_total",
            "--label",
            "cycle_id=cycle-2",
            "--by",
            "3",
        ]
    ) == 0

    assert registry.counter_value("kg_signal_findings_total", {"cycle_id": "cycle-2"}) == 1
    assert registry.counter_value("kg_signal_proposals_total", {"cycle_id": "cycle-2"}) == 3


def test_increment_cli_bad_label_exits_nonzero():
    with pytest.raises(SystemExit) as excinfo:
        metric_increment_cli.main(
            [
                "--counter",
                "kg_signal_findings_total",
                "--label",
                "cycle_id",
            ]
        )
    assert excinfo.value.code != 0


def test_hit_rate_5cycle_formula_across_6_cycle_fixture():
    registry = load_registry()
    registry.reset_metrics_for_test()
    fixture = [
        {"experiment_id": "cycle-1", "kg_signal_proposals_total": 1},
        {"experiment_id": "cycle-2", "kg_signal_proposals_total": 1},
        {"experiment_id": "cycle-3", "kg_signal_proposals_total": {"value": 1}},
        {"experiment_id": "cycle-4", "kg_signal_proposals_total": 0},
        {"experiment_id": "cycle-5", "kg_signal_proposals_total": 2},
        {"experiment_id": "cycle-6", "kg_signal_proposals_total": 0},
    ]

    assert registry.compute_hit_rate_5cycle([]) == 0.0
    assert registry.compute_hit_rate_5cycle(fixture[:1]) == 1.0
    assert registry.compute_hit_rate_5cycle(fixture[:3]) == 1.0
    assert registry.compute_hit_rate_5cycle(fixture[:5]) == 4 / 5
    assert registry.compute_hit_rate_5cycle(fixture[:6]) == 3 / 5
    assert registry.update_hit_rate_5cycle(fixture[:6]) == 3 / 5
    assert registry.gauge_value("hit_rate_5cycle") == 3 / 5
