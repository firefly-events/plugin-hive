"""RLM-style recursive node spike (a-rlm-recursive-node) — EXPERIMENTAL, flag-gated.

This module is the structural harness for the RLM (recursive-language-model-style)
node wrapper. It is activated ONLY when a node opts in via ``node.config.rlm``;
``AgentHandler`` uses the wrapper in place of the raw spawn for that one node.
When the flag is absent/false the wrapper is never constructed and the handler's
code path is byte-identical to pre-A.

Two guarantees this module is responsible for:

  * **Constrained context navigation (AC1/AC3).** ``ConstrainedContextTools``
    exposes EXACTLY four read-only operations over an in-memory context STRING —
    ``search`` / ``slice`` / ``chunk`` / ``grep`` — and NOTHING else. There is no
    passthrough to a shell, subprocess, ``eval``, ``exec``, ``compile`` or
    ``__import__``. This module deliberately imports none of those; the toolset
    navigates a string with pure in-process ``str``/``re`` operations, so raw
    exec is STRUCTURALLY unreachable rather than merely undocumented.

  * **Recursive sub-calls reuse the existing binding seam (AC4).** A depth=1
    recursive sub-call is routed through ``run.get_binding_factory`` — the SAME
    registry ``register_binding`` populates. No new dispatch primitive.

The RLM success metric (AC7) recorded on every flag-ON run is
``rlm_context_reduction_ratio`` = ``1 - navigated_bytes / total_context_bytes``.
Rationale: the RLM value claim is that NAVIGATING context (retrieving only the
relevant slices) beats dumping the whole context at the model. A positive ratio
means the wrapper touched only a fraction of the context — the measurable signal
the spike graduates on. Depth, sub-call count, and the raw byte counts are
recorded alongside it. This is a MEASURED spike, not a commitment: the wrapper
measures navigation but leaves the node's authoritative outputs to the real
spawn (flag-ON node output == flag-OFF for the same spawn).
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Callable

# The constrained toolset — the ONLY context-navigation operations the RLM
# wrapper exposes. Raw exec is intentionally NOT in this set.
RLM_TOOL_NAMES = ("search", "slice", "chunk", "grep")


class ConstrainedContextTools:
    """The RLM constrained context-navigation toolset (AC1, AC3), DATA-DRIVEN.

    SECURITY (codex finding 1): this object is TRUSTED and is held ONLY by the
    wrapper — it is never handed to the (future untrusted) recursive caller. Tool
    invocation is DATA-DRIVEN: a caller emits a tool NAME string (validated
    against the exact allowlist ``ALLOWED_TOOLS``) plus keyword args, and the
    trusted ``dispatch`` executes it and returns ONLY the result value (a
    ``str``/``list``/``int`` — never a callable, object, or anything with a
    reachable ``__globals__``/``__class__`` path to builtins).

    Why not expose ``search``/``slice``/``chunk``/``grep`` as bound methods: a
    bound method leaks ``method.__globals__["__builtins__"]["__import__"]`` — a
    live escape to ``os``/``subprocess`` for anyone who holds it. So the four
    operations are PRIVATE implementations (``_search`` …), reachable only by
    validated NAME through ``dispatch``; there is no public tool callable to
    traverse. ``__slots__`` additionally pins the instance surface. Every
    implementation is a pure ``str``/``re`` operation — no shell, no subprocess,
    no ``eval``/``exec``.
    """

    #: The exact allowlist. A dispatch request naming anything outside this set
    #: (dunders, underscored impls, ``os``, ``system`` …) is rejected.
    ALLOWED_TOOLS = frozenset(RLM_TOOL_NAMES)

    __slots__ = ("_context",)

    def __init__(self, context: str) -> None:
        self._context = context if isinstance(context, str) else str(context)

    @classmethod
    def available_tools(cls) -> tuple[str, ...]:
        """The tool MENU as pure-data strings — safe to hand to an untrusted
        caller (a tuple of ``str`` has no ``__globals__`` to traverse)."""
        return RLM_TOOL_NAMES

    def dispatch(self, tool: str, /, **kwargs: Any) -> Any:
        """Trusted, data-driven tool dispatch.

        ``tool`` is a NAME string validated against ``ALLOWED_TOOLS``; ``kwargs``
        are plain data. Returns only the result VALUE. Rejects any name not in
        the allowlist — including underscored implementations (``_search``) and
        dunder/attribute-escape probes — with ``ValueError``.
        """
        if not isinstance(tool, str) or tool not in self.ALLOWED_TOOLS:
            raise ValueError(f"unknown or disallowed rlm tool: {tool!r}")
        impl = {
            "search": self._search,
            "slice": self._slice,
            "chunk": self._chunk,
            "grep": self._grep,
        }[tool]
        return impl(**kwargs)

    # ------------------------------------------------------------------
    # Private tool implementations — pure str/re, reachable only via dispatch.
    # ------------------------------------------------------------------

    def _search(self, query: str, max_hits: int = 20) -> list[int]:
        """Character offsets of each literal occurrence of ``query`` (capped)."""
        if not isinstance(query, str) or not query:
            return []
        hits: list[int] = []
        start = 0
        while len(hits) < max_hits:
            idx = self._context.find(query, start)
            if idx == -1:
                break
            hits.append(idx)
            start = idx + 1
        return hits

    def _slice(self, start: int, end: int) -> str:
        """Substring ``[start:end]`` of the context, bounds-clamped."""
        n = len(self._context)
        s = max(0, min(int(start), n))
        e = max(0, min(int(end), n))
        if e < s:
            s, e = e, s
        return self._context[s:e]

    def _chunk(self, size: int) -> list[str]:
        """Split the context into fixed-size chunks (the last may be shorter)."""
        size = int(size)
        if size <= 0:
            raise ValueError("chunk size must be a positive integer")
        return [
            self._context[i : i + size]
            for i in range(0, len(self._context), size)
        ]

    def _grep(self, pattern: str, flags: int = 0) -> list[str]:
        """Context lines matching the regex ``pattern`` (``re``, never shell grep).

        An invalid pattern yields ``[]`` rather than raising — navigation is
        best-effort and must never become an execution surface.
        """
        try:
            rx = re.compile(pattern, flags)
        except re.error:
            return []
        return [line for line in self._context.splitlines() if rx.search(line)]

    @property
    def context_length(self) -> int:
        return len(self._context)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _default_metric_writer(metric: dict[str, Any], run_id: str) -> None:
    """Persist one RLM metric as a JSONL line under the metrics root.

    Reuses the audited ``hive.lib.metrics.paths.resolve_metrics_path`` write
    boundary (same ``events/`` convention as the executor telemetry shim) — a
    plain file append, NOT a shell or subprocess. The import is local so this
    module carries no hard metrics dependency at import time.
    """
    from hive.lib.metrics.paths import resolve_metrics_path

    path = resolve_metrics_path("events", f"rlm-{run_id}.jsonl", for_write=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(metric, sort_keys=True))
        handle.write("\n")


def _assemble_context(step_file_content: str, inputs: dict[str, Any]) -> str:
    """Fold the node's brief + resolved inputs into ONE context string that the
    constrained toolset navigates (context-as-variable)."""
    parts: list[str] = []
    if step_file_content:
        parts.append(step_file_content)
    if inputs:
        try:
            parts.append(json.dumps(inputs, sort_keys=True, default=str))
        except (TypeError, ValueError):
            parts.append(str(inputs))
    return "\n".join(parts)


class RLMRecursiveWrapper:
    """Depth-1 RLM recursive harness around a real ``AgentSpawn`` callable.

    Satisfies the ``AgentSpawn`` call shape so ``AgentHandler`` can drop it in
    where the raw spawn would go. On each call it:

      1. Assembles the node context as a single string (context-as-variable).
      2. Navigates it with the constrained toolset (search/slice/chunk/grep) —
         NEVER raw exec.
      3. Fires at most ONE recursive sub-call (depth=1), routed through the
         ``register_binding`` registry via ``run.get_binding_factory``. When no
         binding is registered under the configured name the sub-call simply
         does not fire (depth 0) — the wrapper is still active and the metric is
         still recorded.
      4. Records the ``rlm_context_reduction_ratio`` metric.
      5. Delegates to the real (inner) spawn for the node's AUTHORITATIVE
         outputs, so a flag-ON node produces the same output shape a flag-OFF
         node would for the same spawn.
    """

    TOOL_NAMES = RLM_TOOL_NAMES

    def __init__(
        self,
        inner_spawn: Callable[..., dict[str, Any]],
        node: Any,
        *,
        binding_resolver: Callable[[str], Any] | None = None,
        metric_writer: Callable[[dict[str, Any], str], None] | None = None,
    ) -> None:
        self._inner = inner_spawn
        self._node = node
        self._binding_resolver = binding_resolver
        self._metric_writer = metric_writer or _default_metric_writer
        # Inspection handles for tests / callers (last invocation).
        self.tools: ConstrainedContextTools | None = None
        self.last_metric: dict[str, Any] | None = None
        self.sub_calls: list[dict[str, Any]] = []

    def _rlm_config(self) -> dict[str, Any]:
        cfg = getattr(self._node, "config", None) or {}
        rlm = cfg.get("rlm") if isinstance(cfg, dict) else None
        return rlm if isinstance(rlm, dict) else {}

    def __call__(
        self,
        agent: str,
        step_file_content: str,
        inputs: dict[str, Any],
        run_id: str,
        step_id: str,
        timeout_ms: int | None = None,
    ) -> dict[str, Any]:
        # Not consumed here — accepted only for Protocol parity with
        # LocalAgentSpawn/StubAgentSpawn/MulticaAgentSpawn. The recursive
        # sub-call below goes through its own registered binding, which has
        # its own timeout semantics.
        context = _assemble_context(step_file_content, inputs)
        tools = ConstrainedContextTools(context)
        self.tools = tools

        navigated = self._navigate(tools)
        depth, sub_call_count = self._recurse(
            agent, navigated, inputs, run_id, step_id
        )

        total = tools.context_length
        navigated_bytes = len(navigated)
        ratio = 0.0 if total == 0 else max(0.0, 1.0 - navigated_bytes / total)
        metric: dict[str, Any] = {
            "metric": "rlm_context_reduction_ratio",
            "value": round(ratio, 6),
            "run_id": run_id,
            "step_id": step_id,
            "node_id": getattr(self._node, "id", None),
            "agent": agent,
            "context_bytes_total": total,
            "context_bytes_navigated": navigated_bytes,
            "sub_call_count": sub_call_count,
            "recursion_depth": depth,
            "toolset": list(self.TOOL_NAMES),
            "timestamp": _now_iso(),
        }
        self.last_metric = metric
        try:
            self._metric_writer(metric, run_id)
        except Exception:  # noqa: BLE001 — measurement must never break the node
            pass

        # Authoritative node outputs still come from the real spawn. The RLM
        # harness MEASURES navigation without altering what the node produces.
        return self._inner(
            agent=agent,
            step_file_content=step_file_content,
            inputs=inputs,
            run_id=run_id,
            step_id=step_id,
        )

    # ------------------------------------------------------------------
    # Constrained navigation
    # ------------------------------------------------------------------

    def _navigate(self, tools: ConstrainedContextTools) -> str:
        """Retrieve the relevant slices of context using ONLY the constrained
        toolset. Config-driven ``queries`` target specific terms; otherwise a
        default heuristic greps for markdown headings and takes the leading
        chunk. Returns the concatenated navigated fragments (the bytes actually
        touched — the numerator of the reduction metric)."""
        cfg = self._rlm_config()
        parts: list[str] = []
        queries = cfg.get("queries")
        window = int(cfg.get("window", 200))
        max_hits = int(cfg.get("max_hits", 5))
        # All navigation goes through the data-driven ``dispatch`` seam (tool
        # NAME + kwargs) — the same validated path an untrusted recursive caller
        # would use — never a live tool callable.
        if isinstance(queries, list) and queries:
            for q in queries:
                if not isinstance(q, str) or not q:
                    continue
                for off in tools.dispatch("search", query=q, max_hits=max_hits):
                    parts.append(tools.dispatch("slice", start=off, end=off + window))
        else:
            parts.extend(tools.dispatch("grep", pattern=r"^#{1,6}\s"))
            chunks = tools.dispatch("chunk", size=int(cfg.get("chunk_size", 400)))
            if chunks:
                parts.append(chunks[0])
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Depth-1 recursive sub-call via the register_binding seam
    # ------------------------------------------------------------------

    def _resolve_factory(self, binding_name: str) -> Any:
        resolver = self._binding_resolver
        if resolver is None:
            try:
                from hive.lib.dag_executor.run import get_binding_factory

                resolver = get_binding_factory
            except Exception:  # noqa: BLE001 — no registry available
                return None
        try:
            return resolver(binding_name)
        except Exception:  # noqa: BLE001
            return None

    def _recurse(
        self,
        agent: str,
        navigated: str,
        inputs: dict[str, Any],
        run_id: str,
        step_id: str,
    ) -> tuple[int, int]:
        """Fire at most one depth=1 recursive sub-call through register_binding.

        Returns ``(recursion_depth, sub_call_count)``. When no binding is
        registered under the configured name, returns ``(0, 0)`` — the wrapper
        is still active, it just has no remote seam to recurse through.
        """
        cfg = self._rlm_config()
        binding_name = str(cfg.get("binding", "local")).strip().lower() or "local"
        factory = self._resolve_factory(binding_name)
        if factory is None:
            return 0, 0

        # The registry stores factories; call it to obtain the sub-call spawn.
        # A factory that itself IS the spawn callable (or needs args) is handled
        # by falling back to using it directly.
        sub_spawn: Any
        try:
            sub_spawn = factory()
        except TypeError:
            sub_spawn = factory
        except Exception:  # noqa: BLE001
            return 0, 0
        if not callable(sub_spawn):
            return 0, 0

        sub_step_id = f"{step_id}:rlm-subcall"
        try:
            sub_spawn(
                agent=agent,
                step_file_content=navigated,
                inputs=dict(inputs),
                run_id=run_id,
                step_id=sub_step_id,
            )
        except Exception:  # noqa: BLE001 — a flaky sub-call must not fail the node
            return 0, 0
        self.sub_calls.append({"binding": binding_name, "step_id": sub_step_id})
        return 1, 1


# The opt-in gate lives in ``agent.py`` so the flag-OFF path can decide WITHOUT
# importing this module (codex finding 2 — a non-rlm node must not depend on
# rlm.py import success). Re-exported here as ``rlm_enabled`` for callers/tests
# that already have the wrapper module loaded. Importing agent here is safe: the
# handler imports rlm only lazily inside its opt-in branch, so there is no cycle.
from .agent import _rlm_opt_in as rlm_enabled  # noqa: E402
