"""YAML -> Graph loader.

Reads a single workflow file or a directory of workflow files into the
typed Graph model. Preserves raw values: `agent` strings are NOT
resolved (generic `developer` stays as `developer`); additive fields
(`when`, `tools`, `disallowed_tools`, `node_type: pause`) are accepted
and round-trip on the model without semantic enforcement.

The loader is intentionally permissive — it builds the structural model
and defers all validation to `validator.validate_graph`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from .errors import DuplicateEnsuresError, GraphLoadError
from . import unroll as _unroll_mod
from .model import (
    ConditionalEdge,
    Graph,
    InputBinding,
    LoopConfig,
    Node,
    NodeType,
    OutputRef,
)


WORKFLOW_GLOB = "*.workflow.yaml"


def _coerce_node_type(raw: Any) -> NodeType:
    """Map a string `node_type` value to the enum.

    Unknown values raise ``ValueError`` so a typo (e.g. ``pasue``) does
    not silently downgrade a pause/script node to AGENT execution.
    Missing ``node_type`` still defaults to AGENT.
    """
    if raw is None:
        return NodeType.AGENT
    if isinstance(raw, NodeType):
        return raw
    text = str(raw).strip().lower()
    for nt in NodeType:
        if nt.value == text:
            return nt
    raise ValueError(f"Unknown node_type: {raw!r}")


def _build_input_binding(raw: dict[str, Any]) -> InputBinding:
    return InputBinding(
        name=raw.get("name", ""),
        source=str(raw.get("source", "")),
        step_id=raw.get("step_id"),
        output_name=raw.get("output_name"),
        context_key=raw.get("context_key"),
        value=raw.get("value"),
        optional=bool(raw.get("optional", False)),
        reference_pointer=raw.get("reference_pointer"),
    )


def _build_output_ref(raw: dict[str, Any]) -> OutputRef:
    return OutputRef(name=raw.get("name", ""), type=str(raw.get("type", "")))


def _build_loop_config(raw: dict[str, Any] | None) -> LoopConfig | None:
    if not raw:
        return None
    # Preserve a bool or otherwise non-coercible max_rounds AS-IS so the
    # validator can reject it. `int(True)` is 1 and `int("3")` is 3 — eagerly
    # coercing here silently turned a `max_rounds: true` typo into a valid
    # 1-round loop, hiding the config error from the validator (Codex review).
    max_rounds_raw = raw.get("max_rounds")
    if max_rounds_raw is None or isinstance(max_rounds_raw, bool):
        max_rounds = max_rounds_raw
    elif isinstance(max_rounds_raw, int):
        max_rounds = max_rounds_raw
    else:
        try:
            max_rounds = int(max_rounds_raw)
        except (TypeError, ValueError):
            max_rounds = max_rounds_raw  # leave invalid value for the validator
    return LoopConfig(
        sub_graph=str(raw.get("sub_graph", "")),
        gate_predicate=str(raw.get("gate_predicate", "")),
        max_rounds=max_rounds,  # type: ignore[arg-type]
        feature=raw.get("feature"),
        convergence_signal=raw.get("convergence_signal"),
    )


def _build_node(raw: dict[str, Any]) -> Node:
    inputs_raw = raw.get("inputs") or []
    outputs_raw = raw.get("outputs") or []
    depends_on_raw = raw.get("depends_on") or []
    requires_raw = raw.get("requires") or []
    ensures_raw = raw.get("ensures") or []
    return Node(
        id=str(raw.get("id", "")),
        agent=str(raw.get("agent", "")),
        node_type=_coerce_node_type(raw.get("node_type")),
        task=raw.get("task"),
        step_file=raw.get("step_file"),
        inputs=[_build_input_binding(i) for i in inputs_raw],
        outputs=[_build_output_ref(o) for o in outputs_raw],
        optional=bool(raw.get("optional", False)),
        timeout_ms=raw.get("timeout_ms"),
        skip_when=raw.get("skip_when"),
        gate=raw.get("gate"),
        retry=raw.get("retry"),
        tools=list(raw["tools"]) if isinstance(raw.get("tools"), list) else None,
        disallowed_tools=(
            list(raw["disallowed_tools"])
            if isinstance(raw.get("disallowed_tools"), list)
            else None
        ),
        when=raw.get("when"),
        depends_on=[str(d) for d in depends_on_raw],
        auto_pass_when=raw.get("auto_pass_when"),
        loop_config=_build_loop_config(raw.get("loop_config")),
        requires=[str(k) for k in requires_raw],
        ensures=[str(k) for k in ensures_raw],
        sub_graph=raw.get("sub_graph"),
        # a-rlm-recursive-node A: tolerate an optional per-node ``config`` bag
        # (holds the experimental ``rlm`` block). A non-dict or absent value
        # yields an empty dict, so non-rlm nodes parse exactly as before.
        config=dict(raw["config"]) if isinstance(raw.get("config"), dict) else {},
    )


def _synthesize_contract_edges(nodes: list[Node]) -> None:
    """Derive dependency edges from Forme-style Requires/Ensures contracts.

    b-contract-derived-dag b1. A step that ``requires`` output key ``K``
    depends on the step that ``ensures`` ``K``; the producer id is appended
    to the consumer's ``depends_on`` (deduped, preserving hand-authored
    entries) so downstream layers — validator cycle detection, the
    executor's topological sort, ``_effective_deps`` — pick the synthesized
    edge up for free. This AUGMENTS hand-authored ``depends_on``; it never
    replaces it.

    Fails LOUD (whole plan, per design-discussion §6 Q5) when two distinct
    steps ``ensures`` the same key — the ``requires`` side would otherwise
    have to guess a producer. Mutates ``nodes`` in place; a graph with no
    ``ensures``/``requires`` annotations is left byte-identical.
    """

    ensures_map: dict[str, str] = {}
    for node in nodes:
        for key in node.ensures:
            existing = ensures_map.get(key)
            if existing is not None and existing != node.id:
                raise DuplicateEnsuresError(
                    output_key=key,
                    first_node_id=existing,
                    second_node_id=node.id,
                )
            ensures_map[key] = node.id

    for node in nodes:
        for key in node.requires:
            producer = ensures_map.get(key)
            # No producer (key supplied externally, e.g. run context) or a
            # self-produced key: synthesize nothing. Only a real cross-step
            # producer yields an edge.
            if producer is None or producer == node.id:
                continue
            if producer not in node.depends_on:
                node.depends_on.append(producer)


def _build_edges(nodes: list[Node]) -> list[ConditionalEdge]:
    """Derive sequential edges from depends_on plus any explicit when: edges.

    A depends_on entry produces one ConditionalEdge per (predecessor,
    successor) pair with `when=None`. A node carrying `when:` adds one
    additional ConditionalEdge per depends_on entry that mirrors the
    predicate text on the inbound edge — the graph layer holds the
    annotation; hde-3a interprets it.
    """
    edges: list[ConditionalEdge] = []
    for node in nodes:
        for predecessor_id in node.depends_on:
            edges.append(
                ConditionalEdge(
                    from_node_id=predecessor_id,
                    to_node_id=node.id,
                    when=node.when,
                )
            )
    return edges


def _validate_convergence_signals(nodes: list[Node]) -> None:
    """Fail loudly when a LOOP's convergence_signal is not emitted by any body node.

    s3-convergence-signal AC3: if a loop template declares a convergence_signal,
    at least one body node (tagged with the matching sub_graph) MUST declare that
    signal as a named output. If no body nodes exist yet the check is skipped —
    the loop body may be defined in a future YAML layer. An empty body that
    carries a convergence_signal but zero nodes is a valid no-op, not an error.
    """
    for node in nodes:
        if node.node_type != NodeType.LOOP:
            continue
        lc = node.loop_config
        if lc is None or lc.convergence_signal is None:
            continue
        signal = lc.convergence_signal
        sub_graph = lc.sub_graph
        body_nodes = [n for n in nodes if n.sub_graph == sub_graph]
        if not body_nodes:
            # s3-convergence-signal AC3: a declared signal with zero matching body
            # nodes is an error — the signal can never be produced. Fail loud so
            # developers catch the misconfiguration at load time rather than at
            # runtime when the loop silently never converges.
            raise GraphLoadError(
                f"LOOP '{node.id}' (sub_graph={sub_graph!r}) declares "
                f"convergence_signal={signal!r} but sub_graph '{sub_graph}' has "
                f"zero body nodes. Tag at least one step with "
                f"`sub_graph: {sub_graph}` and declare a `{signal}` (type: json) output."
            )
        producers = [
            n for n in body_nodes
            if any(o.name == signal for o in n.outputs)
        ]
        if not producers:
            raise GraphLoadError(
                f"LOOP '{node.id}' (sub_graph={sub_graph!r}) declares "
                f"convergence_signal={signal!r} but no body node in sub_graph "
                f"'{sub_graph}' emits it. Add an output named {signal!r} (type: json) "
                f"to the reviewer/tester step in sub_graph '{sub_graph}'."
            )


def _validate_featured_loops_have_body(nodes: list[Node]) -> None:
    """Fail loudly when a feature-tagged LOOP has zero matching body nodes.

    pr20-fable-review M1: `expand_loops` only unrolls LOOP nodes that carry
    `loop_config.feature` (unroll.py `expand_loops` filter). `_expand_one_loop`
    early-returns when `sub_graph` resolves to zero body nodes (unroll.py
    ~146-151), leaving the LOOP node in place — but now WITH a feature tag, so
    it looks "opted in" while never actually being unrolled. That surviving
    LOOP node reaches the walker at runtime and hard-raises
    `LoopNodeInvariantError`. Catch this at load time instead: a
    feature-tagged loop with no body is always a misconfiguration (either tag
    body nodes with `sub_graph: <name>`, or drop `feature:`/the LOOP node
    entirely if no in-graph body is intended — see review.workflow.yaml's
    vestigial `review-converge-loop`, which was removed rather than wired
    because it had no real fix/implement body to tag).
    """
    for node in nodes:
        if node.node_type != NodeType.LOOP:
            continue
        lc = node.loop_config
        if lc is None or lc.feature is None:
            continue
        sub_graph = lc.sub_graph
        body_nodes = [n for n in nodes if n.sub_graph == sub_graph]
        if not body_nodes:
            raise GraphLoadError(
                f"LOOP '{node.id}' (sub_graph={sub_graph!r}) declares "
                f"loop_config.feature={lc.feature!r} (opting into expand_loops) "
                f"but sub_graph {sub_graph!r} has zero body nodes, so it can never "
                f"be unrolled and would survive to the walker as a raw LOOP node "
                f"(LoopNodeInvariantError). Either tag at least one step with "
                f"`sub_graph: {sub_graph}`, or remove `feature:`/the LOOP node if "
                f"no in-graph loop body is intended."
            )


def _validate_body_nodes_have_deps(nodes: list[Node]) -> None:
    """Fail loudly when a feature-tagged LOOP's body has a dep-less node.

    pr20-fable-review T3: ``_entry_nodes`` (unroll.py) classifies a body node
    as an "entry" only if it has at least one dep OUTSIDE the body
    (``any(dep not in body_ids for dep in n.depends_on)``); only entry nodes
    receive inter-round deps on the previous round's exit(s) for ``k > 1``.
    A body node with an EMPTY ``depends_on`` is vacuously not an entry node
    (``any()`` over an empty list is False) AND contributes no external dep
    for round 1 either — every round copy of that node ends up with
    ``depends_on == []``, so ALL its round copies (``__r1 .. __rN``) land in
    the walker's first dispatch wave and run CONCURRENTLY instead of in
    round order. Reject this at load time: every body node must declare at
    least one dependency (on another body node, or an external node) so the
    expander can establish round-to-round ordering.
    """
    loop_nodes = [
        n for n in nodes
        if n.node_type == NodeType.LOOP
        and n.loop_config is not None
        and n.loop_config.feature is not None
    ]
    for loop_node in loop_nodes:
        sub_graph = loop_node.loop_config.sub_graph
        body_nodes = [n for n in nodes if n.sub_graph == sub_graph]
        for body_node in body_nodes:
            if not body_node.depends_on:
                raise GraphLoadError(
                    f"LOOP '{loop_node.id}' (sub_graph={sub_graph!r}) body node "
                    f"'{body_node.id}' has an empty depends_on. Every loop-body "
                    f"node must depend on at least one other node (another body "
                    f"node, or an external node providing the loop's entry point) "
                    f"— a dep-less body node gets no inter-round ordering and all "
                    f"its round copies would dispatch concurrently instead of in "
                    f"round order."
                )


def _validate_no_nested_loops(nodes: list[Node]) -> None:
    """Fail loudly when a LOOP node's body contains another LOOP node.

    pr20-fable-review T4: nested loops are not supported. If an outer LOOP's
    ``sub_graph`` body includes a node that is itself ``node_type: loop``,
    the outer expansion (``unroll.py`` ``_expand_one_loop``) deep-copies and
    deletes the inner LOOP node as an ordinary body member — the inner LOOP's
    own body is never expanded (the inner LOOP node is deleted from
    ``graph.nodes`` before ``expand_loops`` would otherwise reach it), and any
    round-copies of the inner LOOP node keep ``node_type: LOOP`` while being
    absent from the pre-collected top-level loop list, eventually reaching
    the walker as a raw LOOP node (``LoopNodeInvariantError``). Reject the
    authoring shape outright rather than let it reach expansion.
    """
    loop_ids = {n.id for n in nodes if n.node_type == NodeType.LOOP}
    if not loop_ids:
        return
    for node in nodes:
        if node.node_type != NodeType.LOOP:
            continue
        lc = node.loop_config
        if lc is None:
            continue
        sub_graph = lc.sub_graph
        for candidate in nodes:
            if candidate.sub_graph == sub_graph and candidate.node_type == NodeType.LOOP:
                raise GraphLoadError(
                    f"LOOP '{node.id}' (sub_graph={sub_graph!r}) has body member "
                    f"'{candidate.id}' which is itself a LOOP node. Nested loops "
                    f"are not supported by the static unroll expander — the outer "
                    f"expansion would delete the inner LOOP node as an ordinary "
                    f"body member without ever expanding its own body, eventually "
                    f"reaching the walker as a raw LOOP node "
                    f"(LoopNodeInvariantError). Flatten the two loops (e.g. merge "
                    f"the inner loop's body into the outer loop's sub_graph with "
                    f"its own convergence signal), or run them as sibling "
                    f"top-level loops instead of nesting."
                )


def load_workflow(path: Path | str) -> Graph:
    """Parse a single workflow YAML into a Graph object."""
    p = Path(path)
    with p.open("r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}

    steps_raw = raw.get("steps") or []
    nodes = [_build_node(step) for step in steps_raw]
    nodes_by_id: dict[str, Node] = {}
    for node in nodes:
        if not node.id:
            raise ValueError(
                f"workflow step in {p.name} has empty id"
            )
        if node.id in nodes_by_id:
            raise ValueError(
                f"duplicate workflow step id {node.id!r} in {p.name}"
            )
        nodes_by_id[node.id] = node

    # b1: synthesize Requires/Ensures contract edges onto depends_on before
    # building the edge list, so ConditionalEdges and Graph.nodes agree.
    _synthesize_contract_edges(nodes)

    # s3-convergence-signal AC3: validate that each LOOP's declared signal is
    # produced by at least one body node before any unrolling happens.
    _validate_convergence_signals(nodes)
    _validate_featured_loops_have_body(nodes)
    _validate_body_nodes_have_deps(nodes)
    _validate_no_nested_loops(nodes)

    graph = Graph(
        workflow_name=str(raw.get("name", p.stem)),
        version=raw.get("version"),
        description=raw.get("description"),
        methodology=raw.get("methodology"),
        nodes=nodes_by_id,
        edges=_build_edges(nodes),
    )
    # s2-unroll-expander: expand LOOP nodes into deterministic round-copy sets.
    graph = _unroll_mod.expand_loops(graph)
    return graph


def load_all_workflows(workflows_dir: Path | str = "hive/workflows") -> dict[str, Graph]:
    """Parse every `*.workflow.yaml` in a directory.

    Returned dict is keyed by Graph.workflow_name (the YAML's `name:`
    field, falling back to the file stem when absent).
    """
    d = Path(workflows_dir)
    out: dict[str, Graph] = {}
    for path in sorted(d.glob(WORKFLOW_GLOB)):
        graph = load_workflow(path)
        if graph.workflow_name in out:
            raise ValueError(
                f"duplicate workflow name {graph.workflow_name!r} "
                f"loading {path.name}"
            )
        out[graph.workflow_name] = graph
    return out
