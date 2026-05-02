"""Step-level tool-gating composition.

Policy: `pure_override_with_surface_when_overrides`.

Per cycle-state composition_rationale (security:plan-audit lock):
"situation dictates which tools are used; step-author has most
specific context; trust step-level authority but surface/log when
step overrides persona for security observability."

Rules:
  * If neither `step_tools` nor `step_disallowed_tools` is set, the
    persona's default tools are returned unchanged. No event emitted.
  * If `step_tools` is set, it REPLACES `persona_default_tools`
    entirely (NOT a merge). Every override emits a
    `tool_gating_overridden` event so the security audit has
    observable behavior.
  * If `step_disallowed_tools` is set, the disallowed tools are
    subtracted from the active set (`step_tools` if provided,
    otherwise `persona_default_tools`). Same audit event fires.

Security-observability is non-negotiable: the audit event is emitted
on EVERY override path, never as a sampled or best-effort write.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .telemetry import Telemetry


def compose_tool_policy(
    persona_default_tools: list[str],
    step_tools: list[str] | None,
    step_disallowed_tools: list[str] | None,
    run_id: str,
    step_id: str,
    telemetry: "Telemetry | None" = None,
) -> list[str]:
    """Apply pure-override semantics and surface every override."""

    if step_tools is None and step_disallowed_tools is None:
        return list(persona_default_tools)

    if step_tools is not None:
        active = list(step_tools)
    else:
        active = list(persona_default_tools)

    if step_disallowed_tools:
        disallowed = set(step_disallowed_tools)
        active = [tool for tool in active if tool not in disallowed]

    if telemetry is not None:
        payload: dict[str, object] = {
            "step_id": step_id,
            "persona_default_tools": list(persona_default_tools),
        }
        if step_tools is not None:
            payload["step_override_tools"] = list(step_tools)
        if step_disallowed_tools is not None:
            payload["step_disallowed_tools"] = list(step_disallowed_tools)
        telemetry.emit("tool_gating_overridden", payload)

    return active
