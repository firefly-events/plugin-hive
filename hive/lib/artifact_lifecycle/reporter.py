"""Report-only output for tracked artifact classes (D2).

Emits candidate paths with live-consumer rationale so a reviewer knows why
these artifacts are listed but not removed:
  audit-record   → audits feed gate-mode aggregation
  episode-marker → episodes feed story-status derivation
  metrics-record → metrics feed cross-run aggregation
"""

from __future__ import annotations

import sys
from typing import Sequence, TextIO

from hive.lib.artifact_lifecycle.planner import Candidate

# Live-consumer rationale per class_id (AC4).
_CONSUMER_REASON: dict[str, str] = {
    "audit-record": "audits feed gate-mode aggregation",
    "episode-marker": "episodes feed story-status derivation",
    "metrics-record": "metrics feed cross-run aggregation",
}

_DEFAULT_REASON = "live consumer: reason unknown"


def format_report_line(candidate: Candidate) -> str:
    """Return a report line for *candidate* with live-consumer rationale."""
    reason = _CONSUMER_REASON.get(candidate.class_id, _DEFAULT_REASON)
    return f"report-only  {candidate.path}  [{candidate.class_id}]  reason: {reason}"


def emit_report(candidates: Sequence[Candidate], *, file: TextIO | None = None) -> None:
    """Print report-only lines for *candidates* to *file* (default: stdout)."""
    out: TextIO = file if file is not None else sys.stdout
    for candidate in candidates:
        print(format_report_line(candidate), file=out)
    print(f"artifact-lifecycle: {len(candidates)} report-only candidate(s)", file=out)


__all__ = [
    "_CONSUMER_REASON",
    "emit_report",
    "format_report_line",
]
