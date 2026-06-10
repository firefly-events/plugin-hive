"""b1-why-chromadb-fix — RuntimeError containment in _extract_chroma_response.

/hive:why free-form mode crashed with "RuntimeError: dictionary changed size
during iteration" propagating out of the ChromaDB provider response while it
was consumed in `_extract_chroma_response`. The fix scopes a try/except
RuntimeError around the extraction so free-form mode degrades to sqlite-only
(returns ``(False, [])``) and emits a single diagnostic line on stderr:

    kg_why.chromadb_runtime_error reason=<message>

The catch is RuntimeError-scoped: any other exception class still propagates.
"""

from __future__ import annotations

from typing import Any, Iterator, Mapping

import pytest

from hive.lib.kg_why import _extract_chroma_response, query_chromadb


class _MutatingDictResponse(Mapping):
    """Mapping whose record list mutates underfoot, like the real crash."""

    def __init__(self, exc: Exception) -> None:
        self._exc = exc

    def __getitem__(self, key: str) -> Any:
        raise self._exc

    def get(self, key: str, default: Any = None) -> Any:
        if key == "available":
            return True
        raise self._exc

    def __iter__(self) -> Iterator[str]:
        return iter(("available", "results"))

    def __len__(self) -> int:
        return 2


def test_runtime_error_degrades_to_unavailable(capsys: pytest.CaptureFixture) -> None:
    response = _MutatingDictResponse(
        RuntimeError("dictionary changed size during iteration")
    )

    available, records = _extract_chroma_response(response)

    assert available is False
    assert records == []
    err = capsys.readouterr().err
    assert (
        "kg_why.chromadb_runtime_error reason=dictionary changed size during iteration"
        in err
    )
    assert err.count("kg_why.chromadb_runtime_error") == 1


def test_other_exceptions_still_propagate() -> None:
    response = _MutatingDictResponse(ValueError("not a runtime error"))

    with pytest.raises(ValueError, match="not a runtime error"):
        _extract_chroma_response(response)


def test_query_chromadb_survives_mutating_provider_response(tmp_path) -> None:
    """End-to-end through query_chromadb: crash becomes an empty result."""

    def fake_provider(topic: str, limit: int) -> Any:
        return _MutatingDictResponse(
            RuntimeError("dictionary changed size during iteration")
        )

    triples = query_chromadb(
        "test query", 5, fake_provider, db_path=tmp_path / "kg.sqlite"
    )

    assert triples == []


def test_well_formed_responses_unaffected() -> None:
    assert _extract_chroma_response(None) == (False, [])
    assert _extract_chroma_response({"available": False}) == (False, [])
    record = {"metadata": {"subject": "s", "predicate": "p", "object": "o"}}
    available, records = _extract_chroma_response({"results": [record]})
    assert available is True
    assert records == [record]
