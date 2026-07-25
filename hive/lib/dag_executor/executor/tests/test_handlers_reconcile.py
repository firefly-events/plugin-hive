"""s7 — ReconcileHandler unit tests.

Acceptance criteria:
  AC1: Given branch + sha inputs, handler invokes cli.mjs reconcile and
       ff-merges; downstream gate sees committed files.
  AC2: Given no sha (local binding), handler is a clean no-op.
  AC3: Given non-ff or missing sha (after fetch), handler fails loud.
  AC4: Dispatcher routes NodeType.RECONCILE to ReconcileHandler without
       touching AgentHandler or GateHandler.
"""

from __future__ import annotations

import json
import subprocess
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from hive.lib.dag_executor.executor.dispatcher import Dispatcher
from hive.lib.dag_executor.executor.errors import ReconcileHandlerError
from hive.lib.dag_executor.executor.handlers.reconcile import ReconcileHandler
from hive.lib.dag_executor.graph import Node, NodeType


# ── helpers ────────────────────────────────────────────────────────────────────

def _reconcile_node(node_id: str = "reconcile-1") -> Node:
    return Node(id=node_id, agent="", node_type=NodeType.RECONCILE)


def _make_handler(tmp_path=None) -> ReconcileHandler:
    from pathlib import Path
    cli = (tmp_path / "cli.mjs") if tmp_path else Path("/fake/cli.mjs")
    return ReconcileHandler(cli_path=cli)


def _ok_result(data: dict | None = None) -> SimpleNamespace:
    payload = data or {"merged": True, "sha": "abc123", "output": "Fast-forward\n"}
    return SimpleNamespace(stdout=json.dumps(payload), stderr="", returncode=0)


def _fail_result(stderr: str = "NON_FF: fast-forward merge failed") -> SimpleNamespace:
    return SimpleNamespace(stdout="", stderr=stderr, returncode=1)


# ── AC2: local no-op ───────────────────────────────────────────────────────────

def test_local_noop_when_sha_absent(tmp_path):
    handler = _make_handler(tmp_path)
    out = handler.handle(_reconcile_node(), inputs={}, run_id="run-1")
    assert out.outputs == {"reconcile_status": "noop"}
    assert out.meta.get("reconcile") == "noop"


def test_local_noop_when_sha_empty_string(tmp_path):
    handler = _make_handler(tmp_path)
    out = handler.handle(_reconcile_node(), inputs={"sha": ""}, run_id="run-1")
    assert out.outputs == {"reconcile_status": "noop"}
    assert out.meta.get("reconcile") == "noop"


def test_local_noop_when_sha_none(tmp_path):
    handler = _make_handler(tmp_path)
    out = handler.handle(_reconcile_node(), inputs={"sha": None}, run_id="run-1")
    assert out.outputs == {"reconcile_status": "noop"}
    assert out.meta.get("reconcile") == "noop"


# ── AC1: ff-merge materialises files ──────────────────────────────────────────

def test_ff_merge_invokes_cli_with_correct_args(tmp_path):
    handler = _make_handler(tmp_path)
    inputs = {
        "sha": "abc123",
        "branch": "agent/dev/branch",
        "repo": "git@github.com:org/repo.git",
    }
    with patch("subprocess.run", return_value=_ok_result()) as mock_run:
        out = handler.handle(_reconcile_node(), inputs=inputs, run_id="run-x")

    cmd = mock_run.call_args[0][0]
    assert "reconcile" in cmd
    assert "--repo" in cmd
    repo_idx = cmd.index("--repo") + 1
    assert cmd[repo_idx] == "git@github.com:org/repo.git"
    assert "--branch" in cmd
    branch_idx = cmd.index("--branch") + 1
    assert cmd[branch_idx] == "agent/dev/branch"
    assert "--sha" in cmd
    sha_idx = cmd.index("--sha") + 1
    assert cmd[sha_idx] == "abc123"

    assert out.outputs["merged"] is True
    assert out.outputs["sha"] == "abc123"
    # pr20-fable-review M2: the real-sha ff-merge path must ALSO declare
    # reconcile_status (the noop path at line ~52 above already does) —
    # 8 workflow bindings consume $<reconcile-node>.output.reconcile_status.
    assert out.outputs["reconcile_status"] == "merged"


def test_ff_merge_passes_work_dir_when_provided(tmp_path):
    handler = _make_handler(tmp_path)
    inputs = {
        "sha": "deadbeef",
        "branch": "agent/xyz",
        "repo": "git@github.com:org/repo.git",
        "work_dir": "/some/work/dir",
    }
    with patch("subprocess.run", return_value=_ok_result()) as mock_run:
        handler.handle(_reconcile_node(), inputs=inputs, run_id="run-y")

    cmd = mock_run.call_args[0][0]
    assert "--work-dir" in cmd
    wd_idx = cmd.index("--work-dir") + 1
    assert cmd[wd_idx] == "/some/work/dir"


def test_ff_merge_from_named_origin_materialises_remote_tip(tmp_path):
    """Fix 6 contract: ``repo=origin`` is fetched in repo_root and the real
    bridge CLI fast-forwards the executor checkout to the harvested SHA."""
    origin = tmp_path / "origin.git"
    seed = tmp_path / "seed"
    target = tmp_path / "target"

    subprocess.run(["git", "init", "-q", "--bare", str(origin)], check=True)
    subprocess.run(["git", "init", "-q", "-b", "main", str(seed)], check=True)

    def git(repo, *args):
        return subprocess.run(
            ["git", "-C", str(repo), *args],
            check=True,
            capture_output=True,
            text=True,
        )

    git(seed, "config", "user.email", "t@t")
    git(seed, "config", "user.name", "t")
    (seed / "base.txt").write_text("base\n", encoding="utf-8")
    git(seed, "add", "-A")
    git(seed, "commit", "-q", "-m", "base")
    git(seed, "remote", "add", "origin", str(origin))
    git(seed, "push", "-q", "-u", "origin", "main")
    git(seed, "checkout", "-q", "-b", "feat/my-epic")
    git(seed, "push", "-q", "-u", "origin", "feat/my-epic")

    subprocess.run(["git", "clone", "-q", str(origin), str(target)], check=True)
    git(target, "checkout", "-q", "feat/my-epic")

    (seed / "implementation.py").write_text("done = True\n", encoding="utf-8")
    git(seed, "add", "-A")
    git(seed, "commit", "-q", "-m", "implementation")
    pushed_sha = git(seed, "rev-parse", "HEAD").stdout.strip()
    git(seed, "push", "-q", "origin", "feat/my-epic")

    out = ReconcileHandler(repo_root=target).handle(
        _reconcile_node(),
        inputs={
            "sha": pushed_sha,
            "branch": "feat/my-epic",
            "repo": "origin",
        },
        run_id="run-origin",
    )

    assert out.outputs["reconcile_status"] == "merged"
    assert git(target, "rev-parse", "HEAD").stdout.strip() == pushed_sha
    assert (target / "implementation.py").read_text(encoding="utf-8") == "done = True\n"


def test_repo_root_is_merge_target_overriding_work_dir_input(tmp_path):
    """#8: when repo_root is configured (production), the ff-merge target is
    repo_root — the tree the downstream gate validates — NOT the agent's
    work_dir input, which is only the fetch source. Otherwise the merge runs in
    the agent's own repo (already has the commit) and the epic never lands where
    the gate looks.
    """
    project = tmp_path / "project"
    handler = ReconcileHandler(cli_path=(tmp_path / "cli.mjs"), repo_root=project)
    inputs = {
        "sha": "deadbeef",
        "branch": "agent/xyz",
        "repo": "/agent/work/repo",     # fetch source (agent work_dir)
        "work_dir": "/agent/work/repo",  # must NOT become the merge target
    }
    with patch("subprocess.run", return_value=_ok_result()) as mock_run:
        handler.handle(_reconcile_node(), inputs=inputs, run_id="run-z")

    cmd = mock_run.call_args[0][0]
    wd_idx = cmd.index("--work-dir") + 1
    assert cmd[wd_idx] == str(project.resolve())
    assert cmd[wd_idx] != "/agent/work/repo"


def test_ff_merge_omits_work_dir_when_absent(tmp_path):
    handler = _make_handler(tmp_path)
    inputs = {
        "sha": "deadbeef",
        "branch": "agent/xyz",
        "repo": "git@github.com:org/repo.git",
    }
    with patch("subprocess.run", return_value=_ok_result()) as mock_run:
        handler.handle(_reconcile_node(), inputs=inputs, run_id="run-z")

    cmd = mock_run.call_args[0][0]
    assert "--work-dir" not in cmd


# ── AC3: non-ff / missing sha fails loud ──────────────────────────────────────

def test_non_ff_merge_raises_reconcile_handler_error(tmp_path):
    handler = _make_handler(tmp_path)
    inputs = {
        "sha": "cafebabe",
        "branch": "agent/dev",
        "repo": "git@github.com:org/repo.git",
    }
    with patch("subprocess.run", return_value=_fail_result("NON_FF: diverged")):
        with pytest.raises(ReconcileHandlerError, match="failed"):
            handler.handle(_reconcile_node(), inputs=inputs, run_id="run-ff")


def test_missing_branch_with_sha_raises(tmp_path):
    handler = _make_handler(tmp_path)
    with pytest.raises(ReconcileHandlerError, match="branch"):
        handler.handle(
            _reconcile_node(),
            inputs={"sha": "abc123", "repo": "git@github.com:org/repo.git"},
            run_id="run-nb",
        )


def test_missing_repo_with_sha_raises(tmp_path):
    handler = _make_handler(tmp_path)
    with pytest.raises(ReconcileHandlerError, match="repo"):
        handler.handle(
            _reconcile_node(),
            inputs={"sha": "abc123", "branch": "agent/dev"},
            run_id="run-nr",
        )


def test_cli_non_json_stdout_raises(tmp_path):
    handler = _make_handler(tmp_path)
    inputs = {"sha": "abc123", "branch": "b", "repo": "r"}
    bad = SimpleNamespace(stdout="not json", stderr="", returncode=0)
    with patch("subprocess.run", return_value=bad):
        with pytest.raises(ReconcileHandlerError, match="non-JSON"):
            handler.handle(_reconcile_node(), inputs=inputs, run_id="run-bad")


def test_cli_non_dict_json_raises(tmp_path):
    handler = _make_handler(tmp_path)
    inputs = {"sha": "abc123", "branch": "b", "repo": "r"}
    bad = SimpleNamespace(stdout=json.dumps([1, 2, 3]), stderr="", returncode=0)
    with patch("subprocess.run", return_value=bad):
        with pytest.raises(ReconcileHandlerError, match="non-dict"):
            handler.handle(_reconcile_node(), inputs=inputs, run_id="run-nd")


def test_timeout_raises_reconcile_handler_error(tmp_path):
    import subprocess as sp
    handler = _make_handler(tmp_path)
    inputs = {"sha": "abc123", "branch": "b", "repo": "r"}
    with patch("subprocess.run", side_effect=sp.TimeoutExpired(cmd="node", timeout=0.1)):
        with pytest.raises(ReconcileHandlerError, match="timed out"):
            handler.handle(_reconcile_node(), inputs=inputs, run_id="run-to")


# ── AC4: dispatcher routes RECONCILE without touching AgentHandler/GateHandler ─

def test_dispatcher_routes_reconcile_node():
    d = Dispatcher()
    inputs = {}  # no sha → no-op path, no subprocess needed
    out = d.dispatch(_reconcile_node(), inputs=inputs, run_id="disp-1")
    assert out.meta.get("reconcile") == "noop"


def test_dispatcher_reconcile_does_not_affect_agent_handler():
    """Registering AgentHandler and then dispatching a reconcile node must not
    invoke the agent handler at all."""
    from hive.lib.dag_executor.executor.handlers import AgentHandler, StubAgentSpawn

    spy = StubAgentSpawn(canned_outputs={"agent-n": {"result": "oops"}})
    d = Dispatcher()
    d.register(NodeType.AGENT, AgentHandler(spawn=spy).handle)

    # Dispatch reconcile — spy must never be called
    d.dispatch(_reconcile_node(), inputs={}, run_id="disp-2")
    assert spy.calls == [], "AgentHandler must not be invoked for a reconcile node"


def test_dispatcher_reconcile_does_not_affect_gate_handler():
    """Dispatching a reconcile node must not invoke GateHandler."""
    from hive.lib.dag_executor.executor.handlers import GateHandler

    gate_calls: list = []
    original_handle = GateHandler().handle

    def spy_gate(node, inputs, run_id):
        gate_calls.append(node.id)
        return original_handle(node, inputs, run_id)

    d = Dispatcher(handlers={NodeType.GATE: spy_gate})
    d.dispatch(_reconcile_node(), inputs={}, run_id="disp-3")
    assert gate_calls == [], "GateHandler must not be invoked for a reconcile node"


# ── Gate-after-reconcile sees committed files (integration shape) ──────────────

def test_gate_after_reconcile_receives_merged_outputs(tmp_path):
    """Simulates the agent → reconcile → gate sequence at the handler level.

    The reconcile node's outputs (merged, sha) are made available as
    inputs to the gate, proving the pipeline wiring works end-to-end
    without a real subprocess.
    """
    from hive.lib.dag_executor.executor.handlers.gate import GateHandler
    from hive.lib.dag_executor.graph import Node, NodeType

    reconcile_handler = _make_handler(tmp_path)
    reconcile_inputs = {
        "sha": "abc123",
        "branch": "agent/dev",
        "repo": "git@github.com:org/repo.git",
    }
    merged_payload = {"merged": True, "sha": "abc123", "output": "Fast-forward\n"}

    with patch("subprocess.run", return_value=_ok_result(merged_payload)):
        reconcile_out = reconcile_handler.handle(
            _reconcile_node(), inputs=reconcile_inputs, run_id="seq-1"
        )

    # Gate sees reconcile outputs — confirm sha flowed through
    assert reconcile_out.outputs["merged"] is True
    assert reconcile_out.outputs["sha"] == "abc123"

    # Gate node uses the reconcile output — "sha must not be empty" confirms
    # the merged sha flowed through to the gate's input context.
    gate_node = Node(
        id="gate-1",
        agent="",
        node_type=NodeType.GATE,
        gate="sha must not be empty",
    )
    gate_inputs = dict(reconcile_out.outputs)
    gate_out = GateHandler().handle(gate_node, inputs=gate_inputs, run_id="seq-1")
    assert gate_out.outputs.get("gate_passed") is True


# ── #20: materialise uncommitted epic into repo_root ──────────────────────────

def _handler_with_root(tmp_path, repo_root):
    from pathlib import Path
    return ReconcileHandler(cli_path=tmp_path / "cli.mjs", repo_root=repo_root)


def _seed_uncommitted_epic(work_dir, nested="ttt-throwaway"):
    """Agent wrote the epic into a (nested) checkout but did NOT commit it."""
    base = work_dir / nested if nested else work_dir
    epic = base / ".pHive/epics/ttt-game"
    (epic / "stories").mkdir(parents=True)
    (epic / "epic.yaml").write_text("name: ttt-game\n", encoding="utf-8")
    (epic / "stories" / "s1.yaml").write_text("id: s1\n", encoding="utf-8")


def test_noop_materialises_uncommitted_epic(tmp_path):
    """sha empty (HEAD == base) but the agent wrote an untracked epic — copy it
    into repo_root so the downstream gate finds it (#20)."""
    repo_root = tmp_path / "repo_root"
    repo_root.mkdir()
    work_dir = tmp_path / "work"
    work_dir.mkdir()
    _seed_uncommitted_epic(work_dir)

    handler = _handler_with_root(tmp_path, repo_root)
    out = handler.handle(
        _reconcile_node(),
        inputs={"work_dir": str(work_dir), "epic_dir": ".pHive/epics/ttt-game"},
        run_id="run-1",
    )
    assert out.meta.get("epic_copied") is True
    assert (repo_root / ".pHive/epics/ttt-game/epic.yaml").exists()
    assert (repo_root / ".pHive/epics/ttt-game/stories/s1.yaml").exists()


def test_merge_path_materialises_when_repo_root_missing_epic(tmp_path):
    """sha set, git step ok, but the epic is absent from repo_root (untracked
    HEAD==base no-op merge) — fall back to copying from the work_dir checkout."""
    repo_root = tmp_path / "repo_root"
    repo_root.mkdir()
    work_dir = tmp_path / "work"
    work_dir.mkdir()
    _seed_uncommitted_epic(work_dir)

    handler = _handler_with_root(tmp_path, repo_root)
    with patch("subprocess.run", return_value=_ok_result()):
        out = handler.handle(
            _reconcile_node(),
            inputs={
                "sha": "b635fb5",
                "branch": "agent/technical-writer/x",
                "repo": "git@github.com:org/ttt.git",
                "work_dir": str(work_dir),
                "epic_dir": ".pHive/epics/ttt-game",
            },
            run_id="run-1",
        )
    assert out.meta.get("epic_copied") is True
    assert (repo_root / ".pHive/epics/ttt-game/epic.yaml").exists()


def test_materialise_idempotent_when_epic_already_present(tmp_path):
    """When git already materialised the committed epic, do not re-copy."""
    repo_root = tmp_path / "repo_root"
    (repo_root / ".pHive/epics/ttt-game").mkdir(parents=True)
    (repo_root / ".pHive/epics/ttt-game/epic.yaml").write_text("name: ttt-game\n", encoding="utf-8")
    work_dir = tmp_path / "work"
    work_dir.mkdir()
    _seed_uncommitted_epic(work_dir)

    handler = _handler_with_root(tmp_path, repo_root)
    with patch("subprocess.run", return_value=_ok_result()):
        out = handler.handle(
            _reconcile_node(),
            inputs={
                "sha": "abc123",
                "branch": "agent/dev",
                "repo": "git@github.com:org/ttt.git",
                "work_dir": str(work_dir),
                "epic_dir": ".pHive/epics/ttt-game",
            },
            run_id="run-1",
        )
    assert out.meta.get("epic_copied") is False


# ── s2: marker-driven correlation + failure-detection ─────────────────────────

def _write_marker(state_dir, agent_id, *, verdict="success", cwd="", written_at=None):
    marker_dir = state_dir / "agent-complete" / agent_id
    marker_dir.mkdir(parents=True, exist_ok=True)
    payload = {"agent_id": agent_id, "verdict": verdict, "cwd": cwd}
    if written_at is not None:
        payload["written_at"] = written_at
    (marker_dir / "complete.json").write_text(json.dumps(payload), encoding="utf-8")


def _make_handler_with_state_dir(tmp_path, state_dir):
    from pathlib import Path
    return ReconcileHandler(cli_path=tmp_path / "cli.mjs", state_dir=state_dir)


def test_marker_success_ff_merges(tmp_path):
    state_dir = tmp_path / "state"
    _write_marker(state_dir, "agent-1", verdict="success", cwd="/work/agent-1")
    handler = _make_handler_with_state_dir(tmp_path, state_dir)
    inputs = {
        "sha": "abc123",
        "branch": "agent/dev/branch",
        "repo": "git@github.com:org/repo.git",
        "agent_id": "agent-1",
        "tracker_id": "PLU-1",
    }
    with patch("subprocess.run", return_value=_ok_result()) as mock_run:
        out = handler.handle(_reconcile_node(), inputs=inputs, run_id="run-marker")
    assert out.outputs["reconcile_status"] == "merged"
    # branch already bound — the git rev-parse HEAD probe must not run.
    assert mock_run.call_count == 1


def test_marker_untracked_agent_ignored_and_treated_as_failure(tmp_path):
    """A complete.json from some OTHER (untracked) subagent must not be
    picked up: reading an agent_id with no marker of its own must fail, not
    silently fall through to a merge (R2)."""
    state_dir = tmp_path / "state"
    _write_marker(state_dir, "researcher-9", verdict="success", cwd="/work/researcher-9")
    handler = _make_handler_with_state_dir(tmp_path, state_dir)
    inputs = {
        "sha": "abc123",
        "branch": "agent/dev/branch",
        "repo": "git@github.com:org/repo.git",
        "agent_id": "agent-1",  # no marker written for this agent_id
        "tracker_id": "PLU-1",
    }
    with pytest.raises(ReconcileHandlerError, match="no successful complete.json marker"):
        handler.handle(_reconcile_node(), inputs=inputs, run_id="run-untracked")


def test_marker_failure_verdict_not_merged(tmp_path):
    state_dir = tmp_path / "state"
    _write_marker(state_dir, "agent-1", verdict="failure", cwd="/work/agent-1")
    handler = _make_handler_with_state_dir(tmp_path, state_dir)
    inputs = {
        "sha": "abc123",
        "branch": "agent/dev/branch",
        "repo": "git@github.com:org/repo.git",
        "agent_id": "agent-1",
        "tracker_id": "PLU-1",
    }
    with patch("subprocess.run") as mock_run:
        with pytest.raises(ReconcileHandlerError, match="verdict='failure'"):
            handler.handle(_reconcile_node(), inputs=inputs, run_id="run-fail")
    mock_run.assert_not_called()


def test_marker_no_branch_field_derives_from_cwd(tmp_path):
    state_dir = tmp_path / "state"
    _write_marker(state_dir, "agent-1", verdict="success", cwd="/work/agent-1")
    handler = _make_handler_with_state_dir(tmp_path, state_dir)
    inputs = {
        "sha": "abc123",
        "repo": "git@github.com:org/repo.git",
        "agent_id": "agent-1",
        "tracker_id": "PLU-1",
    }

    def _side_effect(cmd, **kwargs):
        if "rev-parse" in cmd:
            assert cmd[cmd.index("-C") + 1] == "/work/agent-1"
            return SimpleNamespace(stdout="agent/dev/from-marker\n", stderr="", returncode=0)
        if "branch" in cmd and "-f" in cmd:
            assert cmd[-2:] == ["reconcile-harvest/abc123", "abc123"]
            return SimpleNamespace(stdout="", stderr="", returncode=0)
        return _ok_result()

    with patch("subprocess.run", side_effect=_side_effect) as mock_run:
        handler.handle(_reconcile_node(), inputs=inputs, run_id="run-derive")

    cmd = mock_run.call_args_list[-1][0][0]
    branch_idx = cmd.index("--branch") + 1
    assert cmd[branch_idx] == "reconcile-harvest/abc123"


def test_derive_branch_mints_ephemeral_for_agent_head(tmp_path):
    """A daemon agent/* HEAD is not a stable integration ref. Reconcile must
    mint a SHA-derived local branch at the exact harvested commit instead."""
    import subprocess as sp

    repo = tmp_path / "repo"
    repo.mkdir()
    def git(*args):
        return sp.run(
            ["git", "-C", str(repo), *args],
            check=True,
            capture_output=True,
            text=True,
        )

    git("init", "-q")
    git("config", "user.email", "t@t")
    git("config", "user.name", "t")
    git("checkout", "-q", "-b", "agent/dev/task")
    (repo / "impl.py").write_text("work", encoding="utf-8")
    git("add", "-A")
    git("commit", "-q", "-m", "agent work")
    sha = git("rev-parse", "HEAD").stdout.strip()

    branch = ReconcileHandler._derive_branch_from_repo(str(repo), sha)

    assert branch == f"reconcile-harvest/{sha[:12]}"
    assert git("rev-parse", branch).stdout.strip() == sha


def test_derive_branch_preserves_non_daemon_named_branch(tmp_path):
    """Only the exact agent/ namespace is daemon-owned; similarly named user
    branches must continue to pass through unchanged."""
    import subprocess as sp

    repo = tmp_path / "repo"
    repo.mkdir()
    def git(*args):
        return sp.run(
            ["git", "-C", str(repo), *args],
            check=True,
            capture_output=True,
            text=True,
        )

    git("init", "-q")
    git("config", "user.email", "t@t")
    git("config", "user.name", "t")
    git("checkout", "-q", "-b", "agentic/feature")
    (repo / "impl.py").write_text("work", encoding="utf-8")
    git("add", "-A")
    git("commit", "-q", "-m", "work")
    sha = git("rev-parse", "HEAD").stdout.strip()

    assert ReconcileHandler._derive_branch_from_repo(str(repo), sha) == "agentic/feature"


def test_derive_branch_still_mints_ephemeral_for_detached_head(tmp_path):
    """The agent/* guard extends the established detached-HEAD fallback; it
    must not regress that original reconciliation path."""
    import subprocess as sp

    repo = tmp_path / "repo"
    repo.mkdir()
    def git(*args):
        return sp.run(
            ["git", "-C", str(repo), *args],
            check=True,
            capture_output=True,
            text=True,
        )

    git("init", "-q")
    git("config", "user.email", "t@t")
    git("config", "user.name", "t")
    (repo / "impl.py").write_text("work", encoding="utf-8")
    git("add", "-A")
    git("commit", "-q", "-m", "work")
    sha = git("rev-parse", "HEAD").stdout.strip()
    git("checkout", "-q", "--detach", sha)

    branch = ReconcileHandler._derive_branch_from_repo(str(repo), sha)

    assert branch == f"reconcile-harvest/{sha[:12]}"
    assert git("rev-parse", branch).stdout.strip() == sha


# ── Critical #2 (PLU-577 revision): freshness guard + consume-on-read ─────────

def test_marker_success_deletes_marker_after_consumption(tmp_path):
    state_dir = tmp_path / "state"
    _write_marker(state_dir, "agent-1", verdict="success", cwd="/work/agent-1")
    handler = _make_handler_with_state_dir(tmp_path, state_dir)
    inputs = {
        "sha": "abc123",
        "branch": "agent/dev/branch",
        "repo": "git@github.com:org/repo.git",
        "agent_id": "agent-1",
        "tracker_id": "PLU-1",
    }
    marker_path = state_dir / "agent-complete" / "agent-1" / "complete.json"
    assert marker_path.exists()
    with patch("subprocess.run", return_value=_ok_result()):
        handler.handle(_reconcile_node(), inputs=inputs, run_id="run-marker-consume")
    assert not marker_path.exists(), "marker must be deleted once read so a later, recycled agent_id can't reuse it"


def test_marker_success_survives_concurrent_delete_race(tmp_path):
    """t-008: a concurrent cleanup (e.g. a second reconcile racing the same
    recycled agent_id) may unlink the marker file between our read and our
    own consume-on-read delete. That race must not fail an otherwise-
    successful reconcile — `_delete_marker` swallows OSError precisely for
    this case."""
    state_dir = tmp_path / "state"
    _write_marker(state_dir, "agent-1", verdict="success", cwd="/work/agent-1")
    handler = _make_handler_with_state_dir(tmp_path, state_dir)
    inputs = {
        "sha": "abc123",
        "branch": "agent/dev/branch",
        "repo": "git@github.com:org/repo.git",
        "agent_id": "agent-1",
        "tracker_id": "PLU-1",
    }
    with patch("subprocess.run", return_value=_ok_result()), \
        patch("pathlib.Path.unlink", side_effect=FileNotFoundError):
        out = handler.handle(_reconcile_node(), inputs=inputs, run_id="run-delete-race")
    assert out.outputs["reconcile_status"] == "merged", "delete race on marker cleanup must not fail the reconcile"


def test_marker_stale_older_than_task_start_is_rejected(tmp_path):
    """A leftover complete.json from an earlier story dispatched under the
    same (recycled) persona agent_id must not be accepted for a later story
    whose task started AFTER that marker was written."""
    state_dir = tmp_path / "state"
    _write_marker(
        state_dir,
        "agent-1",
        verdict="success",
        cwd="/work/agent-1",
        written_at="2026-05-21T00:00:05.000Z",
    )
    handler = _make_handler_with_state_dir(tmp_path, state_dir)
    inputs = {
        "sha": "abc123",
        "branch": "agent/dev/branch",
        "repo": "git@github.com:org/repo.git",
        "agent_id": "agent-1",
        "tracker_id": "PLU-1",
        "started_at": "2026-05-21T01:00:00.000Z",  # this task started AFTER the stale marker
    }
    with pytest.raises(ReconcileHandlerError, match="no successful complete.json marker"):
        handler.handle(_reconcile_node(), inputs=inputs, run_id="run-stale")
    marker_path = state_dir / "agent-complete" / "agent-1" / "complete.json"
    assert not marker_path.exists(), "stale marker must still be consumed/deleted"


def test_marker_fresh_relative_to_task_start_is_accepted(tmp_path):
    state_dir = tmp_path / "state"
    _write_marker(
        state_dir,
        "agent-1",
        verdict="success",
        cwd="/work/agent-1",
        written_at="2026-05-21T01:00:05.000Z",
    )
    handler = _make_handler_with_state_dir(tmp_path, state_dir)
    inputs = {
        "sha": "abc123",
        "branch": "agent/dev/branch",
        "repo": "git@github.com:org/repo.git",
        "agent_id": "agent-1",
        "tracker_id": "PLU-1",
        "started_at": "2026-05-21T01:00:00.000Z",  # marker written AFTER this task started — fresh
    }
    with patch("subprocess.run", return_value=_ok_result()):
        out = handler.handle(_reconcile_node(), inputs=inputs, run_id="run-fresh")
    assert out.outputs["reconcile_status"] == "merged"


@pytest.mark.parametrize("evil", ["/etc/cron.d/x", "../../escape", "../sibling"])
def test_materialise_rejects_unsafe_epic_dir(tmp_path, evil):
    """epic_dir is upstream agent output (#13 outputs.yaml / harvest). An absolute
    path or a `..` traversal must NOT let copytree write outside repo_root —
    arbitrary filesystem write (Codex review of #316). Reject loud instead.
    """
    repo_root = tmp_path / "repo_root"
    repo_root.mkdir()
    work_dir = tmp_path / "work"
    work_dir.mkdir()

    handler = _handler_with_root(tmp_path, repo_root)
    with pytest.raises(ReconcileHandlerError, match="unsafe epic_dir"):
        handler.handle(
            _reconcile_node(),
            inputs={"work_dir": str(work_dir), "epic_dir": evil},
            run_id="run-1",
        )
