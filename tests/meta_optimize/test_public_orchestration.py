from __future__ import annotations

import importlib.util
from pathlib import Path
import subprocess
import sys

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[2]
RUN_PATH = ROOT / "skills/hive/skills/meta-optimize/run.py"
SKILL_PATH = ROOT / "skills/hive/skills/meta-optimize/SKILL.md"


def _load_module():
    module_name = "tests.meta_optimize._meta_optimize_run"
    spec = importlib.util.spec_from_file_location(module_name, RUN_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load meta-optimize run.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _load_meta_experiment():
    module_name = "tests.meta_optimize._meta_experiment"
    module_dir = ROOT / "hive/lib/meta-experiment"
    spec = importlib.util.spec_from_file_location(
        module_name,
        module_dir / "__init__.py",
        submodule_search_locations=[str(module_dir)],
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load meta-experiment package")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _write_yaml(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")


def _git(cwd: Path, *args: str) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def _init_repo(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    _git(path.parent, "init", str(path))
    _git(path, "config", "user.email", "tests@example.com")
    _git(path, "config", "user.name", "Plugin Hive Tests")
    _git(path, "checkout", "-b", "main")
    (path / "README.md").write_text("initial\n", encoding="utf-8")
    _git(path, "add", "README.md")
    _git(path, "commit", "-m", "initial commit")


def test_resolve_target_project_honors_root_config(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    module = _load_module()
    configured_target = tmp_path / "configured-target"
    configured_target.mkdir()
    invocation = tmp_path / "invocation"
    invocation.mkdir()
    _write_yaml(
        tmp_path / "hive.config.yaml",
        {"paths": {"target_project": str(configured_target)}},
    )

    monkeypatch.setattr(module, "REPO_ROOT", tmp_path)
    monkeypatch.chdir(invocation)

    assert module.resolve_target_project() == configured_target.resolve()


def test_resolve_target_project_falls_back_to_cwd(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    module = _load_module()
    invocation = tmp_path / "invocation"
    invocation.mkdir()
    _write_yaml(tmp_path / "hive.config.yaml", {"paths": {"target_project": None}})

    monkeypatch.setattr(module, "REPO_ROOT", tmp_path)
    monkeypatch.chdir(invocation)

    assert module.resolve_target_project() == invocation.resolve()


def test_read_kickoff_metrics_state_reads_true_and_defaults_false(tmp_path: Path) -> None:
    module = _load_module()
    target_enabled = tmp_path / "enabled"
    target_enabled.mkdir()
    _write_yaml(target_enabled / "hive.config.yaml", {"metrics": {"enabled": True}})

    target_missing = tmp_path / "missing"
    target_missing.mkdir()

    assert module.read_kickoff_metrics_state(target_enabled) is True
    assert module.read_kickoff_metrics_state(target_missing) is False


def test_load_backlog_candidates_returns_empty_and_parses_entries(tmp_path: Path) -> None:
    module = _load_module()
    target_empty = tmp_path / "empty"
    target_empty.mkdir()

    target_with_backlog = tmp_path / "with-backlog"
    target_with_backlog.mkdir()
    _write_yaml(
        target_with_backlog / ".pHive/meta-team/queue-meta-optimize.yaml",
        {
            "schema_version": 1,
            "candidates": [
                {
                    "candidate_id": "mo-1",
                    "target": "docs/guide.md",
                    "type": "doc-note",
                    "description": "Add a clarification",
                    "safety_notes": "Append only",
                    "status": "pending",
                }
            ],
        },
    )

    assert module.load_backlog_candidates(target_empty) == []
    assert module.load_backlog_candidates(target_with_backlog) == [
        {
            "candidate_id": "mo-1",
            "target": "docs/guide.md",
            "type": "doc-note",
            "description": "Add a clarification",
            "safety_notes": "Append only",
            "status": "pending",
        }
    ]


def test_run_public_cycle_uses_pr_adapter_and_emits_closable_pr_record(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    module = _load_module()
    meta_experiment = _load_meta_experiment()
    target = tmp_path / "target"
    _init_repo(target)
    _write_yaml(target / "hive.config.yaml", {"metrics": {"enabled": True}})
    _write_yaml(
        target / ".pHive/project-profile.yaml",
        {
            "meta_optimize": {
                "experiment_id": "exp-public",
                "prior_run_id": "run-001",
                "candidate_ref": "HEAD",
                "target_branch": "main",
                "worktree_path": str(target / ".pHive/meta-team/worktrees/exp-public"),
                "candidate_metrics": {
                    "tokens": 90,
                    "wall_clock_ms": 40,
                    "first_attempt_pass": True,
                },
                "ranked_proposals": [],
            }
        },
    )
    _write_yaml(
        target / ".pHive/meta-team/queue-meta-optimize.yaml",
        {
            "schema_version": 1,
            "candidates": [
                {
                    "candidate_id": "mo-backlog-1",
                    "target": "README.md",
                    "type": "doc-fix",
                    "description": "Use backlog fallback when no ranked proposals exist",
                    "safety_notes": "Single-file reviewable change",
                    "status": "pending",
                }
            ],
        },
    )
    _git(target, "add", "hive.config.yaml", ".pHive/project-profile.yaml", ".pHive/meta-team/queue-meta-optimize.yaml")
    _git(target, "commit", "-m", "test fixture setup")

    captured: dict[str, object] = {}

    def fake_capture_from_run(run_id: str) -> dict[str, object]:
        captured["prior_run_id"] = run_id
        return {
            "metrics": {
                "tokens": 100,
                "wall_clock_ms": 50,
                "first_attempt_pass": True,
            }
        }

    def fake_promote(self, envelope: dict, decision: dict):
        captured["adapter_repo_path"] = self.repo_path
        captured["envelope"] = dict(envelope)
        captured["decision"] = dict(decision)
        return meta_experiment.PromotionResult(
            success=True,
            evidence=meta_experiment.PromotionEvidence(
                pr_ref="pr://tests/target#meta-improvement/pr/exp-public",
                pr_state="open",
            ),
            rollback_target="meta-improvement/pr/exp-public",
            notes="mocked promotion",
        )

    monkeypatch.setattr(module.baseline, "capture_from_run", fake_capture_from_run)
    monkeypatch.setattr(module.PrPromotionAdapter, "promote", fake_promote)

    result = module.run_public_cycle(target)
    close_record = result["close_record"]

    assert result["mode"] == "backlog_fallback"
    assert result["selected_candidate"]["candidate_id"] == "mo-backlog-1"
    assert result["adapter"] == "PrPromotionAdapter"
    assert captured["prior_run_id"] == "run-001"
    assert captured["adapter_repo_path"] == target.resolve()
    assert captured["decision"] == {"verdict": "pass"}
    assert close_record["pr_ref"] == "pr://tests/target#meta-improvement/pr/exp-public"
    assert close_record["pr_state"] == "open"
    assert close_record["rollback_target"] == "meta-improvement/pr/exp-public"
    assert close_record["rollback_ref"] == "meta-improvement/pr/exp-public"
    assert close_record["metrics_snapshot"] == {
        "tokens": 90,
        "wall_clock_ms": 40,
        "first_attempt_pass": True,
    }
    assert module.closure_validator.validate_closable(close_record) is None


def test_public_orchestration_files_exclude_forbidden_maintainer_surface_tokens() -> None:
    run_text = RUN_PATH.read_text(encoding="utf-8")
    skill_text = SKILL_PATH.read_text(encoding="utf-8")

    assert "DirectCommitAdapter" not in run_text
    assert "maintainer-skills" not in skill_text
    assert "DirectCommitAdapter" not in skill_text
    assert "/meta-meta-optimize" not in skill_text
