from __future__ import annotations

import importlib.util
import os
import re
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from hive.lib.config import read_emit_lifecycle_at


KG_WRITES_TOTAL_COUNTER = "kg_writes_total"
EMIT_LIFECYCLE_AT = read_emit_lifecycle_at()
DEFAULT_KG_SQLITE_PATH = Path.home() / ".claude" / "hive" / "kg.sqlite"

_kg_write_counter: dict[str, int] = defaultdict(int)
_metric_registry: Any | None = None
_registry_loaded = False


def sanitize_obj(value: Any) -> str:
    text = "" if value is None else str(value)
    text = re.sub(r'File\s+"[^"]+",\s+line\s+\d+(?:,\s+in\s+\S+)?', " ", text)
    text = re.sub(r"/[^\s:;,)\]}]+", " ", text)
    text = text.replace("\r", " ").replace("\n", " ")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text[:80].rstrip("-")


def emit_kg_event(
    *,
    subject: str,
    predicate: str,
    obj: str,
    source_epic: str,
    source_agent: str,
) -> dict[str, Any | bool | None]:
    if EMIT_LIFECYCLE_AT == "off":
        return {"emitted": False, "metadata": None}

    valid_from = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    metadata = {
        "subject": subject,
        "predicate": predicate,
        "object": obj,
        "source_epic": source_epic,
        "source_agent": source_agent,
        "valid_from": valid_from,
        "valid_until": None,
    }

    try:
        db_path = Path(os.environ.get("HIVE_KG_SQLITE_PATH", DEFAULT_KG_SQLITE_PATH))
        if not db_path.exists():
            return {"emitted": False, "metadata": None}
        with sqlite3.connect(str(db_path)) as conn:
            conn.execute(
                """
                INSERT OR IGNORE INTO triples
                  (subject, predicate, object, valid_from, source_epic, source_agent)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (subject, predicate, obj, valid_from, source_epic, source_agent),
            )
            conn.commit()
    except Exception:
        return {"emitted": False, "metadata": None}

    try:
        _increment_kg_writes_counter(predicate)
    except Exception:
        pass
    return {"emitted": True, "metadata": metadata}


def emit_superseded(
    *,
    subject: str,
    predicate: str,
    prior_object: str,
    new_object: str,
    source_epic: str,
    source_agent: str,
) -> dict[str, Any | bool | None]:
    if EMIT_LIFECYCLE_AT == "off":
        return {"emitted": False, "metadata": None}

    prior_obj = sanitize_obj(prior_object)
    new_obj = sanitize_obj(new_object)
    superseded_obj = f"{prior_obj}->{new_obj}"
    valid_from = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    metadata = {
        "subject": subject,
        "predicate": "superseded",
        "object": superseded_obj,
        "source_epic": source_epic,
        "source_agent": source_agent,
        "valid_from": valid_from,
        "valid_until": None,
        "superseded_subject": subject,
        "superseded_predicate": predicate,
        "prior_object": prior_obj,
        "new_object": new_obj,
        "prior_valid_until_updated": False,
    }

    try:
        db_path = Path(os.environ.get("HIVE_KG_SQLITE_PATH", DEFAULT_KG_SQLITE_PATH))
        if not db_path.exists():
            return {"emitted": False, "metadata": None}
        with sqlite3.connect(str(db_path)) as conn:
            cur = conn.execute(
                """
                UPDATE triples
                   SET valid_until = ?
                 WHERE subject = ?
                   AND predicate = ?
                   AND object = ?
                   AND valid_until IS NULL
                """,
                (valid_from, subject, predicate, prior_obj),
            )
            conn.execute(
                """
                INSERT OR IGNORE INTO triples
                  (subject, predicate, object, valid_from, source_epic, source_agent)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (subject, "superseded", superseded_obj, valid_from, source_epic, source_agent),
            )
            conn.commit()
            metadata["prior_valid_until_updated"] = cur.rowcount > 0
    except Exception:
        return {"emitted": False, "metadata": None}

    try:
        _increment_kg_writes_counter("superseded")
    except Exception:
        pass
    return {"emitted": True, "metadata": metadata}


def get_kg_writes_counter_snapshot() -> dict[str, dict[str, int]]:
    return {KG_WRITES_TOTAL_COUNTER: dict(_kg_write_counter)}


def reset_kg_writes_counter_for_test() -> None:
    _kg_write_counter.clear()


def _increment_kg_writes_counter(predicate: str) -> None:
    registry = _load_metric_registry()
    if registry is not None:
        try:
            if not registry.is_registered_counter(KG_WRITES_TOTAL_COUNTER):
                return
            if registry.counter_labels(KG_WRITES_TOTAL_COUNTER) != ("predicate",):
                return
        except Exception:
            return
    _kg_write_counter[predicate] += 1


def _load_metric_registry() -> Any | None:
    global _metric_registry, _registry_loaded
    if _registry_loaded:
        return _metric_registry
    _registry_loaded = True
    registry_path = (
        Path(__file__).resolve().parents[2]
        / "skills"
        / "hive"
        / "skills"
        / "meta-optimize"
        / "metric_registry.py"
    )
    try:
        spec = importlib.util.spec_from_file_location(
            "hive_metric_registry_for_kg_emit",
            registry_path,
        )
        if spec is None or spec.loader is None:
            return None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _metric_registry = module
    except Exception:
        _metric_registry = None
    return _metric_registry
