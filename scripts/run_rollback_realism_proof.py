#!/usr/bin/env python3
"""Run the BL2.6 real commit-then-revert rollback realism proof once."""

from __future__ import annotations

import argparse
import importlib.util
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
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
TARGET_FILE = Path(".pHive/meta-team/archive/2026-04-19/AUDIT-NOTE.md")
CYCLE_STATE_PATH = Path(".pHive/meta-team/cycle-state.yaml")
LEDGER_PATH = Path(".pHive/meta-team/ledger.yaml")
WORKTREES_ROOT = Path(".pHive/meta-team/worktrees")
SWARM_ID = "meta-meta-optimize"
STORY_ID = "BL2.6"
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
    parser.add_argument("--candidate-id", default="mmo-2026-04-21-002")
    parser.add_argument("--backlog-path", default=str(DEFAULT_BACKLOG_PATH))
    parser.add_argument("--target-branch", default=_git_output("rev-parse", "--abbrev-ref", "HEAD"))
    parser.add_argument("--audit-root", default=str(DEFAULT_AUDIT_ROOT))
    return parser.parse_args()


def main() -> int:
    if _git_output("status", "--porcelain"):
        print(
            "refusing to run: uncommitted changes — commit or stash first",
            file=sys.stderr,
        )
        return 1

    args = parse_args()
    repo_root = REPO_ROOT
    backlog_path = repo_root / args.backlog_path
    audit_root = repo_root / args.audit_root

    worktree_path: Path | None = None
    worktree_branch: str | None = None

    try:
        _ensure_current_branch(args.target_branch)
        _ensure_target_exists(repo_root / TARGET_FILE)

        ledger = _read_yaml_list(repo_root / LEDGER_PATH)
        cycle_id = _next_cycle_id(ledger)
        run_id = cycle_id
        worktree_branch = f"meta-meta-exp-{cycle_id}"
        worktree_path = repo_root / WORKTREES_ROOT / cycle_id

        _seed_baseline_events(run_id, args.candidate_id)
        events_path = Path(f".pHive/metrics/events/{run_id}.jsonl")

        cycle_now_dt = datetime.now(timezone.utc).replace(microsecond=0)
        cycle_now_iso = cycle_now_dt.isoformat().replace("+00:00", "Z")
        observation_end_iso = (cycle_now_dt + timedelta(hours=4)).isoformat().replace("+00:00", "Z")
        observation_window_dict = {"start": cycle_now_iso, "end": observation_end_iso}

        initial_envelope = envelope.create(
            {
                "experiment_id": cycle_id,
                "swarm_id": SWARM_ID,
                "target_ref": f"repo:plugin-hive@{args.target_branch}",
                "baseline_ref": f"experiment:{cycle_id}",
                "candidate_ref": f"branch:{worktree_branch}",
                "policy_ref": "policy:rollback-realism-proof",
                "decision": "pending",
                "observation_window": observation_window_dict,
                "regression_watch": {"state": "pending"},
            }
        )
        envelope_path = Path(f".pHive/metrics/experiments/{cycle_id}.yaml")

        boot_started_at = _utc_now()
        baseline_snapshot = baseline.capture_from_run(run_id)
        if baseline_snapshot is None:
            raise RuntimeError(f"baseline unavailable for run_id={run_id}")
        baseline.persist_to_envelope(cycle_id, baseline_snapshot)

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
                "step_01_boot": {
                    "started_at": boot_started_at,
                    "baseline_available": True,
                    "run_id": run_id,
                    "events_path": str(events_path),
                },
                "step_02_analysis": {
                    "mode": "proof",
                    "reason": "prove real post-close regression watch auto-revert",
                },
            },
        }
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

        line_to_append = f"indexed-for-meta-meta-optimize proving run: {cycle_id}"
        target_in_worktree = worktree_path / TARGET_FILE
        with target_in_worktree.open("a", encoding="utf-8") as handle:
            handle.write(f"\n{line_to_append}\n")
        _git("add", str(TARGET_FILE), cwd=worktree_path)
        _git(
            "commit",
            "-m",
            f"meta-meta-exp({cycle_id}): archive audit note proof footer",
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
        adapter = DirectCommitAdapter(repo_path=repo_root)
        auto_revert_callback = rollback_watch.make_direct_commit_auto_revert(adapter)
        promotion_result = adapter.promote(promotion_input, {"verdict": "pass"})
        commit_ref = promotion_result.evidence.commit_ref
        rollback_ref = promotion_result.rollback_target
        trip_succeeded = False

        try:
            metrics_snapshot_for_envelope = candidate_metrics_snapshot["metrics"]
            final_envelope = {
                "experiment_id": cycle_id,
                "decision": "accept",
                "metrics_snapshot": metrics_snapshot_for_envelope,
                "commit_ref": commit_ref,
                "rollback_ref": rollback_ref,
                "observation_window": observation_window_dict,
                "regression_watch": {"state": "pending"},
                "target_branch": args.target_branch,
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
            armed_envelope = dict(final_envelope)

            baseline_metrics = armed_envelope["metrics_snapshot"]
            post_close_snapshot = {
                "tokens": baseline_metrics.get("tokens", 0),
                "wall_clock_ms": int(baseline_metrics.get("wall_clock_ms", 40)) * 2,
                "first_attempt_pass": True,
            }
            expected_regression_metrics = ["wall_clock_ms"]
            armed_monotonic = time.perf_counter()
            trip_event = rollback_watch.evaluate_watch(
                envelope=armed_envelope,
                post_close_snapshot=post_close_snapshot,
                threshold_pct=0.10,
                now=datetime.now(timezone.utc),
                auto_revert_callback=auto_revert_callback,
                envelope_writer=envelope,
            )
            arm_to_trip_ms = max(0, int((time.perf_counter() - armed_monotonic) * 1000))
            trip_succeeded = (
                isinstance(trip_event, rollback_watch.TripEvent)
                and trip_event.rollback_result is not None
                and trip_event.rollback_result.success
            )
        finally:
            if not trip_succeeded:
                try:
                    auto_revert_callback(
                        {"commit_ref": commit_ref, "target_branch": args.target_branch},
                        rollback_ref,
                    )
                except Exception as cleanup_error:
                    print(f"CRITICAL: auto-revert cleanup failed: {cleanup_error}", file=sys.stderr)
        if not isinstance(trip_event, rollback_watch.TripEvent):
            raise RuntimeError(f"regression watch did not trip: {trip_event}")
        if trip_event.rollback_result is None or not trip_event.rollback_result.success:
            raise RuntimeError("auto-revert failed or returned no rollback_result")
        if trip_event.regression_metrics != expected_regression_metrics:
            raise RuntimeError(
                f"unexpected regression metrics: {trip_event.regression_metrics}"
            )

        auto_revert_commit_ref = trip_event.rollback_result.revert_ref
        if not auto_revert_commit_ref:
            raise RuntimeError("rollback_result missing revert_ref")

        log_lines = _git_output("log", "--oneline", "-3").splitlines()
        if not log_lines:
            raise RuntimeError("git log returned no commits")
        if 'Revert "' not in log_lines[0]:
            raise RuntimeError(f"top git log entry is not a revert commit: {log_lines[0]}")
        top_sha = log_lines[0].split()[0]
        if not auto_revert_commit_ref.startswith(top_sha):
            raise RuntimeError(
                "top git log entry does not match rollback_result.revert_ref"
            )

        stored_envelope = envelope.load(cycle_id)
        regression_watch_record = stored_envelope.get("regression_watch") or {}
        rollback_result_record = regression_watch_record.get("rollback_result") or {}
        if stored_envelope.get("decision") != "reverted":
            raise RuntimeError("envelope decision did not transition to reverted")
        if regression_watch_record.get("state") != "tripped":
            raise RuntimeError("regression_watch.state did not transition to tripped")
        if not regression_watch_record.get("tripped_at"):
            raise RuntimeError("regression_watch.tripped_at missing from stored envelope")
        if rollback_result_record.get("success") is not True:
            raise RuntimeError("stored rollback_result.success is not true")
        if rollback_result_record.get("revert_ref") != auto_revert_commit_ref:
            raise RuntimeError("stored rollback_result.revert_ref mismatch")
        if stored_envelope.get("commit_ref") != commit_ref:
            raise RuntimeError("stored commit_ref is not the regressive promotion sha")

        proven_at = _utc_now()
        proof_dir = audit_root / _proof_dirname(proven_at)
        proof_path = proof_dir / "proof.yaml"
        latest_path = audit_root / "latest.yaml"
        proof_doc = {
            "schema_version": 1,
            "type": "mvl-proof-rollback-realism",
            "slice": SLICE_ID,
            "story": STORY_ID,
            "proven_at": proven_at,
            "cycle_id": cycle_id,
            "candidate": {
                "id": args.candidate_id,
                "target": str(TARGET_FILE),
                "type": "archive-provenance-note",
            },
            "regression_watch_fired": True,
            "trigger_event": {
                "tripped_at": trip_event.tripped_at,
                "regression_metrics": trip_event.regression_metrics,
                "threshold_pct": 0.10,
                "baseline_snapshot": baseline_metrics,
                "post_close_snapshot": post_close_snapshot,
            },
            "auto_revert": {
                "commit_hash_regressive": commit_ref,
                "auto_revert_commit_hash": auto_revert_commit_ref,
                "wall_clock_from_arm_to_trip_ms": arm_to_trip_ms,
                "path": "regression_watch -> closure_gate -> auto_revert_callback",
                "callback_binding": "DirectCommitAdapter.rollback (bound method)",
            },
            "closure_evidence": {
                "commit_ref": commit_ref,
                "rollback_ref": rollback_ref,
                "metrics_snapshot": baseline_metrics,
                "decision": "reverted",
            },
            "envelope_path": str(envelope_path),
            "proof_integrity": {
                "manual_revert_used": False,
                "mock_callback_used": False,
                "synthetic_closure_used": False,
            },
            "notes": (
                "BL2.6 milestone proof. Regression injected via a deliberately-worse\n"
                "post_close_snapshot (wall_clock_ms +100% vs baseline, exceeding the\n"
                "10% threshold). auto_revert fired via the live\n"
                "rollback_watch.evaluate_watch -> DirectCommitAdapter.rollback path\n"
                "with envelope_writer=envelope so the trip + rollback_result landed\n"
                "on disk.\n"
            ),
        }
        _write_yaml(proof_path, proof_doc)
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
                "auto_revert_commit_ref": auto_revert_commit_ref,
                "audit_path": str(proof_path.relative_to(repo_root)),
                "decision": "reverted",
                "metrics_snapshot": baseline_metrics,
                "regression_watch": regression_watch_record,
            }
        )
        _write_yaml(repo_root / CYCLE_STATE_PATH, cycle_state)

        ledger.append(
            {
                "experiment_id": cycle_id,
                "date": cycle_id.removeprefix("meta-").split("-r", 1)[0],
                "story": STORY_ID,
                "candidate_id": args.candidate_id,
                "target": str(TARGET_FILE),
                "decision": "reverted",
                "commit_ref": commit_ref,
                "rollback_ref": rollback_ref,
                "auto_revert_commit_ref": auto_revert_commit_ref,
                "audit_path": str(proof_path.relative_to(repo_root)),
            }
        )
        _write_yaml(repo_root / LEDGER_PATH, ledger)

        _cleanup_worktree_and_branch(worktree_path, worktree_branch)

        print(f"cycle_id={cycle_id}")
        print(f"regressive_commit_ref={commit_ref}")
        print(f"auto_revert_commit_ref={auto_revert_commit_ref}")
        print(f"audit_path={proof_path.relative_to(repo_root)}")
        return 0
    except Exception as exc:
        _cleanup_worktree_and_branch(worktree_path, worktree_branch)
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
        "source": "run_rollback_realism_proof.py",
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
        entry.get("experiment_id") or entry.get("cycle_id")
        for entry in ledger
        if isinstance(entry, dict)
        and isinstance(entry.get("experiment_id") or entry.get("cycle_id"), str)
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
