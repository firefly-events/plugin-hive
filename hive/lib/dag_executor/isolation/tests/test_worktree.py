"""WorktreeManager lifecycle tests using a real (tmp_path) git repo."""

from __future__ import annotations

import subprocess
import threading
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


def _commit_symlink(repo: Path, relative_path: str, target: str) -> Path:
    link = repo / relative_path
    link.parent.mkdir(parents=True, exist_ok=True)
    link.symlink_to(target)
    _git(repo, "add", relative_path)
    _git(repo, "commit", "-q", "-m", f"add symlink {relative_path}")
    return link


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


@pytest.mark.parametrize("target", ["../README.md", "missing-internal-target"])
def test_tracked_internal_claude_symlinks_are_allowed(
    tmp_repo: Path,
    target: str,
):
    """Internal links, including dangling ones, preserve repository containment."""

    _commit_symlink(tmp_repo, ".claude/internal-link", target)
    mgr = WorktreeManager(repo_path=tmp_repo, runs_root=tmp_repo / "runs")
    path = mgr.create("01ARZ3NDEKTSV4RRFFQ69G5FAV-safe")

    assert path.exists()
    assert (path / ".claude" / "internal-link").is_symlink()


def test_tracked_relative_claude_symlink_escape_is_rejected_before_create(
    tmp_repo: Path,
):
    _commit_symlink(tmp_repo, ".claude/escape", "../../outside")
    runs_root = tmp_repo / "runs"
    run_id = "01ARZ3NDEKTSV4RRFFQ69G5FAV-relative"
    mgr = WorktreeManager(repo_path=tmp_repo, runs_root=runs_root)

    with pytest.raises(
        WorktreeContaminationError,
        match=r"security precondition failed.*\.claude/escape",
    ):
        mgr.create(run_id)

    assert not (runs_root / run_id).exists()
    assert not runs_root.exists(), "preflight must run before filesystem creation"


def test_tracked_absolute_claude_symlink_escape_is_rejected_before_create(
    tmp_repo: Path,
):
    outside = tmp_repo.parent / "absolute-outside"
    _commit_symlink(tmp_repo, ".claude/escape", str(outside))
    runs_root = tmp_repo / "runs"
    run_id = "01ARZ3NDEKTSV4RRFFQ69G5FAV-absolute"
    mgr = WorktreeManager(repo_path=tmp_repo, runs_root=runs_root)

    with pytest.raises(WorktreeContaminationError, match="escapes future worktree"):
        mgr.create(run_id)

    assert not (runs_root / run_id).exists()


def test_tracked_chained_claude_symlink_escape_is_rejected(tmp_repo: Path):
    first = tmp_repo / ".claude" / "first"
    second = tmp_repo / ".claude" / "second"
    first.parent.mkdir(parents=True)
    first.symlink_to("second")
    second.symlink_to("../../outside")
    _git(tmp_repo, "add", ".claude/first", ".claude/second")
    _git(tmp_repo, "commit", "-q", "-m", "add chained escaping symlinks")
    mgr = WorktreeManager(repo_path=tmp_repo, runs_root=tmp_repo / "runs")

    with pytest.raises(
        WorktreeContaminationError,
        match=r"\.claude/first -> second",
    ):
        mgr.create("01ARZ3NDEKTSV4RRFFQ69G5FAV-chain")


def test_tracked_chain_through_repo_symlink_is_rejected(tmp_repo: Path):
    """A .claude link cannot hide an escape behind a tracked link elsewhere."""

    claude_link = tmp_repo / ".claude" / "first"
    claude_link.parent.mkdir(parents=True)
    claude_link.symlink_to("../relay")
    (tmp_repo / "relay").symlink_to("../outside")
    _git(tmp_repo, "add", ".claude/first", "relay")
    _git(tmp_repo, "commit", "-q", "-m", "add cross-directory symlink chain")
    mgr = WorktreeManager(repo_path=tmp_repo, runs_root=tmp_repo / "runs")

    with pytest.raises(WorktreeContaminationError, match="escapes future worktree"):
        mgr.create("01ARZ3NDEKTSV4RRFFQ69G5FAV-cross-chain")


def test_tracked_escaping_symlink_outside_claude_is_rejected(tmp_repo: Path):
    """M2 regression: audit scope covers every tracked symlink, not just .claude/.

    A handler writing through a tracked symlink under ``hooks/`` (or
    ``scripts/``, or anywhere else) can redirect filesystem writes outside
    the worktree exactly as a ``.claude/`` link can (security finding #8).
    """

    _commit_symlink(tmp_repo, "hooks/escape", "../../outside")
    mgr = WorktreeManager(repo_path=tmp_repo, runs_root=tmp_repo / "runs")

    with pytest.raises(
        WorktreeContaminationError,
        match=r"security precondition failed.*hooks/escape",
    ):
        mgr.create("01ARZ3NDEKTSV4RRFFQ69G5FAV-outside-claude")


def test_tracked_self_growing_claude_symlink_chain_is_rejected_without_hanging(
    tmp_repo: Path,
):
    """B1 regression: a self-growing chain must fail closed, not hang.

    ``.claude/a -> a/a`` appends a path component to the pending suffix on
    every expansion, so the ``(current, pending)`` cycle guard never repeats
    a prior state and never terminates on its own. Guard the test itself
    with a hard wall-clock timeout so a regression manifests as a fast,
    clear failure instead of hanging the whole suite.
    """

    _commit_symlink(tmp_repo, ".claude/a", "a/a")
    mgr = WorktreeManager(repo_path=tmp_repo, runs_root=tmp_repo / "runs")

    result: dict[str, BaseException] = {}

    def _run() -> None:
        try:
            mgr.create("01ARZ3NDEKTSV4RRFFQ69G5FAV-selfgrow")
        except BaseException as exc:  # pragma: no cover - surfaced via join
            result["error"] = exc

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    thread.join(timeout=5.0)
    assert not thread.is_alive(), (
        "symlink audit hung on a self-growing tracked symlink chain "
        "(B1 regression); expected WorktreeContaminationError within 5s"
    )
    assert "error" in result, "expected WorktreeContaminationError, got no error"
    assert isinstance(result["error"], WorktreeContaminationError), result["error"]
    assert "escapes future worktree" in str(result["error"])


def test_branch_tree_is_audited_when_branch_is_requested(tmp_repo: Path):
    """Audit the branch passed to worktree add, not merely the current HEAD."""

    _git(tmp_repo, "checkout", "-q", "-b", "unsafe-branch")
    _commit_symlink(tmp_repo, ".claude/escape", "../../outside")
    _git(tmp_repo, "checkout", "-q", "-")
    mgr = WorktreeManager(repo_path=tmp_repo, runs_root=tmp_repo / "runs")

    with pytest.raises(WorktreeContaminationError, match="escapes future worktree"):
        mgr.create("01ARZ3NDEKTSV4RRFFQ69G5FAV-branch", branch="unsafe-branch")


def test_absolute_link_back_to_source_repo_is_not_future_worktree_contained(
    tmp_repo: Path,
):
    _commit_symlink(
        tmp_repo,
        ".claude/source-repo-link",
        str(tmp_repo / "README.md"),
    )
    mgr = WorktreeManager(repo_path=tmp_repo, runs_root=tmp_repo / "runs")

    with pytest.raises(
        WorktreeContaminationError,
        match=r"future worktree.*\.claude/source-repo-link",
    ):
        mgr.create("01ARZ3NDEKTSV4RRFFQ69G5FAV-source-absolute")


def test_component_resolution_expands_symlink_before_suffix_dotdot(
    tmp_repo: Path,
):
    """Do not lexically collapse ``link/..`` before resolving ``link``."""

    start = tmp_repo / ".claude" / "start"
    chained = tmp_repo / "dir" / "link"
    start.parent.mkdir(parents=True)
    chained.parent.mkdir(parents=True)
    start.symlink_to("../dir/link/../safe")
    chained.symlink_to("../../outside")
    _git(tmp_repo, "add", ".claude/start", "dir/link")
    _git(tmp_repo, "commit", "-q", "-m", "add suffix dotdot escape chain")
    mgr = WorktreeManager(repo_path=tmp_repo, runs_root=tmp_repo / "runs")

    with pytest.raises(
        WorktreeContaminationError,
        match=r"future worktree.*\.claude/start",
    ):
        mgr.create("01ARZ3NDEKTSV4RRFFQ69G5FAV-suffix-dotdot")


def test_preflight_pins_same_commit_that_create_materializes(tmp_repo: Path):
    mgr = WorktreeManager(repo_path=tmp_repo, runs_root=tmp_repo / "runs")
    preparation = mgr.preflight()
    pinned_readme = (tmp_repo / "README.md").read_text(encoding="utf-8")

    (tmp_repo / "README.md").write_text("new mutable HEAD\n", encoding="utf-8")
    _git(tmp_repo, "add", "README.md")
    _git(tmp_repo, "commit", "-q", "-m", "advance mutable head")

    path = mgr.create(
        "01ARZ3NDEKTSV4RRFFQ69G5FAV-pinned",
        preparation=preparation,
    )
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=path,
        check=True,
        capture_output=True,
        text=True,
    )
    assert result.stdout.strip() == preparation.commit_oid
    assert (path / "README.md").read_text(encoding="utf-8") == pinned_readme


def test_walker_runs_worktree_security_preflight_before_graph_processing(
    tmp_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    """Isolation is scheduler step zero, ahead of topology and dispatch."""

    from hive.lib.dag_executor.executor import walker as walker_module
    from hive.lib.dag_executor.executor.dispatcher import Dispatcher
    from hive.lib.dag_executor.executor.telemetry import Telemetry
    from hive.lib.dag_executor.executor.walker import Walker
    from hive.lib.dag_executor.graph.model import Graph

    _commit_symlink(tmp_repo, ".claude/escape", "../../outside")
    mgr = WorktreeManager(repo_path=tmp_repo, runs_root=tmp_repo / "runs")

    def _topology_must_not_run(_graph):
        raise AssertionError("graph processing ran before worktree preflight")

    monkeypatch.setattr(walker_module, "_topological_order", _topology_must_not_run)
    with pytest.raises(WorktreeContaminationError, match="security precondition"):
        Walker().walk(
            graph=Graph(workflow_name="must-not-load", nodes={}),
            dispatcher=Dispatcher(handlers={}),
            run_id="01ARZ3NDEKTSV4RRFFQ69G5FAV-step-zero",
            telemetry=Telemetry(run_id="step-zero"),
            worktree_manager=mgr,
        )


@pytest.mark.parametrize("frontdoor", ["run_workflow", "run"])
def test_public_frontdoors_preflight_before_loading_workflow(
    tmp_repo: Path,
    frontdoor: str,
):
    """Malformed workflow YAML must remain unread when security rejects first."""

    from hive.lib.dag_executor import run_workflow
    from hive.lib.dag_executor.executor import StubAgentSpawn
    from hive.lib.dag_executor.run import run

    _commit_symlink(tmp_repo, ".claude/escape", "../../outside")
    workflow = tmp_repo / "invalid.workflow.yaml"
    workflow.write_text("nodes: [unterminated", encoding="utf-8")
    runs_root = tmp_repo / "runs"
    mgr = WorktreeManager(repo_path=tmp_repo, runs_root=runs_root)

    with pytest.raises(WorktreeContaminationError, match="security precondition"):
        if frontdoor == "run_workflow":
            run_workflow(
                workflow,
                dispatcher=object(),
                run_id="01ARZ3NDEKTSV4RRFFQ69G5FAV-frontdoor",
                worktree_manager=mgr,
            )
        else:
            run(
                workflow,
                spawn=StubAgentSpawn(canned_outputs={}),
                run_id="01ARZ3NDEKTSV4RRFFQ69G5FAV-frontdoor",
                repo_root=tmp_repo,
                worktree_manager=mgr,
            )

    assert not runs_root.exists()


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
