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
  * `NodeType` enum is {AGENT, SCRIPT, GATE, PAUSE, RECONCILE,
    USER_GATE, LOOP}. LOOP added by t-005.
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
    LOOP = "loop"


@dataclass
class LoopConfig:
    """Configuration for a LOOP node.

    ``max_rounds`` is required and validated at graph-parse time (not
    runtime). A LOOP node without ``max_rounds`` raises ``LoopConfigError``
    in the validator — callers must set a hard ceiling before the graph
    is executed to prevent non-termination.

    ``sub_graph`` identifies the sub-graph (or sub-graph ID) to iterate.
    ``gate_predicate`` is a predicate expression evaluated after each round;
    when it returns clean the loop exits early.
    """

    sub_graph: str
    gate_predicate: str
    max_rounds: int
    feature: str | None = None
    # s3-convergence-signal: the named boolean output emitted by the reviewer/
    # tester body step. Declared here so the loader can validate body coverage
    # and the expander can build grammar-legal skip_when predicates (not prose).
    convergence_signal: str | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "sub_graph": self.sub_graph,
            "gate_predicate": self.gate_predicate,
            "max_rounds": self.max_rounds,
        }
        if self.feature is not None:
            out["feature"] = self.feature
        if self.convergence_signal is not None:
            out["convergence_signal"] = self.convergence_signal
        return out


# `reference` is an ADDITIVE lean-flow source (c-generalize-loop C2): a binding
# whose value is read lazily from a filesystem pointer (a path relative to the
# run working directory) rather than wired point-to-point from an upstream
# output. It sits alongside the typed point-to-point sources; it does NOT
# replace them.
VALID_INPUT_SOURCES = ("literal", "step_output", "context", "reference")
VALID_OUTPUT_TYPES = ("string", "json", "artifact_ref")


@dataclass
class InputBinding:
    """A single input to a node.

    `optional` here is per-input: "if upstream is skipped or returns no
    value, pass null instead of failing the binding." This is distinct
    from `Node.optional` (per-step).

    `reference_pointer` (c-generalize-loop C2) is set only for
    ``source == "reference"`` bindings: it is the filesystem pointer
    (path relative to the run working directory) the executor reads
    lazily at resolution time. It is additive and does not affect the
    existing point-to-point ``step_output`` wiring.
    """

    name: str
    source: str
    step_id: str | None = None
    output_name: str | None = None
    context_key: str | None = None
    value: Any | None = None
    optional: bool = False
    reference_pointer: str | None = None
    # rec-1 last-successful-round: ordered list of fallback step_ids to try when
    # the primary step_id is SKIPPED (early convergence).  The unroller populates
    # this for post-loop input bindings when a convergence signal is declared so
    # that rN-1, rN-2, … r1 are tried in order before returning None.  Empty for
    # all loader-produced bindings (no-op unless the expander sets it).
    fallback_step_ids: list[str] = field(default_factory=list)

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
        if self.reference_pointer is not None:
            out["reference_pointer"] = self.reference_pointer
        if self.fallback_step_ids:
            out["fallback_step_ids"] = list(self.fallback_step_ids)
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
    loop_config: LoopConfig | None = None
    # b-contract-derived-dag b1: declarative Forme-style contracts. A node
    # ``requires`` a set of output keys (consumed) and ``ensures`` a set of
    # output keys (produced). The loader synthesizes a dependency edge from
    # every ``requires`` key to the step that ``ensures`` it, so those edges
    # need no hand-authored ``depends_on``. Both default empty, so every
    # existing contract-free workflow is unaffected (additive, back-compat).
    requires: list[str] = field(default_factory=list)
    ensures: list[str] = field(default_factory=list)
    # c-generalize-loop C1: loop-body membership tag. A node whose
    # ``sub_graph`` matches a LOOP node's ``loop_config.sub_graph`` is a
    # member of that loop body — it is iterated per round by its owning
    # LOOP node and is NOT scheduled at the top level of the walk. Absent
    # (None) on every node in every existing workflow, so it is a no-op
    # for non-loop graphs.
    sub_graph: str | None = None
    # a-rlm-recursive-node A: free-form per-node config bag. An optional ``rlm``
    # block (flag + toolset config) lives here and opts a node into the
    # EXPERIMENTAL RLM recursive wrapper (AgentHandler, flag-gated). Absent
    # (empty dict) on every existing node, so it is a back-compat no-op for
    # non-rlm nodes — the config bag is tolerated but never validated here.
    config: dict[str, Any] = field(default_factory=dict)

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
        if self.loop_config is not None:
            out["loop_config"] = self.loop_config.to_dict()
        if self.requires:
            out["requires"] = list(self.requires)
        if self.ensures:
            out["ensures"] = list(self.ensures)
        if self.sub_graph is not None:
            out["sub_graph"] = self.sub_graph
        # Only emit ``config`` when non-empty so every existing (config-free)
        # node round-trips byte-identically to pre-A (back-compat).
        if self.config:
            out["config"] = dict(self.config)
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
