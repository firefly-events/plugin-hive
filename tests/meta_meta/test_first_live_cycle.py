"""Structural checks for the first live-cycle proof artifacts."""

from __future__ import annotations

from pathlib import Path
import subprocess

import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]
AUDIT_ROOT = REPO_ROOT / ".pHive/audits/mvl-proof"


def _latest_proof_path() -> Path:
    """Return the most recent BL2.5-shaped (`type: mvl-proof`) artifact.

    BL2.6 ships a sibling `mvl-proof-rollback-realism` schema in the same
    audit root; filter to the BL2.5 `mvl-proof` type so structural tests
    remain stable when both artifact families coexist.
    """
    proofs = sorted(AUDIT_ROOT.glob("*/proof.yaml"))
    assert proofs, "expected at least one proof.yaml under .pHive/audits/mvl-proof/"
    for candidate in reversed(proofs):
        data = yaml.safe_load(candidate.read_text(encoding="utf-8"))
        if isinstance(data, dict) and data.get("type") == "mvl-proof":
            return candidate
    raise AssertionError("no proof.yaml with type=='mvl-proof' (BL2.5) found under audit root")


def _latest_pointer_proof_path() -> Path:
    """Resolve whichever proof `latest.yaml` currently points at, regardless of type.

    Used by ref-resolution tests so they catch stale `latest.yaml` drift —
    per CodeRabbit feedback that ref checks must be driven by the pointer,
    not by an independent directory scan.
    """
    latest_path = AUDIT_ROOT / "latest.yaml"
    assert latest_path.exists()
    latest = yaml.safe_load(latest_path.read_text(encoding="utf-8"))
    assert isinstance(latest, dict)
    target = AUDIT_ROOT / latest["latest_proof"]
    assert target.exists()
    return target


def _proof_doc() -> dict:
    proof_path = _latest_proof_path()
    data = yaml.safe_load(proof_path.read_text(encoding="utf-8"))
    assert isinstance(data, dict)
    return data


def _git_ref_exists(ref: str) -> bool:
    completed = subprocess.run(
        ["git", "rev-parse", "--verify", ref],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    return completed.returncode == 0


def test_audit_doc_exists_with_required_keys() -> None:
    proof = _proof_doc()
    closure = proof["closure_evidence"]

    assert proof["schema_version"] == 1
    assert proof["cycle_id"]
    assert closure["commit_ref"] != "TBD"
    assert closure["rollback_ref"] != "TBD"
    assert isinstance(closure["metrics_snapshot"], dict)
    assert closure["metrics_snapshot"]
    assert closure["decision"] == "accept"
    assert proof["regression_watch"]["state"] == "armed"


def test_latest_pointer_resolves() -> None:
    latest_path = AUDIT_ROOT / "latest.yaml"
    assert latest_path.exists()
    latest = yaml.safe_load(latest_path.read_text(encoding="utf-8"))
    assert isinstance(latest, dict)
    target = AUDIT_ROOT / latest["latest_proof"]
    assert target.exists()


def test_commit_ref_resolves_in_git() -> None:
    proof = yaml.safe_load(_latest_pointer_proof_path().read_text(encoding="utf-8"))
    assert _git_ref_exists(proof["closure_evidence"]["commit_ref"])


def test_rollback_ref_resolves_in_git() -> None:
    proof = yaml.safe_load(_latest_pointer_proof_path().read_text(encoding="utf-8"))
    assert _git_ref_exists(proof["closure_evidence"]["rollback_ref"])


def test_worktree_was_cleaned_up() -> None:
    proof = _proof_doc()
    cycle_id = proof["cycle_id"]
    assert not (REPO_ROOT / ".pHive/meta-team/worktrees" / cycle_id).exists()


def test_envelope_and_events_present() -> None:
    proof = _proof_doc()
    artifacts = proof["artifacts"]
    envelope_path = REPO_ROOT / artifacts["envelope_path"]
    events_path = REPO_ROOT / artifacts["events_path"]

    assert envelope_path.exists()
    assert envelope_path.stat().st_size > 0
    assert events_path.exists()
    assert events_path.stat().st_size > 0


def test_scope_boundary_defers_regression_proof_to_bl2_6() -> None:
    proof_path = _latest_proof_path()
    assert "BL2.6" in proof_path.read_text(encoding="utf-8")
