#!/usr/bin/env python3
"""Stale-parent sweep for Multica squad/agent-led parent issues (Fork B lite).

Backstop for leaders that fail the terminal contract (sls-1): finds
`in_progress` parent issues assigned to a squad or agent whose delegated
children are all terminal but whose own status was never flipped.

Classification (STALE requires ALL of):
  (a) every child issue is terminal (done / cancelled / in_review)
  (b) parent updated_at older than --min-age (default 30 minutes)
  (c) no BLOCKED comment in the parent's thread (blocked-by-intent parents
      are reported in a separate section and never auto-flipped)

Default mode is report-only (exit 0). --apply flips STALE parents to done
via `multica issue update`, posting a sweep-attribution comment first.
--json emits machine-readable output. Non-zero exit only on CLI/auth failure.

Stdlib-only by charter; all platform access goes through the multica CLI.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone

TERMINAL_STATUSES = {"done", "cancelled", "in_review"}
SWEEPABLE_ASSIGNEE_TYPES = {"squad", "agent"}
DEFAULT_MIN_AGE_MINUTES = 30

# Leader terminal contract: a leader that cannot complete posts a comment
# carrying the literal marker "BLOCKED" and leaves the parent in_progress.
BLOCKED_MARKER_RE = re.compile(r"\bBLOCKED\b")

# "Delegated" comments link children as [PLU-123](mention://issue/<uuid>).
ISSUE_MENTION_RE = re.compile(r"mention://issue/([0-9a-fA-F-]{36})")

SWEEP_ATTRIBUTION = (
    "Stale-parent sweep (scripts/multica-sweep-stale-parents.py): all child "
    "issues are terminal and this parent has been quiet past the threshold. "
    "Flipping status to done per the squad-leader terminal contract backstop."
)


# ---------------------------------------------------------------------------
# Pure classification logic (unit-tested against fixture JSON, no live CLI)
# ---------------------------------------------------------------------------

def parse_rfc3339(value):
    """Parse an RFC3339 timestamp into an aware datetime (UTC fallback)."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def has_blocked_comment(comments):
    return any(
        BLOCKED_MARKER_RE.search(comment.get("content") or "")
        for comment in comments
    )


def extract_delegated_child_ids(comments):
    """Fallback child discovery: issue mentions in the leader's comments."""
    child_ids = []
    seen = set()
    for comment in comments:
        for issue_id in ISSUE_MENTION_RE.findall(comment.get("content") or ""):
            normalized = issue_id.lower()
            if normalized not in seen:
                seen.add(normalized)
                child_ids.append(normalized)
    return child_ids


def child_status_summary(children):
    counts = {}
    for child in children:
        status = child.get("status") or "unknown"
        counts[status] = counts.get(status, 0) + 1
    if not counts:
        return "no children"
    return ", ".join(f"{count} {status}" for status, count in sorted(counts.items()))


def classify_parent(parent, children, comments, now, min_age):
    """Classify one in_progress squad/agent-assigned parent.

    Returns a dict with verdict one of:
      STALE    — eligible for --apply
      BLOCKED  — BLOCKED comment present; reported separately, never flipped
      ACTIVE   — not stale; `reason` explains which condition failed
    """
    updated_at = parse_rfc3339(parent.get("updated_at"))
    age = (now - updated_at) if updated_at else None

    result = {
        "id": parent.get("id"),
        "key": parent.get("identifier") or parent.get("id"),
        "title": parent.get("title") or "",
        "age_seconds": int(age.total_seconds()) if age is not None else None,
        "child_summary": child_status_summary(children),
        "child_count": len(children),
    }

    if has_blocked_comment(comments):
        result["verdict"] = "BLOCKED"
        result["reason"] = "BLOCKED comment present (stale-by-intent)"
        return result

    if not children:
        result["verdict"] = "ACTIVE"
        result["reason"] = "no child issues (live single-agent parent)"
        return result

    non_terminal = [
        child for child in children
        if (child.get("status") or "") not in TERMINAL_STATUSES
    ]
    if non_terminal:
        keys = ", ".join(
            str(child.get("identifier") or child.get("id")) for child in non_terminal
        )
        result["verdict"] = "ACTIVE"
        result["reason"] = f"non-terminal children: {keys}"
        return result

    if age is None:
        result["verdict"] = "ACTIVE"
        result["reason"] = "unparseable updated_at; refusing to mark stale"
        return result

    if age < min_age:
        result["verdict"] = "ACTIVE"
        result["reason"] = (
            f"updated {int(age.total_seconds() // 60)}m ago "
            f"(< {int(min_age.total_seconds() // 60)}m quiet threshold)"
        )
        return result

    result["verdict"] = "STALE"
    result["reason"] = "all children terminal, parent past quiet threshold"
    return result


def sweep(parents, children_by_parent, comments_by_parent, now, min_age):
    """Classify every candidate parent; returns the list of result dicts."""
    results = []
    for parent in parents:
        if (parent.get("status") or "") != "in_progress":
            continue
        if (parent.get("assignee_type") or "") not in SWEEPABLE_ASSIGNEE_TYPES:
            continue
        parent_id = (parent.get("id") or "").lower()
        results.append(
            classify_parent(
                parent,
                children_by_parent.get(parent_id, []),
                comments_by_parent.get(parent_id, []),
                now,
                min_age,
            )
        )
    return results


# ---------------------------------------------------------------------------
# Multica CLI access (thin wrappers; not exercised by unit tests)
# ---------------------------------------------------------------------------

class MulticaError(RuntimeError):
    pass


def run_multica(args):
    cmd = ["multica", *args]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    except FileNotFoundError as exc:
        raise MulticaError("multica CLI not found on PATH") from exc
    if proc.returncode != 0:
        raise MulticaError(
            f"`{' '.join(cmd)}` failed (exit {proc.returncode}): "
            f"{proc.stderr.strip() or proc.stdout.strip()}"
        )
    return proc.stdout


def run_multica_json(args):
    output = run_multica(args)
    try:
        return json.loads(output)
    except json.JSONDecodeError as exc:
        raise MulticaError(
            f"`multica {' '.join(args)}` returned non-JSON output"
        ) from exc


def list_issues(status=None):
    """Page through `multica issue list` and return every issue."""
    issues = []
    offset = 0
    page_size = 200
    while True:
        args = ["issue", "list", "--limit", str(page_size),
                "--offset", str(offset), "--output", "json"]
        if status:
            args[2:2] = ["--status", status]
        payload = run_multica_json(args)
        # CLI wraps pages as {issues, has_more, ...}; tolerate a bare array.
        if isinstance(payload, dict):
            page = payload.get("issues") or []
            has_more = bool(payload.get("has_more"))
        elif isinstance(payload, list):
            page = payload
            has_more = len(page) >= page_size
        else:
            raise MulticaError("unexpected issue list payload shape")
        issues.extend(page)
        if not has_more:
            return issues
        offset += page_size


def list_comments(issue_id):
    payload = run_multica_json(
        ["issue", "comment", "list", issue_id, "--output", "json"]
    )
    return payload if isinstance(payload, list) else []


def get_issue(issue_id):
    return run_multica_json(["issue", "get", issue_id, "--output", "json"])


def gather(min_age):
    """Fetch live data and run the sweep classification."""
    candidates = [
        issue for issue in list_issues(status="in_progress")
        if (issue.get("assignee_type") or "") in SWEEPABLE_ASSIGNEE_TYPES
    ]
    if not candidates:
        return []

    all_issues = list_issues()
    children_by_parent = {}
    issues_by_id = {}
    for issue in all_issues:
        issue_id = (issue.get("id") or "").lower()
        issues_by_id[issue_id] = issue
        parent_id = (issue.get("parent_issue_id") or "").lower()
        if parent_id:
            children_by_parent.setdefault(parent_id, []).append(issue)

    comments_by_parent = {}
    for parent in candidates:
        parent_id = (parent.get("id") or "").lower()
        comments = list_comments(parent.get("id"))
        comments_by_parent[parent_id] = comments
        # Fallback when the API exposes no parent linkage: recover children
        # from the leader's "Delegated" comment issue mentions.
        if parent_id not in children_by_parent:
            mentioned = [
                issues_by_id.get(child_id) or get_issue(child_id)
                for child_id in extract_delegated_child_ids(comments)
                if child_id != parent_id
            ]
            mentioned = [child for child in mentioned if child]
            if mentioned:
                children_by_parent[parent_id] = mentioned

    return sweep(
        candidates,
        children_by_parent,
        comments_by_parent,
        datetime.now(timezone.utc),
        min_age,
    )


def apply_stale(result):
    """Flip one STALE parent to done, attribution comment first."""
    run_multica([
        "issue", "comment", "add", result["id"],
        "--content", SWEEP_ATTRIBUTION,
    ])
    run_multica(["issue", "update", result["id"], "--status", "done"])


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def format_age(age_seconds):
    if age_seconds is None:
        return "?"
    if age_seconds < 3600:
        return f"{age_seconds // 60}m"
    return f"{age_seconds // 3600}h{(age_seconds % 3600) // 60:02d}m"


def render_table(rows, columns):
    widths = [
        max(len(column), *(len(row[i]) for row in rows)) if rows else len(column)
        for i, column in enumerate(columns)
    ]
    lines = [
        "  ".join(column.ljust(widths[i]) for i, column in enumerate(columns)),
        "  ".join("-" * widths[i] for i in range(len(columns))),
    ]
    lines.extend(
        "  ".join(cell.ljust(widths[i]) for i, cell in enumerate(row))
        for row in rows
    )
    return "\n".join(lines)


def render_report(results):
    main = [r for r in results if r["verdict"] != "BLOCKED"]
    blocked = [r for r in results if r["verdict"] == "BLOCKED"]
    sections = []

    if not results:
        sections.append("No in_progress squad/agent-assigned parents found.")
    else:
        columns = ["KEY", "TITLE", "AGE", "CHILDREN", "VERDICT"]
        rows = [
            [
                str(r["key"]),
                r["title"][:48],
                format_age(r["age_seconds"]),
                r["child_summary"],
                r["verdict"] if r["verdict"] == "STALE" else f"{r['verdict']}: {r['reason']}",
            ]
            for r in main
        ]
        if rows:
            sections.append(render_table(rows, columns))
        if blocked:
            blocked_rows = [
                [
                    str(r["key"]),
                    r["title"][:48],
                    format_age(r["age_seconds"]),
                    r["child_summary"],
                    "BLOCKED",
                ]
                for r in blocked
            ]
            sections.append(
                "Blocked-by-intent (never auto-flipped):\n"
                + render_table(blocked_rows, columns)
            )
    return "\n\n".join(sections)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Report (and optionally flip) stale squad/agent-led parent issues."
    )
    parser.add_argument(
        "--min-age", type=int, default=DEFAULT_MIN_AGE_MINUTES, metavar="MINUTES",
        help="minimum parent quiet age in minutes before STALE (default: 30)",
    )
    parser.add_argument(
        "--apply", action="store_true",
        help="flip STALE parents to done (default: report only)",
    )
    parser.add_argument(
        "--json", action="store_true", dest="as_json",
        help="emit machine-readable JSON instead of the report table",
    )
    args = parser.parse_args(argv)

    try:
        results = gather(timedelta(minutes=args.min_age))
        applied = []
        if args.apply:
            for result in results:
                if result["verdict"] == "STALE":
                    apply_stale(result)
                    applied.append(result["key"])
    except MulticaError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.as_json:
        print(json.dumps({"results": results, "applied": applied}, indent=2))
    else:
        print(render_report(results))
        if args.apply:
            print(
                f"\nApplied: flipped {len(applied)} parent(s) to done"
                + (f" ({', '.join(map(str, applied))})" if applied else "")
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
