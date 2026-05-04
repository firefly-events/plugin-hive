"""WorktreeManager lifecycle tests using a real (tmp_path) git repo."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from hive.lib.dag_executor.executor.telemetry import Telemetry
from hive.lib.dag_executor.isolation import (
    NestedWorktreeError,
    WorktreeCollisionError,
    WorktreeContaminationError,
    WorktreeManager,
)


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        check=True,
        capture_output=True,
        text=True,
    )


@pytest.fixture
def tmp_repo(tmp_path: Path) -> Path:
    """Bare-minimum git repo with one commit so worktrees can be added."""

    _git(tmp_path, "init", "-q")
    _git(tmp_path, "config", "user.email", "test@example.com")
    _git(tmp_path, "config", "user.name", "Test")
    (tmp_path / "README.md").write_text("seed\n", encoding="utf-8")
    _git(tmp_path, "add", "README.md")
    _git(tmp_path, "commit", "-q", "-m", "init")
    return tmp_path


def test_create_makes_worktree_at_runs_root(tmp_repo: Path):
    runs_root = tmp_repo / "runs"
    mgr = WorktreeManager(repo_path=tmp_repo, runs_root=runs_root)
    path = mgr.create("01ARZ3NDEKTSV4RRFFQ69G5FAV-spine")
    assert path.exists()
    assert path.is_dir()
    assert (path / "README.md").read_text(encoding="utf-8") == "seed\n"


def test_cleanup_success_removes_worktree(tmp_repo: Path):
    runs_root = tmp_repo / "runs"
    mgr = WorktreeManager(repo_path=tmp_repo, runs_root=runs_root)
    rid = "01ARZ3NDEKTSV4RRFFQ69G5FAV-spine"
    path = mgr.create(rid)
    assert path.exists()
    mgr.cleanup_success(rid)
    assert not path.exists()


def test_cleanup_success_idempotent_when_path_missing(tmp_repo: Path):
    mgr = WorktreeManager(repo_path=tmp_repo, runs_root=tmp_repo / "runs")
    mgr.cleanup_success("01ARZ3NDEKTSV4RRFFQ69G5FAV-spine")  # should not raise


def test_create_collision_raises(tmp_repo: Path):
    runs_root = tmp_repo / "runs"
    mgr = WorktreeManager(repo_path=tmp_repo, runs_root=runs_root)
    rid = "01ARZ3NDEKTSV4RRFFQ69G5FAV-spine"
    mgr.create(rid)
    with pytest.raises(WorktreeCollisionError):
        mgr.create(rid)


def test_preserve_on_failure_emits_event_and_returns_path(tmp_repo: Path):
    runs_root = tmp_repo / "runs"
    rid = "01ARZ3NDEKTSV4RRFFQ69G5FAV-spine"
    tel = Telemetry(run_id=rid)
    mgr = WorktreeManager(
        repo_path=tmp_repo, runs_root=runs_root, telemetry=tel
    )
    mgr.create(rid)
    preserved = mgr.preserve_on_failure(rid)
    assert preserved.exists()
    events = [e for e in tel.events if e["event_type"] == "worktree_preserved_on_failure"]
    assert len(events) == 1
    assert events[0]["payload"]["path"] == str(preserved)


def test_create_emits_worktree_created_event(tmp_repo: Path):
    runs_root = tmp_repo / "runs"
    rid = "01ARZ3NDEKTSV4RRFFQ69G5FAV-spine"
    tel = Telemetry(run_id=rid)
    mgr = WorktreeManager(
        repo_path=tmp_repo, runs_root=runs_root, telemetry=tel
    )
    mgr.create(rid)
    events = [e for e in tel.events if e["event_type"] == "worktree_created"]
    assert len(events) == 1


def test_symlink_contamination_on_parent_raises(tmp_repo: Path):
    """Defensive layer per security:plan-audit finding #8."""

    runs_root = tmp_repo / "runs"
    elsewhere = tmp_repo / "elsewhere"
    elsewhere.mkdir()
    runs_root.symlink_to(elsewhere)
    mgr = WorktreeManager(repo_path=tmp_repo, runs_root=runs_root)
    with pytest.raises(WorktreeContaminationError):
        mgr.create("01ARZ3NDEKTSV4RRFFQ69G5FAV-spine")


def test_walker_creates_and_cleans_worktree_on_success(tmp_repo: Path):
    """Walker integration: cleanup-on-success removes the worktree."""

    from hive.lib.dag_executor.executor.dispatcher import Dispatcher
    from hive.lib.dag_executor.executor.handlers import NodeOutput
    from hive.lib.dag_executor.executor.run_id import make_run_id
    from hive.lib.dag_executor.executor.telemetry import Telemetry
    from hive.lib.dag_executor.executor.walker import Walker
    from hive.lib.dag_executor.graph.model import Graph, Node, NodeType

    rid = make_run_id("isolation-spine")
    runs_root = tmp_repo / "runs"
    mgr = WorktreeManager(repo_path=tmp_repo, runs_root=runs_root)

    def _stub(node, inputs, run_id):
        return NodeOutput(outputs={"id": node.id})

    graph = Graph(
        workflow_name="isolation-spine",
        nodes={
            "a": Node(id="a", node_type=NodeType.AGENT, agent="developer"),
        },
    )
    Walker().walk(
        graph=graph,
        dispatcher=Dispatcher(handlers={NodeType.AGENT: _stub}),
        run_id=rid,
        telemetry=Telemetry(run_id=rid),
        worktree_manager=mgr,
    )
    assert not (runs_root / rid).exists(), "worktree should be cleaned on success"


def test_nested_git_worktree_add_raises_nested_error(tmp_repo: Path):
    """Direct attempt to `git worktree add` a path inside an existing
    worktree raises `NestedWorktreeError`. This is the unsanctioned
    nesting path; the sanctioned path goes through NestingDetector."""

    runs_root = tmp_repo / "runs"
    mgr = WorktreeManager(repo_path=tmp_repo, runs_root=runs_root)
    rid_outer = "01ARZ3NDEKTSV4RRFFQ69G5FAV-outer"
    outer = mgr.create(rid_outer)
    # Try to add a worktree at the SAME path again — git rejects with
    # "is already a working tree" message.
    rid_dup = "01ARZ3NDEKTSV4RRFFQ69G5FBA-dup"
    inner_mgr = WorktreeManager(repo_path=tmp_repo, runs_root=runs_root)
    # Simulate git saying "already a working tree" — manually invoke
    # the underlying _git helper with a duplicate add.
    from hive.lib.dag_executor.isolation.worktree import _git

    with pytest.raises(NestedWorktreeError):
        _git(tmp_repo, "worktree", "add", "--detach", str(outer))


def test_walker_preserves_worktree_on_failure(tmp_repo: Path):
    """Walker integration: preserve-on-failure leaves the worktree dir."""

    from hive.lib.dag_executor.executor.dispatcher import Dispatcher
    from hive.lib.dag_executor.executor.run_id import make_run_id
    from hive.lib.dag_executor.executor.telemetry import Telemetry
    from hive.lib.dag_executor.executor.walker import Walker
    from hive.lib.dag_executor.graph.model import Graph, Node, NodeType

    rid = make_run_id("isolation-spine")
    runs_root = tmp_repo / "runs"
    mgr = WorktreeManager(repo_path=tmp_repo, runs_root=runs_root)

    def _boom(node, inputs, run_id):
        raise RuntimeError("boom")

    graph = Graph(
        workflow_name="isolation-spine",
        nodes={
            "a": Node(id="a", node_type=NodeType.AGENT, agent="developer"),
        },
    )
    with pytest.raises(RuntimeError):
        Walker().walk(
            graph=graph,
            dispatcher=Dispatcher(handlers={NodeType.AGENT: _boom}),
            run_id=rid,
            telemetry=Telemetry(run_id=rid),
            worktree_manager=mgr,
        )
    assert (runs_root / rid).exists(), "worktree must be preserved on failure for post-mortem"
