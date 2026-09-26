"""Completion-record detector (story wr-1-completion-record-detector).

Post-grill reframe (see .pHive/epics/wfd-retro-hardening/docs/design-discussion.md
sec 0b): completion of a Hive story is the orchestrator writing files — there is
no tool boundary a SubagentStop/Stop hook can intercept, so this module cannot be
a gate that refuses. It is a DETECTOR: it inspects, at SubagentStop/Stop time,
whether the current epic/story has a standard process record (episode markers per
step, OR a schema-conformant cycle-state persona_dispatch+verdict block) and
returns loud, specific warnings when it is missing or malformed. It never raises
to block the caller — the hook entrypoint always exits 0.

Two conditions are detected:
  - E2 gap: an epic with a stories/ directory but no cycle-state file, or a
    cycle-state file that fails to parse as a conformant document.
  - Missing/malformed story record: a story (declared in the epic's stories/
    specs, or already dispatched under episodes/) has no episode directory,
    an empty one, or a marker that doesn't satisfy the base four-field schema
    (episode-schema.md) or one of the recognized completion dialects
    (multica-run.yaml doc/verdict|code-push; a persona_dispatch+verdict block
    such as cc-workflows-run.yaml/dag-run.yaml `agents: [{persona, verdict}, ...]`).
    Field values are type/enum-checked, not just key presence. A story with no
    episode directory at all is still accepted via a conformant cycle-state
    `persona_dispatch.<story_id>.agents: [{persona, verdict}, ...]` alternative
    record; a malformed one (present but invalid) warns instead of silently
    passing.
"""

from __future__ import annotations

import os
import re
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from hive.lib.config import resolve_state_dir

_BASE_MARKER_FIELDS = ("step_id", "status", "timestamp", "artifacts")
_MULTICA_REQUIRED_FIELDS = (
    "completion_kind",
    "artifacts_committed",
    "episode_terminal",
    "requires_code_push_sha",
    "code_push_sha",
    "terminal_by_dialect",
    "issue_id",
    "issue_identifier",
)
# episode-schema.md base dialect enum (episode-schema.md:28) — exactly these
# three values, no derived/legacy vocabulary.
_BASE_STATUS_ENUM = ("completed", "failed", "escalated")
_MULTICA_COMPLETION_KIND_ENUM = ("doc-verdict", "code-push")
# persona_dispatch / agents[] dialect verdict enum, per the "Persona dispatch
# alternative completion record" section of cycle-state-schema.md.
_AGENTS_VERDICT_ENUM = ("pass", "fail", "needs-revision")


def _is_iso_timestamp(value: Any) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        datetime.fromisoformat(value)
    except ValueError:
        return False
    return True


def _is_nonempty_str(value: Any) -> bool:
    return isinstance(value, str) and bool(value)


def resolve_epic_id_from_branch(cwd: str | os.PathLike[str]) -> str | None:
    """Best-effort epic_id derivation from the current git branch name.

    Matches the epic-branch convention used throughout Hive (e.g.
    `feat/wfd-retro-hardening` -> `wfd-retro-hardening`). Returns None when the
    branch can't be read or doesn't match — callers must treat that as the
    documented trivial-direct exemption (no-op, not a warning).
    """
    try:
        result = subprocess.run(
            ["git", "-C", str(cwd), "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except Exception:
        return None
    if result.returncode != 0:
        return None
    branch = result.stdout.strip()
    match = re.match(r"^(?:feat|fix|release)/(.+)$", branch)
    if not match:
        return None
    return match.group(1)


def _load_yaml(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as handle:
            return yaml.safe_load(handle)
    except Exception:
        return None


def _agents_dialect_invalid_fields(agents: list[Any]) -> list[str]:
    """Type/enum-check a persona_dispatch `agents: [{persona, verdict}, ...]` list."""
    if not agents:
        return ["agents[] (empty)"]
    for entry in agents:
        if not (
            isinstance(entry, dict)
            and _is_nonempty_str(entry.get("persona"))
            and entry.get("verdict") in _AGENTS_VERDICT_ENUM
        ):
            return ["agents[].persona/verdict"]
    return []


def _base_marker_invalid_fields(marker: dict[str, Any]) -> list[str]:
    """Type/enum-check a base four-field episode-schema marker (episode-schema.md)."""
    invalid: list[str] = []
    if not _is_nonempty_str(marker.get("step_id")):
        invalid.append("step_id")
    if marker.get("status") not in _BASE_STATUS_ENUM:
        invalid.append("status")
    if not _is_iso_timestamp(marker.get("timestamp")):
        invalid.append("timestamp")
    artifacts = marker.get("artifacts")
    if not isinstance(artifacts, list) or not all(
        isinstance(a, str) for a in artifacts
    ):
        invalid.append("artifacts")
    return invalid


def _multica_marker_invalid_fields(marker: dict[str, Any]) -> list[str]:
    """Type/enum-check the multica-run.yaml doc/verdict|code-push dialect."""
    invalid: list[str] = []
    if marker.get("completion_kind") not in _MULTICA_COMPLETION_KIND_ENUM:
        invalid.append("completion_kind")
    for field in (
        "artifacts_committed",
        "episode_terminal",
        "requires_code_push_sha",
        "terminal_by_dialect",
    ):
        if not isinstance(marker.get(field), bool):
            invalid.append(field)
    code_push_sha = marker.get("code_push_sha")
    if code_push_sha is not None and not _is_nonempty_str(code_push_sha):
        invalid.append("code_push_sha")
    if not _is_nonempty_str(marker.get("issue_id")):
        invalid.append("issue_id")
    if not _is_nonempty_str(marker.get("issue_identifier")):
        invalid.append("issue_identifier")
    return invalid


def _marker_invalid_fields(marker: dict[str, Any]) -> list[str]:
    """Return the fields missing or malformed on a marker, or [] if conformant.

    A marker is conformant under any one of three dialects (checked for key
    presence first, then type/enum correctness):
      - base four-field episode-schema marker
      - multica-run.yaml doc/verdict|code-push dialect
      - persona_dispatch+verdict block (`agents: [{persona, verdict}, ...]`,
        non-empty, every entry carrying both fields)
    """
    base_missing = [f for f in _BASE_MARKER_FIELDS if f not in marker]
    if not base_missing:
        return _base_marker_invalid_fields(marker)

    multica_missing = [f for f in _MULTICA_REQUIRED_FIELDS if f not in marker]
    if not multica_missing:
        return _multica_marker_invalid_fields(marker)

    agents = marker.get("agents")
    if isinstance(agents, list) and agents:
        return _agents_dialect_invalid_fields(agents)

    # No dialect's required keys are all present — report against the base
    # schema, the most common/expected dialect.
    return base_missing


def _cycle_state_invalid_fields(doc: Any, expected_epic_id: str) -> list[str]:
    """Type-check the top-level cycle-state document shape we rely on.

    Per cycle-state-schema.md:160-167, a conformant document requires
    `epic_id` (matching the epic being inspected — not just any non-empty
    string), `created`/`updated` (real ISO-8601 timestamps), and `decisions`
    (a list).
    """
    if not isinstance(doc, dict):
        return ["document (not a YAML mapping)"]
    invalid: list[str] = []
    epic_id = doc.get("epic_id")
    if not _is_nonempty_str(epic_id) or epic_id != expected_epic_id:
        invalid.append("epic_id")
    if not _is_iso_timestamp(doc.get("created")):
        invalid.append("created")
    if not _is_iso_timestamp(doc.get("updated")):
        invalid.append("updated")
    if not isinstance(doc.get("decisions"), list):
        invalid.append("decisions")
    return invalid


def _persona_dispatch_invalid_fields(entry: Any) -> list[str] | None:
    """Validate a cycle-state `persona_dispatch.<story_id>` alternative record.

    Returns None when the story has no persona_dispatch entry at all (caller
    falls back to the missing-episode-record path). Returns [] when the entry
    is conformant. Returns a non-empty list naming the invalid field(s)
    otherwise.
    """
    if entry is None:
        return None
    if not isinstance(entry, dict):
        return ["persona_dispatch entry (not a mapping)"]
    agents = entry.get("agents")
    if not isinstance(agents, list):
        return ["persona_dispatch.agents (missing or not a list)"]
    invalid = _agents_dialect_invalid_fields(agents)
    return [f"persona_dispatch.{f}" for f in invalid] if invalid else []


def _check_cycle_state_alt(
    epic_id: str,
    story_id: str,
    cycle_state_doc: dict[str, Any] | None,
) -> list[str] | None:
    """Validate the cycle-state persona_dispatch alternative record.

    Returns None when no entry exists for this story (caller must fall back to
    the episode-directory record), [] when the entry is conformant, or a
    non-empty list of warning strings when it is present but malformed.
    """
    persona_dispatch = (
        cycle_state_doc.get("persona_dispatch")
        if isinstance(cycle_state_doc, dict)
        else None
    )
    entry = (
        persona_dispatch.get(story_id) if isinstance(persona_dispatch, dict) else None
    )
    invalid = _persona_dispatch_invalid_fields(entry)
    if invalid is None:
        return None
    if invalid:
        return [
            f"epic={epic_id} story={story_id}: malformed cycle-state "
            f"alternative record ({', '.join(invalid)})"
        ]
    return []


def _check_story(
    epic_id: str,
    story_id: str,
    episodes_dir: Path,
    cycle_state_doc: dict[str, Any] | None,
) -> list[str]:
    story_dir = episodes_dir / epic_id / story_id
    alt = _check_cycle_state_alt(epic_id, story_id, cycle_state_doc)

    if not story_dir.is_dir():
        if alt is None:
            return [
                f"epic={epic_id} story={story_id}: no completion record found "
                f"(missing episode directory {story_dir})"
            ]
        return alt

    warnings: list[str] = []
    markers = sorted(story_dir.glob("*.yaml"))
    if not markers:
        warnings.append(
            f"epic={epic_id} story={story_id}: no completion record found "
            f"(empty episode directory {story_dir})"
        )
    else:
        any_terminal = False
        for marker_path in markers:
            marker = _load_yaml(marker_path)
            if not isinstance(marker, dict):
                warnings.append(
                    f"epic={epic_id} story={story_id}: malformed marker "
                    f"{marker_path.name} (not a YAML mapping)"
                )
                continue

            invalid = _marker_invalid_fields(marker)
            if invalid:
                warnings.append(
                    f"epic={epic_id} story={story_id}: malformed marker "
                    f"{marker_path.name} (invalid {', '.join(invalid)})"
                )
                continue

            status = marker.get("status")
            terminal_by_dialect = marker.get("terminal_by_dialect")
            agents = marker.get("agents")
            if status == "completed" or terminal_by_dialect is True:
                any_terminal = True
            elif isinstance(agents, list) and agents and all(
                isinstance(a, dict) and a.get("verdict") == "pass" for a in agents
            ):
                any_terminal = True

        if not any_terminal and not warnings:
            warnings.append(
                f"epic={epic_id} story={story_id}: completion record present but "
                f"no marker reached a terminal/passed state ({story_dir})"
            )

    if not warnings:
        # Episode directory alone is conformant — no need to consult the
        # cycle-state alternative.
        return []

    if alt == []:
        # Episode directory is missing/malformed, but the cycle-state
        # alternative record is independently conformant — silent per the
        # OR-fallback contract (both sources are evaluated independently).
        return []

    if alt:
        warnings.extend(alt)

    return warnings


def detect(epic_id: str, state_dir: Path) -> list[str]:
    """Run the detector for a single epic and return warning strings (possibly empty)."""
    warnings: list[str] = []

    cycle_state_path = state_dir / "cycle-state" / f"{epic_id}.yaml"
    epic_stories_dir = state_dir / "epics" / epic_id / "stories"
    cycle_state_doc: dict[str, Any] | None = None
    if epic_stories_dir.is_dir() and not cycle_state_path.is_file():
        warnings.append(
            f"epic={epic_id}: cycle-state missing (E2 gap) — expected "
            f"{cycle_state_path}"
        )
    elif cycle_state_path.is_file():
        loaded = _load_yaml(cycle_state_path)
        invalid = _cycle_state_invalid_fields(loaded, epic_id)
        if invalid:
            warnings.append(
                f"epic={epic_id}: malformed cycle-state {cycle_state_path.name} "
                f"(invalid {', '.join(invalid)})"
            )
        else:
            cycle_state_doc = loaded

    episodes_dir = state_dir / "episodes"
    epic_episodes_dir = episodes_dir / epic_id

    # Union of stories with an episode directory on disk and stories declared
    # in the epic's spec but never dispatched at all (the E2-shaped gap: a real
    # story with no episode directory whatsoever, not just an empty one).
    story_ids = set()
    if epic_episodes_dir.is_dir():
        story_ids.update(p.name for p in epic_episodes_dir.iterdir() if p.is_dir())
    if epic_stories_dir.is_dir():
        story_ids.update(p.stem for p in epic_stories_dir.glob("*.yaml"))

    if not story_ids:
        # Nothing dispatched or specified yet for this epic — not a detectable gap.
        return warnings

    for story_id in sorted(story_ids):
        warnings.extend(_check_story(epic_id, story_id, episodes_dir, cycle_state_doc))

    return warnings


def run(cwd: str | os.PathLike[str], env: dict[str, str]) -> list[str]:
    """Entry point used by the hook: resolve context, run the detector, return warnings."""
    epic_id = resolve_epic_id_from_branch(cwd)
    if not epic_id:
        return []
    state_dir = Path(resolve_state_dir(cwd=cwd, env=env))
    return detect(epic_id, state_dir)


__all__ = ["detect", "run", "resolve_epic_id_from_branch"]


def _main() -> int:
    cwd = os.environ.get("HIVE_DETECTOR_CWD") or os.getcwd()
    warnings = run(cwd=cwd, env=dict(os.environ))
    for warning in warnings:
        print(f"[warn] completion-record-detector: {warning}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
