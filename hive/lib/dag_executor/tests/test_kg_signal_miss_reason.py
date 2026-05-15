from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from hive.lib.kg_signal.miss_reason import (
    format_step02c_summary_line,
    miss_reason_for_kg,
    render_step02c_payload,
    step03_dedup_miss_reason,
)


NOW = datetime(2026, 5, 15, 12, 0, tzinfo=timezone.utc)


def _make_db(tmp_path: Path, rows: list[tuple[str, str, str, str, str, str]]) -> Path:
    db = tmp_path / "kg.sqlite"
    with sqlite3.connect(str(db)) as conn:
        conn.execute(
            """
            CREATE TABLE triples (
              subject TEXT,
              predicate TEXT,
              object TEXT,
              valid_from TEXT,
              valid_until TEXT,
              source_epic TEXT,
              source_agent TEXT
            )
            """
        )
        conn.executemany(
            """
            INSERT INTO triples
              (subject, predicate, object, valid_from, valid_until, source_epic, source_agent)
            VALUES (?, ?, ?, ?, NULL, ?, ?)
            """,
            rows,
        )
        conn.commit()
    return db


def test_empty_kg_returns_empty_kg(tmp_path):
    db = _make_db(tmp_path, [])

    assert miss_reason_for_kg(db_path=db, now=NOW, window_days=30) == "empty_kg"


def test_empty_predicate_filter_returns_empty_predicate_filter(tmp_path):
    db = _make_db(
        tmp_path,
        [
            (
                "story-1",
                "decided",
                "accepted",
                "2026-05-14T00:00:00Z",
                "kg-signal-revival",
                "plan",
            ),
            (
                "story-2",
                "proposal",
                "drafted",
                "2026-05-14T01:00:00Z",
                "kg-signal-revival",
                "meta-optimize",
            ),
        ],
    )

    assert miss_reason_for_kg(db_path=db, now=NOW, window_days=30) == "empty_predicate_filter"


def test_recency_cutoff_returns_recency_cutoff(tmp_path):
    db = _make_db(
        tmp_path,
        [
            (
                "story-1",
                "phase_failed",
                "terminal-error",
                "2026-03-01T00:00:00Z",
                "kg-signal-revival",
                "implement",
            )
        ],
    )

    assert miss_reason_for_kg(db_path=db, now=NOW, window_days=30) == "recency_cutoff"


def test_project_tag_cutoff_returns_project_tag_cutoff(tmp_path):
    db = _make_db(
        tmp_path,
        [
            (
                "story-1",
                "phase_failed",
                "terminal-error",
                "2026-05-14T00:00:00Z",
                "shindig/create-event-enhancements",
                "implement",
            )
        ],
    )

    assert (
        miss_reason_for_kg(
            db_path=db,
            now=NOW,
            window_days=30,
            local_epics={"kg-signal-revival"},
        )
        == "project_tag_cutoff"
    )


def test_dedup_eviction_returns_dedup_eviction():
    assert (
        step03_dedup_miss_reason(
            kg_findings_input_count=2,
            kg_findings_post_dedup_count=0,
        )
        == "dedup_eviction"
    )
    assert (
        step03_dedup_miss_reason(
            kg_findings_input_count=0,
            kg_findings_post_dedup_count=0,
        )
        is None
    )


def test_non_empty_findings_return_none_and_payload_omits_miss_reason(tmp_path):
    db = _make_db(
        tmp_path,
        [
            (
                "story-1",
                "phase_blocked",
                "waiting-on-user",
                "2026-05-14T00:00:00Z",
                "kg-signal-revival",
                "plan",
            )
        ],
    )

    reason = miss_reason_for_kg(
        db_path=db,
        now=NOW,
        window_days=30,
        local_epics={"kg-signal-revival"},
    )
    payload = render_step02c_payload(
        [{"id": "kg-finding-1", "discovery_source": "kg_signal"}],
        miss_reason=reason,
    )

    assert reason is None
    assert "miss_reason" not in payload
    assert format_step02c_summary_line(findings_count=1, miss_reason=reason) == (
        "[meta-optimize] kg-signal: findings=1"
    )


def test_discriminator_is_top_down_for_predicate_before_recency(tmp_path):
    db = _make_db(
        tmp_path,
        [
            (
                "story-1",
                "decided",
                "accepted",
                "2026-05-14T00:00:00Z",
                "kg-signal-revival",
                "plan",
            )
        ],
    )

    assert miss_reason_for_kg(db_path=db, now=NOW, window_days=30) == "empty_predicate_filter"

