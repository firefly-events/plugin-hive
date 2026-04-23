from __future__ import annotations

from pathlib import Path

import pytest

from tests.meta_optimize.test_public_orchestration import (
    _git,
    _init_repo,
    _load_meta_experiment,
    _load_module,
    _write_yaml,
)


ROOT = Path(__file__).resolve().parents[2]
QUEUE_PATH = ROOT / ".pHive/meta-team/queue-meta-optimize.yaml"
SKILL_PATH = ROOT / "skills/hive/skills/meta-optimize/SKILL.md"


def test_load_backlog_candidates_returns_empty_when_template_missing(tmp_path: Path) -> None:
    module = _load_module()
    target = tmp_path / "missing-template"
    target.mkdir()

    assert module.load_backlog_candidates(target) == []


def test_load_backlog_candidates_parses_entries_when_template_present(tmp_path: Path) -> None:
    module = _load_module()
    target = tmp_path / "with-template"
    target.mkdir()
    _write_yaml(
        target / ".pHive/meta-team/queue-meta-optimize.yaml",
        {
            "schema_version": 1,
            "candidates": [
                {
                    "id": "mo-1",
                    "title": "Clarify onboarding note",
                    "description": "Add a short note to the README.",
                    "status": "pending",
                    "priority": "medium",
                },
                {
                    "id": "mo-2",
                    "title": "Document rollback owner",
                    "rationale": "Fallback runs should name a reviewer.",
                    "status": "done",
                },
            ],
        },
    )

    assert module.load_backlog_candidates(target) == [
        {
            "id": "mo-1",
            "title": "Clarify onboarding note",
            "description": "Add a short note to the README.",
            "status": "pending",
            "priority": "medium",
        },
        {
            "id": "mo-2",
            "title": "Document rollback owner",
            "rationale": "Fallback runs should name a reviewer.",
            "status": "done",
        },
    ]


def test_select_backlog_candidate_returns_first_pending_entry() -> None:
    module = _load_module()
    candidates = [
        {"id": "mo-1", "title": "First", "status": "done"},
        {"id": "mo-2", "title": "Second", "status": "pending"},
        {"id": "mo-3", "title": "Third", "status": "pending"},
    ]

    assert module.select_backlog_candidate(candidates) == {
        "id": "mo-2",
        "title": "Second",
        "status": "pending",
    }


def test_select_backlog_candidate_returns_none_when_all_entries_non_pending() -> None:
    module = _load_module()
    candidates = [
        {"id": "mo-1", "status": "done"},
        {"id": "mo-2", "status": "in_progress"},
    ]

    assert module.select_backlog_candidate(candidates) is None


def test_queue_template_comments_are_human_edit_only_mvp() -> None:
    queue_text = QUEUE_PATH.read_text(encoding="utf-8").lower()

    assert "human-edit" in queue_text
    assert "auto-surfacing" not in queue_text
    assert "auto-generated" not in queue_text


def test_skill_backlog_fallback_section_mentions_path_and_human_edit_only() -> None:
    skill_text = SKILL_PATH.read_text(encoding="utf-8")
    start = skill_text.index("## Backlog Fallback")
    end = skill_text.index("## Closure", start)
    backlog_section = skill_text[start:end]

    assert "{HIVE_TARGET_PROJECT}/.pHive/meta-team/queue-meta-optimize.yaml" in backlog_section
    assert "human-edit-only" in backlog_section
    assert "step-03b-backlog-fallback.md" in backlog_section


def test_run_public_cycle_uses_backlog_fallback_and_emits_pr_shaped_close_record(
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
                "experiment_id": "exp-backlog",
                "prior_run_id": "run-001",
                "candidate_ref": "HEAD",
                "target_branch": "main",
                "worktree_path": str(target / ".pHive/meta-team/worktrees/exp-backlog"),
                "candidate_metrics": {
                    "tokens": 92,
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
                    "id": "mo-backlog-1",
                    "title": "Clarify fallback flow",
                    "description": "Add a short note to README.md.",
                    "status": "pending",
                    "priority": "high",
                },
                {
                    "id": "mo-backlog-2",
                    "title": "Later candidate",
                    "status": "pending",
                },
            ],
        },
    )
    _git(target, "add", "hive.config.yaml", ".pHive/project-profile.yaml", ".pHive/meta-team/queue-meta-optimize.yaml")
    _git(target, "commit", "-m", "fixture setup")

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

    def fake_compare(
        baseline_metrics: dict[str, object],
        candidate_metrics: dict[str, object],
        threshold_pct: float,
    ) -> dict[str, object]:
        captured["compare_called"] = True
        captured["baseline_metrics"] = dict(baseline_metrics)
        captured["candidate_metrics"] = dict(candidate_metrics)
        captured["threshold_pct"] = threshold_pct
        return {
            "verdict": "accept",
            "threshold_pct": threshold_pct,
            "metrics": {},
            "regression_metrics": [],
        }

    def fake_promote(self, envelope: dict, decision: dict):
        captured["decision"] = dict(decision)
        captured["target_branch"] = envelope["target_branch"]
        return meta_experiment.PromotionResult(
            success=True,
            evidence=meta_experiment.PromotionEvidence(
                pr_ref="pr://tests/target#meta-improvement/pr/exp-backlog",
                pr_state="open",
            ),
            rollback_target="meta-improvement/pr/exp-backlog",
            notes="mocked promotion",
        )

    monkeypatch.setattr(module.baseline, "capture_from_run", fake_capture_from_run)
    monkeypatch.setattr(module.compare, "evaluate", fake_compare)
    monkeypatch.setattr(module.PrPromotionAdapter, "promote", fake_promote)

    result = module.run_public_cycle(target)
    close_record = result["close_record"]

    assert result["mode"] == "backlog_fallback"
    assert result["selected_candidate"]["id"] == "mo-backlog-1"
    assert captured["prior_run_id"] == "run-001"
    assert captured["compare_called"] is True
    assert captured["target_branch"] == "main"
    assert captured["decision"] == {"verdict": "pass"}
    assert close_record["pr_ref"] == "pr://tests/target#meta-improvement/pr/exp-backlog"
    assert close_record["pr_state"] == "open"
    assert close_record["rollback_ref"] == "meta-improvement/pr/exp-backlog"
    assert close_record["rollback_target"] == "meta-improvement/pr/exp-backlog"
    assert close_record["metrics_snapshot"] == {
        "tokens": 92,
        "wall_clock_ms": 40,
        "first_attempt_pass": True,
    }
    assert module.closure_validator.validate_closable(close_record) is None
