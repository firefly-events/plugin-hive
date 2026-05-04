"""Parallel fan-out scheduler — wave-based dispatch with barrier joins (hde-4).

Design locks (do NOT relax at the story level):

  * ``concurrent.futures.ThreadPoolExecutor`` is the only concurrency
    primitive. Handlers are I/O-bound (subprocess.spawn, file reads,
    network calls); the GIL is not the bottleneck and an async refactor
    is out-of-scope. Threads keep the dispatch surface synchronous.
  * Sibling failure does NOT cancel siblings. A handler exception on
    branch A becomes ``NodeStatus.SKIPPED`` for that node only; branches
    B and C run to completion. The downstream barrier-join consults
    ``none_failed_min_one_success`` against the materialised upstream
    statuses to decide RUN vs SKIP.
  * Wave size 1 → caller stays on the sequential path (no executor,
    no thread spawn). Wave size > 1 → ``ParallelScheduler`` is used.
    This preserves spine-parity for fully-linear workflows (e.g.
    code-review.workflow.yaml): the scheduler is never instantiated.
  * Per-step ``timeout_ms`` is honored via ``Future.result(timeout=...)``.
    A timeout maps to SKIP for the timing-out node, same semantics as
    a handler exception under this rule.
  * Insight slug disambiguation: ``<slug>-<run_id_short>`` where
    ``run_id_short`` is the first 8 chars of the run_id (which is the
    leading 8 chars of the ULID portion under the ``make_run_id``
    contract). Risk #9 guard against parallel branches racing the
    same ``.pHive/insights/{epic_id}/{story_id}/<slug>.md`` path.

The scheduler owns NO walker state. It returns a
``dict[node_id, ScheduleResult]`` and lets the walker apply the
results to ``materialised`` / ``node_statuses`` / ``run_state``
serially in the main thread. This keeps the walker's mutation
surface single-threaded and reuses the existing serial telemetry +
state-persistence paths verbatim.
"""

from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Mapping

from .trigger_rule import ActivationDecision, none_failed_min_one_success


# A dispatcher callable shaped exactly like ``Dispatcher.dispatch``.
# The scheduler does not import the executor's Dispatcher class to keep
# routing → executor edges a one-way dependency (executor imports
# routing, not vice versa).
DispatchCallable = Callable[[Any, dict[str, Any], str], Any]


@dataclass
class ScheduleResult:
    """Outcome of dispatching a single node within a parallel wave.

    Exactly one of (``output``, ``error``) is non-None. ``elapsed_ms``
    is wall-clock for the dispatch (used by the parity-timing test to
    assert wall ≈ max(branch_time), not sum).
    """

    node_id: str
    status: str  # "completed" | "skipped" | "failed"
    output: Any | None = None
    error: BaseException | None = None
    elapsed_ms: float = 0.0
    timed_out: bool = False
    skip_reason: str | None = None


@dataclass
class WaveTelemetry:
    """Buffered per-node telemetry rows captured during a parallel wave.

    Threads cannot safely call ``Telemetry.emit`` because event order
    inside Telemetry.events would be non-deterministic across runs and
    parity tests rely on ordering within a wave being a multiset, not
    a sequence. Each thread appends to its own row in this struct, and
    the walker drains them in deterministic node-id order on the main
    thread after the wave joins.
    """

    rows: list[dict[str, Any]] = field(default_factory=list)


def disambiguate_insight_slug(
    epic_id: str,
    story_id: str,
    slug: str,
    run_id: str,
) -> str:
    """Append ``-<run_id_short>`` to ``slug`` to disambiguate ACROSS RUNS.

    Risk #9 partial guard: when a workflow runs twice (e.g., a retry
    after a flaky failure), siblings in the second run would collide
    with siblings from the first run on the SAME insight slug. The
    first-8-chars-of-run_id suffix is unique per run (ULIDs are
    monotonic + millisecond-tagged), so this disambiguates across
    runs.

    LIMITATION (call out for the consumer): two sibling branches
    WITHIN THE SAME WAVE share the same run_id, so they share the
    same disambiguated slug. This API alone does NOT prevent within-
    wave path collisions. Callers that write
    ``.pHive/insights/{epic}/{story}/<slug>.md`` in parallel must
    either include the node_id in the file path themselves or funnel
    writes through a single serialised step. Per the hde-4 strict
    lock the suffix is run_id_short ONLY; expanding it (e.g., to
    ``<slug>-<run_id_short>-<node_id>``) is an epic-level grammar
    change, not a story-level patch.

    ``epic_id`` and ``story_id`` are accepted but not used in the
    return value — they're part of the signature so callers funnel
    every insight write through this single API and it can grow into
    a path-builder later without breaking the call sites.
    """

    if not isinstance(slug, str) or not slug:
        raise ValueError("slug must be a non-empty string")
    if not isinstance(run_id, str) or not run_id:
        raise ValueError("run_id must be a non-empty string")
    # First 8 chars of run_id == first 8 chars of the leading ULID
    # under make_run_id's `{ULID}-{workflow_slug}` contract.
    run_id_short = run_id[:8]
    return f"{slug}-{run_id_short}"


def decide_join_activation(
    upstream_statuses: Iterable[Any],
) -> ActivationDecision:
    """Delegate barrier-join activation to ``none_failed_min_one_success``.

    Thin wrapper kept so the walker's barrier-join site reads as
    ``decide_join_activation(...)`` rather than threading the
    trigger_rule import through the parallel scheduler module. The
    semantics are exactly those of ``none_failed_min_one_success``:
    RUN iff ≥1 upstream is COMPLETED, else SKIP.
    """

    return none_failed_min_one_success(list(upstream_statuses))


class ParallelScheduler:
    """Fan-out a wave of independent nodes through a thread pool.

    Usage from the walker::

        wave_ids = walker._ready_wave(graph, processed, node_statuses)
        if len(wave_ids) <= 1:
            # sequential — call dispatcher.dispatch directly
            ...
        else:
            scheduler = ParallelScheduler()
            results = scheduler.schedule_ready_nodes(
                graph=graph,
                ready_node_ids=wave_ids,
                dispatcher=dispatcher.dispatch,
                run_id=run_id,
                resolve_inputs=resolve_inputs_fn,
            )
            for node_id in sorted(results):
                walker._apply_result(results[node_id])

    The scheduler owns no walker state. It dispatches in threads,
    collects ``(node_id, ScheduleResult)``, and returns. The walker
    applies state mutations on the main thread in deterministic
    node-id order so ``materialised``, ``node_statuses``, and
    ``run_state`` are never touched concurrently.
    """

    def __init__(self, max_workers: int | None = None) -> None:
        # max_workers=None lets ThreadPoolExecutor pick a sensible default
        # based on os.cpu_count(). Explicit override is exposed only so
        # tests can pin it to wave_size for deterministic assertions.
        self._max_workers = max_workers

    def schedule_ready_nodes(
        self,
        graph: Any,
        ready_node_ids: list[str],
        dispatcher: DispatchCallable,
        run_id: str,
        resolve_inputs: Callable[[Any], dict[str, Any]],
    ) -> dict[str, ScheduleResult]:
        """Dispatch ``ready_node_ids`` in parallel; collect results.

        ``resolve_inputs`` is the walker-supplied callable that turns a
        Node into its materialised input dict. Resolution happens INSIDE
        each thread so the walker's ``_resolve_inputs`` runs against
        ``materialised`` only at the moment of dispatch (not earlier);
        in this scheduler's wave model all upstreams are already in a
        terminal state by definition, so ``materialised`` is read-only
        from the threads' perspective and the dict reads are GIL-safe.
        """

        if not ready_node_ids:
            return {}

        # Single-node "waves" still flow through this method when the
        # caller chose to. We honour the spine-parity lock by NOT
        # spinning up a ThreadPoolExecutor for size-1 waves: a direct
        # call keeps the call stack and exception flow identical to the
        # sequential path.
        if len(ready_node_ids) == 1:
            node_id = ready_node_ids[0]
            node = graph.nodes[node_id]
            inputs = resolve_inputs(node)
            return {node_id: _run_one(node, inputs, dispatcher, run_id)}

        max_workers = self._max_workers or len(ready_node_ids)
        results: dict[str, ScheduleResult] = {}
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures: dict[Future, str] = {}
            for node_id in ready_node_ids:
                node = graph.nodes[node_id]
                fut = pool.submit(
                    _run_one_with_resolve,
                    node,
                    dispatcher,
                    run_id,
                    resolve_inputs,
                )
                futures[fut] = node_id

            # Per-step timeout_ms is enforced per-future via .result().
            # We collect ALL futures (no early-cancel on sibling
            # failure) — the spec requires that one branch's failure
            # does not affect siblings.
            for fut, node_id in futures.items():
                node = graph.nodes[node_id]
                timeout_s = (
                    node.timeout_ms / 1000.0
                    if getattr(node, "timeout_ms", None)
                    else None
                )
                try:
                    results[node_id] = fut.result(timeout=timeout_s)
                except Exception as exc:  # includes futures.TimeoutError
                    # Timeout or any unexpected failure during
                    # .result() — convert to SKIPPED for this branch
                    # so siblings keep their results and the join sees
                    # a deterministic upstream status.
                    timed_out = type(exc).__name__ == "TimeoutError"
                    results[node_id] = ScheduleResult(
                        node_id=node_id,
                        status="skipped",
                        error=exc,
                        timed_out=timed_out,
                        skip_reason=(
                            "timeout" if timed_out else "branch_exception"
                        ),
                    )

        return results


def _run_one_with_resolve(
    node: Any,
    dispatcher: DispatchCallable,
    run_id: str,
    resolve_inputs: Callable[[Any], dict[str, Any]],
) -> ScheduleResult:
    """Resolve inputs inside the worker so a failed resolution on one
    branch is captured as a per-node skip without aborting siblings.
    """

    try:
        inputs = resolve_inputs(node)
    except BaseException as exc:  # noqa: BLE001 — siblings must survive
        return ScheduleResult(
            node_id=node.id,
            status="skipped",
            error=exc,
            skip_reason="input_resolution_error",
        )
    return _run_one(node, inputs, dispatcher, run_id)


def _run_one(
    node: Any,
    inputs: dict[str, Any],
    dispatcher: DispatchCallable,
    run_id: str,
) -> ScheduleResult:
    """Dispatch one node inside a worker thread.

    Catches every exception so a failure on one branch never propagates
    to sibling futures. The walker applies the resulting status (and
    its trigger_rule consultation at the join) on the main thread.
    """

    import time

    start = time.monotonic()
    try:
        output = dispatcher(node, dict(inputs), run_id)
    except BaseException as exc:  # noqa: BLE001 — siblings must survive
        elapsed_ms = (time.monotonic() - start) * 1000.0
        return ScheduleResult(
            node_id=node.id,
            status="skipped" if not _is_optional(node) else "skipped",
            error=exc,
            elapsed_ms=elapsed_ms,
            skip_reason="branch_exception",
        )

    elapsed_ms = (time.monotonic() - start) * 1000.0
    return ScheduleResult(
        node_id=node.id,
        status="completed",
        output=output,
        elapsed_ms=elapsed_ms,
    )


def _is_optional(node: Any) -> bool:
    return bool(getattr(node, "optional", False))


__all__ = [
    "DispatchCallable",
    "ParallelScheduler",
    "ScheduleResult",
    "WaveTelemetry",
    "decide_join_activation",
    "disambiguate_insight_slug",
]
