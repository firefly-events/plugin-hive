"""Active predicates for untracked runtime artifact classes.

Each predicate answers: "is this artifact still active?" (True = do NOT evict).
Predicates are keyed by the string stored in RegistryEntry.active_predicate so
that registry entries reference predicates by name without importing this module.

Design decisions consumed:
  D1 — untracked sweep only; action = evict.
  D5 — age is checked separately (mtime for untracked); predicates check
       active-state, not age.

Thresholds (from design-decisions open-question ruling §1):
  30d — completed DAG runs, consumed interrupts
  60d — metrics after observation windows
  90d — context snapshots, staged insights post-promote/discard, scratch
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Callable


class PredicateError(ValueError):
    pass


# ---------------------------------------------------------------------------
# Individual predicate functions
# Each returns True  → artifact is ACTIVE (do NOT evict)
#                False → artifact is inactive (eligible for eviction if old)
# ---------------------------------------------------------------------------


def dag_run_active(path: Path) -> bool:
    """True if the DAG run-state dir is running, suspended, or failed.

    Reads <run-dir>/run_state.yaml. If the file is absent or unreadable,
    treats the run as active (safe default — never evict unknown state).
    """
    try:
        import yaml  # type: ignore
    except ImportError:
        return True  # can't read; treat as active

    state_file = path / "run_state.yaml"
    if not state_file.is_file():
        # Not a run dir we recognise; skip conservatively.
        return True
    try:
        with state_file.open("r", encoding="utf-8") as fh:
            payload = yaml.safe_load(fh) or {}
    except Exception:
        return True  # unreadable → active

    status = payload.get("status", "running")
    # Only "completed" is terminal and eligible. running/suspended/failed are active.
    return status != "completed"


def metrics_stream_not_consumed(path: Path) -> bool:
    """True if the metrics stream file has NOT been marked consumed.

    Convention: a `.consumed` sidecar file next to the JSONL marks it consumed.
    If the sidecar exists → inactive (eviction eligible). Otherwise → active.
    """
    consumed_marker = path.with_suffix(path.suffix + ".consumed")
    return not consumed_marker.exists()


def interrupt_not_acknowledged(path: Path) -> bool:
    """True if the interrupt YAML has NOT been acknowledged.

    An acknowledged interrupt has an `acknowledged_at` key in the YAML.
    Missing file or unreadable → treat as active (safe default).
    """
    if not path.is_file():
        return True
    try:
        import yaml  # type: ignore

        with path.open("r", encoding="utf-8") as fh:
            payload = yaml.safe_load(fh) or {}
    except Exception:
        return True

    return not bool(payload.get("acknowledged_at"))


def insight_staged(path: Path) -> bool:
    """True if the staged insight has NOT been promoted or discarded.

    Reads the YAML frontmatter block (--- … ---) in the Markdown file.
    If `promoted_at` is set OR `discarded: true` → inactive (evictable).
    Otherwise → still staged (active).
    """
    if not path.is_file():
        return True
    try:
        content = path.read_text(encoding="utf-8")
    except Exception:
        return True

    fm = _parse_frontmatter(content)
    if fm is None:
        return True  # no frontmatter → treat as staged (active)

    if fm.get("promoted_at"):
        return False  # promoted → inactive
    if fm.get("discarded"):
        return False  # discarded → inactive
    return True  # still staged → active


def chroma_sidecar_active(path: Path) -> bool:
    """True if the ChromaDB sidecar belongs to a live process.

    Checks whether the PID recorded in `~/.claude/hive/chromadb.pid` (or a
    sibling `chromadb.pid` when `path` is one of the sidecar files) maps to
    a running process. If any pid file indicates a live Chroma process, all
    sidecar files at that installation are considered active.

    Falls back to True (active) when the PID file is missing or unreadable to
    avoid evicting a sidecar that may be in use.
    """
    # Locate the pid file relative to the given sidecar path.
    pid_file = path.parent / "chromadb.pid"
    if not pid_file.is_file():
        # No pid file — Chroma is not running, sidecar is inactive.
        return False
    try:
        pid = int(pid_file.read_text(encoding="utf-8").strip())
    except Exception:
        return True  # unreadable pid → treat as active

    return _pid_alive(pid)


def never_active(_path: Path) -> bool:
    """Artifact has no active-state signal; eligible for eviction when old."""
    return False


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

PREDICATE_REGISTRY: dict[str, Callable[[Path], bool]] = {
    "dag-run-active": dag_run_active,
    "metrics-stream-not-consumed": metrics_stream_not_consumed,
    "interrupt-not-acknowledged": interrupt_not_acknowledged,
    "insight-staged": insight_staged,
    "chroma-sidecar-active": chroma_sidecar_active,
    "never-active": never_active,
}


def resolve_predicate(name: str) -> Callable[[Path], bool]:
    """Return the predicate callable for *name*, or raise PredicateError."""
    try:
        return PREDICATE_REGISTRY[name]
    except KeyError:
        known = sorted(PREDICATE_REGISTRY)
        raise PredicateError(
            f"Unknown active_predicate {name!r}. Known predicates: {known}"
        )


def is_active(predicate_name: str, path: Path) -> bool:
    """Return True if *path* is still active under *predicate_name*."""
    fn = resolve_predicate(predicate_name)
    return fn(path)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def _parse_frontmatter(content: str) -> dict | None:
    m = _FRONTMATTER_RE.match(content)
    if not m:
        return None
    try:
        import yaml  # type: ignore

        return yaml.safe_load(m.group(1)) or {}
    except Exception:
        return None


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        # Process exists but we don't own it — still alive.
        return True
    except OSError:
        return False


__all__ = [
    "PREDICATE_REGISTRY",
    "PredicateError",
    "is_active",
    "resolve_predicate",
    # Individual predicates exposed for direct use in tests.
    "chroma_sidecar_active",
    "dag_run_active",
    "insight_staged",
    "interrupt_not_acknowledged",
    "metrics_stream_not_consumed",
    "never_active",
]
