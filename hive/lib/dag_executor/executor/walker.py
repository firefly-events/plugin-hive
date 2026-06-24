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

import yaml

from hive.lib.dag_executor.graph import Graph, InputBinding, Node, NodeType
from hive.lib.dag_executor.routing import (
    ActivationDecision,
    ParallelScheduler,
    ScheduleResult,
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


_REPO_ROOT = Path(__file__).resolve().parents[4]
_PHASE_STARTED_SLUG = "started"
_PHASE_COMPLETE_SLUG = "completed"
_PHASE_BLOCKED_TRIGGER_RULE_SKIP = "trigger-rule-skip"
_PHASE_BLOCKED_UPSTREAM_FAILED = "upstream-failed"
_PHASE_BLOCKED_UPSTREAM_SKIPPED = "upstream-skipped"
_USER_GATE_OUTPUT_GRAPH_INPUT = "__output_graph"


def _normalise_scheduler_flag(raw: Any) -> bool:
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    if isinstance(raw, int):
        return raw != 0
    return False


def _workflow_step_metadata(
    graph: Graph,
    context: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    metadata: dict[str, dict[str, Any]] = {}
    workflow_path = _REPO_ROOT / "hive" / "workflows" / f"{graph.workflow_name}.workflow.yaml"
    if workflow_path.is_file():
        try:
            raw = yaml.safe_load(workflow_path.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError):
            raw = {}
        steps = raw.get("steps") if isinstance(raw, dict) else None
        if isinstance(steps, list):
            for step in steps:
                if not isinstance(step, dict):
                    continue
                step_id = step.get("id")
                under_scheduler = step.get("under_scheduler")
                if isinstance(step_id, str) and isinstance(under_scheduler, dict):
                    metadata[step_id] = {"under_scheduler": dict(under_scheduler)}

    overrides = context.get("step_metadata")
    if isinstance(overrides, dict):
        for step_id, override in overrides.items():
            if not isinstance(step_id, str) or not isinstance(override, dict):
                continue
            merged = dict(metadata.get(step_id, {}))
            if "under_scheduler" in override and isinstance(override["under_scheduler"], dict):
                merged["under_scheduler"] = dict(override["under_scheduler"])
            if merged:
                metadata[step_id] = merged
    return metadata


def _scheduler_pause_decision(
    node: Node,
    context: dict[str, Any],
    step_metadata: dict[str, dict[str, Any]],
) -> str | None:
    if not _normalise_scheduler_flag(context.get("scheduler")):
        return None
    if not _is_pause_node(node):
        return None

    under_scheduler = getattr(node, "under_scheduler", None)
    if not isinstance(under_scheduler, dict):
        under_scheduler = step_metadata.get(node.id, {}).get("under_scheduler")
    if not isinstance(under_scheduler, dict):
        return None

    auto_approve = under_scheduler.get("auto_approve")
    if auto_approve is True:
        return "auto_approve"
    if auto_approve is False:
        return "error"
    return None


def _effective_deps(node: Node) -> set[str]:
    """Union of explicit ``depends_on`` and implicit ``step_output`` deps.

    Some workflows (e.g., test-swarm.workflow.yaml) declare a node's
    ``depends_on`` against a structural ancestor while binding inputs
    from a different upstream. Under the hde-2 sequential path the lex
    topological tie-break happened to satisfy the implicit edge by
    accident; under wave-based dispatch we need the dependency view to
    be complete or we'd schedule a node before the upstream it actually
    consumes. This function returns the union so wave membership is
    correct for any workflow that round-trips through the loader.
    """

    deps: set[str] = set(node.depends_on)
    for binding in node.inputs:
        if binding.source == "step_output" and binding.step_id:
            deps.add(binding.step_id)
    return deps


def _ready_wave(
    graph: Graph,
    order: list[str],
    processed: set[str],
) -> list[str]:
    """Return all not-yet-processed nodes whose upstreams are all terminal.

    A node is "ready" iff every entry in its EFFECTIVE dependency set
    (explicit ``depends_on`` ∪ implicit ``step_output`` input sources)
    is in ``processed``. Returns node ids in topological order (the
    ``order`` argument is the linear sort tie-broken by lex node-id) so
    wave membership is deterministic across runs.

    A wave with size 1 collapses to the legacy hde-2 sequential path
    in the caller — this function does NOT special-case it.
    """

    wave: list[str] = []
    for node_id in order:
        if node_id in processed:
            continue
        node = graph.nodes[node_id]
        deps = _effective_deps(node)
        if all(dep in processed for dep in deps):
            wave.append(node_id)
    return wave


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
    # `fail_closed` is intentionally unset on the runtime-False path:
    # this layer cannot distinguish a legitimate False from a
    # missing-field / type-mismatch fail-closed False without re-running
    # the AST through a probing evaluator. Reporting `fail_closed: False`
    # would be misleading; consumers that need that distinction should
    # subscribe to evaluator-level events.
    telemetry.emit("predicate_evaluated", node.id, payload)
    return bool(result)


def _user_gate_will_halt(node: Node, materialised: dict[str, NodeOutput]) -> bool:
    """Return True when a user_gate needs pause-style run suspension."""

    predicate_text = getattr(node, "auto_pass_when", None)
    if not predicate_text or not str(predicate_text).strip():
        return True

    ast = parse_predicate(str(predicate_text).strip())
    if isinstance(ast, Skipped):
        return True
    return not bool(eval_predicate(ast, _output_graph_view(materialised)))


def _resolve_dispatch_inputs(
    node: Node,
    materialised: dict[str, NodeOutput],
    context: dict[str, Any],
    skipped: set[str] | None = None,
) -> dict[str, Any]:
    """Resolve inputs, adding the output-graph view needed by user_gate."""

    inputs = _resolve_inputs(node, materialised, context, skipped)
    if _is_user_gate_node(node):
        inputs = dict(inputs)
        inputs[_USER_GATE_OUTPUT_GRAPH_INPUT] = _output_graph_view(materialised)
    return inputs


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
    skipped: set[str] | None = None,
) -> dict[str, Any]:
    """Materialise node inputs from upstream outputs and the run context.

    ``skipped`` is the walker's set of node ids that resolved to SKIPPED
    (via trigger_rule, when_predicate, skip_when, or hde-4 branch
    failure). When a binding's ``step_id`` is in ``skipped``, the
    binding auto-resolves to None — the trigger_rule has already
    activated this node despite the missing upstream, so refusing to
    resolve here would defeat the policy. Without ``skipped`` (or for
    nodes whose upstream is genuinely absent for other reasons) the
    legacy hde-2 raise-on-missing path stands, guarded by per-input
    ``optional``.
    """
    resolved: dict[str, Any] = {}
    skipped_set = skipped or set()
    for binding in node.inputs:
        resolved[binding.name] = _resolve_one(
            binding, materialised, context, skipped_set
        )
    return resolved


def _resolve_one(
    binding: InputBinding,
    materialised: dict[str, NodeOutput],
    context: dict[str, Any],
    skipped: set[str],
) -> Any:
    if binding.source == "literal":
        return binding.value
    if binding.source == "context":
        if binding.context_key is None:
            return None
        return context.get(binding.context_key)
    if binding.source == "step_output":
        # SKIPPED upstreams auto-resolve to None (hde-4 join semantics
        # under `none_failed_min_one_success`). The trigger_rule has
        # already decided RUN despite this upstream not producing
        # outputs — refusing here would contradict that decision.
        if binding.step_id and binding.step_id in skipped:
            return None
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


def _dispatch_with_retry(
    dispatcher: Dispatcher,
    node: Any,
    inputs: dict[str, Any],
    run_id: str,
    telemetry: Telemetry,
) -> "NodeOutput":
    """Dispatch a node, retrying on HandlerError up to node.retry.max_attempts.

    C2: bounded retry per hde-architect design — no LOOP primitive, just
    per-node re-dispatch. Both sequential and parallel walk paths use this
    helper so retry semantics are identical regardless of wave size.
    """
    max_attempts = 1
    if node.retry and isinstance(node.retry, dict):
        try:
            max_attempts = max(1, int(node.retry.get("max_attempts", 1)))
        except (TypeError, ValueError):
            max_attempts = 1

    for attempt in range(1, max_attempts + 1):
        try:
            return dispatcher.dispatch(node, inputs, run_id)
        except HandlerError as exc:
            if attempt >= max_attempts:
                raise
            telemetry.emit(
                "node_retry",
                node.id,
                {
                    "attempt": attempt,
                    "max_attempts": max_attempts,
                    "error": str(exc),
                },
            )
    # Unreachable — loop always either returns or raises on the last attempt.
    raise AssertionError("_dispatch_with_retry: unreachable")  # pragma: no cover


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
        step_metadata = _workflow_step_metadata(graph, ctx)
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
                step_metadata=step_metadata,
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
        step_metadata,
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

        # Wave-based iteration (hde-4): group ready nodes into a wave
        # and dispatch the wave in parallel iff size > 1. Size-1 waves
        # take the legacy hde-2 sequential path verbatim — that's the
        # spine-parity guarantee for fully-linear workflows like
        # code-review.workflow.yaml.
        processed: set[str] = set()

        while len(processed) < len(order):
            wave = _ready_wave(graph, order, processed)
            if not wave:
                # Defensive: every remaining node has an unsatisfied
                # dependency that won't resolve. Topo sort already
                # guarantees a cycle would have raised; this branch is
                # unreachable in practice but raises rather than spins.
                remaining = [nid for nid in order if nid not in processed]
                raise WalkerCycleError(
                    f"walker stalled with no ready nodes; remaining: {remaining}"
                )

            if len(wave) == 1:
                # Sequential path — identical control flow to hde-2.
                node_id = wave[0]
                state, processed_one = self._dispatch_one_sequential(
                    node_id=node_id,
                    graph=graph,
                    dispatcher=dispatcher,
                    run_id=run_id,
                    telemetry=telemetry,
                    ctx=ctx,
                    step_metadata=step_metadata,
                    materialised=materialised,
                    skipped=skipped,
                    node_statuses=node_statuses,
                    state=state,
                    save_state=save_state,
                )
                if processed_one:
                    processed.add(node_id)
                continue

            # Multi-node wave. Pause and user_gate nodes always serialise —
            # they freeze run state (halt for human review), which is
            # incompatible with sibling dispatch on a thread pool. Filter
            # pauses/user_gates out into a serial micro-wave processed
            # first; the remainder runs under ParallelScheduler.
            sequential_ids = [
                nid for nid in wave
                if _is_pause_node(graph.nodes[nid]) or _is_user_gate_node(graph.nodes[nid])
            ]
            parallel_ids = [nid for nid in wave if nid not in sequential_ids]

            for node_id in sequential_ids:
                state, processed_one = self._dispatch_one_sequential(
                    node_id=node_id,
                    graph=graph,
                    dispatcher=dispatcher,
                    run_id=run_id,
                    telemetry=telemetry,
                    ctx=ctx,
                    step_metadata=step_metadata,
                    materialised=materialised,
                    skipped=skipped,
                    node_statuses=node_statuses,
                    state=state,
                    save_state=save_state,
                )
                if processed_one:
                    processed.add(node_id)

            if not parallel_ids:
                continue

            if len(parallel_ids) == 1:
                node_id = parallel_ids[0]
                state, processed_one = self._dispatch_one_sequential(
                    node_id=node_id,
                    graph=graph,
                    dispatcher=dispatcher,
                    run_id=run_id,
                    telemetry=telemetry,
                    ctx=ctx,
                    step_metadata=step_metadata,
                    materialised=materialised,
                    skipped=skipped,
                    node_statuses=node_statuses,
                    state=state,
                    save_state=save_state,
                )
                if processed_one:
                    processed.add(node_id)
                continue

            state = self._dispatch_parallel_wave(
                wave_ids=parallel_ids,
                graph=graph,
                dispatcher=dispatcher,
                run_id=run_id,
                telemetry=telemetry,
                ctx=ctx,
                step_metadata=step_metadata,
                materialised=materialised,
                skipped=skipped,
                node_statuses=node_statuses,
                state=state,
                save_state=save_state,
            )
            for node_id in parallel_ids:
                processed.add(node_id)

        state = _record_final_completion(state)
        save_state(state)
        return materialised

    def _dispatch_one_sequential(
        self,
        node_id,
        graph,
        dispatcher,
        run_id,
        telemetry,
        ctx,
        step_metadata,
        materialised,
        skipped,
        node_statuses,
        state,
        save_state,
    ):
        """Run a single node through the legacy hde-2 sequential path.

        Returns (state, processed) where ``processed`` is True iff the
        node reached a terminal status (COMPLETED, SKIPPED, FAILED-but-
        optional). A non-optional FAILED node raises before returning,
        same as the hde-2 path.
        """

        from hive.lib.dag_executor.run_state import NodeStatus

        node = graph.nodes[node_id]

        if node.skip_when:
            skip_info = {"reason": "skip_when present (hde-3a evaluation pending)"}
            telemetry.emit(
                "node_skipped",
                node.id,
                skip_info,
            )
            skipped.add(node_id)
            node_statuses[node_id] = NodeStatus.SKIPPED
            state = _record_skipped(state, node_id, skip_info, source_epic=_source_epic(ctx))
            save_state(state)
            return state, True

        # hde-3a: trigger_rule first (upstream-status gate), then
        # `when:` predicate (output-value gate). Order matters —
        # a SKIP from trigger_rule means upstreams didn't produce
        # outputs the predicate could meaningfully reference.
        decision = _trigger_rule_decision(node, node_statuses, telemetry)
        if decision == ActivationDecision.SKIP:
            skip_info = _trigger_rule_skip_info(node, node_statuses)
            skipped.add(node_id)
            node_statuses[node_id] = NodeStatus.SKIPPED
            state = _record_skipped(state, node_id, skip_info, source_epic=_source_epic(ctx))
            save_state(state)
            return state, True

        if not _evaluate_when_predicate(node, materialised, telemetry):
            skip_info = {"reason": "when_predicate_false"}
            telemetry.emit(
                "node_skipped",
                node.id,
                skip_info,
            )
            skipped.add(node_id)
            node_statuses[node_id] = NodeStatus.SKIPPED
            state = _record_skipped(state, node_id, skip_info, source_epic=_source_epic(ctx))
            save_state(state)
            return state, True

        inputs = _resolve_dispatch_inputs(node, materialised, ctx, skipped)

        telemetry.emit("node_started", node.id, {})
        state = _record_running(state, node_id, source_epic=_source_epic(ctx))
        save_state(state)

        scheduler_pause = _scheduler_pause_decision(node, ctx, step_metadata)
        is_pause = (
            _is_pause_node(node)
            or (_is_user_gate_node(node) and _user_gate_will_halt(node, materialised))
        ) and scheduler_pause is None

        try:
            if scheduler_pause == "auto_approve":
                output = NodeOutput(
                    outputs={},
                    meta={"under_scheduler": "auto_approved"},
                )
            else:
                if scheduler_pause == "error":
                    raise HandlerError(
                        f"pause node {node.id!r} reached in scheduler context with "
                        "under_scheduler.auto_approve=false"
                    )
                # Pause nodes flip the run-level status to SUSPENDED for the
                # duration of the wait so external observers see the
                # suspension. We use `set_status` (non-freezing) so the
                # post-approve transition back to RUNNING is in-process.
                if is_pause:
                    state = _record_pause_suspended(state)
                    save_state(state)
                output = _dispatch_with_retry(dispatcher, node, inputs, run_id, telemetry)
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
                return state, True
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
                source_epic=_source_epic(ctx),
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
                source_epic=_source_epic(ctx),
            )
            save_state(state)
            if node.optional:
                raise WalkerOptionalStepFailure(
                    f"optional node {node.id!r} raised non-handler exception: {exc}"
                ) from exc
            raise

        # Per-node reconcile: materialise implement commits into repo_root
        # before downstream nodes (especially review) are dispatched.
        if _is_implement_node(node):
            _per_node_reconcile(dispatcher, node, output, run_id, telemetry)

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
        state = _record_completion(state, node_id, output, source_epic=_source_epic(ctx))
        save_state(state)
        return state, True

    def _dispatch_parallel_wave(
        self,
        wave_ids,
        graph,
        dispatcher,
        run_id,
        telemetry,
        ctx,
        step_metadata,
        materialised,
        skipped,
        node_statuses,
        state,
        save_state,
    ):
        """Dispatch a multi-node wave through ParallelScheduler.

        Pre-dispatch gates (skip_when, trigger_rule, when_predicate)
        run sequentially in the main thread — they touch only
        materialised/node_statuses (read) and telemetry/state (write).
        Filtering yields the subset of node_ids that actually need
        dispatch; that subset is fanned out to a thread pool via
        ParallelScheduler.

        Wave-internal telemetry order: ``node_started`` events fire in
        deterministic node-id order BEFORE dispatch (so the wave's
        start sequence is reproducible across runs), and
        ``node_completed``/``node_failed`` events fire in deterministic
        node-id order AFTER all futures join (so the wave's end
        sequence is also reproducible). The thread workers themselves
        emit nothing; all emit() calls happen on the main thread.
        """

        from hive.lib.dag_executor.run_state import NodeStatus

        wave_ids = sorted(wave_ids)
        runnable: list[str] = []

        # Pre-dispatch gates — same logic as the sequential path,
        # without the dispatch/result handling.
        for node_id in wave_ids:
            node = graph.nodes[node_id]

            if node.skip_when:
                skip_info = {"reason": "skip_when present (hde-3a evaluation pending)"}
                telemetry.emit(
                    "node_skipped",
                    node.id,
                    skip_info,
                )
                skipped.add(node_id)
                node_statuses[node_id] = NodeStatus.SKIPPED
                state = _record_skipped(state, node_id, skip_info, source_epic=_source_epic(ctx))
                save_state(state)
                continue

            decision = _trigger_rule_decision(node, node_statuses, telemetry)
            if decision == ActivationDecision.SKIP:
                skip_info = _trigger_rule_skip_info(node, node_statuses)
                skipped.add(node_id)
                node_statuses[node_id] = NodeStatus.SKIPPED
                state = _record_skipped(state, node_id, skip_info, source_epic=_source_epic(ctx))
                save_state(state)
                continue

            if not _evaluate_when_predicate(node, materialised, telemetry):
                skip_info = {"reason": "when_predicate_false"}
                telemetry.emit(
                    "node_skipped",
                    node.id,
                    skip_info,
                )
                skipped.add(node_id)
                node_statuses[node_id] = NodeStatus.SKIPPED
                state = _record_skipped(state, node_id, skip_info, source_epic=_source_epic(ctx))
                save_state(state)
                continue

            runnable.append(node_id)

        if not runnable:
            return state

        # Emit node_started for each runnable node, deterministic order.
        for node_id in runnable:
            telemetry.emit("node_started", graph.nodes[node_id].id, {})
            state = _record_running(state, node_id, source_epic=_source_epic(ctx))
            save_state(state)

        # Dispatch in parallel. Inputs are resolved inside the thread
        # via the resolve_inputs callable; materialised is read-only
        # from the workers' perspective (all upstreams are terminal by
        # wave construction).
        def _resolve(node):
            return _resolve_dispatch_inputs(node, materialised, ctx, skipped)

        # C2: wrap dispatch with retry so parallel workers honour node.retry
        # identically to the sequential path.
        def _retry_dispatch(node, inputs, run_id):
            return _dispatch_with_retry(dispatcher, node, inputs, run_id, telemetry)

        scheduler = ParallelScheduler()
        results = scheduler.schedule_ready_nodes(
            graph=graph,
            ready_node_ids=runnable,
            dispatcher=_retry_dispatch,
            run_id=run_id,
            resolve_inputs=_resolve,
        )

        # Apply results serially in deterministic node-id order so
        # state, materialised, and telemetry mutations are reproducible.
        # #26 / CodeRabbit: a fatal non-optional gate failure is deferred until
        # AFTER every sibling result in this wave is recorded — the siblings
        # already executed, so their completion/skip state must persist for
        # resume + telemetry before we halt the run.
        fatal_gate_error: BaseException | None = None
        for node_id in sorted(results):
            result: ScheduleResult = results[node_id]
            node = graph.nodes[node_id]

            if result.status == "completed":
                output: NodeOutput = result.output
                materialised[node_id] = output
                telemetry.emit(
                    "node_completed",
                    node.id,
                    {"outputs": list(output.outputs.keys())},
                )
                node_statuses[node_id] = NodeStatus.COMPLETED
                state = _record_completion(
                    state, node_id, output, source_epic=_source_epic(ctx)
                )
                save_state(state)
                continue

            # status == "skipped" with an error attached. A handler
            # exception on one branch becomes SKIPPED (not FAILED) per
            # hde-4 semantics: failure does NOT cascade as failure;
            # the join's trigger_rule decides downstream activation.
            err = result.error

            # #26: a failed non-optional GATE must HALT the run, not degrade to
            # SKIPPED. A gate exists to BLOCK downstream on failure — the hde-4
            # "failure→skipped, trigger_rule decides" rule is correct for
            # parallel BRANCH nodes (one branch failing must not cascade) but
            # defeats a gate: when gate-review raised in a wave alongside
            # codex-review/dev-standby, it was silently downgraded to SKIPPED and
            # integrate's none_failed_min_one_success join ran anyway, shipping a
            # needs_revision review. Re-raise so the gate is fatal, matching the
            # sequential path's non-optional behaviour.
            if (
                err is not None
                and _is_gate_node(node)
                and not getattr(node, "optional", False)
            ):
                telemetry.emit(
                    "node_failed",
                    node.id,
                    {"optional": False, "error": str(err), "parallel": True},
                )
                node_statuses[node_id] = NodeStatus.FAILED
                state = _record_failure(
                    state,
                    node_id,
                    {
                        "node_id": node_id,
                        "error_class": type(err).__name__,
                        "message": str(err),
                    },
                    source_epic=_source_epic(ctx),
                )
                save_state(state)
                if fatal_gate_error is None:
                    fatal_gate_error = err
                continue

            payload = {
                "optional": bool(getattr(node, "optional", False)),
                "error": str(err) if err is not None else "",
                "parallel": True,
                "skip_reason": result.skip_reason or "branch_exception",
            }
            telemetry.emit("node_failed", node.id, payload)
            node_statuses[node_id] = NodeStatus.SKIPPED
            skipped.add(node_id)
            state = _record_skipped(state, node_id, payload, source_epic=_source_epic(ctx))
            save_state(state)

        # Per-node reconcile for completed implement nodes in this wave.
        # Serialized to avoid concurrent git operations on the same work-dir.
        for node_id in sorted(results):
            if results[node_id].status == "completed":
                impl_node = graph.nodes[node_id]
                if _is_implement_node(impl_node):
                    _per_node_reconcile(
                        dispatcher, impl_node, results[node_id].output, run_id, telemetry
                    )

        # All sibling results are now recorded; halt the run on the first fatal
        # non-optional gate failure observed in this wave (#26 / CodeRabbit).
        if fatal_gate_error is not None:
            raise fatal_gate_error

        return state

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
        step_metadata = _workflow_step_metadata(graph, ctx)
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
        skipped_set: set[str] = {
            nid for nid, s in node_statuses.items() if s == NodeStatus.SKIPPED
        }

        for node_id in order[start_index:]:
            node = graph.nodes[node_id]

            if node.skip_when:
                skip_info = {"reason": "skip_when present (hde-3a evaluation pending)"}
                telemetry.emit(
                    "node_skipped",
                    node.id,
                    skip_info,
                )
                node_statuses[node_id] = NodeStatus.SKIPPED
                skipped_set.add(node_id)
                _emit_phase_blocked(node_id, skip_info, _source_epic(ctx))
                state = set_node_status(state, node_id, NodeStatus.SKIPPED)
                save(state, root=runs_root)
                continue

            decision = _trigger_rule_decision(node, node_statuses, telemetry)
            if decision == ActivationDecision.SKIP:
                skip_info = _trigger_rule_skip_info(node, node_statuses)
                node_statuses[node_id] = NodeStatus.SKIPPED
                skipped_set.add(node_id)
                _emit_phase_blocked(node_id, skip_info, _source_epic(ctx))
                state = set_node_status(state, node_id, NodeStatus.SKIPPED)
                save(state, root=runs_root)
                continue

            if not _evaluate_when_predicate(node, materialised, telemetry):
                skip_info = {"reason": "when_predicate_false"}
                telemetry.emit(
                    "node_skipped",
                    node.id,
                    skip_info,
                )
                node_statuses[node_id] = NodeStatus.SKIPPED
                skipped_set.add(node_id)
                _emit_phase_blocked(node_id, skip_info, _source_epic(ctx))
                state = set_node_status(state, node_id, NodeStatus.SKIPPED)
                save(state, root=runs_root)
                continue

            inputs = _resolve_dispatch_inputs(node, materialised, ctx, skipped_set)

            telemetry.emit("node_started", node.id, {"replay": True})
            _emit_phase_started(node_id, _source_epic(ctx))
            state = set_node_status(state, node_id, NodeStatus.RUNNING)
            save(state, root=runs_root)

            scheduler_pause = _scheduler_pause_decision(node, ctx, step_metadata)
            is_pause = (
                _is_pause_node(node)
                or (_is_user_gate_node(node) and _user_gate_will_halt(node, materialised))
            ) and scheduler_pause is None

            try:
                if scheduler_pause == "auto_approve":
                    output = NodeOutput(
                        outputs={},
                        meta={"under_scheduler": "auto_approved"},
                    )
                else:
                    if scheduler_pause == "error":
                        raise HandlerError(
                            f"pause node {node.id!r} reached in scheduler context with "
                            "under_scheduler.auto_approve=false"
                        )
                    if is_pause:
                        state = _record_pause_suspended(state)
                        save(state, root=runs_root)
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
                    source_epic=_source_epic(ctx),
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
                    source_epic=_source_epic(ctx),
                )
                save(state, root=runs_root)
                if node.optional:
                    raise WalkerOptionalStepFailure(
                        f"optional node {node.id!r} raised non-handler exception: {exc}"
                    ) from exc
                raise

            # Mirror walk(): materialise implement outputs into repo_root before
            # downstream nodes run, so a resumed/replayed run doesn't let review
            # read a stale tree (parity with the inline path; CodeRabbit #318).
            if _is_implement_node(node):
                _per_node_reconcile(dispatcher, node, output, run_id, telemetry)

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
            _emit_phase_complete(node_id, _source_epic(ctx))
            state = set_node_output(state, node_id, dict(output.outputs))
            state = set_node_status(state, node_id, NodeStatus.COMPLETED)
            state = set_last_successful_node(state, node_id)
            save(state, root=runs_root)

        state = mark_completed(state)
        save(state, root=runs_root)
        return state


def _is_implement_node(node) -> bool:
    """Return True iff this is an implement-type agent node.

    Matches ids: 'implement', 'backend-implement', 'frontend-implement'.
    Excludes reconcile/gate/pause/script nodes by checking the node_type.
    """
    nt = getattr(node, "node_type", None)
    if nt is None:
        return False
    if hasattr(nt, "value"):
        if nt.value != "agent":
            return False
    elif str(nt).lower() != "agent":
        return False
    nid = getattr(node, "id", "") or ""
    return nid == "implement" or nid.endswith("-implement")


def _per_node_reconcile(
    dispatcher: Any,
    node: Any,
    output: NodeOutput,
    run_id: str,
    telemetry: Telemetry,
) -> None:
    """Invoke reconcile inline after an implement node terminates.

    When commit_sha is present in the implement node's output (Multica
    execution path), this materialises the committed work into repo_root
    before any downstream node — especially the review agent — is
    dispatched. No-op when commit_sha is absent (local binding; work is
    already in the tree).

    Best-effort early materialisation only: a HandlerError here is recorded in
    telemetry but NOT re-raised. The authoritative, fail-loud, resume-safe
    barrier is the graph's NON-optional reconcile node (review/test depend on
    it) — raising from this inline call would happen outside the walker's
    node-failure recording, leaving resume to re-expose a stale tree (#5).
    """
    sha = (output.outputs or {}).get("commit_sha") or ""
    if not sha:
        return

    reconcile_node = Node(
        id=f"per-node-reconcile-{node.id}",
        agent="reconciler",
        node_type=NodeType.RECONCILE,
        depends_on=[],
    )
    reconcile_inputs: dict[str, Any] = {
        "sha": sha,
        "branch": (output.outputs or {}).get("branch") or "",
        "repo": (output.outputs or {}).get("repo") or "",
        "work_dir": (output.outputs or {}).get("work_dir") or "",
    }
    try:
        dispatcher.dispatch(reconcile_node, reconcile_inputs, run_id)
        telemetry.emit(
            "node_completed",
            reconcile_node.id,
            {"per_node_reconcile": True},
        )
    except HandlerError as exc:
        # Best-effort only — record but do NOT re-raise (raising here is outside
        # the walker's node-failure recording and would make resume re-expose a
        # stale tree, #5). The non-optional graph reconcile node is the
        # authoritative fail-loud barrier that downstream review/test depend on.
        telemetry.emit(
            "node_failed",
            reconcile_node.id,
            {"per_node_reconcile": True, "error": str(exc)},
        )


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


def _is_user_gate_node(node) -> bool:
    """Whether `node` is a user_gate node — by enum value or string.

    user_gate nodes are sequential barriers (same treatment as pause):
    they evaluate a predicate and may halt for human review, which is
    incompatible with parallel wave dispatch.
    """

    nt = getattr(node, "node_type", None)
    if nt is None:
        return False
    if hasattr(nt, "value"):
        return nt.value == "user_gate"
    return str(nt).lower() == "user_gate"


def _is_gate_node(node) -> bool:
    """Whether `node` is a gate node — by enum value or string."""

    nt = getattr(node, "node_type", None)
    if nt is None:
        return False
    if hasattr(nt, "value"):
        return nt.value == "gate"
    return str(nt).lower() == "gate"


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


def _record_skipped(
    state,
    node_id: str,
    skip_info: dict[str, Any] | None = None,
    *,
    source_epic: str | None = None,
):
    _emit_phase_blocked(node_id, skip_info or {}, source_epic)
    if state is None:
        return None
    from hive.lib.dag_executor.run_state import NodeStatus, set_node_status

    return set_node_status(state, node_id, NodeStatus.SKIPPED)


def _record_running(state, node_id: str, *, source_epic: str | None = None):
    _emit_phase_started(node_id, source_epic)
    if state is None:
        return None
    from hive.lib.dag_executor.run_state import NodeStatus, set_node_status

    return set_node_status(state, node_id, NodeStatus.RUNNING)


def _record_completion(
    state,
    node_id: str,
    output: NodeOutput,
    *,
    source_epic: str | None = None,
):
    _emit_phase_complete(node_id, source_epic)
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


def _record_failure(
    state,
    node_id: str,
    failure_info: dict[str, Any],
    *,
    source_epic: str | None = None,
):
    if state is None:
        _emit_phase_failed(node_id, failure_info, source_epic)
        return None
    from hive.lib.dag_executor.run_state import NodeStatus, mark_failed, set_node_status

    state = set_node_status(state, node_id, NodeStatus.FAILED)
    _emit_phase_failed(node_id, failure_info, source_epic)
    return mark_failed(state, failure_info)


def _source_epic(ctx: dict[str, Any]) -> str:
    for key in ("epic_id", "source_epic", "epic"):
        value = ctx.get(key)
        if isinstance(value, str) and value:
            return value
    return "unknown"


def _trigger_rule_skip_info(node: Node, node_statuses: dict[str, Any]) -> dict[str, Any]:
    return {
        "reason": "trigger_rule:none_failed_min_one_success",
        "upstream_statuses": {
            upstream_id: (
                status.value if hasattr(status, "value") else str(status)
            )
            for upstream_id in node.depends_on
            for status in [node_statuses.get(upstream_id)]
        },
    }


def _phase_blocked_slug(skip_info: dict[str, Any]) -> str:
    reason = str(skip_info.get("skip_reason") or skip_info.get("reason") or "").lower()
    statuses = skip_info.get("upstream_statuses")
    if isinstance(statuses, dict):
        values = {str(value).lower() for value in statuses.values()}
        if "failed" in values:
            return _PHASE_BLOCKED_UPSTREAM_FAILED
        if "skipped" in values:
            return _PHASE_BLOCKED_UPSTREAM_SKIPPED
    if "failed" in reason or "exception" in reason:
        return _PHASE_BLOCKED_UPSTREAM_FAILED
    if "skipped" in reason:
        return _PHASE_BLOCKED_UPSTREAM_SKIPPED
    return _PHASE_BLOCKED_TRIGGER_RULE_SKIP


def _emit_phase_blocked(
    node_id: str,
    skip_info: dict[str, Any],
    source_epic: str | None,
) -> None:
    import logging

    try:
        from hive.lib.kg_emit import emit_kg_event, sanitize_obj

        emit_kg_event(
            subject=node_id,
            predicate="phase_blocked",
            obj=sanitize_obj(_phase_blocked_slug(skip_info)),
            source_epic=source_epic or "unknown",
            source_agent="dag-executor",
        )
    except Exception:
        logging.getLogger(__name__).debug(
            "phase_blocked KG emit failed for node %s",
            node_id,
            exc_info=True,
        )


def _emit_phase_started(
    node_id: str,
    source_epic: str | None,
) -> None:
    import logging

    try:
        from hive.lib.kg_emit import emit_kg_event, sanitize_obj

        emit_kg_event(
            subject=node_id,
            predicate="phase_started",
            obj=sanitize_obj(_PHASE_STARTED_SLUG),
            source_epic=source_epic or "unknown",
            source_agent="dag-executor",
        )
    except Exception:
        logging.getLogger(__name__).debug(
            "phase_started KG emit failed for node %s",
            node_id,
            exc_info=True,
        )


def _emit_phase_complete(
    node_id: str,
    source_epic: str | None,
) -> None:
    import logging

    try:
        from hive.lib.kg_emit import emit_kg_event, sanitize_obj

        emit_kg_event(
            subject=node_id,
            predicate="phase_complete",
            obj=sanitize_obj(_PHASE_COMPLETE_SLUG),
            source_epic=source_epic or "unknown",
            source_agent="dag-executor",
        )
    except Exception:
        logging.getLogger(__name__).debug(
            "phase_complete KG emit failed for node %s",
            node_id,
            exc_info=True,
        )


def _emit_phase_failed(
    node_id: str,
    failure_info: dict[str, Any],
    source_epic: str | None,
) -> None:
    import logging

    try:
        from hive.lib.kg_emit import emit_kg_event, sanitize_obj

        emit_kg_event(
            subject=node_id,
            predicate="phase_failed",
            obj=sanitize_obj(failure_info.get("message", "")),
            source_epic=source_epic or "unknown",
            source_agent="dag-executor",
        )
    except Exception:
        logging.getLogger(__name__).debug(
            "phase_failed KG emit failed for node %s",
            node_id,
            exc_info=True,
        )


def _record_final_completion(state):
    if state is None:
        return None
    from hive.lib.dag_executor.run_state import RunStatus, mark_completed

    if state.status != RunStatus.RUNNING:
        return state
    return mark_completed(state)
