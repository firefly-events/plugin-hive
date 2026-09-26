"""Tests for the wr-1 completion-record detector (hive/lib/completion_record_detector.py).

Covers the AC1/AC6 contract: missing record -> warning, present/conformant
record -> silence, malformed cycle-state/marker -> warning, and the E2-gap
(missing cycle-state file for an epic) detection.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from hive.lib.completion_record_detector import detect


def _write_yaml(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_missing_episode_directory_warns(tmp_path: Path) -> None:
    """A real story (declared in stories/ specs) with NO episode directory at
    all — not even an empty one — must be detected (the E2-shaped gap)."""
    epic_id = "demo-epic"
    _write_yaml(
        tmp_path / "epics" / epic_id / "stories" / "s1-story.yaml",
        "id: s1-story\n",
    )
    _write_yaml(tmp_path / "cycle-state" / f"{epic_id}.yaml", "epic_id: demo-epic\n")

    warnings = detect(epic_id, tmp_path)

    assert any("no completion record found" in w for w in warnings)
    assert not (tmp_path / "episodes" / epic_id / "s1-story").exists()


_CONFORMANT_CYCLE_STATE = """\
epic_id: demo-epic
created: "2026-07-19T00:00:00Z"
updated: "2026-07-19T00:05:00Z"
decisions: []
"""


def test_present_conformant_base_marker_is_silent(tmp_path: Path) -> None:
    epic_id = "demo-epic"
    (tmp_path / "epics" / epic_id / "stories").mkdir(parents=True)
    _write_yaml(
        tmp_path / "cycle-state" / f"{epic_id}.yaml", _CONFORMANT_CYCLE_STATE
    )
    _write_yaml(
        tmp_path / "episodes" / epic_id / "s1-story" / "integrate.yaml",
        """\
step_id: integrate
status: completed
timestamp: "2026-07-19T00:00:00Z"
artifacts: []
""",
    )

    warnings = detect(epic_id, tmp_path)

    assert warnings == []


def test_present_conformant_persona_dispatch_marker_is_silent(tmp_path: Path) -> None:
    epic_id = "demo-epic"
    (tmp_path / "epics" / epic_id / "stories").mkdir(parents=True)
    _write_yaml(
        tmp_path / "cycle-state" / f"{epic_id}.yaml", _CONFORMANT_CYCLE_STATE
    )
    _write_yaml(
        tmp_path / "episodes" / epic_id / "s1-story" / "cc-workflows-run.yaml",
        """\
agents:
  - phase: implement
    persona: developer
    verdict: pass
  - phase: review
    persona: reviewer
    verdict: pass
""",
    )

    warnings = detect(epic_id, tmp_path)

    assert warnings == []


def test_malformed_marker_warns(tmp_path: Path) -> None:
    epic_id = "demo-epic"
    (tmp_path / "epics" / epic_id / "stories").mkdir(parents=True)
    _write_yaml(tmp_path / "cycle-state" / f"{epic_id}.yaml", "epic_id: demo-epic\n")
    _write_yaml(
        tmp_path / "episodes" / epic_id / "s1-story" / "integrate.yaml",
        """\
status: completed
""",
    )

    warnings = detect(epic_id, tmp_path)

    assert any("malformed marker" in w for w in warnings)


def test_missing_cycle_state_is_e2_gap_warning(tmp_path: Path) -> None:
    epic_id = "demo-epic"
    (tmp_path / "epics" / epic_id / "stories").mkdir(parents=True)

    warnings = detect(epic_id, tmp_path)

    assert any("cycle-state missing (E2 gap)" in w for w in warnings)


def test_no_epic_dir_is_silent(tmp_path: Path) -> None:
    warnings = detect("nonexistent-epic", tmp_path)

    assert warnings == []


def test_malformed_cycle_state_warns(tmp_path: Path) -> None:
    epic_id = "demo-epic"
    (tmp_path / "epics" / epic_id / "stories").mkdir(parents=True)
    # epic_id must be a non-empty string; an int is a bad field type.
    _write_yaml(tmp_path / "cycle-state" / f"{epic_id}.yaml", "epic_id: 12345\n")

    warnings = detect(epic_id, tmp_path)

    assert any("malformed cycle-state" in w for w in warnings)


def test_cycle_state_only_persona_dispatch_is_silent(tmp_path: Path) -> None:
    """A story with no episode directory at all is still accepted when the
    cycle-state doc carries a conformant persona_dispatch alternative record."""
    epic_id = "demo-epic"
    _write_yaml(
        tmp_path / "epics" / epic_id / "stories" / "s1-story.yaml",
        "id: s1-story\n",
    )
    _write_yaml(
        tmp_path / "cycle-state" / f"{epic_id}.yaml",
        """\
epic_id: demo-epic
created: "2026-07-19T00:00:00Z"
updated: "2026-07-19T00:05:00Z"
decisions:
  - phase: research
    key: rendering_engine
    value: "Compose Multiplatform"
    rationale: "KMP project"
    timestamp: "2026-07-19T00:01:00Z"
persona_dispatch:
  s1-story:
    agents:
      - persona: developer
        verdict: pass
""",
    )

    warnings = detect(epic_id, tmp_path)

    assert warnings == []
    assert not (tmp_path / "episodes" / epic_id / "s1-story").exists()


def test_malformed_cycle_state_persona_dispatch_warns(tmp_path: Path) -> None:
    epic_id = "demo-epic"
    _write_yaml(
        tmp_path / "epics" / epic_id / "stories" / "s1-story.yaml",
        "id: s1-story\n",
    )
    _write_yaml(
        tmp_path / "cycle-state" / f"{epic_id}.yaml",
        """\
epic_id: demo-epic
persona_dispatch:
  s1-story:
    agents:
      - persona: developer
""",
    )

    warnings = detect(epic_id, tmp_path)

    assert any("malformed cycle-state" in w for w in warnings)


def test_empty_episode_dir_with_conformant_cycle_state_is_silent(
    tmp_path: Path,
) -> None:
    """AC1 OR-fallback: an episode directory that exists but is EMPTY must
    still fall back to a conformant cycle-state persona_dispatch record
    instead of warning immediately."""
    epic_id = "demo-epic"
    (tmp_path / "epics" / epic_id / "stories").mkdir(parents=True)
    (tmp_path / "episodes" / epic_id / "s1-story").mkdir(parents=True)
    _write_yaml(
        tmp_path / "cycle-state" / f"{epic_id}.yaml",
        """\
epic_id: demo-epic
created: "2026-07-19T00:00:00Z"
updated: "2026-07-19T00:05:00Z"
decisions:
  - phase: research
    key: rendering_engine
    value: "Compose Multiplatform"
    rationale: "KMP project"
    timestamp: "2026-07-19T00:01:00Z"
persona_dispatch:
  s1-story:
    agents:
      - persona: developer
        verdict: pass
""",
    )

    warnings = detect(epic_id, tmp_path)

    assert warnings == []


def test_malformed_episode_marker_with_conformant_cycle_state_is_silent(
    tmp_path: Path,
) -> None:
    """AC1 OR-fallback: a non-conformant episode marker must still fall back
    to a conformant cycle-state persona_dispatch record instead of warning."""
    epic_id = "demo-epic"
    (tmp_path / "epics" / epic_id / "stories").mkdir(parents=True)
    _write_yaml(
        tmp_path / "episodes" / epic_id / "s1-story" / "integrate.yaml",
        "status: completed\n",  # missing step_id/timestamp/artifacts
    )
    _write_yaml(
        tmp_path / "cycle-state" / f"{epic_id}.yaml",
        """\
epic_id: demo-epic
created: "2026-07-19T00:00:00Z"
updated: "2026-07-19T00:05:00Z"
decisions:
  - phase: research
    key: rendering_engine
    value: "Compose Multiplatform"
    rationale: "KMP project"
    timestamp: "2026-07-19T00:01:00Z"
persona_dispatch:
  s1-story:
    agents:
      - persona: developer
        verdict: pass
""",
    )

    warnings = detect(epic_id, tmp_path)

    assert warnings == []


def test_empty_episode_dir_with_non_conformant_cycle_state_still_warns(
    tmp_path: Path,
) -> None:
    """Both sources evaluated independently: if NEITHER is conformant, warn."""
    epic_id = "demo-epic"
    (tmp_path / "epics" / epic_id / "stories").mkdir(parents=True)
    (tmp_path / "episodes" / epic_id / "s1-story").mkdir(parents=True)
    _write_yaml(tmp_path / "cycle-state" / f"{epic_id}.yaml", "epic_id: demo-epic\n")

    warnings = detect(epic_id, tmp_path)

    assert any("no completion record found" in w for w in warnings)


def test_undocumented_status_value_warns_on_status_field(tmp_path: Path) -> None:
    """episode-schema.md:28 status enum is exactly completed|failed|escalated —
    an undocumented value like `passed` must be rejected, not accepted."""
    epic_id = "demo-epic"
    (tmp_path / "epics" / epic_id / "stories").mkdir(parents=True)
    _write_yaml(tmp_path / "cycle-state" / f"{epic_id}.yaml", "epic_id: demo-epic\n")
    _write_yaml(
        tmp_path / "episodes" / epic_id / "s1-story" / "integrate.yaml",
        """\
step_id: integrate
status: passed
timestamp: "2026-07-19T00:00:00Z"
artifacts: []
""",
    )

    warnings = detect(epic_id, tmp_path)

    assert any("invalid status" in w for w in warnings)


def test_undocumented_verdict_value_warns_on_verdict_field(tmp_path: Path) -> None:
    epic_id = "demo-epic"
    (tmp_path / "epics" / epic_id / "stories").mkdir(parents=True)
    _write_yaml(tmp_path / "cycle-state" / f"{epic_id}.yaml", "epic_id: demo-epic\n")
    _write_yaml(
        tmp_path / "episodes" / epic_id / "s1-story" / "cc-workflows-run.yaml",
        """\
agents:
  - persona: developer
    verdict: approved
""",
    )

    warnings = detect(epic_id, tmp_path)

    assert any("invalid agents[].persona/verdict" in w for w in warnings)


def test_impossible_timestamp_warns_on_timestamp_field(tmp_path: Path) -> None:
    epic_id = "demo-epic"
    (tmp_path / "epics" / epic_id / "stories").mkdir(parents=True)
    _write_yaml(tmp_path / "cycle-state" / f"{epic_id}.yaml", "epic_id: demo-epic\n")
    _write_yaml(
        tmp_path / "episodes" / epic_id / "s1-story" / "integrate.yaml",
        """\
step_id: integrate
status: completed
timestamp: "2026-99-99T99:99:99Z"
artifacts: []
""",
    )

    warnings = detect(epic_id, tmp_path)

    assert any("invalid timestamp" in w for w in warnings)


def test_malformed_cycle_state_persona_dispatch_verdict_warns(tmp_path: Path) -> None:
    """The cycle-state alternative record's verdict must also be enum-checked."""
    epic_id = "demo-epic"
    _write_yaml(
        tmp_path / "epics" / epic_id / "stories" / "s1-story.yaml",
        "id: s1-story\n",
    )
    _write_yaml(
        tmp_path / "cycle-state" / f"{epic_id}.yaml",
        """\
epic_id: demo-epic
persona_dispatch:
  s1-story:
    agents:
      - persona: developer
        verdict: approved
""",
    )

    warnings = detect(epic_id, tmp_path)

    assert any("malformed cycle-state" in w for w in warnings)


def test_mismatched_epic_id_cycle_state_warns(tmp_path: Path) -> None:
    """epic_id must EXACTLY MATCH the epic being inspected, not just be a
    non-empty string — a cycle-state written for a different epic must warn,
    not be silently accepted."""
    epic_id = "demo-epic"
    (tmp_path / "epics" / epic_id / "stories").mkdir(parents=True)
    _write_yaml(
        tmp_path / "cycle-state" / f"{epic_id}.yaml",
        """\
epic_id: wrong-epic
created: "2026-07-19T00:00:00Z"
updated: "2026-07-19T00:05:00Z"
decisions: []
persona_dispatch:
  s1-story:
    agents:
      - persona: developer
        verdict: pass
""",
    )

    warnings = detect(epic_id, tmp_path)

    assert any("malformed cycle-state" in w and "epic_id" in w for w in warnings)


def test_cycle_state_missing_created_warns(tmp_path: Path) -> None:
    epic_id = "demo-epic"
    (tmp_path / "epics" / epic_id / "stories").mkdir(parents=True)
    _write_yaml(
        tmp_path / "cycle-state" / f"{epic_id}.yaml",
        """\
epic_id: demo-epic
updated: "2026-07-19T00:05:00Z"
decisions: []
""",
    )

    warnings = detect(epic_id, tmp_path)

    assert any("malformed cycle-state" in w and "created" in w for w in warnings)


def test_cycle_state_missing_updated_warns(tmp_path: Path) -> None:
    epic_id = "demo-epic"
    (tmp_path / "epics" / epic_id / "stories").mkdir(parents=True)
    _write_yaml(
        tmp_path / "cycle-state" / f"{epic_id}.yaml",
        """\
epic_id: demo-epic
created: "2026-07-19T00:00:00Z"
decisions: []
""",
    )

    warnings = detect(epic_id, tmp_path)

    assert any("malformed cycle-state" in w and "updated" in w for w in warnings)


def test_cycle_state_missing_decisions_warns(tmp_path: Path) -> None:
    epic_id = "demo-epic"
    (tmp_path / "epics" / epic_id / "stories").mkdir(parents=True)
    _write_yaml(
        tmp_path / "cycle-state" / f"{epic_id}.yaml",
        """\
epic_id: demo-epic
created: "2026-07-19T00:00:00Z"
updated: "2026-07-19T00:05:00Z"
""",
    )

    warnings = detect(epic_id, tmp_path)

    assert any("malformed cycle-state" in w and "decisions" in w for w in warnings)


def test_cycle_state_decisions_wrong_type_warns(tmp_path: Path) -> None:
    epic_id = "demo-epic"
    (tmp_path / "epics" / epic_id / "stories").mkdir(parents=True)
    _write_yaml(
        tmp_path / "cycle-state" / f"{epic_id}.yaml",
        """\
epic_id: demo-epic
created: "2026-07-19T00:00:00Z"
updated: "2026-07-19T00:05:00Z"
decisions: "not-a-list"
""",
    )

    warnings = detect(epic_id, tmp_path)

    assert any("malformed cycle-state" in w and "decisions" in w for w in warnings)


def test_hook_exits_zero_even_when_detector_exec_fails() -> None:
    """Fire-and-forget: the shell hook entrypoint always exits 0, even when the
    detector fails to load/execute (charter: hook is a thin shim, never a gate)."""
    repo_root = Path(__file__).resolve().parents[3]
    hook_path = repo_root / "hooks" / "completion-record-detect.sh"

    env = dict(os.environ)
    # Point HIVE_ROOT at a nonexistent path so the python3 invocation inside
    # the hook fails to find completion_record_detector.py and errors out.
    env["HIVE_ROOT"] = "/nonexistent-hive-root-for-test"

    result = subprocess.run(
        ["bash", str(hook_path)],
        input='{"cwd": "/nonexistent-cwd-for-test"}',
        capture_output=True,
        text=True,
        env=env,
        timeout=10,
        check=False,
    )

    assert result.returncode == 0
