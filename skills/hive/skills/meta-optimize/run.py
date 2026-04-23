from __future__ import annotations

import importlib.util
from pathlib import Path
import subprocess
import sys
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def _load_meta_experiment():
    module_dir = REPO_ROOT / "hive/lib/meta-experiment"
    init_path = module_dir / "__init__.py"
    spec = importlib.util.spec_from_file_location(
        "hive.lib.meta_experiment",
        init_path,
        submodule_search_locations=[str(module_dir)],
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to build import spec for meta-experiment package")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


META_EXPERIMENT = _load_meta_experiment()
PrPromotionAdapter = META_EXPERIMENT.PrPromotionAdapter
baseline = META_EXPERIMENT.baseline
closure_validator = META_EXPERIMENT.closure_validator
compare = META_EXPERIMENT.compare


def resolve_target_project() -> Path:
    config = _load_yaml_file(REPO_ROOT / "hive.config.yaml")
    target_project = _nested_get(config, "paths", "target_project")
    cwd = Path.cwd()
    if not isinstance(target_project, str) or not target_project.strip():
        return cwd.resolve()
    candidate = Path(target_project)
    if not candidate.is_absolute():
        candidate = cwd / candidate
    return candidate.resolve()


def read_kickoff_metrics_state(target_project: Path) -> bool:
    # Kickoff/runtime docs currently split between the root consumer override and
    # the shipped fallback config, so read both and prefer the root override.
    target_root = Path(target_project).resolve()
    for config_path in (target_root / "hive.config.yaml", target_root / "hive/hive.config.yaml"):
        config = _load_yaml_file(config_path)
        enabled = _nested_get(config, "metrics", "enabled")
        if isinstance(enabled, bool):
            return enabled
        if isinstance(enabled, str) and enabled.strip():
            return enabled.strip().lower() == "true"
    return False


def load_backlog_candidates(target_project: Path) -> list[dict[str, Any]]:
    backlog_path = Path(target_project).resolve() / ".pHive/meta-team/queue-meta-optimize.yaml"
    backlog = _load_yaml_file(backlog_path)
    candidates = backlog.get("candidates")
    if not isinstance(candidates, list):
        return []
    return [entry for entry in candidates if isinstance(entry, dict)]


def select_backlog_candidate(candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    for entry in candidates:
        if entry.get("status") == "pending":
            return entry
    return None


def run_public_cycle(target_project: Path) -> dict[str, Any]:
    target_root = Path(target_project).resolve()
    _assert_clean_git_repo(target_root)

    metrics_enabled = read_kickoff_metrics_state(target_root)
    backlog_candidates = load_backlog_candidates(target_root)
    profile = _load_yaml_file(target_root / ".pHive/project-profile.yaml")
    meta_optimize = profile.get("meta_optimize")
    meta_config = meta_optimize if isinstance(meta_optimize, dict) else {}

    selected_candidate: dict[str, Any] | None = None
    ranked_proposals = meta_config.get("ranked_proposals")
    if metrics_enabled and isinstance(ranked_proposals, list) and ranked_proposals:
        selected_candidate = ranked_proposals[0] if isinstance(ranked_proposals[0], dict) else None
        cycle_mode = "metrics"
    else:
        selected_candidate = select_backlog_candidate(backlog_candidates)
        cycle_mode = "backlog_fallback" if metrics_enabled else "backlog_only"

    if selected_candidate is None:
        if metrics_enabled:
            raise RuntimeError("metrics signal insufficient and no backlog candidate is available")
        raise RuntimeError("kickoff metrics are disabled and no backlog candidate is available")

    baseline_metrics = _load_baseline_metrics(meta_config)
    candidate_metrics = _coerce_metric_dict(
        meta_config.get("candidate_metrics") or selected_candidate.get("candidate_metrics")
    )
    if not baseline_metrics:
        raise RuntimeError("baseline metrics are unavailable for the public cycle")
    if not candidate_metrics:
        raise RuntimeError("candidate metrics are unavailable for the public cycle")

    threshold_pct = _coerce_threshold(meta_config.get("threshold_pct"), default=0.10)
    compare_result = compare.evaluate(baseline_metrics, candidate_metrics, threshold_pct)
    promotion_verdict = "pass" if compare_result["verdict"] == "accept" else "needs_revision"

    experiment_id = _string_value(meta_config.get("experiment_id")) or f"meta-optimize-{target_root.name}"
    envelope = {
        "experiment_id": experiment_id,
        "candidate_ref": _string_value(meta_config.get("candidate_ref")) or "HEAD",
        "target_branch": _string_value(meta_config.get("target_branch")) or _git(target_root, "rev-parse", "--abbrev-ref", "HEAD"),
        "worktree_path": _string_value(meta_config.get("worktree_path"))
        or str(target_root / ".pHive/meta-team/worktrees" / experiment_id),
        "promotion_mode": "pr",
    }

    adapter = PrPromotionAdapter(repo_path=target_root)
    promotion = adapter.promote(envelope, {"verdict": promotion_verdict})

    close_record = {
        "experiment_id": experiment_id,
        "decision": compare_result["verdict"],
        "pr_ref": promotion.evidence.pr_ref,
        "pr_state": promotion.evidence.pr_state,
        "rollback_ref": promotion.rollback_target,
        "rollback_target": promotion.rollback_target,
        "metrics_snapshot": candidate_metrics,
    }
    closure_validator.validate_closable(close_record)

    return {
        "target_project": str(target_root),
        "mode": cycle_mode,
        "selected_candidate": selected_candidate,
        "compare_result": compare_result,
        "close_record": close_record,
        "adapter": type(adapter).__name__,
    }


def _load_baseline_metrics(meta_config: dict[str, Any]) -> dict[str, Any]:
    prior_run_id = _string_value(meta_config.get("prior_run_id"))
    if prior_run_id:
        snapshot = baseline.capture_from_run(prior_run_id)
        if isinstance(snapshot, dict):
            snapshot_metrics = _coerce_metric_dict(snapshot.get("metrics"))
            if snapshot_metrics:
                return snapshot_metrics
    return _coerce_metric_dict(meta_config.get("baseline_metrics"))


def _assert_clean_git_repo(repo_path: Path) -> None:
    if not (repo_path / ".git").exists():
        raise RuntimeError(f"target project is not a git repository: {repo_path}")
    status = _git(repo_path, "status", "--porcelain")
    if status.strip():
        raise RuntimeError(f"target project working tree is not clean: {repo_path}")


def _git(cwd: Path, *args: str) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def _coerce_threshold(value: Any, *, default: float) -> float:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, str) and value.strip():
        return float(value.strip())
    return default


def _coerce_metric_dict(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return {str(key): metric for key, metric in value.items()}


def _nested_get(data: dict[str, Any], *keys: str) -> Any:
    current: Any = data
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _string_value(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _load_yaml_file(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    parsed = _parse_simple_yaml(path.read_text(encoding="utf-8"))
    return parsed if isinstance(parsed, dict) else {}


def _parse_simple_yaml(text: str) -> Any:
    lines = []
    for raw_line in text.splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        lines.append(raw_line.rstrip())
    if not lines:
        return {}
    parsed, next_index = _parse_block(lines, 0, _line_indent(lines[0]))
    if next_index != len(lines):
        raise ValueError("unparsed yaml content remains")
    return parsed


def _parse_block(lines: list[str], index: int, indent: int) -> tuple[Any, int]:
    if _content(lines[index]).startswith("- "):
        return _parse_list(lines, index, indent)
    return _parse_mapping(lines, index, indent)


def _parse_mapping(lines: list[str], index: int, indent: int) -> tuple[dict[str, Any], int]:
    result: dict[str, Any] = {}
    cursor = index
    while cursor < len(lines):
        line = lines[cursor]
        current_indent = _line_indent(line)
        if current_indent < indent:
            break
        if current_indent > indent:
            raise ValueError(f"unexpected indentation at line: {line}")
        body = _content(line)
        if body.startswith("- "):
            break
        key, _, remainder = body.partition(":")
        key = key.strip()
        remainder = remainder.strip()
        cursor += 1
        if remainder:
            result[key] = _parse_scalar(remainder)
            continue
        if cursor >= len(lines):
            result[key] = {}
            continue
        next_indent = _line_indent(lines[cursor])
        if next_indent <= indent and not _content(lines[cursor]).startswith("- "):
            result[key] = {}
            continue
        child_indent = next_indent if next_indent > indent else indent
        child, cursor = _parse_block(lines, cursor, child_indent)
        result[key] = child
    return result, cursor


def _parse_list(lines: list[str], index: int, indent: int) -> tuple[list[Any], int]:
    items: list[Any] = []
    cursor = index
    while cursor < len(lines):
        line = lines[cursor]
        current_indent = _line_indent(line)
        if current_indent < indent:
            break
        if current_indent != indent:
            raise ValueError(f"unexpected indentation at line: {line}")
        body = _content(line)
        if not body.startswith("- "):
            break
        entry = body[2:].strip()
        cursor += 1
        if not entry:
            child, cursor = _parse_block(lines, cursor, _line_indent(lines[cursor]))
            items.append(child)
            continue
        if ":" in entry:
            key, _, remainder = entry.partition(":")
            item: dict[str, Any] = {key.strip(): _parse_scalar(remainder.strip()) if remainder.strip() else {}}
            if cursor < len(lines) and _line_indent(lines[cursor]) > indent:
                child, cursor = _parse_block(lines, cursor, _line_indent(lines[cursor]))
                if isinstance(child, dict):
                    existing = item.get(key.strip())
                    if existing == {}:
                        item[key.strip()] = child
                    else:
                        item.update(child)
                else:
                    raise ValueError("list item child must be a mapping")
            items.append(item)
            continue
        items.append(_parse_scalar(entry))
    return items, cursor


def _parse_scalar(value: str) -> Any:
    if value in {"[]", "{}"}:
        return [] if value == "[]" else {}
    lowered = value.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    if lowered in {"null", "none"}:
        return None
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        pass
    return value


def _line_indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _content(line: str) -> str:
    return line.lstrip(" ")


__all__ = [
    "load_backlog_candidates",
    "read_kickoff_metrics_state",
    "resolve_target_project",
    "run_public_cycle",
    "select_backlog_candidate",
]
