"""PENDING manual_verdict aging + audited waive (story wr-3-manual-verdict-aging).

Lean version of retro proposals (b)+(i) (see
.pHive/epics/wfd-retro-hardening/docs/design-discussion.md sec 0b, "wr-2 carried_work
challenged"): `manual_verdict` already exists in the story-YAML schema
(hive/references/story-yaml-schema.md sec 9) as the canonical simulated/actual-manual
verdict home. This module adds NO new top-level schema block. It:

  - reads the existing `manual_verdict` block across every story in every epic and
    surfaces the ones still PENDING (`verdict: null`) with a days-pending aging figure,
    so `/status` can nag instead of letting them rot silently (this surfacing is
    broad — every PENDING block, `required` or not);
  - determines whether an epic has a "required device pass" NOT from mere presence of
    a `manual_verdict` block (that was the round-1 bug — it blocked non-UI epics that
    merely opted into the `simulated-manual` concern) but from the plan-derived
    `manual_verdict.required: true` flag (see story-yaml-schema.md sec 9.1b). An epic
    with zero `required: true` blocks across all its stories is unaffected by /ship's
    done-done refusal (acceptance criterion 4), even if it has non-required
    `manual_verdict` blocks;
  - lets an operator record an audited waive directly on the SAME block (an optional
    `waived: {reason, timestamp, owner}` sub-field, not a new top-level block — see
    story-yaml-schema.md sec 9 update). A waive requires both `reason` and `owner`; it
    never deletes or hides the PENDING verdict, so `/status` keeps showing it as
    "waived (aging)" (grill T3: a waive must not become a new silent indefinite-PENDING).

`pending_since` / `days_pending` use the story YAML's first commit date (git-deterministic,
same "read real git history" posture as hive/lib/merge_shape_check.py) as the aging anchor,
since a PENDING verdict's own `timestamp` field is `null` by definition (not yet run) and
`/plan` does not stamp a separate "seeded at" field.
"""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

_MANUAL_VERDICT_BLOCK_RE = re.compile(r"^manual_verdict:\n((?:[ \t]+.*\n?)*)", re.MULTILINE)
_WAIVED_SUBBLOCK_RE_TEMPLATE = r"^{indent}waived:\n(?:{indent}[ \t].*\n?)*"


@dataclass
class ManualVerdictStatus:
    epic_id: str
    story_id: str
    story_path: Path
    scenario_ref: str | None
    required: bool
    pending_since: str | None
    days_pending: int | None
    waived: bool
    waive_attempted: bool
    waive_error: str | None
    waive_reason: str | None
    waive_owner: str | None
    waive_timestamp: str | None


def _parse_manual_verdict_block(text: str) -> dict[str, Any] | None:
    match = _MANUAL_VERDICT_BLOCK_RE.search(text)
    if not match:
        return None
    parsed = yaml.safe_load("manual_verdict:\n" + match.group(1))
    if not isinstance(parsed, dict):
        return None
    block = parsed.get("manual_verdict")
    return block if isinstance(block, dict) else None


_UI_DEVICE_KEYWORDS = (
    "ui", "screen", "gesture", "render", "rendering", "view", "interaction",
    "device", "tap", "swipe", "click", "button", "animation", "layout",
    "widget", "touch", "scroll", "modal", "dialog",
)
_UI_DEVICE_KEYWORD_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(kw) for kw in _UI_DEVICE_KEYWORDS) + r")\b",
    re.IGNORECASE,
)


def derive_manual_verdict_required(
    title: str, acceptance_criteria: list[str] | None = None
) -> bool:
    """Plan-time derivation of `manual_verdict.required` (story wr-3-manual-verdict-aging,
    REVISION-1b; skills/plan/SKILL.md step 13.3). `required: true` only when the
    story is ITSELF a genuine UI/device-pass gate — user-facing UI/interaction
    behavior that a real device or manual pass is needed to validate — not merely
    because the simulated-manual concern applies (that concern also covers
    backend stories, which is the round-1 bug this module fixes elsewhere).
    Keyword heuristic over the story title + acceptance criteria text against the
    UI/device vocabulary named in SKILL.md's judgment-call guidance (screen,
    gesture, rendering change, etc.)."""
    text = " ".join([title, *(acceptance_criteria or [])])
    return _UI_DEVICE_KEYWORD_RE.search(text) is not None


def epic_has_required_device_pass(epic_stories_dir: Path) -> bool:
    """An epic is UI/device-pass-bearing iff any of its stories has a
    manual_verdict block with `required: true` (plan-derived — see
    story-yaml-schema.md sec 9.1b). Presence of a `manual_verdict` block alone
    is NOT sufficient (round-1 bug: that blocked non-UI epics whose stories
    merely opted into the `simulated-manual` concern with `required: false`)."""
    if not epic_stories_dir.is_dir():
        return False
    for story_path in sorted(epic_stories_dir.glob("*.yaml")):
        text = story_path.read_text(encoding="utf-8")
        block = _parse_manual_verdict_block(text)
        if block is not None and bool(block.get("required", False)):
            return True
    return False


def epic_has_manual_verdict_blocks(epic_stories_dir: Path) -> bool:
    """Broad presence check: True iff any story in the epic carries a
    manual_verdict block at all, regardless of `required`. Used to scope
    /ship's broad PENDING nag (which is NOT gated on `required`), separately
    from `epic_has_required_device_pass` which gates the done-done refusal."""
    if not epic_stories_dir.is_dir():
        return False
    for story_path in sorted(epic_stories_dir.glob("*.yaml")):
        text = story_path.read_text(encoding="utf-8")
        if _parse_manual_verdict_block(text) is not None:
            return True
    return False


def _is_valid_iso8601(value: str) -> bool:
    """True iff `value` parses as an ISO-8601 timestamp."""
    candidate = value.strip()
    if candidate.endswith("Z"):
        candidate = candidate[:-1] + "+00:00"
    try:
        datetime.fromisoformat(candidate)
    except ValueError:
        return False
    return True


def _validate_waiver(waived_value: Any, *, present: bool) -> tuple[bool, str | None]:
    """Centralized waiver validation for the read/classify path
    (`find_pending_manual_verdicts`). `present` must reflect key PRESENCE
    (`"waived" in block`), NOT truthiness — an explicitly present but empty
    mapping (`waived: {}`) or bare key (`waived:`, which YAML parses as
    `None`) is a waive ATTEMPT and must be validated like any other, not
    treated as "no waiver attempted". A bare key (`None`) is treated the same
    as an empty mapping (both report all three missing fields); any OTHER
    non-mapping value (string, list, number) is a type error. Returns
    (effective, error) — error is a short human-readable description of the
    missing/invalid field(s), or None when effective (or when the key is
    genuinely absent — that is not an error, just no attempt)."""
    if not present:
        return False, None
    if waived_value is None:
        waived_value = {}
    if not isinstance(waived_value, dict):
        return False, "waived must be a mapping"
    reason = waived_value.get("reason")
    owner = waived_value.get("owner")
    timestamp = waived_value.get("timestamp")
    bad: list[str] = []
    if not isinstance(reason, str) or not reason.strip():
        bad.append("reason")
    if not isinstance(owner, str) or not owner.strip():
        bad.append("owner")
    if not isinstance(timestamp, str) or not timestamp.strip():
        bad.append("timestamp")
    elif not _is_valid_iso8601(timestamp):
        bad.append("timestamp (invalid ISO-8601)")
    if bad:
        return False, f"missing {', '.join(bad)}"
    return True, None


def _first_commit_date(repo_root: Path, path: Path) -> str | None:
    try:
        result = subprocess.run(
            [
                "git", "-C", str(repo_root), "log", "--follow",
                "--diff-filter=A", "--format=%aI", "--", str(path),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    lines = [line for line in result.stdout.splitlines() if line]
    return lines[-1] if lines else None


def _days_between(iso_ts: str | None, now: datetime) -> int | None:
    if not iso_ts:
        return None
    try:
        seeded = datetime.fromisoformat(iso_ts)
    except ValueError:
        return None
    if seeded.tzinfo is None:
        seeded = seeded.replace(tzinfo=timezone.utc)
    return max((now - seeded).days, 0)


def find_pending_manual_verdicts(
    repo_root: Path | str,
    state_dir: Path | str,
    *,
    epic_id: str | None = None,
    now: datetime | None = None,
) -> list[ManualVerdictStatus]:
    """Every PENDING (`verdict: null`) manual_verdict block, epic + story YAMLs
    scanned under `state_dir/epics/*/stories/*.yaml`. Optionally filtered to a
    single `epic_id`. Non-PENDING (verdict already rendered) blocks are omitted."""
    repo_root = Path(repo_root)
    state_dir = Path(state_dir)
    now = now or datetime.now(timezone.utc)
    epics_dir = state_dir / "epics"
    results: list[ManualVerdictStatus] = []
    if not epics_dir.is_dir():
        return results

    for epic_dir in sorted(epics_dir.iterdir()):
        if not epic_dir.is_dir():
            continue
        if epic_id is not None and epic_dir.name != epic_id:
            continue
        stories_dir = epic_dir / "stories"
        if not stories_dir.is_dir():
            continue
        for story_path in sorted(stories_dir.glob("*.yaml")):
            text = story_path.read_text(encoding="utf-8")
            block = _parse_manual_verdict_block(text)
            if block is None or block.get("verdict") is not None:
                continue
            waived_present = "waived" in block
            waived_value = block.get("waived")
            effective, error = _validate_waiver(waived_value, present=waived_present)
            waived_block = waived_value if isinstance(waived_value, dict) else {}
            pending_since = _first_commit_date(repo_root, story_path)
            results.append(
                ManualVerdictStatus(
                    epic_id=epic_dir.name,
                    story_id=story_path.stem,
                    story_path=story_path,
                    scenario_ref=block.get("scenario_ref"),
                    required=bool(block.get("required", False)),
                    pending_since=pending_since,
                    days_pending=_days_between(pending_since, now),
                    waived=effective,
                    waive_attempted=waived_present,
                    waive_error=error,
                    waive_reason=waived_block.get("reason"),
                    waive_owner=waived_block.get("owner"),
                    waive_timestamp=waived_block.get("timestamp"),
                )
            )
    return results


def blocking_pending_verdicts(
    repo_root: Path | str, state_dir: Path | str, epic_id: str, *, now: datetime | None = None
) -> list[ManualVerdictStatus]:
    """PENDING, non-waived, REQUIRED manual_verdict entries for one epic — used by
    /ship's UI-done-done refusal. `required: false`/absent never blocks (this is the
    wr-3-manual-verdict-aging round-1 fix: presence alone used to block non-UI
    epics). Empty list means the epic is clear to mark done-done."""
    return [
        s
        for s in find_pending_manual_verdicts(repo_root, state_dir, epic_id=epic_id, now=now)
        if not s.waived and s.required
    ]


def format_pending_aging_section(statuses: list[ManualVerdictStatus]) -> str:
    """Render the `/status` "PENDING manual_verdict aging" section. Empty input
    renders an empty string (silent-on-absence, same posture as scope_drift_reader)."""
    if not statuses:
        return ""
    lines = ["PENDING manual_verdict aging:"]
    for s in sorted(statuses, key=lambda s: (-(s.days_pending or 0), s.epic_id, s.story_id)):
        age = f"{s.days_pending}d" if s.days_pending is not None else "unknown age"
        if s.waived:
            lines.append(
                f"  {s.epic_id}/{s.story_id} — PENDING, waived ({age}) "
                f"by {s.waive_owner}: {s.waive_reason}"
            )
        elif s.waive_attempted:
            lines.append(
                f"  {s.epic_id}/{s.story_id} — PENDING ({age}), "
                f"waived (INVALID: {s.waive_error})"
            )
        else:
            lines.append(f"  {s.epic_id}/{s.story_id} — PENDING ({age})")
    return "\n".join(lines)


class WaiveError(ValueError):
    """Raised when a waive cannot be recorded (missing fields, or verdict not PENDING)."""


def waive_pending_verdict(
    story_path: Path | str, *, reason: str, owner: str, timestamp: str | None = None
) -> None:
    """Record an audited waive on an existing PENDING manual_verdict block, in
    place, on the SAME block (no new schema block). Requires both `reason` and
    `owner`; refuses if the verdict is not currently PENDING. Re-waiving replaces
    the prior waive record rather than accumulating duplicates. The waive is
    additive text, not a deletion — /status keeps surfacing the story as
    "waived (aging)", never silently drops it (grill T3)."""
    if not reason or not reason.strip():
        raise WaiveError("waive requires a non-empty reason")
    if not owner or not owner.strip():
        raise WaiveError("waive requires a non-empty owner")
    if timestamp is not None and not _is_valid_iso8601(timestamp):
        raise WaiveError(f"invalid ISO-8601 timestamp: {timestamp!r}")

    story_path = Path(story_path)
    text = story_path.read_text(encoding="utf-8")
    match = _MANUAL_VERDICT_BLOCK_RE.search(text)
    if not match:
        raise WaiveError(f"no manual_verdict block found in {story_path}")

    block = _parse_manual_verdict_block(text) or {}
    if block.get("verdict") is not None:
        raise WaiveError(
            f"{story_path} manual_verdict is not PENDING "
            f"(verdict={block.get('verdict')!r}); nothing to waive"
        )

    timestamp = timestamp or datetime.now(timezone.utc).isoformat()
    block_body = match.group(1)

    indent_match = re.search(r"^([ \t]+)\S", block_body, re.MULTILINE)
    indent = indent_match.group(1) if indent_match else "  "

    stripped_body = re.sub(
        _WAIVED_SUBBLOCK_RE_TEMPLATE.format(indent=re.escape(indent)),
        "",
        block_body,
        flags=re.MULTILINE,
    )

    waived_lines = (
        f"{indent}waived:\n"
        f"{indent}  reason: {json.dumps(reason)}\n"
        f"{indent}  owner: {json.dumps(owner)}\n"
        f'{indent}  timestamp: "{timestamp}"\n'
    )

    new_block = "manual_verdict:\n" + stripped_body.rstrip("\n") + "\n" + waived_lines
    new_text = text[: match.start()] + new_block + text[match.end() :]
    story_path.write_text(new_text, encoding="utf-8")


def _cli(argv: list[str] | None = None) -> int:
    """`python3 -m hive.lib.manual_verdict_status` — prints the aging section
    for the whole workspace (all epics) to stdout, same silent-on-absence
    contract as scope_drift_reader. Used by /status."""
    import os

    from hive.lib.config import resolve_state_dir

    state_dir = Path(resolve_state_dir(cwd=os.getcwd(), env=dict(os.environ)))
    output = format_pending_aging_section(find_pending_manual_verdicts(Path.cwd(), state_dir))
    if output:
        print(output)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(_cli())
