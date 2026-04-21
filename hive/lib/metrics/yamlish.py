from __future__ import annotations

import json
from typing import Any

from .errors import MetricsValidationError


def dump_yaml(data: dict[str, Any]) -> str:
    return _dump_mapping(data, 0)


def _dump_mapping(data: dict[str, Any], indent: int) -> str:
    lines: list[str] = []
    prefix = " " * indent
    for key, value in data.items():
        if not isinstance(key, str):
            raise MetricsValidationError("YAML writer only supports string keys")
        if isinstance(value, dict):
            lines.append(f"{prefix}{key}:")
            lines.append(_dump_mapping(value, indent + 2))
        else:
            lines.append(f"{prefix}{key}: {_scalar_to_yaml(value)}")
    return "\n".join(lines) + "\n"


def _scalar_to_yaml(value: Any) -> str:
    if value is True:
        return "true"
    if value is False:
        return "false"
    if value is None:
        return "null"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, str):
        return json.dumps(value)
    raise MetricsValidationError(f"unsupported YAML scalar type: {type(value).__name__}")


def load_yaml(text: str) -> dict[str, Any]:
    root: dict[str, Any] = {}
    stack: list[tuple[int, dict[str, Any]]] = [(-1, root)]

    for lineno, raw_line in enumerate(text.splitlines(), start=1):
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        indent = len(raw_line) - len(raw_line.lstrip(" "))
        if indent % 2 != 0:
            raise MetricsValidationError(
                f"invalid YAML indentation at line {lineno}: {raw_line}"
            )

        while len(stack) > 1 and indent <= stack[-1][0]:
            stack.pop()

        if ":" not in stripped:
            raise MetricsValidationError(f"invalid YAML line {lineno}: {raw_line}")

        key, raw_value = stripped.split(":", 1)
        key = key.strip()
        raw_value = raw_value.strip()
        current = stack[-1][1]

        if not raw_value:
            nested: dict[str, Any] = {}
            current[key] = nested
            stack.append((indent, nested))
            continue

        current[key] = _parse_scalar(raw_value, lineno)

    return root


def _parse_scalar(raw_value: str, lineno: int) -> Any:
    if raw_value == "true":
        return True
    if raw_value == "false":
        return False
    if raw_value == "null":
        return None
    try:
        return json.loads(raw_value)
    except json.JSONDecodeError:
        pass

    if raw_value.startswith(("'", '"')):
        raise MetricsValidationError(
            f"invalid quoted scalar at line {lineno}: {raw_value}"
        )
    return raw_value

