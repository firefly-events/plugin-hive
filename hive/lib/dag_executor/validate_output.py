"""s3 — deterministic output-validation gate.

North star: never trust the agent's self-report. After an artifact-producing
node (and after the reconcile node materialises the agent's commit), a validation
node runs THIS module against the COMMITTED files on disk and fails the run if
they don't conform to the schema. The squad lead over-claimed "committed" with
nothing committed; this is the deterministic boundary that catches it.

Targets are parameterised so execute/test/review (s10/s12/s13) plug their own
checks into `VALIDATORS` without touching the gate wiring. `plan-epic` (consumed
by the plan graph s8) is implemented here; the others are declared extension
points.

Usage as a graph SCRIPT node (fails the node on non-zero exit):
    python3 -m hive.lib.dag_executor.validate_output --target plan-epic \\
        --epic-dir .pHive/epics/<id>
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Callable

import yaml


class OutputValidationError(Exception):
    """Raised when committed output fails schema validation."""


def _load_yaml(path: Path) -> dict | None:
    try:
        with path.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
    except FileNotFoundError:
        return None
    except yaml.YAMLError as exc:
        raise OutputValidationError(f"{path}: malformed YAML — {exc}") from exc
    if data is not None and not isinstance(data, dict):
        raise OutputValidationError(f"{path}: top-level YAML is not a mapping")
    return data or {}


def _nonempty_list(value: object) -> bool:
    return isinstance(value, list) and len(value) > 0


def validate_plan_output(epic_dir: Path | str) -> list[str]:
    """Validate a committed plan epic: epic.yaml + stories/*.yaml.

    Returns a list of human-readable errors (empty == valid). Reads files from
    disk; an empty/absent directory yields errors (self-report-only fails here).
    """
    epic_dir = Path(epic_dir)
    errors: list[str] = []

    epic_yaml = epic_dir / "epic.yaml"
    epic = _load_yaml(epic_yaml)
    if epic is None:
        return [f"epic.yaml not found at {epic_yaml} (nothing committed?)"]

    if not epic.get("name"):
        errors.append("epic.yaml: missing required field 'name'")
    stories = epic.get("stories")
    if not _nonempty_list(stories):
        errors.append("epic.yaml: 'stories' must be a non-empty list")
        return errors  # nothing more to check without a story list

    stories_dir = epic_dir / "stories"
    for entry in stories:
        if not isinstance(entry, dict) or not entry.get("id"):
            errors.append(f"epic.yaml: story entry missing 'id': {entry!r}")
            continue
        sid = entry["id"]
        spath = stories_dir / f"{sid}.yaml"
        story = _load_yaml(spath)
        if story is None:
            errors.append(f"story {sid}: file not found at {spath}")
            continue
        for field in ("id", "title", "acceptance_criteria", "steps"):
            if field not in story or story.get(field) in (None, "", [], {}):
                errors.append(f"story {sid}: missing/empty required field '{field}'")
        if "acceptance_criteria" in story and not _nonempty_list(
            story.get("acceptance_criteria")
        ):
            errors.append(f"story {sid}: 'acceptance_criteria' must be a non-empty list")
        if "steps" in story and not _nonempty_list(story.get("steps")):
            errors.append(f"story {sid}: 'steps' must be a non-empty list")

    return errors


def _not_implemented(_target: str) -> Callable[..., list[str]]:
    def _v(*_args, **_kwargs) -> list[str]:
        raise OutputValidationError(
            f"validation target {_target!r} not implemented yet "
            "(extension point — see s10/s12/s13)"
        )

    return _v


# Target registry. s10/s12/s13 replace their stubs with real validators.
VALIDATORS: dict[str, Callable[..., list[str]]] = {
    "plan-epic": validate_plan_output,
    "execute": _not_implemented("execute"),
    "test": _not_implemented("test"),
    "review": _not_implemented("review"),
}


def validate(target: str, **kwargs) -> list[str]:
    if target not in VALIDATORS:
        raise OutputValidationError(
            f"unknown validation target {target!r} (known: {', '.join(sorted(VALIDATORS))})"
        )
    return VALIDATORS[target](**kwargs)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="hive-dag-validate-output",
        description="Validate committed flow output against its schema (s3 gate).",
    )
    parser.add_argument("--target", required=True, help="validation target, e.g. plan-epic")
    parser.add_argument("--epic-dir", help="epic dir for plan-epic target")
    args = parser.parse_args(argv)

    kwargs: dict[str, object] = {}
    if args.epic_dir:
        kwargs["epic_dir"] = args.epic_dir

    try:
        errors = validate(args.target, **kwargs)
    except OutputValidationError as exc:
        print(f"VALIDATION ERROR: {exc}", file=sys.stderr)
        return 2

    if errors:
        print(f"output-validation FAILED for target {args.target!r}:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        return 1

    print(f"output-validation PASSED for target {args.target!r}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
