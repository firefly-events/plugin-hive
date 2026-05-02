"""Tests for compose_tool_policy + audit-event emission.

Policy: pure_override_with_surface_when_overrides. Step-level `tools:`
REPLACES persona defaults (NOT a merge); every override emits a
`tool_gating_overridden` event so the security audit can observe it.

Second-factor checks (security:plan-audit findings #6 + #7) — the
allow-list in escalatable_tools.yaml and the per-persona deny-list
form the second factor on top of the audit event.

Risk #11 — macOS-only tools (codex, cmux) raise on non-Darwin.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from hive.lib.dag_executor.executor import tool_gating
from hive.lib.dag_executor.executor.errors import (
    BackendIsolationViolationError,
    PlatformIncompatibilityError,
    ToolNotEscalatableError,
)
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
    assert evt["payload"]["effective_tools"] == ["Bash(git *)"]


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


# ---------------------------------------------------------------------
# Allow-list (escalatable_tools.yaml) — security:plan-audit finding #6
# ---------------------------------------------------------------------


def test_step_grants_unlisted_tool_raises_not_escalatable():
    """A step that grants a tool absent from the allow-list is rejected."""

    persona_only_read = ["Read"]
    with pytest.raises(ToolNotEscalatableError) as exc:
        compose_tool_policy(
            persona_only_read,
            ["Read", "MysteryTool"],
            None,
            "rid-1",
            "step-1",
        )
    assert "MysteryTool" in str(exc.value)


def test_step_grants_always_grantable_tool_passes():
    """Read/Grep/Glob escalation is fine — low-blast tools."""

    out = compose_tool_policy(
        ["Read"],
        ["Read", "Grep", "Glob"],
        None,
        "rid-1",
        "step-1",
    )
    assert out == ["Read", "Grep", "Glob"]


def test_step_grants_escalatable_high_blast_tool_passes_with_event():
    """Bash is escalatable — listed in escalatable_tools.yaml — so the
    grant is allowed but always emits the audit event."""

    tel = Telemetry(run_id="rid-1")
    out = compose_tool_policy(
        ["Read"],
        ["Read", "Bash"],
        None,
        "rid-1",
        "step-1",
        telemetry=tel,
    )
    assert out == ["Read", "Bash"]
    assert _emit_count(tel, "tool_gating_overridden") == 1


def test_step_narrowing_existing_persona_tool_skips_allow_list():
    """`Bash(git *)` is a NARROWING of persona's `Bash`, not a new grant."""

    out = compose_tool_policy(
        _PERSONA,
        ["Bash(git *)"],
        None,
        "rid-1",
        "step-1",
    )
    assert out == ["Bash(git *)"]


# ---------------------------------------------------------------------
# Persona deny-list — security:plan-audit finding #7 (verifier isolation)
# ---------------------------------------------------------------------


def test_codex_grant_to_reviewer_persona_raises_backend_isolation():
    """Verifier personas pinned to Opus cannot receive codex via override."""

    with pytest.raises(BackendIsolationViolationError) as exc:
        compose_tool_policy(
            ["Read", "Grep"],
            ["Read", "codex"],
            None,
            "rid-1",
            "step-1",
            persona_id="reviewer",
        )
    assert "codex" in str(exc.value)
    assert "reviewer" in str(exc.value)


def test_codex_grant_to_developer_persona_passes():
    """Non-verifier personas can receive codex via override on Darwin."""

    if tool_gating._PLATFORM != "Darwin":  # pragma: no cover
        pytest.skip("codex grant requires Darwin host")
    out = compose_tool_policy(
        ["Read"],
        ["Read", "codex"],
        None,
        "rid-1",
        "step-1",
        persona_id="developer",
    )
    assert out == ["Read", "codex"]


# ---------------------------------------------------------------------
# Platform check — Risk #11
# ---------------------------------------------------------------------


def test_macos_only_codex_on_linux_raises():
    """codex requested on Linux raises PlatformIncompatibilityError."""

    with patch.object(tool_gating, "_PLATFORM", "Linux"):
        with pytest.raises(PlatformIncompatibilityError) as exc:
            compose_tool_policy(
                ["Read"],
                ["Read", "codex"],
                None,
                "rid-1",
                "step-1",
            )
    assert "codex" in str(exc.value)
    assert "Linux" in str(exc.value)


def test_macos_only_cmux_on_linux_raises():
    """cmux requested on Linux raises PlatformIncompatibilityError."""

    with patch.object(tool_gating, "_PLATFORM", "Linux"):
        with pytest.raises(PlatformIncompatibilityError):
            compose_tool_policy(
                ["Read"],
                ["Read", "cmux"],
                None,
                "rid-1",
                "step-1",
            )


def test_macos_only_codex_on_darwin_passes():
    """codex requested on Darwin works — no platform error."""

    with patch.object(tool_gating, "_PLATFORM", "Darwin"):
        out = compose_tool_policy(
            ["Read"],
            ["Read", "codex"],
            None,
            "rid-1",
            "step-1",
        )
    assert out == ["Read", "codex"]


def test_no_platform_violation_when_no_macos_only_tool_referenced():
    """Linux with non-macOS-only tools is fine — no spurious error."""

    with patch.object(tool_gating, "_PLATFORM", "Linux"):
        out = compose_tool_policy(
            ["Read"],
            ["Read", "Bash"],
            None,
            "rid-1",
            "step-1",
        )
    assert out == ["Read", "Bash"]


# ---------------------------------------------------------------------
# Audit event payload — completeness
# ---------------------------------------------------------------------


def test_audit_event_carries_effective_tools_and_persona_id():
    tel = Telemetry(run_id="rid-1")
    compose_tool_policy(
        ["Read"],
        ["Read", "Bash"],
        None,
        "rid-1",
        "step-1",
        telemetry=tel,
        persona_id="developer",
    )
    evt = tel.events[0]
    assert evt["payload"]["persona_default_tools"] == ["Read"]
    assert evt["payload"]["effective_tools"] == ["Read", "Bash"]
    assert evt["payload"]["persona_id"] == "developer"
    assert evt["payload"]["step_override_tools"] == ["Read", "Bash"]
