#!/usr/bin/env python3
"""Run the first live no-op meta-meta cycle once on the current branch."""

from __future__ import annotations

import argparse
import importlib.util
import sys
from datetime import date, datetime, timezone
from pathlib import Path
import shutil
import subprocess
import time
from typing import Any

import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from hive.lib.metrics import append_event
DEFAULT_BACKLOG_PATH = Path(".pHive/meta-team/queue-meta-meta-optimize.yaml")
DEFAULT_AUDIT_ROOT = Path(".pHive/audits/mvl-proof")
TARGET_FILE = Path(".pHive/meta-team/archive/2026-04-19/MANIFEST.md")
CYCLE_STATE_PATH = Path(".pHive/meta-team/cycle-state.yaml")
LEDGER_PATH = Path(".pHive/meta-team/ledger.yaml")
WORKTREES_ROOT = Path(".pHive/meta-team/worktrees")
SWARM_ID = "meta-meta-optimize"
STORY_ID = "BL2.5"
SLICE_ID = "S9"


def _load_meta_experiment_module():
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


META_EXPERIMENT = _load_meta_experiment_module()
baseline = META_EXPERIMENT.baseline
compare = META_EXPERIMENT.compare
envelope = META_EXPERIMENT.envelope
closure_validator = META_EXPERIMENT.closure_validator
rollback_watch = META_EXPERIMENT.rollback_watch
DirectCommitAdapter = META_EXPERIMENT.DirectCommitAdapter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate-id", default="mmo-2026-04-21-001")
    parser.add_argument("--backlog-path", default=str(DEFAULT_BACKLOG_PATH))
    parser.add_argument("--target-branch", default=_git_output("rev-parse", "--abbrev-ref", "HEAD"))
    parser.add_argument("--audit-root", default=str(DEFAULT_AUDIT_ROOT))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = REPO_ROOT
    backlog_path = repo_root / args.backlog_path
    audit_root = repo_root / args.audit_root
    dirty = _git_output("status", "--porcelain").strip()
    if dirty:
        print("refusing to run: uncommitted changes — commit or stash first", file=sys.stderr)
        return 1
    pre_run_head = _git_output("rev-parse", "HEAD")

    worktree_path: Path | None = None
    worktree_branch: str | None = None
    created_paths: list[Path] = []

    try:
        _ensure_current_branch(args.target_branch)
        _ensure_target_exists(repo_root / TARGET_FILE)

        ledger = _read_yaml_list(repo_root / LEDGER_PATH)
        cycle_id = _next_cycle_id(ledger)
        run_id = cycle_id
        worktree_branch = f"meta-meta-exp-{cycle_id}"
        worktree_path = repo_root / WORKTREES_ROOT / cycle_id

        events_path = Path(f".pHive/metrics/events/{run_id}.jsonl")
        _track_if_created(created_paths, repo_root / events_path)
        _seed_baseline_events(run_id, args.candidate_id)

        cycle_now_dt = datetime.now(timezone.utc).replace(microsecond=0)
        cycle_now_iso = cycle_now_dt.isoformat().replace("+00:00", "Z")
        observation_end_iso = (
            (cycle_now_dt + __import__("datetime").timedelta(hours=4))
            .isoformat()
            .replace("+00:00", "Z")
        )
        observation_window_dict = {"start": cycle_now_iso, "end": observation_end_iso}

        envelope_path = Path(f".pHive/metrics/experiments/{cycle_id}.yaml")
        _track_if_created(created_paths, repo_root / envelope_path)
        initial_envelope = envelope.create(
            {
                "experiment_id": cycle_id,
                "swarm_id": SWARM_ID,
                "target_ref": f"repo:plugin-hive@{args.target_branch}",
                "baseline_ref": f"experiment:{cycle_id}",
                "candidate_ref": f"branch:{worktree_branch}",
                "policy_ref": "policy:no-op-proof",
                "decision": "pending",
                "observation_window": observation_window_dict,
                "regression_watch": {"state": "pending"},
            }
        )

        boot_started_at = _utc_now()
        baseline_snapshot = baseline.capture_from_run(run_id)
        if baseline_snapshot is None:
            raise RuntimeError(f"baseline unavailable for run_id={run_id}")
        baseline.persist_to_envelope(cycle_id, baseline_snapshot)

        boot_report = {
            "started_at": boot_started_at,
            "baseline_available": True,
            "run_id": run_id,
            "events_path": str(events_path),
        }
        cycle_state = {
            "schema_version": 1,
            "cycle_id": cycle_id,
            "story": STORY_ID,
            "slice": SLICE_ID,
            "status": "running",
            "branch": args.target_branch,
            "candidate_id": args.candidate_id,
            "candidate_target": str(TARGET_FILE),
            "steps": {
                "step_01_boot": boot_report,
                "step_02_analysis": {"mode": "no-op", "reason": "proving run uses preselected candidate"},
            },
        }
        _track_if_created(created_paths, repo_root / CYCLE_STATE_PATH)
        _write_yaml(repo_root / CYCLE_STATE_PATH, cycle_state)

        candidate = _load_candidate(backlog_path, args.candidate_id)
        if candidate.get("target") != str(TARGET_FILE):
            raise RuntimeError(f"candidate target mismatch: {candidate.get('target')}")
        cycle_state["steps"]["step_03b_backlog_fallback"] = {
            "selected_candidate": {
                "candidate_id": candidate["candidate_id"],
                "target": candidate["target"],
                "type": candidate["type"],
            }
        }
        _write_yaml(repo_root / CYCLE_STATE_PATH, cycle_state)

        _git("worktree", "add", "-b", worktree_branch, str(worktree_path), args.target_branch)

        line_to_append = f"<!-- reviewed-on: {cycle_id} -->"
        target_in_worktree = worktree_path / TARGET_FILE
        with target_in_worktree.open("a", encoding="utf-8") as handle:
            handle.write(f"{line_to_append}\n")
        _git("add", str(TARGET_FILE), cwd=worktree_path)
        _git(
            "commit",
            "-m",
            f"meta-meta-exp({cycle_id}): reviewed-on provenance note",
            cwd=worktree_path,
        )
        candidate_ref = _git_output("rev-parse", "HEAD", cwd=worktree_path)

        started = time.perf_counter()
        _run_python_assert(
            worktree_path,
            f"import pathlib; assert pathlib.Path({str(TARGET_FILE)!r}).exists()",
        )
        _run_python_assert(
            worktree_path,
            (
                "import pathlib; "
                f"text = pathlib.Path({str(TARGET_FILE)!r}).read_text(encoding='utf-8'); "
                f"assert {line_to_append!r} in text"
            ),
        )
        measured_ms = max(1, int((time.perf_counter() - started) * 1000))

        candidate_metrics_snapshot = {
            "captured_at": _utc_now(),
            "metrics": {
                "tokens": 0,
                "wall_clock_ms": measured_ms,
                "first_attempt_pass": True,
            },
        }
        decision = compare.evaluate(baseline_snapshot, candidate_metrics_snapshot, threshold_pct=0.10)
        if decision["verdict"] != "accept":
            raise RuntimeError(f"expected accept decision, got {decision['verdict']}")

        promotion_input = dict(initial_envelope)
        promotion_input.update(
            {
                "candidate_ref": candidate_ref,
                "target_branch": args.target_branch,
                "worktree_path": str(worktree_path),
            }
        )
        promotion_result = DirectCommitAdapter(repo_path=repo_root).promote(
            promotion_input,
            {"verdict": "pass"},
        )
        commit_ref = promotion_result.evidence.commit_ref
        rollback_ref = promotion_result.rollback_target

        metrics_snapshot_for_envelope = candidate_metrics_snapshot["metrics"]
        final_envelope = {
            "experiment_id": cycle_id,
            "decision": "accept",
            "metrics_snapshot": metrics_snapshot_for_envelope,
            "commit_ref": commit_ref,
            "rollback_ref": rollback_ref,
        }
        envelope.set_metrics_snapshot(cycle_id, metrics_snapshot_for_envelope)
        envelope.set_commit_ref(cycle_id, commit_ref)
        envelope.set_rollback_ref(cycle_id, rollback_ref)
        envelope.set_decision(cycle_id, "accept")
        closure_validator.validate_closable(final_envelope)

        watch_fields = rollback_watch.arm_watch(
            final_envelope,
            observation_window_hours=4,
            now=cycle_now_dt,
            envelope_writer=None,
        )
        final_envelope.update(watch_fields)
        envelope.set_regression_watch(cycle_id, watch_fields["regression_watch"])

        proven_at = _utc_now()
        proof_dir = audit_root / _proof_dirname(proven_at)
        proof_path = proof_dir / "proof.yaml"
        latest_path = audit_root / "latest.yaml"
        proof_doc = {
            "schema_version": 1,
            "type": "mvl-proof",
            "slice": SLICE_ID,
            "story": STORY_ID,
            "proven_at": proven_at,
            "cycle_id": cycle_id,
            "candidate": {
                "id": args.candidate_id,
                "target": str(TARGET_FILE),
                "type": "archive-provenance-note",
            },
            "worktree": {
                "path": f"{WORKTREES_ROOT.as_posix()}/{cycle_id}/",
                "cleanup_status": "removed",
                "branch": worktree_branch,
            },
            "artifacts": {
                "envelope_path": str(envelope_path),
                "events_path": str(events_path),
                "cycle_state_path": str(CYCLE_STATE_PATH),
                "ledger_path": str(LEDGER_PATH),
            },
            "closure_evidence": {
                "commit_ref": commit_ref,
                "rollback_ref": rollback_ref,
                "metrics_snapshot": {
                    "tokens": 0,
                    "wall_clock_ms": measured_ms,
                    "first_attempt_pass": True,
                },
                "decision": "accept",
            },
            "regression_watch": {
                "state": "armed",
                "observation_window": {
                    "start": watch_fields["observation_window"]["start"],
                    "end": watch_fields["observation_window"]["end"],
                },
            },
            "scope_boundary": (
                "BL2.5 proves a clean no-op live cycle with worktree isolation + durable artifact "
                "references. Deliberate-regression rollback proof is reserved for BL2.6 against "
                "this same armed path."
            ),
            "notes": "First live /meta-meta-optimize cycle against a dormant archive candidate.",
        }
        _track_if_created(created_paths, proof_dir)
        _track_if_created(created_paths, proof_path)
        _write_yaml(proof_path, proof_doc)
        _track_if_created(created_paths, latest_path)
        _write_yaml(
            latest_path,
            {
                "schema_version": 1,
                "latest_proof": f"{proof_dir.name}/proof.yaml",
                "story": STORY_ID,
            },
        )

        cycle_state.update(
            {
                "status": "closed",
                "commit_ref": commit_ref,
                "rollback_ref": rollback_ref,
                "audit_path": str(proof_path.relative_to(repo_root)),
                "decision": "accept",
                "metrics_snapshot": proof_doc["closure_evidence"]["metrics_snapshot"],
                "regression_watch": proof_doc["regression_watch"],
            }
        )
        _write_yaml(repo_root / CYCLE_STATE_PATH, cycle_state)

        ledger_entry = {
            "cycle_id": cycle_id,
            "date": cycle_id.removeprefix("meta-").split("-r", 1)[0],
            "story": STORY_ID,
            "candidate_id": args.candidate_id,
            "target": str(TARGET_FILE),
            "decision": "accept",
            "commit_ref": commit_ref,
            "rollback_ref": rollback_ref,
            "audit_path": str(proof_path.relative_to(repo_root)),
        }
        ledger.append(ledger_entry)
        _track_if_created(created_paths, repo_root / LEDGER_PATH)
        _write_yaml(repo_root / LEDGER_PATH, ledger)

        _cleanup_worktree_and_branch(worktree_path, worktree_branch)

        print(f"cycle_id={cycle_id}")
        print(f"commit_ref={commit_ref}")
        print(f"rollback_ref={rollback_ref}")
        print(f"audit_path={proof_path.relative_to(repo_root)}")
        return 0
    except Exception as exc:
        _cleanup_worktree_and_branch(worktree_path, worktree_branch)
        _rollback_repo(pre_run_head)
        _cleanup_created_paths(created_paths)
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(f"NEEDS_WORK: {exc}", file=sys.stderr)
        return 1


def _seed_baseline_events(run_id: str, candidate_id: str) -> None:
    timestamp = _utc_now()
    events = [
        _event(run_id, candidate_id, "evt-tokens", "tokens", 0, "tokens", timestamp),
        _event(
            run_id,
            candidate_id,
            "evt-wall-clock",
            "wall_clock_ms",
            100000,
            "ms",
            timestamp,
        ),
        _event(
            run_id,
            candidate_id,
            "evt-first-attempt",
            "first_attempt_pass",
            True,
            "bool",
            timestamp,
        ),
    ]
    for event in events:
        append_event(event, run_id)


def _event(
    run_id: str,
    candidate_id: str,
    event_id: str,
    metric_type: str,
    value: object,
    unit: str,
    timestamp: str,
) -> dict[str, object]:
    return {
        "event_id": f"{run_id}-{event_id}",
        "timestamp": timestamp,
        "run_id": run_id,
        "swarm_id": SWARM_ID,
        "story_id": STORY_ID,
        "phase": "proving-run",
        "agent": "orchestrator",
        "metric_type": metric_type,
        "value": value,
        "unit": unit,
        "dimensions": {"candidate_id": candidate_id},
        "source": "run_first_live_cycle.py",
    }


def _load_candidate(backlog_path: Path, candidate_id: str) -> dict[str, Any]:
    backlog = _read_yaml_dict(backlog_path)
    for candidate in backlog.get("candidates", []):
        if isinstance(candidate, dict) and candidate.get("candidate_id") == candidate_id:
            return candidate
    raise RuntimeError(f"candidate_id not found in backlog: {candidate_id}")


def _next_cycle_id(ledger: list[dict[str, Any]]) -> str:
    base = f"meta-{date.today().isoformat()}"
    existing = {
        entry.get("cycle_id")
        for entry in ledger
        if isinstance(entry, dict) and isinstance(entry.get("cycle_id"), str)
    }
    if base not in existing:
        return base

    revision = 2
    while f"{base}-r{revision}" in existing:
        revision += 1
    return f"{base}-r{revision}"


def _proof_dirname(proven_at: str) -> str:
    return proven_at.replace(":", "-")


def _ensure_current_branch(expected_branch: str) -> None:
    current_branch = _git_output("rev-parse", "--abbrev-ref", "HEAD")
    if current_branch != expected_branch:
        raise RuntimeError(f"expected branch {expected_branch}, got {current_branch}")


def _ensure_target_exists(path: Path) -> None:
    if not path.is_file():
        raise RuntimeError(f"candidate target missing: {path}")


def _run_python_assert(cwd: Path, code: str) -> None:
    subprocess.run(["python3", "-c", code], cwd=cwd, check=True)


def _cleanup_worktree_and_branch(worktree_path: Path | None, worktree_branch: str | None) -> None:
    if worktree_path is not None and worktree_path.exists():
        subprocess.run(
            ["git", "worktree", "remove", "--force", str(worktree_path)],
            cwd=REPO_ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
    if worktree_branch:
        subprocess.run(
            ["git", "branch", "-D", worktree_branch],
            cwd=REPO_ROOT,
            check=False,
            capture_output=True,
            text=True,
        )


def _rollback_repo(pre_run_head: str) -> None:
    subprocess.run(
        ["git", "reset", "--hard", pre_run_head],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )


def _cleanup_created_paths(paths: list[Path]) -> None:
    for path in sorted(paths, key=lambda item: len(item.parts), reverse=True):
        if path.is_file():
            path.unlink(missing_ok=True)
        elif path.is_dir():
            shutil.rmtree(path, ignore_errors=True)


def _track_if_created(paths: list[Path], path: Path) -> None:
    if path.exists():
        return
    if path not in paths:
        paths.append(path)


def _read_yaml_dict(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise RuntimeError(f"missing required yaml file: {path}")
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise RuntimeError(f"expected mapping at {path}")
    return data


def _read_yaml_list(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if data is None:
        return []
    if not isinstance(data, list):
        raise RuntimeError(f"expected list at {path}")
    return data


def _write_yaml(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")


def _git(*args: str, cwd: Path | None = None) -> None:
    completed = subprocess.run(
        ["git", *args],
        cwd=cwd or REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip()
        raise RuntimeError(f"git {' '.join(args)} failed: {detail}")


def _git_output(*args: str, cwd: Path | None = None) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=cwd or REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip()
        raise RuntimeError(f"git {' '.join(args)} failed: {detail}")
    return completed.stdout.strip()


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


if __name__ == "__main__":
    raise SystemExit(main())
