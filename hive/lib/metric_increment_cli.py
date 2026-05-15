"""CLI wrapper around meta-optimize metric registry counters.

Invocation:
    python3 -m hive.lib.metric_increment_cli \
        --counter kg_signal_findings_total --label cycle_id=<id> --by 1

This is for markdown-driven workflow seams. It exits 0 for registry errors so
prompt steps can run under `set -e` without turning observability into a hard
workflow dependency.
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path
from typing import Any


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="metric_increment_cli",
        description="Increment one registered meta-optimize counter.",
    )
    parser.add_argument("--counter", required=True)
    parser.add_argument(
        "--label",
        action="append",
        default=[],
        help="Counter label in name=value form. Repeat for multiple labels.",
    )
    parser.add_argument("--by", type=int, default=1)
    args = parser.parse_args(argv)

    labels = _parse_labels(args.label, parser)
    try:
        registry = _load_metric_registry()
        registry.increment_counter(args.counter, labels, by=args.by)
    except Exception:
        return 0
    return 0


def _parse_labels(raw_labels: list[str], parser: argparse.ArgumentParser) -> dict[str, str]:
    labels: dict[str, str] = {}
    for raw in raw_labels:
        if "=" not in raw:
            parser.error("--label must be in name=value form")
        key, value = raw.split("=", 1)
        if not key:
            parser.error("--label must include a non-empty name")
        labels[key] = value
    return labels


def _load_metric_registry() -> Any:
    registry_path = (
        Path(__file__).resolve().parents[2]
        / "skills"
        / "hive"
        / "skills"
        / "meta-optimize"
        / "metric_registry.py"
    )
    spec = importlib.util.spec_from_file_location(
        "hive_metric_registry_for_metric_increment_cli",
        registry_path,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("metric registry unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
