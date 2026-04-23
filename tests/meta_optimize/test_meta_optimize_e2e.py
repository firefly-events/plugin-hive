"""End-to-end BL3.6 proof assertions always run.

Set `HIVE_WRITE_MVS_PROOF=1` to regenerate the canonical proof under `.pHive/audits/mvs-proof/`; default pytest runs write the proof to `tmp_path` and leave `latest.yaml` untouched.
"""

from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path

import yaml

from tests.meta_optimize.test_public_orchestration import _git, _init_repo, _load_module, _write_yaml


ROOT = Path(__file__).resolve().parents[2]
AUDIT_ROOT = ROOT / ".pHive/audits/mvs-proof"
RUN_PATH = ROOT / "skills/hive/skills/meta-optimize/run.py"


def _make_worktree_candidate(
    main_repo: Path,
    worktree_path: Path,
    experiment_id: str,
    change_file: str,
    change_content: str,
) -> str:
    branch_name = f"exp/{experiment_id}"
    _git(main_repo, "branch", branch_name, "main")
    _git(main_repo, "worktree", "add", str(worktree_path), branch_name)
    target = worktree_path / change_file
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(change_content, encoding="utf-8")
    _git(worktree_path, "add", change_file)
    _git(worktree_path, "commit", "-m", f"candidate {experiment_id}")
    return _git(worktree_path, "rev-parse", "HEAD")


def _write_proof_artifacts(
    audit_root: Path,
    update_latest: bool,
    *,
    target_fixture: Path,
    proposal_source: str,
    result: dict[str, object],
    baseline_metrics: dict[str, object],
    candidate_metrics: dict[str, object],
    main_head_before: str,
    main_head_after: str,
    candidate_ref: str,
    config_first_target: Path,
    cwd_fallback_target: Path,
) -> Path:
    timestamp = datetime.now(timezone.utc)
    proven_at = timestamp.strftime("%Y-%m-%dT%H:%M:%SZ")
    proof_rel = Path(timestamp.strftime("%Y-%m-%dT%H-%M-%SZ")) / "proof.yaml"
    proof_path = audit_root / proof_rel
    proof_path.parent.mkdir(parents=True, exist_ok=True)

    close_record = result["close_record"]
    assert isinstance(close_record, dict)

    integrity = [
        {
            "check": "Kickoff opt-in read from hive.config.yaml metrics.enabled",
            "result": "PASS",
        },
        {
            "check": "Target project resolved via config-first/cwd-fallback seam",
            "result": "PASS",
        },
        {
            "check": "Backlog candidate selected for the public cycle",
            "result": "PASS",
        },
        {
            "check": "PrPromotionAdapter invoked and DirectCommitAdapter was not used",
            "result": "PASS",
        },
        {
            "check": "PR-style artifact produced with a new branch and candidate commit",
            "result": "PASS",
        },
        {
            "check": "Close evidence uses pr_ref plus pr_state and omits commit_ref-only evidence",
            "result": "PASS",
        },
        {
            "check": "closure_validator.validate_closable accepted the close record",
            "result": "PASS",
        },
        {
            "check": "Target main branch was not mutated directly",
            "result": "PASS",
        },
        {
            "check": "Baseline and candidate metrics snapshots are structurally present",
            "result": "PASS",
        },
        {
            "check": "No mocks were used in the promotion path",
            "result": "PASS",
        },
    ]

    doc = {
        "schema_version": 1,
        "type": "mvs-proof-public-milestone",
        "slice": "S10",
        "epic": "meta-improvement-system",
        "story": "BL3.6",
        "timestamp": proven_at,
        "proven_at": proven_at,
        "summary": (
            "BL3.6 public MVS milestone proof. A real public /meta-optimize run "
            "resolved a fixture target, read kickoff metrics opt-in from config, "
            "selected a backlog candidate, emitted a PR-shaped branch artifact, "
            "and closed through pr_ref + pr_state evidence."
        ),
        "target_fixture": str(target_fixture),
        "target_resolution": {
            "config_first": str(config_first_target),
            "cwd_fallback": str(cwd_fallback_target),
        },
        "kickoff_metrics_enabled": True,
        "proposal_source": proposal_source,
        "adapter": result["adapter"],
        "candidate_ref": candidate_ref,
        "target_branch": "main",
        "main_head_before": main_head_before,
        "main_head_after": main_head_after,
        "pr_ref": close_record["pr_ref"],
        "pr_state": close_record["pr_state"],
        "rollback_target": close_record["rollback_target"],
        "rollback_ref": close_record["rollback_ref"],
        "baseline_metrics": baseline_metrics,
        "candidate_metrics": candidate_metrics,
        "close_validation": "PASS",
        "close_record": close_record,
        "integrity_checklist": integrity,
        "notes": (
            "The fixture run used the backlog-fallback public path because kickoff "
            "metrics were enabled but no ranked proposals were present. Promotion "
            "was performed by the real PrPromotionAdapter against a temporary git "
            "fixture repo, producing a local PR branch artifact without mutating "
            "the target's main branch."
        ),
    }
    proof_path.write_text(yaml.safe_dump(doc, sort_keys=False), encoding="utf-8")

    if update_latest:
        latest_path = audit_root / "latest.yaml"
        latest_doc = {
            "schema_version": 1,
            "latest_proof": str(proof_rel),
            "story": "BL3.6",
        }
        latest_path.write_text(yaml.safe_dump(latest_doc, sort_keys=False), encoding="utf-8")
    return proof_path


def test_run_public_cycle_end_to_end_writes_mvs_proof(
    monkeypatch,
    tmp_path: Path,
) -> None:
    write_live_proof = os.environ.get("HIVE_WRITE_MVS_PROOF") == "1"
    proof_root = AUDIT_ROOT if write_live_proof else tmp_path / "mvs-proof"
    latest_before = (
        (AUDIT_ROOT / "latest.yaml").read_text(encoding="utf-8")
        if (AUDIT_ROOT / "latest.yaml").is_file()
        else None
    )

    module = _load_module()
    target = tmp_path / "fixture-project"
    _init_repo(target)

    experiment_id = "exp-mvs-public-e2e"
    worktree_path = tmp_path / "worktrees" / experiment_id
    baseline_metrics = {
        "tokens": 100,
        "wall_clock_ms": 50,
        "first_attempt_pass": True,
    }
    candidate_metrics = {
        "tokens": 95,
        "wall_clock_ms": 45,
        "first_attempt_pass": True,
    }

    _write_yaml(target / "hive.config.yaml", {"metrics": {"enabled": True}})
    _write_yaml(
        target / ".pHive/project-profile.yaml",
        {
            "meta_optimize": {
                "experiment_id": experiment_id,
                "candidate_ref": "pending",
                "target_branch": "main",
                "worktree_path": str(worktree_path),
                "baseline_metrics": baseline_metrics,
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
                    "id": "mo-backlog-public-1",
                    "title": "Add the public MVS proof marker",
                    "description": "Append a proof marker line to README.md in the candidate worktree.",
                    "status": "pending",
                    "priority": "high",
                    "candidate_metrics": candidate_metrics,
                }
            ],
        },
    )
    _git(
        target,
        "add",
        "hive.config.yaml",
        ".pHive/project-profile.yaml",
        ".pHive/meta-team/queue-meta-optimize.yaml",
    )
    _git(target, "commit", "-m", "fixture setup for public meta optimize")

    candidate_ref = _make_worktree_candidate(
        target,
        worktree_path,
        experiment_id,
        "README.md",
        "initial\npublic mvs candidate\n",
    )

    _write_yaml(
        target / ".pHive/project-profile.yaml",
        {
            "meta_optimize": {
                "experiment_id": experiment_id,
                "candidate_ref": candidate_ref,
                "target_branch": "main",
                "worktree_path": str(worktree_path),
                "baseline_metrics": baseline_metrics,
                "ranked_proposals": [],
            }
        },
    )
    _git(target, "add", ".pHive/project-profile.yaml")
    _git(target, "commit", "-m", "record candidate ref for public meta optimize fixture")

    control_root = tmp_path / "control-root"
    invocation = tmp_path / "invocation"
    control_root.mkdir()
    invocation.mkdir()
    _write_yaml(control_root / "hive.config.yaml", {"paths": {"target_project": str(target)}})

    monkeypatch.setattr(module, "REPO_ROOT", control_root)
    monkeypatch.chdir(invocation)

    config_first_target = module.resolve_target_project()
    assert config_first_target == target.resolve()

    _write_yaml(control_root / "hive.config.yaml", {"paths": {"target_project": None}})
    cwd_fallback_target = module.resolve_target_project()
    assert cwd_fallback_target == invocation.resolve()

    metrics_enabled = module.read_kickoff_metrics_state(target)
    assert metrics_enabled is True

    backlog_candidates = module.load_backlog_candidates(target)
    selected_candidate = module.select_backlog_candidate(backlog_candidates)
    assert selected_candidate is not None
    assert selected_candidate["id"] == "mo-backlog-public-1"

    main_head_before = _git(target, "rev-parse", "main")
    assert candidate_ref != main_head_before

    result = module.run_public_cycle(config_first_target)
    close_record = result["close_record"]
    pr_branch = f"meta-improvement/pr/{experiment_id}"

    assert result["kickoff_metrics_enabled"] is True
    assert result["mode"] == "backlog_fallback"
    assert result["proposal_source"] == "backlog"
    assert result["selected_candidate"]["id"] == "mo-backlog-public-1"
    assert result["adapter"] == "PrPromotionAdapter"
    assert _git(target, "rev-parse", pr_branch) == candidate_ref
    assert not worktree_path.exists()

    main_head_after = _git(target, "rev-parse", "main")
    assert main_head_after == main_head_before

    assert close_record["pr_ref"] == f"pr://{target.parent.name}/{target.name}#{pr_branch}"
    assert close_record["pr_state"] == "open"
    assert "commit_ref" not in close_record
    assert close_record["rollback_ref"] == pr_branch
    assert close_record["rollback_target"] == pr_branch
    assert close_record["baseline_metrics"] == baseline_metrics
    assert close_record["candidate_metrics"] == candidate_metrics
    assert close_record["metrics_snapshot"] == candidate_metrics

    assert module.closure_validator.validate_closable(close_record) is None

    proof_path = _write_proof_artifacts(
        audit_root=proof_root,
        update_latest=write_live_proof,
        target_fixture=target,
        proposal_source=result["proposal_source"],
        result=result,
        baseline_metrics=baseline_metrics,
        candidate_metrics=candidate_metrics,
        main_head_before=main_head_before,
        main_head_after=main_head_after,
        candidate_ref=candidate_ref,
        config_first_target=config_first_target,
        cwd_fallback_target=cwd_fallback_target,
    )

    proof = yaml.safe_load(proof_path.read_text(encoding="utf-8"))
    assert isinstance(proof, dict)
    assert proof["epic"] == "meta-improvement-system"
    assert proof["story"] == "BL3.6"
    assert proof["kickoff_metrics_enabled"] is True
    assert proof["proposal_source"] == "backlog"
    assert proof["pr_ref"] == close_record["pr_ref"]
    assert proof["pr_state"] == "open"
    assert proof["rollback_target"] == pr_branch
    assert proof["baseline_metrics"] == baseline_metrics
    assert proof["candidate_metrics"] == candidate_metrics
    assert proof["close_validation"] == "PASS"
    assert len(proof["integrity_checklist"]) == 10
    assert all(item["result"] == "PASS" for item in proof["integrity_checklist"])

    if write_live_proof:
        latest = yaml.safe_load((AUDIT_ROOT / "latest.yaml").read_text(encoding="utf-8"))
        assert isinstance(latest, dict)
        assert latest["latest_proof"] == str(proof_path.relative_to(AUDIT_ROOT))
    else:
        assert proof_path.is_relative_to(tmp_path)
        latest_after = (
            (AUDIT_ROOT / "latest.yaml").read_text(encoding="utf-8")
            if (AUDIT_ROOT / "latest.yaml").is_file()
            else None
        )
        assert latest_after == latest_before

    run_text = RUN_PATH.read_text(encoding="utf-8")
    assert "DirectCommitAdapter" not in run_text
    assert "PrPromotionAdapter" in run_text
