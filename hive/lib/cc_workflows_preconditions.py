"""Shared cc-workflows precondition helpers."""

from __future__ import annotations

import json
import os
import re
import sys

WORKTREE_RE = re.compile(r"\.claude/worktrees/[^/]+")


class PreconditionError(RuntimeError):
    """Structured worktree-isolation failure."""

    precondition_failed = True

    def __init__(self, cwd: str):
        super().__init__(
            "[cc-workflows] Worktree-isolation invariant violated.\n"
            "  Required: invocation cwd must contain /.claude/worktrees/<name>/\n"
            f"  Failing cwd: {cwd}\n"
            "  Fix: run this skill from a dedicated worktree checkout, e.g.\n"
            "       /Users/<you>/.claude/worktrees/<epic-name>/"
        )
        self.field_sources = {
            "worktree_isolation": {
                "source": "cwd", "value": cwd,
                "required_pattern": ".claude/worktrees/<name>/", "verdict": "fail",
            }
        }


def assert_worktree_isolation(cwd: str | None = None) -> None:
    cwd = cwd or os.getcwd()
    if not WORKTREE_RE.search(cwd):
        raise PreconditionError(cwd)


def main() -> int:
    request = json.load(sys.stdin) if not sys.stdin.isatty() else {}
    try:
        assert_worktree_isolation(request.get("cwd"))
        print(json.dumps({"ok": True}))
        return 0
    except PreconditionError as error:
        print(json.dumps({"ok": False, "error": str(error), "precondition_failed": True,
                          "field_sources": error.field_sources}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
