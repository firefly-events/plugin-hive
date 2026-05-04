"""Step-level tool-gating composition.

Policy: `pure_override_with_surface_when_overrides`.

Per cycle-state composition_rationale (security:plan-audit lock):
"situation dictates which tools are used; step-author has most
specific context; trust step-level authority but surface/log when
step overrides persona for security observability."

Composition rules:
  * If neither `step_tools` nor `step_disallowed_tools` is set, the
    persona's default tools are returned unchanged. No event emitted.
  * If `step_tools` is set, it REPLACES `persona_default_tools`
    entirely (NOT a merge). Every override emits a
    `tool_gating_overridden` event so the security audit has
    observable behavior.
  * If `step_disallowed_tools` is set, the disallowed tools are
    subtracted from the active set (`step_tools` if provided,
    otherwise `persona_default_tools`). Same audit event fires.

Second-factor checks (security:plan-audit findings #6 + #7):
  * Tools resolved into the active set must be in the
    `escalatable_tools.yaml` allow-list (always_grantable ∪
    escalatable). Unlisted high-blast tools raise
    `ToolNotEscalatableError`.
  * Tools with a persona-deny entry raise
    `BackendIsolationViolationError` when the resolved persona
    matches a denied persona.

Platform check (Risk #11):
  * macOS-only tools (`codex`, `cmux`) raise
    `PlatformIncompatibilityError` on non-Darwin platforms. No
    silent fallback.

Security-observability is non-negotiable: the audit event is emitted
on EVERY override path, never as a sampled or best-effort write.
"""

from __future__ import annotations

import platform
from pathlib import Path
from typing import TYPE_CHECKING

import yaml

from .errors import (
    BackendIsolationViolationError,
    PlatformIncompatibilityError,
    ToolNotEscalatableError,
)

if TYPE_CHECKING:
    from .telemetry import Telemetry


MACOS_ONLY_TOOLS: frozenset[str] = frozenset({"codex", "cmux"})

_PLATFORM: str = platform.system()

_ESCALATABLE_TOOLS_PATH = Path(__file__).with_name("escalatable_tools.yaml")


def _load_escalatable_tools() -> dict[str, object]:
    """Read escalatable_tools.yaml once and cache it."""

    with _ESCALATABLE_TOOLS_PATH.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


_ESCALATABLE_TOOLS: dict[str, object] = _load_escalatable_tools()
_ALWAYS_GRANTABLE: frozenset[str] = frozenset(
    _ESCALATABLE_TOOLS.get("always_grantable", []) or []
)
_ESCALATABLE: frozenset[str] = frozenset(
    _ESCALATABLE_TOOLS.get("escalatable", []) or []
)
_PERSONA_DENY: dict[str, frozenset[str]] = {
    tool: frozenset(personas or [])
    for tool, personas in (_ESCALATABLE_TOOLS.get("persona_deny", {}) or {}).items()
}


def _base_tool_name(spec: str) -> str:
    """Strip Claude-Code-style argument constraints (e.g. `Bash(git *)` → `Bash`)."""

    paren = spec.find("(")
    return spec[:paren] if paren != -1 else spec


def _check_platform_compat(active: list[str]) -> None:
    if _PLATFORM == "Darwin":
        return
    bases = {_base_tool_name(tool) for tool in active}
    violations = sorted(bases & MACOS_ONLY_TOOLS)
    if violations:
        raise PlatformIncompatibilityError(
            f"macOS-only tools requested on {_PLATFORM}: {violations}. "
            "No silent fallback."
        )


def _check_escalatable(
    active: list[str],
    persona_default_tools: list[str],
) -> None:
    """Reject step grants of tools outside the maintainer allow-list.

    Tool names are compared on their BASE name — the part before
    any `(...)` argument constraint. So `Bash(git *)` checks against
    `Bash` in `persona_default_tools` and the allow-list. A step
    that narrows a persona-granted base tool is not "granting a new
    tool" — it is constraining an existing grant.
    """

    persona_baseline = {_base_tool_name(tool) for tool in persona_default_tools}
    granted = [tool for tool in active if _base_tool_name(tool) not in persona_baseline]
    if not granted:
        return
    not_escalatable = [
        tool
        for tool in granted
        if _base_tool_name(tool) not in _ALWAYS_GRANTABLE
        and _base_tool_name(tool) not in _ESCALATABLE
    ]
    if not_escalatable:
        raise ToolNotEscalatableError(
            f"Step tried to grant tools missing from "
            f"escalatable_tools.yaml allow-list: {sorted(set(not_escalatable))}. "
            "Add the tool to `escalatable:` or remove from step `tools:`."
        )


def _check_persona_deny(
    active: list[str],
    persona_default_tools: list[str],
    persona_id: str | None,
) -> None:
    """Reject backend-bound tools granted to verifier personas."""

    if persona_id is None:
        return
    persona_baseline = {_base_tool_name(tool) for tool in persona_default_tools}
    granted = [tool for tool in active if _base_tool_name(tool) not in persona_baseline]
    for tool in granted:
        denied_personas = _PERSONA_DENY.get(_base_tool_name(tool))
        if denied_personas and persona_id in denied_personas:
            raise BackendIsolationViolationError(
                f"Step tried to grant `{tool}` to persona `{persona_id}`. "
                f"Persona is on the deny-list for this tool — verifier "
                "isolation requires the persona stay on its pinned "
                "backend. Remove the tool from step override or use a "
                "different persona."
            )


def compose_tool_policy(
    persona_default_tools: list[str],
    step_tools: list[str] | None,
    step_disallowed_tools: list[str] | None,
    run_id: str,
    step_id: str,
    telemetry: "Telemetry | None" = None,
    persona_id: str | None = None,
) -> list[str]:
    """Apply pure-override semantics, run second-factor checks, surface every override."""

    if step_tools is None and step_disallowed_tools is None:
        return list(persona_default_tools)

    if step_tools is not None:
        active = list(step_tools)
    else:
        active = list(persona_default_tools)

    if step_disallowed_tools:
        disallowed = set(step_disallowed_tools)
        active = [tool for tool in active if tool not in disallowed]

    _check_escalatable(active, persona_default_tools)
    _check_persona_deny(active, persona_default_tools, persona_id)
    _check_platform_compat(active)

    if telemetry is not None:
        payload: dict[str, object] = {
            "persona_default_tools": list(persona_default_tools),
            "effective_tools": list(active),
        }
        if persona_id is not None:
            payload["persona_id"] = persona_id
        if step_tools is not None:
            payload["step_override_tools"] = list(step_tools)
        if step_disallowed_tools is not None:
            payload["step_disallowed_tools"] = list(step_disallowed_tools)
        telemetry.emit("tool_gating_overridden", step_id, payload)

    return active
