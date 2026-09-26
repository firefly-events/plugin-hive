"""Insight distill/promotion validation (story wr-7-lean-agent-and-incident-refs,
revision wr-7-lean-agent-and-incident-refs round 1).

hive/references/insight-capture.md requires that an `override` insight
originating from an owner correction or an overturned audit conclusion carry
a named-incident block: `**What happened:**`, `**How detected:**`,
`**Correction (verbatim):**`, `**Guardrail:**`. An `override` that merely
supersedes a stale codebase fact (no correction/audit event behind it) is
exempt from that requirement.

This module is the REAL enforcement point: it is invoked at the
distill/promotion boundary (session-end insight evaluation, or any caller
promoting a staged insight at `.pHive/insights/{epic-id}/{story-id}/*.md`
into `~/.claude/hive/memories/{agent}/`) so a malformed correction-driven
override is flagged instead of silently promoted.

Detecting "correction-driven" vs "stale-fact" is done from the body itself:
there is no separate frontmatter field for it (see agent-memory-schema.md).
If the body carries ANY of the four incident-field markers, the insight is
treated as an attempted incident block and ALL four are required. If it
carries NONE of them, it is treated as a stale-fact override and is exempt.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

try:  # pragma: no cover - depends on local optional dependency set
    import yaml  # type: ignore
except Exception:  # pragma: no cover - exercised when PyYAML unavailable
    yaml = None

REQUIRED_INCIDENT_FIELDS: tuple[str, ...] = (
    "What happened",
    "How detected",
    "Correction (verbatim)",
    "Guardrail",
)


def _field_marker(field_name: str) -> str:
    return f"**{field_name}:**"


def _split_frontmatter(text: str) -> tuple[dict, str]:
    """Split a staged-insight markdown file into (frontmatter dict, body).

    Missing/unparsable frontmatter yields an empty dict rather than raising —
    callers only need `type`, and a malformed frontmatter block is a separate
    concern from incident-field validation.
    """
    stripped = text.lstrip("﻿")
    if not stripped.startswith("---"):
        return {}, text

    lines = stripped.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text

    end_index = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end_index = i
            break

    if end_index is None:
        return {}, text

    raw_frontmatter = "\n".join(lines[1:end_index])
    body = "\n".join(lines[end_index + 1 :])

    frontmatter: dict = {}
    if yaml is not None:
        try:
            loaded = yaml.safe_load(raw_frontmatter)
            if isinstance(loaded, dict):
                frontmatter = loaded
        except Exception:
            frontmatter = {}
    else:
        for line in raw_frontmatter.splitlines():
            if ":" not in line:
                continue
            key, _, value = line.partition(":")
            frontmatter[key.strip()] = value.strip().strip('"').strip("'")

    return frontmatter, body


def is_correction_driven_override(body: str) -> bool:
    """True if the body carries any incident-field marker at all.

    A stale-fact override (no correction/audit event behind it) never
    attempts these fields, so any presence signals a correction/overturned-
    audit override that must carry all four.
    """
    return any(_field_marker(name) in body for name in REQUIRED_INCIDENT_FIELDS)


def missing_incident_fields(body: str) -> list[str]:
    """Return the required incident-field labels absent from `body`."""
    return [name for name in REQUIRED_INCIDENT_FIELDS if _field_marker(name) not in body]


@dataclass
class OverrideValidation:
    exempt: bool
    missing: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.exempt or not self.missing


def validate_override_incident_fields(insight_type: str, body: str) -> OverrideValidation:
    """Validate an insight body against the override incident-field contract.

    Non-`override` insight types are always exempt. An `override` body with
    no incident-field markers at all is treated as a stale-fact override and
    is exempt. An `override` body carrying at least one marker is a
    correction/overturned-audit override and must carry all four; any
    missing field is returned in `missing`.
    """
    if insight_type != "override":
        return OverrideValidation(exempt=True)

    if not is_correction_driven_override(body):
        return OverrideValidation(exempt=True)

    return OverrideValidation(exempt=False, missing=missing_incident_fields(body))


def validate_insight_text(text: str) -> OverrideValidation:
    """Validate a full staged-insight file's contents (frontmatter + body)."""
    frontmatter, body = _split_frontmatter(text)
    insight_type = str(frontmatter.get("type", "")).strip()
    return validate_override_incident_fields(insight_type, body)


def validate_insight_file(path: Path | str) -> OverrideValidation:
    """Validate a single staged-insight `.md` file on disk."""
    text = Path(path).read_text(encoding="utf-8")
    return validate_insight_text(text)


@dataclass
class FlaggedInsight:
    path: Path
    missing: list[str]


def scan_staging_dir(staging_dir: Path | str) -> list[FlaggedInsight]:
    """Scan a staged-insights directory (distill/promotion boundary) for
    malformed correction-driven `override` insights.

    Returns the flagged files only — a malformed correction-driven override
    must not be silently promoted. Stale-fact overrides and non-override
    insights are never flagged here.
    """
    root = Path(staging_dir)
    if not root.exists():
        return []

    flagged: list[FlaggedInsight] = []
    for md_path in sorted(root.rglob("*.md")):
        validation = validate_insight_file(md_path)
        if not validation.ok:
            flagged.append(FlaggedInsight(path=md_path, missing=validation.missing))
    return flagged


def assert_promotable(text: str, *, source: str = "<insight>") -> None:
    """Raise ValueError if `text` is a malformed correction-driven override.

    Intended to be called at the actual promotion boundary (session-end
    insight evaluation moving a staged file into
    `~/.claude/hive/memories/{agent}/`) so promotion fails loudly instead of
    writing a malformed override into durable memory.
    """
    validation = validate_insight_text(text)
    if not validation.ok:
        missing = ", ".join(validation.missing)
        raise ValueError(
            f"{source}: override insight is missing required incident field(s): {missing}"
        )
