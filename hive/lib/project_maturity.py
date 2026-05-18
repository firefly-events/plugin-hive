"""Project-maturity classification helper.

Single source of truth for reading ``project_maturity`` from
``.pHive/project-profile.yaml``. Downstream consumers (drift-score, candidate-detect,
retry tuning, etc.) call ``resolve_maturity()`` rather than parse the profile
YAML inline.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

try:  # pragma: no cover - optional dep
    import yaml  # type: ignore
except Exception:  # pragma: no cover - exercised when PyYAML unavailable
    yaml = None


ALLOWED_MATURITY = ("greenfield", "early", "established", "mature")
DEFAULT_MATURITY = "early"
DEFAULT_PROFILE_PATH = Path(".pHive") / "project-profile.yaml"

_log = logging.getLogger(__name__)


def resolve_maturity(profile_path: str | os.PathLike[str] | None = None) -> str:
    """Return the project's maturity classification.

    Reads ``project_maturity`` from ``.pHive/project-profile.yaml`` and returns
    one of ``{greenfield, early, established, mature}``. Defaults to ``early``
    when the profile is missing, marked as a placeholder, or the field is
    absent — matching today's ``gate_mode: warning`` posture (conservative,
    won't trip skip-gates for projects that haven't kicked off yet).

    Raises:
        ValueError: when ``project_maturity`` is set to a value outside the
            allowed set. The error message names the allowed values.
    """
    path = Path(profile_path) if profile_path is not None else DEFAULT_PROFILE_PATH

    if not path.exists():
        _log.warning(
            "project-profile.yaml not found at %s — defaulting to %s",
            path,
            DEFAULT_MATURITY,
        )
        return DEFAULT_MATURITY

    try:
        data = _load_profile(path)
    except Exception as exc:  # pragma: no cover - YAML parse failure
        _log.warning(
            "could not parse %s (%s) — defaulting to %s",
            path,
            exc,
            DEFAULT_MATURITY,
        )
        return DEFAULT_MATURITY

    if not isinstance(data, dict):
        return DEFAULT_MATURITY

    if data.get("placeholder") is True:
        return DEFAULT_MATURITY

    value = data.get("project_maturity")
    if value is None or value == "":
        return DEFAULT_MATURITY

    if isinstance(value, str) and value in ALLOWED_MATURITY:
        return value

    raise ValueError(
        f"invalid project_maturity {value!r}; allowed: {list(ALLOWED_MATURITY)}"
    )


def _load_profile(path: Path) -> Any:
    text = path.read_text(encoding="utf-8")
    if yaml is not None:
        return yaml.safe_load(text)
    return _minimal_top_level_parse(text)


def _minimal_top_level_parse(text: str) -> dict[str, Any]:
    """Fallback parser used when PyYAML is unavailable.

    Reads top-level ``key: value`` pairs only. Sufficient for the two fields
    this helper cares about (``placeholder`` and ``project_maturity``); nested
    structures and block scalars are ignored.
    """
    data: dict[str, Any] = {}
    for raw_line in text.splitlines():
        if not raw_line or raw_line.startswith((" ", "\t", "#", "-")):
            continue
        if ":" not in raw_line:
            continue
        key, _, raw_value = raw_line.partition(":")
        key = key.strip()
        raw_value = raw_value.split("#", 1)[0].strip()
        if not raw_value:
            continue
        if raw_value == "true":
            data[key] = True
        elif raw_value == "false":
            data[key] = False
        elif raw_value == "null":
            data[key] = None
        elif raw_value.startswith(("'", '"')) and raw_value.endswith(raw_value[0]):
            data[key] = raw_value[1:-1]
        else:
            data[key] = raw_value
    return data


__all__ = ["ALLOWED_MATURITY", "DEFAULT_MATURITY", "resolve_maturity"]
