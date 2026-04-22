"""Text-level invariants for the live meta-meta maintainer skill."""

from __future__ import annotations

from pathlib import Path


SKILL_PATH = Path("maintainer-skills/meta-meta-optimize/SKILL.md")


def _skill_text() -> str:
    return SKILL_PATH.read_text(encoding="utf-8")


def test_skill_references_all_eight_steps() -> None:
    text = _skill_text()

    for step_file in (
        "step-01-boot.md",
        "step-02-analysis.md",
        "step-03-proposal.md",
        "step-03b-backlog-fallback.md",
        "step-04-implementation.md",
        "step-05-testing.md",
        "step-06-evaluation.md",
        "step-07-promotion.md",
        "step-08-close.md",
    ):
        assert step_file in text


def test_skill_names_direct_commit_adapter() -> None:
    assert "DirectCommitAdapter" in _skill_text()


def test_skill_forbids_public_shipping() -> None:
    text = _skill_text()

    assert "plugin.json" in text
    assert any(phrase in text for phrase in ("does not ship", "NOT shipped", "local-only"))


def test_skill_defaults_to_worktree() -> None:
    text = _skill_text()

    assert "worktree" in text
    assert ".pHive/meta-team/worktrees/" in text


def test_skill_references_shared_library() -> None:
    text = _skill_text()

    assert "hive/lib/meta-experiment/" in text
    for module_name in (
        "envelope",
        "baseline",
        "compare",
        "promotion_adapter",
        "rollback_watch",
        "closure_validator",
    ):
        assert module_name in text


def test_skill_preserves_close_gate() -> None:
    text = _skill_text()

    assert "closure_validator.validate_closable" in text
    assert "non-bypassable" in text


def test_skill_names_backlog_fallback() -> None:
    text = _skill_text()

    assert "step-03b-backlog-fallback.md" in text
    assert "no metric signal" in text


def test_skill_preserves_two_swarm_boundary() -> None:
    """AC3: two-swarm model preserved — maintainer swarm only, no /meta-optimize semantics."""
    text = _skill_text()

    assert "maintainer swarm" in text
    # Must explicitly forbid PR-flow or /meta-optimize (public-swarm) promotion semantics
    assert "PR-flow" in text
    assert "/meta-optimize" in text


def test_skill_defers_proof_artifact_capture_to_later_stories() -> None:
    """AC4: orchestration live now, baseline + rollback proof-artifact capture deferred."""
    text = _skill_text()

    # Baseline capture is reserved for BL2.3
    assert "BL2.3" in text
    assert "baseline" in text
    # Rollback watch is deferred to BL2.4 territory
    assert "BL2.4" in text
    assert "rollback_watch" in text
