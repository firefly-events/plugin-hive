"""Walker lifecycle KG emits — phase_started / phase_complete (s3-phase-lifecycle-wire).

Pytest-style, matching the existing DAG-executor KG-emit tests
(`hive/lib/dag_executor/tests/test_kg_emit_phase_failed.py`). Run from the
repo root with:

    python3 -m pytest tests/test_dag_walker_kg_emits.py

(`python -m unittest discover tests` imports this module but collects no
TestCase classes — the dag_executor suite is pytest-convention.)
"""

from __future__ import annotations

import importlib
import sqlite3
import sys
from pathlib import Path

import pytest

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.errors import HandlerError
from hive.lib.dag_executor.executor.handlers import NodeOutput
from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.executor.walker import Walker
from hive.lib.dag_executor.graph import ConditionalEdge, Graph, Node, NodeType

_EPIC = "kg-repair-activation"


def _kg_schema(db_path: Path) -> None:
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute(
            """
            CREATE TABLE triples (
              subject TEXT,
              predicate TEXT,
              object TEXT,
              valid_from TEXT,
              valid_until TEXT,
              source_epic TEXT,
              source_agent TEXT
            )
            """
        )
        conn.execute(
            "CREATE UNIQUE INDEX idx_unique_triple ON triples(subject, predicate, object, source_epic)"
        )
        conn.commit()


def _rows(db_path: Path) -> list[tuple[str, str, str, str, str]]:
    with sqlite3.connect(str(db_path)) as conn:
        return conn.execute(
            """
            SELECT subject, predicate, object, source_epic, source_agent
            FROM triples
            ORDER BY valid_from, subject, predicate
            """
        ).fetchall()


@pytest.fixture(autouse=True)
def kg_tmp_db(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Autouse safety net: every test in this module routes KG emits to a
    tmp-path DB via HIVE_KG_SQLITE_PATH, so a walker run here can never
    write the live ~/.claude/hive/kg.sqlite (s2 finding §5)."""

    db_path = tmp_path / "kg.sqlite"
    _kg_schema(db_path)
    monkeypatch.setenv("HIVE_KG_SQLITE_PATH", str(db_path))

    # Pin the lifecycle knob to 'phase' via an isolated config so the test
    # outcome does not depend on the developer's local hive.config.yaml.
    config_path = tmp_path / "hive.config.yaml"
    config_path.write_text("emit_lifecycle_at: phase\n", encoding="utf-8")
    monkeypatch.setenv("HIVE_CONFIG", str(config_path))
    sys.modules.pop("hive.lib.config", None)
    sys.modules.pop("hive.lib.kg_emit", None)
    importlib.import_module("hive.lib.kg_emit")

    yield db_path

    sys.modules.pop("hive.lib.config", None)
    sys.modules.pop("hive.lib.kg_emit", None)


def _agent_node(node_id: str, depends_on: list[str] | None = None, **kw) -> Node:
    return Node(
        id=node_id,
        agent="developer",
        node_type=NodeType.AGENT,
        depends_on=depends_on or [],
        **kw,
    )


def _graph_with(nodes: list[Node]) -> Graph:
    edges = [
        ConditionalEdge(from_node_id=p, to_node_id=n.id)
        for n in nodes
        for p in n.depends_on
    ]
    return Graph(workflow_name="kg-lifecycle-test", nodes={n.id: n for n in nodes}, edges=edges)


def _dispatcher(fail_ids: set[str] | None = None) -> Dispatcher:
    failing = fail_ids or set()

    def handler(node, inputs, run_id):
        if node.id in failing:
            raise HandlerError(f"boom {node.id}")
        return NodeOutput(outputs={})

    return Dispatcher(handlers={NodeType.AGENT: handler})


def _preds(rows, subject: str) -> set[str]:
    return {r[1] for r in rows if r[0] == subject}


def test_successful_step_emits_phase_started_and_phase_complete(kg_tmp_db):
    tel = Telemetry(run_id="rid-kg-lifecycle-ok")
    Walker().walk(
        _graph_with([_agent_node("a")]),
        _dispatcher(),
        "rid-kg-lifecycle-ok",
        tel,
        context={"epic_id": _EPIC},
    )

    rows = _rows(kg_tmp_db)
    assert _preds(rows, "a") == {"phase_started", "phase_complete"}
    by_pred = {r[1]: r for r in rows}
    assert by_pred["phase_started"][2] == "started"
    assert by_pred["phase_complete"][2] == "completed"
    for row in rows:
        assert row[3] == _EPIC
        assert row[4] == "dag-executor"


def test_failed_step_emits_phase_started_but_not_phase_complete(kg_tmp_db):
    tel = Telemetry(run_id="rid-kg-lifecycle-fail")
    with pytest.raises(HandlerError):
        Walker().walk(
            _graph_with([_agent_node("a")]),
            _dispatcher(fail_ids={"a"}),
            "rid-kg-lifecycle-fail",
            tel,
            context={"epic_id": _EPIC},
        )

    rows = _rows(kg_tmp_db)
    # AC3: started fires at entry even though the step later fails;
    # complete must NOT fire on the failed path.
    assert "phase_started" in _preds(rows, "a")
    assert "phase_failed" in _preds(rows, "a")
    assert "phase_complete" not in {r[1] for r in rows}


def test_blocked_step_emits_no_phase_complete(kg_tmp_db):
    # "a" runs normally; "b" carries a skip_when predicate (hde-3a) and is
    # skipped, which is the walker's blocked path. The blocked node must
    # emit phase_blocked but never phase_started / phase_complete (it is
    # never dispatched).
    tel = Telemetry(run_id="rid-kg-lifecycle-blocked")
    Walker().walk(
        _graph_with(
            [
                _agent_node("a"),
                _agent_node("b", depends_on=["a"], skip_when="some_predicate"),
            ]
        ),
        _dispatcher(),
        "rid-kg-lifecycle-blocked",
        tel,
        context={"epic_id": _EPIC},
    )

    rows = _rows(kg_tmp_db)
    # "a" ran to success: full lifecycle pair.
    assert _preds(rows, "a") == {"phase_started", "phase_complete"}
    # "b" was blocked: phase_blocked only — no started, no complete.
    # AC3 deviation by design: blocked nodes never start (they are never
    # dispatched), so phase_started would be semantically false; AC3's
    # intent is suppressing phase_complete on non-success paths. Ruling
    # recorded in h2-investigation.md (For s3, "AC3 ruling").
    assert _preds(rows, "b") == {"phase_blocked"}


def test_resume_replay_emits_lifecycle_for_replayed_nodes(kg_tmp_db, tmp_path):
    # Replay path (Walker.replay via resume_run) must emit the same
    # lifecycle triples as the live walk: phase_started when a resumed
    # node re-enters RUNNING, phase_complete on its successful exit.
    from hive.lib.dag_executor.executor.run_id import make_run_id
    from hive.lib.dag_executor.run_state import resume_run

    runs_root = tmp_path / "runs"

    class _Flaky:
        """Fails node "b" on the first pass; succeeds on replay."""

        def __init__(self):
            self.failed_once = False

        def handle(self, node, inputs, run_id):
            if node.id == "b" and not self.failed_once:
                self.failed_once = True
                raise HandlerError("boom b")
            return NodeOutput(outputs={})

    dispatcher = Dispatcher(handlers={NodeType.AGENT: _Flaky().handle})
    graph = _graph_with([_agent_node("a"), _agent_node("b", depends_on=["a"])])
    rid = make_run_id("kg-lifecycle-test")

    with pytest.raises(HandlerError):
        Walker().walk(
            graph,
            dispatcher,
            rid,
            Telemetry(run_id=rid),
            context={"epic_id": _EPIC},
            run_state_path=runs_root,
        )

    # Wipe first-pass triples so only replay emits are observed (the
    # unique-triple index would otherwise dedupe identical re-emits).
    with sqlite3.connect(str(kg_tmp_db)) as conn:
        conn.execute("DELETE FROM triples")
        conn.commit()

    final_state = resume_run(
        run_id=rid,
        graph=graph,
        walker=Walker(),
        dispatcher=dispatcher,
        telemetry=Telemetry(run_id=rid),
        runs_root=runs_root,
        context={"epic_id": _EPIC},
    )

    rows = _rows(kg_tmp_db)
    # Replayed node "b" gets the full lifecycle pair on resume.
    assert _preds(rows, "b") == {"phase_started", "phase_complete"}
    by_pred = {r[1]: r for r in rows if r[0] == "b"}
    assert by_pred["phase_started"][3] == _EPIC
    assert by_pred["phase_started"][4] == "dag-executor"
    # "a" completed in the first pass; replay reuses its output without
    # re-executing — no fresh lifecycle emits.
    assert _preds(rows, "a") == set()
    assert final_state.status.value == "completed"
