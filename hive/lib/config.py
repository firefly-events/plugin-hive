"""Read Hive's intentionally separate three-file configuration layers.

The root ``hive.config.yaml`` is the consumer override layer, located from
the invoking project (normally the current working directory; ``HIVE_CONFIG``
can override this path for emit-lifecycle reads).  The shipped
``hive/hive.config.yaml`` is the package baseline, located relative to this
installed module.  For loop configuration, root values override baseline
values per field, with the corresponding environment variables taking final
precedence.  For the ``emit_lifecycle_at`` setting, the first file containing
the key wins (root over baseline), so a root value replaces the whole scalar.

The third file, ``.pHive/hive.config.yaml``, is not part of this baseline
fallback.  It is a separate consumer-local executor graduation flag and is
read by the executor integration.  Keeping it isolated prevents that
maintainer-only opt-in from being accidentally shipped with the package.
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Callable

_log = logging.getLogger(__name__)

try:  # pragma: no cover - depends on local optional dependency set
    import yaml  # type: ignore
except Exception:  # pragma: no cover - exercised when PyYAML unavailable
    yaml = None

from hive.lib.paths_scan import scan_paths_block


EMIT_LIFECYCLE_AT_VALUES = frozenset({"phase", "story", "step", "off"})

LOOP_FEATURES = frozenset({
    "review_converge",
    "tdd_red_green",
    "bdd_converge",
    "test_swarm",
    "grill",
})


class LoopConfigError(ValueError):
    """Raised when loop feature config fails validation."""
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
    except Exception as exc:
        _log.debug("read_config_file: error reading %s: %s", path, exc)
        return {}


def parse_config_text(raw: str) -> dict[str, Any]:
    if not raw or not raw.strip():
        return {}

    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
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
    paths_scanner: Callable[[str, str], str | None] = scan_paths_block,
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
    # Relative CONFIG_FILE/HIVE_ROOT resolve against the cwd argument (the
    # shell shim cd's to cwd first, so this keeps the runtimes conformant).
    if not os.path.isabs(config_path):
        config_path = str(cwd_path / config_path)

    # Like the shell shim, the env value is used raw (empty means unset);
    # only config-sourced values go through scalar cleaning.
    state_dir = env.get("HIVE_STATE_DIR") or None
    if state_dir is None:
        state_dir = (
            _read_paths_value(config_path, "state_dir", paths_scanner)
            or ".pHive"
        )

    if os.path.isabs(state_dir):
        return _canonicalize_path(state_dir)

    target_project = _read_paths_value(config_path, "target_project", paths_scanner)
    if target_project is None:
        base = str(cwd_path)
    elif os.path.isabs(target_project):
        base = _canonicalize_path(target_project)
    else:
        base = _canonicalize_path(str(cwd_path / target_project))

    return _canonicalize_path(os.path.join(base, state_dir))


def _canonicalize_path(value: str) -> str:
    """Symlink-canonicalize a path like ``realpath -m``: existing components
    are resolved through the filesystem, non-existent tails kept as-is."""
    return str(Path(value).resolve())


def _read_paths_value(
    config_path: str | os.PathLike[str],
    key: str,
    paths_scanner: Callable[[str, str], str | None] = scan_paths_block,
) -> str | None:
    """Read one ``paths.<key>`` scalar from a hive.config.yaml file: JSON
    first, then PyYAML when available, then the line-oriented block fallback.
    Returns a cleaned string or None when missing/empty/"null"."""
    path = Path(config_path)
    if not path.exists():
        return None
    try:
        raw = path.read_text(encoding="utf-8")
    except Exception as exc:
        _log.debug("_read_paths_value: error reading %s: %s", config_path, exc)
        return None

    parsed: dict[str, Any] | None = None
    try:
        candidate = json.loads(raw)
        if isinstance(candidate, dict):
            parsed = candidate
    except json.JSONDecodeError:
        pass

    if parsed is None and yaml is not None:
        try:
            candidate = yaml.safe_load(raw)
            if isinstance(candidate, dict):
                parsed = candidate
        except Exception as exc:
            _log.debug("_read_paths_value: yaml parse error in %s: %s", config_path, exc)

    if parsed is not None:
        paths = parsed.get("paths")
        value = paths.get(key) if isinstance(paths, dict) else None
        return _clean_paths_scalar(value)

    return _clean_paths_scalar(paths_scanner(raw, key))


def _parse_paths_block_value(raw: str, key: str) -> str | None:
    """Backward-compatible wrapper around the shared paths-block scanner."""
    return scan_paths_block(raw, key)


def _clean_paths_scalar(value: Any) -> str | None:
    """Normalize a paths scalar: trim, strip one matching pair of surrounding
    quotes, and map ""/"null" to None (mirrors the shell shim's awk cleanup)."""
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


def resolve_loop_config(
    feature: str,
    *,
    project_config_path: str | os.PathLike[str] | None = None,
    baseline_config_path: str | os.PathLike[str] | None = None,
) -> dict[str, Any]:
    """Resolve loop config for *feature* with precedence: env > project > baseline.

    Returns ``{"enabled": bool, "max_rounds": int}``.
    Raises :class:`LoopConfigError` when validation fails.
    """
    baseline_path = baseline_config_path or DEFAULT_BASELINE_CONFIG_PATH
    project_path = project_config_path or DEFAULT_PROJECT_CONFIG_PATH

    baseline_cfg = read_config_file(baseline_path)
    project_cfg = read_config_file(project_path)

    baseline_feature = (baseline_cfg.get("loops") or {}).get(feature) or {}
    project_feature = (project_cfg.get("loops") or {}).get(feature) or {}

    # Merge: project fields override baseline fields individually
    enabled = project_feature.get("enabled", baseline_feature.get("enabled"))
    max_rounds = project_feature.get("max_rounds", baseline_feature.get("max_rounds"))

    # Env var overrides (highest precedence)
    feature_env = feature.upper()  # tdd_red_green -> TDD_RED_GREEN
    env_key_enabled = f"HIVE_LOOPS_{feature_env}_ENABLED"
    env_key_max_rounds = f"HIVE_LOOPS_{feature_env}_MAX_ROUNDS"

    env_enabled = os.environ.get(env_key_enabled)
    if env_enabled is not None:
        lc = env_enabled.strip().lower()
        if lc == "true":
            enabled = True
        elif lc == "false":
            enabled = False
        else:
            raise LoopConfigError(
                f"loops.{feature}.enabled: {env_key_enabled} must be 'true' or 'false',"
                f" got {env_enabled!r}"
            )

    env_max_rounds = os.environ.get(env_key_max_rounds)
    if env_max_rounds is not None:
        try:
            max_rounds = int(env_max_rounds)
        except (ValueError, TypeError) as exc:
            raise LoopConfigError(
                f"loops.{feature}.max_rounds: {env_key_max_rounds} must be a positive integer,"
                f" got {env_max_rounds!r}"
            ) from exc

    # Validate enabled: must be a strict bool
    if not isinstance(enabled, bool):
        raise LoopConfigError(
            f"loops.{feature}.enabled must be a bool (true/false), got {enabled!r}"
        )

    # Validate max_rounds: must be int (not bool subclass) and >= 1
    if isinstance(max_rounds, bool) or not isinstance(max_rounds, int):
        raise LoopConfigError(
            f"loops.{feature}.max_rounds must be a positive integer, got {max_rounds!r}"
        )
    if max_rounds < 1:
        raise LoopConfigError(
            f"loops.{feature}.max_rounds must be a positive integer (>= 1), got {max_rounds!r}"
        )

    return {"enabled": enabled, "max_rounds": max_rounds}


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
