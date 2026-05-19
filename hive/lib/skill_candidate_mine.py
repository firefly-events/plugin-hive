"""Skill-candidate signal mining (story se-4-signal-mining).

Reads four signal sources and emits a normalized, deterministic list of
pattern observations. Ranking and the /find-skills handoff live in
sister story se-5 — this module is observation-only.

Signal sources
--------------
1. ``.pHive/metrics/events/*.jsonl`` — metric events grouped by
   ``agent|metric_type|phase``.
2. ``.pHive/kg.sqlite``               — KG triples grouped by
   ``predicate|subject_namespace`` (silent skip if absent).
3. ``git log`` (last 200 commits)     — conventional-commit subjects
   grouped by ``type(scope)``.
4. ``.pHive/cycle-state/*.yaml``      — escalation entries grouped by
   ``trigger|placement|severity``.

Each observation has the shape::

    {
      "pattern_signature": str,
      "occurrence_count": int,
      "recent_examples": [str, ...],   # <= 3, most-recent first
      "source_kind": str,              # one of the source labels
      "first_seen": str,               # ISO-8601 or '' when unavailable
      "last_seen": str,
    }

A pattern is included only when it recurs (count >= 2). Singletons are
not "patterns" and would dilute ranking in se-5.

Maturity gate
-------------
``mine()`` calls ``hive.lib.project_maturity.resolve_maturity()`` from
story ed-1 and returns ``[]`` when the project is greenfield or early,
logging one line. The ed-1 helper is consumed defensively: if it is
absent from the working tree (e.g., the helper has not yet landed on
this branch), the gate falls through assuming ``established`` so the
module stays importable in isolation.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

try:  # PyYAML is an optional dep for cycle-state reading
    import yaml  # type: ignore
except Exception:  # pragma: no cover - exercised when PyYAML unavailable
    yaml = None

try:
    from hive.lib.project_maturity import resolve_maturity as _resolve_maturity
except Exception:  # ed-1 helper may not be on this branch yet — soft default
    def _resolve_maturity(profile_path: Any | None = None) -> str:  # type: ignore[misc]
        return "established"


__all__ = ["mine", "Observation"]

_log = logging.getLogger(__name__)

SKIP_MATURITIES = frozenset({"greenfield", "early"})
DEFAULT_STATE_DIR = Path(".pHive")
DEFAULT_GIT_LOG_LIMIT = 200
MIN_OCCURRENCES = 2
MAX_EXAMPLES = 3
MAX_EXAMPLE_LEN = 120

_CONVENTIONAL_COMMIT = re.compile(
    r"^(?P<type>feat|fix|docs|chore|refactor|test|tests|style|perf|build|ci|revert)"
    r"(\((?P<scope>[^)]+)\))?:"
)

SOURCE_METRIC_EVENT = "metric_event"
SOURCE_KG_TRIPLE = "kg_triple"
SOURCE_COMMIT = "commit"
SOURCE_CYCLE_ESCALATION = "cycle_escalation"


@dataclass(frozen=True)
class Observation:
    """One pattern observation. ``recent_examples`` is most-recent first."""

    pattern_signature: str
    occurrence_count: int
    recent_examples: tuple[str, ...]
    source_kind: str
    first_seen: str
    last_seen: str


def mine(
    state_dir: str | Path | None = None,
    *,
    project_root: str | Path | None = None,
    git_log_limit: int = DEFAULT_GIT_LOG_LIMIT,
) -> list[dict[str, Any]]:
    """Mine recurring patterns from the four signal sources.

    Returns a deterministic, sorted list of observation dicts. Empty
    list when project maturity is greenfield/early (gate skip).
    """
    state = Path(state_dir) if state_dir is not None else DEFAULT_STATE_DIR
    repo = Path(project_root) if project_root is not None else Path.cwd()

    profile_path = state / "project-profile.yaml"
    maturity = _resolve_maturity(profile_path)
    if maturity in SKIP_MATURITIES:
        _log.info("skip: %s maturity", maturity)
        return []

    observations: list[Observation] = []
    observations.extend(_mine_events(state / "metrics" / "events"))
    observations.extend(_mine_kg(state / "kg.sqlite"))
    observations.extend(_mine_commits(repo, git_log_limit))
    observations.extend(_mine_cycle_state(state / "cycle-state"))

    observations.sort(key=lambda o: (o.source_kind, o.pattern_signature))
    return [_observation_to_dict(o) for o in observations]


def _observation_to_dict(o: Observation) -> dict[str, Any]:
    d = asdict(o)
    d["recent_examples"] = list(o.recent_examples)
    return d


class _Bucket:
    __slots__ = ("count", "examples", "first_seen", "last_seen")

    def __init__(self) -> None:
        self.count = 0
        # (timestamp, example_text) — finalized at emit time
        self.examples: list[tuple[str, str]] = []
        self.first_seen = ""
        self.last_seen = ""

    def observe(self, *, timestamp: str, example: str) -> None:
        self.count += 1
        if timestamp:
            if not self.first_seen or timestamp < self.first_seen:
                self.first_seen = timestamp
            if timestamp > self.last_seen:
                self.last_seen = timestamp
        self.examples.append((timestamp or "", example[:MAX_EXAMPLE_LEN]))

    def finalize_examples(self) -> tuple[str, ...]:
        # Most-recent first; tie-break by example text for determinism.
        ordered = sorted(self.examples, key=lambda e: (e[0], e[1]), reverse=True)
        seen: set[str] = set()
        out: list[str] = []
        for _, text in ordered:
            if text in seen:
                continue
            seen.add(text)
            out.append(text)
            if len(out) >= MAX_EXAMPLES:
                break
        return tuple(out)


def _emit(
    buckets: dict[str, _Bucket],
    *,
    source_kind: str,
    min_occurrences: int = MIN_OCCURRENCES,
) -> list[Observation]:
    out: list[Observation] = []
    for sig, b in buckets.items():
        if b.count < min_occurrences:
            continue
        out.append(
            Observation(
                pattern_signature=sig,
                occurrence_count=b.count,
                recent_examples=b.finalize_examples(),
                source_kind=source_kind,
                first_seen=b.first_seen,
                last_seen=b.last_seen,
            )
        )
    return out


def _mine_events(events_dir: Path) -> list[Observation]:
    if not events_dir.exists():
        _log.debug("skip metric events: %s not present", events_dir)
        return []

    buckets: dict[str, _Bucket] = {}
    for path in sorted(events_dir.glob("*.jsonl")):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as exc:
            _log.warning("skip events file %s: %s", path.name, exc)
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except (json.JSONDecodeError, ValueError) as exc:
                _log.warning(
                    "skip malformed jsonl row %s:%d: %s",
                    path.name,
                    lineno,
                    exc,
                )
                continue
            if not isinstance(row, dict):
                _log.warning(
                    "skip non-object jsonl row %s:%d", path.name, lineno
                )
                continue

            agent = str(row.get("agent") or "unknown")
            metric_type = str(row.get("metric_type") or "unknown")
            phase = str(row.get("phase") or "unknown")
            sig = f"event:{agent}|{metric_type}|{phase}"
            timestamp = str(row.get("timestamp") or "")
            example = str(row.get("event_id") or row.get("run_id") or sig)

            buckets.setdefault(sig, _Bucket()).observe(
                timestamp=timestamp, example=example
            )
    return _emit(buckets, source_kind=SOURCE_METRIC_EVENT)


def _mine_kg(db_path: Path) -> list[Observation]:
    if not db_path.exists():
        _log.debug("skip kg: %s not present", db_path)
        return []
    try:
        with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as conn:
            cur = conn.execute(
                "SELECT subject, predicate, valid_from FROM triples"
            )
            rows = cur.fetchall()
    except sqlite3.Error as exc:
        _log.warning("skip kg: %s", exc)
        return []

    buckets: dict[str, _Bucket] = {}
    for subject, predicate, valid_from in rows:
        subject_str = str(subject or "")
        predicate_str = str(predicate or "unknown")
        namespace = subject_str.split(":", 1)[0] if ":" in subject_str else "_"
        sig = f"kg:{predicate_str}|{namespace}"
        buckets.setdefault(sig, _Bucket()).observe(
            timestamp=str(valid_from or ""),
            example=f"{subject_str} -> {predicate_str}",
        )
    return _emit(buckets, source_kind=SOURCE_KG_TRIPLE)


def _mine_commits(repo_root: Path, limit: int) -> list[Observation]:
    try:
        result = subprocess.run(
            [
                "git",
                "log",
                f"-{int(limit)}",
                "--pretty=format:%H%x09%cI%x09%s",
                "--no-merges",
            ],
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        _log.warning("skip commits: %s", exc)
        return []
    if result.returncode != 0:
        _log.warning(
            "skip commits: git log returncode=%d %s",
            result.returncode,
            (result.stderr or "").strip(),
        )
        return []

    buckets: dict[str, _Bucket] = {}
    for line in result.stdout.splitlines():
        parts = line.split("\t", 2)
        if len(parts) != 3:
            continue
        _sha, timestamp, subject = parts
        subject = subject.strip()
        if not subject:
            continue
        match = _CONVENTIONAL_COMMIT.match(subject)
        if match:
            ctype = match.group("type")
            scope = (match.group("scope") or "_").strip()
            sig = f"commit:{ctype}({scope})"
        else:
            sig = "commit:_unstructured"
        buckets.setdefault(sig, _Bucket()).observe(
            timestamp=timestamp, example=subject
        )
    return _emit(buckets, source_kind=SOURCE_COMMIT)


def _mine_cycle_state(cycle_dir: Path) -> list[Observation]:
    if not cycle_dir.exists():
        _log.debug("skip cycle-state: %s not present", cycle_dir)
        return []
    if yaml is None:
        _log.warning("skip cycle-state: PyYAML not installed")
        return []

    buckets: dict[str, _Bucket] = {}
    for path in sorted(cycle_dir.glob("*.yaml")):
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
        except (OSError, yaml.YAMLError) as exc:
            _log.warning("skip cycle-state %s: %s", path.name, exc)
            continue
        if not isinstance(data, dict):
            continue
        epic = str(data.get("epic") or path.stem)
        created = str(data.get("created_at") or "")
        escalations = data.get("escalations") or []
        if not isinstance(escalations, list):
            continue
        for esc in escalations:
            if not isinstance(esc, dict):
                continue
            trigger = str(esc.get("trigger") or "unknown")
            placement = str(esc.get("placement") or "unknown")
            severity = str(esc.get("severity") or "unknown")
            timestamp = str(esc.get("raised_at") or created)
            sig = f"escalation:{trigger}|{placement}|{severity}"
            buckets.setdefault(sig, _Bucket()).observe(
                timestamp=timestamp,
                example=f"{epic}: {trigger}",
            )
    return _emit(buckets, source_kind=SOURCE_CYCLE_ESCALATION)
