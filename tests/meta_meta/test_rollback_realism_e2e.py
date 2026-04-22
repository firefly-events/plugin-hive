"""Structural checks for the BL2.6 rollback-realism proof artifacts."""

from __future__ import annotations

from pathlib import Path
import subprocess

import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]
AUDIT_ROOT = REPO_ROOT / ".pHive/audits/mvl-proof"
PROOF_TYPE = "mvl-proof-rollback-realism"


def _proof_docs() -> list[tuple[Path, dict]]:
    docs: list[tuple[Path, dict]] = []
    for proof_path in sorted(AUDIT_ROOT.glob("*/proof.yaml")):
        data = yaml.safe_load(proof_path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and data.get("type") == PROOF_TYPE:
            docs.append((proof_path, data))
    return docs


def _latest_proof() -> tuple[Path, dict]:
    docs = _proof_docs()
    assert docs, "expected at least one rollback-realism proof under .pHive/audits/mvl-proof/"
    return docs[-1]


def _proof_doc() -> dict:
    _, data = _latest_proof()
    return data


def _git_ok(*args: str) -> bool:
    completed = subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    return completed.returncode == 0


def _git_output(*args: str) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def _envelope_doc() -> dict:
    proof = _proof_doc()
    envelope_path = REPO_ROOT / proof["envelope_path"]
    data = yaml.safe_load(envelope_path.read_text(encoding="utf-8"))
    assert isinstance(data, dict)
    return data


def test_bl26_proof_exists_with_rollback_realism_type() -> None:
    proof_path, proof = _latest_proof()
    assert proof_path.exists()
    assert proof["type"] == PROOF_TYPE


def test_bl26_regression_watch_fired() -> None:
    proof = _proof_doc()
    trigger_event = proof["trigger_event"]

    assert proof["regression_watch_fired"] is True
    assert trigger_event["regression_metrics"]
    assert trigger_event["threshold_pct"] == 0.10


def test_bl26_auto_revert_commit_resolves() -> None:
    proof = _proof_doc()
    assert _git_ok("rev-parse", "--verify", proof["auto_revert"]["auto_revert_commit_hash"])


def test_bl26_regressive_commit_resolves() -> None:
    proof = _proof_doc()
    assert _git_ok("rev-parse", "--verify", proof["auto_revert"]["commit_hash_regressive"])


def test_bl26_revert_commit_is_above_regressive_in_git_log() -> None:
    proof = _proof_doc()
    revert_ref = proof["auto_revert"]["auto_revert_commit_hash"]
    regressive_ref = proof["auto_revert"]["commit_hash_regressive"]

    assert _git_ok("merge-base", "--is-ancestor", regressive_ref, revert_ref)
    subject = _git_output("show", "-s", "--format=%s", revert_ref)
    assert subject.startswith('Revert "')


def test_bl26_proof_integrity_flags_negative() -> None:
    proof = _proof_doc()
    integrity = proof["proof_integrity"]

    assert integrity["manual_revert_used"] is False
    assert integrity["mock_callback_used"] is False
    assert integrity["synthetic_closure_used"] is False


def test_bl26_envelope_reflects_reverted_state() -> None:
    stored_envelope = _envelope_doc()
    regression_watch = stored_envelope["regression_watch"]
    rollback_result = regression_watch["rollback_result"]

    assert stored_envelope["decision"] == "reverted"
    assert regression_watch["state"] == "tripped"
    assert rollback_result["success"] is True


def test_bl26_latest_pointer_updated() -> None:
    latest_path = AUDIT_ROOT / "latest.yaml"
    latest = yaml.safe_load(latest_path.read_text(encoding="utf-8"))
    assert isinstance(latest, dict)

    target = AUDIT_ROOT / latest["latest_proof"]
    proof = yaml.safe_load(target.read_text(encoding="utf-8"))
    assert isinstance(proof, dict)
    assert proof["type"] == PROOF_TYPE


def test_bl26_closure_evidence_complete() -> None:
    proof = _proof_doc()
    closure = proof["closure_evidence"]
    stored_envelope = _envelope_doc()

    assert closure["commit_ref"]
    assert closure["rollback_ref"]
    assert closure["metrics_snapshot"]
    assert stored_envelope["commit_ref"] == closure["commit_ref"]
    assert stored_envelope["rollback_ref"] == closure["rollback_ref"]
    assert stored_envelope["metrics_snapshot"] == closure["metrics_snapshot"]


def test_bl26_path_signature_named() -> None:
    proof = _proof_doc()
    assert proof["auto_revert"]["path"] == "regression_watch -> closure_gate -> auto_revert_callback"
