"""Skill-candidate ranking helper (story se-5-candidate-ranking-handoff).

Consumes the observation list produced by ``hive.lib.skill_candidate_mine.mine()``
(story se-4) and emits a ranked, threshold-filtered candidate list ready for
``/find-skills`` to write to ``.pHive/meta/skill-candidates.yaml`` and hand off
to ``/write-skill`` (story se-1).

Ranking formula
---------------
``score = occurrence_count * recency_factor * distinctness``

- ``recency_factor``: linear decay from ``last_seen`` against ``now`` (UTC).
  A fresh pattern scores ~1.0, a 3-month-old pattern floors at 0.25.
  Formula: ``max(0.25, 1.0 - days_since_last_seen / 90)``.
- ``distinctness``: ``1.0 - max_similarity(suggested_name, existing_skills)``
  where similarity is ``difflib.SequenceMatcher.ratio`` (no external deps).
  Clamped to ``[0.0, 1.0]``. When ``existing_skills`` is empty, distinctness
  is 1.0 (everything is maximally novel against an empty catalog).

Quality threshold
-----------------
``THRESHOLD`` gates surfaced candidates: ``occurrence_count >= 3`` AND
``distinctness >= 0.5``. ``filter_threshold(candidates)`` applies it.

Determinism
-----------
The returned list is sorted by ``(-score, name)`` so ties break
alphabetically, matching the deterministic-output guarantee se-4 holds for
its own emission.

Relationship to se-4
--------------------
se-4 (mining) is observation-only and includes the project-maturity gate.
This module assumes that gate has already fired: an empty observation list
propagates naturally to an empty candidate list, which ``/find-skills``
renders as a one-line note in the output yaml ("no candidates met
threshold") — no noise rows.
"""

from __future__ import annotations

import difflib
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:  # PyYAML is an optional dep — write_candidates_yaml requires it
    import yaml  # type: ignore
except Exception:  # pragma: no cover - exercised when PyYAML absent
    yaml = None

__all__ = [
    "THRESHOLD",
    "rank",
    "filter_threshold",
    "suggest_name",
    "suggest_triggers",
    "suggest_scope_hint",
    "write_candidates_yaml",
]

# Quality threshold gate. A candidate must satisfy ALL conditions.
THRESHOLD: dict[str, float] = {
    "occurrence_count": 3,
    "distinctness": 0.5,
}

# Recency decay window in days. last_seen older than this floors at MIN_RECENCY.
RECENCY_WINDOW_DAYS = 90
MIN_RECENCY = 0.25

# Per-source scope-hint defaults. /find-skills surfaces this to /write-skill
# as the seed value — the operator can override during the brief dialogue.
_SCOPE_HINTS: dict[str, str] = {
    "metric_event": "atomic-skill — single-shot, observation-driven",
    "kg_triple": "atomic-skill — single-shot, knowledge-graph lookup",
    "commit": "atomic-skill — single-shot, codebase-touching",
    "cycle_escalation": "multi-turn orchestrator — escalation triage",
}

# Per-source trigger seed templates. /find-skills uses these as starter
# phrases the operator refines in the /write-skill brief.
_TRIGGER_SEEDS: dict[str, list[str]] = {
    "metric_event": [
        "when a recurring metric event needs handling",
        "as part of the post-run metrics sweep",
    ],
    "kg_triple": [
        "when looking up a recurring knowledge-graph pattern",
        "as part of KG-driven retrieval",
    ],
    "commit": [
        "when a recurring commit-type pattern needs automation",
        "as part of the commit/PR workflow",
    ],
    "cycle_escalation": [
        "when this escalation trigger recurs across cycles",
        "as part of the escalation-triage flow",
    ],
}


def rank(
    observations: list[dict[str, Any]],
    *,
    existing_skills: list[str] | None = None,
    now: str | None = None,
) -> list[dict[str, Any]]:
    """Rank observations into skill candidates.

    Parameters
    ----------
    observations:
        Output of ``hive.lib.skill_candidate_mine.mine()`` — list of dicts
        with ``pattern_signature``, ``occurrence_count``, ``recent_examples``,
        ``source_kind``, ``first_seen``, ``last_seen``.
    existing_skills:
        Optional list of existing top-level skill names (kebab-case). Used
        to compute distinctness — candidates whose suggested name is too
        similar to an existing skill score lower. ``None`` or empty means
        all candidates are maximally distinct.
    now:
        Optional ISO-8601 timestamp used as the reference "now" for the
        recency decay. Defaults to ``datetime.utcnow()``. Accepts the
        ISO-8601 shape ``last_seen`` carries (e.g. ``2026-05-19T12:00:00Z``).

    Returns
    -------
    A deterministically-sorted list of candidate dicts. Sort key is
    ``(-score, name)``. Not threshold-filtered — callers apply
    ``filter_threshold()`` to gate noise.
    """
    skills = list(existing_skills or [])
    reference_now = _parse_iso(now) if now else datetime.now(timezone.utc)

    candidates: list[dict[str, Any]] = []
    for obs in observations:
        signature = str(obs.get("pattern_signature") or "")
        source_kind = str(obs.get("source_kind") or "")
        occurrence_count = int(obs.get("occurrence_count") or 0)
        recent_examples = list(obs.get("recent_examples") or [])
        first_seen = str(obs.get("first_seen") or "")
        last_seen = str(obs.get("last_seen") or "")

        name = suggest_name(signature, source_kind=source_kind)
        triggers = suggest_triggers(signature, source_kind=source_kind)
        scope_hint = suggest_scope_hint(source_kind)
        distinctness = _distinctness(name, skills)
        recency_factor = _recency_factor(last_seen, reference_now)
        score = float(occurrence_count) * recency_factor * distinctness

        candidates.append(
            {
                "name": name,
                "triggers": triggers,
                "scope_hint": scope_hint,
                "recent_examples": recent_examples,
                "occurrence_count": occurrence_count,
                "distinctness": round(distinctness, 4),
                "score": round(score, 4),
                "source_kind": source_kind,
                "first_seen": first_seen,
                "last_seen": last_seen,
            }
        )

    candidates.sort(key=lambda c: (-c["score"], c["name"]))
    return candidates


def filter_threshold(
    candidates: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Drop candidates below the quality threshold.

    Keeps only candidates with ``occurrence_count >= 3`` AND
    ``distinctness >= 0.5``. Preserves input ordering.
    """
    min_count = THRESHOLD["occurrence_count"]
    min_distinctness = THRESHOLD["distinctness"]
    return [
        c
        for c in candidates
        if c.get("occurrence_count", 0) >= min_count
        and c.get("distinctness", 0.0) >= min_distinctness
    ]


def suggest_name(signature: str, *, source_kind: str = "") -> str:
    """Derive a kebab-case skill-name suggestion from a pattern signature.

    The signature shape is source-specific (see se-4 docstring), e.g.::

        commit:feat(scope)
        event:agent|metric_type|phase
        kg:predicate|namespace
        escalation:trigger|placement|severity

    We strip the source prefix, normalize delimiters to hyphens, slugify,
    and prepend a short source hint when the body alone would collide
    with the source prefix (rare). Output is always non-empty.
    """
    body = signature
    if ":" in body:
        body = body.split(":", 1)[1]
    # Replace common structural delimiters with hyphens.
    body = re.sub(r"[|/()]", "-", body)
    # Slugify: keep alnum + hyphen, collapse runs.
    body = re.sub(r"[^a-zA-Z0-9-]+", "-", body)
    body = re.sub(r"-+", "-", body).strip("-").lower()
    if not body:
        body = "candidate"
    # Source-kind prefix avoids cross-source name collisions when two
    # different sources happen to share a body slug.
    prefix_map = {
        "metric_event": "event",
        "kg_triple": "kg",
        "commit": "commit",
        "cycle_escalation": "escalation",
    }
    prefix = prefix_map.get(source_kind, "")
    if prefix and not body.startswith(prefix + "-"):
        return f"{prefix}-{body}"
    return body


def suggest_triggers(signature: str, *, source_kind: str = "") -> list[str]:
    """Compose 2-3 starter trigger phrases for a candidate.

    Combines a generic per-source-kind seed pair with one signature-flavored
    phrase so the operator sees concrete domain language in the brief.
    """
    seeds = list(_TRIGGER_SEEDS.get(source_kind, [
        "when this recurring pattern needs automation",
        "as part of the surrounding workflow",
    ]))
    # Add a signature-flavored third phrase — keeps the brief grounded in
    # what was actually observed.
    flavor = signature.split(":", 1)[1] if ":" in signature else signature
    flavor = flavor.strip()
    if flavor:
        seeds.append(f'when the "{flavor}" pattern recurs')
    return seeds[:3]


def suggest_scope_hint(source_kind: str) -> str:
    """Pick a sensible default scope hint per source kind."""
    return _SCOPE_HINTS.get(
        source_kind, "atomic-skill — single-shot, refine during /write-skill"
    )


def _distinctness(name: str, existing_skills: list[str]) -> float:
    """Compute distinctness as 1.0 - max similarity to any existing skill."""
    if not existing_skills:
        return 1.0
    best = 0.0
    for skill in existing_skills:
        if not skill:
            continue
        ratio = difflib.SequenceMatcher(None, name, skill).ratio()
        if ratio > best:
            best = ratio
    distinctness = 1.0 - best
    if distinctness < 0.0:
        return 0.0
    if distinctness > 1.0:
        return 1.0
    return distinctness


def _recency_factor(last_seen: str, reference_now: datetime) -> float:
    """Linear decay from ``last_seen`` against ``reference_now``.

    Missing or unparseable timestamps fall back to MIN_RECENCY so a pattern
    without temporal grounding still ranks below a fresh one.
    """
    parsed = _parse_iso(last_seen)
    if parsed is None:
        return MIN_RECENCY
    delta = reference_now - parsed
    days = delta.total_seconds() / 86400.0
    if days < 0:
        days = 0.0
    factor = 1.0 - days / float(RECENCY_WINDOW_DAYS)
    if factor < MIN_RECENCY:
        return MIN_RECENCY
    if factor > 1.0:
        return 1.0
    return factor


def write_candidates_yaml(
    candidates: list[dict[str, Any]],
    path: str | Path,
    *,
    now: str | None = None,
) -> Path:
    """Write the ranked candidate yaml to ``path``.

    Empty-list contract (AC-2 of story se-5)::

        candidates == [] -> yaml is exactly:
            note: "no candidates met threshold"

        No ``candidates:`` key, no observation rows — the empty-yaml shape
        is contractual: it tells the consumer "we ran, nothing met
        threshold" without emitting noise.

    Non-empty contract (AC-1)::

        {
          "candidates": <list, preserving ranking order>,
          "generated_at": <ISO-8601 UTC timestamp>,
        }

    Parameters
    ----------
    candidates:
        The threshold-filtered ranked list from
        ``filter_threshold(rank(...))``. May be empty.
    path:
        Output path. Parent directories are created if absent
        (handles consumer projects without ``.pHive/meta/`` pre-existing).
    now:
        Optional ISO-8601 timestamp used as the ``generated_at`` value.
        Defaults to ``datetime.now(timezone.utc)``.

    Returns
    -------
    The ``Path`` written.

    Raises
    ------
    RuntimeError:
        If PyYAML is not importable. The empty-yaml shape is short enough
        that callers could fall back to hand-emitting it, but the
        non-empty path needs a real serializer to preserve types — failing
        loud here is the lesser evil.
    """
    if yaml is None:
        raise RuntimeError(
            "PyYAML is required for write_candidates_yaml; install pyyaml"
        )

    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if not candidates:
        payload: dict[str, Any] = {"note": "no candidates met threshold"}
    else:
        generated_at = now or datetime.now(timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
        payload = {
            "candidates": list(candidates),
            "generated_at": generated_at,
        }

    # sort_keys=False preserves ranking order on the non-empty path.
    output_path.write_text(
        yaml.safe_dump(payload, sort_keys=False), encoding="utf-8"
    )
    return output_path


def _parse_iso(value: str | None) -> datetime | None:
    """Parse an ISO-8601 timestamp, tolerating the ``Z`` suffix."""
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    # ``fromisoformat`` (3.11+) handles Z, but older runtimes need a swap.
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)
