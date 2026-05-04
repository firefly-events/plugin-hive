"""NestingDetector — meta-meta-optimize co-existence policy.

Risk #5 mitigation. Git does not support nested worktrees; an inner
`/execute` invocation that ran from inside an outer worktree (e.g.,
`maintainer-skills/meta-meta-optimize/SKILL.md` already created one
at `.pHive/meta-team/worktrees/{cycle_id}/`) must REUSE the outer
worktree as its run worktree.

Detection idiom:
  * `git rev-parse --git-common-dir` returns the SHARED .git dir
    (always the main repo's `.git/`).
  * `git rev-parse --git-dir` returns the per-worktree `.git/worktrees/<name>`
    when invoked inside a worktree, OR the same shared `.git/` at the
    main repo root.
  * If the two differ, we are inside a worktree.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path


META_META_OPTIMIZE_WORKTREES_PREFIX = Path(".pHive") / "meta-team" / "worktrees"


def _git_capture(cwd: Path, *args: str) -> tuple[int, str]:
    result = subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode, result.stdout.strip()


def detect_outer_worktree(cwd: Path | None = None) -> Path | None:
    """Return the current worktree path if we're in one; None otherwise.

    Compares `--git-common-dir` and `--git-dir`. Equal → main repo
    root (no outer worktree). Different → we're in a worktree;
    return the cwd as the worktree path.
    """

    here = cwd or Path.cwd()
    rc1, common = _git_capture(here, "rev-parse", "--git-common-dir")
    rc2, gd = _git_capture(here, "rev-parse", "--git-dir")
    if rc1 != 0 or rc2 != 0:
        return None
    common_resolved = (here / common).resolve(strict=False)
    gd_resolved = (here / gd).resolve(strict=False)
    if common_resolved != gd_resolved:
        # We're inside a worktree. Return the worktree ROOT, not `here`
        # — `here` may be a nested subdirectory, and downstream callers
        # expect WorktreeDecision.path to be the actual checkout root.
        rc3, top = _git_capture(here, "rev-parse", "--show-toplevel")
        if rc3 == 0 and top:
            return Path(top).resolve(strict=False)
        return here
    return None


def _resolve_main_repo(cwd: Path) -> Path:
    """Return the main repo root, even when invoked from inside a worktree."""

    rc, common = _git_capture(cwd, "rev-parse", "--git-common-dir")
    if rc != 0:
        return cwd
    common_path = (cwd / common).resolve(strict=False)
    # `--git-common-dir` points at the main repo's `.git` directory
    # (or `.git/` for that repo). The repo root is one level up.
    if common_path.name == ".git":
        return common_path.parent
    return common_path


def is_meta_meta_optimize_worktree(path: Path, repo_root: Path | None = None) -> bool:
    """Whether `path` matches `<repo>/.pHive/meta-team/worktrees/<cycle>/`."""

    repo = (repo_root or Path.cwd()).resolve(strict=False)
    target = path.resolve(strict=False)
    try:
        rel = target.relative_to(repo)
    except ValueError:
        return False
    parts = rel.parts
    prefix = META_META_OPTIMIZE_WORKTREES_PREFIX.parts
    return len(parts) >= len(prefix) + 1 and parts[: len(prefix)] == prefix


@dataclass
class WorktreeDecision:
    """Result of `decide_run_worktree`."""

    path: Path
    owned_by_us: bool
    reused_outer: bool


def decide_run_worktree(
    run_id: str,
    repo_path: Path | None = None,
    runs_root: Path | None = None,
) -> WorktreeDecision:
    """Decide where the run executes and who owns its cleanup.

    * If we're inside a meta-meta-optimize outer worktree: reuse it,
      `owned_by_us=False` (outer skill owns cleanup).
    * Otherwise: report a fresh path under `<runs_root>/{run_id}/` with
      `owned_by_us=True`. The caller (WorktreeManager) does the actual
      `git worktree add`.
    """

    cwd = (repo_path or Path.cwd()).resolve(strict=False)
    main_repo = _resolve_main_repo(cwd)
    outer = detect_outer_worktree(cwd)
    if outer is not None and is_meta_meta_optimize_worktree(outer, repo_root=main_repo):
        return WorktreeDecision(path=outer, owned_by_us=False, reused_outer=True)
    runs_dir = runs_root if runs_root is not None else (main_repo / ".pHive" / "runs")
    return WorktreeDecision(
        path=Path(runs_dir) / run_id,
        owned_by_us=True,
        reused_outer=False,
    )


class NestingDetector:
    """Object surface for the same logic — convenience for walker wiring."""

    def __init__(self, repo_path: Path | None = None, runs_root: Path | None = None) -> None:
        self.repo_path = (repo_path or Path.cwd()).resolve(strict=False)
        self.runs_root = runs_root

    def decide(self, run_id: str) -> WorktreeDecision:
        return decide_run_worktree(
            run_id, repo_path=self.repo_path, runs_root=self.runs_root
        )
