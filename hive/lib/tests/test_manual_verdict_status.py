"""Tests for the wr-3 manual_verdict aging + nag + waive (hive/lib/manual_verdict_status.py)."""

from __future__ import annotations

import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml

from hive.lib.manual_verdict_status import (
    WaiveError,
    blocking_pending_verdicts,
    derive_manual_verdict_required,
    epic_has_manual_verdict_blocks,
    epic_has_required_device_pass,
    find_pending_manual_verdicts,
    format_pending_aging_section,
    waive_pending_verdict,
)


def _git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, check=True
    )
    return result.stdout.strip()


def _init_repo(repo: Path) -> None:
    repo.mkdir(parents=True, exist_ok=True)
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test")


def _write_story(repo: Path, epic_id: str, story_id: str, body: str, *, commit: bool = True) -> Path:
    story_path = repo / ".pHive" / "epics" / epic_id / "stories" / f"{story_id}.yaml"
    story_path.parent.mkdir(parents=True, exist_ok=True)
    story_path.write_text(body, encoding="utf-8")
    if commit:
        _git(repo, "add", ".")
        _git(repo, "commit", "-q", "-m", f"[{story_id}] seed story")
    return story_path


_PENDING_BODY = """\
id: {story_id}
epic: {epic_id}
title: Some UI story
status: pending
acceptance_criteria:
  - "does the thing"
manual_verdict:
  scenario_ref: .pHive/test-scenarios/{story_id}-manual.yaml
  required: true
  verdict: null
  timestamp: null
  agent: null
steps:
  - id: research
    agent: researcher
"""

_NON_UI_PENDING_BODY = """\
id: {story_id}
epic: {epic_id}
title: A backend story with simulated-manual, but not a device/UI gate
status: pending
acceptance_criteria:
  - "does the thing"
manual_verdict:
  scenario_ref: .pHive/test-scenarios/{story_id}-manual.yaml
  required: false
  verdict: null
  timestamp: null
  agent: null
steps:
  - id: research
    agent: researcher
"""

_RENDERED_BODY = """\
id: {story_id}
epic: {epic_id}
title: Some UI story
status: pending
manual_verdict:
  scenario_ref: .pHive/test-scenarios/{story_id}-manual.yaml
  verdict: pass
  timestamp: "2026-05-21T20:45:00Z"
  agent: tester
steps:
  - id: research
    agent: researcher
"""

_NO_VERDICT_BODY = """\
id: {story_id}
epic: {epic_id}
title: A backend story
status: pending
steps:
  - id: research
    agent: researcher
"""


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    repo_root = tmp_path / "repo"
    _init_repo(repo_root)
    return repo_root


def test_pending_verdict_is_surfaced_with_aging(repo: Path) -> None:
    story_path = _write_story(
        repo, "epic-1", "s1-story", _PENDING_BODY.format(story_id="s1-story", epic_id="epic-1")
    )

    now = datetime.now(timezone.utc) + timedelta(days=5)
    results = find_pending_manual_verdicts(repo, repo / ".pHive", now=now)

    assert len(results) == 1
    result = results[0]
    assert result.epic_id == "epic-1"
    assert result.story_id == "s1-story"
    assert result.story_path == story_path
    assert result.days_pending == 5
    assert result.waived is False


def test_rendered_verdict_is_not_pending(repo: Path) -> None:
    _write_story(
        repo, "epic-1", "s1-story", _RENDERED_BODY.format(story_id="s1-story", epic_id="epic-1")
    )

    results = find_pending_manual_verdicts(repo, repo / ".pHive")

    assert results == []


def test_story_without_manual_verdict_is_ignored(repo: Path) -> None:
    _write_story(
        repo, "epic-1", "s1-story", _NO_VERDICT_BODY.format(story_id="s1-story", epic_id="epic-1")
    )

    results = find_pending_manual_verdicts(repo, repo / ".pHive")

    assert results == []


def test_epic_with_no_manual_verdict_blocks_is_not_a_device_pass_epic(repo: Path) -> None:
    _write_story(
        repo, "epic-1", "s1-story", _NO_VERDICT_BODY.format(story_id="s1-story", epic_id="epic-1")
    )

    assert epic_has_required_device_pass(repo / ".pHive" / "epics" / "epic-1" / "stories") is False
    assert epic_has_manual_verdict_blocks(repo / ".pHive" / "epics" / "epic-1" / "stories") is False


def test_epic_with_a_required_manual_verdict_block_is_a_device_pass_epic(repo: Path) -> None:
    _write_story(
        repo, "epic-1", "s1-story", _PENDING_BODY.format(story_id="s1-story", epic_id="epic-1")
    )

    assert epic_has_required_device_pass(repo / ".pHive" / "epics" / "epic-1" / "stories") is True


def test_epic_with_only_non_required_manual_verdict_blocks_is_not_a_device_pass_epic(
    repo: Path,
) -> None:
    """Round-1 bug: blocking used to key off manual_verdict PRESENCE, which
    wrongly blocked non-UI epics. A non-UI epic (simulated-manual concern
    applies but required is false) must NOT be classified as a device-pass
    epic, even though it has a manual_verdict block (broad presence)."""
    _write_story(
        repo, "epic-1", "s1-story", _NON_UI_PENDING_BODY.format(story_id="s1-story", epic_id="epic-1")
    )

    stories_dir = repo / ".pHive" / "epics" / "epic-1" / "stories"
    assert epic_has_required_device_pass(stories_dir) is False
    assert epic_has_manual_verdict_blocks(stories_dir) is True


def test_waive_requires_reason_and_owner(repo: Path) -> None:
    story_path = _write_story(
        repo, "epic-1", "s1-story", _PENDING_BODY.format(story_id="s1-story", epic_id="epic-1")
    )

    with pytest.raises(WaiveError):
        waive_pending_verdict(story_path, reason="", owner="don")
    with pytest.raises(WaiveError):
        waive_pending_verdict(story_path, reason="owner unavailable", owner="")


def test_waive_refuses_when_verdict_already_rendered(repo: Path) -> None:
    story_path = _write_story(
        repo, "epic-1", "s1-story", _RENDERED_BODY.format(story_id="s1-story", epic_id="epic-1")
    )

    with pytest.raises(WaiveError):
        waive_pending_verdict(story_path, reason="not needed", owner="don")


def test_waive_records_reason_and_still_shows_as_pending(repo: Path) -> None:
    story_path = _write_story(
        repo, "epic-1", "s1-story", _PENDING_BODY.format(story_id="s1-story", epic_id="epic-1")
    )

    waive_pending_verdict(
        story_path, reason="device unavailable this cycle", owner="don", timestamp="2026-07-19T00:00:00+00:00"
    )

    # The story YAML must still parse cleanly as YAML after the surgical edit.
    parsed = yaml.safe_load(story_path.read_text(encoding="utf-8"))
    assert parsed["manual_verdict"]["verdict"] is None
    assert parsed["manual_verdict"]["waived"]["reason"] == "device unavailable this cycle"
    assert parsed["manual_verdict"]["waived"]["owner"] == "don"
    assert parsed["steps"][0]["id"] == "research"  # rest of the file untouched

    results = find_pending_manual_verdicts(repo, repo / ".pHive")
    assert len(results) == 1
    assert results[0].waived is True
    assert results[0].waive_reason == "device unavailable this cycle"
    assert results[0].waive_owner == "don"


def test_waived_pending_is_excluded_from_blocking_but_not_from_findall(repo: Path) -> None:
    story_path = _write_story(
        repo, "epic-1", "s1-story", _PENDING_BODY.format(story_id="s1-story", epic_id="epic-1")
    )
    _write_story(
        repo, "epic-1", "s2-story", _PENDING_BODY.format(story_id="s2-story", epic_id="epic-1")
    )

    waive_pending_verdict(story_path, reason="owner unavailable", owner="don")

    blocking = blocking_pending_verdicts(repo, repo / ".pHive", "epic-1")
    assert [s.story_id for s in blocking] == ["s2-story"]

    all_pending = find_pending_manual_verdicts(repo, repo / ".pHive")
    assert {s.story_id for s in all_pending} == {"s1-story", "s2-story"}


def test_non_required_pending_verdict_never_blocks(repo: Path) -> None:
    """AC: a non-UI epic with a PENDING manual_verdict (required: false) is
    shippable — blocking_pending_verdicts must exclude it even though it is
    unwaived and still surfaced by find_pending_manual_verdicts (broad)."""
    _write_story(
        repo, "epic-1", "s1-story", _NON_UI_PENDING_BODY.format(story_id="s1-story", epic_id="epic-1")
    )

    blocking = blocking_pending_verdicts(repo, repo / ".pHive", "epic-1")
    assert blocking == []

    all_pending = find_pending_manual_verdicts(repo, repo / ".pHive")
    assert len(all_pending) == 1
    assert all_pending[0].required is False


def test_re_waive_replaces_prior_waive_record(repo: Path) -> None:
    story_path = _write_story(
        repo, "epic-1", "s1-story", _PENDING_BODY.format(story_id="s1-story", epic_id="epic-1")
    )

    waive_pending_verdict(story_path, reason="first reason", owner="don")
    waive_pending_verdict(story_path, reason="second reason", owner="alex")

    parsed = yaml.safe_load(story_path.read_text(encoding="utf-8"))
    assert parsed["manual_verdict"]["waived"]["reason"] == "second reason"
    assert parsed["manual_verdict"]["waived"]["owner"] == "alex"
    # exactly one waived: sub-block in the manual_verdict mapping
    assert list(parsed["manual_verdict"].keys()).count("waived") == 1


_MALFORMED_WAIVED_BODIES = {
    "missing_reason": """\
id: {story_id}
epic: {epic_id}
title: Some UI story
status: pending
manual_verdict:
  scenario_ref: .pHive/test-scenarios/{story_id}-manual.yaml
  required: true
  verdict: null
  timestamp: null
  agent: null
  waived:
    owner: don
    timestamp: "2026-07-10T00:00:00+00:00"
steps:
  - id: research
    agent: researcher
""",
    "blank_reason": """\
id: {story_id}
epic: {epic_id}
title: Some UI story
status: pending
manual_verdict:
  scenario_ref: .pHive/test-scenarios/{story_id}-manual.yaml
  required: true
  verdict: null
  timestamp: null
  agent: null
  waived:
    reason: "   "
    owner: don
    timestamp: "2026-07-10T00:00:00+00:00"
steps:
  - id: research
    agent: researcher
""",
    "missing_owner": """\
id: {story_id}
epic: {epic_id}
title: Some UI story
status: pending
manual_verdict:
  scenario_ref: .pHive/test-scenarios/{story_id}-manual.yaml
  required: true
  verdict: null
  timestamp: null
  agent: null
  waived:
    reason: incomplete
    timestamp: "2026-07-10T00:00:00+00:00"
steps:
  - id: research
    agent: researcher
""",
    "blank_owner": """\
id: {story_id}
epic: {epic_id}
title: Some UI story
status: pending
manual_verdict:
  scenario_ref: .pHive/test-scenarios/{story_id}-manual.yaml
  required: true
  verdict: null
  timestamp: null
  agent: null
  waived:
    reason: incomplete
    owner: ""
    timestamp: "2026-07-10T00:00:00+00:00"
steps:
  - id: research
    agent: researcher
""",
    "missing_timestamp": """\
id: {story_id}
epic: {epic_id}
title: Some UI story
status: pending
manual_verdict:
  scenario_ref: .pHive/test-scenarios/{story_id}-manual.yaml
  required: true
  verdict: null
  timestamp: null
  agent: null
  waived:
    reason: incomplete
    owner: don
steps:
  - id: research
    agent: researcher
""",
    "invalid_timestamp": """\
id: {story_id}
epic: {epic_id}
title: Some UI story
status: pending
manual_verdict:
  scenario_ref: .pHive/test-scenarios/{story_id}-manual.yaml
  required: true
  verdict: null
  timestamp: null
  agent: null
  waived:
    reason: incomplete
    owner: don
    timestamp: "not-a-date"
steps:
  - id: research
    agent: researcher
""",
    "empty_mapping": """\
id: {story_id}
epic: {epic_id}
title: Some UI story
status: pending
manual_verdict:
  scenario_ref: .pHive/test-scenarios/{story_id}-manual.yaml
  required: true
  verdict: null
  timestamp: null
  agent: null
  waived: {{}}
steps:
  - id: research
    agent: researcher
""",
    "bare_key": """\
id: {story_id}
epic: {epic_id}
title: Some UI story
status: pending
manual_verdict:
  scenario_ref: .pHive/test-scenarios/{story_id}-manual.yaml
  required: true
  verdict: null
  timestamp: null
  agent: null
  waived:
steps:
  - id: research
    agent: researcher
""",
    "non_mapping": """\
id: {story_id}
epic: {epic_id}
title: Some UI story
status: pending
manual_verdict:
  scenario_ref: .pHive/test-scenarios/{story_id}-manual.yaml
  required: true
  verdict: null
  timestamp: null
  agent: null
  waived: "device unavailable"
steps:
  - id: research
    agent: researcher
""",
}

# Expected bad-field label(s) that must appear in BOTH `waive_error` and the
# rendered /status section for each malformed case — asserting "INVALID" alone
# would pass even if the wrong field were blamed.
_MALFORMED_WAIVED_EXPECTED_LABELS: dict[str, tuple[str, ...]] = {
    "missing_reason": ("reason",),
    "blank_reason": ("reason",),
    "missing_owner": ("owner",),
    "blank_owner": ("owner",),
    "missing_timestamp": ("timestamp",),
    "invalid_timestamp": ("timestamp",),
    "empty_mapping": ("reason", "owner", "timestamp"),
    "bare_key": ("reason", "owner", "timestamp"),
    "non_mapping": ("mapping",),
}


@pytest.mark.parametrize("case", sorted(_MALFORMED_WAIVED_BODIES))
def test_malformed_persisted_waiver_still_blocks_and_identifies_bad_field(
    repo: Path, case: str
) -> None:
    """MUL/wr-3 round-2+3 regression: a malformed persisted `waived:` sub-block
    (hand-edited or corrupted YAML, not written via `waive_pending_verdict`) —
    including an explicitly present but empty mapping, a bare key, or a
    non-mapping value — must NOT be treated as an effective waive. It must
    remain blocking and the status must name the specific bad field(s), not
    just say something is wrong."""
    story_path = _write_story(
        repo, "epic-1", "s1-story", _MALFORMED_WAIVED_BODIES[case].format(story_id="s1-story", epic_id="epic-1")
    )

    results = find_pending_manual_verdicts(repo, repo / ".pHive")
    assert len(results) == 1
    result = results[0]
    assert result.waived is False
    assert result.waive_attempted is True
    assert result.waive_error is not None

    blocking = blocking_pending_verdicts(repo, repo / ".pHive", "epic-1")
    assert [s.story_id for s in blocking] == ["s1-story"]

    section = format_pending_aging_section(results)
    assert "s1-story" in section
    assert "INVALID" in section

    for label in _MALFORMED_WAIVED_EXPECTED_LABELS[case]:
        assert label in result.waive_error, f"expected {label!r} in waive_error: {result.waive_error!r}"
        assert label in section, f"expected {label!r} in rendered /status section: {section!r}"


def test_valid_triple_persisted_waiver_is_not_blocking_and_shows_waived_aging(repo: Path) -> None:
    body = """\
id: s1-story
epic: epic-1
title: Some UI story
status: pending
manual_verdict:
  scenario_ref: .pHive/test-scenarios/s1-story-manual.yaml
  required: true
  verdict: null
  timestamp: null
  agent: null
  waived:
    reason: device unavailable this cycle
    owner: don
    timestamp: "2026-07-10T00:00:00+00:00"
steps:
  - id: research
    agent: researcher
"""
    _write_story(repo, "epic-1", "s1-story", body)

    results = find_pending_manual_verdicts(repo, repo / ".pHive")
    assert len(results) == 1
    assert results[0].waived is True
    assert results[0].waive_error is None

    blocking = blocking_pending_verdicts(repo, repo / ".pHive", "epic-1")
    assert blocking == []

    section = format_pending_aging_section(results)
    assert "waived" in section
    assert "s1-story" in section


def test_waive_pending_verdict_rejects_invalid_caller_supplied_timestamp(repo: Path) -> None:
    story_path = _write_story(
        repo, "epic-1", "s1-story", _PENDING_BODY.format(story_id="s1-story", epic_id="epic-1")
    )

    with pytest.raises(WaiveError):
        waive_pending_verdict(story_path, reason="ok", owner="don", timestamp="not-a-date")


def test_plan_seeded_required_flag_reflects_story_shape(repo: Path) -> None:
    """/plan seeds `manual_verdict.required: true` for a genuine UI/device-pass
    story and `required: false` for a non-UI story that merely opted into the
    simulated-manual concern for scenario-replay coverage (story-yaml-schema.md
    sec 9.1b)."""
    _write_story(
        repo, "epic-1", "ui-story", _PENDING_BODY.format(story_id="ui-story", epic_id="epic-1")
    )
    _write_story(
        repo, "epic-1", "backend-story",
        _NON_UI_PENDING_BODY.format(story_id="backend-story", epic_id="epic-1"),
    )

    all_pending = {s.story_id: s for s in find_pending_manual_verdicts(repo, repo / ".pHive")}
    assert all_pending["ui-story"].required is True
    assert all_pending["backend-story"].required is False

    stories_dir = repo / ".pHive" / "epics" / "epic-1" / "stories"
    assert epic_has_required_device_pass(stories_dir) is True


def test_derive_manual_verdict_required_reflects_story_shape() -> None:
    """/plan seeds `manual_verdict.required` via `derive_manual_verdict_required`
    (skills/plan/SKILL.md step 13.3, story wr-3-manual-verdict-aging REVISION-1b):
    true only when the story is ITSELF a genuine UI/device-pass gate, false for a
    story that merely carries the simulated-manual concern (e.g. a backend story
    with regression-coverage scenario replay)."""
    assert derive_manual_verdict_required(
        "Add swipe gesture to dismiss the notification screen",
        ["User can swipe left to dismiss the card", "Dismiss animation completes within 200ms"],
    ) is True
    assert derive_manual_verdict_required(
        "Add retry backoff to the webhook dispatcher",
        ["Retries use exponential backoff", "Failed dispatch is logged with a correlation id"],
    ) is False


def test_format_pending_aging_section_is_empty_when_no_pending(repo: Path) -> None:
    assert format_pending_aging_section([]) == ""


def test_format_pending_aging_section_shows_waived_entries() -> None:
    from hive.lib.manual_verdict_status import ManualVerdictStatus

    statuses = [
        ManualVerdictStatus(
            epic_id="epic-1",
            story_id="s1-story",
            story_path=Path("s1.yaml"),
            scenario_ref="scn.yaml",
            required=True,
            pending_since="2026-07-01T00:00:00+00:00",
            days_pending=18,
            waived=True,
            waive_attempted=True,
            waive_error=None,
            waive_reason="device unavailable",
            waive_owner="don",
            waive_timestamp="2026-07-10T00:00:00+00:00",
        )
    ]

    output = format_pending_aging_section(statuses)

    assert "epic-1/s1-story" in output
    assert "waived" in output
    assert "18d" in output
