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

from .model import (
    ConditionalEdge,
    Graph,
    InputBinding,
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
    )


def _build_output_ref(raw: dict[str, Any]) -> OutputRef:
    return OutputRef(name=raw.get("name", ""), type=str(raw.get("type", "")))


def _build_node(raw: dict[str, Any]) -> Node:
    inputs_raw = raw.get("inputs") or []
    outputs_raw = raw.get("outputs") or []
    depends_on_raw = raw.get("depends_on") or []
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
    )


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

    return Graph(
        workflow_name=str(raw.get("name", p.stem)),
        version=raw.get("version"),
        description=raw.get("description"),
        methodology=raw.get("methodology"),
        nodes=nodes_by_id,
        edges=_build_edges(nodes),
    )


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
