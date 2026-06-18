"""CLI entrypoint for the artifact lifecycle sweep.

Usage: python -m hive.lib.artifact_lifecycle [--dry-run] [--class <id>] [--apply]

Flags:
  --dry-run           Print planned evict actions; move nothing.
  --apply             Execute eviction (move artifacts to OS temp).
  --class CLASS_ID    Restrict sweep to matching class_id(s); may repeat.
                      Unknown class IDs exit non-zero.

When neither --dry-run nor --apply is passed the CLI reports planned candidates
without executing them (same as --dry-run for display purposes, but labelled
"report" to distinguish the intent).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .executor import EvictRecord, apply_evict
from .executor import dry_run as executor_dry_run
from .planner import EvictCandidate, plan_candidates
from .registry import ArchiveAction, RegistryEntry, load_registry

# ---------------------------------------------------------------------------
# Built-in registry
# ---------------------------------------------------------------------------
# Conservative defaults per design-decisions §open-question-rulings:
#   30d  DAG runs, interrupts
#   60d  metrics streams
#   90d  context snapshots, staged insights, scratch, Chroma sidecars
# ---------------------------------------------------------------------------

_BUILTIN_REGISTRY_RAW: list[dict] = [
    {
        "class_id": "dag-run-state",
        "globs": ["runs/*"],
        "classification": "untracked",
        "active_predicate": "dag-run-active",
        "retention_threshold": 30,
        "archive_action": "evict",
        "age_source": "mtime",
        "hard_exclude": False,
    },
    {
        "class_id": "metrics-stop-stream",
        "globs": ["metrics/events/stop-*.jsonl"],
        "classification": "untracked",
        "active_predicate": "metrics-stream-not-consumed",
        "retention_threshold": 60,
        "archive_action": "evict",
        "age_source": "mtime",
        "hard_exclude": False,
    },
    {
        "class_id": "metrics-spawn-stream",
        "globs": ["metrics/events/spawn-*.jsonl"],
        "classification": "untracked",
        "active_predicate": "metrics-stream-not-consumed",
        "retention_threshold": 60,
        "archive_action": "evict",
        "age_source": "mtime",
        "hard_exclude": False,
    },
    {
        "class_id": "interrupt-record",
        "globs": ["interrupts/*.yaml"],
        "classification": "untracked",
        "active_predicate": "interrupt-not-acknowledged",
        "retention_threshold": 30,
        "archive_action": "evict",
        "age_source": "mtime",
        "hard_exclude": False,
    },
    {
        "class_id": "staged-insight",
        "globs": ["insights/**/*.md"],
        "classification": "untracked",
        "active_predicate": "insight-staged",
        "retention_threshold": 90,
        "archive_action": "evict",
        "age_source": "mtime",
        "hard_exclude": False,
    },
    {
        "class_id": "context-snapshot",
        "globs": ["context-snapshot.json"],
        "classification": "untracked",
        "active_predicate": "never-active",
        "retention_threshold": 90,
        "archive_action": "evict",
        "age_source": "mtime",
        "hard_exclude": False,
    },
    {
        "class_id": "scratch-output",
        "globs": ["scratch/**"],
        "classification": "untracked",
        "active_predicate": "never-active",
        "retention_threshold": 90,
        "archive_action": "evict",
        "age_source": "mtime",
        "hard_exclude": False,
    },
]


def _builtin_registry() -> list[RegistryEntry]:
    return load_registry(_BUILTIN_REGISTRY_RAW)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


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

    # Resolve state dir: HIVE_STATE_DIR env > resolved config > default .pHive
    try:
        from hive.lib.config import resolve_state_dir  # type: ignore
    except ImportError:
        state_dir = Path.cwd() / ".pHive"
    else:
        try:
            state_dir = Path(resolve_state_dir(cwd=Path.cwd(), env=dict(os.environ)))
        except Exception as err:
            print(
                f"artifact-lifecycle: failed to resolve state dir: {err}",
                file=sys.stderr,
            )
            return 1

    # Load registry and apply class filter.
    registry = _builtin_registry()
    requested_classes = args.artifact_class or []

    if requested_classes:
        known_ids = {e.class_id for e in registry}
        unknown = [c for c in requested_classes if c not in known_ids]
        if unknown:
            print(
                f"artifact-lifecycle: unknown class id(s): {unknown}",
                file=sys.stderr,
            )
            print(
                f"artifact-lifecycle: known classes: {sorted(known_ids)}",
                file=sys.stderr,
            )
            return 1
        registry = [e for e in registry if e.class_id in set(requested_classes)]

    # Plan candidates.
    candidates = plan_candidates(registry, state_dir)

    if not candidates:
        mode = "apply" if args.apply else ("dry-run" if args.dry_run else "report")
        print(f"artifact-lifecycle: no candidates found (mode={mode})")
        return 0

    # Execute or report.
    if args.apply:
        records = apply_evict(candidates)
        for rec in records:
            print(f"evicted  {rec.source} -> {rec.dest}")
        print(f"artifact-lifecycle: evicted {len(records)} artifact(s)")
    else:
        records = executor_dry_run(candidates)
        label = "dry-run" if args.dry_run else "report"
        for rec in records:
            print(f"would evict  {rec.source} -> {rec.dest}")
        print(f"artifact-lifecycle: {len(records)} candidate(s) [{label}]")

    return 0


if __name__ == "__main__":
    sys.exit(main())
