"""Typed in-memory model for a Hive workflow DAG.

The graph layer is purely structural. It holds the data parsed from a
workflow YAML; it does NOT execute steps, resolve generic agent names,
evaluate predicates, or compose tool gates. Those concerns belong to
later slices (hde-2 executor core, hde-3a predicate evaluator, hde-7
tool gating, hde-8 pause semantics).

Design locks (per hde-1 acceptance criteria and design_decisions):
  * `Node.agent` is a raw string. Generic `developer` is NOT resolved
    to `frontend-developer` / `backend-developer`; resolution is the
    runtime handler's job in hde-2.
  * `Node.optional` (per-step) and `InputBinding.optional` (per-input)
    are distinct fields. Per-step optional means "if this step fails,
    continue"; per-input optional means "if upstream skipped, pass null".
    They MUST NOT be collapsed.
  * `NodeType` enum is exactly {AGENT, SCRIPT, GATE, PAUSE, RECONCILE,
    USER_GATE}. No LOOP.
  * Additive fields (`when`, `tools`, `disallowed_tools`) round-trip on
    the model but are not enforced here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class NodeType(str, Enum):
    AGENT = "agent"
    SCRIPT = "script"
    GATE = "gate"
    PAUSE = "pause"
    RECONCILE = "reconcile"
    USER_GATE = "user_gate"


VALID_INPUT_SOURCES = ("literal", "step_output", "context")
VALID_OUTPUT_TYPES = ("string", "json", "artifact_ref")


@dataclass
class InputBinding:
    """A single input to a node.

    `optional` here is per-input: "if upstream is skipped or returns no
    value, pass null instead of failing the binding." This is distinct
    from `Node.optional` (per-step).
    """

    name: str
    source: str
    step_id: str | None = None
    output_name: str | None = None
    context_key: str | None = None
    value: Any | None = None
    optional: bool = False

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"name": self.name, "source": self.source}
        if self.step_id is not None:
            out["step_id"] = self.step_id
        if self.output_name is not None:
            out["output_name"] = self.output_name
        if self.context_key is not None:
            out["context_key"] = self.context_key
        if self.value is not None:
            out["value"] = self.value
        if self.optional:
            out["optional"] = True
        return out


@dataclass
class OutputRef:
    """A named output a node publishes for downstream consumers."""

    name: str
    type: str

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "type": self.type}


@dataclass
class ConditionalEdge:
    """A directed edge between two nodes.

    `when` is an optional predicate text. The graph layer carries the
    raw string; the predicate evaluator in hde-3a interprets it. A
    sequential edge derived from `depends_on` has `when=None`.
    """

    from_node_id: str
    to_node_id: str
    when: str | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"from": self.from_node_id, "to": self.to_node_id}
        if self.when is not None:
            out["when"] = self.when
        return out


@dataclass
class Node:
    """A single workflow step rendered into the graph model.

    `optional` is per-step semantics; `InputBinding.optional` is the
    distinct per-input semantics. Both can be true on the same node.

    Additive fields (`when`, `tools`, `disallowed_tools`) are accepted
    by the loader and round-trip on the dataclass but their semantics
    are NOT enforced in hde-1.
    """

    id: str
    agent: str
    node_type: NodeType = NodeType.AGENT
    task: str | None = None
    step_file: str | None = None
    inputs: list[InputBinding] = field(default_factory=list)
    outputs: list[OutputRef] = field(default_factory=list)
    optional: bool = False
    timeout_ms: int | None = None
    skip_when: str | None = None
    gate: str | None = None
    retry: dict[str, Any] | None = None
    tools: list[str] | None = None
    disallowed_tools: list[str] | None = None
    when: str | None = None
    depends_on: list[str] = field(default_factory=list)
    auto_pass_when: str | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.id,
            "agent": self.agent,
            "node_type": self.node_type.value,
            "depends_on": list(self.depends_on),
            "inputs": [i.to_dict() for i in self.inputs],
            "outputs": [o.to_dict() for o in self.outputs],
            "optional": self.optional,
        }
        if self.task is not None:
            out["task"] = self.task
        if self.step_file is not None:
            out["step_file"] = self.step_file
        if self.timeout_ms is not None:
            out["timeout_ms"] = self.timeout_ms
        if self.skip_when is not None:
            out["skip_when"] = self.skip_when
        if self.gate is not None:
            out["gate"] = self.gate
        if self.retry is not None:
            out["retry"] = self.retry
        if self.tools is not None:
            out["tools"] = list(self.tools)
        if self.disallowed_tools is not None:
            out["disallowed_tools"] = list(self.disallowed_tools)
        if self.when is not None:
            out["when"] = self.when
        if self.auto_pass_when is not None:
            out["auto_pass_when"] = self.auto_pass_when
        return out


@dataclass
class Graph:
    """The parsed workflow as a typed in-memory DAG.

    `nodes` is keyed by node id. `edges` includes one ConditionalEdge per
    depends_on entry (with `when=None`) plus any explicit predicate edges
    sourced from a node's additive `when:` field.
    """

    workflow_name: str
    version: str | None = None
    description: str | None = None
    methodology: str | None = None
    nodes: dict[str, Node] = field(default_factory=dict)
    edges: list[ConditionalEdge] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "workflow_name": self.workflow_name,
            "version": self.version,
            "description": self.description,
            "methodology": self.methodology,
            "nodes": {nid: n.to_dict() for nid, n in self.nodes.items()},
            "edges": [e.to_dict() for e in self.edges],
        }
