"""Pause handler integration: full suspend → external signal → resume.

Drives the pause_fixture.workflow.yaml fixture through the executor.
The "external" approve sentinel is dropped via a side-thread that
fires shortly after the walker enters the pause-handler poll loop.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path

import pytest

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.handlers import NodeOutput
from hive.lib.dag_executor.executor.handlers.pause import PauseHandler
from hive.lib.dag_executor.executor.run_id import make_run_id
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker
from hive.lib.dag_executor.graph.loader import load_workflow
from hive.lib.dag_executor.graph.model import NodeType
from hive.lib.dag_executor.pause import generate
from hive.lib.dag_executor.pause.errors import PauseRejectedError


_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "pause"
    / "tests"
    / "fixtures"
    / "pause_fixture.workflow.yaml"
)


@pytest.fixture(autouse=True)
def _clear_env_secret(monkeypatch):
    monkeypatch.delenv("HIVE_PAUSE_SECRET", raising=False)


def _stub_developer(node, inputs, run_id):
    return NodeOutput(outputs={"id": node.id, "marker": f"out-{node.id}"})


def _drop_approve_after_delay(runs_root: Path, run_id: str, node_id: str, delay: float = 0.3):
    exc: list[BaseException] = []

    def _runner():
        try:
            time.sleep(delay)
            token = generate(run_id, node_id, runs_root)
            path = runs_root / run_id / "pause" / f"{node_id}.approve"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(token, encoding="utf-8")
        except BaseException as e:  # capture so the test can surface it
            exc.append(e)

    thread = threading.Thread(target=_runner, daemon=True)
    thread.start()
    return thread, exc


def _drop_reject_after_delay(runs_root: Path, run_id: str, node_id: str, reason: str, delay: float = 0.3):
    exc: list[BaseException] = []

    def _runner():
        try:
            time.sleep(delay)
            token = generate(run_id, node_id, runs_root)
            path = runs_root / run_id / "pause" / f"{node_id}.reject"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"{token}\n\n{reason}", encoding="utf-8")
        except BaseException as e:
            exc.append(e)

    thread = threading.Thread(target=_runner, daemon=True)
    thread.start()
    return thread, exc


def test_pause_workflow_resumes_on_approve(tmp_path: Path):
    graph = load_workflow(_FIXTURE_PATH)
    rid = make_run_id("pause-fixture")
    runs_root = tmp_path / "runs"
    tel = Telemetry(run_id=rid)
    handler = PauseHandler(runs_root=runs_root, telemetry=tel, poll_interval=0.05)
    dispatcher = Dispatcher(
        handlers={
            NodeType.AGENT: _stub_developer,
            NodeType.PAUSE: handler.handle,
        }
    )
    _, drop_exc = _drop_approve_after_delay(runs_root, rid, "human_approval", delay=0.15)

    materialised = Walker().walk(
        graph=graph,
        dispatcher=dispatcher,
        run_id=rid,
        telemetry=tel,
    )
    assert not drop_exc, drop_exc[0]
    assert "post_pause" in materialised
    assert materialised["post_pause"].outputs["marker"] == "out-post_pause"
    suspended_events = [e for e in tel.events if e["event_type"] == "pause_suspended"]
    resumed_events = [e for e in tel.events if e["event_type"] == "pause_resumed"]
    assert len(suspended_events) == 1
    assert len(resumed_events) == 1


def test_pause_run_state_transitions_suspended_then_running(tmp_path: Path):
    """run_state.yaml records SUSPENDED during the pause and RUNNING
    after approve, with terminal COMPLETED at the end. Asserts the
    walker brackets the pause dispatch with the run_state status
    helpers (hde-8 AC #3 + AC #4)."""

    from hive.lib.dag_executor.run_state import RunStatus, load

    graph = load_workflow(_FIXTURE_PATH)
    rid = make_run_id("pause-fixture")
    runs_root = tmp_path / "runs"
    state_root = tmp_path / "state"
    tel = Telemetry(run_id=rid)
    handler = PauseHandler(runs_root=runs_root, telemetry=tel, poll_interval=0.05)
    dispatcher = Dispatcher(
        handlers={
            NodeType.AGENT: _stub_developer,
            NodeType.PAUSE: handler.handle,
        }
    )

    captured_status: dict[str, RunStatus] = {}
    capture_exc: list[BaseException] = []
    sentinel_written = threading.Event()

    def _capture_when_pause_handler_runs():
        try:
            state_file = state_root / rid / "run_state.yaml"
            # Wait for run_state to exist AND reach SUSPENDED before snapshot.
            deadline = time.monotonic() + 5.0
            while time.monotonic() < deadline:
                if state_file.exists():
                    snapshot = load(rid, root=state_root)
                    if snapshot.status == RunStatus.SUSPENDED:
                        captured_status["mid_pause"] = snapshot.status
                        break
                time.sleep(0.02)
            else:
                # Deadline elapsed — record whatever we last saw (or None) so
                # the assertion below fails with a useful message.
                captured_status.setdefault("mid_pause", None)
        except BaseException as e:
            capture_exc.append(e)
        finally:
            # ALWAYS drop the sentinel so the walker is not left waiting.
            try:
                token = generate(rid, "human_approval", runs_root)
                path = runs_root / rid / "pause" / "human_approval.approve"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(token, encoding="utf-8")
            except BaseException as e:
                capture_exc.append(e)
            sentinel_written.set()

    threading.Thread(target=_capture_when_pause_handler_runs, daemon=True).start()

    Walker().walk(
        graph=graph,
        dispatcher=dispatcher,
        run_id=rid,
        telemetry=tel,
        run_state_path=state_root,
    )
    sentinel_written.wait(timeout=10.0)
    assert not capture_exc, capture_exc[0]
    assert captured_status["mid_pause"] == RunStatus.SUSPENDED
    final = load(rid, root=state_root)
    assert final.status == RunStatus.COMPLETED


def test_pause_run_state_marks_failed_on_reject(tmp_path: Path):
    """Reject sentinel → walker's failure path → run_state status FAILED
    + failure_info populated (hde-8 AC #5)."""

    from hive.lib.dag_executor.run_state import RunStatus, load

    graph = load_workflow(_FIXTURE_PATH)
    rid = make_run_id("pause-fixture")
    runs_root = tmp_path / "runs"
    state_root = tmp_path / "state"
    tel = Telemetry(run_id=rid)
    handler = PauseHandler(runs_root=runs_root, telemetry=tel, poll_interval=0.05)
    dispatcher = Dispatcher(
        handlers={
            NodeType.AGENT: _stub_developer,
            NodeType.PAUSE: handler.handle,
        }
    )
    _, drop_exc = _drop_reject_after_delay(
        runs_root, rid, "human_approval", "operator decided no", delay=0.15
    )

    with pytest.raises(PauseRejectedError):
        Walker().walk(
            graph=graph,
            dispatcher=dispatcher,
            run_id=rid,
            telemetry=tel,
            run_state_path=state_root,
        )
    assert not drop_exc, drop_exc[0]
    final = load(rid, root=state_root)
    assert final.status == RunStatus.FAILED
    assert final.failure_info is not None
    assert final.failure_info["error_class"] == "PauseRejectedError"


def test_pause_workflow_fails_on_reject(tmp_path: Path):
    graph = load_workflow(_FIXTURE_PATH)
    rid = make_run_id("pause-fixture")
    runs_root = tmp_path / "runs"
    tel = Telemetry(run_id=rid)
    handler = PauseHandler(runs_root=runs_root, telemetry=tel, poll_interval=0.05)
    dispatcher = Dispatcher(
        handlers={
            NodeType.AGENT: _stub_developer,
            NodeType.PAUSE: handler.handle,
        }
    )
    _, drop_exc = _drop_reject_after_delay(
        runs_root, rid, "human_approval", "operator decided no", delay=0.15
    )

    with pytest.raises(PauseRejectedError) as exc:
        Walker().walk(
            graph=graph,
            dispatcher=dispatcher,
            run_id=rid,
            telemetry=tel,
        )
    assert not drop_exc, drop_exc[0]
    assert "operator decided no" in str(exc.value)
    rejected_events = [e for e in tel.events if e["event_type"] == "pause_rejected"]
    assert len(rejected_events) == 1
    assert rejected_events[0]["payload"]["reason"] == "operator decided no"
