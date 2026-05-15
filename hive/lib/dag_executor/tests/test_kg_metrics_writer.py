from __future__ import annotations

import json
from pathlib import Path

import pytest

from hive.lib import kg_metrics_writer


MISS_REASON_BUCKETS = [
    "empty_kg",
    "empty_predicate_filter",
    "recency_cutoff",
    "project_tag_cutoff",
    "dedup_eviction",
]


@pytest.fixture(autouse=True)
def reset_writer_buffer():
    kg_metrics_writer.reset_buffer_for_test()
    yield
    kg_metrics_writer.reset_buffer_for_test()


def _jsonl_rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def _buffer_event(cycle_id: str, index: int) -> None:
    kg_metrics_writer.buffer_kg_write_event(
        cycle_id=cycle_id,
        subject=f"story-{index}",
        predicate="phase_failed",
        obj=f"failure-{index}",
        source_epic="kg-signal-revival",
        source_agent="tester",
        timestamp=f"2026-05-15T00:00:0{index}Z",
    )


def test_buffer_and_flush_writes_events_plus_summary(tmp_path):
    for index in range(3):
        _buffer_event("cycle-1", index)

    path = kg_metrics_writer.flush_cycle(
        cycle_id="cycle-1",
        findings=12,
        proposals=3,
        hit_rate_5cycle=0.4,
        metrics_dir=tmp_path,
        timestamp="2026-05-15T00:00:10Z",
    )

    rows = _jsonl_rows(path)
    assert path == tmp_path / "cycle-1.jsonl"
    assert [row["event"] for row in rows] == [
        "kg_write",
        "kg_write",
        "kg_write",
        "cycle_summary",
    ]
    assert rows[-1]["findings"] == 12
    assert rows[-1]["proposals"] == 3
    assert rows[-1]["hit_rate_5cycle"] == 0.4
    assert rows[-1]["miss_reason"] is None


def test_flush_is_idempotent_for_same_cycle_id(tmp_path):
    _buffer_event("cycle-1", 1)
    first = kg_metrics_writer.flush_cycle(
        cycle_id="cycle-1",
        findings=0,
        proposals=0,
        hit_rate_5cycle=0.0,
        miss_reason="empty_kg",
        metrics_dir=tmp_path,
        timestamp="2026-05-15T00:00:10Z",
    )
    first_text = first.read_text(encoding="utf-8")

    _buffer_event("cycle-1", 1)
    second = kg_metrics_writer.flush_cycle(
        cycle_id="cycle-1",
        findings=0,
        proposals=0,
        hit_rate_5cycle=0.0,
        miss_reason="empty_kg",
        metrics_dir=tmp_path,
        timestamp="2026-05-15T00:00:11Z",
    )

    assert second == first
    assert second.read_text(encoding="utf-8") == first_text
    assert len(_jsonl_rows(second)) == 2


def test_jsonl_rows_have_b02_required_fields(tmp_path):
    _buffer_event("cycle-1", 1)
    path = kg_metrics_writer.flush_cycle(
        cycle_id="cycle-1",
        findings=0,
        proposals=0,
        hit_rate_5cycle=0.0,
        miss_reason="recency_cutoff",
        metrics_dir=tmp_path,
        timestamp="2026-05-15T00:00:10Z",
    )

    for row in _jsonl_rows(path):
        assert row["cycle_id"] == "cycle-1"
        assert row["metric_name"]
        assert "value" in row
        assert isinstance(row["labels"], dict)
        assert row["timestamp"]
        assert row["ts"] == row["timestamp"]
    event_row, summary_row = _jsonl_rows(path)
    assert event_row["subject"] == "story-1"
    assert event_row["predicate"] == "phase_failed"
    assert event_row["object"] == "failure-1"
    assert event_row["source_epic"] == "kg-signal-revival"
    assert event_row["source_agent"] == "tester"
    assert summary_row["miss_reason"] == "recency_cutoff"


def test_six_cycle_fixture_writes_six_files_with_summary_rows(tmp_path):
    for index in range(6):
        cycle_id = f"cycle-{index + 1}"
        _buffer_event(cycle_id, index)
        kg_metrics_writer.flush_cycle(
            cycle_id=cycle_id,
            findings=index,
            proposals=index % 2,
            hit_rate_5cycle=0.5,
            miss_reason="empty_kg" if index == 0 else None,
            metrics_dir=tmp_path,
            timestamp=f"2026-05-15T00:01:0{index}Z",
        )

    files = sorted(tmp_path.glob("cycle-*.jsonl"))
    assert len(files) == 6
    for index, path in enumerate(files):
        rows = _jsonl_rows(path)
        assert len(rows) == 2
        assert rows[-1]["event"] == "cycle_summary"
        assert rows[-1]["cycle_id"] == f"cycle-{index + 1}"


def test_report_line_for_non_empty_findings_has_empty_miss_reason():
    assert kg_metrics_writer.format_cycle_rollup_line(
        findings=12,
        proposals=3,
        hit_rate_5cycle=0.4,
        miss_reason="empty_kg",
    ) == "kg-signal: findings=12 proposals=3 hit_rate_5cycle=0.40 miss_reason="


@pytest.mark.parametrize("bucket", MISS_REASON_BUCKETS)
def test_report_line_for_empty_findings_renders_each_miss_reason(bucket):
    assert kg_metrics_writer.format_cycle_rollup_line(
        findings=0,
        proposals=0,
        hit_rate_5cycle=0.0,
        miss_reason=bucket,
    ) == f"kg-signal: findings=0 proposals=0 hit_rate_5cycle=0.00 miss_reason={bucket}"
