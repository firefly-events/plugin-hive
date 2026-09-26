"""Load-time loop expander — s2-unroll-expander.

Turns a LOOP node into N deterministic round-copy sequences.  The
output graph is purely acyclic: no LOOP nodes remain and every round-copy
id is stable across loads (`<node>__r<k>`).

Public API:
    expand_loops(graph: Graph) -> Graph
        Mutates *graph* in place and returns it.  Safe to call when there
        are no LOOP nodes (no-op).
"""

from __future__ import annotations

import copy
import os
import re
from typing import TYPE_CHECKING

from .errors import GraphLoadError
from .model import ConditionalEdge, Graph, Node, NodeType

if TYPE_CHECKING:
    pass



# Per-feature enabled defaults.  Features listed here with enabled=False are
# opt-in: the loop collapses to a single degenerate pass unless the caller
# explicitly sets HIVE_LOOPS_<FEATURE>_ENABLED=true.  All other features
# continue to default to enabled=True (prior behaviour, backward-compatible).
# Loop templates are OPT-IN: every feature defaults to a single degenerate pass
# unless the caller enables it via config (`loops.<feature>.enabled: true`) or
# env (`HIVE_LOOPS_<FEATURE>_ENABLED=true`).  This mirrors the shipped baseline
# `hive/hive.config.yaml` (all loops enabled=false) and delivers the "turn a
# loop on and set N rounds" contract.  This dict is only the env-fallback default
# consulted when `resolve_loop_config` cannot read a config value.
_FEATURE_DEFAULTS: dict[str, bool] = {
    "test_swarm": False,  # expensive — opt-in only
    "grill": False,  # opt-in — "turn grill on and set N rounds"
}


def _resolve_feature(feature: str, yaml_max_rounds: int) -> tuple[bool, int]:
    """Resolve a loop feature with precedence: env > project config > baseline config > yaml default.

    Consults ``hive.lib.config.resolve_loop_config`` (which reads the project-
    level ``hive.config.yaml`` at the current working directory, then the
    shipped baseline, then applies env-var overrides) so that a root
    ``hive.config.yaml`` ``loops:<feature>`` entry actually drives the expander.

    Falls back to the legacy env-only path when ``resolve_loop_config`` raises
    (feature absent from all configs, config file unreadable, or validation
    fails).  ``yaml_max_rounds`` is the final fallback when the config stack
    yields no ``max_rounds`` value.

    Returns ``(enabled, max_rounds)``.
    """
    try:
        from pathlib import Path as _Path
        from hive.lib.config import resolve_loop_config as _resolve_loop_config
        cfg = _resolve_loop_config(
            feature,
            project_config_path=_Path.cwd() / "hive.config.yaml",
        )
        enabled = cfg["enabled"]
        max_rounds = cfg.get("max_rounds", yaml_max_rounds)
    except Exception:
        # Feature not in any config, config unreadable, or validation failed.
        # Fall back to env-only logic + _FEATURE_DEFAULTS.
        env_prefix = f"HIVE_LOOPS_{feature.upper()}"
        env_enabled = os.environ.get(f"{env_prefix}_ENABLED")
        if env_enabled is not None:
            enabled = env_enabled.strip().lower() == "true"
        else:
            # Per-feature default (e.g. test_swarm defaults to False — opt-in).
            # Falls back to True when the feature has no declared default.
            enabled = _FEATURE_DEFAULTS.get(feature, True)
        env_max_rounds = os.environ.get(f"{env_prefix}_MAX_ROUNDS")
        if env_max_rounds is not None:
            try:
                max_rounds = int(env_max_rounds)
            except (ValueError, TypeError):
                max_rounds = yaml_max_rounds
        else:
            max_rounds = yaml_max_rounds

    return enabled, max(max_rounds, 1)


def _round_id(node_id: str, k: int) -> str:
    """Deterministic id for round-copy k of *node_id*."""
    return f"{node_id}__r{k}"


def _body_nodes(graph: Graph, sub_graph: str) -> list[Node]:
    """Return all nodes tagged with sub_graph == *sub_graph*, in insertion order."""
    return [n for n in graph.nodes.values() if n.sub_graph == sub_graph]


def _exit_ids(body_ids: set[str], body_nodes: list[Node]) -> list[str]:
    """Return body node ids that no other body node depends on.

    These are the 'last' nodes in the body sub-graph — the ones that must
    be fully done before the next round (or the terminal gate) can start.
    """
    consumed_by_body: set[str] = set()
    for node in body_nodes:
        for dep in node.depends_on:
            if dep in body_ids:
                consumed_by_body.add(dep)
    return [n.id for n in body_nodes if n.id not in consumed_by_body]


def _entry_nodes(body_ids: set[str], body_nodes: list[Node]) -> list[Node]:
    """Return body nodes that have at least one dep outside the body.

    These are the 'first' nodes — their external deps get replaced with the
    exit node(s) of the previous round when k > 1.
    """
    return [
        n for n in body_nodes
        if any(dep not in body_ids for dep in n.depends_on)
    ]


def _expand_one_loop(graph: Graph, loop_node: Node) -> None:
    """Expand *loop_node* into round-copy sets in place."""
    lc = loop_node.loop_config
    assert lc is not None  # guaranteed by NodeType.LOOP

    # ------------------------------------------------------------------ #
    # 1. Resolve feature config (env > YAML)                               #
    # ------------------------------------------------------------------ #
    feature = lc.feature  # guaranteed non-None by expand_loops filter
    yaml_max_rounds = lc.max_rounds if isinstance(lc.max_rounds, int) else 1
    enabled, resolved_max_rounds = _resolve_feature(feature, yaml_max_rounds)

    # effective_rounds: disabled OR max_rounds==1 → single degenerate pass
    if not enabled or resolved_max_rounds == 1:
        effective_rounds = 1
    else:
        effective_rounds = resolved_max_rounds

    # ------------------------------------------------------------------ #
    # 2. Gather body nodes                                                 #
    # ------------------------------------------------------------------ #
    body_nodes = _body_nodes(graph, lc.sub_graph)
    if not body_nodes:
        # Empty body — nothing to unroll. Leave the LOOP node in place so
        # post-loop deps remain wired (the loop body may be added later).
        return

    body_ids: set[str] = {n.id for n in body_nodes}

    exit_node_ids = _exit_ids(body_ids, body_nodes)
    entry_nodes = _entry_nodes(body_ids, body_nodes)
    entry_ids: set[str] = {n.id for n in entry_nodes}

    # s3-convergence-signal: build grammar-legal skip_when from convergence_signal.
    # When convergence_signal is set and a body node produces it, each round k>1
    # carries  `$<producer>__r{k-1}.output.<signal> == true`  — a dotpath boolean
    # that the strict predicate grammar accepts. When convergence_signal is absent
    # fall back to gate_predicate (old behaviour, kept for backward-compat).
    _cs = lc.convergence_signal
    if _cs is not None:
        _cs_producer = next(
            (n for n in body_nodes if any(o.name == _cs for o in n.outputs)),
            None,
        )
    else:
        _cs_producer = None

    # pr20-fable-review S3: multi-exit loop + early convergence bypasses the
    # terminal gate. Post-loop nodes depend on ALL last-round exits (step 4
    # below). With >=2 exits and early convergence at round j < N, every
    # `__rN` exit is SKIPPED (round N never ran), so a multi-upstream
    # `none_failed_min_one_success` join downstream sees zero COMPLETED
    # upstreams -> the join itself is SKIPPED (not evaluated) -> a
    # single-upstream node depending on that join RUNS anyway, bypassing
    # whatever gate the exits were supposed to feed (bug-#26-class). This is
    # only reachable when the loop can actually early-converge (a
    # convergence_signal is declared AND it iterates more than one round) —
    # reject it at load time rather than let it reach the walker, since a
    # safe generic fix (exempting unroll-generated joins from the
    # trigger-rule skip, or synthesizing earlier-round fallback deps for
    # every exit) is a bigger structural change than any current template
    # needs (all four shipped loop templates are single-exit).
    if _cs is not None and effective_rounds > 1 and len(exit_node_ids) > 1:
        raise GraphLoadError(
            f"LOOP '{loop_node.id}' (sub_graph={lc.sub_graph!r}) has "
            f"{len(exit_node_ids)} body exit nodes ({sorted(exit_node_ids)!r}) "
            f"and declares convergence_signal={_cs!r} with max_rounds>1. A "
            f"multi-exit loop that can early-converge makes every downstream "
            f"multi-upstream join see zero COMPLETED exits once an earlier "
            f"round satisfies the signal, which can SKIP the join instead of "
            f"evaluating it and let single-upstream consumers bypass the "
            f"terminal gate (see pr20-fable-review finding S3). Restructure "
            f"the loop body so it has exactly one exit node (e.g. add a "
            f"trivial join step inside `sub_graph: {lc.sub_graph}` that all "
            f"other body nodes feed into), or drop the convergence_signal / "
            f"max_rounds if this loop is not meant to early-converge."
        )

    # ------------------------------------------------------------------ #
    # 3. Emit round copies                                                 #
    # ------------------------------------------------------------------ #
    new_nodes: list[Node] = []
    for k in range(1, effective_rounds + 1):
        prev_exit_round_ids = [_round_id(eid, k - 1) for eid in exit_node_ids]

        for body_node in body_nodes:
            # Deep-copy so we don't alias lists between rounds
            new_node = copy.deepcopy(body_node)
            new_node.id = _round_id(body_node.id, k)

            # Rewire depends_on
            new_deps: list[str] = []
            for dep in body_node.depends_on:
                if dep in body_ids:
                    # intra-body dep → same round copy
                    new_deps.append(_round_id(dep, k))
                else:
                    # external dep
                    if k == 1:
                        new_deps.append(dep)  # keep as-is for round 1
                    # k > 1: skip the external dep; inter-round deps added below

            # For k > 1, entry nodes receive inter-round deps from prev exit
            if k > 1 and body_node.id in entry_ids:
                new_deps.extend(prev_exit_round_ids)

            new_node.depends_on = new_deps

            # Rewire intra-body input bindings (step_id references to other body
            # nodes) to the same round copy, just like depends_on.  Without this
            # the input resolver cannot find the upstream node after unrolling
            # removes the bare body-node ids from the graph.
            for inp in new_node.inputs:
                if inp.step_id and inp.step_id in body_ids:
                    inp.step_id = _round_id(inp.step_id, k)

            # skip_when: round 1 always runs; k > 1 gates on convergence signal.
            # s3: when convergence_signal + producer are known, emit a grammar-legal
            # dotpath predicate; otherwise fall back to gate_predicate (prose).
            #
            # Convergence chain fix: use an OR across ALL prior rounds rather than
            # referencing only round k-1.  When round j < k is skipped (because an
            # earlier round satisfied the signal), round j has no materialised output;
            # the evaluator treats the missing-field lookup as False.  With a pure
            # k-1 chain, round k+1 would then also fail-open and re-run the expensive
            # swarm.  The OR chain short-circuits as soon as any prior-round's output
            # is True — correctly skipping all remaining rounds whenever the signal
            # was satisfied, regardless of how many intermediate rounds were skipped.
            if k == 1:
                new_node.skip_when = None
            elif _cs_producer is not None:
                parts = [
                    f"${_cs_producer.id}__r{j}.output.{_cs} == true"
                    for j in range(1, k)
                ]
                new_node.skip_when = " || ".join(parts)
            else:
                new_node.skip_when = lc.gate_predicate

            # s3: Clear sub_graph on round copies so the executor walker treats
            # them as ordinary top-level nodes (not loop-body members to be
            # filtered out). The sub_graph tag is only meaningful before unrolling.
            new_node.sub_graph = None

            new_nodes.append(new_node)

    # ------------------------------------------------------------------ #
    # 4. Rewire post-loop nodes (those that depend on the LOOP node)       #
    # ------------------------------------------------------------------ #
    last_exit_ids = [_round_id(eid, effective_rounds) for eid in exit_node_ids]
    loop_node_id = loop_node.id

    for node in graph.nodes.values():
        if loop_node_id in node.depends_on:
            new_deps = [dep for dep in node.depends_on if dep != loop_node_id]
            new_deps.extend(last_exit_ids)
            node.depends_on = new_deps

    # ------------------------------------------------------------------ #
    # 4b. Rewrite post-loop input bindings and gate predicates that        #
    #     reference the LOOP node so they point to the actual last-round   #
    #     body nodes after the LOOP is removed from the graph.             #
    # ------------------------------------------------------------------ #
    # Build a map: output_name → (last-round body node id, body node).
    # When a post-loop node's input says step_id=<loop_node_id>, redirect
    # it to the last round of the body node that declares that output. This
    # ensures that after the LOOP node is removed from the graph the executor
    # can still resolve bound inputs (e.g. gate-review binding review_passed
    # from review-converge-loop after unrolling to review__r3).
    output_producers: dict[str, str] = {}
    output_producer_body_node: dict[str, "Node"] = {}
    for body_node in body_nodes:
        for out in body_node.outputs:
            output_producers[out.name] = _round_id(body_node.id, effective_rounds)
            output_producer_body_node[out.name] = body_node
    _fallback_last = last_exit_ids[0] if last_exit_ids else None

    # rec-1 last-successful-round: when a convergence signal is declared and
    # effective_rounds > 1, post-loop input bindings for ALL outputs (not just
    # the signal) must fall back to earlier rounds when the static final round
    # is skipped (early convergence).  We emit fallback_step_ids (rN-1 … r1)
    # so the walker can try them in order before returning None.
    # This extends last-successful-round resolution from gate predicates (OR-chain
    # handled below) to regular input bindings — the P1 fix.
    _emit_fallbacks = _cs is not None and effective_rounds > 1

    for node in graph.nodes.values():
        # Rewrite input bindings
        for inp in node.inputs:
            if inp.step_id == loop_node_id:
                if inp.output_name and inp.output_name in output_producers:
                    producer_body = output_producer_body_node[inp.output_name]
                    inp.step_id = output_producers[inp.output_name]  # static rN
                    # P1 fix: add fallbacks rN-1 … r1 so the walker can resolve
                    # from the last materialised round on early convergence.
                    if _emit_fallbacks:
                        inp.fallback_step_ids = [
                            _round_id(producer_body.id, j)
                            for j in range(effective_rounds - 1, 0, -1)
                        ]
                elif _fallback_last is not None:
                    inp.step_id = _fallback_last

        # s3: Rewrite grammar-legal gate predicates that reference the LOOP
        # node ID. After unrolling the LOOP is gone — replace
        # ``$<loop_id>.output.<field>`` with ``$<producer__rN>.output.<field>``
        # so the gate evaluator can resolve the field from the last round's
        # materialised outputs. Only predicates in dotpath reference form
        # ($<id>.output.*) are rewritten; prose predicates are left intact.
        #
        # rec-1 last-successful-round gate: for the convergence signal output,
        # replace ``$<loop_id>.output.<signal> == true`` (and whitespace/case
        # variants — P2 fix) with an OR-chain over ALL rounds so that early-
        # converged runs (where later rounds are skipped and produce no output)
        # still pass the gate.  A never-converged run (all rounds emitted False)
        # evaluates the full OR as False, so bug-#26 blocking is preserved.
        if node.gate and f"${loop_node_id}." in node.gate:
            gate_rewritten = node.gate
            # Convergence-signal special case: emit OR-chain for last-successful-round.
            # P2 fix: use regex to match whitespace/case variants of ``== true``
            # (e.g. ``==true``, ``== True``) so they are not silently bypassed.
            if _cs is not None and _cs_producer is not None:
                _cs_ref_pattern = re.compile(
                    re.escape(f"${loop_node_id}.output.{_cs}") + r"\s*==\s*true",
                    re.IGNORECASE,
                )
                _cs_match = _cs_ref_pattern.search(gate_rewritten)
                if _cs_match:
                    # SAFETY: only apply the OR-chain rewrite when the convergence
                    # predicate spans the *entire* gate expression.  For compound
                    # gates (``<pred> && <other>`` or ``<pred> || <other>``), the
                    # OR-chain injection would break conjunction precedence because
                    # ``&&`` binds tighter than ``||`` in the Archon grammar and
                    # parentheses are not legal (they parse to the fail-closed
                    # ``Skipped`` sentinel).  Instead we fall through to the generic
                    # per-round ``.replace`` below, which substitutes the loop-id
                    # with the static rN binding — correct and grammar-safe.
                    _gate_stripped = gate_rewritten.strip()
                    _whole_gate = _cs_ref_pattern.fullmatch(_gate_stripped) is not None
                    if _whole_gate:
                        or_parts = [
                            f"${_round_id(_cs_producer.id, j)}.output.{_cs} == true"
                            for j in range(1, effective_rounds + 1)
                        ]
                        gate_rewritten = _cs_ref_pattern.sub(
                            " || ".join(or_parts), gate_rewritten
                        )
                    elif effective_rounds > 1:
                        # pr20-fable-review T2: a COMPOUND gate referencing the
                        # convergence signal (``<cs> == true && <other>`` /
                        # ``<cs> == true || <other>``) falls through to the
                        # generic static-last-round substitution below — no
                        # OR-chain fallback across earlier rounds is applied to
                        # EITHER operand, because the strict grammar has no
                        # parentheses to safely scope an OR-chain injection
                        # inside a compound expression (see the SAFETY note
                        # above). If the loop converges early (a round before
                        # `effective_rounds` satisfies the signal), the static
                        # last round has no materialised output at all, so
                        # `_eval_operand_fail_closed` (evaluator.py, T1 fix)
                        # correctly evaluates that operand False for THAT
                        # round — but there is no earlier-round fallback to
                        # try, so the whole compound gate false-blocks a
                        # genuinely converged run. Reject this combination at
                        # load time rather than let it silently under/over
                        # block: an author who needs a compound gate on a
                        # multi-round convergence loop must gate on a single
                        # pure `<cs> == true` reference (which DOES get the
                        # OR-chain) and move the additional condition to a
                        # separate downstream gate node instead.
                        raise GraphLoadError(
                            f"downstream node {node.id!r} has a COMPOUND gate "
                            f"referencing LOOP {loop_node_id!r}'s convergence_signal "
                            f"{_cs!r} inside a compound expression (&&/||) with "
                            f"max_rounds={effective_rounds} > 1: {node.gate!r}. "
                            f"Only a gate that is PURELY "
                            f"`${loop_node_id}.output.{_cs} == true` gets the "
                            f"early-convergence OR-chain rewrite; a compound gate "
                            f"falls back to a static last-round reference that "
                            f"false-blocks a run that converged before the last "
                            f"round. Split the compound condition into two gate "
                            f"nodes, or gate on the pure convergence signal alone."
                        )
            # Generic replacement for all remaining $<loop_id>.output.<field> refs
            # (non-convergence outputs, or convergence refs not in == true form).
            for out_name, producer_id in output_producers.items():
                gate_rewritten = gate_rewritten.replace(
                    f"${loop_node_id}.output.{out_name}",
                    f"${producer_id}.output.{out_name}",
                )
            # Fallback: replace any remaining $<loop_id>. references
            if _fallback_last is not None and f"${loop_node_id}." in gate_rewritten:
                gate_rewritten = gate_rewritten.replace(
                    f"${loop_node_id}.",
                    f"${_fallback_last}.",
                )
            node.gate = gate_rewritten

    # ------------------------------------------------------------------ #
    # 5. Update graph.nodes: remove LOOP node + bare body nodes, add copies #
    # ------------------------------------------------------------------ #
    del graph.nodes[loop_node_id]
    for body_node in body_nodes:
        del graph.nodes[body_node.id]
    for new_node in new_nodes:
        graph.nodes[new_node.id] = new_node


def expand_loops(graph: Graph) -> Graph:
    """Expand all LOOP nodes in *graph* into deterministic round-copy sequences.

    Modifies *graph* in place and returns it.  When there are no LOOP
    nodes this is a cheap no-op.  After expansion the graph contains zero
    LOOP-type nodes and all ids are stable across loads.
    """
    # Collect LOOP nodes that carry a feature tag (opt-in to unroll).
    # LOOP nodes without loop_config.feature are left untouched so
    # pre-existing workflows remain byte-compatible until they opt in.
    loop_nodes = [
        n for n in graph.nodes.values()
        if n.node_type == NodeType.LOOP
        and n.loop_config is not None
        and n.loop_config.feature is not None
    ]

    for loop_node in loop_nodes:
        _expand_one_loop(graph, loop_node)

    # Rebuild edges from the mutated depends_on values
    graph.edges = _rebuild_edges(graph)
    return graph


def _rebuild_edges(graph: Graph) -> list[ConditionalEdge]:
    """Derive fresh ConditionalEdge list from current graph.nodes.depends_on."""
    edges: list[ConditionalEdge] = []
    for node in graph.nodes.values():
        for predecessor_id in node.depends_on:
            edges.append(
                ConditionalEdge(
                    from_node_id=predecessor_id,
                    to_node_id=node.id,
                    when=node.when,
                )
            )
    return edges
