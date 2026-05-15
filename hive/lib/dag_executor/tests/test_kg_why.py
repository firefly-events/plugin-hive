from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from hive.lib import kg_why


def _kg_schema(db_path: Path) -> None:
    with sqlite3.connect(str(db_path)) as conn:
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
        conn.execute(
            "CREATE UNIQUE INDEX idx_unique_triple ON triples(subject, predicate, object, source_epic)"
        )
        conn.commit()


def _insert(
    db_path: Path,
    *,
    subject: str,
    predicate: str = "decided",
    object_: str,
    valid_from: str,
    source_epic: str = "kg-signal-revival",
    source_agent: str = "architect",
) -> None:
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute(
            """
            INSERT INTO triples
              (subject, predicate, object, valid_from, valid_until, source_epic, source_agent)
            VALUES (?, ?, ?, ?, NULL, ?, ?)
            """,
            (subject, predicate, object_, valid_from, source_epic, source_agent),
        )
        conn.commit()


@pytest.fixture()
def kg_db(tmp_path: Path) -> Path:
    db_path = tmp_path / "kg.sqlite"
    _kg_schema(db_path)
    return db_path


def test_strict_happy_path_with_seeded_triple_returns_row(kg_db: Path):
    _insert(
        kg_db,
        subject="architect",
        object_="use-sqlite-for-l2-kg",
        valid_from="2026-05-14T10:00:00Z",
    )

    rendered = kg_why.explain_why(
        db_path=kg_db,
        strict=True,
        predicate="decided",
        entity="architect",
    )

    assert "architect decided use-sqlite-for-l2-kg" in rendered
    assert "source_epic:  kg-signal-revival" in rendered
    assert "[via: kg]" in rendered


def test_strict_missing_predicate_or_entity_errors(kg_db: Path):
    with pytest.raises(ValueError, match="--strict requires --predicate and --entity"):
        kg_why.explain_why(
            db_path=kg_db,
            strict=True,
            predicate="decided",
            entity=None,
        )

    with pytest.raises(ValueError, match="--strict requires --predicate and --entity"):
        kg_why.explain_why(
            db_path=kg_db,
            strict=True,
            predicate=None,
            entity="architect",
        )


def test_free_form_kg_only_when_chromadb_unavailable(kg_db: Path):
    _insert(
        kg_db,
        subject="architect",
        object_="use-chromadb-for-l3",
        valid_from="2026-05-14T10:00:00Z",
    )

    rendered = kg_why.explain_why(
        db_path=kg_db,
        topic="chromadb",
        chromadb_query_fn=lambda _topic, _limit: {"available": False, "results": []},
    )

    assert "architect decided use-chromadb-for-l3" in rendered
    assert "[via: kg]" in rendered


def test_free_form_with_mocked_chromadb_available_merges_phase_a_and_b(kg_db: Path):
    _insert(
        kg_db,
        subject="architect",
        object_="use-sqlite-for-l2-kg",
        valid_from="2026-05-14T10:00:00Z",
    )

    def chroma(_topic: str, _limit: int):
        return {
            "available": True,
            "results": [
                {
                    "metadata": {
                        "subject": "planner",
                        "predicate": "decided",
                        "object": "use-chromadb-for-l3",
                        "valid_from": "2026-05-15T10:00:00Z",
                        "source_epic": "memory-autonomy-foundation",
                        "source_agent": "planner",
                    }
                }
            ],
        }

    rendered = kg_why.explain_why(
        db_path=kg_db,
        topic="use",
        chromadb_query_fn=chroma,
    )

    assert "planner decided use-chromadb-for-l3" in rendered
    assert "architect decided use-sqlite-for-l2-kg" in rendered
    assert "[via: chromadb]" in rendered
    assert "[via: kg]" in rendered


def test_phase_c_dedupe_collapses_same_triple_to_both(kg_db: Path):
    _insert(
        kg_db,
        subject="architect",
        object_="use-sqlite-for-l2-kg",
        valid_from="2026-05-14T10:00:00Z",
    )

    def chroma(_topic: str, _limit: int):
        return {
            "available": True,
            "results": [
                {
                    "metadata": {
                        "subject": "architect",
                        "predicate": "decided",
                        "object": "use-sqlite-for-l2-kg",
                        "valid_from": "2026-05-14T10:00:00Z",
                        "source_epic": "kg-signal-revival",
                        "source_agent": "architect",
                    }
                }
            ],
        }

    rendered = kg_why.explain_why(
        db_path=kg_db,
        topic="sqlite",
        chromadb_query_fn=chroma,
    )

    assert rendered.count("architect decided use-sqlite-for-l2-kg") == 1
    assert "[via: both]" in rendered


def test_limit_clamping_truncates_to_n_rows(kg_db: Path):
    for index in range(4):
        _insert(
            kg_db,
            subject=f"story-{index}",
            predicate="phase_complete",
            object_="planning",
            valid_from=f"2026-05-14T10:0{index}:00Z",
            source_agent="dag-executor",
        )

    rendered = kg_why.explain_why(
        db_path=kg_db,
        topic="planning",
        limit=2,
        chromadb_query_fn=lambda _topic, _limit: {"available": False},
    )

    assert rendered.count(" phase_complete planning") == 2
    assert "story-3 phase_complete planning" in rendered
    assert "story-2 phase_complete planning" in rendered
    assert "story-1 phase_complete planning" not in rendered


def test_default_chromadb_bridge_invoked_when_node_present(kg_db: Path, monkeypatch):
    """When chromadb_query_fn is None, explain_why falls back to the live bridge.

    We monkey-patch `_default_chromadb_query_fn` to return a stub so the test
    does NOT shell out to real node — that's the contract the production code
    relies on (env escape hatch + None-when-absent), and the unit test is
    asserting it composes correctly.
    """
    _insert(
        kg_db,
        subject="architect",
        predicate="decided",
        object_="use-sqlite-for-l2-kg",
        valid_from="2026-05-14T11:00:00Z",
    )

    bridge_called: list[tuple[str, int]] = []

    def fake_bridge(topic: str, top_k: int):
        bridge_called.append((topic, top_k))
        return {
            "available": True,
            "results": [
                {
                    "id": "decision:architect:decided:use-sqlite-for-l2-kg",
                    "document": "Use SQLite for L2 KG.",
                    "distance": 0.02,
                    "metadata": {
                        "subject": "architect",
                        "predicate": "decided",
                        "object": "use-sqlite-for-l2-kg",
                        "source_epic": "kg-signal-revival",
                        "source_agent": "architect",
                        "valid_from": "2026-05-14T11:00:00Z",
                    },
                }
            ],
        }

    monkeypatch.setattr(kg_why, "_default_chromadb_query_fn", lambda: fake_bridge)

    rendered = kg_why.explain_why(
        db_path=kg_db,
        topic="sqlite",
        chromadb_query_fn=None,
    )

    assert bridge_called, "default bridge should be invoked when chromadb_query_fn=None"
    assert "[via: both]" in rendered


def test_default_chromadb_bridge_returns_none_when_disabled(monkeypatch):
    """HIVE_DISABLE_CHROMA_BRIDGE env var disables the default bridge."""
    monkeypatch.setenv("HIVE_DISABLE_CHROMA_BRIDGE", "1")
    assert kg_why._default_chromadb_query_fn() is None
