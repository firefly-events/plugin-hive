"""s3 — tests for the deterministic output-validation gate."""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from hive.lib.dag_executor.validate_output import (
    OutputValidationError,
    main,
    validate,
    validate_plan_output,
)


def _make_epic(tmp_path: Path, *, story_body: str | None = None, stories_field: str = None):
    epic_dir = tmp_path / "epics" / "demo"
    (epic_dir / "stories").mkdir(parents=True)
    stories_block = stories_field if stories_field is not None else (
        "stories:\n  - id: s1\n    title: S1\n"
    )
    (epic_dir / "epic.yaml").write_text(
        f"name: demo\n{stories_block}", encoding="utf-8"
    )
    if story_body is not None:
        (epic_dir / "stories" / "s1.yaml").write_text(
            textwrap.dedent(story_body).strip() + "\n", encoding="utf-8"
        )
    return epic_dir


_GOOD_STORY = """
    id: s1
    title: S1
    acceptance_criteria:
      - "Given x, when y, then z"
    steps:
      - id: implement
        agent: developer
"""


def test_valid_plan_output_passes(tmp_path):
    epic_dir = _make_epic(tmp_path, story_body=_GOOD_STORY)
    assert validate_plan_output(epic_dir) == []


def test_missing_epic_yaml_fails(tmp_path):
    # empty dir == self-report-only (agent claimed success, committed nothing)
    errors = validate_plan_output(tmp_path / "epics" / "nope")
    assert errors and "nothing committed" in errors[0]


def test_empty_stories_list_fails(tmp_path):
    epic_dir = _make_epic(tmp_path, story_body=_GOOD_STORY, stories_field="stories: []\n")
    errors = validate_plan_output(epic_dir)
    assert any("non-empty list" in e for e in errors)


def test_missing_story_file_fails(tmp_path):
    # epic references s1 but no s1.yaml on disk
    epic_dir = _make_epic(tmp_path, story_body=None)
    errors = validate_plan_output(epic_dir)
    assert any("file not found" in e for e in errors)


def test_story_missing_acceptance_criteria_fails(tmp_path):
    bad = """
    id: s1
    title: S1
    steps:
      - id: implement
        agent: developer
    """
    epic_dir = _make_epic(tmp_path, story_body=bad)
    errors = validate_plan_output(epic_dir)
    assert any("acceptance_criteria" in e for e in errors)


def test_malformed_story_yaml_raises(tmp_path):
    epic_dir = _make_epic(tmp_path, story_body=None)
    (epic_dir / "stories" / "s1.yaml").write_text("id: s1\n: : bad\n", encoding="utf-8")
    with pytest.raises(OutputValidationError, match="malformed YAML"):
        validate_plan_output(epic_dir)


def test_unknown_target_raises():
    with pytest.raises(OutputValidationError, match="unknown validation target"):
        validate("bogus")


def test_not_implemented_target_raises():
    with pytest.raises(OutputValidationError, match="not implemented"):
        validate("execute", epic_dir="ignored")


def test_cli_exit_codes(tmp_path, capsys):
    good = _make_epic(tmp_path, story_body=_GOOD_STORY)
    assert main(["--target", "plan-epic", "--epic-dir", str(good)]) == 0
    bad = tmp_path / "epics" / "missing"
    assert main(["--target", "plan-epic", "--epic-dir", str(bad)]) == 1
