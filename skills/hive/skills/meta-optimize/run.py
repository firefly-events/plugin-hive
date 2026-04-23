from __future__ import annotations

import importlib.util
from pathlib import Path
import subprocess
import sys
from typing import Any

import yaml

MODULE_REPO_ROOT = Path(__file__).resolve().parents[4]
REPO_ROOT = MODULE_REPO_ROOT

_META_EXPERIMENT = None


def _load_meta_experiment():
    original_sys_path = list(sys.path)
    module_dir = MODULE_REPO_ROOT / "hive/lib/meta-experiment"
    init_path = module_dir / "__init__.py"
    spec = importlib.util.spec_from_file_location(
        "hive.lib.meta_experiment",
        init_path,
        submodule_search_locations=[str(module_dir)],
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to build import spec for meta-experiment package")
    try:
        if str(MODULE_REPO_ROOT) not in sys.path:
            sys.path.insert(0, str(MODULE_REPO_ROOT))
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path[:] = original_sys_path


def _get_meta_experiment():
    global _META_EXPERIMENT
    if _META_EXPERIMENT is None:
        _META_EXPERIMENT = _load_meta_experiment()
    return _META_EXPERIMENT


def _get_export(name: str):
    missing = object()
    value = globals().get(name, missing)
    if value is not missing:
        return value
    module = _get_meta_experiment()
    value = getattr(module, name)
    globals()[name] = value
    return value


def __getattr__(name: str):
    if name in {"PrPromotionAdapter", "PromotionFailure", "baseline", "closure_validator", "compare"}:
        return _get_export(name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


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
    target_root = Path(target_project).resolve()
    config = _load_yaml_file(target_root / "hive.config.yaml")
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
    compare_module = _get_export("compare")
    baseline_module = _get_export("baseline")
    closure_validator_module = _get_export("closure_validator")
    adapter_cls = _get_export("PrPromotionAdapter")
    promotion_failure_cls = _get_export("PromotionFailure")

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
        proposal_source = "metrics"
    else:
        selected_candidate = select_backlog_candidate(backlog_candidates)
        cycle_mode = "backlog_fallback" if metrics_enabled else "backlog_only"
        proposal_source = "backlog"

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

    threshold_pct = _coerce_threshold(meta_config.get("threshold_pct"), default=10.0)
    compare_result = compare_module.evaluate(baseline_metrics, candidate_metrics, threshold_pct)
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

    adapter = adapter_cls(repo_path=target_root)
    try:
        promotion = adapter.promote(envelope, {"verdict": promotion_verdict})
    except promotion_failure_cls as error:
        rollback_ref = getattr(error, "rollback_ref", None)
        rollback_target = getattr(error, "rollback_target", None)
        close_record = {
            "experiment_id": experiment_id,
            "decision": "reject",
            "pr_ref": None,
            "pr_state": None,
            "rollback_ref": rollback_ref or rollback_target,
            "rollback_target": rollback_target,
            "baseline_metrics": baseline_metrics,
            "candidate_metrics": candidate_metrics,
            "metrics_snapshot": candidate_metrics,
        }
        closure_validator_module.validate_closable(close_record)
        return {
            "target_project": str(target_root),
            "kickoff_metrics_enabled": metrics_enabled,
            "mode": "rejected",
            "proposal_source": proposal_source,
            "selected_candidate": selected_candidate,
            "compare_result": compare_result,
            "close_record": close_record,
            "adapter": type(adapter).__name__,
            "failure_reason": getattr(error, "reason", str(error)),
        }

    close_record = {
        "experiment_id": experiment_id,
        "decision": compare_result["verdict"],
        "pr_ref": promotion.evidence.pr_ref,
        "pr_state": promotion.evidence.pr_state,
        "rollback_ref": promotion.rollback_target,
        "rollback_target": promotion.rollback_target,
        "baseline_metrics": baseline_metrics,
        "candidate_metrics": candidate_metrics,
        "metrics_snapshot": candidate_metrics,
    }
    closure_validator_module.validate_closable(close_record)

    return {
        "target_project": str(target_root),
        "kickoff_metrics_enabled": metrics_enabled,
        "mode": cycle_mode,
        "proposal_source": proposal_source,
        "selected_candidate": selected_candidate,
        "compare_result": compare_result,
        "close_record": close_record,
        "adapter": type(adapter).__name__,
    }


def _load_baseline_metrics(meta_config: dict[str, Any]) -> dict[str, Any]:
    prior_run_id = _string_value(meta_config.get("prior_run_id"))
    if prior_run_id:
        snapshot = _get_export("baseline").capture_from_run(prior_run_id)
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
    parsed = yaml.safe_load(path.read_text(encoding="utf-8"))
    return parsed if isinstance(parsed, dict) else {}


__all__ = [
    "load_backlog_candidates",
    "read_kickoff_metrics_state",
    "resolve_target_project",
    "run_public_cycle",
    "select_backlog_candidate",
]
