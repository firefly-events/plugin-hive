"""Roll up captured metrics, episodes, and snapshots for one deliverable.

The collector is the harness's read side: given a deliverable (epic id), it
reads every captured source — token/wall/gate events, the epic's story graph,
per-story episode records, and before/after file-tree snapshots — and
normalizes them into one ``report.json`` for the renderer (s4).

None of these sources are guaranteed to exist (metrics emit is opt-in, an
epic may have no episodes yet, snapshots may never have been captured for a
deliverable), so every section degrades to zero/empty rather than raising.

Stdlib-first: json is stdlib; yaml is an existing repo dependency (already
used by ``hive.lib.config``), loaded defensively so a missing install still
degrades instead of crashing.

CLI:
    python3 -m hive.lib.harness.collect --deliverable design-system
    python3 -m hive.lib.harness.collect --deliverable design-system --out report.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

try:  # pragma: no cover - depends on local optional dependency set
    import yaml  # type: ignore
except Exception:  # pragma: no cover - exercised when PyYAML unavailable
    yaml = None

from hive.lib.harness.snapshot import diff_snapshots, load_snapshot
from hive.lib.metrics.core import _validate_relative_identifier
from hive.lib.metrics.paths import get_metrics_root

# A handful of observed stop-hook wall_clock_ms rows carry a raw epoch-ms
# timestamp instead of an elapsed duration (emitter bug). Reject anything
# above a generous single-run ceiling rather than silently summing
# timestamps into the total.
_MAX_PLAUSIBLE_WALL_MS = 24 * 60 * 60 * 1000  # 24h


def _events_dir() -> Path:
    return get_metrics_root() / "events"


def _iter_event_rows(events_dir: Path) -> list[dict[str, Any]]:
    """Flatten every *.jsonl row under ``events_dir``; [] if the dir is absent."""
    if not events_dir.is_dir():
        return []
    rows: list[dict[str, Any]] = []
    for path in sorted(events_dir.glob("*.jsonl")):
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    row = json.loads(stripped)
                except json.JSONDecodeError:
                    continue
                # Executor telemetry (hive/lib/dag_executor/executor/telemetry.py)
                # shares this same metrics-root events/ directory but writes a
                # foreign schema (run_id/step_id/event_type/timestamp/payload)
                # with no metric_type key. Same stream, different validator —
                # skip those rows explicitly rather than let them get
                # misparsed downstream.
                if not isinstance(row, dict) or "metric_type" not in row:
                    continue
                rows.append(row)
    return rows


def _matches_deliverable(
    row: dict[str, Any], deliverable: str, story_ids: set[Any]
) -> bool:
    """Match when swarm_id is the epic, story_id is the epic, or story_id is one
    of the epic's stories.

    Real emitters tag story_id = the story and swarm_id = the epic
    (metrics-token-capture.sh, metrics-execute-boundaries.sh); the s1 gate
    emitter (user_gate.py) writes story_id = story with no swarm_id at all.
    An epic-id deliverable must therefore match on the epic's story-id set,
    not solely on story_id/swarm_id equalling the deliverable directly.

    Story ids are short (``s1``, ``s2``, ...) and recur across epics, so a
    row carrying a *different* epic's swarm_id must not fall through to the
    story-id-set match — that would mis-attribute another epic's ``s1`` row
    into this one.
    """
    swarm_id = row.get("swarm_id")
    if swarm_id == deliverable:
        return True
    story_id = row.get("story_id")
    if story_id == deliverable:
        return True
    if swarm_id is not None and swarm_id != deliverable:
        return False
    return story_id in story_ids


def _select_events(
    rows: list[dict[str, Any]], deliverable: str, story_ids: set[Any]
) -> list[dict[str, Any]]:
    return [row for row in rows if _matches_deliverable(row, deliverable, story_ids)]


def _as_number(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0
    return value


def _coerce_numeric(value: Any) -> tuple[bool, float]:
    """(is_numeric, number). Accepts int/float (not bool) and numeric strings."""
    if isinstance(value, bool):
        return False, 0
    if isinstance(value, (int, float)):
        return True, value
    if isinstance(value, str):
        try:
            return True, float(value)
        except ValueError:
            return False, 0
    return False, 0


def collect_tokens(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Sum per-dimension token counts; total = input + output."""
    totals = {"input": 0, "output": 0, "cache_read": 0, "cache_creation": 0}
    for row in rows:
        if row.get("metric_type") != "tokens":
            continue
        dims = row.get("dimensions") or {}
        if dims.get("attribution") == "skill_boundary":
            continue
        totals["input"] += _as_number(dims.get("input_tokens"))
        totals["output"] += _as_number(dims.get("output_tokens"))
        totals["cache_read"] += _as_number(dims.get("cache_read_input_tokens"))
        totals["cache_creation"] += _as_number(dims.get("cache_creation_input_tokens"))
    totals["total"] = totals["input"] + totals["output"]
    return totals


def _select_unscoped_skill_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Skill-boundary rows with no resolvable story/epic (``story_id ==
    "unscoped"``, mo-2's fallback for a direct ``/plan``-style invocation with
    no ``HIVE_STORY_ID``/``HIVE_SWARM_ID`` in the environment).

    ``_select_events`` matches rows against ONE epic's story-id set, so an
    unscoped row never matches any deliverable and would otherwise be
    silently dropped before ``collect_tokens_by_skill`` ever saw it — the
    collector would look like it "worked" while actually excluding every
    directly-invoked skill run. This is the explicit query path for that
    case: unscoped skill-boundary rows are attributed to *every* deliverable's
    tokens_by_skill view (there is no narrower scope to attribute them to),
    so a direct ``/plan`` run is visible from any `/metrics` invocation.
    """
    out = []
    for row in rows:
        if row.get("story_id") != "unscoped":
            continue
        dims = row.get("dimensions")
        if isinstance(dims, dict) and dims.get("attribution") == "skill_boundary":
            out.append(row)
    return out


def collect_tokens_by_skill(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Per-skill token rollup from mo-2 skill-boundary-attributed rows.

    Only rows with dimensions.attribution == "skill_boundary" count here —
    the legacy whole-session bundle rows (metrics-stop-dispatch.sh /
    metrics-token-capture.sh) carry no skill dimension and are excluded. The
    guard is bidirectional: ``collect_tokens``' aggregate total excludes
    skill-boundary rows, and this view excludes legacy rows, so neither
    double-counts the other.
    Returns {"by_skill": {skill: total_tokens}, "last_run": {skill: {run_id,
    timestamp, value}}} where "last_run" tracks the most recent (by
    timestamp) invocation per skill — e.g. "tokens for the last /plan run".
    """
    by_skill: dict[str, float] = {}
    last_run: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row.get("metric_type") != "tokens":
            continue
        dims = row.get("dimensions")
        if not isinstance(dims, dict):
            continue
        if dims.get("attribution") != "skill_boundary":
            continue
        skill = dims.get("skill")
        if not skill:
            continue
        value = _as_number(row.get("value"))
        by_skill[skill] = by_skill.get(skill, 0) + value
        timestamp = row.get("timestamp") or ""
        current = last_run.get(skill)
        if current is None or timestamp >= current.get("timestamp", ""):
            last_run[skill] = {
                "run_id": row.get("run_id"),
                "timestamp": timestamp,
                "value": value,
            }
    return {"by_skill": by_skill, "last_run": last_run}


def collect_human_gate(rows: list[dict[str, Any]]) -> tuple[Any, int]:
    """Sum human_gate_ms values and count the events; (0, 0) when none exist.

    Numeric strings (e.g. "1200") coerce to numbers. Rows whose value is not
    numeric (including bool) are skipped from BOTH the total and the count,
    so the two never disagree about which rows were counted.
    """
    total = 0
    count = 0
    for row in rows:
        if row.get("metric_type") != "human_gate_ms":
            continue
        is_numeric, value = _coerce_numeric(row.get("value"))
        if not is_numeric:
            continue
        total += value
        count += 1
    return total, count


def collect_wall_ms(rows: list[dict[str, Any]]) -> Any:
    """Sum wall_clock_ms values, rejecting implausible (epoch-ms-shaped) rows."""
    total = 0
    for row in rows:
        if row.get("metric_type") != "wall_clock_ms":
            continue
        value = _as_number(row.get("value"))
        if value < 0 or value > _MAX_PLAUSIBLE_WALL_MS:
            continue
        total += value
    return total


def _load_yaml_mapping(path: Path) -> dict[str, Any]:
    if yaml is None or not path.exists():
        return {}
    try:
        loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _episode_agents(deliverable: str, story_id: str, cwd: Path) -> list[dict[str, Any]]:
    """agents:[{persona,role,phase}] from every episode yaml for this story; [] if none."""
    story_dir = cwd / ".pHive" / "episodes" / deliverable / story_id
    if not story_dir.is_dir():
        return []
    agents: list[dict[str, Any]] = []
    seen: set[tuple[Any, Any, Any]] = set()
    for path in sorted(story_dir.glob("*.yaml")):
        doc = _load_yaml_mapping(path)
        for agent in doc.get("agents") or []:
            if not isinstance(agent, dict):
                continue
            entry = {
                "persona": agent.get("persona"),
                "role": agent.get("role"),
                "phase": agent.get("phase"),
            }
            key = (entry["persona"], entry["role"], entry["phase"])
            if key in seen:
                continue
            seen.add(key)
            agents.append(entry)
    return agents


def _load_epic(deliverable: str, cwd: Path) -> dict[str, Any]:
    return _load_yaml_mapping(cwd / ".pHive" / "epics" / deliverable / "epic.yaml")


def _epic_story_ids(epic: dict[str, Any]) -> set[Any]:
    return {
        story.get("id")
        for story in epic.get("stories") or []
        if isinstance(story, dict) and story.get("id")
    }


def build_flow(deliverable: str, cwd: Path, epic: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """flow[{step, agents, depends_on}] from epic.yaml stories[]; [] if no epic."""
    epic = _load_epic(deliverable, cwd) if epic is None else epic
    flow: list[dict[str, Any]] = []
    for story in epic.get("stories") or []:
        if not isinstance(story, dict):
            continue
        story_id = story.get("id")
        flow.append(
            {
                "step": story_id,
                "agents": _episode_agents(deliverable, story_id, cwd) if story_id else [],
                "depends_on": list(story.get("depends_on") or []),
            }
        )
    return flow


def build_files(deliverable: str, repo: Path) -> dict[str, Any] | None:
    """{before_sha,after_sha,added,counts} via snapshot.py; None if no snapshot pair.

    Convention: snapshot labels are ``<deliverable>-before`` / ``<deliverable>-after``.
    """
    before_label, after_label = f"{deliverable}-before", f"{deliverable}-after"
    try:
        before = load_snapshot(before_label, repo)
        after = load_snapshot(after_label, repo)
    except FileNotFoundError:
        return None
    diff = diff_snapshots(before, after)
    return {
        "before_sha": before["git"]["sha"],
        "after_sha": after["git"]["sha"],
        "added": diff["files_added"],
        "counts": after["files"]["by_top_dir"],
    }


def collect_report(deliverable: str, repo: Path | None = None) -> dict[str, Any]:
    """Assemble the normalized report.json dict for ``deliverable``."""
    _validate_relative_identifier(deliverable, "deliverable")
    repo = repo or Path.cwd()
    epic = _load_epic(deliverable, repo)
    story_ids = _epic_story_ids(epic)
    all_rows = _iter_event_rows(_events_dir())
    rows = _select_events(all_rows, deliverable, story_ids)
    human_gate_ms_total, gate_count = collect_human_gate(rows)
    skill_rows = rows + _select_unscoped_skill_rows(all_rows)

    return {
        "deliverable": deliverable,
        "wall_ms_total": collect_wall_ms(rows),
        "human_gate_ms_total": human_gate_ms_total,
        "gate_count": gate_count,
        "tokens": collect_tokens(rows),
        "tokens_by_skill": collect_tokens_by_skill(skill_rows),
        "flow": build_flow(deliverable, repo, epic=epic),
        "files": build_files(deliverable, repo),
    }


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--deliverable", required=True, help="epic/deliverable id")
    parser.add_argument("--out", default=None, help="output path (default: stdout)")
    parser.add_argument("--repo", default=None, help="repo root (default: cwd)")
    args = parser.parse_args(argv)

    repo = Path(args.repo).resolve() if args.repo else Path.cwd()
    report = collect_report(args.deliverable, repo)
    payload = json.dumps(report, indent=2) + "\n"

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(payload, encoding="utf-8")
        print(f"report '{args.deliverable}' -> {out_path}")
    else:
        print(payload, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
