"""CLI entrypoint for the artifact lifecycle sweep.

Placeholder — flags defined, no sweep logic executed yet.
Usage: python -m hive.lib.artifact_lifecycle [--dry-run] [--class <id>] [--apply]
"""

from __future__ import annotations

import argparse
import sys


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="artifact-lifecycle",
        description="Hive artifact lifecycle sweep — identify and archive stale artifacts.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Print candidates without taking any action.",
    )
    parser.add_argument(
        "--class",
        dest="artifact_class",
        metavar="CLASS_ID",
        action="append",
        default=None,
        help="Restrict sweep to the given class_id(s). May be repeated.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        default=False,
        help="Execute archive actions (mutually exclusive with --dry-run).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.dry_run and args.apply:
        parser.error("--dry-run and --apply are mutually exclusive.")

    # Sweep logic lives in later stories; this is the wired-up CLI skeleton.
    mode = "apply" if args.apply else ("dry-run" if args.dry_run else "report")
    classes = args.artifact_class or []
    scope = f" classes={classes}" if classes else ""
    print(f"artifact-lifecycle: mode={mode}{scope} (sweep not yet implemented)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
