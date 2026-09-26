"""Resolve Hive git-flow configuration.

The JSON stdin/stdout entrypoint is intentionally small and stable so skill
atoms can call this helper without embedding configuration logic.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

DEFAULT_GIT_FLOW = {"default_pr_base": "auto", "branch_strategy": "per-epic"}
VALID_STRATEGIES = {"per-epic", "per-story"}


def parse_git_flow_block(raw: str | None) -> dict[str, Any] | None:
    if not raw:
        return None
    in_block = False
    result: dict[str, Any] = {}
    for line in raw.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not in_block:
            if line.strip() == "git_flow:" or line.startswith("git_flow:"):
                in_block = True
            continue
        if line and not line[0].isspace():
            break
        stripped = line.strip()
        if ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        key = key.strip()
        if not key.replace("_", "").isalnum():
            continue
        value = value.split("#", 1)[0].strip().strip("'\"")
        if value in {"null", "~", ""}:
            result[key] = None
        elif value == "true":
            result[key] = True
        elif value == "false":
            result[key] = False
        else:
            result[key] = value
    return result if in_block else None


def _read_config(path: Path) -> dict[str, Any] | None:
    try:
        return parse_git_flow_block(path.read_text(encoding="utf-8")) if path.is_file() else None
    except OSError:
        return None


def _has_origin_develop(cwd: Path) -> bool:
    try:
        subprocess.run(
            ["git", "-C", str(cwd), "rev-parse", "--verify", "origin/develop"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        return True
    except (OSError, subprocess.CalledProcessError):
        return False


def resolve_git_flow(cwd: str | os.PathLike[str] | None = None) -> dict[str, Any]:
    root = Path(cwd or os.getcwd())
    candidates = [(root / "hive.config.yaml", "root"), (root / "hive" / "hive.config.yaml", "plugin")]
    baseline = Path(__file__).resolve().parent.parent / "hive.config.yaml"
    candidates.append((baseline, "plugin"))
    block = None
    source = "default"
    for path, candidate_source in candidates:
        block = _read_config(path)
        if block is not None:
            source = candidate_source
            break
    if block is None:
        block = dict(DEFAULT_GIT_FLOW)
    default_pr_base = block.get("default_pr_base") or DEFAULT_GIT_FLOW["default_pr_base"]
    strategy = block.get("branch_strategy")
    if strategy not in VALID_STRATEGIES:
        strategy = DEFAULT_GIT_FLOW["branch_strategy"]
    base = "develop" if default_pr_base == "auto" and _has_origin_develop(root) else (
        "main" if default_pr_base == "auto" else default_pr_base
    )
    return {"base_branch": base, "branch_strategy": strategy, "source": source}


def main() -> int:
    request = json.load(sys.stdin) if not sys.stdin.isatty() else {}
    print(json.dumps(resolve_git_flow(request.get("cwd"))))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
