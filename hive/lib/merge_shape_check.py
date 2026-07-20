"""Merge-shape check (story wr-2-ship-merge-shape-check).

/ship promotes a release branch (e.g. `develop`) into `main` via a single
promotion PR (skills/ship/SKILL.md step 6a) that the operator merges by hand,
then resumes /ship in finalize mode (step 6b) to cut the tag. Squash-merging
that promotion PR collapses every per-story commit into one, which is exactly
what destroyed trunk-visible rigor in the WFD campaign (E6-E8 were squashed).

This module reads real git state at 6b, before the tag is cut, and refuses
the release when a multi-story epic's commits did not survive as a real merge
(two-parent merge commit whose second-parent side still contains one commit
per story). Single-story epics and explicitly waived epics are exempt.

Deterministic by construction: no prose judgement, only `git log`/`git show`
history reachable from the merge commit.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

_STORY_COMMIT_PREFIX_RE = re.compile(r"^\[(?P<story_id>[^\]]+)\]")


@dataclass
class EpicMergeShapeResult:
    epic_id: str
    status: str  # "ok" | "squashed" | "exempt"
    reason: str
    story_ids: list[str] = field(default_factory=list)
    missing_story_ids: list[str] = field(default_factory=list)


class MergeShapeError(RuntimeError):
    """Raised when a merge commit fails the shape check and is not exempt."""


def _run_git(repo_root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo_root), *args],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def _merge_parents(repo_root: Path, merge_commit: str) -> list[str]:
    output = _run_git(repo_root, "rev-list", "--parents", "-n", "1", merge_commit)
    fields = output.split()
    return fields[1:]  # fields[0] is the commit itself


def _commit_subjects(repo_root: Path, rev_range: str) -> list[str]:
    output = _run_git(repo_root, "log", "--pretty=format:%s", rev_range)
    return [line for line in output.splitlines() if line]


def check_epic_merge_shape(
    repo_root: Path | str,
    epic_id: str,
    story_ids: list[str],
    merge_commit: str,
    waived: bool = False,
) -> EpicMergeShapeResult:
    """Check whether `merge_commit` preserved one commit per story for this epic.

    - Fewer than 2 stories, or `waived=True`: exempt, no git inspection needed.
    - Otherwise: `merge_commit` must be a real (>=2-parent) merge commit, and
      every story id in `story_ids` must have at least one commit reachable
      only from the merged-in side (`parent1..parent2`) whose subject starts
      with `[{story_id}]`.
    """
    repo_root = Path(repo_root)

    if waived:
        return EpicMergeShapeResult(
            epic_id=epic_id,
            status="exempt",
            reason="waived",
            story_ids=list(story_ids),
        )

    if len(story_ids) <= 1:
        return EpicMergeShapeResult(
            epic_id=epic_id,
            status="exempt",
            reason="single-story epic",
            story_ids=list(story_ids),
        )

    parents = _merge_parents(repo_root, merge_commit)
    if len(parents) < 2:
        return EpicMergeShapeResult(
            epic_id=epic_id,
            status="squashed",
            reason=(
                f"{merge_commit} has {len(parents)} parent(s); a squash merge "
                "collapses the promotion PR into a single commit instead of "
                "preserving one merge commit with two parents"
            ),
            story_ids=list(story_ids),
        )

    base_parent, merged_parent = parents[0], parents[1]
    subjects = _commit_subjects(repo_root, f"{base_parent}..{merged_parent}")
    seen_story_ids: set[str] = set()
    for subject in subjects:
        match = _STORY_COMMIT_PREFIX_RE.match(subject)
        if match:
            seen_story_ids.add(match.group("story_id"))

    missing = [story_id for story_id in story_ids if story_id not in seen_story_ids]
    if missing:
        return EpicMergeShapeResult(
            epic_id=epic_id,
            status="squashed",
            reason=(
                f"merge commit {merge_commit} is missing per-story commits for: "
                f"{', '.join(missing)} — history between {base_parent} and "
                f"{merged_parent} does not contain a commit tagged with each "
                "story id, consistent with a squash"
            ),
            story_ids=list(story_ids),
            missing_story_ids=missing,
        )

    return EpicMergeShapeResult(
        epic_id=epic_id,
        status="ok",
        reason="merge commit preserves a commit per story",
        story_ids=list(story_ids),
    )


def check_merge_shape(
    repo_root: Path | str,
    epics: list[dict],
    merge_commit: str,
) -> list[EpicMergeShapeResult]:
    """Run the check for every epic in the ship set against one merge commit.

    `epics` is a list of `{"epic_id": str, "story_ids": [str, ...], "waived": bool}`.
    Raises `MergeShapeError` if any epic fails; returns the full result list
    (including exempt/ok entries) when every epic passes.
    """
    results = [
        check_epic_merge_shape(
            repo_root,
            epic["epic_id"],
            epic["story_ids"],
            merge_commit,
            waived=bool(epic.get("waived", False)),
        )
        for epic in epics
    ]
    failures = [r for r in results if r.status == "squashed"]
    if failures:
        lines = [f"- {r.epic_id}: {r.reason}" for r in failures]
        raise MergeShapeError(
            "Ship refused: merge-shape check failed for one or more epics.\n"
            + "\n".join(lines)
            + "\nRe-merge the promotion PR with a merge commit (not squash), "
            "or record an explicit waive for the affected epic."
        )
    return results
