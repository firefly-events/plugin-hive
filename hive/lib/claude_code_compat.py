#!/usr/bin/env python3
"""Canonical Claude Code compatibility policy reader and version gate."""

from __future__ import annotations

import argparse
import json
import re
import sys
from itertools import zip_longest
from pathlib import Path
from typing import Sequence

POLICY_PATH = Path(__file__).resolve().parent.parent / "compatibility-policy.json"
_VERSION_RE = re.compile(r"^[0-9]+(?:\.[0-9]+)+$")


def load_policy(path: Path = POLICY_PATH) -> dict[str, object]:
    """Load and minimally validate the shipped compatibility policy."""
    policy = json.loads(path.read_text(encoding="utf-8"))
    minimum = policy.get("claude_code", {}).get("minimum_version")
    if not isinstance(minimum, str) or not _VERSION_RE.fullmatch(minimum):
        raise ValueError("compatibility policy has an invalid Claude Code minimum")
    return policy


def minimum_version() -> str:
    """Return the authoritative minimum supported Claude Code version."""
    return str(load_policy()["claude_code"]["minimum_version"])


def parse_version(output: str) -> tuple[int, ...] | None:
    """Parse the leading version token emitted by ``claude --version``."""
    tokens = output.strip().split()
    if not tokens or not _VERSION_RE.fullmatch(tokens[0]):
        return None
    return tuple(int(part) for part in tokens[0].split("."))


def version_at_least(current: Sequence[int], minimum: Sequence[int]) -> bool:
    """Compare numeric dotted versions without relying on host ``sort -V``."""
    for current_part, minimum_part in zip_longest(current, minimum, fillvalue=0):
        if current_part != minimum_part:
            return current_part > minimum_part
    return True


def check_claude_output(output: str) -> int:
    """Validate Claude Code output and emit the fail-loud host message."""
    minimum = minimum_version()
    current = parse_version(output)
    if current is None:
        print(
            "\n*** HIVE COULD NOT VERIFY THE CLAUDE CODE VERSION. "
            f"EXPECTED {minimum} OR NEWER. INSTALL OR UPDATE CLAUDE CODE, "
            "THEN RETRY. ***\n",
            file=sys.stderr,
        )
        return 1

    if not version_at_least(current, parse_version(minimum) or ()):
        rendered_current = ".".join(str(part) for part in current)
        print(
            f"\n*** HIVE REQUIRES CLAUDE CODE {minimum} OR NEWER "
            f"(FOUND {rendered_current}). RUN `claude update` BEFORE "
            "CONTINUING. ***\n",
            file=sys.stderr,
        )
        return 1
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("minimum")
    subparsers.add_parser("policy")
    check_parser = subparsers.add_parser("check")
    check_parser.add_argument("claude_version_output")
    args = parser.parse_args(argv)

    if args.command == "minimum":
        print(minimum_version())
        return 0
    if args.command == "policy":
        print(json.dumps(load_policy(), sort_keys=True))
        return 0
    return check_claude_output(args.claude_version_output)


if __name__ == "__main__":
    raise SystemExit(main())
