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
        sp.run(["git", "-C", str(repo), *args], check=True, capture_output=True)  # noqa: S603,S607

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


def test_harvest_artifacts_surfaces_uncommitted_brief(tmp_path):
    """Real failure mode: plan research/design write the brief but do NOT commit
    (only the author node commits). A no-commit producer yields an empty
    committed-diff, so the brief must be surfaced from the worktree (untracked),
    while a pre-existing COMMITTED epic from another run must NOT leak in.
    """
    import subprocess as sp

    work_dir = tmp_path / "task-work"
    repo = work_dir / "ttt-throwaway"
    repo.mkdir(parents=True)

    def git(*args):
        sp.run(["git", "-C", str(repo), *args], check=True, capture_output=True)  # noqa: S603,S607

    git("init", "-q")
    git("config", "user.email", "t@t")
    git("config", "user.name", "t")
    git("branch", "-m", "main")

    # Pre-existing COMMITTED epic on main (NOT this run's output)
    old = repo / ".pHive/epics/old-epic/docs"
    old.mkdir(parents=True)
    (old / "research-brief.md").write_text("OLD BRIEF — must not surface", encoding="utf-8")
    git("add", "-A")
    git("commit", "-q", "-m", "pre-existing epic")

    # This agent's branch — writes its brief but DOES NOT COMMIT
    git("checkout", "-q", "-b", "agent/researcher/abc")
    new = repo / ".pHive/epics/ttt-game/docs"
    new.mkdir(parents=True)
    (new / "research-brief.md").write_text("UNCOMMITTED BRIEF", encoding="utf-8")

    out = MulticaAgentSpawn._harvest_artifacts(str(work_dir))
    assert out.get("research_brief") == "UNCOMMITTED BRIEF", (
        "must surface the uncommitted brief the author node depends on"
    )
    assert "OLD BRIEF" not in out.get("research_brief", "")


def test_harvest_artifacts_no_git_checkout(tmp_path):
    """Multica does not always materialise a repo checkout for a node — a design
    task can run with the repo absent, writing .pHive/epics/... directly at the
    work_dir root (no .git). Harvest must still surface the artifact.
    """
    work_dir = tmp_path / "task-work"
    docs = work_dir / ".pHive/epics/ttt-game/docs"
    docs.mkdir(parents=True)
    (docs / "design-discussion.md").write_text("DESIGN DISCUSSION", encoding="utf-8")

    out = MulticaAgentSpawn._harvest_artifacts(str(work_dir))
    assert out.get("design_discussion") == "DESIGN DISCUSSION", (
        "must surface design discussion even without a git checkout"
    )


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
    def git(*a):
        sp.run(["git", "-C", str(repo), *a], check=True, capture_output=True)  # noqa: S603,S607
    git("init", "-q")
    git("config", "user.email", "t@t")
    git("config", "user.name", "t")
    git("branch", "-m", "main")
    (repo / "f").write_text("x")
    git("add", "-A")
    git("commit", "-q", "-m", "c")
    git("remote", "add", "origin", str(repo))  # so origin/main resolves as default
    git("fetch","-q","origin")

    spawn_default = MulticaAgentSpawn(cli_path=tmp_path/"cli.mjs", repo_root=repo)
    assert spawn_default._branch_contract() == "", "default branch -> no directive"

    git("checkout","-q","-b","feat/my-epic")
    spawn_epic = MulticaAgentSpawn(cli_path=tmp_path/"cli.mjs", repo_root=repo)
    contract = spawn_epic._branch_contract()
    assert "feat/my-epic" in contract
    # Force-sync contract: hard-reset local branch to origin tip (works even when a
    # stale local branch exists) — avoids the salvage-induced lineage divergence.
    assert "git checkout -B feat/my-epic origin/feat/my-epic" in contract
    assert "auto-created" in contract  # warns against the agent/<persona>/<task> branch


def test_branch_contract_empty_without_resolvable_remote(tmp_path):
    """CodeRabbit review of #316: a repo with NO origin remote (and no resolvable
    default) must NOT get a contract — its `git fetch origin {branch}` would
    misdirect the run. Even on a non-'main' branch, no remote default => "".
    """
    import subprocess as sp
    repo = tmp_path / "noremote"
    repo.mkdir()
    def git(*a):
        sp.run(["git", "-C", str(repo), *a], check=True, capture_output=True)  # noqa: S603,S607
    git("init", "-q")
    git("config", "user.email", "t@t")
    git("config", "user.name", "t")
    git("checkout", "-q", "-b", "feat/orphan")
    (repo / "f").write_text("x")
    git("add", "-A")
    git("commit", "-q", "-m", "c")
    # No `git remote add origin` — origin/HEAD and origin/{main,master,develop} all unresolvable.

    spawn = MulticaAgentSpawn(cli_path=tmp_path / "cli.mjs", repo_root=repo)
    assert spawn._branch_contract() == "", "no resolvable remote default -> no directive"


# ── single-shared-branch contract: --integration-branch on dispatch (t-007) ──

def test_dispatch_passes_integration_branch_on_epic_branch(tmp_path):
    """On an epic branch, _dispatch tells cli.mjs to inject the single-shared-
    branch contract (agent works on AND pushes origin/{branch}) and forwards the
    story id for the contract's commit-message template."""
    spawn = _make_spawn(tmp_path)
    captured: list[list[str]] = []
    with patch.object(spawn, "_target_branch", return_value="feat/my-epic"), \
         patch.object(spawn, "_run_cli_fast", side_effect=lambda a: captured.append(a)):
        spawn._dispatch("tracker-1", "developer", story_id="s-42")

    args = captured[0]
    assert "--integration-branch" in args
    assert args[args.index("--integration-branch") + 1] == "feat/my-epic"
    assert "--story-id" in args
    assert args[args.index("--story-id") + 1] == "s-42"


def test_dispatch_omits_integration_branch_on_default_branch(tmp_path):
    """Empty target branch (default-branch flows / non-git repo_root) → no
    --integration-branch, preserving the harvest fallback."""
    spawn = _make_spawn(tmp_path)
    captured: list[list[str]] = []
    with patch.object(spawn, "_target_branch", return_value=""), \
         patch.object(spawn, "_run_cli_fast", side_effect=lambda a: captured.append(a)):
        spawn._dispatch("tracker-1", "developer", story_id="s-42")

    assert "--integration-branch" not in captured[0]
    assert "--story-id" not in captured[0]


# ---------------------------------------------------------------------------
# Authoritative epic-branch harvest (bake-in): the daemon leaves HEAD on its
# agent/<persona> branch at base while the agent commits to the epic branch.
# Harvest must follow the epic branch the contract named, not a drifted HEAD.
# ---------------------------------------------------------------------------

def _init_repo(repo, sp):
    repo.mkdir()
    def git(*a):
        return sp.run(
            ["git", "-C", str(repo), *a], check=True, capture_output=True, text=True
        )
    git("init", "-q")
    git("config", "user.email", "t@t")
    git("config", "user.name", "t")
    git("branch", "-m", "main")
    return git


def test_harvest_prefers_epic_branch_tip_over_drifted_head(tmp_path):
    """The core regression: HEAD is left on the daemon branch at base while the
    agent committed to feat/<epic>. Harvest must return the EPIC branch tip +
    name, not the drifted HEAD / base sha."""
    import subprocess as sp

    # Executor checkout on the epic branch so _target_branch resolves.
    exu_git = _init_repo(tmp_path / "exu", sp)
    exu = tmp_path / "exu"
    (exu / "f").write_text("base")
    exu_git("add", "-A"); exu_git("commit", "-q", "-m", "base")
    exu_git("remote", "add", "origin", str(exu)); exu_git("fetch", "-q", "origin")
    exu_git("checkout", "-q", "-b", "feat/my-epic")

    # Agent workdir: feat/my-epic ahead with the agent commit; HEAD drifted to a
    # daemon branch at base.
    awd_git = _init_repo(tmp_path / "awd", sp)
    awd = tmp_path / "awd"
    (awd / "f").write_text("base")
    awd_git("add", "-A"); awd_git("commit", "-q", "-m", "base")
    base_sha = awd_git("rev-parse", "HEAD").stdout.strip()
    awd_git("checkout", "-q", "-b", "feat/my-epic")
    (awd / "impl.py").write_text("real work")
    awd_git("add", "-A"); awd_git("commit", "-q", "-m", "agent work")
    epic_sha = awd_git("rev-parse", "feat/my-epic").stdout.strip()
    awd_git("checkout", "-q", "-b", "agent/dev/x", "main")  # HEAD drifts to base

    spawn = MulticaAgentSpawn(cli_path=tmp_path / "cli.mjs", repo_root=exu)
    out = spawn._harvest_git_state(str(awd))
    assert out["commit_sha"] == epic_sha
    assert out["code_push_sha"] == epic_sha
    assert out["branch"] == "feat/my-epic"
    assert out["commit_sha"] != base_sha


def test_harvest_falls_back_to_head_on_default_branch(tmp_path):
    """No epic branch (executor on the default branch) → harvest HEAD, unchanged
    from the prior behavior."""
    import subprocess as sp

    exu_git = _init_repo(tmp_path / "exu", sp)
    exu = tmp_path / "exu"
    (exu / "f").write_text("x")
    exu_git("add", "-A"); exu_git("commit", "-q", "-m", "c")
    exu_git("remote", "add", "origin", str(exu)); exu_git("fetch", "-q", "origin")
    # repo_root stays on main (default) → _target_branch() == ""

    awd_git = _init_repo(tmp_path / "awd", sp)
    awd = tmp_path / "awd"
    awd_git("checkout", "-q", "-b", "work")
    (awd / "f").write_text("y")
    awd_git("add", "-A"); awd_git("commit", "-q", "-m", "c")
    head_sha = awd_git("rev-parse", "HEAD").stdout.strip()

    spawn = MulticaAgentSpawn(cli_path=tmp_path / "cli.mjs", repo_root=exu)
    out = spawn._harvest_git_state(str(awd))
    assert out["commit_sha"] == head_sha
    assert out["branch"] == "work"


def test_harvest_uses_head_when_agent_ignored_contract(tmp_path):
    """Agent committed on HEAD/the daemon branch and left the epic branch at base
    → harvest HEAD (the ref that actually carries the commit)."""
    import subprocess as sp

    exu_git = _init_repo(tmp_path / "exu", sp)
    exu = tmp_path / "exu"
    (exu / "f").write_text("x")
    exu_git("add", "-A"); exu_git("commit", "-q", "-m", "c")
    exu_git("remote", "add", "origin", str(exu)); exu_git("fetch", "-q", "origin")
    exu_git("checkout", "-q", "-b", "feat/my-epic")

    awd_git = _init_repo(tmp_path / "awd", sp)
    awd = tmp_path / "awd"
    (awd / "f").write_text("base")
    awd_git("add", "-A"); awd_git("commit", "-q", "-m", "base")
    awd_git("branch", "feat/my-epic")  # epic branch at base — no agent commit
    awd_git("checkout", "-q", "-b", "agent/dev/x")  # HEAD on daemon branch
    (awd / "impl").write_text("work")
    awd_git("add", "-A"); awd_git("commit", "-q", "-m", "work")
    head_sha = awd_git("rev-parse", "HEAD").stdout.strip()

    spawn = MulticaAgentSpawn(cli_path=tmp_path / "cli.mjs", repo_root=exu)
    out = spawn._harvest_git_state(str(awd))
    assert out["commit_sha"] == head_sha
    assert out["branch"] == "agent/dev/x"


# NOTE: a prior #21 attempt keyed agent failure off a `.pHive/interrupts/*.yaml`
# `forced_stop` marker. That was wrong — hooks/stop-interrupt-capture.sh writes
# that marker UNCONDITIONALLY on every Claude Code Stop event (normal session end
# included), so every agent work_dir has it, successful ones too. The marker is
# not a failure signal; that detection was reverted.


# ── #22: under-run guard (Multica binding) ────────────────────────────────────

def test_under_run_raises_when_no_declared_output(tmp_path):
    """A Multica agent that 'completes' but produces none of its declared
    semantic outputs must raise after a bounded number of re-dispatch attempts
    (under-run self-heal), not limp on with only commit metadata."""
    from types import SimpleNamespace
    from hive.lib.dag_executor.executor.handlers.agent import AgentHandler

    spawn = _make_spawn(tmp_path)  # real MulticaAgentSpawn
    (tmp_path / "empty").mkdir()

    dispatch_count = [0]

    def side_effect(*args, **kwargs):
        cmd = args[0]
        sub = cmd[2]
        if sub == "create-issue":
            return _make_subprocess_result(_create_issue_result())
        if sub == "dispatch":
            dispatch_count[0] += 1
            return _make_subprocess_result(_dispatch_result())
        # every poll returns completed with an empty work_dir -> under-run
        return _make_subprocess_result(
            _completed_poll_result(work_dir=str(tmp_path / "empty"))
        )

    node = SimpleNamespace(
        id="author",
        agent="technical-writer",
        step_file="",
        outputs=[SimpleNamespace(name="epic_dir"), SimpleNamespace(name="commit_sha")],
    )
    handler = AgentHandler(spawn=spawn)
    with patch("subprocess.run", side_effect=side_effect):
        with pytest.raises(AgentHandlerError, match="under-run"):
            handler.handle(node, inputs={}, run_id="run-1")
    # re-dispatched the bounded number of times before giving up
    assert dispatch_count[0] == 3, "under-run must re-dispatch up to 3 times"


def test_under_run_recovers_via_reharvest_without_redispatch(tmp_path):
    """efcl-s4 — the under-run is usually a RACE: the poll reports 'completed'
    before the agent's commit / outputs.yaml has landed, so the harvest at poll
    time reads an empty tree. A blind re-dispatch lands in a NEW empty work_dir
    and abandons the good one. The guard must re-harvest the SAME work_dir first;
    when the late commit has landed it recovers WITHOUT spending a re-dispatch."""
    from types import SimpleNamespace
    from hive.lib.dag_executor.executor.handlers.agent import (
        AgentHandler,
        MulticaAgentSpawn,
    )

    (tmp_path / "wd").mkdir()

    class _RaceSpawn(MulticaAgentSpawn):
        """__call__ harvests empty (race); a later re-read of the SAME work_dir
        surfaces the declared outputs that the agent committed post-terminal."""

        def reharvest(self, work_dir, base=None):
            out = dict(base or {})
            out["epic_dir"] = ".pHive/epics/execute-flow-followons-converge-loop"
            out["commit_sha"] = "4dcd26e"
            return out

    spawn = _RaceSpawn(cli_path=tmp_path / "cli.mjs", repo_root=tmp_path)

    dispatch_count = [0]

    def side_effect(*args, **kwargs):
        sub = args[0][2]
        if sub == "create-issue":
            return _make_subprocess_result(_create_issue_result())
        if sub == "dispatch":
            dispatch_count[0] += 1
            return _make_subprocess_result(_dispatch_result())
        return _make_subprocess_result(
            _completed_poll_result(work_dir=str(tmp_path / "wd"))
        )

    node = SimpleNamespace(
        id="author",
        agent="technical-writer",
        step_file="",
        outputs=[SimpleNamespace(name="epic_dir"), SimpleNamespace(name="commit_sha")],
    )
    handler = AgentHandler(spawn=spawn)
    with patch("subprocess.run", side_effect=side_effect):
        result = handler.handle(node, inputs={}, run_id="run-1")

    # Recovered on the FIRST attempt — the re-harvest surfaced the good output,
    # so NO second dispatch was spent abandoning the work_dir that held it.
    assert dispatch_count[0] == 1, "reharvest must recover before re-dispatching"
    assert result.outputs["epic_dir"].endswith("execute-flow-followons-converge-loop")
    assert result.outputs["commit_sha"] == "4dcd26e"


def test_output_contract_injected_into_multica_brief(tmp_path):
    """#13-enforce — a Multica node that declares semantic outputs must receive a
    hard OUTPUT CONTRACT naming those exact keys in its issue brief, so a flaky
    agent turn cannot silently end without writing outputs.yaml (the dominant,
    difficulty-independent under-run cause). The step content is still verbatim."""
    from types import SimpleNamespace
    from hive.lib.dag_executor.executor.handlers.agent import AgentHandler

    spawn = _make_spawn(tmp_path)
    (tmp_path / "empty").mkdir()

    def side_effect(*args, **kwargs):
        sub = args[0][2]
        if sub == "create-issue":
            return _make_subprocess_result(_create_issue_result())
        if sub == "dispatch":
            return _make_subprocess_result(_dispatch_result())
        return _make_subprocess_result(
            _completed_poll_result(work_dir=str(tmp_path / "empty"))
        )

    node = SimpleNamespace(
        id="author",
        agent="technical-writer",
        step_file="",
        outputs=[SimpleNamespace(name="epic_dir"), SimpleNamespace(name="commit_sha")],
    )
    handler = AgentHandler(spawn=spawn)
    with patch("subprocess.run", side_effect=side_effect) as mock_run:
        # under-run raise is fine here — we only inspect the issue brief it built
        with pytest.raises(AgentHandlerError):
            handler.handle(node, inputs={}, run_id="run-1")

    create_call = next(
        c for c in mock_run.call_args_list if c[0][0][2] == "create-issue"
    )
    cmd = create_call[0][0]
    body = cmd[cmd.index("--body") + 1]
    assert "OUTPUT CONTRACT" in body
    assert "outputs.yaml" in body
    assert "`epic_dir`" in body
    # commit_sha is spawn metadata (derived from git HEAD), not a SEMANTIC output
    # the agent writes — it must NOT appear in the contract's required keys.
    assert "`commit_sha`" not in body
    # Bracketing: the contract is restated as a terminal STOP GATE at the end of
    # the brief (read last, when the outputs.yaml write is actually due), so the
    # semantic key appears both up front (preamble) and at the close.
    assert "STOP GATE" in body
    assert body.count("`epic_dir`") >= 2
    assert body.rindex("`epic_dir`") > body.index("OUTPUT CONTRACT")
    assert "`commit_sha`" not in body  # metadata stays out of the closer too


def test_output_contract_absent_for_metadata_only_node(tmp_path):
    """A node with no SEMANTIC outputs (only spawn metadata) gets NO contract —
    there is nothing for the agent to write to outputs.yaml."""
    from types import SimpleNamespace
    from hive.lib.dag_executor.executor.handlers.agent import AgentHandler

    spawn = _make_spawn(tmp_path)
    node = SimpleNamespace(
        id="integrate",
        agent="developer",
        step_file="",
        outputs=[SimpleNamespace(name="commit_sha")],  # metadata-only → not semantic
    )
    side_effects = [
        _make_subprocess_result(_create_issue_result()),
        _make_subprocess_result(_dispatch_result()),
        _make_subprocess_result(_completed_poll_result()),
    ]
    handler = AgentHandler(spawn=spawn)
    with patch("subprocess.run", side_effect=side_effects) as mock_run:
        handler.handle(node, inputs={}, run_id="run-1")

    cmd = mock_run.call_args_list[0][0][0]
    body = cmd[cmd.index("--body") + 1]
    assert "OUTPUT CONTRACT" not in body


def test_partial_outputs_treated_as_under_run(tmp_path):
    """CodeRabbit #318 — the #13 contract requires EVERY declared output. A node
    that fills only SOME of its declared semantic outputs is incomplete and must
    under-run (never flow a partial outputs.yaml downstream), so a recovery that
    leaves any key empty is rejected and the guard exhausts its retries."""
    from types import SimpleNamespace
    from hive.lib.dag_executor.executor.handlers.agent import (
        AgentHandler,
        MulticaAgentSpawn,
    )

    class _PartialSpawn(MulticaAgentSpawn):
        # Only ever surfaces ONE of the two declared semantic outputs.
        def reharvest(self, work_dir, base=None):
            out = dict(base or {})
            out["epic_dir"] = ".pHive/epics/x"  # but never story_index
            return out

    spawn = _PartialSpawn(cli_path=tmp_path / "cli.mjs", repo_root=tmp_path)
    (tmp_path / "wd").mkdir()
    dispatch_count = [0]

    def side_effect(*args, **kwargs):
        sub = args[0][2]
        if sub == "create-issue":
            return _make_subprocess_result(_create_issue_result())
        if sub == "dispatch":
            dispatch_count[0] += 1
            return _make_subprocess_result(_dispatch_result())
        return _make_subprocess_result(
            _completed_poll_result(work_dir=str(tmp_path / "wd"))
        )

    node = SimpleNamespace(
        id="author",
        agent="technical-writer",
        step_file="",
        outputs=[SimpleNamespace(name="epic_dir"), SimpleNamespace(name="story_index")],
    )
    handler = AgentHandler(spawn=spawn)
    with patch("subprocess.run", side_effect=side_effect):
        with pytest.raises(AgentHandlerError, match="under-run"):
            handler.handle(node, inputs={}, run_id="run-1")
    # the partial recovery (epic_dir set, story_index empty) is never accepted
    assert dispatch_count[0] == 3
