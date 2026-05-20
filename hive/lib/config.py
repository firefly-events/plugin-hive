from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

try:  # pragma: no cover - depends on local optional dependency set
    import yaml  # type: ignore
except Exception:  # pragma: no cover - exercised when PyYAML unavailable
    yaml = None


EMIT_LIFECYCLE_AT_VALUES = frozenset({"phase", "story", "step", "off"})
DEFAULT_PROJECT_CONFIG_PATH = Path.cwd() / "hive.config.yaml"
DEFAULT_BASELINE_CONFIG_PATH = Path(__file__).resolve().parents[1] / "hive.config.yaml"


def read_config_file(file_path: str | os.PathLike[str] | None) -> dict[str, Any]:
    if not file_path:
        return {}
    path = Path(file_path)
    if not path.exists():
        return {}
    try:
        return parse_config_text(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def parse_config_text(raw: str) -> dict[str, Any]:
    if not raw or not raw.strip():
        return {}

    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        pass

    narrow = parse_top_level_emit_lifecycle_at(raw)
    if narrow:
        return narrow

    if yaml is not None:
        parsed = yaml.safe_load(raw)
        return parsed if isinstance(parsed, dict) else {}

    return parse_top_level_emit_lifecycle_at(raw)


def parse_top_level_emit_lifecycle_at(raw: str) -> dict[str, Any]:
    for line in raw.splitlines():
        match = re.match(
            r"^emit_lifecycle_at:\s*(.+?)\s*(?:#.*)?$",
            line,
        )
        if match:
            return {"emit_lifecycle_at": _coerce_scalar(match.group(1))}
    return {}


def _coerce_scalar(value: str) -> str:
    return value.strip().strip("\"'")


def validate_emit_lifecycle_at(value: Any) -> str:
    if value is None or value == "":
        return "phase"
    if isinstance(value, str) and value in EMIT_LIFECYCLE_AT_VALUES:
        return value
    return "phase"


def read_emit_lifecycle_at(
    *,
    project_config_path: str | os.PathLike[str] | None = None,
    baseline_config_path: str | os.PathLike[str] | None = None,
) -> str:
    baseline_path = baseline_config_path or DEFAULT_BASELINE_CONFIG_PATH
    project_path = (
        project_config_path
        or os.environ.get("HIVE_CONFIG")
        or DEFAULT_PROJECT_CONFIG_PATH
    )

    project_config = read_config_file(project_path)
    if "emit_lifecycle_at" in project_config:
        return validate_emit_lifecycle_at(project_config.get("emit_lifecycle_at"))

    baseline_config = read_config_file(baseline_path)
    if "emit_lifecycle_at" in baseline_config:
        return validate_emit_lifecycle_at(baseline_config.get("emit_lifecycle_at"))

    return "phase"
