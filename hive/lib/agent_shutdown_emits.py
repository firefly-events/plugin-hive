"""Shared shutdown-time role-triple emit helper (s6/s7/s8).

Reviewer, tester, and developer personas each emit exactly one role verdict
triple at shutdown — a separate structured emit fired in the same call
sequence as insights-before-shutdown (receiver protocol step 1b), NOT prose
inside insight text. This module is the single shared function those three
personas call (or mirror via ``kg_emit_cli``) so the emit semantics cannot
drift per persona.

Semantics:

- Silent when there is nothing to report: a shutdown without a completed
  review/test/implementation passes ``verdict=None`` (or empty) and no triple
  is written.
- Case-stable objects: verdicts are lowercased and trimmed before write, so
  ``"Approve"`` and ``"approve"`` land as the same object.
- Exactly-one: one call writes one triple; replays are absorbed by the KG's
  ``INSERT OR IGNORE`` + unique index on (subject, predicate, object,
  source_epic), so a retried shutdown cannot double-count.
- Same availability semantics as ``emit_kg_event``: silent no-op on
  knob==off and on missing kg.sqlite.
"""

from __future__ import annotations

import re
from typing import Any

from hive.lib.kg_emit import emit_kg_event

# Role predicate per persona — declared in the predicates table by
# s5-role-predicates-schema; FK enforcement (b2) rejects undeclared predicates.
ROLE_PREDICATE_BY_AGENT = {
    "reviewer": "validated",
    "tester": "tested",
    "developer": "implemented",
}

# Canonical reviewer verdict vocabulary for the `validated` object. The
# reviewer persona's rubric-computed change_verdict is 3-value
# (passed | needs_optimization | needs_revision); this map is the single
# place that projects it onto the KG object vocabulary.
REVIEWER_VERDICT_TO_OBJECT = {
    "passed": "approve",
    "needs_optimization": "approve-with-changes",
    "needs_revision": "reject",
    # Already-canonical objects pass through unchanged.
    "approve": "approve",
    "approve-with-changes": "approve-with-changes",
    "reject": "reject",
}

# Closed object vocabularies per role predicate. Predicates absent from this
# map accept any sanitized object.
ALLOWED_OBJECTS = {
    "validated": frozenset({"approve", "approve-with-changes", "reject"}),
    "tested": frozenset({"pass", "fail", "inconclusive"}),
}

# The `implemented` object is open-ended (commit SHAs are arbitrary hex) but
# shape-pinned: either the literal "wip" or an abbreviated-to-full git SHA.
IMPLEMENTED_OBJECT_RE = re.compile(r"^(wip|[0-9a-f]{7,40})$")


def emit_role_triple_at_shutdown(
    *,
    subject: str,
    source_agent: str,
    verdict: Any,
    source_epic: str,
    predicate: str | None = None,
    cycle_id: str | None = None,
) -> dict[str, Any]:
    """Emit one role verdict triple at agent shutdown.

    Returns the ``emit_kg_event`` result dict. When there is no completed
    work to report (``verdict`` is None/empty) or the verdict is outside the
    predicate's closed vocabulary, returns ``{"emitted": False, ...}`` with a
    ``reason`` and writes nothing — shutdown must never block on this.
    """
    if verdict is None or not str(verdict).strip():
        return {"emitted": False, "metadata": None, "reason": "no-completed-work"}

    pred = predicate or ROLE_PREDICATE_BY_AGENT.get(source_agent)
    if pred is None:
        return {
            "emitted": False,
            "metadata": None,
            "reason": f"no role predicate for agent {source_agent!r}",
        }

    obj = str(verdict).strip().lower()
    if pred == "validated":
        obj = REVIEWER_VERDICT_TO_OBJECT.get(obj, obj)

    allowed = ALLOWED_OBJECTS.get(pred)
    if allowed is not None and obj not in allowed:
        return {
            "emitted": False,
            "metadata": None,
            "reason": f"object {obj!r} outside vocabulary for predicate {pred!r}",
        }

    if pred == "implemented" and not IMPLEMENTED_OBJECT_RE.fullmatch(obj):
        return {
            "emitted": False,
            "metadata": None,
            "reason": f"object {obj!r} is neither 'wip' nor a git commit SHA",
        }

    return emit_kg_event(
        subject=subject,
        predicate=pred,
        obj=obj,
        source_epic=source_epic,
        source_agent=source_agent,
        cycle_id=cycle_id,
    )
