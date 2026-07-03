"""a-rlm-recursive-node spike — all 8 acceptance criteria + the security boundary.

The RLM wrapper is EXPERIMENTAL and flag-gated on ``node.config.rlm``. These
tests lock:

  AC1  flag-on  -> wrapper active + constrained toolset (search/slice/chunk/grep)
  AC2  flag-off -> no wrapper, behavior identical to pre-A (byte-for-byte no-op)
  AC3  constrained toolset -> raw exec NOT reachable (no shell/subprocess/eval)
  AC4  recursive sub-calls route through the register_binding seam
  AC5  node-config schema accepts an ``rlm`` block without validation error
  AC6  no ``rlm`` block -> existing nodes parse correctly, unaffected
  AC7  flag-on run records a MEASURED metric value
  AC8  full dag_executor suite passes unchanged (run separately)
"""

from __future__ import annotations

import inspect
from pathlib import Path

import pytest

from hive.lib.dag_executor.executor.handlers.agent import AgentHandler, StubAgentSpawn
from hive.lib.dag_executor.executor.handlers import rlm as rlm_mod
from hive.lib.dag_executor.executor.handlers.rlm import (
    RLM_TOOL_NAMES,
    ConstrainedContextTools,
    RLMRecursiveWrapper,
    rlm_enabled,
)
from hive.lib.dag_executor.graph import Node, NodeType, load_workflow, validate_graph


def _node(config: dict | None = None, node_id: str = "research") -> Node:
    return Node(
        id=node_id,
        agent="researcher",
        node_type=NodeType.AGENT,
        config=config or {},
    )


# ----------------------------------------------------------------------
# AC1 — flag-on: wrapper active + constrained toolset available
# ----------------------------------------------------------------------


def test_ac1_flag_on_activates_wrapper_with_constrained_toolset():
    spy = StubAgentSpawn(canned_outputs={"research": {"research_brief": "ok"}})
    captured: list[dict] = []
    handler = AgentHandler(
        spawn=spy, rlm_metric_writer=lambda m, r: captured.append(m)
    )
    out = handler.handle(_node({"rlm": True}), inputs={"q": "x"}, run_id="rid-1")

    wrapper = handler._last_rlm_wrapper
    assert isinstance(wrapper, RLMRecursiveWrapper), "flag-on must build the wrapper"
    # The constrained toolset is available: exactly the four ops, reachable ONLY
    # through the validated data-driven dispatch (not as live callables).
    assert wrapper.tools is not None
    assert wrapper.tools.available_tools() == RLM_TOOL_NAMES
    assert wrapper.tools.dispatch("grep", pattern=r"^#") == []  # dispatch works
    # Authoritative node output still flows from the inner spawn.
    assert out.outputs == {"research_brief": "ok"}
    assert len(spy.calls) == 1


def test_ac1_scalar_and_explicit_block_forms_activate():
    # Scalar true and a block with EXPLICIT enabled: true activate.
    assert rlm_enabled(_node({"rlm": True})) is True
    assert rlm_enabled(_node({"rlm": {"enabled": True, "binding": "local"}})) is True
    assert rlm_enabled(_node({"rlm": {"enabled": True, "queries": ["x"]}})) is True


def test_ac1_gate_matrix_no_truthiness_footgun():
    """codex finding 3: the DICT form requires an explicit enabled: true. An
    empty block or a block missing enabled does NOT activate."""
    on = [
        {"rlm": True},
        {"rlm": {"enabled": True}},
        {"rlm": {"enabled": True, "binding": "local", "queries": ["a"]}},
    ]
    off = [
        {},
        {"rlm": False},
        {"rlm": {}},  # empty block — must NOT activate
        {"rlm": {"enabled": False}},
        {"rlm": {"binding": "local"}},  # dict without enabled — must NOT activate
        {"rlm": {"queries": ["x"]}},  # dict without enabled — must NOT activate
    ]
    for cfg in on:
        assert rlm_enabled(_node(cfg)) is True, f"{cfg} should activate"
    for cfg in off:
        assert rlm_enabled(_node(cfg)) is False, f"{cfg} should NOT activate"


# ----------------------------------------------------------------------
# AC2 — flag-off: no wrapper, identical to pre-A
# ----------------------------------------------------------------------


@pytest.mark.parametrize("config", [{}, {"rlm": False}, {"rlm": {"enabled": False}}])
def test_ac2_flag_off_is_a_complete_no_op(config):
    assert rlm_enabled(_node(config)) is False

    spy = StubAgentSpawn(canned_outputs={"research": {"research_brief": "ok"}})
    handler = AgentHandler(spawn=spy)
    out = handler.handle(_node(config), inputs={"q": "x"}, run_id="rid-1")

    # No wrapper was ever built.
    assert handler._last_rlm_wrapper is None
    # Spawn was invoked with the exact same shape a pre-A node would produce.
    assert len(spy.calls) == 1
    call = spy.calls[0]
    assert call["agent"] == "researcher"
    assert call["inputs"] == {"q": "x"}
    assert call["run_id"] == "rid-1"
    assert call["step_id"] == "research"
    assert out.outputs == {"research_brief": "ok"}


def test_ac2_flag_off_does_not_import_rlm_module(monkeypatch):
    """codex finding 2: a flag-off (non-RLM) node must NOT depend on rlm.py import
    success. Drop the module from the cache, run a flag-off node, and assert the
    handler never re-imported it (the opt-in check is inline in agent.py)."""
    import sys

    rlm_name = "hive.lib.dag_executor.executor.handlers.rlm"
    monkeypatch.delitem(sys.modules, rlm_name, raising=False)
    spy = StubAgentSpawn(canned_outputs={"research": {"x": 1}})
    handler = AgentHandler(spawn=spy)
    out = handler.handle(_node({}), inputs={}, run_id="r")
    assert out.outputs == {"x": 1}
    assert rlm_name not in sys.modules, "flag-off path must NOT import rlm.py"


def test_ac2_flag_off_matches_baseline_handler_byte_for_byte():
    """A handler that was never given rlm seams and one given them must produce
    identical spawn invocations for a non-rlm node."""
    spy_a = StubAgentSpawn(canned_outputs={"research": {"x": 1}})
    spy_b = StubAgentSpawn(canned_outputs={"research": {"x": 1}})
    base = AgentHandler(spawn=spy_a)
    with_seams = AgentHandler(
        spawn=spy_b,
        rlm_binding_resolver=lambda name: None,
        rlm_metric_writer=lambda m, r: None,
    )
    base.handle(_node({}), inputs={"a": 1}, run_id="r")
    with_seams.handle(_node({}), inputs={"a": 1}, run_id="r")
    assert spy_a.calls == spy_b.calls


# ----------------------------------------------------------------------
# AC3 — constrained toolset: raw exec is structurally unreachable
# ----------------------------------------------------------------------


def test_ac3_tools_reachable_only_by_validated_name_not_as_callables():
    """codex finding 1: the four ops are NOT public bound methods (a bound method
    leaks ``__globals__`` -> builtins -> os). They are reachable ONLY by validated
    NAME through the data-driven dispatch."""
    tools = ConstrainedContextTools("# Heading\nbody line\nmore text")
    # None of the four tool names is exposed as a live callable attribute, so the
    # classic ``tools.search.__globals__`` escape has no attribute to traverse.
    for name in RLM_TOOL_NAMES:
        with pytest.raises(AttributeError):
            getattr(tools, name)
    # The only invocation seam is dispatch, which takes a NAME + data.
    assert tools.dispatch("search", query="body") == [len("# Heading\n")]
    assert tools.dispatch("slice", start=0, end=9) == "# Heading"


def test_ac3_dispatch_rejects_everything_off_the_allowlist():
    tools = ConstrainedContextTools("data")
    for bad in (
        "_search",  # underscored impl not reachable by name
        "_grep",
        "exec",
        "eval",
        "system",
        "subprocess",
        "__class__",
        "__globals__",
        "__init__",
        "dispatch",
        "",
    ):
        with pytest.raises(ValueError):
            tools.dispatch(bad)
    assert ConstrainedContextTools.ALLOWED_TOOLS == set(RLM_TOOL_NAMES)


def test_ac3_no_dunder_traversal_escape_from_exposed_surface():
    """Probe the dunder-traversal escape EXPLICITLY (not just tools.exec).

    The surface handed toward the untrusted recursive layer is pure DATA — the
    tool-name menu and dispatched result values. Assert none of it has an
    attribute reachable to __globals__/__builtins__/__import__/os/subprocess.
    """
    tools = ConstrainedContextTools("# H\nalpha\nbeta")
    menu = tools.available_tools()
    results = [
        tools.dispatch("grep", pattern=r"alpha"),
        tools.dispatch("chunk", size=2),
        tools.dispatch("search", query="beta"),
        tools.dispatch("slice", start=0, end=3),
    ]
    for obj in (menu, *menu, *results):
        # No reachable function-globals path to builtins on any data object.
        assert not hasattr(obj, "__globals__"), f"{obj!r} leaks __globals__"
        # str/list/tuple/int carry no callable that traverses to __import__.
        assert type(obj) in (str, list, tuple, int), f"non-data crossed: {type(obj)}"

    # The old escape is gone: there is no bound tool method to pull __globals__
    # from — getattr raises before any dunder can be reached.
    for name in RLM_TOOL_NAMES:
        with pytest.raises(AttributeError):
            getattr(tools, name).__globals__  # noqa: B018


def test_ac3_recursive_sub_call_receives_only_data_never_a_callable():
    """The untrusted recursive layer must never be handed the tools object or any
    callable with a reachable __globals__ — only strings/dicts."""
    sub = StubAgentSpawn()
    handler = AgentHandler(
        spawn=StubAgentSpawn(canned_outputs={"research": {"research_brief": "ok"}}),
        rlm_binding_resolver=lambda name: (lambda: sub),
        rlm_metric_writer=lambda m, r: None,
    )
    handler.handle(_node({"rlm": {"enabled": True}}), inputs={"q": "x"}, run_id="r")
    assert len(sub.calls) == 1
    call = sub.calls[0]
    assert isinstance(call["step_file_content"], str)  # navigated context = data
    assert isinstance(call["inputs"], dict)
    for value in call.values():
        assert not callable(value), f"a callable crossed the trust boundary: {value!r}"
        assert not hasattr(value, "__globals__")


def test_ac3_toolset_pins_its_surface_and_is_not_callable():
    tools = ConstrainedContextTools("data")
    assert not callable(tools), "the toolset itself must not be callable"
    with pytest.raises(AttributeError):
        tools.injected = "x"  # __slots__ blocks new instance attributes


def test_ac3_rlm_module_has_no_execution_primitive_tokens():
    """Structural (AST) audit: the constrained-toolset module imports no
    execution-capable module (subprocess/os/pty/shlex) and never calls
    eval/exec/compile/__import__. The recursive sub-call binding lives in
    agent.py (an already-audited seam), never here. An AST walk (vs a raw
    substring scan) ignores the docstring prose that legitimately NAMES these
    forbidden primitives while explaining their absence."""
    import ast

    tree = ast.parse(inspect.getsource(rlm_mod))
    forbidden_imports = {"subprocess", "os", "pty", "shlex", "commands"}
    forbidden_calls = {"eval", "exec", "compile", "__import__"}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                assert alias.name.split(".")[0] not in forbidden_imports, (
                    f"forbidden import {alias.name!r}"
                )
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            assert root not in forbidden_imports, f"forbidden import-from {node.module!r}"
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            assert node.func.id not in forbidden_calls, (
                f"forbidden call {node.func.id!r}"
            )


def test_ac3_grep_uses_regex_not_shell():
    tools = ConstrainedContextTools("alpha\nbeta\ngamma")
    assert tools.dispatch("grep", pattern=r"^b") == ["beta"]
    # A malformed pattern is swallowed (never an execution surface).
    assert tools.dispatch("grep", pattern="[") == []


# ----------------------------------------------------------------------
# AC4 — recursive sub-calls route through the register_binding seam
# ----------------------------------------------------------------------


def test_ac4_sub_call_routes_through_register_binding_registry():
    from hive.lib.dag_executor import run as run_mod

    sub = StubAgentSpawn()
    saved = dict(run_mod._BINDING_FACTORIES)
    try:
        # Register via the PUBLIC seam; the wrapper resolves it via the default
        # get_binding_factory accessor (no injected resolver).
        run_mod.register_binding("local", lambda: sub)
        spy = StubAgentSpawn(canned_outputs={"research": {"research_brief": "ok"}})
        handler = AgentHandler(spawn=spy, rlm_metric_writer=lambda m, r: None)
        handler.handle(
            _node({"rlm": {"enabled": True, "binding": "local"}}),
            inputs={"q": "x"},
            run_id="rid-9",
        )
        wrapper = handler._last_rlm_wrapper
        # The depth=1 recursive sub-call fired through the registered binding.
        assert len(sub.calls) == 1
        assert sub.calls[0]["step_id"] == "research:rlm-subcall"
        assert wrapper.last_metric["sub_call_count"] == 1
        assert wrapper.last_metric["recursion_depth"] == 1
    finally:
        run_mod._BINDING_FACTORIES.clear()
        run_mod._BINDING_FACTORIES.update(saved)


def test_ac4_get_binding_factory_reads_the_same_registry():
    from hive.lib.dag_executor import run as run_mod

    saved = dict(run_mod._BINDING_FACTORIES)
    try:
        sentinel = object()
        run_mod.register_binding("multica", lambda: sentinel)
        assert run_mod.get_binding_factory("multica")() is sentinel
        assert run_mod.get_binding_factory("nope") is None
    finally:
        run_mod._BINDING_FACTORIES.clear()
        run_mod._BINDING_FACTORIES.update(saved)


def test_ac4_no_registered_binding_still_active_no_sub_call():
    """With no binding registered the wrapper is still active and records the
    metric, but no recursive sub-call fires (depth 0)."""
    spy = StubAgentSpawn(canned_outputs={"research": {"research_brief": "ok"}})
    handler = AgentHandler(
        spawn=spy,
        rlm_binding_resolver=lambda name: None,  # nothing registered
        rlm_metric_writer=lambda m, r: None,
    )
    handler.handle(_node({"rlm": True}), inputs={}, run_id="rid-1")
    wrapper = handler._last_rlm_wrapper
    assert wrapper.last_metric["sub_call_count"] == 0
    assert wrapper.last_metric["recursion_depth"] == 0


# ----------------------------------------------------------------------
# AC5 / AC6 — node-config schema: rlm block accepted; absence unaffected
# ----------------------------------------------------------------------


_WORKFLOW_WITH_RLM = """
workflow_name: rlm-demo
steps:
  - id: research
    agent: researcher
    node_type: agent
    config:
      rlm:
        enabled: true
        binding: local
        queries: [architecture, risk]
  - id: plain
    agent: developer
    node_type: agent
"""


def test_ac5_rlm_block_is_accepted_without_validation_error(tmp_path: Path):
    wf = tmp_path / "wf.yaml"
    wf.write_text(_WORKFLOW_WITH_RLM, encoding="utf-8")
    graph = load_workflow(wf)
    validate_graph(graph)  # must not raise
    research = graph.nodes["research"]
    assert research.config["rlm"]["enabled"] is True
    assert research.config["rlm"]["binding"] == "local"
    assert rlm_enabled(research) is True


def test_ac6_absent_rlm_block_parses_unaffected(tmp_path: Path):
    wf = tmp_path / "wf.yaml"
    wf.write_text(_WORKFLOW_WITH_RLM, encoding="utf-8")
    graph = load_workflow(wf)
    plain = graph.nodes["plain"]
    # A node with no config bag is an empty dict and is NOT rlm-enabled.
    assert plain.config == {}
    assert rlm_enabled(plain) is False
    # Back-compat: to_dict omits the config key entirely for a config-free node.
    assert "config" not in plain.to_dict()


def test_ac6_non_dict_config_coerces_to_empty(tmp_path: Path):
    wf = tmp_path / "wf.yaml"
    wf.write_text(
        "workflow_name: w\nsteps:\n  - id: n\n    agent: a\n    config: not-a-dict\n",
        encoding="utf-8",
    )
    graph = load_workflow(wf)
    assert graph.nodes["n"].config == {}


# ----------------------------------------------------------------------
# AC7 — a flag-on run records a MEASURED metric value
# ----------------------------------------------------------------------


def test_ac7_flag_on_run_records_measured_metric():
    captured: list[dict] = []
    spy = StubAgentSpawn(canned_outputs={"research": {"research_brief": "ok"}})
    handler = AgentHandler(
        spawn=spy, rlm_metric_writer=lambda m, r: captured.append((m, r))
    )
    # A long context so navigation touches only a fraction (positive reduction).
    big = {"context": "# Title\n" + ("filler line\n" * 500)}
    handler.handle(_node({"rlm": True}), inputs=big, run_id="rid-metric")

    assert len(captured) == 1, "exactly one metric recorded for the flag-on run"
    metric, run_id = captured[0]
    assert run_id == "rid-metric"
    assert metric["metric"] == "rlm_context_reduction_ratio"
    assert isinstance(metric["value"], float)
    assert 0.0 <= metric["value"] <= 1.0
    assert metric["value"] > 0.0, "navigation should touch < full context"
    assert metric["context_bytes_total"] > 0
    assert metric["context_bytes_navigated"] >= 0
    assert metric["node_id"] == "research"
    assert set(metric["toolset"]) == set(RLM_TOOL_NAMES)


def test_ac7_default_metric_writer_persists_jsonl(tmp_path, monkeypatch):
    """The default (non-injected) writer appends a JSONL metric under the
    metrics root via the audited path resolver."""
    import json

    monkeypatch.setenv("METRICS_ROOT", str(tmp_path))
    spy = StubAgentSpawn(canned_outputs={"research": {"research_brief": "ok"}})
    handler = AgentHandler(spawn=spy)  # no metric writer injected -> default
    handler.handle(_node({"rlm": True}), inputs={"q": "x"}, run_id="rid-persist")

    events = tmp_path / "events" / "rlm-rid-persist.jsonl"
    assert events.is_file()
    line = events.read_text(encoding="utf-8").strip().splitlines()[0]
    rec = json.loads(line)
    assert rec["metric"] == "rlm_context_reduction_ratio"
    assert rec["run_id"] == "rid-persist"
