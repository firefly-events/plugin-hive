"""Gate handler — declarative presence/non-empty checks.

Initial implementation handles the `must not be empty` predicate
shipping today (e.g., `development.classic.workflow.yaml:166` —
`test_artifacts must not be empty`). Richer predicate languages land
in hde-3a; this handler intentionally stays narrow.

The gate's predicate string lives on `node.gate`. Inputs to the gate
are the resolved input values from the materialised output graph.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ..errors import GateFailedError
from .agent import NodeOutput


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
# #16: negated form — "review_verdict must not equal needs_revision". Blocks only
# the named bad value (a needs_revision review must not silently integrate) while
# letting every other verdict (passed, needs_optimization) proceed.
_MUST_NOT_EQUAL = re.compile(
    r"^(?P<name>[\w.-]+)\s+must\s+not\s+equal\s+(?P<expected>[\w.-]+)$",
    re.IGNORECASE,
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
                if self._repo_root is not None and not Path(str(value)).is_absolute():
                    epic_dir_value = str(self._repo_root / str(value))
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

        raise GateFailedError(
            f"gate node {node.id!r} predicate not understood by hde-2 gate handler "
            f"(richer predicates land in hde-3a): {predicate!r}"
        )
