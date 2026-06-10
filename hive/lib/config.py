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


def resolve_state_dir(
    *,
    cwd: str | os.PathLike[str],
    env: dict[str, str],
) -> str:
    """Resolve the Hive state directory to an absolute, canonicalized path.

    Canonical state-dir resolver per language-strategy ADR Option B; shell
    (`hooks/common.sh`) and Node (`hive/lib/config.js`) resolvers are
    compatibility shims that conform to this behavior.

    Precedence: ``HIVE_STATE_DIR`` env > ``paths.state_dir`` in the root
    hive.config.yaml > default ``.pHive``. The config file is located via
    ``CONFIG_FILE`` env when set, else ``$HIVE_ROOT/hive.config.yaml`` when
    ``HIVE_ROOT`` is set and non-empty, else ``cwd/hive.config.yaml``.
    An absolute value is used as-is; a relative value is
    resolved under ``paths.target_project`` when set (itself resolved under
    ``cwd`` when relative), else under ``cwd``. The result is always
    symlink-canonicalized.
    """
    cwd_path = Path(cwd)
    config_path = env.get("CONFIG_FILE")
    if not config_path:
        hive_root = env.get("HIVE_ROOT")
        config_path = (
            os.path.join(hive_root, "hive.config.yaml")
            if hive_root
            else str(cwd_path / "hive.config.yaml")
        )

    # Like the shell shim, the env value is used raw (empty means unset);
    # only config-sourced values go through scalar cleaning.
    state_dir = env.get("HIVE_STATE_DIR") or None
    if state_dir is None:
        state_dir = _read_paths_value(config_path, "state_dir") or ".pHive"

    if os.path.isabs(state_dir):
        return _canonicalize_path(state_dir)

    target_project = _read_paths_value(config_path, "target_project")
    if target_project is None:
        base = str(cwd_path)
    elif os.path.isabs(target_project):
        base = _canonicalize_path(target_project)
    else:
        base = _canonicalize_path(str(cwd_path / target_project))

    return _canonicalize_path(os.path.join(base, state_dir))


def _canonicalize_path(value: str) -> str:
    return str(Path(value).resolve())


def _read_paths_value(
    config_path: str | os.PathLike[str], key: str
) -> str | None:
    path = Path(config_path)
    if not path.exists():
        return None
    try:
        raw = path.read_text(encoding="utf-8")
    except Exception:
        return None

    parsed: dict[str, Any] | None = None
    try:
        candidate = json.loads(raw)
        if isinstance(candidate, dict):
            parsed = candidate
    except Exception:
        pass

    if parsed is None and yaml is not None:
        try:
            candidate = yaml.safe_load(raw)
            if isinstance(candidate, dict):
                parsed = candidate
        except Exception:
            pass

    if parsed is not None:
        paths = parsed.get("paths")
        value = paths.get(key) if isinstance(paths, dict) else None
        return _clean_paths_scalar(value)

    return _clean_paths_scalar(_parse_paths_block_value(raw, key))


def _parse_paths_block_value(raw: str, key: str) -> str | None:
    """Line-oriented fallback mirroring the awk parse in hooks/common.sh."""
    in_paths = False
    for line in raw.splitlines():
        if re.match(r"^paths:\s*$", line):
            in_paths = True
            continue
        if in_paths and re.match(r"^[^\s#][^:]*:", line):
            in_paths = False
        if in_paths:
            match = re.match(rf"^\s+{re.escape(key)}:\s*(.*)$", line)
            if match:
                return match.group(1)
    return None


def _clean_paths_scalar(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if (text.startswith('"') and text.endswith('"') and len(text) >= 2) or (
        text.startswith("'") and text.endswith("'") and len(text) >= 2
    ):
        text = text[1:-1]
    if text == "" or text == "null":
        return None
    return text


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
