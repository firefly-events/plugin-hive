"""Plan-drift reconciliation helper (story wr-6-plan-drift-instrument).

Answers one question for `/execute`'s preamble: has an epic's declared
dependency moved since `/plan` pinned `planned_base_ref`, such that a
reconciliation artifact is required before story 1 starts?

Both new epic.yaml fields are OPTIONAL (`hive/references/story-yaml-schema.md`
sec 6.5) — an epic missing either one is never a candidate for the gate; the
absence is legacy/untracked, not an error.

`planned_base_ref` is pinned by `/plan` as the resolved commit SHA of the
merge-base between the epic's own base branch and its dependency epic's
branch, mirroring the `git_flow` pinning pattern in sec 6.2. Epics written
before this story canonicalized the field (e.g. a bare branch name such as
`develop`) are a legacy non-SHA placeholder: the gate treats them as
untracked and skips with a one-line info log, the same back-compat posture
`git_flow`/`planning_team` use for pre-dating epics — no crash, no forced
migration.

The gate compares `planned_base_ref` to the CURRENT merge-base of
`git_flow.base_branch` and the dependency epic's own branch
(`feat/<epic-id>`, per the repo branch convention) — not to the base
branch's tip. Unrelated commits landing on the base branch (other epics
merging in) do not move the merge-base and must not trip the gate; only
the dependency epic's branch actually advancing relative to the base
changes it.
"""

from __future__ import annotations

import logging
import re
import subprocess
import uuid
from datetime import datetime, timezone
from typing import Any

from .metrics.core import append_event

_log = logging.getLogger(__name__)

_SHA_RE = re.compile(r"^[0-9a-f]{7,40}$")


def normalize_depends_on_epic(value: Any) -> list[str]:
    """Normalize `depends_on_epic` to a list.

    Accepts either shape observed in the wild: a bare scalar epic-id
    string (`depends_on_epic: skill-footprint`) or a list of epic-ids
    (`depends_on_epic: [exec-discipline-may2026]`). Both are canonical;
    neither is preferred over the other. Absent/`None` normalizes to `[]`.
    """
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    return list(value)


def _looks_like_sha(ref: str) -> bool:
    return bool(_SHA_RE.match(ref.strip()))


def _run_git(args: list[str], *, cwd: str | None) -> str | None:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def resolve_dependency_branch_ref(
    epic_id: str,
    *,
    cwd: str | None = None,
) -> str | None:
    """Resolve the dependency epic's own branch, per the repo's per-epic
    branch convention (`feat/<epic-id>`, see
    `hive/references/sandcastle-ops-loop.md`).

    Tries `origin/feat/<epic-id>` first (authoritative remote state),
    then the local branch name. Returns `None` when neither resolves —
    callers must treat that as "cannot determine, skip the gate".
    """
    for ref in (f"origin/feat/{epic_id}", f"feat/{epic_id}"):
        if _run_git(["rev-parse", "--verify", ref], cwd=cwd) is not None:
            return ref
    return None


def resolve_current_merge_base(
    base_branch: str,
    dependency_ref: str,
    *,
    cwd: str | None = None,
) -> str | None:
    """Resolve the CURRENT merge-base of `base_branch` and
    `dependency_ref`.

    `planned_base_ref` is pinned by `/plan` as the resolved SHA of the
    merge-base between the epic's base branch and its dependency epic's
    branch at plan time (mirroring the `git_flow` pinning rationale in
    § 6.2 — `/plan` snapshots the position, `/execute` later checks
    whether reality moved past that snapshot). Comparing the CURRENT
    merge-base of the same two refs against that snapshot is what
    detects "the dependency moved since planning" — other, unrelated
    epics merging into the base branch do not change this merge-base
    and must not trip the gate.

    Tries `origin/<base_branch>` first (the authoritative remote state),
    then the local branch name, mirroring the base-branch resolution
    the old tip-based check used. Returns `None` when neither resolves
    (e.g. no git repo, no such branch, no remote) — callers must treat
    that as "cannot determine, skip the gate", not as "no drift".
    """
    for base_ref in (f"origin/{base_branch}", base_branch):
        merge_base = _run_git(["merge-base", base_ref, dependency_ref], cwd=cwd)
        if merge_base:
            return merge_base
    return None


def check_reconciliation_required(
    epic: dict[str, Any],
    *,
    cwd: str | None = None,
) -> dict[str, Any]:
    """Decide whether `/execute` must require a reconciliation artifact
    before story 1.

    Returns a dict: `{"required": bool, "reason": str, "planned_base_ref":
    str|None, "current_base_ref": str|None, "depends_on_epic": list[str]}`.
    `current_base_ref` is the CURRENT merge-base of `git_flow.base_branch`
    and the dependency epic's own branch — not the base branch's tip.

    `reason` is one of: `not-tracked` (either field absent — legacy/no-op),
    `legacy-non-sha-placeholder` (planned_base_ref predates canonicalization
    and isn't a resolvable SHA), `cannot-resolve` (git couldn't resolve the
    dependency branch or the merge-base — fails open, not required, so a
    broken git state never blocks execute), `base-unchanged`, `base-moved`.
    """
    depends_on = normalize_depends_on_epic(epic.get("depends_on_epic"))
    planned_base_ref = epic.get("planned_base_ref")
    base_branch = (epic.get("git_flow") or {}).get("base_branch")

    if not depends_on or not planned_base_ref:
        return {
            "required": False,
            "reason": "not-tracked",
            "planned_base_ref": planned_base_ref,
            "current_base_ref": None,
            "depends_on_epic": depends_on,
        }

    if not _looks_like_sha(str(planned_base_ref)):
        _log.info(
            "plan_drift: skipping reconciliation gate — planned_base_ref=%r "
            "is a legacy non-SHA placeholder (pre-dates wr-6 canonicalization)",
            planned_base_ref,
        )
        return {
            "required": False,
            "reason": "legacy-non-sha-placeholder",
            "planned_base_ref": planned_base_ref,
            "current_base_ref": None,
            "depends_on_epic": depends_on,
        }

    if not base_branch:
        base_branch = "develop"

    dependency_ref = None
    for epic_id in depends_on:
        dependency_ref = resolve_dependency_branch_ref(epic_id, cwd=cwd)
        if dependency_ref is not None:
            break

    current_base_ref = (
        resolve_current_merge_base(base_branch, dependency_ref, cwd=cwd)
        if dependency_ref is not None
        else None
    )

    if current_base_ref is None:
        return {
            "required": False,
            "reason": "cannot-resolve",
            "planned_base_ref": planned_base_ref,
            "current_base_ref": None,
            "depends_on_epic": depends_on,
        }

    required = not current_base_ref.startswith(str(planned_base_ref)) and not str(
        planned_base_ref
    ).startswith(current_base_ref)

    return {
        "required": required,
        "reason": "base-moved" if required else "base-unchanged",
        "planned_base_ref": planned_base_ref,
        "current_base_ref": current_base_ref,
        "depends_on_epic": depends_on,
    }


def emit_plan_drift(
    run_id: str,
    epic_id: str,
    delta_count: int,
    *,
    source: str = "plan-drift-helper",
    extra_dimensions: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Emit one `plan_drift_delta_count` event row — the per-epic delta
    count from a reconciliation artifact, readable by `/metrics`.

    Epic identity travels in the top-level `proposal_id` field, not
    `dimensions` — an epic id is a high-cardinality identifier
    (`.pHive/metrics/metrics-event.schema.md` §5 anti-bloat rule), and
    `proposal_id` is the approved top-level field for stable identity.
    `dimensions` is reserved for genuinely low-cardinality grouping
    labels passed in via `extra_dimensions`.
    """
    dimensions: dict[str, Any] = dict(extra_dimensions) if extra_dimensions else {}

    event: dict[str, Any] = {
        "event_id": f"evt_plan_drift_{uuid.uuid4().hex[:12]}",
        "timestamp": _now_iso(),
        "run_id": run_id,
        "metric_type": "plan_drift_delta_count",
        "value": delta_count,
        "unit": "deltas",
        "dimensions": dimensions,
        "source": source,
        "proposal_id": epic_id,
    }
    return append_event(event, run_id)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
