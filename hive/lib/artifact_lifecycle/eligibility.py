"""Terminal eligibility helpers for artifact lifecycle (D3 design decision).

Two terminal signals for tracked artifacts:
  1. Primary — /ship-written: YAML has status==shipped AND release_id present.
  2. Legacy  — merged+age: feature branch merged to default branch AND artifact
     older than the class retention threshold.

The action for eligible artifacts still obeys D1/D2:
  untracked → evict  (move-to-temp)
  tracked   → report (list only; no git rm this epic)
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class TerminalEligibility:
    """Result of a terminal eligibility check for one artifact."""

    eligible: bool
    signal: str  # "shipped" | "merged-and-aged" | "none"


def is_shipped(yaml_dict: dict) -> bool:
    """True if YAML carries the /ship-written terminal signal.

    Requires both ``status == "shipped"`` AND a non-empty ``release_id``.
    Advisory non-shipped status (e.g. ``done``, ``pending``) is not sufficient.
    """
    return yaml_dict.get("status") == "shipped" and bool(yaml_dict.get("release_id"))


def is_branch_merged_to_default(
    repo_root: Path,
    feature_branch: str,
    default_branch: str = "main",
) -> bool:
    """True if *feature_branch* is merged into *default_branch* in *repo_root*.

    Queries remote-tracking refs so the result is correct even when the local
    branch has been deleted after merging.  Returns False on any git error to
    keep the signal conservative (never evict on ambiguity).
    """
    try:
        result = subprocess.run(
            ["git", "branch", "-r", "--merged", f"origin/{default_branch}"],
            capture_output=True,
            text=True,
            cwd=repo_root,
            timeout=15,
        )
    except Exception:
        return False

    if result.returncode != 0:
        return False

    target = f"origin/{feature_branch}"
    for line in result.stdout.splitlines():
        if line.strip() == target:
            return True
    return False


def check_terminal_eligibility(
    yaml_dict: dict | None,
    repo_root: Path | None,
    feature_branch: str | None,
    age_days: float,
    threshold_days: int,
    default_branch: str = "main",
) -> TerminalEligibility:
    """Return terminal eligibility for one artifact.

    Evaluates the primary shipped signal first, then the legacy merged+age
    signal.  Either passing signal makes the artifact eligible.

    Args:
        yaml_dict:       Parsed YAML content of the artifact file.  None → no
                         shipped signal (advisory checks skipped).
        repo_root:       Repository root used for git merge queries.  None →
                         legacy signal cannot fire.
        feature_branch:  Feature branch to check against *default_branch*.  None
                         → legacy signal cannot fire.
        age_days:        Artifact age in days (from age_source per D5).
        threshold_days:  Retention threshold for this registry class.
        default_branch:  Branch that candidates must be merged into.

    Returns:
        :class:`TerminalEligibility` with ``eligible=True`` and the matching
        signal name, or ``eligible=False`` with ``signal="none"``.
    """
    # Primary: /ship-written signal.
    if yaml_dict and is_shipped(yaml_dict):
        return TerminalEligibility(eligible=True, signal="shipped")

    # Legacy: merged-to-default + age.
    if feature_branch and repo_root:
        if is_branch_merged_to_default(repo_root, feature_branch, default_branch):
            if age_days >= threshold_days:
                return TerminalEligibility(eligible=True, signal="merged-and-aged")

    return TerminalEligibility(eligible=False, signal="none")


__all__ = [
    "TerminalEligibility",
    "check_terminal_eligibility",
    "is_branch_merged_to_default",
    "is_shipped",
]
