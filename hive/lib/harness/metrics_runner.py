"""Orchestrate the /metrics command (skills/metrics/SKILL.md).

This module is the single executable helper the skill invokes for deliverable
resolution, collect + render, and summary formatting, so the summary shape the
skill promises can be exercised end-to-end (and asserted in tests) against the
real command path instead of re-implemented ad hoc by the skill prompt or a
test.

CLI:
    python3 -m hive.lib.harness.metrics_runner
    python3 -m hive.lib.harness.metrics_runner --deliverable design-system
    python3 -m hive.lib.harness.metrics_runner --deliverable design-system \
        --repo /path/to/repo --artifact-dir /tmp/hive-metrics.XXXX
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from hive.lib.harness.collect import collect_report
from hive.lib.harness.render import render

# (summary table label, report["tokens"] key) pairs, in the order
# skills/metrics/SKILL.md §3 documents.
_TOKEN_LABELS = (
    ("tokens.total", "total"),
    ("tokens.input", "input"),
    ("tokens.output", "output"),
    ("tokens.cache_read", "cache_read"),
    ("tokens.cache_creation", "cache_creation"),
)

NO_ACTIVE_EPIC_MESSAGE = "No metrics yet. Run a Hive workflow, then run /metrics <deliverable>."


class DeliverableResolutionError(Exception):
    """Raised with the exact user-facing message when resolution fails."""


def _epics_with_epic_yaml(repo: Path) -> list[str]:
    root = repo / ".pHive" / "epics"
    if not root.is_dir():
        return []
    return sorted(p.name for p in root.iterdir() if p.is_dir() and (p / "epic.yaml").is_file())


def _current_branch(repo: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=repo,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return None
    if result.returncode != 0:
        return None
    branch = result.stdout.strip()
    return branch or None


def resolve_deliverable(arg: str | None, repo: Path) -> str:
    """Resolve the deliverable id per skills/metrics/SKILL.md §1.

    Raises ``DeliverableResolutionError`` with the exact message the skill
    documents when an explicit id is malformed, more than one epic is active,
    or none is.
    """
    if arg is not None:
        if "/" in arg or "\\" in arg or ".." in arg or any(ch.isspace() for ch in arg):
            raise DeliverableResolutionError(
                f"deliverable id must not contain path separators, '..', or whitespace: {arg!r}"
            )
        return arg

    swarm_id = os.environ.get("HIVE_SWARM_ID")
    if swarm_id:
        return swarm_id

    candidates = _epics_with_epic_yaml(repo)

    branch = _current_branch(repo)
    if branch:
        branch_leaf = branch.rsplit("/", 1)[-1]
        if branch_leaf in candidates:
            return branch_leaf

    if len(candidates) > 1:
        joined = ", ".join(candidates)
        raise DeliverableResolutionError(
            f"More than one active epic: {joined}. Run /metrics <deliverable>."
        )
    if len(candidates) == 1:
        return candidates[0]

    raise DeliverableResolutionError(NO_ACTIVE_EPIC_MESSAGE)


def format_summary(deliverable: str, report: dict[str, Any], dashboard_path: Path) -> str:
    """Render the exact stdout shape skills/metrics/SKILL.md §3 documents."""
    tokens = report.get("tokens") or {}
    wall_ms_total = report.get("wall_ms_total") or 0
    human_gate_ms_total = report.get("human_gate_ms_total") or 0
    gate_count = report.get("gate_count") or 0
    token_values = {key: tokens.get(key) or 0 for _, key in _TOKEN_LABELS}
    flow = report.get("flow") or []
    flow_str = (
        " -> ".join(str(step.get("step")) for step in flow if isinstance(step, dict) and step.get("step"))
        or "no steps"
    )

    lines = [f"## Metrics: {deliverable}", ""]

    all_zero = (
        wall_ms_total == 0
        and human_gate_ms_total == 0
        and gate_count == 0
        and all(value == 0 for value in token_values.values())
    )
    if all_zero:
        lines.append(f"No metrics yet for {deliverable}. Dashboard rendered with zero values.")
        lines.append("")

    lines.append("| Metric | Value |")
    lines.append("| --- | ---: |")
    lines.append(f"| wall_ms_total | {wall_ms_total} |")
    lines.append(f"| human_gate_ms_total | {human_gate_ms_total} |")
    lines.append(f"| gate_count | {gate_count} |")
    for label, key in _TOKEN_LABELS:
        lines.append(f"| {label} | {token_values[key]} |")
    lines.append(f"| flow | {flow_str} |")
    lines.append("")

    by_skill = ((report.get("tokens_by_skill") or {}).get("by_skill")) or {}
    last_run = ((report.get("tokens_by_skill") or {}).get("last_run")) or {}
    if by_skill:
        lines.append("### Tokens by skill")
        lines.append("")
        lines.append("| Skill | Tokens (total) | Last run tokens | Last run_id |")
        lines.append("| --- | ---: | ---: | --- |")
        for skill in sorted(by_skill):
            last = last_run.get(skill) or {}
            lines.append(
                f"| {skill} | {by_skill[skill]} | {last.get('value', 0)} | {last.get('run_id', '')} |"
            )
        lines.append("")

    lines.append(f"Dashboard: {dashboard_path}")
    return "\n".join(lines) + "\n"


def run_metrics(
    deliverable_arg: str | None, repo: Path, artifact_dir: Path | None = None
) -> dict[str, Any]:
    """Execute the full /metrics command path; return stdout text + artifacts.

    Mirrors skills/metrics/SKILL.md §2-3: resolve the deliverable, collect,
    render (into a caller-owned artifact dir, never Hive state), then format
    the summary. Raises ``DeliverableResolutionError`` when resolution fails.
    """
    deliverable = resolve_deliverable(deliverable_arg, repo)

    if artifact_dir is None:
        artifact_dir = Path(tempfile.mkdtemp(prefix="hive-metrics."))
    else:
        artifact_dir.mkdir(parents=True, exist_ok=True)

    report_path = artifact_dir / "report.json"
    dashboard_path = artifact_dir / "dashboard.html"
    exports_dir = artifact_dir / "exports"

    report = collect_report(deliverable, repo=repo)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    render(report, repo, out_html=dashboard_path, exports_dir=exports_dir)

    if not dashboard_path.exists():
        raise RuntimeError(f"dashboard was not rendered at {dashboard_path}")

    stdout = format_summary(deliverable, report, dashboard_path.resolve())

    return {
        "deliverable": deliverable,
        "report": report,
        "report_path": report_path,
        "dashboard_path": dashboard_path,
        "stdout": stdout,
    }


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--deliverable", default=None, help="epic/deliverable id")
    parser.add_argument("--repo", default=None, help="repo root (default: cwd)")
    parser.add_argument("--artifact-dir", default=None, help="artifact output dir (default: fresh tempdir)")
    args = parser.parse_args(argv)

    repo = Path(args.repo).resolve() if args.repo else Path.cwd()
    artifact_dir = Path(args.artifact_dir).resolve() if args.artifact_dir else None

    try:
        result = run_metrics(args.deliverable, repo, artifact_dir)
    except DeliverableResolutionError as exc:
        print(str(exc))
        return 0

    sys.stdout.write(result["stdout"])
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
