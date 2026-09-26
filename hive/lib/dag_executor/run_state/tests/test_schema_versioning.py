"""Schema versioning + v0→v1 migration.

b-contract-derived-dag b2 lands the first real v1 schema change: a
per-node memoization ``node_hashes`` map plus ``NodeStatus.REUSED``. The
migration bumps ``schema_version`` 0→1 and back-fills ``node_hashes={}``
so pre-b2 (v0) run states stay readable. These tests pin the v1 contract
and the migration behaviour (the old "pinned at zero" invariant is what
b2 deliberately changed).
"""

from __future__ import annotations

from hive.lib.dag_executor.executor.run_id import make_run_id
from hive.lib.dag_executor.run_state import SCHEMA_VERSION, create, migrate_v0_to_v1
from hive.lib.dag_executor.run_state.schema import to_dict


def test_schema_version_is_v1():
    assert SCHEMA_VERSION == 1


def test_fresh_run_state_carries_schema_version_one():
    s = create(make_run_id("code-review"), "code-review")
    assert s.schema_version == 1


def test_serialized_payload_includes_schema_version():
    s = create(make_run_id("code-review"), "code-review")
    payload = to_dict(s)
    assert payload["schema_version"] == 1
    # v1 adds the node_hashes map to the serialized shape.
    assert payload["node_hashes"] == {}


def test_migrate_v0_to_v1_bumps_version_and_backfills_node_hashes():
    v0 = {
        "run_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV-code-review",
        "workflow_slug": "code-review",
        "schema_version": 0,
        "status": "completed",
    }
    v1 = migrate_v0_to_v1(v0)
    assert v1["schema_version"] == 1
    assert v1["node_hashes"] == {}
    # All other fields pass through untouched.
    assert v1["run_id"] == v0["run_id"]
    assert v1["workflow_slug"] == v0["workflow_slug"]
    assert v1["status"] == v0["status"]
    # Must be a copy (callers should be safe to mutate the result) and must
    # not mutate the input in place.
    assert v1 is not v0
    assert v0["schema_version"] == 0


def test_migrate_v0_to_v1_is_idempotent():
    v0 = {
        "run_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV-code-review",
        "workflow_slug": "code-review",
        "schema_version": 0,
        "status": "completed",
    }
    once = migrate_v0_to_v1(v0)
    twice = migrate_v0_to_v1(once)
    assert twice["schema_version"] == 1
    assert twice["node_hashes"] == {}


def test_migrate_preserves_existing_node_hashes():
    v0_with_hashes = {
        "run_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV-code-review",
        "workflow_slug": "code-review",
        "schema_version": 0,
        "status": "completed",
        "node_hashes": {"step-1": "abc123"},
    }
    migrated = migrate_v0_to_v1(v0_with_hashes)
    assert migrated["node_hashes"] == {"step-1": "abc123"}
