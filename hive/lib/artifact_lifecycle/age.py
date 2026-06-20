"""Age-source helpers for artifact lifecycle (D5).

D5: untracked artifacts use filesystem mtime; tracked use git last-commit date.
Extracted from planner.py so callers and tests can reference them directly.
"""

from __future__ import annotations

import subprocess
from datetime import datetime, timezone
from pathlib import Path


def mtime_age_days(path: Path, now: datetime) -> float:
    """Return age in days based on filesystem mtime."""
    mtime = path.stat().st_mtime
    mtime_dt = datetime.fromtimestamp(mtime, tz=timezone.utc)
    return (now - mtime_dt).total_seconds() / 86400.0


def git_commit_age_days(path: Path, repo_root: Path | None, now: datetime) -> float:
    """Return age in days using git last-commit date, falling back to mtime (D5).

    Falls back to mtime when repo_root is None, git is unavailable, or the path
    has no commit history.
    """
    if repo_root is not None:
        try:
            # git log runs with cwd=repo_root, so the pathspec must be
            # repo-relative. An absolute path (allowed when state_dir lives
            # outside the repo) is treated as an out-of-tree pathspec and
            # exits 128, silently falling back to mtime and breaking D5.
            try:
                pathspec = str(path.resolve().relative_to(repo_root.resolve()))
            except ValueError:
                pathspec = str(path)
            result = subprocess.run(
                ["git", "log", "-1", "--format=%ct", "--", pathspec],
                capture_output=True,
                text=True,
                cwd=repo_root,
                timeout=10,
            )
            if result.returncode == 0 and result.stdout.strip():
                ts = float(result.stdout.strip())
                commit_dt = datetime.fromtimestamp(ts, tz=timezone.utc)
                return (now - commit_dt).total_seconds() / 86400.0
        except Exception:
            pass
    return mtime_age_days(path, now)


__all__ = ["git_commit_age_days", "mtime_age_days"]
