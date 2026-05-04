"""Pause handler — full implementation in hde-8.

The hde-2 stub-shape test is now superseded by the integration tests
in `test_handlers_pause_integration.py`. Keep one smoke test here that
asserts the handler can be constructed without arguments and exposes
the expected attribute surface; deeper coverage lives in
`hive/lib/dag_executor/pause/tests/`.
"""

from __future__ import annotations

from hive.lib.dag_executor.executor.handlers.pause import PauseHandler


def test_pause_handler_construction_smoke():
    handler = PauseHandler()
    assert handler.runs_root is not None
    assert callable(handler.handle)
