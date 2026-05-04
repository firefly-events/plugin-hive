"""Tests for the run_id primitive (ULID + workflow_slug)."""

from __future__ import annotations

import pytest

from hive.lib.dag_executor.executor.run_id import _CROCKFORD, make_run_id, new_ulid


def test_ulid_is_26_chars_crockford_base32():
    rid = new_ulid()
    assert len(rid) == 26
    assert set(rid) <= set(_CROCKFORD), f"ULID contains non-Crockford chars: {rid}"


def test_make_run_id_format():
    rid = make_run_id("code-review")
    head, _, tail = rid.partition("-")
    assert len(head) == 26, f"ULID prefix wrong length: {head!r}"
    assert set(head) <= set(_CROCKFORD)
    assert tail == "code-review"


def test_make_run_id_rejects_empty_slug():
    with pytest.raises(ValueError):
        make_run_id("")


def test_100_calls_are_unique():
    ids = {new_ulid() for _ in range(100)}
    assert len(ids) == 100


def test_sortability_matches_creation_order():
    """100 rapid calls must lex-sort in creation order (ULID monotonic)."""
    created = [new_ulid() for _ in range(100)]
    assert created == sorted(created), "ULIDs not monotonic across rapid calls"


def test_make_run_id_sortability_preserved_with_slug():
    """The slug suffix must not break the lex-sort guarantee."""
    created = [make_run_id("code-review") for _ in range(50)]
    assert created == sorted(created)
