"""Tests for the PAN-6642 semantic-recall source in hive/lib/memory_brief.py.

Covers the story-agent pre-task memory hook: the prior-experience brief now
adds a '### Recalled Knowledge (semantic corpus)' section sourced from the
swarm-memory Qdrant corpus, keyed on the story text (--query).
"""

from __future__ import annotations

from hive.lib import memory_brief
from hive.lib.memory_brief import (
    RECALL_SECTION,
    build_prior_experience,
    gather_semantic_recall,
)

_CANNED_RECALL_JSON = {
    "total_hits": 1,
    "scopes": [
        {
            "scope": "top",
            "hits": [
                {
                    "score": 0.72,
                    "text": "anchor rate is $250/hr",
                    "location": "att-site/pricing.md",
                }
            ],
        }
    ],
}


def test_recall_section_omitted_when_no_query(tmp_path, monkeypatch):
    # If recall were consulted it would raise; asserting it is not called.
    monkeypatch.setattr(
        memory_brief, "gather_semantic_recall",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("should not run")),
    )
    section = build_prior_experience(
        "developer", None, None,
        team_memories_root=tmp_path, classic_memories_root=tmp_path,
        kg_db_path=tmp_path / "absent.sqlite",
    )
    assert RECALL_SECTION not in section


def test_recall_section_rendered_from_hits(tmp_path, monkeypatch):
    monkeypatch.setattr(
        memory_brief, "gather_semantic_recall",
        lambda query, **k: [("att-site/pricing.md", "anchor rate is $250/hr")],
    )
    section = build_prior_experience(
        "developer", None, None,
        query="ATT pricing strategy",
        team_memories_root=tmp_path, classic_memories_root=tmp_path,
        kg_db_path=tmp_path / "absent.sqlite",
    )
    assert RECALL_SECTION in section
    assert "att-site/pricing.md" in section
    assert "anchor rate is $250/hr" in section


def test_recall_respects_token_budget(tmp_path, monkeypatch):
    # A tiny budget leaves no room for the recall section.
    monkeypatch.setattr(
        memory_brief, "gather_semantic_recall",
        lambda query, **k: [("x.md", "y" * 500)],
    )
    section = build_prior_experience(
        "developer", None, None,
        query="q", token_budget=5,
        team_memories_root=tmp_path, classic_memories_root=tmp_path,
        kg_db_path=tmp_path / "absent.sqlite",
    )
    assert RECALL_SECTION not in section


def test_gather_semantic_recall_empty_query_returns_empty():
    assert gather_semantic_recall("") == []
    assert gather_semantic_recall("   ") == []


def test_gather_semantic_recall_missing_cli_is_safe(monkeypatch):
    # God unreachable AND a non-existent CLI binary must degrade to [] (never raise).
    monkeypatch.setattr(memory_brief, "_recall_via_mnemosyne", lambda *a, **k: None)
    assert gather_semantic_recall("real query", bin_path="/nonexistent/swarm-memory-xyz") == []


def test_gather_semantic_recall_routes_through_mnemosyne(monkeypatch):
    # Primary path: when the god answers, the CLI is NOT shelled.
    monkeypatch.setattr(
        memory_brief, "_recall_via_mnemosyne", lambda *a, **k: _CANNED_RECALL_JSON
    )
    monkeypatch.setattr(
        memory_brief, "_recall_via_cli",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("CLI must not run when god answers")),
    )
    results = gather_semantic_recall("ATT pricing")
    assert results == [("att-site/pricing.md", "anchor rate is $250/hr")]


def test_gather_semantic_recall_falls_back_to_cli_when_god_down(monkeypatch):
    # God down (None) -> the CLI fallback supplies the same shape.
    monkeypatch.setattr(memory_brief, "_recall_via_mnemosyne", lambda *a, **k: None)
    monkeypatch.setattr(memory_brief, "_recall_via_cli", lambda *a, **k: _CANNED_RECALL_JSON)
    results = gather_semantic_recall("ATT pricing")
    assert results == [("att-site/pricing.md", "anchor rate is $250/hr")]


def test_gather_semantic_recall_god_disabled_env_uses_cli(monkeypatch):
    # MNEMOSYNE_RECALL=0 short-circuits the god entirely -> CLI path only.
    monkeypatch.setenv("MNEMOSYNE_RECALL", "0")
    called = {"cli": False}
    def _cli(*a, **k):
        called["cli"] = True
        return _CANNED_RECALL_JSON
    monkeypatch.setattr(memory_brief, "_recall_via_cli", _cli)
    results = gather_semantic_recall("ATT pricing")
    assert called["cli"] is True
    assert results == [("att-site/pricing.md", "anchor rate is $250/hr")]
