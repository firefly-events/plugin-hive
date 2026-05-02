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
    def _runner():
        time.sleep(delay)
        token = generate(run_id, node_id, runs_root)
        path = runs_root / run_id / "pause" / f"{node_id}.approve"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(token, encoding="utf-8")

    thread = threading.Thread(target=_runner, daemon=True)
    thread.start()
    return thread


def _drop_reject_after_delay(runs_root: Path, run_id: str, node_id: str, reason: str, delay: float = 0.3):
    def _runner():
        time.sleep(delay)
        token = generate(run_id, node_id, runs_root)
        path = runs_root / run_id / "pause" / f"{node_id}.reject"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"{token}\n\n{reason}", encoding="utf-8")

    thread = threading.Thread(target=_runner, daemon=True)
    thread.start()
    return thread


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
    _drop_approve_after_delay(runs_root, rid, "human_approval", delay=0.15)

    materialised = Walker().walk(
        graph=graph,
        dispatcher=dispatcher,
        run_id=rid,
        telemetry=tel,
    )
    assert "post_pause" in materialised
    assert materialised["post_pause"].outputs["marker"] == "out-post_pause"
    suspended_events = [e for e in tel.events if e["event_type"] == "pause_suspended"]
    resumed_events = [e for e in tel.events if e["event_type"] == "pause_resumed"]
    assert len(suspended_events) == 1
    assert len(resumed_events) == 1


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
    _drop_reject_after_delay(
        runs_root, rid, "human_approval", "operator decided no", delay=0.15
    )

    with pytest.raises(PauseRejectedError) as exc:
        Walker().walk(
            graph=graph,
            dispatcher=dispatcher,
            run_id=rid,
            telemetry=tel,
        )
    assert "operator decided no" in str(exc.value)
    rejected_events = [e for e in tel.events if e["event_type"] == "pause_rejected"]
    assert len(rejected_events) == 1
    assert rejected_events[0]["payload"]["reason"] == "operator decided no"
