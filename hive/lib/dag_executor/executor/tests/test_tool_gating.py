"""Tests for compose_tool_policy + audit-event emission.

Policy: pure_override_with_surface_when_overrides. Step-level `tools:`
REPLACES persona defaults (NOT a merge); every override emits a
`tool_gating_overridden` event so the security audit can observe it.
"""

from __future__ import annotations

from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.tool_gating import compose_tool_policy


_PERSONA = ["Read", "Edit", "Bash"]


def _emit_count(tel: Telemetry, event_type: str) -> int:
    return sum(1 for e in tel.events if e["event_type"] == event_type)


def test_no_override_returns_persona_unchanged_no_event():
    tel = Telemetry(run_id="rid-1")
    out = compose_tool_policy(_PERSONA, None, None, "rid-1", "step-1", telemetry=tel)
    assert out == _PERSONA
    assert tel.events == []


def test_step_tools_pure_override_emits_event():
    tel = Telemetry(run_id="rid-1")
    out = compose_tool_policy(
        _PERSONA, ["Bash(git *)"], None, "rid-1", "step-1", telemetry=tel
    )
    assert out == ["Bash(git *)"], "step_tools must REPLACE persona, not merge"
    assert _emit_count(tel, "tool_gating_overridden") == 1
    evt = tel.events[0]
    assert evt["step_id"] == "step-1"
    assert evt["payload"]["persona_default_tools"] == _PERSONA
    assert evt["payload"]["step_override_tools"] == ["Bash(git *)"]


def test_disallowed_subtracts_from_persona_emits_event():
    tel = Telemetry(run_id="rid-1")
    out = compose_tool_policy(
        _PERSONA, None, ["Bash"], "rid-1", "step-1", telemetry=tel
    )
    assert out == ["Read", "Edit"]
    assert _emit_count(tel, "tool_gating_overridden") == 1
    evt = tel.events[0]
    assert evt["payload"]["step_disallowed_tools"] == ["Bash"]
    assert "step_override_tools" not in evt["payload"]


def test_both_step_tools_and_disallowed_compose_emits_one_event():
    tel = Telemetry(run_id="rid-1")
    out = compose_tool_policy(
        _PERSONA,
        ["Read", "Edit", "Bash"],
        ["Bash"],
        "rid-1",
        "step-1",
        telemetry=tel,
    )
    assert out == ["Read", "Edit"]
    assert _emit_count(tel, "tool_gating_overridden") == 1


def test_event_omitted_when_telemetry_absent_but_policy_still_applied():
    """The composition is pure even without a telemetry sink."""
    out = compose_tool_policy(
        _PERSONA, ["Bash(git *)"], None, "rid-1", "step-1", telemetry=None
    )
    assert out == ["Bash(git *)"]
