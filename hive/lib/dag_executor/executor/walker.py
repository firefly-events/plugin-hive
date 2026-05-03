"""Walker — Kahn's topological sort + sequential dispatch.

Per hde-2 design locks:
  * Sequential execution only. Parallel fan-out is hde-4.
  * Per-step `optional: true` + a recoverable handler error → log
    + continue. Per-input `optional` is honored when resolving inputs
    (a missing/skipped upstream becomes `None`).
  * Every dispatch is bracketed by `node_started`/`node_completed`
    (or `node_failed`) telemetry. Every event carries the run_id.

hde-5 additions:
  * `walk(..., run_state_path=...)` enables run-state persistence.
    When omitted, behaviour is identical to hde-2 (back-compat for
    spine parity tests).
  * `replay(...)` is the resume entry — loads checkpointed state,
    re-executes the previously-failed node first (idempotent
    contract), continues forward.

hde-3a additions:
  * `when:` predicates are parsed and evaluated against the materialised
    output graph BEFORE dispatch. False predicates skip the node and
    emit a ``predicate_evaluated`` event. Invalid predicates (parse
    error, missing field) are fail-closed → False + warning event;
    they do NOT abort the run.
  * Multi-upstream nodes (depends_on count > 1) are gated by the
    ``none_failed_min_one_success`` trigger rule: RUN iff ≥1 upstream
    is COMPLETED, else SKIP. Failed upstreams convert to SKIP for the
    candidate node — failure does NOT cascade as failure.
"""

from __future__ import annotations

from collections import defaultdict, deque
from pathlib import Path
from typing import Any

from hive.lib.dag_executor.graph import Graph, InputBinding, Node
from hive.lib.dag_executor.routing import (
    ActivationDecision,
    Skipped,
    evaluate as eval_predicate,
    none_failed_min_one_success,
    parse as parse_predicate,
)

from .dispatcher import Dispatcher
from .errors import (
    HandlerError,
    WalkerCycleError,
    WalkerOptionalStepFailure,
)
from .handlers import NodeOutput
from .telemetry import Telemetry


def _topological_order(graph: Graph) -> list[str]:
    """Kahn's algorithm over Node.depends_on.

    Returns node ids in a topological order. Raises WalkerCycleError
    if the graph contains a cycle the loader/validator missed.
    Tie-breaks on lexicographic node id for deterministic ordering
    so the spine parity diff stays byte-stable across runs.
    """
    in_degree: dict[str, int] = {nid: 0 for nid in graph.nodes}
    successors: dict[str, list[str]] = defaultdict(list)
    for node_id, node in graph.nodes.items():
        for predecessor in node.depends_on:
            in_degree[node_id] = in_degree.get(node_id, 0) + 1
            successors[predecessor].append(node_id)

    ready = deque(sorted(nid for nid, deg in in_degree.items() if deg == 0))
    order: list[str] = []
    while ready:
        nid = ready.popleft()
        order.append(nid)
        for successor in sorted(successors[nid]):
            in_degree[successor] -= 1
            if in_degree[successor] == 0:
                ready.append(successor)

    if len(order) != len(graph.nodes):
        unresolved = sorted(set(graph.nodes) - set(order))
        raise WalkerCycleError(
            f"cycle detected; unresolved nodes: {unresolved}"
        )
    return order


def _output_graph_view(
    materialised: dict[str, NodeOutput],
) -> dict[str, dict[str, Any]]:
    """Project materialised outputs into the predicate evaluator's shape.

    The evaluator addresses values via ``$nodeId.output.field``; the
    walker's runtime view is ``materialised[node_id].outputs[field]``.
    This wraps each NodeOutput's outputs dict under an ``"output"`` key
    so dot-paths resolve cleanly without coupling the routing layer to
    the executor's NodeOutput dataclass.
    """

    return {
        node_id: {"output": dict(out.outputs)}
        for node_id, out in materialised.items()
    }


def _evaluate_when_predicate(
    node: Node,
    materialised: dict[str, NodeOutput],
    telemetry: Telemetry,
) -> bool:
    """Return True if the node's ``when:`` predicate (if any) holds.

    Fail-closed: a missing/empty predicate counts as True (don't skip).
    A parse failure or a missing-field eval failure resolves to False
    AND emits a ``predicate_evaluated`` warning event so the divergence
    is observable in the telemetry stream.
    """

    predicate_text = getattr(node, "when", None)
    if not predicate_text:
        return True

    ast = parse_predicate(predicate_text)
    if isinstance(ast, Skipped):
        telemetry.emit(
            "predicate_evaluated",
            node.id,
            {
                "expr": predicate_text,
                "result": False,
                "fail_closed": True,
                "reason": ast.reason,
            },
        )
        return False

    output_graph = _output_graph_view(materialised)
    result = eval_predicate(ast, output_graph)
    payload: dict[str, Any] = {
        "expr": predicate_text,
        "result": bool(result),
    }
    if not result:
        # Fail-closed evaluation paths (missing field, type mismatch)
        # also funnel through this branch. We can't distinguish a
        # legitimate False from a fail-closed False at this layer
        # without re-running the AST through a probing evaluator;
        # the contract documents both as "False".
        payload["fail_closed"] = False
    telemetry.emit("predicate_evaluated", node.id, payload)
    return bool(result)


def _trigger_rule_decision(
    node: Node,
    node_statuses: dict[str, Any],
    telemetry: Telemetry,
) -> ActivationDecision:
    """Apply ``none_failed_min_one_success`` AT MULTI-UPSTREAM JOINS.

    Per the hde-3a story spec: trigger-rule semantics gate
    multi-upstream joins (depends_on count > 1). Single-upstream nodes
    fall through to the legacy hde-2 path so the per-input ``optional``
    binding semantics (an upstream optional failure surfaces as None
    on the downstream binding rather than skipping the downstream)
    are preserved.

    Root nodes (no upstreams) always RUN. A SKIP decision emits a
    ``node_skipped`` event with the upstream status set so
    failure-cascade observers can see the chain.
    """

    upstream_ids = list(node.depends_on)
    if len(upstream_ids) <= 1:
        # Root or single-upstream: legacy behaviour. The walker's
        # `_resolve_inputs` + per-input optional handle missing/failed
        # upstream values; trigger_rule does not gate here.
        return ActivationDecision.RUN

    from hive.lib.dag_executor.run_state import NodeStatus

    statuses: list[Any] = []
    for upstream_id in upstream_ids:
        status = node_statuses.get(upstream_id, NodeStatus.PENDING)
        statuses.append(status)

    decision = none_failed_min_one_success(statuses)
    if decision == ActivationDecision.SKIP:
        telemetry.emit(
            "node_skipped",
            node.id,
            {
                "reason": "trigger_rule:none_failed_min_one_success",
                "upstream_statuses": {
                    uid: (s.value if hasattr(s, "value") else str(s))
                    for uid, s in zip(upstream_ids, statuses)
                },
            },
        )
    return decision


def _resolve_inputs(
    node: Node,
    materialised: dict[str, NodeOutput],
    context: dict[str, Any],
) -> dict[str, Any]:
    """Materialise node inputs from upstream outputs and the run context."""
    resolved: dict[str, Any] = {}
    for binding in node.inputs:
        resolved[binding.name] = _resolve_one(binding, materialised, context)
    return resolved


def _resolve_one(
    binding: InputBinding,
    materialised: dict[str, NodeOutput],
    context: dict[str, Any],
) -> Any:
    if binding.source == "literal":
        return binding.value
    if binding.source == "context":
        if binding.context_key is None:
            return None
        return context.get(binding.context_key)
    if binding.source == "step_output":
        upstream = materialised.get(binding.step_id) if binding.step_id else None
        if upstream is None:
            if binding.optional:
                return None
            raise HandlerError(
                f"input {binding.name!r} requires step_output from {binding.step_id!r} "
                f"but the upstream produced no output"
            )
        if binding.output_name is None:
            return upstream.outputs
        if binding.output_name in upstream.outputs:
            return upstream.outputs[binding.output_name]
        if binding.optional:
            return None
        raise HandlerError(
            f"input {binding.name!r} requires output {binding.output_name!r} "
            f"from {binding.step_id!r}, but that output was not produced"
        )
    return None


class Walker:
    """Walks a Graph and dispatches each node sequentially."""

    def walk(
        self,
        graph: Graph,
        dispatcher: Dispatcher,
        run_id: str,
        telemetry: Telemetry,
        context: dict[str, Any] | None = None,
        run_state_path: Path | None = None,
        worktree_manager: Any | None = None,
    ) -> dict[str, NodeOutput]:
        """Walk the graph; persist state if `run_state_path` is set; isolate in a worktree if `worktree_manager` is set."""

        ctx = context or {}
        order = _topological_order(graph)
        materialised: dict[str, NodeOutput] = {}
        skipped: set[str] = set()

        worktree_path, owns_worktree = _maybe_open_worktree(
            worktree_manager=worktree_manager,
            run_id=run_id,
        )

        state, save_state = _maybe_open_run_state(
            run_id=run_id,
            workflow_slug=graph.workflow_name,
            run_state_path=run_state_path,
        )

        run_failed = False
        try:
            return self._walk_loop(
                order=order,
                graph=graph,
                dispatcher=dispatcher,
                run_id=run_id,
                telemetry=telemetry,
                ctx=ctx,
                materialised=materialised,
                skipped=skipped,
                state=state,
                save_state=save_state,
            )
        except BaseException:
            run_failed = True
            raise
        finally:
            if worktree_manager is not None and owns_worktree:
                if run_failed:
                    worktree_manager.preserve_on_failure(run_id)
                else:
                    worktree_manager.cleanup_success(run_id)

    def _walk_loop(
        self,
        order,
        graph,
        dispatcher,
        run_id,
        telemetry,
        ctx,
        materialised,
        skipped,
        state,
        save_state,
    ):
        from hive.lib.dag_executor.run_state import NodeStatus

        # Local per-node status mirror so the trigger_rule policy works
        # even when run_state persistence is disabled (no run_state_path).
        # When state IS persisted, this mirrors state.node_statuses.
        node_statuses: dict[str, Any] = {nid: NodeStatus.PENDING for nid in order}
        for node_id in order:
            node = graph.nodes[node_id]

            if node.skip_when:
                telemetry.emit(
                    "node_skipped",
                    node.id,
                    {"reason": "skip_when present (hde-3a evaluation pending)"},
                )
                skipped.add(node_id)
                node_statuses[node_id] = NodeStatus.SKIPPED
                state = _record_skipped(state, node_id)
                save_state(state)
                continue

            # hde-3a: trigger_rule first (upstream-status gate), then
            # `when:` predicate (output-value gate). Order matters —
            # a SKIP from trigger_rule means upstreams didn't produce
            # outputs the predicate could meaningfully reference.
            decision = _trigger_rule_decision(node, node_statuses, telemetry)
            if decision == ActivationDecision.SKIP:
                skipped.add(node_id)
                node_statuses[node_id] = NodeStatus.SKIPPED
                state = _record_skipped(state, node_id)
                save_state(state)
                continue

            if not _evaluate_when_predicate(node, materialised, telemetry):
                telemetry.emit(
                    "node_skipped",
                    node.id,
                    {"reason": "when_predicate_false"},
                )
                skipped.add(node_id)
                node_statuses[node_id] = NodeStatus.SKIPPED
                state = _record_skipped(state, node_id)
                save_state(state)
                continue

            inputs = _resolve_inputs(node, materialised, ctx)

            telemetry.emit("node_started", node.id, {})
            state = _record_running(state, node_id)
            save_state(state)

            # Pause nodes flip the run-level status to SUSPENDED for the
            # duration of the wait so external observers see the
            # suspension. We use `set_status` (non-freezing) so the
            # post-approve transition back to RUNNING is in-process.
            is_pause = _is_pause_node(node)
            if is_pause:
                state = _record_pause_suspended(state)
                save_state(state)

            try:
                output = dispatcher.dispatch(node, inputs, run_id)
            except HandlerError as exc:
                if node.optional:
                    telemetry.emit(
                        "node_failed",
                        node.id,
                        {"optional": True, "error": str(exc)},
                    )
                    materialised[node_id] = NodeOutput(
                        outputs={}, meta={"optional_failure": str(exc)}
                    )
                    node_statuses[node_id] = NodeStatus.FAILED
                    state = _record_optional_failure(state, node_id)
                    save_state(state)
                    continue
                telemetry.emit(
                    "node_failed",
                    node.id,
                    {"optional": False, "error": str(exc)},
                )
                node_statuses[node_id] = NodeStatus.FAILED
                state = _record_failure(
                    state,
                    node_id,
                    {"node_id": node_id, "error_class": type(exc).__name__, "message": str(exc)},
                )
                save_state(state)
                raise
            except Exception as exc:
                telemetry.emit(
                    "node_failed",
                    node.id,
                    {"optional": bool(node.optional), "error": str(exc)},
                )
                node_statuses[node_id] = NodeStatus.FAILED
                state = _record_failure(
                    state,
                    node_id,
                    {"node_id": node_id, "error_class": type(exc).__name__, "message": str(exc)},
                )
                save_state(state)
                if node.optional:
                    raise WalkerOptionalStepFailure(
                        f"optional node {node.id!r} raised non-handler exception: {exc}"
                    ) from exc
                raise

            materialised[node_id] = output
            if is_pause:
                state = _record_pause_resumed(state)
                save_state(state)
            telemetry.emit(
                "node_completed",
                node.id,
                {"outputs": list(output.outputs.keys())},
            )
            node_statuses[node_id] = NodeStatus.COMPLETED
            state = _record_completion(state, node_id, output)
            save_state(state)

        state = _record_final_completion(state)
        save_state(state)
        return materialised

    def replay(
        self,
        graph: Graph,
        dispatcher: Dispatcher,
        run_id: str,
        telemetry: Telemetry,
        state: Any,
        runs_root: Path | None = None,
        context: dict[str, Any] | None = None,
    ):
        """Resume a previously-failed/interrupted run.

        The previously-failed node re-executes FIRST (idempotent
        handler contract). Nodes already marked completed in `state`
        are skipped — their outputs are reloaded into `materialised`
        from the run_state's output_graph so downstream nodes can
        consume them.
        """
        from hive.lib.dag_executor.run_state import (
            NodeStatus,
            mark_completed,
            save,
            set_last_successful_node,
            set_node_output,
            set_node_status,
        )
        from hive.lib.dag_executor.run_state.resume import _replay_starting_index

        ctx = context or {}
        order = _topological_order(graph)
        materialised: dict[str, NodeOutput] = {}
        for node_id, status in state.node_statuses.items():
            if status == NodeStatus.COMPLETED:
                output_payload = state.output_graph.get(node_id, {})
                materialised[node_id] = NodeOutput(outputs=dict(output_payload))

        start_index = _replay_starting_index(order, state)

        # Mirror state.node_statuses into a local dict so trigger_rule
        # has access to upstream statuses for the replay segment too.
        node_statuses: dict[str, Any] = {
            nid: state.node_statuses.get(nid, NodeStatus.PENDING) for nid in order
        }

        for node_id in order[start_index:]:
            node = graph.nodes[node_id]

            if node.skip_when:
                telemetry.emit(
                    "node_skipped",
                    node.id,
                    {"reason": "skip_when present (hde-3a evaluation pending)"},
                )
                node_statuses[node_id] = NodeStatus.SKIPPED
                state = set_node_status(state, node_id, NodeStatus.SKIPPED)
                save(state, root=runs_root)
                continue

            decision = _trigger_rule_decision(node, node_statuses, telemetry)
            if decision == ActivationDecision.SKIP:
                node_statuses[node_id] = NodeStatus.SKIPPED
                state = set_node_status(state, node_id, NodeStatus.SKIPPED)
                save(state, root=runs_root)
                continue

            if not _evaluate_when_predicate(node, materialised, telemetry):
                telemetry.emit(
                    "node_skipped",
                    node.id,
                    {"reason": "when_predicate_false"},
                )
                node_statuses[node_id] = NodeStatus.SKIPPED
                state = set_node_status(state, node_id, NodeStatus.SKIPPED)
                save(state, root=runs_root)
                continue

            inputs = _resolve_inputs(node, materialised, ctx)

            telemetry.emit("node_started", node.id, {"replay": True})
            state = set_node_status(state, node_id, NodeStatus.RUNNING)
            save(state, root=runs_root)

            is_pause = _is_pause_node(node)
            if is_pause:
                state = _record_pause_suspended(state)
                save(state, root=runs_root)

            try:
                output = dispatcher.dispatch(node, inputs, run_id)
            except HandlerError as exc:
                if node.optional:
                    telemetry.emit(
                        "node_failed",
                        node.id,
                        {"optional": True, "error": str(exc), "replay": True},
                    )
                    materialised[node_id] = NodeOutput(
                        outputs={}, meta={"optional_failure": str(exc)}
                    )
                    node_statuses[node_id] = NodeStatus.FAILED
                    state = _record_optional_failure(state, node_id)
                    save(state, root=runs_root)
                    continue
                telemetry.emit(
                    "node_failed",
                    node.id,
                    {"optional": False, "error": str(exc), "replay": True},
                )
                node_statuses[node_id] = NodeStatus.FAILED
                state = _record_failure(
                    state,
                    node_id,
                    {"node_id": node_id, "error_class": type(exc).__name__, "message": str(exc)},
                )
                save(state, root=runs_root)
                raise
            except Exception as exc:
                telemetry.emit(
                    "node_failed",
                    node.id,
                    {"optional": bool(node.optional), "error": str(exc), "replay": True},
                )
                node_statuses[node_id] = NodeStatus.FAILED
                state = _record_failure(
                    state,
                    node_id,
                    {"node_id": node_id, "error_class": type(exc).__name__, "message": str(exc)},
                )
                save(state, root=runs_root)
                if node.optional:
                    raise WalkerOptionalStepFailure(
                        f"optional node {node.id!r} raised non-handler exception: {exc}"
                    ) from exc
                raise

            materialised[node_id] = output
            if is_pause:
                state = _record_pause_resumed(state)
                save(state, root=runs_root)
            node_statuses[node_id] = NodeStatus.COMPLETED
            telemetry.emit(
                "node_completed",
                node.id,
                {"outputs": list(output.outputs.keys()), "replay": True},
            )
            state = set_node_output(state, node_id, dict(output.outputs))
            state = set_node_status(state, node_id, NodeStatus.COMPLETED)
            state = set_last_successful_node(state, node_id)
            save(state, root=runs_root)

        state = mark_completed(state)
        save(state, root=runs_root)
        return state


def _maybe_open_worktree(worktree_manager: Any | None, run_id: str):
    """Decide whether to create a fresh worktree or reuse an outer one.

    Returns `(path, owned_by_us)` — `owned_by_us=False` means an outer
    skill (e.g., meta-meta-optimize) created the worktree and owns
    its cleanup; the walker must NOT cleanup or preserve in that case.
    """

    if worktree_manager is None:
        return None, False
    from hive.lib.dag_executor.isolation import decide_run_worktree

    decision = decide_run_worktree(
        run_id=run_id,
        repo_path=worktree_manager.repo_path,
        runs_root=worktree_manager.runs_root,
    )
    if decision.reused_outer:
        return decision.path, False
    worktree_manager.create(run_id)
    return decision.path, True


def _maybe_open_run_state(
    run_id: str,
    workflow_slug: str | None,
    run_state_path: Path | None,
):
    """Open run-state for write if `run_state_path` is set; otherwise no-op."""

    if run_state_path is None:
        return None, lambda _state: None

    from hive.lib.dag_executor.run_state import create, save

    runs_root_dir = Path(run_state_path)
    state = create(run_id, workflow_slug or "")

    def _save(updated):
        if updated is None:
            return
        save(updated, root=runs_root_dir)

    save(state, root=runs_root_dir)
    return state, _save


def _is_pause_node(node) -> bool:
    """Whether `node` is a pause node — by enum value or string."""

    nt = getattr(node, "node_type", None)
    if nt is None:
        return False
    if hasattr(nt, "value"):
        return nt.value == "pause"
    return str(nt).lower() == "pause"


def _record_pause_suspended(state):
    if state is None:
        return None
    from hive.lib.dag_executor.run_state import RunStatus, set_status

    return set_status(state, RunStatus.SUSPENDED)


def _record_pause_resumed(state):
    if state is None:
        return None
    from hive.lib.dag_executor.run_state import RunStatus, set_status

    return set_status(state, RunStatus.RUNNING)


def _record_skipped(state, node_id: str):
    if state is None:
        return None
    from hive.lib.dag_executor.run_state import NodeStatus, set_node_status

    return set_node_status(state, node_id, NodeStatus.SKIPPED)


def _record_running(state, node_id: str):
    if state is None:
        return None
    from hive.lib.dag_executor.run_state import NodeStatus, set_node_status

    return set_node_status(state, node_id, NodeStatus.RUNNING)


def _record_completion(state, node_id: str, output: NodeOutput):
    if state is None:
        return None
    from hive.lib.dag_executor.run_state import (
        NodeStatus,
        set_last_successful_node,
        set_node_output,
        set_node_status,
    )

    state = set_node_output(state, node_id, dict(output.outputs))
    state = set_node_status(state, node_id, NodeStatus.COMPLETED)
    return set_last_successful_node(state, node_id)


def _record_optional_failure(state, node_id: str):
    if state is None:
        return None
    from hive.lib.dag_executor.run_state import (
        NodeStatus,
        set_node_output,
        set_node_status,
    )

    state = set_node_output(state, node_id, {})
    return set_node_status(state, node_id, NodeStatus.FAILED)


def _record_failure(state, node_id: str, failure_info: dict[str, Any]):
    if state is None:
        return None
    from hive.lib.dag_executor.run_state import NodeStatus, mark_failed, set_node_status

    state = set_node_status(state, node_id, NodeStatus.FAILED)
    return mark_failed(state, failure_info)


def _record_final_completion(state):
    if state is None:
        return None
    from hive.lib.dag_executor.run_state import RunStatus, mark_completed

    if state.status != RunStatus.RUNNING:
        return state
    return mark_completed(state)
