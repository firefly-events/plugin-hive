"""Schema versioning + v0→v1 migration stub.

The migration stub is a deliberate passthrough — no v1 schema exists
yet. The point is the migration code path is callable before any v1
data shows up; the architect lock from §6 of the architect-memo
(cheap now, impossible to retrofit).
"""

from __future__ import annotations

from hive.lib.dag_executor.executor.run_id import make_run_id
from hive.lib.dag_executor.run_state import SCHEMA_VERSION, create, migrate_v0_to_v1
from hive.lib.dag_executor.run_state.schema import to_dict


def test_schema_version_pinned_at_zero():
    assert SCHEMA_VERSION == 0


def test_fresh_run_state_carries_schema_version_zero():
    s = create(make_run_id("code-review"), "code-review")
    assert s.schema_version == 0


def test_serialized_payload_includes_schema_version():
    s = create(make_run_id("code-review"), "code-review")
    payload = to_dict(s)
    assert payload["schema_version"] == 0


def test_migrate_v0_to_v1_stub_is_callable_passthrough():
    v0 = {
        "run_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV-code-review",
        "workflow_slug": "code-review",
        "schema_version": 0,
        "status": "completed",
    }
    v1 = migrate_v0_to_v1(v0)
    assert v1 == v0
    # Must be a copy (callers should be safe to mutate the result).
    assert v1 is not v0
