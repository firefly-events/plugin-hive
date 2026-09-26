"""Fail-closed validation for ``skills/observe/SKILL.md`` output.

Observe is an advisor, not a second review gate.  The boundary therefore
accepts one small advisor schema instead of trying to identify every possible
review-shaped payload with a vocabulary blacklist.  Natural-language evidence
may still say, for example, that tests passed or that a parser rejected input;
only control-plane fields and gate instructions are prohibited.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


# Machine gate tokens remain forbidden in prose because downstream automation
# can mistake them for a review artifact.  Ordinary participles such as
# "passed", "approved", and "rejected" are deliberately absent: those words
# are also legitimate evidence.
GATE_VERDICT_TOKENS = (
    "change_verdict",
    "gate_verdict",
    "needs_optimization",
    "needs_revision",
)

_ALLOWED_FIELDS = frozenset({"advice", "assessment", "risk", "skill_invoked"})
_ASSESSMENTS = frozenset({"endorse", "concern"})

# These patterns identify instructions that exercise gate authority.  They are
# intentionally grammatical and object-aware rather than raw-word checks, so
# "tests passed", "approved dependency", and "parser rejected input" remain
# valid evidence.
_GATE_INSTRUCTION_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "pipeline-control imperative",
        re.compile(
            r"(?:^|[.!?]\s+)(?:please\s+)?(?:do\s+not\s+|don't\s+)?"
            r"(?:merge|ship|integrate|release|deploy|proceed)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "pipeline-control imperative",
        re.compile(
            r"(?:^|[.!?]\s+)(?:please\s+)?(?:stop|halt|block)\s+"
            r"(?:this\s+|the\s+)?(?:pipeline|workflow|change|patch|release|"
            r"deployment|integration|merge|pr|pull\s+request)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "gate-verdict imperative",
        re.compile(
            r"(?:^|[.!?]\s+)(?:please\s+)?(?:reject|approve)\s+"
            r"(?:this|the)\s+(?:change|patch|pr|pull\s+request|review)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "pipeline-control directive",
        re.compile(
            r"\b(?:must|cannot|can't|need(?:s)?\s+to)\s+(?:not\s+)?"
            r"(?:merge|ship|integrate|release|deploy|proceed)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "pipeline-control directive",
        re.compile(
            r"\b(?:pipeline|workflow|merge|release|deployment|integration)\s+"
            r"(?:must|should|cannot|can't)\s+(?:not\s+)?(?:stop|halt|block|"
            r"proceed|continue)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "gate-decision statement",
        re.compile(
            r"\b(?:this|the)\s+(?:change|patch|pr|pull\s+request)\s+"
            r"(?:is|should\s+be|must\s+be)\s+"
            r"(?:approved|rejected|blocked)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "gate-control recommendation",
        re.compile(
            r"\b(?:i|we)\s+(?:recommend|advise)\s+"
            r"(?:against\s+)?(?:blocking|approving|rejecting|merging|shipping|"
            r"integrating|releasing|deploying)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "pipeline-control directive",
        re.compile(
            r"\byou\s+should\s+(?:not\s+)?"
            r"(?:merge|ship|integrate|release|deploy|proceed)\b",
            re.IGNORECASE,
        ),
    ),
)


@dataclass(frozen=True)
class ObserveValidationResult:
    accepted: bool
    violations: list[str] = field(default_factory=list)


def _scan_advisory_text(text: str, violations: list[str], path: str) -> None:
    for token in GATE_VERDICT_TOKENS:
        if re.search(rf"\b{re.escape(token)}\b", text, re.IGNORECASE):
            violations.append(f'gate-verdict token "{token}" in text at "{path}"')

    for label, pattern in _GATE_INSTRUCTION_PATTERNS:
        match = pattern.search(text)
        if match:
            violations.append(
                f'{label} "{match.group(0).strip()}" in text at "{path}"'
            )


def _validate_skill_marker(value: Any, violations: list[str]) -> None:
    values = value if isinstance(value, list) else [value]
    if not values or not all(isinstance(item, str) for item in values):
        violations.append('field "skill_invoked" must be a skill path or list of skill paths')
        return
    if any(
        item != "skills/observe/SKILL.md"
        and not item.endswith("/skills/observe/SKILL.md")
        for item in values
    ):
        violations.append('field "skill_invoked" contains a non-observe skill')


def validate_observe_output(output: dict) -> ObserveValidationResult:
    """Validate the strict advisor output schema.

    Required: a non-empty string ``advice``.  Optional: ``assessment`` with the
    skill-owned ``endorse | concern`` vocabulary, a textual ``risk`` summary,
    and the harness-owned observe ``skill_invoked`` marker.  Unknown or nested
    control-plane shapes fail closed, including every spelling of verdict,
    gate, review-pass, or blocking fields.
    """
    if not isinstance(output, dict):
        return ObserveValidationResult(
            accepted=False, violations=[f"output is not a mapping: {type(output).__name__}"]
        )

    violations: list[str] = []
    unknown = sorted(str(key) for key in output if key not in _ALLOWED_FIELDS)
    for key in unknown:
        if "block" in key.lower():
            violations.append(
                f'blocking instruction field "{key}" is not part of the observe advisor schema'
            )
        else:
            violations.append(f'field "{key}" is not part of the observe advisor schema')

    advice = output.get("advice")
    if not isinstance(advice, str) or not advice.strip():
        violations.append('field "advice" must be a non-empty string')
    else:
        _scan_advisory_text(advice, violations, "advice")

    if "assessment" in output:
        assessment = output["assessment"]
        if not isinstance(assessment, str) or assessment.strip().lower() not in _ASSESSMENTS:
            violations.append('field "assessment" must be "endorse" or "concern"')

    if "risk" in output:
        risk = output["risk"]
        if not isinstance(risk, str):
            violations.append('field "risk" must be a string')
        else:
            _scan_advisory_text(risk, violations, "risk")

    if "skill_invoked" in output:
        _validate_skill_marker(output["skill_invoked"], violations)

    return ObserveValidationResult(accepted=not violations, violations=violations)


__all__ = ["GATE_VERDICT_TOKENS", "ObserveValidationResult", "validate_observe_output"]
