"""TDD RED-phase tests for s4-retire-runtime-loop.

Story: Retire runtime LOOP machinery from the executor (expander fully replaces it).
Acceptance criteria tested here:

  AC-1  No code path in executor/ references a LOOP node (LoopHandler gone, no
        Dispatcher registration).
  AC-2  Full dag_executor suite still passes — tested by running it green; these
        tests enforce the pre-conditions the developer must satisfy.
  AC-3  A LOOP node that somehow reaches the walker is rejected loudly via
        LoopNodeInvariantError (invariant guard).
  AC-4  An in-flight RunState carrying LOOP node IDs fails with an actionable
        "re-plan required" message on resume.

Additional guard:
  G-1   graph/validator.py LOOP validation becomes a post-expand reject ("authoring
        keyword only — re-plan required") rather than validating loop_config.

All tests are expected to FAIL (RED) until the developer implements the changes.
"""

from __future__ import annotations

import importlib
import sys

import pytest

# ---------------------------------------------------------------------------
# Helpers — keep construction local so tests are self-contained.
# ---------------------------------------------------------------------------

def _make_loop_node(node_id: str = "my-loop"):
    """Build a minimal LOOP Node using the graph model (kept as authoring type)."""
    from hive.lib.dag_executor.graph.model import LoopConfig, Node, NodeType, OutputRef

    return Node(
        id=node_id,
        agent="",
        node_type=NodeType.LOOP,
        loop_config=LoopConfig(
            sub_graph="rc",
            gate_predicate="$reviewer.output.review_clean == true",
            max_rounds=3,
        ),
        outputs=[OutputRef(name="review_verdict", type="string")],
    )


def _make_agent_node(node_id: str = "step-a"):
    from hive.lib.dag_executor.graph.model import Node, NodeType

    return Node(id=node_id, agent="developer", node_type=NodeType.AGENT)


def _make_graph(*nodes):
    from hive.lib.dag_executor.graph.model import Graph

    return Graph(
        workflow_name="test-retire-loop",
        nodes={n.id: n for n in nodes},
        edges=[],
    )


def _make_telemetry(run_id: str = "rid-s4"):
    from hive.lib.dag_executor.executor.telemetry import Telemetry

    return Telemetry(run_id=run_id)


# ---------------------------------------------------------------------------
# AC-1a: LoopNodeInvariantError must exist in executor.errors
# ---------------------------------------------------------------------------

def test_loop_node_invariant_error_exists_in_executor_errors():
    """LoopNodeInvariantError must be importable from executor.errors.

    FAILS (RED): the class does not exist yet.
    """
    from hive.lib.dag_executor.executor import errors as errs
    from hive.lib.dag_executor.executor.errors import ExecutorError

    assert hasattr(errs, "LoopNodeInvariantError"), (
        "LoopNodeInvariantError not found in executor.errors — "
        "developer must add it as a subclass of ExecutorError"
    )
    exc_cls = errs.LoopNodeInvariantError
    assert issubclass(exc_cls, ExecutorError), (
        "LoopNodeInvariantError must be a subclass of ExecutorError"
    )


# ---------------------------------------------------------------------------
# AC-1b: LoopHandler must NOT appear in executor.handlers public surface
# ---------------------------------------------------------------------------

def test_loop_handler_not_in_executor_handlers_all():
    """LoopHandler must be removed from executor/handlers/__init__.py.

    FAILS (RED): LoopHandler is currently in __all__.
    """
    import hive.lib.dag_executor.executor.handlers as h

    assert "LoopHandler" not in h.__all__, (
        "LoopHandler still appears in executor.handlers.__all__ — "
        "developer must remove it"
    )


def test_loop_handler_module_deleted():
    """executor/handlers/loop.py must be deleted.

    FAILS (RED): the module still exists and is importable.
    """
    # Force a fresh import attempt — bypass any cached negative entry.
    mod_name = "hive.lib.dag_executor.executor.handlers.loop"
    sys.modules.pop(mod_name, None)
    with pytest.raises(ImportError):
        importlib.import_module(mod_name)


# ---------------------------------------------------------------------------
# AC-1c: Dispatcher must NOT register NodeType.LOOP
# ---------------------------------------------------------------------------

def test_dispatcher_has_no_loop_handler():
    """NodeType.LOOP must not appear in the Dispatcher default handler table.

    FAILS (RED): Dispatcher currently registers LoopHandler for NodeType.LOOP.
    """
    from hive.lib.dag_executor.executor.dispatcher import Dispatcher
    from hive.lib.dag_executor.graph.model import NodeType

    d = Dispatcher()
    # Access the internal handler map.
    assert NodeType.LOOP not in d._handlers, (
        "Dispatcher still has a handler registered for NodeType.LOOP — "
        "developer must remove the registration"
    )


# ---------------------------------------------------------------------------
# AC-3: Walker must raise LoopNodeInvariantError when a LOOP node is encountered
# ---------------------------------------------------------------------------

def test_walker_raises_invariant_error_on_loop_node():
    """If a LOOP node somehow reaches the executor walker, it must raise
    LoopNodeInvariantError — loud rejection, no silent execution.

    FAILS (RED): the walker currently calls _execute_loop_node instead of raising.
    """
    from hive.lib.dag_executor.executor.dispatcher import Dispatcher
    from hive.lib.dag_executor.executor.walker import Walker

    loop_node = _make_loop_node("stray-loop")
    graph = _make_graph(loop_node)
    dispatcher = Dispatcher()
    telemetry = _make_telemetry("rid-ac3")

    # The import will itself fail until LoopNodeInvariantError is added,
    # but that failure is captured by AC-1a. Here we assume the class exists
    # and assert the walk raises it.
    try:
        from hive.lib.dag_executor.executor.errors import LoopNodeInvariantError
    except ImportError:
        pytest.fail(
            "LoopNodeInvariantError not yet in executor.errors — "
            "AC-1a must pass before AC-3 can be verified"
        )

    with pytest.raises(LoopNodeInvariantError) as excinfo:
        Walker().walk(graph, dispatcher, "rid-ac3", telemetry)

    msg = str(excinfo.value).lower()
    assert "stray-loop" in msg or "loop" in msg, (
        "Error message should identify the offending LOOP node id"
    )
    assert "re-plan" in msg or "unroll" in msg or "loader" in msg or "invariant" in msg, (
        "Error message should hint that the node must be unrolled before execution"
    )


def test_walker_invariant_error_message_contains_node_id():
    """The LoopNodeInvariantError message must quote the offending node id.

    FAILS (RED): same as AC-3 — invariant guard not yet implemented.
    """
    from hive.lib.dag_executor.executor.dispatcher import Dispatcher
    from hive.lib.dag_executor.executor.walker import Walker

    loop_node = _make_loop_node("review-loop-ac3b")
    graph = _make_graph(loop_node)
    dispatcher = Dispatcher()
    telemetry = _make_telemetry("rid-ac3b")

    try:
        from hive.lib.dag_executor.executor.errors import LoopNodeInvariantError
    except ImportError:
        pytest.fail("LoopNodeInvariantError not yet in executor.errors")

    with pytest.raises(LoopNodeInvariantError) as excinfo:
        Walker().walk(graph, dispatcher, "rid-ac3b", telemetry)

    assert "review-loop-ac3b" in str(excinfo.value), (
        f"Expected node id 'review-loop-ac3b' in error message, got: {excinfo.value!r}"
    )


# ---------------------------------------------------------------------------
# AC-3 (replay path): invariant must also fire in Walker.replay()
# ---------------------------------------------------------------------------

def test_walker_replay_raises_invariant_error_on_loop_node():
    """replay() must also reject a LOOP node with LoopNodeInvariantError.

    FAILS (RED): replay currently tries to re-execute the LOOP node instead of
    raising.
    """
    from hive.lib.dag_executor.executor.dispatcher import Dispatcher
    from hive.lib.dag_executor.executor.walker import Walker
    from hive.lib.dag_executor.run_state.schema import NodeStatus, RunState

    try:
        from hive.lib.dag_executor.executor.errors import LoopNodeInvariantError
    except ImportError:
        pytest.fail("LoopNodeInvariantError not yet in executor.errors")

    loop_node = _make_loop_node("replay-loop")
    graph = _make_graph(loop_node)
    dispatcher = Dispatcher()
    telemetry = _make_telemetry("rid-ac3-replay")

    # Construct a minimal RunState that has the LOOP node in FAILED status
    # (simulates an in-flight pre-retire run where the LOOP node was mid-flight).
    state = RunState(
        run_id="rid-ac3-replay",
        workflow_slug="test-retire-loop",
        node_statuses={"replay-loop": NodeStatus.FAILED},
        output_graph={},
    )

    with pytest.raises(LoopNodeInvariantError) as excinfo:
        Walker().replay(graph, dispatcher, "rid-ac3-replay", telemetry, state)

    assert "replay-loop" in str(excinfo.value), (
        f"Expected node id 'replay-loop' in error message, got: {excinfo.value!r}"
    )


# ---------------------------------------------------------------------------
# AC-4: RunState with LOOP node IDs must fail with an actionable message
# ---------------------------------------------------------------------------

def test_run_state_resume_with_loop_node_fails_with_actionable_message():
    """Resuming a run whose RunState contains a LOOP node id must raise an
    error with a clear 're-plan required' message (no silent corruption).

    This tests the REAL legacy-resume scenario (AC-4):
    - The post-retire graph has only unrolled round-nodes (fix__r1, review__r1).
    - The legacy RunState still carries 'legacy-loop: PENDING' from before the
      loop-unroll migration.
    - Replaying this state against the new graph must FAIL LOUDLY rather than
      silently completing with 'legacy-loop' left as a ghost-PENDING entry.

    The previous version of this test built a graph that still contained the
    LOOP node, which only exercised the walker's node_type guard — not the
    real corruption path where the LOOP node is absent from the new graph.
    """
    from hive.lib.dag_executor.executor.dispatcher import Dispatcher
    from hive.lib.dag_executor.executor.walker import Walker
    from hive.lib.dag_executor.run_state.schema import NodeStatus, RunState

    try:
        from hive.lib.dag_executor.executor.errors import LoopNodeInvariantError
    except ImportError:
        pytest.fail("LoopNodeInvariantError not yet in executor.errors")

    # Post-expand graph: only unrolled round nodes — no 'legacy-loop' node.
    # This is the real post-retire state: the LOOP was expanded into
    # fix__r1 / review__r1 by the loader; the walker never sees a LOOP node.
    fix_node = _make_agent_node("fix__r1")
    review_node = _make_agent_node("review__r1")
    graph = _make_graph(fix_node, review_node)
    dispatcher = Dispatcher()
    telemetry = _make_telemetry("rid-ac4")

    # Legacy RunState: 'legacy-loop' is PENDING but is NOT in the current
    # graph. Resuming must detect this ghost node and fail with an actionable
    # message rather than completing silently and leaving legacy-loop: pending.
    state = RunState(
        run_id="rid-ac4",
        workflow_slug="test-retire-loop",
        node_statuses={"legacy-loop": NodeStatus.PENDING},
        output_graph={},
    )

    exc = None
    try:
        Walker().replay(graph, dispatcher, "rid-ac4", telemetry, state)
    except Exception as e:
        exc = e

    assert exc is not None, (
        "Expected an exception when replaying a RunState whose node IDs are "
        "absent from the current (post-expand) graph — got silent success, "
        "which means 'legacy-loop: PENDING' was silently ignored."
    )

    msg = str(exc).lower()
    assert "re-plan" in msg or "re-run" in msg or "re-expand" in msg, (
        f"Exception message must contain 're-plan' (or equivalent), got: {exc!r}"
    )
    # Must not be a generic crash — check it is a typed error.
    from hive.lib.dag_executor.executor.errors import ExecutorError
    assert isinstance(exc, ExecutorError), (
        f"Expected an ExecutorError subclass, got {type(exc).__name__}: {exc!r}"
    )


# ---------------------------------------------------------------------------
# G-1: Validator must reject LOOP nodes with post-expand "re-plan" message
# ---------------------------------------------------------------------------

def test_validator_rejects_loop_node_with_replan_message():
    """After s4, the graph validator must reject any LOOP node that would reach
    the executor, raising LoopConfigError with 'authoring keyword only' /
    're-plan required' language (not the old loop_config validation path).

    FAILS (RED): current validator validates loop_config fields rather than
    rejecting LOOP nodes outright.
    """
    from hive.lib.dag_executor.graph import validate_graph
    from hive.lib.dag_executor.graph.errors import LoopConfigError

    loop_node = _make_loop_node("g1-loop")
    # Even a fully-valid loop_config must be rejected after the retire.
    graph = _make_graph(loop_node)

    with pytest.raises(LoopConfigError) as excinfo:
        validate_graph(graph)

    msg = str(excinfo.value).lower()
    assert "re-plan" in msg or "authoring" in msg or "unroll" in msg or "must not reach" in msg, (
        f"Validator error should say 're-plan required' or 'authoring keyword only', got: {excinfo.value!r}"
    )


# ---------------------------------------------------------------------------
# Structural: executor/walker.py must not contain LOOP-specific helpers
# ---------------------------------------------------------------------------

def test_executor_walker_has_no_is_loop_node():
    """_is_loop_node must be removed from executor/walker.py.

    FAILS (RED): the function still exists.
    """
    import hive.lib.dag_executor.executor.walker as ew

    assert not hasattr(ew, "_is_loop_node"), (
        "_is_loop_node still present in executor/walker.py — developer must remove it"
    )


def test_executor_walker_has_no_execute_loop_node():
    """_execute_loop_node must be removed from executor/walker.py.

    FAILS (RED): the function still exists.
    """
    import hive.lib.dag_executor.executor.walker as ew

    assert not hasattr(ew, "_execute_loop_node"), (
        "_execute_loop_node still present in executor/walker.py — developer must remove it"
    )


def test_executor_walker_has_no_build_sub_graph():
    """_build_sub_graph must be removed from executor/walker.py.

    FAILS (RED): the function still exists.
    """
    import hive.lib.dag_executor.executor.walker as ew

    assert not hasattr(ew, "_build_sub_graph"), (
        "_build_sub_graph still present in executor/walker.py — developer must remove it"
    )


def test_executor_walker_has_no_is_subgraph_member():
    """_is_subgraph_member must be removed from executor/walker.py.

    FAILS (RED): the function still exists.
    """
    import hive.lib.dag_executor.executor.walker as ew

    assert not hasattr(ew, "_is_subgraph_member"), (
        "_is_subgraph_member still present in executor/walker.py — developer must remove it"
    )


# ---------------------------------------------------------------------------
# Structural: graph/walker.py must be deleted (test-only LOOP execution)
# ---------------------------------------------------------------------------

def test_graph_walker_module_deleted():
    """hive.lib.dag_executor.graph.walker must be deleted (was test-only loop runner).

    FAILS (RED): the module still exists.
    """
    mod_name = "hive.lib.dag_executor.graph.walker"
    sys.modules.pop(mod_name, None)
    with pytest.raises(ImportError):
        importlib.import_module(mod_name)
