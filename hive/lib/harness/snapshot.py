"""File-tree + git baseline snapshots at run boundaries.

The metrics substrate records tokens and wall-clock time, but nothing captures
the *shape* of the project — the brownfield "started with X files, X structure"
frame the whole journey story is told against. Once ``/kickoff`` (or any run)
mutates the tree, that starting state is unrecoverable: only before/after git
SHAs survive, never a file manifest.

This module captures a durable, diffable manifest of the tracked file tree plus
git identity, so a ``before`` (pre-kickoff baseline) and later ``after`` snapshot
can be diffed into files-added / structure-grown views for the renderer.

Stdlib only. Snapshots land under ``<state-dir>/harness/snapshots/<label>.json``.

CLI:
    python3 -m hive.lib.harness.snapshot --label kickoff-before
    python3 -m hive.lib.harness.snapshot --label design-system-after
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from hive.lib.config import resolve_state_dir
from hive.lib.metrics.core import _validate_relative_identifier


def _git(args: list[str], repo: Path) -> str:
    """Run a git command in ``repo``; return stripped stdout ('' on failure)."""
    try:
        out = subprocess.run(
            ["git", *args],
            cwd=str(repo),
            capture_output=True,
            text=True,
            check=True,
        )
        return out.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def _tracked_files(repo: Path) -> list[str]:
    """Repo-relative POSIX paths of all git-tracked files, sorted."""
    raw = _git(["ls-files"], repo)
    files = [line for line in raw.splitlines() if line]
    return sorted(files)


def _tree(paths: list[str]) -> dict[str, Any]:
    """Nested directory tree with per-node file counts, for mermaid rendering.

    Each node: {"files": <direct file count>, "total": <subtree file count>,
    "dirs": {name: node, ...}}.
    """
    root: dict[str, Any] = {"files": 0, "total": 0, "dirs": {}}
    for path in paths:
        parts = path.split("/")
        node = root
        node["total"] += 1
        for segment in parts[:-1]:
            child = node["dirs"].get(segment)
            if child is None:
                child = {"files": 0, "total": 0, "dirs": {}}
                node["dirs"][segment] = child
            child["total"] += 1
            node = child
        node["files"] += 1
    return root


def build_snapshot(label: str, repo: Path) -> dict[str, Any]:
    """Assemble a snapshot dict for ``label`` over the tracked tree of ``repo``."""
    files = _tracked_files(repo)
    by_top_dir = Counter(
        (p.split("/", 1)[0] if "/" in p else "(root)") for p in files
    )
    by_ext = Counter((Path(p).suffix or "(none)") for p in files)
    status = _git(["status", "--porcelain"], repo)

    return {
        "label": label,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "repo": str(repo),
        "git": {
            "sha": _git(["rev-parse", "HEAD"], repo),
            "branch": _git(["rev-parse", "--abbrev-ref", "HEAD"], repo),
            "dirty": bool(status),
        },
        "files": {
            "total": len(files),
            "by_top_dir": dict(by_top_dir.most_common()),
            "by_ext": dict(by_ext.most_common()),
            "list": files,
        },
        "tree": _tree(files),
    }


def diff_snapshots(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    """Diff two snapshot dicts into files added/removed + per-top-dir/ext deltas."""
    before_files = set(before["files"]["list"])
    after_files = set(after["files"]["list"])
    before_top_dir = before["files"]["by_top_dir"]
    after_top_dir = after["files"]["by_top_dir"]
    before_ext = before["files"]["by_ext"]
    after_ext = after["files"]["by_ext"]

    def _delta(before_counts: dict[str, int], after_counts: dict[str, int]) -> dict[str, int]:
        keys = set(before_counts) | set(after_counts)
        return {
            key: after_counts.get(key, 0) - before_counts.get(key, 0) for key in keys
        }

    return {
        "before_label": before["label"],
        "after_label": after["label"],
        "files_added": sorted(after_files - before_files),
        "files_removed": sorted(before_files - after_files),
        "by_top_dir_delta": _delta(before_top_dir, after_top_dir),
        "by_ext_delta": _delta(before_ext, after_ext),
    }


def load_snapshot(label: str, repo: Path | None = None) -> dict[str, Any]:
    """Load a persisted snapshot by label; raise if it was never captured."""
    _validate_relative_identifier(label, "label")
    repo = repo or Path.cwd()
    path = snapshot_dir(repo) / f"{label}.json"
    if not path.exists():
        raise FileNotFoundError(f"snapshot '{label}' not found at {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def diff_snapshot_files(
    before_label: str, after_label: str, repo: Path | None = None
) -> dict[str, Any]:
    """Load before/after snapshots by label and diff them."""
    before = load_snapshot(before_label, repo)
    after = load_snapshot(after_label, repo)
    return diff_snapshots(before, after)


def snapshot_dir(repo: Path) -> Path:
    """Resolve ``<state-dir>/harness/snapshots`` under ``repo``."""
    state_dir = resolve_state_dir(cwd=repo, env=os.environ)
    return Path(state_dir) / "harness" / "snapshots"


def write_snapshot(label: str, repo: Path | None = None) -> Path:
    """Capture and persist a snapshot; return the written path."""
    _validate_relative_identifier(label, "label")
    repo = repo or Path.cwd()
    snap = build_snapshot(label, repo)
    out_dir = snapshot_dir(repo)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{label}.json"
    out_path.write_text(json.dumps(snap, indent=2) + "\n", encoding="utf-8")
    return out_path


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--label",
        help="snapshot label, e.g. 'kickoff-before' or 'design-system-after'",
    )
    parser.add_argument(
        "--repo",
        default=None,
        help="repo root to snapshot (default: cwd)",
    )
    parser.add_argument(
        "--diff",
        nargs=2,
        metavar=("BEFORE_LABEL", "AFTER_LABEL"),
        help="diff two already-captured snapshots and print the result",
    )
    args = parser.parse_args(argv)
    repo = Path(args.repo).resolve() if args.repo else Path.cwd()

    if args.diff:
        before_label, after_label = args.diff
        diff = diff_snapshot_files(before_label, after_label, repo)
        print(json.dumps(diff, indent=2))
        return 0

    if not args.label:
        parser.error("--label is required unless --diff is used")

    out_path = write_snapshot(args.label, repo)
    snap = json.loads(out_path.read_text(encoding="utf-8"))
    files = snap["files"]
    print(f"snapshot '{args.label}' -> {out_path}")
    print(f"  git: {snap['git']['sha'][:12]} @ {snap['git']['branch']}"
          f" (dirty={snap['git']['dirty']})")
    print(f"  tracked files: {files['total']}")
    top = list(files["by_top_dir"].items())[:8]
    print("  top dirs: " + ", ".join(f"{k}={v}" for k, v in top))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
