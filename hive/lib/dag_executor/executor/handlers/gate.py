"""Gate handler — declarative presence/non-empty checks + strict predicate grammar.

Initial implementation handles the `must not be empty` predicate
shipping today (e.g., `development.classic.workflow.yaml:166` —
`test_artifacts must not be empty`). Richer predicate languages land
in hde-3a; this handler intentionally stays narrow.

s3-convergence-signal: also handles grammar-legal dotpath predicates of the
form ``$<node>.output.<field> == true|false``. When the walker injects the
full ``__output_graph`` view into the gate's inputs (same mechanism as
user_gate), the handler evaluates these strict predicates directly against
the materialised output graph — no prose parsing needed.

The gate's predicate string lives on `node.gate`. Inputs to the gate
are the resolved input values from the materialised output graph.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ..errors import GateFailedError
from .agent import NodeOutput

# Key used to pass the materialised output-graph view into gate inputs.
# Injected by the walker (same mechanism as user_gate's __output_graph).
_GATE_OUTPUT_GRAPH_INPUT = "__output_graph"


_NOT_EMPTY = re.compile(r"^(?P<name>[\w.-]+)\s+must\s+not\s+be\s+empty$", re.IGNORECASE)
# C3: schema-validation predicate — "epic_dir must be valid plan-epic"
_MUST_BE_VALID = re.compile(
    r"^(?P<name>[\w.-]+)\s+must\s+be\s+valid\s+(?P<target>[\w-]+)$", re.IGNORECASE
)
# #16: verdict/value gate — "review_verdict must equal passed". Fails loud when
# the value differs, so a divergent review blocks downstream integration.
_MUST_EQUAL = re.compile(
    r"^(?P<name>[\w.-]+)\s+must\s+equal\s+(?P<expected>[\w.-]+)$", re.IGNORECASE
)
# Legacy negated form retained for non-review gates. Live review integration
# gates use the explicit-passed form below rather than a partial exclusion.
_MUST_NOT_EQUAL = re.compile(
    r"^(?P<name>[\w.-]+)\s+must\s+not\s+equal\s+(?P<expected>[\w.-]+)$",
    re.IGNORECASE,
)

_REVIEW_VERDICTS = {"passed", "needs_revision", "needs_optimization"}
_MISSING = object()


def _validate_review_signal(node: Any, inputs: dict[str, Any]) -> None:
    """Validate the review verdict/signal contract before evaluating a gate.

    ``review_passed`` is intentionally a boolean convergence signal rather
    than a second approval decision.  Only the exact ``passed`` verdict may
    produce ``True``; all other known verdicts must produce ``False``.  This
    check also rejects missing, malformed, or inconsistent agent output before
    a grammar predicate could accidentally accept it.
    """

    verdict = inputs.get("review_verdict", _MISSING)
    signal = inputs.get("review_passed", _MISSING)
    if not isinstance(verdict, str) or verdict not in _REVIEW_VERDICTS:
        raise GateFailedError(
            f"gate node {node.id!r}: review_verdict must be one of "
            f"{sorted(_REVIEW_VERDICTS)!r}; got {verdict!r}"
        )
    if type(signal) is not bool:
        raise GateFailedError(
            f"gate node {node.id!r}: review_passed must be a boolean; "
            f"got {signal!r}"
        )
    expected = verdict == "passed"
    if signal != expected:
        raise GateFailedError(
            f"gate node {node.id!r}: review_passed={signal!r} is inconsistent "
            f"with review_verdict={verdict!r}"
        )


def _is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, (str, list, tuple, dict, set)):
        return len(value) == 0
    return False


class GateHandler:
    """Evaluates simple presence-style gate predicates."""

    def __init__(self, repo_root: Path | str | None = None) -> None:
        # Schema-validation predicates (e.g. "epic_dir must be valid plan-epic")
        # check a path the agent committed into repo_root and reconcile merged
        # there. The executor's cwd is the plugin/driver dir, NOT the consumer
        # project, so a repo-relative epic_dir must be anchored to repo_root.
        # None keeps legacy cwd-relative behavior for local/test callers.
        self._repo_root = Path(repo_root) if repo_root is not None else None

    def handle(
        self,
        node: Any,
        inputs: dict[str, Any],
        run_id: str,
    ) -> NodeOutput:
        predicate = (node.gate or "").strip()
        if not predicate:
            raise GateFailedError(
                f"gate node {node.id!r} has no gate predicate"
            )

        # Presence check: "{name} must not be empty"
        match = _NOT_EMPTY.match(predicate)
        if match:
            name = match.group("name")
            value = inputs.get(name)
            if _is_empty(value):
                raise GateFailedError(
                    f"gate node {node.id!r}: {name!r} is empty (predicate {predicate!r})"
                )
            return NodeOutput(outputs={"gate_passed": True}, meta={"predicate": predicate})

        # Verdict/value check: "{name} must equal {expected}" (#16). Blocks the
        # run (fail loud) when the value differs — e.g. a needs_revision review
        # must not silently integrate.
        match = _MUST_EQUAL.match(predicate)
        if match:
            name = match.group("name")
            expected = match.group("expected")
            value = inputs.get(name)
            if str(value).strip().lower() != expected.strip().lower():
                raise GateFailedError(
                    f"gate node {node.id!r}: {name!r} is {value!r}, expected "
                    f"{expected!r} (predicate {predicate!r})"
                )
            return NodeOutput(outputs={"gate_passed": True}, meta={"predicate": predicate})

        # Negated verdict check: "{name} must not equal {expected}" (#16). Blocks
        # only the named bad value; every other value passes.
        match = _MUST_NOT_EQUAL.match(predicate)
        if match:
            name = match.group("name")
            expected = match.group("expected")
            value = inputs.get(name)
            # A "must not equal" gate exists to BLOCK a bad value (e.g. a
            # needs_revision review must not integrate). A missing/empty value is
            # NOT a safe pass: it means the upstream node produced no verdict at
            # all (crash, empty harvest, unbound edge) — fail loud rather than
            # silently ship, mirroring the #26 silent-skip lesson. Without this,
            # `inputs.get(name)` -> None -> "none" != expected -> the gate passes
            # and integrate runs on no evidence.
            if _is_empty(value) or not str(value).strip():
                raise GateFailedError(
                    f"gate node {node.id!r}: {name!r} produced no value — a "
                    f"{predicate!r} gate cannot pass without a verdict"
                )
            if str(value).strip().lower() == expected.strip().lower():
                raise GateFailedError(
                    f"gate node {node.id!r}: {name!r} is {value!r} — must not equal "
                    f"{expected!r} (predicate {predicate!r})"
                )
            return NodeOutput(outputs={"gate_passed": True}, meta={"predicate": predicate})

        # Schema-validation check: "{name} must be valid {target}" (C3)
        match = _MUST_BE_VALID.match(predicate)
        if match:
            name = match.group("name")
            target = match.group("target").lower()
            value = inputs.get(name)
            if _is_empty(value):
                raise GateFailedError(
                    f"gate node {node.id!r}: {name!r} is empty — nothing to validate"
                )
            from hive.lib.dag_executor.validate_output import validate, OutputValidationError

            kwargs: dict[str, Any] = {}
            # Map known schema targets to their required kwargs
            if target == "plan-epic":
                # Anchor a repo-relative epic_dir to repo_root (the tree the
                # agent committed into and reconcile materialised). Without this
                # the gate resolves against the driver cwd and fails with
                # "epic.yaml not found ... (nothing committed?)" even though the
                # epic IS present in repo_root.
                epic_dir_value = value
                if self._repo_root is not None:
                    root = self._repo_root.resolve()
                    candidate = Path(str(value))
                    if not candidate.is_absolute():
                        candidate = root / candidate
                    resolved = candidate.resolve()
                    # Reject an agent-emitted epic_dir that escapes repo_root
                    # (e.g. ``../outside``) before it reaches schema validation.
                    try:
                        resolved.relative_to(root)
                    except ValueError as exc:
                        raise GateFailedError(
                            f"gate node {node.id!r}: refusing unsafe {name!r} "
                            f"{value!r} — must resolve inside repo_root"
                        ) from exc
                    epic_dir_value = str(resolved)
                kwargs["epic_dir"] = epic_dir_value
            else:
                # Generic fallback: pass value as positional first kwarg by name
                kwargs[name] = value

            try:
                errors = validate(target, **kwargs)
            except OutputValidationError as exc:
                raise GateFailedError(
                    f"gate node {node.id!r}: schema validation error for target "
                    f"{target!r}: {exc}"
                ) from exc

            if errors:
                joined = "; ".join(errors)
                raise GateFailedError(
                    f"gate node {node.id!r}: {name!r} failed schema validation "
                    f"(target={target!r}): {joined}"
                )
            return NodeOutput(
                outputs={"gate_passed": True},
                meta={"predicate": predicate, "target": target},
            )

        # s3-convergence-signal: try strict predicate grammar (dotpath == bool/value).
        # The walker injects ``__output_graph`` into gate inputs so we can evaluate
        # grammar-legal predicates like ``$review__r3.output.review_passed == true``
        # against the full materialised output. Fail-closed-to-block: if the output
        # graph is absent, the predicate fails (gate blocks) rather than silently
        # passing, preserving bug-#26 safety semantics.
        output_graph = inputs.get(_GATE_OUTPUT_GRAPH_INPUT)
        if output_graph is not None:
            try:
                from hive.lib.dag_executor.routing import evaluate as eval_predicate
                from hive.lib.dag_executor.routing import parse as parse_predicate
                from hive.lib.dag_executor.routing.errors import Skipped

                if node.id == "gate-review" and "review_passed" in predicate:
                    _validate_review_signal(node, inputs)
                ast = parse_predicate(predicate)
                if not isinstance(ast, Skipped):
                    result = eval_predicate(ast, output_graph)
                    if not result:
                        raise GateFailedError(
                            f"gate node {node.id!r}: predicate {predicate!r} evaluated False "
                            f"(convergence signal not true — integrate blocked, bug-#26 preserved)"
                        )
                    return NodeOutput(
                        outputs={"gate_passed": True},
                        meta={"predicate": predicate, "grammar": "dotpath"},
                    )
            except GateFailedError:
                raise
            except Exception:
                pass  # fall through to the final unknown-predicate error

        raise GateFailedError(
            f"gate node {node.id!r} predicate not understood by hde-2 gate handler "
            f"(richer predicates land in hde-3a): {predicate!r}"
        )
