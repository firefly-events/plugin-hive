"""s6 — MulticaAgentSpawn unit tests.

Tests:
  - call shape (verbatim step_file_content, raw agent name, run_id/step_id)
  - idempotency: same (run_id, step_id) reuses tracker_id without re-minting
  - terminal-failure surfacing (failed/cancelled → AgentHandlerError)
  - R1 smoke: gated on MULTICA_SERVER_URL presence (skipped if absent)

All non-smoke tests mock subprocess.run so no Multica server is needed.
"""

from __future__ import annotations

import json
import os
import textwrap
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from hive.lib.dag_executor.executor.errors import AgentHandlerError
from hive.lib.dag_executor.executor.handlers.agent import MulticaAgentSpawn


# ── helpers ────────────────────────────────────────────────────────────────────

def _make_spawn(tmp_path: Path, **kwargs) -> MulticaAgentSpawn:
    return MulticaAgentSpawn(
        cli_path=tmp_path / "cli.mjs",  # dummy path; subprocess is mocked
        repo_root=tmp_path,
        **kwargs,
    )


def _completed_poll_result(**extra) -> dict:
    return {
        "status": "completed",
        "notes": "",
        "task_id": "task-abc",
        "agent_id": "agent-xyz",
        "work_dir": "/tmp/work",
        "code_push_sha": None,
        **extra,
    }


def _make_subprocess_result(stdout_dict: dict, returncode: int = 0) -> SimpleNamespace:
    return SimpleNamespace(
        stdout=json.dumps(stdout_dict),
        stderr="",
        returncode=returncode,
    )


def _dispatch_result() -> dict:
    return {"status": "dispatched", "issue_id": "issue-uuid-1", "task_id": "task-abc"}


def _create_issue_result(issue_id: str = "issue-uuid-1") -> dict:
    return {"id": issue_id, "url": f"https://example.com/issues/{issue_id}"}


# ── call shape ─────────────────────────────────────────────────────────────────

def test_step_file_content_passed_verbatim_to_create_issue(tmp_path):
    content = "# Step\n\n**bold** — don't touch me.\n```python\nx = 1\n```\n"
    spawn = _make_spawn(tmp_path)

    side_effects = [
        _make_subprocess_result(_create_issue_result()),
        _make_subprocess_result(_dispatch_result()),
        _make_subprocess_result(_completed_poll_result()),
    ]
    with patch("subprocess.run", side_effect=side_effects) as mock_run:
        spawn("developer", content, {}, "run-1", "step-A")

    create_call = mock_run.call_args_list[0]
    cmd = create_call[0][0]
    body_idx = cmd.index("--body") + 1
    # step_file_content must reach the body VERBATIM (no paraphrase/trim). It is
    # now framed under a `## Task` heading so inputs can precede it (#12), so
    # assert verbatim containment rather than exact equality.
    assert content in cmd[body_idx], "step_file_content must reach cli.mjs --body verbatim"


def test_inputs_reach_create_issue_body(tmp_path):
    """#12: the node's inputs (requirement, upstream outputs) must be sent to
    the Multica agent via the issue body — not just the step_file. Otherwise the
    agent has no requirement and can only improvise from the repo.
    """
    spawn = _make_spawn(tmp_path)
    side_effects = [
        _make_subprocess_result(_create_issue_result()),
        _make_subprocess_result(_dispatch_result()),
        _make_subprocess_result(_completed_poll_result()),
    ]
    inputs = {"requirement": "Build tic-tac-toe in vanilla JS", "research_brief": "BRIEF-MARKER"}
    with patch("subprocess.run", side_effect=side_effects) as mock_run:
        spawn("technical-writer", "## author the epic", inputs, "run-1", "author")

    cmd = mock_run.call_args_list[0][0][0]
    body = cmd[cmd.index("--body") + 1]
    assert "Build tic-tac-toe in vanilla JS" in body
    assert "BRIEF-MARKER" in body


def test_raw_agent_name_forwarded_to_dispatch(tmp_path):
    spawn = _make_spawn(tmp_path)
    side_effects = [
        _make_subprocess_result(_create_issue_result()),
        _make_subprocess_result(_dispatch_result()),
        _make_subprocess_result(_completed_poll_result()),
    ]
    with patch("subprocess.run", side_effect=side_effects) as mock_run:
        spawn("developer", "brief", {}, "run-1", "step-A")

    dispatch_call = mock_run.call_args_list[1]
    cmd = dispatch_call[0][0]
    agent_idx = cmd.index("--agent") + 1
    assert cmd[agent_idx] == "developer"


def test_outputs_include_code_push_sha_and_work_dir(tmp_path):
    spawn = _make_spawn(tmp_path)
    side_effects = [
        _make_subprocess_result(_create_issue_result()),
        _make_subprocess_result(_dispatch_result()),
        _make_subprocess_result(
            _completed_poll_result(code_push_sha="abc123", work_dir="/work/dir")
        ),
    ]
    with patch("subprocess.run", side_effect=side_effects):
        result = spawn("developer", "brief", {}, "run-1", "step-A")

    assert "code_push_sha" in result
    assert result["code_push_sha"] == "abc123"
    assert "work_dir" in result
    assert result["work_dir"] == "/work/dir"


# ── idempotency ────────────────────────────────────────────────────────────────

def test_idempotency_reuses_tracker_id_on_second_call(tmp_path):
    """Same (run_id, step_id) must NOT mint a second issue."""
    spawn = _make_spawn(tmp_path)

    first_side_effects = [
        _make_subprocess_result(_create_issue_result("issue-1")),
        _make_subprocess_result(_dispatch_result()),
        _make_subprocess_result(_completed_poll_result()),
    ]
    with patch("subprocess.run", side_effect=first_side_effects):
        spawn("developer", "brief", {}, "run-resume", "step-X")

    # Second call — create-issue must NOT be called again
    second_side_effects = [
        _make_subprocess_result(_dispatch_result()),
        _make_subprocess_result(_completed_poll_result()),
    ]
    with patch("subprocess.run", side_effect=second_side_effects) as mock_run:
        spawn("developer", "brief", {}, "run-resume", "step-X")

    commands = [c[0][0][2] for c in mock_run.call_args_list]  # 3rd argv element = subcommand
    assert "create-issue" not in commands, "create-issue must not be called on resume"


def test_idempotency_different_step_id_mints_new_issue(tmp_path):
    """Different step_id → new issue, even same run_id."""
    spawn = _make_spawn(tmp_path)

    call_count = [0]

    def side_effect(*args, **kwargs):
        call_count[0] += 1
        cmd = args[0]
        sub = cmd[2]
        if sub == "create-issue":
            return _make_subprocess_result(_create_issue_result(f"issue-{call_count[0]}"))
        if sub == "dispatch":
            return _make_subprocess_result(_dispatch_result())
        return _make_subprocess_result(_completed_poll_result())

    with patch("subprocess.run", side_effect=side_effect):
        spawn("developer", "brief", {}, "run-1", "step-A")
        spawn("developer", "brief", {}, "run-1", "step-B")

    # Each step should have its own tracker state file
    assert (tmp_path / ".pHive" / "dag-spawn-state" / "run-1" / "step-A" / "tracker.json").exists()
    assert (tmp_path / ".pHive" / "dag-spawn-state" / "run-1" / "step-B" / "tracker.json").exists()


def test_idempotency_state_file_persists_tracker_id(tmp_path):
    spawn = _make_spawn(tmp_path)
    side_effects = [
        _make_subprocess_result(_create_issue_result("issue-persisted")),
        _make_subprocess_result(_dispatch_result()),
        _make_subprocess_result(_completed_poll_result()),
    ]
    with patch("subprocess.run", side_effect=side_effects):
        spawn("developer", "brief", {}, "run-p", "step-p")

    state_file = tmp_path / ".pHive" / "dag-spawn-state" / "run-p" / "step-p" / "tracker.json"
    data = json.loads(state_file.read_text())
    assert data["tracker_id"] == "issue-persisted"


# ── terminal-failure surfacing ─────────────────────────────────────────────────

@pytest.mark.parametrize("status", ["failed", "cancelled"])
def test_non_completed_terminal_raises(tmp_path, status):
    spawn = _make_spawn(tmp_path)
    side_effects = [
        _make_subprocess_result(_create_issue_result()),
        _make_subprocess_result(_dispatch_result()),
        _make_subprocess_result({"status": status, "notes": "something broke", "task_id": "t1",
                                  "agent_id": None, "work_dir": None}),
    ]
    with patch("subprocess.run", side_effect=side_effects):
        with pytest.raises(AgentHandlerError, match=status):
            spawn("developer", "brief", {}, "run-fail", "step-fail")


def test_cli_nonzero_exit_raises(tmp_path):
    spawn = _make_spawn(tmp_path)
    error_result = SimpleNamespace(stdout="", stderr='{"code":"HTTP_401","message":"Unauthorized"}', returncode=1)
    with patch("subprocess.run", return_value=error_result):
        with pytest.raises(AgentHandlerError, match="exited 1"):
            spawn("developer", "brief", {}, "run-err", "step-err")


def test_cli_non_json_stdout_raises(tmp_path):
    spawn = _make_spawn(tmp_path)
    bad_result = SimpleNamespace(stdout="not json", stderr="", returncode=0)
    with patch("subprocess.run", return_value=bad_result):
        with pytest.raises(AgentHandlerError, match="non-JSON"):
            spawn("developer", "brief", {}, "run-bad", "step-bad")


# ── H1/H2: server-side dedup (absent-state resume) ────────────────────────────

def test_server_dedup_absent_state_passes_dedup_title_flag(tmp_path):
    """Cross-machine resume: local state absent → create-issue called with --dedup-title.

    Verifies H1+H2: the server is the authoritative idempotency source. When the local
    tracker.json is missing (different CI worker / fresh clone), create-issue is re-called
    but --dedup-title ensures the server can return the existing issue instead of minting
    a duplicate. The returned tracker_id must match the server's existing issue.
    """
    spawn = _make_spawn(tmp_path)

    # First run — normal path; creates issue and writes local state cache.
    first_effects = [
        _make_subprocess_result(_create_issue_result("issue-xmachine")),
        _make_subprocess_result(_dispatch_result()),
        _make_subprocess_result(_completed_poll_result()),
    ]
    with patch("subprocess.run", side_effect=first_effects):
        spawn("developer", "brief", {}, "run-xm", "step-Y")

    # Simulate fresh clone / different CI worker: delete the local cache.
    state_file = (
        tmp_path / ".pHive" / "dag-spawn-state" / "run-xm" / "step-Y" / "tracker.json"
    )
    state_file.unlink()

    # Resume: create-issue is re-called (no local cache), but --dedup-title must be
    # present so the server can return the existing issue instead of minting a duplicate.
    resume_effects = [
        _make_subprocess_result(_create_issue_result("issue-xmachine")),  # server dedup
        _make_subprocess_result(_dispatch_result()),
        _make_subprocess_result(_completed_poll_result()),
    ]
    with patch("subprocess.run", side_effect=resume_effects) as mock_run:
        result = spawn("developer", "brief", {}, "run-xm", "step-Y")

    create_calls = [c for c in mock_run.call_args_list if c[0][0][2] == "create-issue"]
    assert len(create_calls) == 1, "create-issue must be called on absent-state resume"
    cmd = create_calls[0][0][0]
    assert "--dedup-title" in cmd, "--dedup-title flag must be passed to create-issue"
    # Server returned the existing id — no duplicate minted.
    assert result["tracker_id"] == "issue-xmachine"


def test_intent_marker_written_before_create_issue(tmp_path):
    """H1 belt-and-suspenders: intent marker (no tracker_id) is written before the network call."""
    spawn = _make_spawn(tmp_path)
    state_path = tmp_path / ".pHive" / "dag-spawn-state" / "run-h1" / "step-Z" / "tracker.json"

    marker_at_create_time: dict = {}

    def capture_intent(*args, **kwargs):
        # On the create-issue call, read the state file (should already be written).
        cmd = args[0]
        if len(cmd) > 2 and cmd[2] == "create-issue":
            try:
                marker_at_create_time.update(
                    __import__("json").loads(state_path.read_text(encoding="utf-8"))
                )
            except (OSError, ValueError):
                pass
        return _make_subprocess_result(
            _create_issue_result() if len(cmd) > 2 and cmd[2] == "create-issue"
            else _dispatch_result() if len(cmd) > 2 and cmd[2] == "dispatch"
            else _completed_poll_result()
        )

    with patch("subprocess.run", side_effect=capture_intent):
        spawn("developer", "brief", {}, "run-h1", "step-Z")

    assert "run_id" in marker_at_create_time, "intent marker must exist before create-issue"
    assert "tracker_id" not in marker_at_create_time, "intent marker must not have tracker_id yet"
    # After full completion, state file must contain tracker_id.
    final = __import__("json").loads(state_path.read_text(encoding="utf-8"))
    assert final.get("tracker_id") == "issue-uuid-1"


# ── R1 smoke: gated on real Multica runtime ────────────────────────────────────

_HAS_MULTICA = bool(os.environ.get("MULTICA_SERVER_URL"))
# Set MULTICA_SMOKE_AGENT to the name of a headless agent (e.g. "codex") in your workspace.
# The spec requires a Codex agent (Claude agents 401 headless on Studio); skip if unset.
_SMOKE_AGENT = os.environ.get("MULTICA_SMOKE_AGENT", "")


@pytest.mark.skipif(
    not _HAS_MULTICA or not _SMOKE_AGENT,
    reason=(
        "R1 smoke: set MULTICA_SERVER_URL + MULTICA_SMOKE_AGENT=<headless-agent> "
        "(e.g. codex) to run the Codex-headless smoke"
    ),
)
def test_r1_codex_headless_smoke(tmp_path):
    """R1: trivial 2-node graph completes headless via Multica through the
    production front door with the multica binding selected.

    Requires env: MULTICA_SERVER_URL, MULTICA_TOKEN, MULTICA_WORKSPACE_ID.
    Each step_file instructs a Codex agent to return a trivial JSON dict.
    """
    from hive.lib.dag_executor.run import run as dag_run

    steps_dir = tmp_path / "steps"
    steps_dir.mkdir()

    step_one_file = steps_dir / "step_one.md"
    step_one_file.write_text(
        'Return the JSON object {"result": "step_one_done"} and nothing else.\n',
        encoding="utf-8",
    )
    step_two_file = steps_dir / "step_two.md"
    step_two_file.write_text(
        'Return the JSON object {"result": "step_two_done"} and nothing else.\n',
        encoding="utf-8",
    )

    agent_name = _SMOKE_AGENT
    wf = tmp_path / "smoke.workflow.yaml"
    wf.write_text(
        textwrap.dedent(
            f"""
            name: r1-codex-headless-smoke
            description: trivial 2-node graph for R1 multica headless smoke test
            version: "1.0.0"
            steps:
              - id: step_one
                agent: {agent_name}
                step_file: {step_one_file}
                depends_on: []
              - id: step_two
                agent: {agent_name}
                step_file: {step_two_file}
                depends_on:
                  - step_one
            """
        ).strip()
        + "\n",
        encoding="utf-8",
    )

    materialised = dag_run(
        wf,
        binding="multica",
        run_id="r1-smoke-headless",
        repo_root=tmp_path,
    )

    assert set(materialised) == {"step_one", "step_two"}, (
        f"expected both steps to complete, got: {set(materialised)}"
    )


def test_harvest_artifacts_scoped_to_committed_epic(tmp_path):
    """#1: the agent's work_dir is a fresh checkout of the (possibly consumer)
    repo, so it may already contain OTHER epics. The harvest must surface only
    the epic THIS agent committed on its branch, not pre-existing ones.
    """
    import subprocess as sp

    work_dir = tmp_path / "task-work"
    repo = work_dir / "the-project"
    repo.mkdir(parents=True)

    def git(*args):
        sp.run(["git", "-C", str(repo), *args], check=True, capture_output=True)

    git("init", "-q")
    git("config", "user.email", "t@t")
    git("config", "user.name", "t")
    git("branch", "-m", "main")

    # Pre-existing epic on main (NOT this run's output)
    old = repo / ".pHive/epics/old-epic/docs"
    old.mkdir(parents=True)
    (old / "research-brief.md").write_text("OLD BRIEF — must not surface", encoding="utf-8")
    git("add", "-A")
    git("commit", "-q", "-m", "pre-existing epic")

    # This agent's branch + its own epic
    git("checkout", "-q", "-b", "feat/new-epic")
    new = repo / ".pHive/epics/new-epic/docs"
    new.mkdir(parents=True)
    (new / "research-brief.md").write_text("NEW BRIEF", encoding="utf-8")
    (repo / ".pHive/epics/new-epic/epic.yaml").write_text("name: new-epic\n", encoding="utf-8")
    git("add", "-A")
    git("commit", "-q", "-m", "author new epic")

    out = MulticaAgentSpawn._harvest_artifacts(str(work_dir))
    assert out["research_brief"] == "NEW BRIEF", "must harvest THIS run's brief"
    assert "OLD BRIEF" not in out["research_brief"]
    assert out["epic_dir"] == ".pHive/epics/new-epic"


def test_harvest_node_outputs_reads_declared_outputs(tmp_path):
    """#13: an agent's declared SEMANTIC outputs (needs_frontend, etc.) are
    written to .pHive/dag-outputs/outputs.yaml in its work_dir and surfaced as
    named outputs — the general channel for non-file values."""
    work_dir = tmp_path / "task-work"
    out_dir = work_dir / "the-project" / ".pHive" / "dag-outputs"
    out_dir.mkdir(parents=True)
    (out_dir / "outputs.yaml").write_text(
        "preflight_status: READY\nneeds_backend: false\nneeds_frontend: true\n",
        encoding="utf-8",
    )
    got = MulticaAgentSpawn._harvest_node_outputs(str(work_dir))
    assert got["needs_frontend"] is True
    assert got["needs_backend"] is False
    assert got["preflight_status"] == "READY"
    assert MulticaAgentSpawn._harvest_node_outputs(None) == {}


def test_branch_contract_targets_epic_branch(tmp_path):
    """#15: on a non-default (epic) branch, the binding injects a checkout
    directive so the agent bases its commit on that branch (not the daemon's
    main-based auto-branch). Empty on the default branch."""
    import subprocess as sp
    repo = tmp_path / "proj"
    repo.mkdir()
    def git(*a): sp.run(["git","-C",str(repo),*a], check=True, capture_output=True)
    git("init","-q"); git("config","user.email","t@t"); git("config","user.name","t")
    git("branch","-m","main")
    (repo/"f").write_text("x"); git("add","-A"); git("commit","-q","-m","c")
    git("remote","add","origin",str(repo))  # so origin/main resolves as default
    git("fetch","-q","origin")

    spawn_default = MulticaAgentSpawn(cli_path=tmp_path/"cli.mjs", repo_root=repo)
    assert spawn_default._branch_contract() == "", "default branch -> no directive"

    git("checkout","-q","-b","feat/my-epic")
    spawn_epic = MulticaAgentSpawn(cli_path=tmp_path/"cli.mjs", repo_root=repo)
    contract = spawn_epic._branch_contract()
    assert "feat/my-epic" in contract
    assert "git checkout" in contract
    assert "auto-created" in contract  # warns against the agent/<persona>/<task> branch
